/**
 * El precio de UNA línea de venta: el menor de los que aplican.
 *
 * Es la regla de la spec 002 (`spec/features/002-precio-mayorista/`), en una
 * frase: **el precio de una línea es el MENOR entre el precio de lista vigente,
 * el precio especial vigente (si hay uno) y el precio mayorista (si la cantidad
 * de ESA línea llega a la cantidad mínima).**
 *
 * VIVE EN `shared` A PROPÓSITO, con el mismo argumento que `@shared/descuento`.
 * La usan las dos capas: el proceso principal, para decidir lo que se cobra y se
 * congela en `venta_detalle.precio_unitario_snap`; y la pantalla, para
 * recalcular el precio en vivo cada vez que cambia la cantidad. Escrita dos
 * veces, las dos copias tarde o temprano discrepan, y el cliente paga un precio
 * distinto del que vio.
 *
 * LO QUE NO VIVE ACÁ es la regla del precio especial —vigencia, el más reciente
 * gana, porcentaje o quetzales, piso en cero—, que sigue siendo `precioEfectivoDe`
 * del proceso principal. Acá llega su RESULTADO, como un candidato más.
 *
 * El precio de lista participa SIEMPRE, como piso de seguridad: un precio
 * mayorista que haya quedado más caro que el de lista nunca se cobra. Quitarlo
 * de la lista de candidatos es la falsificación que tiene que hacer caer la
 * prueba del caso de seguridad.
 */

import type Decimal from 'decimal.js';

import { decimal, esMayorOIgualQue, esMenorQue, type EntradaDecimal } from './money';

/** De dónde salió el precio que se cobra. Es lo que la línea muestra como marca. */
export type OrigenDelPrecio = 'lista' | 'especial' | 'mayorista';

/** El precio mayorista de un producto: los dos datos van siempre juntos. */
export interface PrecioMayorista {
  /** Precio por unidad de medida del producto, a partir de la cantidad mínima. */
  readonly precio: EntradaDecimal;
  /** Desde cuánto aplica, en la unidad del producto (lb, kg o unidades). */
  readonly cantidadMinima: EntradaDecimal;
}

/** Los precios que pueden competir por una línea. */
export interface CandidatosDePrecio {
  /** Precio de lista vigente. Participa SIEMPRE: es el piso de seguridad. */
  readonly lista: EntradaDecimal;
  /**
   * El precio con el precio especial vigente YA APLICADO, o `null` si no hay
   * ninguno vigente. Lo calcula `precioEfectivoDe`; acá no se recalcula.
   */
  readonly especial: EntradaDecimal | null;
  /** La configuración mayorista del producto, o `null` si no tiene. */
  readonly mayorista: PrecioMayorista | null;
}

/** El precio elegido y por qué. */
export interface PrecioDeLinea {
  readonly precio: Decimal;
  readonly origen: OrigenDelPrecio;
}

/**
 * ¿La cantidad de la línea llega al precio mayorista?
 *
 * EL UMBRAL ES INCLUSIVO: con una cantidad mínima de 50 lb, 50.000 lb ya
 * califica y 49.999 lb no (spec P1). «A partir de 50 libras» incluye las 50.
 */
export function calificaParaMayorista(
  mayorista: PrecioMayorista | null,
  cantidad: EntradaDecimal,
): boolean {
  return mayorista !== null && esMayorOIgualQue(cantidad, mayorista.cantidadMinima);
}

/**
 * Elige el precio de una línea para una cantidad.
 *
 * Los candidatos se anotan EN EL ORDEN DEL EMPATE —especial, lista, mayorista—
 * y gana el primero de los menores (spec P5). Con el mismo precio, el cobro es
 * el mismo; el empate solo decide qué se muestra:
 *
 *   · Especial antes que lista: un precio especial vigente se marca siempre,
 *     aunque rebaje cero. Es el comportamiento de antes de la spec 002.
 *   · Lista antes que mayorista: el mayorista solo se marca cuando BAJA el
 *     precio. Si empata, no hizo nada.
 */
export function precioDeLinea(candidatos: CandidatosDePrecio, cantidad: EntradaDecimal): PrecioDeLinea {
  const enCompetencia: PrecioDeLinea[] = [];

  if (candidatos.especial !== null) {
    enCompetencia.push({ precio: decimal(candidatos.especial), origen: 'especial' });
  }
  // EL PISO DE SEGURIDAD. Está siempre en la competencia, con o sin especial.
  enCompetencia.push({ precio: decimal(candidatos.lista), origen: 'lista' });
  if (candidatos.mayorista !== null && calificaParaMayorista(candidatos.mayorista, cantidad)) {
    enCompetencia.push({ precio: decimal(candidatos.mayorista.precio), origen: 'mayorista' });
  }

  let elegido = enCompetencia[0];
  if (elegido === undefined) {
    // No puede pasar: la lista siempre está. Se comprueba igual porque un
    // `undefined` colado acá cobraría un precio que no existe.
    throw new Error('precioDeLinea: no hay ningún candidato de precio.');
  }
  for (const candidato of enCompetencia) {
    // Estrictamente menor: ante un empate se queda el que llegó primero.
    if (esMenorQue(candidato.precio, elegido.precio)) {
      elegido = candidato;
    }
  }
  return elegido;
}
