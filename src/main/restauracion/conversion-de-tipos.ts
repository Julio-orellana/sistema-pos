/**
 * De Postgres a SQLite sin perder un centavo (§6.4 del diseño).
 *
 * ===========================================================================
 * ESTE ES EL LUGAR DONDE UNA RESTAURACIÓN PUEDE CORROMPER EN SILENCIO
 * ===========================================================================
 *
 * Postgres devuelve `NUMERIC`, `timestamptz`, `boolean`, `jsonb`. SQLite exige
 * TEXT canónico con CHECK, ISO con `Z`, `0`/`1`, texto JSON. Un error acá no
 * falla ruidoso: guarda un valor que parece correcto y no lo es. Por eso toda
 * la conversión vive en este único módulo, es PURA —sin red, sin base, sin
 * reloj— y cada regla tiene su prueba.
 *
 * ===========================================================================
 * LOS NUMÉRICOS LLEGAN COMO TEXTO, NUNCA COMO NÚMERO, Y CON CEROS DE RELLENO
 * ===========================================================================
 *
 * PostgREST serializa `NUMERIC` como número JSON por omisión, y un número
 * JSON es un `double`: exactamente lo que `money.ts` existe para evitar. El
 * cliente de restauración pide cada columna numérica con `::text`, así que acá
 * llega la representación textual de Postgres, que **rellena hasta la escala
 * declarada de la columna**: `subtotal_exacto` es `numeric(18,6)` y devuelve
 * `4.165000` donde SQLite guardó `4.165`. Medido en la fase 3.b (CLAUDE.md
 * §4.25). Para las columnas de dos y tres decimales el relleno coincide con la
 * forma canónica local; para la exacta hay que NORMALIZAR, no copiar.
 *
 * **Se normaliza, nunca se redondea.** Si un valor trae más decimales de los
 * que su columna admite —cosa que la escala de Postgres hace imposible, pero
 * que este módulo no da por supuesta— se rechaza en vez de redondearse: un
 * redondeo silencioso es la corrupción que este módulo existe para impedir.
 *
 * ===========================================================================
 * LAS FECHAS: `+00:00` A `Z`, Y SIN PERDER PRECISIÓN
 * ===========================================================================
 *
 * PostgREST devuelve `2026-09-11T19:09:34.701+00:00`; el CHECK local exige el
 * sufijo `Z`. Se normaliza con `Date.toISOString()`, que da exactamente el
 * formato con el que la terminal escribió el valor original —milisegundos y
 * `Z`—, así que el resultado es byte a byte el mismo texto que salió de acá.
 * Una fecha con MÁS de tres decimales no la escribió ninguna terminal: la
 * escribió Postgres por SQL —`now()` tiene microsegundos, y es lo que siembra
 * la migración 0016 en `configuracion_negocio.actualizado_en`—. Se conserva
 * ENTERA, con `Z`: el CHECK local admite cualquier cantidad de decimales
 * (`LIKE '____-__-__T__:__:__%Z'`), `Date.parse` la lee, y truncarla sería
 * perder. Lo encontró `verify:pantallas:restauracion` el 2026-09-14: el
 * proyecto real tiene esa fila exactamente así (`2026-09-11 14:58:55.89473+00`,
 * nunca guardada por una terminal), y la primera versión de este módulo la
 * rechazaba y dejaba la restauración sin poder correr.
 */

import { z } from 'zod';

import {
  aColumnaBooleana,
  aColumnaDecimal,
  type TipoColumnaDecimal,
} from '@main/database/decimal-columns';
import { decimal, DECIMALES_CANTIDAD, DECIMALES_MONTO } from '@shared/money';

/**
 * Las clases de columna que este módulo sabe convertir.
 *
 * `peso` y `cantidad` se escriben igual —tres decimales— y por eso acá son una
 * sola clase, `cantidad`; la distinción de `decimal-columns.ts` es semántica,
 * no de formato.
 */
export type ClaseDeColumna =
  | 'texto'
  | 'entero'
  | 'booleana'
  | 'fecha'
  | 'json'
  | 'monto'
  | 'cantidad'
  | 'exacto';

/**
 * QUÉ ES CADA COLUMNA QUE BAJA DE LA NUBE, tabla por tabla.
 *
 * Es una tabla EXPLÍCITA a propósito, y no una deducción a partir del tipo
 * que declara el contrato: así se puede leer de un vistazo cómo se convierte
 * cada columna. Que la tabla esté completa y coincida con los tipos de la nube
 * no queda a la confianza: hay una prueba que la coteja columna por columna
 * contra la foto `supabase/esquema-nube.json`.
 *
 * `recibido_en` no figura porque no se restaura: es metadato del respaldo y
 * no existe en SQLite. Las columnas que solo existen localmente —los hashes
 * de PIN, el contador de intentos, `estado_sincronizacion`— tampoco: las pone
 * el servicio, no la conversión.
 */
export const CLASES_DE_COLUMNA: Readonly<Record<string, Readonly<Record<string, ClaseDeColumna>>>> = {
  usuarios: {
    id: 'texto',
    nombre: 'texto',
    rol: 'texto',
    activo: 'booleana',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  categorias: {
    id: 'texto',
    nombre: 'texto',
    orden: 'entero',
    activo: 'booleana',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  productos: {
    id: 'texto',
    nombre: 'texto',
    categoria_id: 'texto',
    foto_path: 'texto',
    tipo_medida: 'texto',
    unidad_peso: 'texto',
    cantidad_predefinida_icono: 'cantidad',
    precio_base: 'monto',
    precio_compra: 'monto',
    precio_mayorista: 'monto',
    cantidad_minima_mayorista: 'cantidad',
    inventario_disponible: 'cantidad',
    contador_ventas: 'entero',
    cantidad_vendida: 'cantidad',
    activo: 'booleana',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  precios_especiales: {
    id: 'texto',
    producto_id: 'texto',
    tipo: 'texto',
    valor: 'monto',
    vigente_desde: 'fecha',
    vigente_hasta: 'fecha',
    activo: 'booleana',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  limites_descuento: {
    id: 'texto',
    rol: 'texto',
    descuento_max_porcentaje: 'monto',
    descuento_max_monto_fijo: 'monto',
    editado_por: 'texto',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  configuracion_negocio: {
    id: 'texto',
    nombre_comercial: 'texto',
    direccion: 'texto',
    telefono: 'texto',
    nit: 'texto',
    actualizado_en: 'fecha',
  },
  denominaciones: {
    id: 'texto',
    valor: 'monto',
    tipo: 'texto',
    orden: 'entero',
    activo: 'booleana',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  caja_sesiones: {
    id: 'texto',
    usuario_id: 'texto',
    monto_inicial: 'monto',
    abierta_en: 'fecha',
    monto_esperado: 'monto',
    monto_real: 'monto',
    diferencia: 'monto',
    cerrada_en: 'fecha',
    estado: 'texto',
    diferencia_autorizada_por: 'texto',
    diferencia_autorizada_via: 'texto',
    cerrada_por: 'texto',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  caja_sesion_denominaciones: {
    id: 'texto',
    caja_sesion_id: 'texto',
    denominacion_id: 'texto',
    momento: 'texto',
    cantidad: 'entero',
    creado_en: 'fecha',
  },
  ventas: {
    id: 'texto',
    caja_sesion_id: 'texto',
    usuario_id: 'texto',
    fecha: 'fecha',
    subtotal: 'monto',
    descuento_tipo: 'texto',
    descuento_valor: 'monto',
    descuento_autorizado_por: 'texto',
    descuento_autorizado_via: 'texto',
    total: 'monto',
    forma_pago: 'texto',
    num_boleta: 'texto',
    estado: 'texto',
    creado_en: 'fecha',
    actualizado_en: 'fecha',
  },
  venta_detalle: {
    id: 'texto',
    venta_id: 'texto',
    producto_id: 'texto',
    producto_nombre_snap: 'texto',
    unidad_snap: 'texto',
    cantidad: 'cantidad',
    precio_unitario_snap: 'monto',
    costo_unitario_snap: 'monto',
    subtotal_exacto: 'exacto',
    subtotal_impreso: 'monto',
    orden_linea: 'entero',
    creado_en: 'fecha',
  },
  recibos: {
    id: 'texto',
    venta_id: 'texto',
    numero_recibo: 'entero',
    pdf_path: 'texto',
    impreso: 'booleana',
    creado_en: 'fecha',
  },
  anulaciones_de_venta: {
    id: 'texto',
    venta_id: 'texto',
    solicitada_por: 'texto',
    autorizada_por: 'texto',
    autorizada_via: 'texto',
    motivo: 'texto',
    fecha: 'fecha',
  },
  auditoria_log: {
    id: 'texto',
    usuario_id: 'texto',
    accion: 'texto',
    entidad_tipo: 'texto',
    entidad_id: 'texto',
    valor_anterior: 'json',
    valor_nuevo: 'json',
    fecha: 'fecha',
  },
};

/** Las clases que el cliente tiene que pedir con `::text` para que no lleguen como número. */
export const CLASES_NUMERICAS: readonly ClaseDeColumna[] = ['monto', 'cantidad', 'exacto'];

/** Las columnas de una tabla que hay que pedir con `::text`. */
export function columnasNumericasDe(tabla: string): string[] {
  const clases = CLASES_DE_COLUMNA[tabla] ?? {};
  return Object.entries(clases)
    .filter(([, clase]) => CLASES_NUMERICAS.includes(clase))
    .map(([columna]) => columna);
}

/** Error de conversión: dice tabla, columna y valor, para poder localizar el dato. */
export class ErrorDeConversion extends Error {
  public readonly tabla: string;
  public readonly columna: string;
  public readonly valorRecibido: unknown;

  public constructor(tabla: string, columna: string, mensaje: string, valorRecibido: unknown) {
    super(`${tabla}.${columna}: ${mensaje}`);
    this.name = 'ErrorDeConversion';
    this.tabla = tabla;
    this.columna = columna;
    this.valorRecibido = valorRecibido;
  }
}

/** Forma textual que Postgres da a un numérico: signo opcional, dígitos, decimales opcionales. */
const FORMATO_NUMERICO_DE_POSTGRES = /^-?\d+(\.\d+)?$/;

/** Las formas canónicas que el CHECK local exige, por clase. Es la última comprobación. */
const FORMA_CANONICA: Readonly<Record<'monto' | 'cantidad' | 'exacto', RegExp>> = {
  monto: /^-?\d+\.\d{2}$/,
  cantidad: /^-?\d+\.\d{3}$/,
  exacto: /^-?\d+(\.\d{1,10})?$/,
};

/** Cuántos decimales admite cada clase antes de que normalizar signifique redondear. */
const DECIMALES_ADMITIDOS: Readonly<Record<'monto' | 'cantidad' | 'exacto', number>> = {
  monto: DECIMALES_MONTO,
  cantidad: DECIMALES_CANTIDAD,
  // El CHECK de `subtotal_exacto` admite hasta diez decimales.
  exacto: 10,
};

/**
 * Normaliza un numérico de Postgres a la forma canónica local.
 *
 * **Nunca redondea**: si el valor trae más decimales de los que la clase
 * admite, se rechaza. Postgres no puede producir ese caso —la escala de la
 * columna lo impide— pero este módulo no confía en eso: lo comprueba.
 */
export function normalizarNumerico(
  tabla: string,
  columna: string,
  valor: unknown,
  clase: 'monto' | 'cantidad' | 'exacto',
): string {
  if (typeof valor !== 'string') {
    throw new ErrorDeConversion(
      tabla,
      columna,
      `llegó como ${typeof valor} y tiene que llegar como TEXTO: el cliente pide cada numérico con ::text para que nunca pase por un double`,
      valor,
    );
  }
  if (!FORMATO_NUMERICO_DE_POSTGRES.test(valor)) {
    throw new ErrorDeConversion(tabla, columna, `«${valor}» no tiene forma de número`, valor);
  }

  const numero = decimal(valor);
  if (numero.decimalPlaces() > DECIMALES_ADMITIDOS[clase]) {
    throw new ErrorDeConversion(
      tabla,
      columna,
      `«${valor}» tiene ${String(numero.decimalPlaces())} decimales y la columna admite ${String(DECIMALES_ADMITIDOS[clase])}: normalizar sería redondear, y eso no se hace`,
      valor,
    );
  }

  const tipo: TipoColumnaDecimal = clase;
  const canonico = aColumnaDecimal(numero, tipo);
  if (!FORMA_CANONICA[clase].test(canonico)) {
    throw new ErrorDeConversion(
      tabla,
      columna,
      `«${valor}» quedó como «${canonico}», que no es la forma canónica de ${clase}`,
      valor,
    );
  }
  return canonico;
}

/** Fecha ISO-8601 como la devuelve PostgREST: con `T`, decimales opcionales y zona `Z` o `±hh:mm`. */
const FORMATO_DE_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/;

/** Los decimales de segundo que escribe la terminal (`toISOString` da tres). */
const DECIMALES_DE_SEGUNDO_DE_LA_TERMINAL = 3;

/**
 * Normaliza una fecha de PostgREST a la forma ISO con `Z` que exige el CHECK
 * local, sin perder precisión.
 *
 * Hasta tres decimales, `toISOString` devuelve byte a byte lo que la terminal
 * escribió (Postgres recorta los ceros finales; acá se restituyen). Con MÁS
 * de tres —solo pueden venir de SQL en la nube, como el `now()` de la 0016—
 * se conservan TODOS los dígitos, detrás de la fecha que `toISOString` ya
 * pasó a UTC: los decimales de segundo no cambian con la zona horaria, así
 * que el instante es exactamente el de la nube, y el CHECK local lo admite.
 */
export function normalizarFecha(tabla: string, columna: string, valor: unknown): string {
  if (typeof valor !== 'string') {
    throw new ErrorDeConversion(tabla, columna, `llegó como ${typeof valor} y una fecha tiene que ser texto`, valor);
  }
  const partes = FORMATO_DE_FECHA.exec(valor);
  if (partes === null) {
    throw new ErrorDeConversion(tabla, columna, `«${valor}» no es una fecha ISO-8601 con zona`, valor);
  }
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) {
    throw new ErrorDeConversion(tabla, columna, `«${valor}» no se pudo interpretar como instante`, valor);
  }
  const enUtc = instante.toISOString();
  const decimales = partes[1] ?? '';
  if (decimales.length <= DECIMALES_DE_SEGUNDO_DE_LA_TERMINAL) {
    return enUtc;
  }
  return enUtc.replace(/\.\d{3}Z$/, `.${decimales}Z`);
}

/** Un valor cualquiera, escrito para un mensaje de error. */
function describirValor(valor: unknown): string {
  switch (typeof valor) {
    case 'string':
      return valor;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(valor);
    case 'undefined':
    case 'function':
    case 'symbol':
      return typeof valor;
    default:
      return JSON.stringify(valor);
  }
}

/** Convierte UN valor según su clase. `null` se conserva como `null`. */
export function convertirValor(
  tabla: string,
  columna: string,
  valor: unknown,
  clase: ClaseDeColumna,
): string | number | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  switch (clase) {
    case 'texto':
      if (typeof valor !== 'string') {
        throw new ErrorDeConversion(tabla, columna, `llegó como ${typeof valor} y tiene que ser texto`, valor);
      }
      return valor;
    case 'entero':
      if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) {
        throw new ErrorDeConversion(tabla, columna, `«${describirValor(valor)}» no es un entero`, valor);
      }
      return valor;
    case 'booleana':
      if (typeof valor !== 'boolean') {
        throw new ErrorDeConversion(tabla, columna, `«${describirValor(valor)}» no es un booleano`, valor);
      }
      return aColumnaBooleana(valor);
    case 'fecha':
      return normalizarFecha(tabla, columna, valor);
    case 'json':
      // jsonb vuelve ya parseado. SQLite guarda el TEXTO JSON, así que se
      // vuelve a serializar. Las claves salen en el orden de jsonb, no en el
      // que la terminal las escribió: es el mismo contenido con otra forma.
      return JSON.stringify(valor);
    case 'monto':
    case 'cantidad':
    case 'exacto':
      return normalizarNumerico(tabla, columna, valor, clase);
  }
}

/** Una fila tal como la devuelve PostgREST, ya parseada. */
export type FilaDeLaNube = Readonly<Record<string, unknown>>;

/** Una fila lista para ligar a un INSERT de SQLite. */
export type FilaParaSqlite = Record<string, string | number | null>;

/**
 * Convierte una fila entera, columna por columna, según `CLASES_DE_COLUMNA`.
 *
 * Solo convierte las columnas que la tabla declara; `recibido_en` y cualquier
 * columna que la nube traiga de más se rechazan por nombre, porque una columna
 * que este módulo no conoce es deriva de esquema que la precondición debió
 * atrapar. Y una columna declarada que la nube no trae también se rechaza:
 * `undefined` no es `null`.
 */
export function convertirFila(tabla: string, fila: FilaDeLaNube): FilaParaSqlite {
  const clases = CLASES_DE_COLUMNA[tabla];
  if (clases === undefined) {
    throw new ErrorDeConversion(tabla, '*', 'la tabla no está en la lista de tablas restaurables', null);
  }
  const resultado: FilaParaSqlite = {};
  for (const [columna, clase] of Object.entries(clases)) {
    if (!(columna in fila)) {
      throw new ErrorDeConversion(tabla, columna, 'la nube no trajo esta columna', undefined);
    }
    resultado[columna] = convertirValor(tabla, columna, fila[columna], clase);
  }
  for (const columna of Object.keys(fila)) {
    if (!(columna in clases) && columna !== 'recibido_en') {
      throw new ErrorDeConversion(tabla, columna, 'la nube trajo una columna que este módulo no conoce', fila[columna]);
    }
  }
  return resultado;
}

/**
 * El nombre de archivo de una ruta, venga con barras de Windows o de Unix.
 *
 * Lo usa la descarga de fotos: el objeto de Storage es el nombre del archivo
 * de `foto_path` (§2.5.1). `path.basename` no parte una ruta de Windows en
 * macOS, así que se corta a mano por cualquiera de las dos barras. Para
 * `pdf_path` la conversión —incluida la compatibilidad con las filas que se
 * subieron con ruta absoluta antes de la migración 030— vive en
 * `domain/recibo/ruta-de-pdf.ts`.
 */
export function nombreDeArchivoDe(ruta: string): string {
  const partes = ruta.split(/[\\/]/);
  return partes[partes.length - 1] ?? ruta;
}

/** Lo que PostgREST devuelve para `recibido_en`, para las anomalías de §6.5. */
export const esquemaDeRecibidoEn = z.string();
