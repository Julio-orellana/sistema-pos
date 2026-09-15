/**
 * Lo que la pantalla necesita saber para armar un cobro, sin tocar el DOM.
 *
 * Está separado del componente para poder probarlo sin montar React: son las
 * reglas de qué se puede enviar y qué no, y esas se verifican mejor con
 * entradas y salidas que con clics.
 *
 * NINGUNA DE ESTAS REGLAS ES LA AUTORIDAD. Todas se vuelven a aplicar en el
 * proceso principal, y varias además en la base. Acá existen para avisar
 * mientras se escribe y no dejar mandar un cobro que ya se sabe inválido: es
 * la misma división de tres capas del catálogo (CLAUDE.md §4.11).
 */

import { decimal, esEntradaDecimalValida, redondearMonto } from '@shared/money';
import type { DescuentoPedido, TipoDeDescuento } from '@shared/descuento';
import type { FormaPagoIpc } from '@shared/types/ipc';

/** Lo que el cajero fue eligiendo en el diálogo de cobro. */
export interface BorradorDeCobro {
  /** `null` mientras no se pidió ningún descuento. */
  readonly tipoDeDescuento: TipoDeDescuento | null;
  /** Lo tecleado en el campo del descuento, tal cual. */
  readonly valorDeDescuento: string;
  readonly formaPago: FormaPagoIpc;
  /** Lo tecleado en el campo de la boleta, tal cual. */
  readonly numBoleta: string;
}

/** Un borrador recién abierto: sin descuento y en efectivo. */
export const COBRO_EN_BLANCO: BorradorDeCobro = {
  tipoDeDescuento: null,
  valorDeDescuento: '',
  formaPago: 'efectivo',
  numBoleta: '',
};

/** Hasta cuánto puede llegar un porcentaje de descuento. */
const PORCENTAJE_MAXIMO = 100;

/**
 * Qué está mal en el borrador, en un texto para mostrar. `null` si está bien.
 *
 * Devuelve UN solo problema, el primero, y no una lista: el diálogo tiene un
 * único renglón de aviso, y una lista de tres errores frente a un cliente que
 * espera se lee peor que arreglar uno por vez.
 */
export function problemaDelCobro(borrador: BorradorDeCobro): string | null {
  if (borrador.tipoDeDescuento !== null) {
    const valor = borrador.valorDeDescuento.trim();
    if (valor === '') {
      return 'Escribí cuánto es el descuento, o quitalo.';
    }
    if (!esEntradaDecimalValida(valor)) {
      return 'El descuento tiene que ser un número.';
    }
    const monto = decimal(valor);
    if (monto.isNegative()) {
      return 'El descuento no puede ser negativo.';
    }
    if (monto.isZero()) {
      return 'Un descuento de cero no cambia nada. Quitalo o poné un valor.';
    }
    if (borrador.tipoDeDescuento === 'porcentaje' && monto.greaterThan(PORCENTAJE_MAXIMO)) {
      return 'Un descuento no puede pasar del 100 %.';
    }
  }

  // La misma regla que aplica la base desde la migración 014. Acá se dice con
  // palabras que el cajero entiende, en vez de reventar con una restricción.
  if (borrador.formaPago === 'tarjeta' && borrador.numBoleta.trim() === '') {
    return 'Escribí el número de boleta del voucher.';
  }

  return null;
}

/** El descuento del borrador, listo para calcular. `null` si no hay ninguno. */
export function descuentoDelBorrador(borrador: BorradorDeCobro): DescuentoPedido | null {
  if (borrador.tipoDeDescuento === null) {
    return null;
  }
  const valor = borrador.valorDeDescuento.trim();
  if (valor === '' || !esEntradaDecimalValida(valor)) {
    return null;
  }
  return { tipo: borrador.tipoDeDescuento, valor: redondearMonto(valor) };
}

/**
 * El número de boleta que se manda: `null` en efectivo, siempre.
 *
 * Se limpia acá y no en el componente para que no quede un número escrito por
 * error antes de cambiar a efectivo: la base rechaza una venta en efectivo con
 * boleta, y sería un rechazo que el cajero no entendería.
 */
export function boletaDelBorrador(borrador: BorradorDeCobro): string | null {
  if (borrador.formaPago !== 'tarjeta') {
    return null;
  }
  const boleta = borrador.numBoleta.trim();
  return boleta === '' ? null : boleta;
}
