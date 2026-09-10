/**
 * Precio efectivo de un producto y descuento de la venta.
 *
 * SON DOS COSAS DISTINTAS, y confundirlas es el error que este archivo existe
 * para evitar:
 *
 *   · PRECIO ESPECIAL — por PRODUCTO, PRECONFIGURADO y con vigencia. Lo decide
 *     un administrador de antemano ("el maíz está a 10% durante la cosecha") y
 *     el cajero no interviene: se aplica solo. Vive en `precios_especiales`.
 *   · DESCUENTO DISCRECIONAL — sobre la VENTA COMPLETA, decidido EN EL MOMENTO
 *     por quien vende ("le hago un descuento a don Efraín"). Tiene tope por rol
 *     y, si se pasa, exige el PIN de un administrador. Vive en `ventas`.
 *
 * Un mismo ticket puede llevar los dos: cada línea a su precio especial, y
 * encima un descuento sobre el total. Se aplican en ese orden.
 *
 * Todo con Decimal, y REDONDEO ÚNICO AL FINAL: el precio efectivo se redondea
 * porque se guarda como `precio_unitario_snap` de dos decimales, pero los
 * subtotales y el total se calculan exactos y solo se redondean al final.
 */

import type Decimal from 'decimal.js';

import { CERO, esMayorQue, esNegativo, redondearMonto, restar, restarPorcentaje } from '@shared/money';
import { montoDelDescuento, totalConDescuento, type DescuentoPedido } from '@shared/descuento';
import type { PrecioEspecial, Rol } from '@main/database/repositories/entidades';

/** El precio que se le cobra hoy a un producto, y por qué. */
export interface PrecioEfectivo {
  /** El precio que se guarda como `precio_unitario_snap`. */
  readonly precio: Decimal;
  /** El precio de lista, para poder mostrar los dos. */
  readonly precioBase: Decimal;
  /** El precio especial que se aplicó, o `null` si se cobra el de lista. */
  readonly especialAplicado: PrecioEspecial | null;
}

/**
 * Calcula el precio efectivo de un producto a partir de sus precios especiales
 * vigentes.
 *
 * SI HAY VARIOS VIGENTES gana el MÁS RECIENTE por `vigente_desde`, que es el
 * orden en que los devuelve el repositorio. No se acumulan: dos promociones
 * encimadas darían un descuento que nadie configuró, y el cajero no tendría
 * cómo explicarle al cliente de dónde salió el precio.
 */
export function precioEfectivoDe(
  precioBase: Decimal,
  vigentes: readonly PrecioEspecial[],
): PrecioEfectivo {
  const especial = vigentes[0];

  if (especial === undefined) {
    return { precio: redondearMonto(precioBase), precioBase, especialAplicado: null };
  }

  const conDescuento =
    especial.tipo === 'porcentaje'
      ? restarPorcentaje(precioBase, especial.valor)
      : restar(precioBase, especial.valor);

  /*
    PISO EN CERO. No debería configurarse un descuento mayor que el precio
    —sería regalar el producto y encima devolver dinero—, pero si alguien lo
    hace, la venta NO se rompe: se cobra 0. La alternativa, dejar pasar un
    precio negativo, chocaría contra el CHECK de `precio_unitario_snap` y
    tumbaría la venta entera con el cliente enfrente, por un error de
    configuración que no cometió el cajero.
  */
  const piso = esNegativo(conDescuento) ? CERO : conDescuento;

  return {
    precio: redondearMonto(piso),
    precioBase,
    especialAplicado: especial,
  };
}

/** El tope de descuento discrecional de un rol. */
export interface TopeDeDescuento {
  readonly maximoPorcentaje: Decimal;
  readonly maximoMontoFijo: Decimal;
}

/** Si el descuento cabe en el tope del rol, y por cuánto se pasa si no. */
export interface VeredictoDeDescuento {
  readonly excede: boolean;
  /** El tope que aplica según el tipo de descuento pedido. */
  readonly tope: Decimal;
  /** Cuánto se pasa del tope. Cero si no se pasa. */
  readonly exceso: Decimal;
}

/**
 * ¿El descuento pedido cabe dentro del tope del rol?
 *
 * El tope que aplica depende del TIPO: un descuento en porcentaje se compara
 * contra `descuento_max_porcentaje` y uno en quetzales contra
 * `descuento_max_monto_fijo`. Son dos topes independientes y no se convierten
 * entre sí: convertir uno en el otro exigiría conocer el total de la venta y
 * haría que el mismo porcentaje pasara o no según lo que llevara el cliente.
 */
export function evaluarDescuento(
  pedido: DescuentoPedido,
  tope: TopeDeDescuento,
): VeredictoDeDescuento {
  const limite = pedido.tipo === 'porcentaje' ? tope.maximoPorcentaje : tope.maximoMontoFijo;
  const excede = esMayorQue(pedido.valor, limite);

  return {
    excede,
    tope: limite,
    exceso: excede ? restar(pedido.valor, limite) : CERO,
  };
}

/*
  `montoDelDescuento` y `totalConDescuento` viven en `@shared/descuento` y se
  reexportan desde acá. Las necesita también la pantalla, para mostrar cuánto
  rebaja el descuento antes de cobrar, y una segunda implementación sería un
  segundo criterio: el cliente pagaría un total distinto del que vio.
*/
export { montoDelDescuento, totalConDescuento };
export type { DescuentoPedido };

/** El tope de un rol, con cero como valor por omisión si no hay fila. */
export function topeDelRol(
  limite: { readonly descuentoMaxPorcentaje: Decimal; readonly descuentoMaxMontoFijo: Decimal } | null,
  _rol: Rol,
): TopeDeDescuento {
  // Sin fila configurada, el tope es cero: ese rol no puede dar descuento sin
  // autorización. Es el valor seguro; suponer un tope generoso convertiría un
  // olvido de configuración en un permiso.
  if (limite === null) {
    return { maximoPorcentaje: CERO, maximoMontoFijo: CERO };
  }
  return {
    maximoPorcentaje: limite.descuentoMaxPorcentaje,
    maximoMontoFijo: limite.descuentoMaxMontoFijo,
  };
}
