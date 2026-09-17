/**
 * Bandeja de salida transaccional: qué se subió a la nube, anotado junto al dato.
 *
 * ===========================================================================
 * LA REGLA QUE JUSTIFICA TODO ESTE MÓDULO
 * ===========================================================================
 *
 * **La fila de la cola se escribe DENTRO de la misma transacción que el dato de
 * negocio.** No después, no en otra transacción, no «en cuanto se pueda». Es el
 * patrón de bandeja de salida transaccional, y es la única forma de que sea
 * imposible que ocurra cualquiera de estas dos cosas:
 *
 *   · una venta cobrada que nunca se va a subir, porque la aplicación murió
 *     entre el `COMMIT` de la venta y el `INSERT` en la cola;
 *   · una entrada de cola que apunta a una venta que no existe, porque murió
 *     al revés.
 *
 * En este proyecto eso no es una hipótesis remota: **matar el proceso desde el
 * sistema operativo es una vía de escape permitida a propósito** (CLAUDE.md
 * §4.5). Una bandeja de salida que no comparte transacción con el dato es una
 * bandeja de salida que miente el día que alguien usa esa vía.
 *
 * ===========================================================================
 * EL PAYLOAD SE LEE DE LA BASE, NO SE RECONSTRUYE DESDE LA ENTIDAD
 * ===========================================================================
 *
 * `armarPayload` hace un `SELECT *` de la fila recién escrita y serializa lo
 * que SQLite devuelve. **No** toma el objeto de dominio y lo vuelve a
 * convertir. La diferencia importa y es la razón de ser de este módulo:
 *
 *   · Un `Decimal` en memoria habría que volver a pasar por `montoACadena`,
 *     `cantidadACadena` o `aColumnaExacta` según la columna, y **acertarle a
 *     cuál corresponde en cada una de las trece tablas**. Equivocarse en una
 *     sola manda a la nube un `2.5` donde la base tiene `2.500`, o peor, un
 *     número de JavaScript donde la base tiene una cadena exacta.
 *   · Leyendo de la base, el payload es **byte a byte lo que quedó guardado**.
 *     No hay conversión que pueda equivocarse porque no hay conversión.
 *
 * Es la misma razón por la que `decimal-columns.ts` es la única vía para leer y
 * escribir columnas decimales (§5): un solo lugar donde la representación puede
 * fallar, y acá ni siquiera ese.
 *
 * Los booleanos viajan como los guarda SQLite, `0` o `1`, y no como `true` o
 * `false`: la conversión a `boolean` de Postgres es trabajo de quien sube, no
 * de quien encola.
 *
 * ===========================================================================
 * QUÉ NO VIAJA
 * ===========================================================================
 *
 * Ver `COLUMNAS_EXCLUIDAS`. Cada exclusión tiene su razón escrita, y ninguna es
 * una optimización: son datos que no deben existir en la nube.
 */

import type { Database } from 'better-sqlite3';

import type { OperacionSync } from './repositories/entidades';
import { ahora, nuevoId } from './repositories/base';
import { enTransaccionDeNegocio } from './transaccion-en-curso';

/**
 * Las tablas que se encolan, con el nombre exacto que tienen en los dos
 * esquemas. Es una lista cerrada a propósito: encolar una tabla nueva exige
 * agregarla acá, y agregarla acá obliga a preguntarse si es dato de negocio.
 *
 * **`denominaciones` NO está, y no es un olvido.** Las once del quetzal ya
 * viven en la nube con los mismos UUID desde la migración `0004`, sembradas
 * allá. Nunca cambian y nunca se encolan.
 *
 * **`sync_cola`, `bloqueos_de_autorizacion` y `migraciones_aplicadas` tampoco**,
 * por las razones de CLAUDE.md §4.4: son estado operativo de esta terminal.
 */
export type TablaSincronizable =
  | 'usuarios'
  | 'categorias'
  | 'productos'
  | 'precios_especiales'
  | 'limites_descuento'
  | 'configuracion_negocio'
  | 'caja_sesiones'
  | 'caja_sesion_denominaciones'
  | 'ventas'
  | 'venta_detalle'
  | 'recibos'
  /*
    La anulación de una venta (docs/ANULACION-DE-VENTA.md §7.1). Se encola
    dentro de la transacción, como toda operación de negocio, y sube por
    `sincronizar_anulacion_de_venta` (migración `0035`, que exige la `0033`).
    UNA NUBE SIN ESAS DOS MIGRACIONES DETIENE LA COLA en la primera anulación:
    PostgREST no encuentra la función. Por eso se aplican a la nube ANTES de
    instalar la versión que anula (§7.5 del diseño).
  */
  | 'anulaciones_de_venta'
  | 'auditoria_log';

/**
 * Columnas que NUNCA salen de esta terminal, aunque su tabla sí se sincronice.
 *
 * | Columna | Por qué se queda |
 * |---|---|
 * | `usuarios.intentos_fallidos` | Estado por identidad, local por ahora. Una columna que existiera en Postgres sin sincronizarse mostraría `0` para todos y le haría creer al auditor que nadie falló jamás un ingreso (§4.4). |
 * | `usuarios.bloqueado_hasta` | Lo mismo: un candado deja de significar nada 30 segundos después de escribirse. |
 * | `usuarios.pin_hash` | Decisión 17 del diseño. Un PIN de cuatro dígitos tiene 10 000 valores: quien lea la tabla en la nube los saca todos. Y **no hacen falta allá**, porque toda restauración resetea los PIN sin mirarlos (§6.1). |
 * | `usuarios.totp_secreto_cifrado` | **NUNCA, bajo ninguna circunstancia** (migración 036). Es más sensible que un hash: quien descifre el secreto de TOTP calcula TODOS los códigos futuros de esa persona. Reemplaza al `pin_remoto_hash` de la 005, que se quitó en la 037. |
 * | `usuarios.totp_ultimo_paso` | Estado operativo de esta terminal: qué código se usó por última vez, para que no sirva dos veces. |
 * | `ventas.estado_sincronizacion` | Decisión 4. Es estado operativo de esta terminal: en la nube diría siempre `'pendiente'`, que allá no significa nada. |
 */
export const COLUMNAS_EXCLUIDAS: Readonly<Record<string, readonly string[]>> = {
  usuarios: ['intentos_fallidos', 'bloqueado_hasta', 'pin_hash', 'totp_secreto_cifrado', 'totp_ultimo_paso'],
  ventas: ['estado_sincronizacion'],
};

/** Una fila que hay que subir, dentro de un lote. */
export interface EntradaDelLote {
  readonly tabla: TablaSincronizable;
  /** Clave primaria de la fila. En `configuracion_negocio` es la constante `'unica'`. */
  readonly id: string;
  readonly operacion: OperacionSync;
}

/** Lo que `encolarLote` devuelve, para que las pruebas puedan afirmar sobre ello. */
export interface LoteEncolado {
  readonly loteId: string;
  readonly filas: number;
}

/**
 * Lee una fila y la deja lista para viajar: todo lo que SQLite guardó, menos
 * lo que no debe salir de acá.
 *
 * Devuelve `null` si la fila no existe, lo que en el uso normal es imposible
 * —se encola lo que se acaba de escribir, en la misma transacción— y por eso
 * quien llama lo trata como un error de programación y no como un caso.
 */
export function armarPayload(
  base: Database,
  tabla: TablaSincronizable,
  id: string,
): Record<string, unknown> | null {
  /*
    El nombre de la tabla se interpola en el SQL, que normalmente sería una
    puerta a inyección. Acá no lo es, y conviene decir por qué en vez de
    dejarlo a la confianza: `TablaSincronizable` es una unión cerrada de
    literales, así que el compilador rechaza cualquier otro valor, y ninguno
    viene de una entrada del usuario. El `id` sí va ligado como
    parámetro, como corresponde.
  */
  const fila = base.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;

  if (fila === undefined) {
    return null;
  }

  const excluidas = COLUMNAS_EXCLUIDAS[tabla] ?? [];
  if (excluidas.length === 0) {
    return fila;
  }

  const limpia: Record<string, unknown> = {};
  for (const [columna, valor] of Object.entries(fila)) {
    if (!excluidas.includes(columna)) {
      limpia[columna] = valor;
    }
  }
  return limpia;
}

/**
 * Escribe en `sync_cola` una fila por cada entrada, todas con el mismo lote.
 *
 * **EL ORDEN DE `entradas` ES EL ORDEN EN QUE SE VAN A SUBIR**, y por eso quien
 * llama tiene que darlas con los padres antes que los hijos: `ventas` antes que
 * `venta_detalle`, `caja_sesiones` antes que su desglose. Subirlas al revés lo
 * rechazaría la llave foránea de Postgres, y el lote quedaría detenido con un
 * error que no dice nada del problema real.
 *
 * **TIENE QUE LLAMARSE DENTRO DE UNA TRANSACCIÓN YA ABIERTA.** No abre una: si
 * la abriera, el dato y su entrada de cola podrían confirmarse por separado, que
 * es exactamente lo que este módulo existe para impedir. Como better-sqlite3 es
 * síncrono, «dentro de la transacción» significa literalmente que la llamada
 * ocurre entre el `BEGIN` y el `COMMIT` de quien la invoca.
 */
/**
 * A quién avisarle que se encoló un lote. Uno solo: el planificador.
 *
 * **EL AVISO OCURRE DENTRO DE LA TRANSACCIÓN, y hay que saberlo.** `encolarLote`
 * corre entre el `BEGIN` y el `COMMIT`, así que el observador se entera antes
 * de que el dato esté confirmado. Es deliberado y es seguro por una razón
 * concreta: **lo único que el observador puede hacer es agendar un
 * temporizador**, nunca tocar la base. Si tocara la base, su escritura entraría
 * en esta transacción y se revertiría con ella, que es justo lo que
 * `transaccion-en-curso.ts` existe para impedir.
 *
 * Si la transacción se revierte, el temporizador queda agendado igual y el
 * ciclo que corra dos segundos después no va a encontrar nada que subir. El
 * costo es una consulta que devuelve cero filas; el beneficio es que avisar
 * desde el único lugar que escribe la cola hace imposible olvidarse de avisar.
 */
let observadorDeLotes: (() => void) | null = null;

/**
 * Registra a quién avisarle. Pasar `null` lo quita.
 *
 * Es uno y no una lista a propósito: dos observadores serían dos políticas de
 * cuándo sincronizar, y el proyecto tiene una.
 */
export function observarLotesEncolados(observador: (() => void) | null): void {
  observadorDeLotes = observador;
}

export function encolarLote(base: Database, entradas: readonly EntradaDelLote[]): LoteEncolado {
  const loteId = nuevoId();
  const momento = ahora();

  const insertar = base.prepare(
    `INSERT INTO sync_cola (
       id, entidad_tipo, entidad_id, operacion, payload, creado_en,
       lote_id, orden_en_lote, intentos, bloqueante
     ) VALUES (
       @id, @entidad_tipo, @entidad_id, @operacion, @payload, @creado_en,
       @lote_id, @orden_en_lote, 0, 0
     )`,
  );

  for (const [indice, entrada] of entradas.entries()) {
    const payload = armarPayload(base, entrada.tabla, entrada.id);
    if (payload === null) {
      /*
        Se encola lo que se acaba de escribir, en la misma transacción, así que
        esto no puede pasar salvo que quien llama se haya equivocado de id. Se
        lanza y la transacción entera se revierte: es preferible perder la
        operación a guardarla con un respaldo que apunta a la nada.
      */
      throw new Error(
        `No se puede encolar ${entrada.tabla}/${entrada.id}: la fila no existe en la base.`,
      );
    }

    insertar.run({
      id: nuevoId(),
      entidad_tipo: entrada.tabla,
      entidad_id: entrada.id,
      operacion: entrada.operacion,
      payload: JSON.stringify(payload),
      creado_en: momento,
      lote_id: loteId,
      orden_en_lote: indice,
    });
  }

  observadorDeLotes?.();

  return { loteId, filas: entradas.length };
}

/**
 * Las entradas de un conjunto de filas de la misma tabla, en un orden fijo.
 *
 * Se usa para los hijos que se escriben de a varios —las líneas de una venta,
 * el desglose de una caja— cuyos ids no siempre los devuelve el repositorio. El
 * orden lo decide quien llama pasando los ids ya ordenados; este módulo no
 * inventa ninguno, porque un orden ambiguo es exactamente lo que el resto del
 * proyecto evita (§5).
 */
export function entradasDe(
  tabla: TablaSincronizable,
  ids: readonly string[],
  operacion: OperacionSync,
): EntradaDelLote[] {
  return ids.map((id) => ({ tabla, id, operacion }));
}

/**
 * Envuelve una operación de escritura en UNA transacción y encola lo que
 * escribió, todo junto.
 *
 * Es el atajo para el caso frecuente —una fila de negocio más su asiento de
 * auditoría— y existe para que los siete servicios tengan exactamente la misma
 * forma en vez de siete variantes de lo mismo. La operación devuelve lo suyo y,
 * al lado, qué encolar; este envoltorio se encarga de que las dos cosas ocurran
 * en la misma transacción o en ninguna.
 *
 * `ServicioDeVenta` NO lo usa, y es correcto: su transacción hace siete pasos
 * más antes de llegar a la cola, con reverificación de caja y comparar-y-cambiar
 * de inventario, y meterla en este molde la haría menos legible, no más.
 */
/**
 * El `entidad_tipo` con el que viaja una FOTO, que no es una fila de ninguna
 * tabla.
 *
 * `sync_cola.entidad_tipo` no tiene lista cerrada en el esquema —su CHECK solo
 * exige texto no vacío— así que **no hizo falta migración** para agregarlo.
 *
 * **NO EXISTE `archivo_pdf`, Y NO ES UN OLVIDO.** §2.5.1 del diseño preveía los
 * dos tipos, y §2.5.3 decidió después que **los PDF de recibos no se suben**:
 * son dato derivado que la reimpresión regenera desde las filas, y subirlos
 * llenaría el gigabyte del plan gratuito en unos ocho meses. Declarar un tipo
 * que nadie produce sería exactamente el «disparador falso que parece
 * funcionar» que §4.18 rechaza. La nube lo respalda: la terminal **no tiene
 * ninguna política sobre el bucket `recibos`** (migración 0026), así que aunque
 * alguien lo intentara, RLS lo rechazaría.
 */
export const TIPO_DE_ENTRADA_DE_FOTO = 'archivo_foto';

/** Prefijo que distingue una entrada de archivo de una fila de negocio. */
export const PREFIJO_DE_ARCHIVO = 'archivo_';

/** Lo que se necesita saber de una foto para poder subirla más tarde. */
export interface ArchivoParaSubir {
  /** Ruta RELATIVA tal como la guarda `productos.foto_path`. */
  readonly rutaLocal: string;
  /** Nombre del objeto dentro del bucket `fotos`, derivado de la ruta local. */
  readonly objeto: string;
  /** Tamaño en bytes al momento de encolar. */
  readonly tamano: number;
  /** SHA-256 del contenido al momento de encolar, en hexadecimal. */
  readonly sha256: string;
}

/**
 * Encola una foto para subir, EN SU PROPIO LOTE.
 *
 * Va en un lote aparte del de la fila que la referencia, y eso es §2.5.1: la
 * fila del producto es el negocio y tiene que llegar aunque la foto no pueda;
 * mezclarlas haría que un archivo ausente arrastrara al producto.
 *
 * Se llama DENTRO de la misma transacción que escribió el producto, por la
 * misma razón de siempre (§4.17): si se encolara después del `COMMIT`, un
 * cierre forzado entre las dos escrituras dejaría una foto que nunca se sube.
 */
export function encolarFoto(base: Database, archivo: ArchivoParaSubir): LoteEncolado {
  const loteId = nuevoId();

  base
    .prepare(
      `INSERT INTO sync_cola (
         id, entidad_tipo, entidad_id, operacion, payload, creado_en,
         lote_id, orden_en_lote, intentos, bloqueante
       ) VALUES (
         @id, @entidad_tipo, @entidad_id, 'insertar', @payload, @creado_en,
         @lote_id, 0, 0, 0
       )`,
    )
    .run({
      id: nuevoId(),
      entidad_tipo: TIPO_DE_ENTRADA_DE_FOTO,
      // El id de la entrada es la RUTA LOCAL: es lo que la identifica, y hace
      // que encolar dos veces la misma foto se vea de inmediato.
      entidad_id: archivo.rutaLocal,
      payload: JSON.stringify(archivo),
      creado_en: ahora(),
      lote_id: loteId,
    });

  observadorDeLotes?.();

  return { loteId, filas: 1 };
}

export function conBandejaDeSalida<T>(
  base: Database,
  operacion: () => { readonly resultado: T; readonly entradas: readonly EntradaDelLote[] },
): T {
  return enTransaccionDeNegocio(base, (): T => {
    const { resultado, entradas } = operacion();
    encolarLote(base, entradas);
    return resultado;
  });
}
