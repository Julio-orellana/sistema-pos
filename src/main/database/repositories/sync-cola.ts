/**
 * Acceso a la cola local de sincronización.
 *
 * TABLA EXCLUSIVAMENTE LOCAL: no tiene espejo en Supabase. Es el registro de
 * qué falta subir; subirla sería subir la lista de pendientes junto con los
 * pendientes.
 */

import type { ElementoSyncCola, NuevoElementoSyncCola, OperacionSync } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';

/** Cuántos pendientes hay, agrupados por qué tabla o tipo de archivo son. */
export interface PendientesPorTabla {
  readonly entidadTipo: string;
  readonly total: number;
}

/** El lote que hoy detiene la cola, con lo que hace falta para decidir qué hacer. */
export interface LoteBloqueante {
  readonly loteId: string;
  /** El error TAL CUAL lo devolvió la función de Postgres, sin resumir. */
  readonly error: string;
  readonly intentos: number;
  /** Qué tablas trae el lote, para que la pantalla diga «ventas, productos» y no un UUID. */
  readonly tablas: readonly string[];
  readonly creadoEn: string;
}

/** Fila cruda de la tabla `sync_cola`. */
interface FilaSyncCola {
  readonly id: string;
  readonly entidad_tipo: string;
  readonly entidad_id: string;
  readonly operacion: OperacionSync;
  readonly payload: string;
  readonly intentado_en: string | null;
  readonly sincronizado_en: string | null;
  readonly error: string | null;
  readonly creado_en: string;
  readonly lote_id: string;
  readonly orden_en_lote: number;
  readonly intentos: number;
  readonly proximo_intento_en: string | null;
  readonly bloqueante: number;
}

function aEntidad(fila: FilaSyncCola): ElementoSyncCola {
  return {
    id: fila.id,
    entidadTipo: fila.entidad_tipo,
    entidadId: fila.entidad_id,
    operacion: fila.operacion,
    payload: fila.payload,
    intentadoEn: fila.intentado_en,
    sincronizadoEn: fila.sincronizado_en,
    error: fila.error,
    creadoEn: fila.creado_en,
    loteId: fila.lote_id,
    ordenEnLote: fila.orden_en_lote,
    intentos: fila.intentos,
    proximoIntentoEn: fila.proximo_intento_en,
    bloqueante: fila.bloqueante === 1,
  };
}

export class RepositorioDeSyncCola extends RepositorioBase {
  /** Encola un cambio para subirlo cuando haya red. */
  public encolar(datos: NuevoElementoSyncCola): ElementoSyncCola {
    const id = nuevoId();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO sync_cola (
             id, entidad_tipo, entidad_id, operacion, payload, creado_en
           ) VALUES (
             @id, @entidad_tipo, @entidad_id, @operacion, @payload, @creado_en
           )`,
        )
        .run({
          id,
          entidad_tipo: datos.entidadTipo,
          entidad_id: datos.entidadId,
          operacion: datos.operacion,
          payload: JSON.stringify(datos.payload),
          creado_en: ahora(),
        });
    });

    const encolado = this.obtenerPorId(id);
    if (encolado === null) {
      throw new Error(`No se encontró el elemento de cola recién creado con id ${id}.`);
    }
    return encolado;
  }

  public obtenerPorId(id: string): ElementoSyncCola | null {
    const fila = this.base.prepare('SELECT * FROM sync_cola WHERE id = ?').get(id) as
      | FilaSyncCola
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /** Lo que falta subir, en orden de llegada. */
  public listarPendientes(limite: number): ElementoSyncCola[] {
    const filas = this.base
      .prepare('SELECT * FROM sync_cola WHERE sincronizado_en IS NULL ORDER BY creado_en LIMIT ?')
      .all(limite) as FilaSyncCola[];
    return filas.map(aEntidad);
  }

  public marcarIntento(id: string): void {
    this.ejecutar(() => {
      this.base.prepare('UPDATE sync_cola SET intentado_en = ? WHERE id = ?').run(ahora(), id);
    });
  }

  public marcarSincronizado(id: string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE sync_cola SET sincronizado_en = ?, error = NULL WHERE id = ?')
        .run(ahora(), id);
    });
  }

  public marcarError(id: string, error: string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE sync_cola SET intentado_en = ?, error = ? WHERE id = ?')
        .run(ahora(), error, id);
    });
  }

  public contarPendientes(): number {
    const fila = this.base
      .prepare('SELECT COUNT(*) AS total FROM sync_cola WHERE sincronizado_en IS NULL')
      .get() as { readonly total: number };
    return fila.total;
  }

  // =========================================================================
  // OPERACIONES POR LOTE — lo que el trabajador de sincronización necesita
  // =========================================================================
  //
  // El trabajador nunca sube una fila suelta: sube LOTES, que son unidades de
  // trabajo completas (una venta con su detalle y su auditoría). Todas estas
  // operaciones trabajan sobre el lote entero, porque tratarlas fila por fila
  // dejaría media venta marcada como subida y media no.

  /**
   * El `lote_id` del lote pendiente MÁS VIEJO, o `null` si no hay pendientes.
   *
   * **NO SALTEA NADA, y eso es deliberado:** devuelve el más viejo sin mirar si
   * está bloqueado ni si su espera de reintento venció. Quien llama decide qué
   * hacer con él. Si este método filtrara los bloqueados, la cola seguiría
   * subiendo por detrás de un lote roto y el respaldo tendría un hueco
   * silencioso, que es exactamente lo que §3.2 del diseño prohíbe.
   *
   * **El desempate es `MIN(rowid)`, no el azar.** Dos lotes escritos en el
   * mismo milisegundo tienen el mismo `creado_en`, y sin desempate SQLite
   * podría devolverlos en cualquier orden: el mismo «nunca dejar un orden
   * ambiguo» del reparto de centavos (CLAUDE.md §5). `rowid` es el orden de
   * inserción, que es exactamente el orden de llegada.
   */
  public siguienteLotePendiente(ahoraIso: string): string | null {
    /*
      DOS CONSULTAS, Y EL ORDEN ENTRE ELLAS ES LA REGLA: primero TODAS las filas
      de negocio, después los archivos.

      §2.5.1 del diseño lo dice así: «el trabajador los atiende solo cuando no
      queda ninguna fila pendiente: las filas son el negocio, los archivos son
      el adorno». Con una foto de varios cientos de KB por delante, una venta
      cobrada esperaría a que suba el catálogo; al revés, una venta tarda unos
      pocos KB y la foto espera lo que haga falta.

      No rompe la regla 1 del trabajador —«no saltea ningún lote»—, que existe
      por las llaves foráneas de Postgres: **un archivo no tiene ninguna**.
      Storage no referencia nada y nada lo referencia, así que su orden respecto
      de las filas es libre.
    */
    // Se compara con `substr` y no con `LIKE 'archivo\_%'`: en LIKE el guion
    // bajo es un comodín y hay que escaparlo con ESCAPE, y ese escape tiene que
    // sobrevivir además al literal de plantilla de TypeScript. Son dos capas de
    // escapado para distinguir un prefijo fijo; `substr` no tiene ninguna.
    const negocio = this.base
      .prepare(
        `SELECT lote_id FROM sync_cola
          WHERE sincronizado_en IS NULL AND substr(entidad_tipo, 1, 8) <> 'archivo_'
          GROUP BY lote_id
          ORDER BY MIN(creado_en), MIN(rowid)
          LIMIT 1`,
      )
      .get() as { readonly lote_id: string } | undefined;

    if (negocio !== undefined) {
      return negocio.lote_id;
    }

    /*
      ENTRE ARCHIVOS SÍ SE SALTEA AL QUE ESTÁ ESPERANDO, y esa es la otra mitad
      del §2.5.4: una foto que no está en el disco se aparta un día, y las otras
      199 del catálogo tienen que poder subir mientras tanto. Con las filas de
      negocio no se saltea nunca, porque ahí el orden ES la integridad
      referencial; entre archivos no hay orden que preservar, cada uno es
      independiente de todos los demás.

      Y es lo que impide que un archivo ausente deje al trabajador en un bucle:
      sin este filtro, el mismo lote volvería a salir elegido en cada vuelta.
    */
    const archivo = this.base
      .prepare(
        `SELECT lote_id FROM sync_cola
          WHERE sincronizado_en IS NULL AND substr(entidad_tipo, 1, 8) = 'archivo_'
          GROUP BY lote_id
          HAVING MAX(coalesce(proximo_intento_en, '')) <= @ahora
          ORDER BY MIN(creado_en), MIN(rowid)
          LIMIT 1`,
      )
      .get({ ahora: ahoraIso }) as { readonly lote_id: string } | undefined;

    return archivo === undefined ? null : archivo.lote_id;
  }

  /** Las filas pendientes de un lote, en el orden en que hay que subirlas. */
  public leerLote(loteId: string): ElementoSyncCola[] {
    const filas = this.base
      .prepare(
        `SELECT * FROM sync_cola
          WHERE lote_id = ? AND sincronizado_en IS NULL
          ORDER BY orden_en_lote`,
      )
      .all(loteId) as FilaSyncCola[];
    return filas.map(aEntidad);
  }

  /**
   * Marca TODAS las filas pendientes del lote como sincronizadas.
   *
   * **ES IDEMPOTENTE POR CONSTRUCCIÓN:** el `WHERE sincronizado_en IS NULL`
   * hace que confirmar dos veces el mismo lote no pise la marca original ni
   * toque nada. Confirmar dos veces no es hipotético: es lo que pasa cuando la
   * respuesta de la nube llega después de que la terminal ya la dio por buena.
   *
   * Devuelve cuántas filas marcó, para que quien llame pueda distinguir «lo
   * marqué ahora» de «ya estaba marcado» sin volver a consultar.
   */
  public marcarLoteSincronizado(loteId: string): number {
    return this.ejecutar(() => {
      const resultado = this.base
        .prepare(
          `UPDATE sync_cola
              SET sincronizado_en = ?, error = NULL, bloqueante = 0, proximo_intento_en = NULL
            WHERE lote_id = ? AND sincronizado_en IS NULL`,
        )
        .run(ahora(), loteId);
      return resultado.changes;
    });
  }

  /**
   * Un fallo TRANSITORIO: se suma un intento y se agenda cuándo reintentar.
   *
   * El lote queda tal como estaba —sin `sincronizado_en`, sin `bloqueante`— y
   * vuelve a la cola. `proximo_intento_en` se PERSISTE a propósito: si viviera
   * en memoria, un cierre forzado —que este proyecto permite (§4.5)—
   * reiniciaría el backoff y la aplicación martillaría un servidor que ya dijo
   * que no puede.
   */
  public registrarIntentoFallido(loteId: string, error: string, proximoIntentoEn: string): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE sync_cola
              SET intentos = intentos + 1,
                  intentado_en = ?,
                  error = ?,
                  proximo_intento_en = ?
            WHERE lote_id = ? AND sincronizado_en IS NULL`,
        )
        .run(ahora(), error, proximoIntentoEn, loteId);
    });
  }

  /**
   * Un fallo DETERMINÍSTICO: el lote queda bloqueante y la cola se detiene.
   *
   * No se agenda ningún reintento, y no es un olvido: reintentar en bucle algo
   * que Postgres ya dijo que es inválido es ruido. Se desbloquea únicamente a
   * pedido de una persona, con `desbloquearLote`.
   */
  public marcarLoteBloqueante(loteId: string, error: string): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE sync_cola
              SET intentos = intentos + 1,
                  intentado_en = ?,
                  error = ?,
                  bloqueante = 1,
                  proximo_intento_en = NULL
            WHERE lote_id = ? AND sincronizado_en IS NULL`,
        )
        .run(ahora(), error, loteId);
    });
  }

  /**
   * Levanta el bloqueo de un lote para que la cola vuelva a intentarlo.
   *
   * Es la mitad «reintentar ahora» de la pantalla de sincronización (Fase 4.a,
   * §3.3 del diseño): `ServicioDeSincronizacion.reintentarLote` la llama y
   * después dispara un ciclo inmediato. Nació antes de que esa pantalla
   * existiera, como la otra mitad de `marcarLoteBloqueante` —sin ella, las
   * pruebas no podían comprobar que un lote desbloqueado deja pasar a los que
   * estaban detrás—, y ahora también tiene un llamador real.
   */
  public desbloquearLote(loteId: string): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE sync_cola
              SET bloqueante = 0, proximo_intento_en = NULL
            WHERE lote_id = ? AND sincronizado_en IS NULL`,
        )
        .run(loteId);
    });
  }

  /** Cuántos lotes distintos quedan sin subir. */
  public contarLotesPendientes(): number {
    const fila = this.base
      .prepare(
        `SELECT COUNT(DISTINCT lote_id) AS total
           FROM sync_cola WHERE sincronizado_en IS NULL`,
      )
      .get() as { readonly total: number };
    return fila.total;
  }

  // =========================================================================
  // LECTURA PARA LA PANTALLA DE SINCRONIZACIÓN (Fase 4.a)
  // =========================================================================

  /** Pendientes agrupados por tabla (o `archivo_foto` para las fotos). */
  public contarPendientesPorTabla(): PendientesPorTabla[] {
    const filas = this.base
      .prepare(
        `SELECT entidad_tipo, COUNT(*) AS total FROM sync_cola
          WHERE sincronizado_en IS NULL
          GROUP BY entidad_tipo
          ORDER BY entidad_tipo`,
      )
      .all() as { readonly entidad_tipo: string; readonly total: number }[];
    return filas.map((fila) => ({ entidadTipo: fila.entidad_tipo, total: fila.total }));
  }

  /**
   * `creado_en` de la fila pendiente MÁS VIEJA, o `null` si no hay pendientes.
   *
   * Es la edad que decide si algo cuenta como «pendiente viejo» (decisión 8
   * del diseño, umbral de 24 h, provisional) y lo que arma el texto del aviso
   * al iniciar sesión: «desde ayer a las 09:12».
   */
  public obtenerPendienteMasVieja(): string | null {
    const fila = this.base
      .prepare(
        `SELECT MIN(creado_en) AS creado_en FROM sync_cola WHERE sincronizado_en IS NULL`,
      )
      .get() as { readonly creado_en: string | null };
    return fila.creado_en;
  }

  /**
   * Cuándo se sincronizó algo por última vez, de verdad.
   *
   * Es el «último éxito» que pide la pantalla, y se lee de `sync_cola` en vez
   * de guardarse en memoria: es el mismo criterio de siempre —todo el estado
   * vive en la base, ninguno en memoria (§4.18)—, así que sobrevive a un
   * cierre forzado y no depende de que el proceso lleve un rato corriendo.
   */
  public obtenerUltimoExito(): string | null {
    const fila = this.base
      .prepare(`SELECT MAX(sincronizado_en) AS ultimo FROM sync_cola WHERE sincronizado_en IS NOT NULL`)
      .get() as { readonly ultimo: string | null };
    return fila.ultimo;
  }

  /**
   * El lote que hoy detiene la cola, o `null` si ninguno lo hace.
   *
   * **Solo puede haber uno a la vez en un sistema sano.** El trabajador nunca
   * mira más allá del lote pendiente más viejo (`siguienteLotePendiente`), así
   * que si ese queda bloqueante ningún lote más nuevo llega a intentarse. Se
   * toma el más viejo de los que estén marcados por defensa, no porque se
   * espere encontrar más de uno.
   */
  public obtenerLoteBloqueante(): LoteBloqueante | null {
    const filas = this.base
      .prepare(
        `SELECT * FROM sync_cola
          WHERE bloqueante = 1 AND sincronizado_en IS NULL
          ORDER BY creado_en, rowid`,
      )
      .all() as FilaSyncCola[];

    const primera = filas[0];
    if (primera === undefined) {
      return null;
    }

    const delMismoLote = filas.filter((fila) => fila.lote_id === primera.lote_id);
    return {
      loteId: primera.lote_id,
      error: primera.error ?? '',
      intentos: primera.intentos,
      tablas: [...new Set(delMismoLote.map((fila) => fila.entidad_tipo))],
      creadoEn: primera.creado_en,
    };
  }

  /**
   * Fotos que se apartaron un día porque el archivo ya no está en el disco
   * (§2.5.4). No están bloqueando nada; son un aviso aparte.
   */
  public contarArchivosApartados(): number {
    const fila = this.base
      .prepare(
        `SELECT COUNT(*) AS total FROM sync_cola
          WHERE sincronizado_en IS NULL
            AND substr(entidad_tipo, 1, 8) = 'archivo_'
            AND proximo_intento_en IS NOT NULL`,
      )
      .get() as { readonly total: number };
    return fila.total;
  }

  /**
   * SALTA un lote a mano: lo marca resuelto SIN haberlo subido.
   *
   * **Es DISTINTO de `marcarLoteSincronizado`, y a propósito.** Aquel es la
   * confirmación real de que la nube aceptó el lote; este dice lo contrario —
   * que una PERSONA decidió dejar un hueco deliberado en el respaldo (§3.3 del
   * diseño, decisión 9). El `error` no se limpia a NULL como en un éxito
   * genuino: se REEMPLAZA por `nota`, para que quien mire la fila en el disco
   * —sin pasar por la auditoría— no la confunda con una subida real. El
   * registro completo de quién lo saltó y por qué vive en `auditoria_log`, que
   * sí se sincroniza; esto es solo la marca local.
   *
   * Devuelve las filas que tenía el lote ANTES de marcarlas, porque quien
   * llama las necesita para escribir el asiento de auditoría con lo que
   * contenía.
   */
  public marcarLoteSaltado(loteId: string, nota: string): ElementoSyncCola[] {
    const filas = this.leerLote(loteId);

    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE sync_cola
              SET sincronizado_en = ?, error = ?, bloqueante = 0, proximo_intento_en = NULL
            WHERE lote_id = ? AND sincronizado_en IS NULL`,
        )
        .run(ahora(), nota, loteId);
    });

    return filas;
  }
}
