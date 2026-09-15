/**
 * money.ts — Aritmética exacta de dinero, peso y cantidad.
 *
 * REGLA INVIOLABLE DEL PROYECTO: ningún cálculo financiero ni de cantidad usa
 * aritmética nativa de punto flotante de JavaScript. Todo pasa por Decimal.js.
 *
 * El motivo es concreto y auditable: en JavaScript `0.1 + 0.2` da
 * 0.30000000000000004. En una venta a granel donde se pesa maíz tres veces y
 * se aplica un descuento, ese error se acumula y el corte de caja no cuadra.
 * Con Decimal.js el resultado es exactamente 0.3 y el corte cuadra al centavo.
 *
 * Convención de nombres: las operaciones de este módulo llevan nombre en
 * español porque son vocabulario financiero del proyecto (el auditor lee
 * `sumar`, `redondearMonto`, `porcentajeDe` sin traducir mentalmente).
 *
 * Convención de almacenamiento: los montos viajan y se guardan como CADENA
 * ("125.50"), nunca como `number`. Un `number` de JavaScript no puede
 * representar exactamente todos los decimales; una cadena sí. Convertir a
 * `number` se permite únicamente para mostrar en pantalla o graficar.
 *
 * ==========================================================================
 * POLÍTICA DE REDONDEO DEL SISTEMA: "REDONDEO ÚNICO AL FINAL"
 * ==========================================================================
 * Es la regla real y vinculante de todo el POS, no solo de un caso de prueba.
 * Se enuncia así:
 *
 *   Toda la cadena de cálculo se mantiene EXACTA, con la precisión completa de
 *   Decimal.js. El redondeo ocurre UNA SOLA VEZ, en el punto de salida: cuando
 *   el valor se persiste, se muestra en pantalla o se imprime en un
 *   comprobante. Nunca se redondea un resultado intermedio.
 *
 * Consecuencias, y cómo se refleja en este archivo:
 *
 *   - Las operaciones aritméticas y de porcentaje NO redondean:
 *     `sumar`, `sumarLista`, `restar`, `multiplicar`, `dividir`, `negar`,
 *     `absoluto`, `porcentajeDe`, `restarPorcentaje`,
 *     `porcentajeQueRepresenta`, `minimo`, `maximo`, `limitarARango`,
 *     `aCadena`.
 *   - Redondean SOLO las funciones de salida, y por eso llevan el redondeo en
 *     el nombre o son de presentación/persistencia:
 *     `redondearA`, `redondearMonto`, `redondearPeso`, `redondearCantidad`,
 *     `montoACadena`, `pesoACadena`, `cantidadACadena`, `formatearQuetzales`,
 *     `formatearPeso`.
 *   - EXCEPCIONES CONTROLADAS: `repartirMonto` y `conciliarSubtotalesConTotal`.
 *     Ambas redondean porque un centavo no se puede partir, y ambas están
 *     acotadas por la misma garantía verificable: la suma de las partes es
 *     exactamente el total redondeado, nunca un centavo más ni uno menos.
 *
 * ==========================================================================
 * POLÍTICA DEL COMPROBANTE IMPRESO: "EL TOTAL MANDA"
 * ==========================================================================
 * De la política anterior se desprende un problema visible en el papel: si
 * cada línea se imprime redondeada por su cuenta, la suma de las líneas
 * impresas puede diferir en uno o más centavos del total impreso. Con tres
 * líneas de 3.345, 10.275 y 3.175 el total correcto es Q16.80, pero las líneas
 * redondeadas suman Q16.81. Un recibo así no se puede defender en una
 * auditoría ni explicar en el mostrador.
 *
 * La regla es:
 *
 *   El TOTAL manda. Se calcula exacto y se redondea una sola vez: eso es lo
 *   que el cliente paga. Los importes de línea que se IMPRIMEN se derivan de
 *   ese total, de modo que sumen exactamente el total impreso.
 *
 * El reparto usa el método del residuo mayor, el mismo de `repartirMonto`, y
 * garantiza que cada línea impresa sea el piso o el techo en centavos de su
 * propio valor exacto: nunca se desvía más de un centavo, y el centavo se
 * coloca en las líneas que estaban más cerca de subir.
 *
 * REGLA DE DESEMPATE: cuando dos o más líneas tienen exactamente el mismo
 * residuo —el caso de las tres pesadas iguales, donde las tres quedan en medio
 * centavo—, el centavo se le da a la línea que aparece PRIMERO en el
 * comprobante. Dicho al revés: la que se queda sin el centavo es la ÚLTIMA de
 * las empatadas. El criterio es la posición en el comprobante, no el monto de
 * la línea ni el nombre del producto.
 *
 * Se descartaron dos alternativas comunes: "que la diferencia la absorba la
 * última línea" y "que la absorba la línea de mayor monto". Ambas concentran
 * TODO el residuo en una sola línea, que con muchas líneas puede desviarse
 * varios centavos de su valor real y verse como un error de captura. Con diez
 * pesadas de Q0.335, la última línea tendría que imprimir Q0.29 en lugar de
 * Q0.34; con el residuo mayor, cinco líneas imprimen Q0.34 y cinco Q0.33, y
 * ninguna se desvía más de medio centavo.
 *
 * Por qué esta política y no "redondear cada línea": tres pesadas de 0.5 lb a
 * Q0.67/lb valen Q0.335 cada una. Redondeando al final el total es Q1.01;
 * redondeando línea por línea da Q1.02. El primero es el importe correcto y el
 * segundo le cobra de más al cliente. La política está verificada por el grupo
 * de pruebas "Política de redondeo del sistema" en money.test.ts, que falla si
 * alguien agrega un redondeo intermedio a cualquiera de las funciones de
 * cálculo.
 *
 * El MODO de redondeo, cuando se aplica, es siempre HALF_UP (ver MODO_REDONDEO).
 */

import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Configuración global de Decimal.js
// ---------------------------------------------------------------------------

/** Dígitos significativos internos. Muy por encima de lo que un POS necesita,
 *  para que ninguna división intermedia pierda información antes de redondear. */
const PRECISION_INTERNA = 34;

/** Umbral de notación exponencial negativa: evita que Decimal imprima "1e-7"
 *  en un recibo. Con -9 cualquier monto realista se imprime en notación normal. */
const LIMITE_EXPONENTE_NEGATIVO = -9;

/** Umbral de notación exponencial positiva. */
const LIMITE_EXPONENTE_POSITIVO = 21;

Decimal.set({
  precision: PRECISION_INTERNA,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: LIMITE_EXPONENTE_NEGATIVO,
  toExpPos: LIMITE_EXPONENTE_POSITIVO,
});

// ---------------------------------------------------------------------------
// Constantes del dominio monetario
// ---------------------------------------------------------------------------

/** Decimales de un monto en quetzales. Guatemala usa dos (centavos). */
export const DECIMALES_MONTO = 2;

/** Decimales de un peso (libras). Tres permite registrar fracciones finas de
 *  libra al pesar granel sin arrastrar error al precio. */
export const DECIMALES_PESO = 3;

/** Decimales de una cantidad por unidad (bolsas, sacos, unidades sueltas). */
export const DECIMALES_CANTIDAD = 3;

/** Base de los cálculos porcentuales (un porcentaje es sobre 100). */
export const BASE_PORCENTAJE = 100;

/** Código ISO de la moneda del cliente. */
export const MONEDA_CODIGO = 'GTQ';

/** Símbolo que se imprime en recibos y pantalla. */
export const MONEDA_SIMBOLO = 'Q';

/** Separador de miles usado en Guatemala. */
const SEPARADOR_MILES = ',';

/** Separador decimal usado en Guatemala. */
const SEPARADOR_DECIMAL = '.';

/** Cantidad de dígitos por grupo de miles. */
const DIGITOS_POR_GRUPO = 3;

/** Base del sistema decimal, usada para calcular la unidad mínima de reparto. */
const BASE_DECIMAL = 10;

/**
 * Modo de redondeo del sistema: HALF_UP ("medio hacia arriba").
 * Se eligió porque es el redondeo comercial que el cliente y cualquier
 * auditor esperan: 0.125 -> 0.13. No se usa el redondeo bancario
 * (HALF_EVEN) porque produce resultados que un cajero no puede explicarle
 * a un comprador parado frente al mostrador.
 */
export const MODO_REDONDEO = Decimal.ROUND_HALF_UP;

/** Cero canónico, para comparar sin construir instancias repetidas. */
export const CERO: Decimal = new Decimal(0);

/**
 * Valor aceptado como entrada de cualquier operación de este módulo.
 * Se admite `number` por comodidad al escribir pruebas y valores literales,
 * pero los datos que vienen de la base de datos o de la red SIEMPRE deben
 * llegar como cadena.
 */
export type EntradaDecimal = string | number | Decimal;

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/** Códigos de error que puede lanzar este módulo. */
export type CodigoErrorDeMonto =
  | 'VALOR_NO_NUMERICO'
  | 'VALOR_NO_FINITO'
  | 'DIVISION_ENTRE_CERO'
  | 'DECIMALES_INVALIDOS'
  | 'REPARTO_INVALIDO'
  | 'CONCILIACION_INVALIDA'
  | 'CONCILIACION_INCONSISTENTE';

/**
 * Error de aritmética monetaria. Se usa una clase propia (en vez de `Error`
 * genérico) para que las capas superiores puedan distinguir un dato corrupto
 * de un fallo de programación y mostrar un mensaje útil al cajero.
 */
export class ErrorDeMonto extends Error {
  public readonly codigo: CodigoErrorDeMonto;
  public readonly valorRecibido: unknown;

  public constructor(codigo: CodigoErrorDeMonto, mensaje: string, valorRecibido?: unknown) {
    super(mensaje);
    this.name = 'ErrorDeMonto';
    this.codigo = codigo;
    this.valorRecibido = valorRecibido;
  }
}

// ---------------------------------------------------------------------------
// Construcción y validación
// ---------------------------------------------------------------------------

/**
 * Convierte cualquier entrada aceptada en un Decimal validado.
 *
 * Rechaza explícitamente NaN e Infinity: un monto no finito significa que
 * algo se corrompió aguas arriba (una celda vacía, una resta mal hecha), y es
 * preferible que la venta falle de forma ruidosa a que se imprima un recibo
 * con "NaN" o que se guarde basura en la base de datos.
 */
export function decimal(valor: EntradaDecimal): Decimal {
  if (valor instanceof Decimal) {
    if (!valor.isFinite()) {
      throw new ErrorDeMonto('VALOR_NO_FINITO', 'El valor decimal no es finito.', valor.toString());
    }
    return valor;
  }

  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      throw new ErrorDeMonto('VALOR_NO_FINITO', `El número recibido no es finito: ${String(valor)}`, valor);
    }
    return new Decimal(valor);
  }

  const texto = valor.trim();
  if (texto.length === 0) {
    throw new ErrorDeMonto('VALOR_NO_NUMERICO', 'Se recibió una cadena vacía donde se esperaba un monto.', valor);
  }

  let construido: Decimal;
  try {
    construido = new Decimal(texto);
  } catch {
    throw new ErrorDeMonto('VALOR_NO_NUMERICO', `La cadena "${valor}" no representa un número válido.`, valor);
  }

  if (!construido.isFinite()) {
    throw new ErrorDeMonto('VALOR_NO_FINITO', `La cadena "${valor}" no representa un número finito.`, valor);
  }
  return construido;
}

/** Indica si un valor puede convertirse en monto sin lanzar error. */
export function esEntradaDecimalValida(valor: unknown): valor is EntradaDecimal {
  if (typeof valor !== 'string' && typeof valor !== 'number' && !(valor instanceof Decimal)) {
    return false;
  }
  try {
    decimal(valor);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Operaciones aritméticas
// ---------------------------------------------------------------------------

/** Suma dos o más valores con precisión exacta. */
export function sumar(...valores: readonly EntradaDecimal[]): Decimal {
  return valores.reduce<Decimal>((acumulado, actual) => acumulado.plus(decimal(actual)), CERO);
}

/** Suma una lista de valores (equivalente a `sumar` pero recibiendo un arreglo). */
export function sumarLista(valores: readonly EntradaDecimal[]): Decimal {
  return sumar(...valores);
}

/** Resta al primer valor todos los siguientes. */
export function restar(minuendo: EntradaDecimal, ...sustraendos: readonly EntradaDecimal[]): Decimal {
  return sustraendos.reduce<Decimal>((acumulado, actual) => acumulado.minus(decimal(actual)), decimal(minuendo));
}

/** Multiplica dos o más valores (ej. peso en libras × precio por libra). */
export function multiplicar(...valores: readonly EntradaDecimal[]): Decimal {
  if (valores.length === 0) {
    return CERO;
  }
  return valores.reduce<Decimal>((acumulado, actual) => acumulado.times(decimal(actual)), new Decimal(1));
}

/**
 * Divide dos valores. Lanza `ErrorDeMonto` si el divisor es cero en vez de
 * devolver Infinity, porque en un POS una división entre cero siempre indica
 * un dato faltante (por ejemplo un producto con precio 0).
 */
export function dividir(dividendo: EntradaDecimal, divisor: EntradaDecimal): Decimal {
  const divisorDecimal = decimal(divisor);
  if (divisorDecimal.isZero()) {
    throw new ErrorDeMonto('DIVISION_ENTRE_CERO', 'No se puede dividir entre cero.', divisor);
  }
  return decimal(dividendo).dividedBy(divisorDecimal);
}

/** Devuelve el valor con el signo invertido. */
export function negar(valor: EntradaDecimal): Decimal {
  return decimal(valor).negated();
}

/** Devuelve el valor absoluto. */
export function absoluto(valor: EntradaDecimal): Decimal {
  return decimal(valor).absoluteValue();
}

// ---------------------------------------------------------------------------
// Redondeo
// ---------------------------------------------------------------------------

/**
 * Redondea a una cantidad arbitraria de decimales con el modo del sistema.
 * Es la primitiva sobre la que se construyen `redondearMonto` y `redondearPeso`.
 */
export function redondearA(
  valor: EntradaDecimal,
  decimales: number,
  modo: Decimal.Rounding = MODO_REDONDEO,
): Decimal {
  if (!Number.isInteger(decimales) || decimales < 0) {
    throw new ErrorDeMonto(
      'DECIMALES_INVALIDOS',
      `La cantidad de decimales debe ser un entero no negativo; se recibió ${String(decimales)}.`,
      decimales,
    );
  }
  return decimal(valor).toDecimalPlaces(decimales, modo);
}

/** Redondea a centavos (2 decimales). Todo monto que se cobra, se imprime o
 *  se guarda como total debe pasar por aquí. */
export function redondearMonto(valor: EntradaDecimal): Decimal {
  return redondearA(valor, DECIMALES_MONTO);
}

/** Redondea un peso en libras (3 decimales). */
export function redondearPeso(valor: EntradaDecimal): Decimal {
  return redondearA(valor, DECIMALES_PESO);
}

/** Redondea una cantidad por unidad (3 decimales). */
export function redondearCantidad(valor: EntradaDecimal): Decimal {
  return redondearA(valor, DECIMALES_CANTIDAD);
}

// ---------------------------------------------------------------------------
// Porcentajes
// ---------------------------------------------------------------------------

/**
 * Calcula el `porcentaje` % de `base`, SIN redondear.
 *
 * No redondea a propósito: cuando se aplican varios porcentajes en cadena
 * (descuento de línea y luego descuento global), redondear en cada paso
 * introduce un error que el auditor ve como "descuadre de un centavo".
 * El redondeo se hace una sola vez, al final, con `redondearMonto`.
 */
export function porcentajeDe(base: EntradaDecimal, porcentaje: EntradaDecimal): Decimal {
  return decimal(base).times(decimal(porcentaje)).dividedBy(BASE_PORCENTAJE);
}

/** Devuelve la base menos el porcentaje indicado (sin redondear, ver arriba). */
export function restarPorcentaje(base: EntradaDecimal, porcentaje: EntradaDecimal): Decimal {
  return decimal(base).minus(porcentajeDe(base, porcentaje));
}

/**
 * Qué porcentaje representa `parte` respecto de `total`.
 * Útil para mostrarle al administrador el descuento efectivo de una venta.
 */
export function porcentajeQueRepresenta(parte: EntradaDecimal, total: EntradaDecimal): Decimal {
  return dividir(decimal(parte).times(BASE_PORCENTAJE), total);
}

// ---------------------------------------------------------------------------
// Comparaciones
// ---------------------------------------------------------------------------

/** Devuelve -1, 0 o 1 según `a` sea menor, igual o mayor que `b`. */
export function comparar(a: EntradaDecimal, b: EntradaDecimal): number {
  return decimal(a).comparedTo(decimal(b));
}

/** ¿Los dos valores son numéricamente iguales? ("1.10" es igual a "1.1"). */
export function esIgual(a: EntradaDecimal, b: EntradaDecimal): boolean {
  return decimal(a).equals(decimal(b));
}

/** ¿`a` es estrictamente mayor que `b`? */
export function esMayorQue(a: EntradaDecimal, b: EntradaDecimal): boolean {
  return decimal(a).greaterThan(decimal(b));
}

/** ¿`a` es mayor o igual que `b`? */
export function esMayorOIgualQue(a: EntradaDecimal, b: EntradaDecimal): boolean {
  return decimal(a).greaterThanOrEqualTo(decimal(b));
}

/** ¿`a` es estrictamente menor que `b`? */
export function esMenorQue(a: EntradaDecimal, b: EntradaDecimal): boolean {
  return decimal(a).lessThan(decimal(b));
}

/** ¿`a` es menor o igual que `b`? */
export function esMenorOIgualQue(a: EntradaDecimal, b: EntradaDecimal): boolean {
  return decimal(a).lessThanOrEqualTo(decimal(b));
}

/** ¿El valor es exactamente cero? */
export function esCero(valor: EntradaDecimal): boolean {
  return decimal(valor).isZero();
}

/** ¿El valor es mayor que cero? */
export function esPositivo(valor: EntradaDecimal): boolean {
  return decimal(valor).greaterThan(CERO);
}

/** ¿El valor es menor que cero? */
export function esNegativo(valor: EntradaDecimal): boolean {
  return decimal(valor).lessThan(CERO);
}

/** El menor de una lista de valores. */
export function minimo(...valores: readonly EntradaDecimal[]): Decimal {
  return valores.map(decimal).reduce((menor, actual) => (actual.lessThan(menor) ? actual : menor));
}

/** El mayor de una lista de valores. */
export function maximo(...valores: readonly EntradaDecimal[]): Decimal {
  return valores.map(decimal).reduce((mayor, actual) => (actual.greaterThan(mayor) ? actual : mayor));
}

/** Restringe un valor al rango [minimo, maximo]. */
export function limitarARango(valor: EntradaDecimal, valorMinimo: EntradaDecimal, valorMaximo: EntradaDecimal): Decimal {
  return minimo(maximo(valor, valorMinimo), valorMaximo);
}

// ---------------------------------------------------------------------------
// Reparto proporcional
// ---------------------------------------------------------------------------

/**
 * Reparte un monto total entre varias líneas de forma proporcional a las
 * ponderaciones dadas, garantizando que la suma de las partes sea EXACTAMENTE
 * el total (método del residuo mayor).
 *
 * Por qué existe: cuando se aplica un descuento global de Q10 a una venta con
 * tres productos, hay que prorratearlo entre las tres líneas. El reparto
 * ingenuo (redondear cada parte por separado) casi siempre deja uno o dos
 * centavos sueltos y el total impreso no coincide con la suma de las líneas.
 * Aquí los centavos sobrantes se asignan a las líneas cuyo residuo fue mayor,
 * que es el criterio estándar y explicable en una auditoría.
 */
export function repartirMonto(
  total: EntradaDecimal,
  ponderaciones: readonly EntradaDecimal[],
  decimales: number = DECIMALES_MONTO,
): Decimal[] {
  if (ponderaciones.length === 0) {
    throw new ErrorDeMonto('REPARTO_INVALIDO', 'No se puede repartir un monto sin ponderaciones.', ponderaciones);
  }

  const totalDecimal = decimal(total);
  const pesos = ponderaciones.map(decimal);
  if (pesos.some((peso) => peso.isNegative())) {
    throw new ErrorDeMonto('REPARTO_INVALIDO', 'Las ponderaciones del reparto no pueden ser negativas.', ponderaciones);
  }

  const sumaPesos = pesos.reduce<Decimal>((acumulado, peso) => acumulado.plus(peso), CERO);
  if (sumaPesos.isZero()) {
    throw new ErrorDeMonto(
      'REPARTO_INVALIDO',
      'La suma de las ponderaciones es cero: no hay forma de repartir proporcionalmente.',
      ponderaciones,
    );
  }

  // Parte exacta (sin redondear) y parte truncada hacia abajo de cada línea.
  const partesExactas = pesos.map((peso) => totalDecimal.times(peso).dividedBy(sumaPesos));
  const partesTruncadas = partesExactas.map((parte) => parte.toDecimalPlaces(decimales, Decimal.ROUND_DOWN));

  const sumaTruncada = partesTruncadas.reduce<Decimal>((acumulado, parte) => acumulado.plus(parte), CERO);
  const unidadMinima = new Decimal(1).dividedBy(new Decimal(BASE_DECIMAL).pow(decimales));

  // Cuántas unidades mínimas (centavos) faltan por repartir tras truncar.
  const faltante = totalDecimal.toDecimalPlaces(decimales, MODO_REDONDEO).minus(sumaTruncada);
  const unidadesPendientes = faltante.dividedBy(unidadMinima).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  // Orden de prioridad: residuo mayor primero; a igual residuo, el índice menor
  // (la misma regla de desempate que `conciliarSubtotalesConTotal`). El
  // comparador define un orden total, así que el reparto es determinista y no
  // depende de la estabilidad del `sort` del motor.
  const ordenPorResiduo = partesExactas
    .map((parteExacta, indice) => ({
      indice,
      residuo: parteExacta.minus(partesTruncadas[indice] ?? CERO),
    }))
    .sort((a, b) => {
      const comparacion = b.residuo.comparedTo(a.residuo);
      return comparacion === 0 ? a.indice - b.indice : comparacion;
    });

  const resultado = [...partesTruncadas];
  const totalLineas = resultado.length;
  for (let repartidas = 0; repartidas < Math.abs(unidadesPendientes); repartidas += 1) {
    const objetivo = ordenPorResiduo[repartidas % totalLineas];
    if (objetivo === undefined) {
      break;
    }
    const parteActual = resultado[objetivo.indice] ?? CERO;
    resultado[objetivo.indice] =
      unidadesPendientes > 0 ? parteActual.plus(unidadMinima) : parteActual.minus(unidadMinima);
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Conciliación de un comprobante impreso
// ---------------------------------------------------------------------------

/** Resultado de conciliar las líneas de un comprobante con su total. */
export interface SubtotalesConciliados {
  /** Importes que se IMPRIMEN en cada línea, en el mismo orden que se recibieron. */
  readonly lineas: readonly Decimal[];
  /** Total que se IMPRIME. Es la suma exacta de `lineas`. */
  readonly total: Decimal;
  /** Suma exacta sin redondear, para la bitácora y la auditoría. */
  readonly totalExacto: Decimal;
  /** Cuántos centavos hubo que mover para que las líneas cuadraran con el total. */
  readonly centavosReconciliados: number;
}

/**
 * Concilia los importes de línea de un comprobante con su total impreso.
 *
 * Resuelve el problema descrito en la sección "POLÍTICA DEL COMPROBANTE
 * IMPRESO" del encabezado: que la suma de las líneas tal como se imprimen sea
 * SIEMPRE, centavo por centavo, el total impreso.
 *
 * Garantías, todas verificadas en las pruebas:
 *   1. `sumarLista(lineas)` es exactamente igual a `total`.
 *   2. `total` es el valor exacto de la venta redondeado una sola vez, así que
 *      el cliente paga el importe correcto.
 *   3. Cada línea impresa es el piso o el techo en centavos de su propio valor
 *      exacto: jamás se desvía más de un centavo de lo que realmente vale.
 *   4. Es DETERMINISTA: las mismas líneas, en el mismo orden, reparten siempre
 *      el mismo centavo en la misma línea. Ver la regla de desempate abajo.
 *
 * @param subtotalesExactos Valor EXACTO de cada línea, sin redondear.
 * @param decimales Decimales del comprobante; por omisión, centavos.
 */
export function conciliarSubtotalesConTotal(
  subtotalesExactos: readonly EntradaDecimal[],
  decimales: number = DECIMALES_MONTO,
): SubtotalesConciliados {
  if (subtotalesExactos.length === 0) {
    throw new ErrorDeMonto(
      'CONCILIACION_INVALIDA',
      'No se puede conciliar un comprobante sin líneas.',
      subtotalesExactos,
    );
  }

  const exactos = subtotalesExactos.map(decimal);
  const totalExacto = exactos.reduce<Decimal>((acumulado, valor) => acumulado.plus(valor), CERO);
  const total = redondearA(totalExacto, decimales);
  const unidadMinima = new Decimal(1).dividedBy(new Decimal(BASE_DECIMAL).pow(decimales));

  // Piso de cada línea: el mayor múltiplo de un centavo que no la supera. Se
  // usa ROUND_FLOOR y no ROUND_DOWN para que la garantía "piso o techo" valga
  // igual con importes negativos, como los de una devolución.
  const pisos = exactos.map((valor) => valor.toDecimalPlaces(decimales, Decimal.ROUND_FLOOR));
  const sumaDePisos = pisos.reduce<Decimal>((acumulado, piso) => acumulado.plus(piso), CERO);

  // Centavos que faltan repartir. Por construcción está entre 0 y la cantidad
  // de líneas, así que ninguna línea recibe más de un centavo.
  const centavosReconciliados = total
    .minus(sumaDePisos)
    .dividedBy(unidadMinima)
    .toDecimalPlaces(0, MODO_REDONDEO)
    .toNumber();

  // Prioridad: la línea cuyo residuo estaba más cerca de subir; a igual
  // residuo, la que viene PRIMERO en el comprobante (índice menor). La última
  // de las líneas empatadas es la que se queda sin el centavo.
  //
  // El comparador nunca devuelve 0 para dos líneas distintas, porque el índice
  // las desempata siempre. Eso define un orden total y hace que el resultado
  // NO dependa de si el `sort` del motor de JavaScript es estable: la misma
  // venta, en el mismo orden, reparte siempre el centavo en la misma línea.
  const ordenPorResiduo = exactos
    .map((valor, indice) => ({ indice, residuo: valor.minus(pisos[indice] ?? CERO) }))
    .sort((a, b) => {
      const comparacion = b.residuo.comparedTo(a.residuo);
      return comparacion === 0 ? a.indice - b.indice : comparacion;
    });

  const lineas = [...pisos];
  for (let repartidos = 0; repartidos < centavosReconciliados; repartidos += 1) {
    const objetivo = ordenPorResiduo[repartidos];
    if (objetivo === undefined) {
      break;
    }
    lineas[objetivo.indice] = (lineas[objetivo.indice] ?? CERO).plus(unidadMinima);
  }

  // Autocomprobación: si alguna vez esto fallara, imprimir el comprobante sería
  // peor que negarse a hacerlo. Es la garantía número 1 verificada en caliente.
  const sumaImpresa = lineas.reduce<Decimal>((acumulado, linea) => acumulado.plus(linea), CERO);
  if (!sumaImpresa.equals(total)) {
    throw new ErrorDeMonto(
      'CONCILIACION_INCONSISTENTE',
      `Las líneas del comprobante suman ${sumaImpresa.toFixed(decimales)} pero el total es ${total.toFixed(decimales)}.`,
      { lineas: lineas.map((linea) => linea.toFixed(decimales)), total: total.toFixed(decimales) },
    );
  }

  return { lineas, total, totalExacto, centavosReconciliados };
}

// ---------------------------------------------------------------------------
// Serialización y formato
// ---------------------------------------------------------------------------

/**
 * Representación canónica en cadena, sin notación exponencial y sin decimales
 * de relleno. Es la forma en que los valores deben viajar por IPC.
 */
export function aCadena(valor: EntradaDecimal): string {
  return decimal(valor).toFixed();
}

/** Monto redondeado a centavos y expresado como cadena con 2 decimales fijos
 *  ("125.5" -> "125.50"). Es la forma en que se guarda en la base de datos. */
export function montoACadena(valor: EntradaDecimal): string {
  return redondearMonto(valor).toFixed(DECIMALES_MONTO);
}

/** Peso redondeado y expresado como cadena con 3 decimales fijos. */
export function pesoACadena(valor: EntradaDecimal): string {
  return redondearPeso(valor).toFixed(DECIMALES_PESO);
}

/** Cantidad redondeada y expresada como cadena con 3 decimales fijos. */
export function cantidadACadena(valor: EntradaDecimal): string {
  return redondearCantidad(valor).toFixed(DECIMALES_CANTIDAD);
}

/**
 * La cantidad como la lee una persona: sin ceros decorativos.
 *
 * «2» y no «2.000»; «0.5» y no «0.500». Es SOLO para mostrar: lo que se guarda
 * y lo que se compara sigue siendo la forma canónica de `cantidadACadena`, con
 * sus tres decimales exactos.
 *
 * Vive acá, y no dentro del recibo donde nació, porque la necesitan dos lugares
 * —el comprobante y los reportes— y dos implementaciones de «cómo se escribe
 * una cantidad» terminarían mostrando el mismo número de dos formas distintas
 * en el mismo sistema.
 */
export function cantidadLegible(valor: EntradaDecimal): string {
  const canonica = cantidadACadena(valor);
  if (!canonica.includes('.')) {
    return canonica;
  }
  return canonica.replace(/\.?0+$/, '');
}

/**
 * Conversión a `number`. USO EXCLUSIVO PARA PRESENTACIÓN (gráficas, anchos de
 * barra, componentes de UI que exigen number). Nunca para calcular ni para
 * guardar: al pasar por `number` se pierde la exactitud que da Decimal.js.
 */
export function aNumeroSoloParaMostrar(valor: EntradaDecimal): number {
  return decimal(valor).toNumber();
}

/**
 * Inserta separadores de miles en la parte entera de una cadena numérica.
 * Se hace por manipulación de texto y no con `Intl.NumberFormat` porque ese
 * API exige un `number`, y convertir a `number` es justamente lo que este
 * proyecto prohíbe en la ruta del dinero.
 */
function agruparMiles(parteEntera: string): string {
  const negativo = parteEntera.startsWith('-');
  const digitos = negativo ? parteEntera.slice(1) : parteEntera;

  const grupos: string[] = [];
  for (let fin = digitos.length; fin > 0; fin -= DIGITOS_POR_GRUPO) {
    const inicio = Math.max(0, fin - DIGITOS_POR_GRUPO);
    grupos.unshift(digitos.slice(inicio, fin));
  }

  const agrupado = grupos.join(SEPARADOR_MILES);
  return negativo ? `-${agrupado}` : agrupado;
}

/**
 * Formatea un monto para mostrarlo en pantalla o imprimirlo en un recibo:
 * "Q1,234.56". El signo negativo queda antes del símbolo ("-Q5.00") porque es
 * como el cliente lee las devoluciones.
 */
export function formatearQuetzales(valor: EntradaDecimal): string {
  const texto = montoACadena(valor);
  const negativo = texto.startsWith('-');
  const sinSigno = negativo ? texto.slice(1) : texto;
  const [parteEntera = '0', parteDecimal = ''] = sinSigno.split(SEPARADOR_DECIMAL);
  const cuerpo = `${MONEDA_SIMBOLO}${agruparMiles(parteEntera)}${SEPARADOR_DECIMAL}${parteDecimal}`;
  return negativo ? `-${cuerpo}` : cuerpo;
}

/**
 * Formatea un peso o cantidad con su unidad, quitando los ceros decimales
 * sobrantes: 5.500 lb -> "5.5 lb"; 3.000 lb -> "3 lb".
 */
export function formatearPeso(valor: EntradaDecimal, unidad: string): string {
  const redondeado = redondearPeso(valor);
  return `${redondeado.toFixed()} ${unidad}`.trim();
}
