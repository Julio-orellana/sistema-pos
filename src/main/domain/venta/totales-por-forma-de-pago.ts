/**
 * Cuánto entró, y cómo se pagó: la ÚNICA forma de partir un conjunto de ventas
 * en efectivo y tarjeta y sumarlo.
 *
 * ===========================================================================
 * POR QUÉ ESTO ES UNA FUNCIÓN Y NO DOS BLOQUES PARECIDOS
 * ===========================================================================
 *
 * Hasta el 2026-09-17 el reparto vivía suelto dentro de `resumenDeVentas`
 * (`servicio-de-reportes.ts:199-200`): dos `filter` por `formaPago` y tres
 * `sumarLista`. Cuando el historial de recibos necesitó exactamente lo mismo,
 * copiarlo habría dejado **dos lugares que contestan la misma pregunta y que
 * pueden empezar a contestarla distinto**: basta que uno excluya las ventas
 * anuladas y el otro no —o que uno redondee y el otro no— para que la tienda
 * tenga dos cifras de «lo que entró hoy» sin que nada falle.
 *
 * Es el mismo criterio con que `colision-de-pin.ts` vive en su propio módulo
 * (§4.7) y con que el nombre legible de una tabla vive una sola vez (§4.57).
 * Una prueba estructural comprueba que nadie vuelva a escribir el reparto por
 * su cuenta.
 *
 * ===========================================================================
 * LAS DOS REGLAS QUE ESTA FUNCIÓN SOSTIENE
 * ===========================================================================
 *
 * 1. **NO AGREGA EN SQL.** Recibe filas ya traídas y suma acá, con Decimal.js.
 *    `ventas.total` es TEXT canónico y `SUM()` de SQLite lo convertiría a REAL,
 *    que es exactamente el punto flotante que `money.ts` existe para eliminar
 *    (§4.15). Medido: 1.10 + 2.20 + 4.40 da `7.700000000000001` en punto
 *    flotante y `7.70` acá.
 *
 * 2. **EFECTIVO + TARJETA DA EXACTAMENTE EL GENERAL.** Cada venta aporta su
 *    total a uno solo de los dos montones y las tres sumas salen de los mismos
 *    valores guardados, así que no es una coincidencia aritmética: es una
 *    consecuencia de cómo se calcula. Hay una prueba que lo exige.
 *
 * ===========================================================================
 * QUÉ NO DECIDE
 * ===========================================================================
 *
 * **Qué ventas entran.** Esta función suma lo que le den. Excluir las anuladas
 * —que es lo que manda docs/ANULACION-DE-VENTA.md §1.3, y lo que hacen tanto
 * el reporte como el historial— es trabajo de quien llama, porque cada uno lo
 * consigue de una forma distinta: el reporte con `VENTA_SIN_ANULACION` en SQL,
 * el historial mirando la fila de anulación que ya cargó para dibujarla.
 */

import { montoACadena, sumarLista, type EntradaDecimal } from '@shared/money';
import type { FormaPago } from '@main/database/repositories/entidades';

/**
 * Lo mínimo que hace falta saber de una venta para totalizarla.
 *
 * `total` admite `EntradaDecimal` —la cadena canónica o el `Decimal`— a
 * propósito: el reporte tiene la entidad con su `Decimal`, y el historial tiene
 * la cadena que la pantalla ya está mostrando. Las dos son exactas y la
 * conversión entre ellas no pierde un dígito, así que obligar a una sola
 * habría forzado una conversión de ida y vuelta sin ganar nada.
 */
export interface VentaTotalizable {
  readonly formaPago: FormaPago;
  readonly total: EntradaDecimal;
}

/** El reparto ya sumado, con los montos como cadena canónica. */
export interface TotalesPorFormaDePago {
  readonly enEfectivo: string;
  readonly enTarjeta: string;
  /** La suma de los dos anteriores, calculada sobre todas las ventas. */
  readonly general: string;
  readonly ventasEnEfectivo: number;
  readonly ventasEnTarjeta: number;
  readonly cantidadDeVentas: number;
}

/** Parte las ventas por forma de pago y suma cada montón con Decimal.js. */
export function totalesPorFormaDePago(
  ventas: readonly VentaTotalizable[],
): TotalesPorFormaDePago {
  const enEfectivo = ventas.filter((venta) => venta.formaPago === 'efectivo');
  const conTarjeta = ventas.filter((venta) => venta.formaPago === 'tarjeta');

  return {
    enEfectivo: montoACadena(sumarLista(enEfectivo.map((venta) => venta.total))),
    enTarjeta: montoACadena(sumarLista(conTarjeta.map((venta) => venta.total))),
    general: montoACadena(sumarLista(ventas.map((venta) => venta.total))),
    ventasEnEfectivo: enEfectivo.length,
    ventasEnTarjeta: conTarjeta.length,
    cantidadDeVentas: ventas.length,
  };
}
