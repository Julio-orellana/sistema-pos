/**
 * Descuento discrecional sobre la venta completa.
 *
 * VIVE EN `shared` A PROPÓSITO. Lo necesitan las dos capas: la pantalla, para
 * mostrarle al cajero cuánto rebaja el descuento antes de cobrar, y el proceso
 * principal, para calcular el total que de verdad se guarda. Escribirlo dos
 * veces —una en cada lado— crearía dos criterios que tarde o temprano
 * discrepan, y el cliente pagaría un total distinto del que vio en pantalla.
 *
 * Lo que NO vive acá es la autorización: el tope por rol y el PIN del
 * administrador se resuelven solo en el proceso principal, porque una
 * validación que viviera en la ventana se saltaría llamando al canal.
 *
 * NO CONFUNDIR con el precio especial, que es por PRODUCTO, preconfigurado y
 * con vigencia. Este es sobre la VENTA COMPLETA y lo decide quien vende en el
 * momento. Un mismo ticket puede llevar los dos, en ese orden.
 */

import type Decimal from 'decimal.js';

import { CERO, maximo, porcentajeDe, redondearMonto, restar } from './money';

/** Porcentaje o quetzales. Es la misma unión que `TipoValor` del dominio. */
export type TipoDeDescuento = 'porcentaje' | 'monto_fijo';

/** Un descuento pedido por quien vende. */
export interface DescuentoPedido {
  readonly tipo: TipoDeDescuento;
  readonly valor: Decimal;
}

/**
 * Cuánto dinero rebaja un descuento sobre un subtotal.
 *
 * NO SE REDONDEA ACÁ: el resultado se resta del subtotal exacto y el redondeo
 * ocurre una sola vez, sobre el total. Redondear el descuento por separado
 * dejaría un centavo de diferencia entre lo que dice el ticket y lo que suma
 * el corte de caja.
 */
export function montoDelDescuento(subtotal: Decimal, pedido: DescuentoPedido): Decimal {
  if (pedido.tipo === 'porcentaje') {
    return porcentajeDe(subtotal, pedido.valor);
  }
  return pedido.valor;
}

/**
 * El total: subtotal exacto menos el descuento, redondeado UNA sola vez.
 *
 * CON PISO EN CERO. Un descuento de monto fijo mayor que la venta daría un
 * total negativo, y la tienda no le devuelve dinero a nadie por comprar. El
 * módulo de devoluciones, cuando exista, tendrá su propio camino y sus propias
 * reglas: por eso `ventas.total` acepta negativos en el esquema (§4.2) aunque
 * esta función nunca los produzca.
 */
export function totalConDescuento(
  subtotalExacto: Decimal,
  pedido: DescuentoPedido | null,
): Decimal {
  if (pedido === null) {
    return redondearMonto(subtotalExacto);
  }
  const rebajado = restar(subtotalExacto, montoDelDescuento(subtotalExacto, pedido));
  return redondearMonto(maximo(rebajado, CERO));
}
