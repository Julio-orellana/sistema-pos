/**
 * decimal-columns.ts — LA ÚNICA VÍA para leer y escribir columnas decimales.
 *
 * REGLA NO NEGOCIABLE DEL PROYECTO: ningún campo que represente dinero, peso o
 * cantidad se guarda como REAL en SQLite. SQLite REAL es punto flotante de 64
 * bits, exactamente el problema que money.ts existe para evitar: 16.80 puede
 * volver de la base como 16.799999999999997 y descuadrar el corte de caja.
 *
 * Esos campos se guardan como TEXT con la cadena exacta que produce Decimal.js.
 * Este módulo es el único autorizado para hacer esa conversión en ambos
 * sentidos. Ninguna consulta del resto del proyecto debe tratar un valor
 * decimal como número: si en algún repositorio aparece un `Number(fila.total)`
 * o una suma en SQL sobre una de estas columnas, es un defecto.
 *
 * La base de datos respalda esta regla por su cuenta: cada columna decimal
 * tiene una restricción CHECK que exige `typeof(columna) = 'text'`, así que un
 * número ligado por descuido es rechazado por SQLite, no solo por este módulo.
 */

import type Decimal from 'decimal.js';

import {
  DECIMALES_CANTIDAD,
  DECIMALES_MONTO,
  DECIMALES_PESO,
  aCadena,
  cantidadACadena,
  decimal,
  montoACadena,
  pesoACadena,
  type EntradaDecimal,
} from '@shared/money';

/**
 * Naturaleza del valor que guarda una columna. Determina con cuántos decimales
 * se escribe, para que la base tenga siempre una forma canónica.
 */
export type TipoColumnaDecimal =
  /** Dinero en quetzales: dos decimales fijos ("16.80"). */
  | 'monto'
  /** Peso en libras o kilos: tres decimales fijos ("12.500"). */
  | 'peso'
  /** Cantidad por unidad: tres decimales fijos ("2.000"). */
  | 'cantidad'
  /**
   * Valor exacto, sin redondear ni rellenar ("16.795"). Se usa solo donde el
   * redondeo destruiría información que después hace falta, como
   * `venta_detalle.subtotal_exacto`, del que se deriva el total real.
   */
  | 'exacto';

/** Códigos de error de este módulo. */
export type CodigoErrorDeColumnaDecimal =
  | 'VALOR_NO_ES_TEXTO'
  | 'FORMATO_INVALIDO'
  | 'VALOR_NULO_INESPERADO';

/**
 * Error al convertir una columna decimal. Lleva el nombre de la columna porque
 * un dato corrupto en la base hay que poder localizarlo, no solo detectarlo.
 */
export class ErrorDeColumnaDecimal extends Error {
  public readonly codigo: CodigoErrorDeColumnaDecimal;
  public readonly columna: string;
  public readonly valorRecibido: unknown;

  public constructor(
    codigo: CodigoErrorDeColumnaDecimal,
    columna: string,
    mensaje: string,
    valorRecibido?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorDeColumnaDecimal';
    this.codigo = codigo;
    this.columna = columna;
    this.valorRecibido = valorRecibido;
  }
}

/**
 * Forma canónica aceptada en la base: signo menos opcional, dígitos, y una
 * parte decimal opcional. Es el mismo conjunto que acepta la restricción CHECK
 * de SQLite, pero más estricto: aquí sí se puede exigir un solo punto y un
 * solo signo.
 */
const FORMATO_CANONICO = /^-?\d+(\.\d+)?$/;

/** ¿El texto tiene la forma canónica de una columna decimal? */
export function esFormatoDeColumnaDecimal(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMATO_CANONICO.test(valor);
}

// ---------------------------------------------------------------------------
// Escritura: Decimal -> TEXT
// ---------------------------------------------------------------------------

/**
 * Convierte un valor decimal en el TEXT que se guarda en la base.
 *
 * Es la única función autorizada para producir el valor que se liga a una
 * columna decimal. Devuelve `string`, nunca `number`, para que sea imposible
 * ligar un número por accidente.
 */
export function aColumnaDecimal(valor: EntradaDecimal, tipo: TipoColumnaDecimal): string {
  switch (tipo) {
    case 'monto':
      return montoACadena(valor);
    case 'peso':
      return pesoACadena(valor);
    case 'cantidad':
      return cantidadACadena(valor);
    case 'exacto':
      return aCadena(valor);
    default:
      return aCadena(valor);
  }
}

/** Versión que acepta nulos, para columnas opcionales como `monto_real`. */
export function aColumnaDecimalNulable(
  valor: EntradaDecimal | null | undefined,
  tipo: TipoColumnaDecimal,
): string | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  return aColumnaDecimal(valor, tipo);
}

/** Atajo para montos de dinero, que son la mayoría de las columnas. */
export function aColumnaMonto(valor: EntradaDecimal): string {
  return aColumnaDecimal(valor, 'monto');
}

/** Atajo para pesos. */
export function aColumnaPeso(valor: EntradaDecimal): string {
  return aColumnaDecimal(valor, 'peso');
}

/** Atajo para cantidades por unidad. */
export function aColumnaCantidad(valor: EntradaDecimal): string {
  return aColumnaDecimal(valor, 'cantidad');
}

/** Atajo para valores exactos sin redondear. */
export function aColumnaExacta(valor: EntradaDecimal): string {
  return aColumnaDecimal(valor, 'exacto');
}

// ---------------------------------------------------------------------------
// Lectura: TEXT -> Decimal
// ---------------------------------------------------------------------------

/**
 * Convierte el TEXT de una columna en un Decimal validado.
 *
 * Rechaza explícitamente cualquier cosa que no sea una cadena: si la base
 * devolviera un `number`, significaría que la columna se escribió saltándose
 * este módulo y el valor ya podría estar corrompido por punto flotante.
 * Preferimos que falle ruidosamente a que se imprima un recibo con un importe
 * que no cuadra.
 */
export function desdeColumnaDecimal(valor: unknown, columna: string): Decimal {
  if (typeof valor !== 'string') {
    throw new ErrorDeColumnaDecimal(
      'VALOR_NO_ES_TEXTO',
      columna,
      `La columna "${columna}" devolvió un ${typeof valor} en vez de texto. ` +
        'Un valor decimal guardado como número ya pasó por punto flotante y no es confiable.',
      valor,
    );
  }

  // Se usa la expresión regular directamente y no el predicado de tipo, para
  // que TypeScript no reduzca `valor` a `never` en la rama del error y se
  // pueda incluir el valor ofensivo en el mensaje.
  const texto: string = valor;
  if (!FORMATO_CANONICO.test(texto)) {
    throw new ErrorDeColumnaDecimal(
      'FORMATO_INVALIDO',
      columna,
      `La columna "${columna}" contiene "${texto}", que no es un decimal en forma canónica.`,
      texto,
    );
  }

  return decimal(texto);
}

/** Versión que acepta nulos, para columnas opcionales. */
export function desdeColumnaDecimalNulable(valor: unknown, columna: string): Decimal | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  return desdeColumnaDecimal(valor, columna);
}

// ---------------------------------------------------------------------------
// Booleanos
// ---------------------------------------------------------------------------
// SQLite no tiene tipo booleano: usa 0 y 1. La conversión también se centraliza
// aquí para que ningún repositorio invente la suya.

/** Convierte un booleano al INTEGER 0/1 que guarda SQLite. */
export function aColumnaBooleana(valor: boolean): number {
  return valor ? 1 : 0;
}

/** Convierte el INTEGER 0/1 de SQLite en un booleano. */
export function desdeColumnaBooleana(valor: unknown, columna: string): boolean {
  if (valor === 0 || valor === 1) {
    return valor === 1;
  }
  throw new ErrorDeColumnaDecimal(
    'FORMATO_INVALIDO',
    columna,
    `La columna booleana "${columna}" contiene ${String(valor)} en vez de 0 o 1.`,
    valor,
  );
}

/** Decimales con que se escribe cada tipo de columna, para la documentación. */
export const DECIMALES_POR_TIPO: Readonly<Record<Exclude<TipoColumnaDecimal, 'exacto'>, number>> = {
  monto: DECIMALES_MONTO,
  peso: DECIMALES_PESO,
  cantidad: DECIMALES_CANTIDAD,
};
