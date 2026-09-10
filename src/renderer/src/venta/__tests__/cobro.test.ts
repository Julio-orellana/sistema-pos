/**
 * Las reglas del diálogo de cobro, sin montar la pantalla.
 *
 * NINGUNA DE ESTAS REGLAS ES LA AUTORIDAD: todas se vuelven a aplicar en el
 * proceso principal, y la de la boleta además en la base (migración 014). Acá
 * existen para avisar mientras se escribe, que es la primera de las tres capas
 * de validación del proyecto (CLAUDE.md §4.11).
 */

import { describe, expect, it } from 'vitest';

import { montoACadena } from '@shared/money';
import {
  boletaDelBorrador,
  descuentoDelBorrador,
  problemaDelCobro,
  COBRO_EN_BLANCO,
  type BorradorDeCobro,
} from '../cobro';

/** El borrador en blanco con los cambios indicados. */
function borrador(cambios: Partial<BorradorDeCobro> = {}): BorradorDeCobro {
  return { ...COBRO_EN_BLANCO, ...cambios };
}

// ===========================================================================
describe('Un cobro sin descuento y en efectivo no tiene nada que corregir', () => {
  it('el borrador en blanco es válido', () => {
    expect(problemaDelCobro(COBRO_EN_BLANCO)).toBeNull();
    expect(descuentoDelBorrador(COBRO_EN_BLANCO)).toBeNull();
    expect(boletaDelBorrador(COBRO_EN_BLANCO)).toBeNull();
  });
});

// ===========================================================================
describe('El descuento tiene que ser un número positivo', () => {
  it('elegir el tipo y no escribir el valor se avisa', () => {
    expect(problemaDelCobro(borrador({ tipoDeDescuento: 'porcentaje' }))).toMatch(/cuánto es/);
  });

  it('un texto que no es número se avisa', () => {
    expect(
      problemaDelCobro(borrador({ tipoDeDescuento: 'monto_fijo', valorDeDescuento: 'diez' })),
    ).toMatch(/tiene que ser un número/);
  });

  it('cero no es un descuento', () => {
    expect(
      problemaDelCobro(borrador({ tipoDeDescuento: 'monto_fijo', valorDeDescuento: '0' })),
    ).toMatch(/no cambia nada/);
  });

  it('negativo sería un recargo encubierto', () => {
    expect(
      problemaDelCobro(borrador({ tipoDeDescuento: 'monto_fijo', valorDeDescuento: '-5' })),
    ).toMatch(/no puede ser negativo/);
  });

  it('un porcentaje mayor que 100 se avisa; un MONTO mayor que 100 no', () => {
    expect(
      problemaDelCobro(borrador({ tipoDeDescuento: 'porcentaje', valorDeDescuento: '120' })),
    ).toMatch(/100 %/);

    // Q120 de descuento es perfectamente posible en una venta grande: el tope
    // que decide es el del rol, y ese lo evalúa el proceso principal.
    expect(
      problemaDelCobro(borrador({ tipoDeDescuento: 'monto_fijo', valorDeDescuento: '120' })),
    ).toBeNull();
  });

  it('un descuento válido se redondea a dos decimales, como la columna', () => {
    const pedido = descuentoDelBorrador(
      borrador({ tipoDeDescuento: 'porcentaje', valorDeDescuento: '7.499' }),
    );
    expect(pedido?.tipo).toBe('porcentaje');
    expect(montoACadena(pedido?.valor ?? '0')).toBe('7.50');
  });
});

// ===========================================================================
describe('La boleta va con tarjeta y solo con tarjeta', () => {
  it('tarjeta sin boleta se avisa', () => {
    expect(problemaDelCobro(borrador({ formaPago: 'tarjeta' }))).toMatch(/boleta/);
  });

  it('tarjeta con solo espacios sigue siendo tarjeta sin boleta', () => {
    expect(problemaDelCobro(borrador({ formaPago: 'tarjeta', numBoleta: '   ' }))).toMatch(
      /boleta/,
    );
  });

  it('tarjeta con boleta es válida y la boleta viaja sin espacios de sobra', () => {
    const conBoleta = borrador({ formaPago: 'tarjeta', numBoleta: '  004512 ' });
    expect(problemaDelCobro(conBoleta)).toBeNull();
    // El cero a la izquierda se conserva: es un número de documento.
    expect(boletaDelBorrador(conBoleta)).toBe('004512');
  });

  it('en EFECTIVO la boleta se descarta aunque esté escrita', () => {
    // Pasa cuando alguien escribe la boleta y después cambia de idea. La base
    // rechaza una venta en efectivo con boleta, y ese rechazo sería
    // incomprensible frente al cliente.
    const enEfectivo = borrador({ formaPago: 'efectivo', numBoleta: '004512' });
    expect(problemaDelCobro(enEfectivo)).toBeNull();
    expect(boletaDelBorrador(enEfectivo)).toBeNull();
  });
});

// ===========================================================================
describe('Se avisa UN problema por vez, el primero', () => {
  it('con descuento inválido Y tarjeta sin boleta, gana el descuento', () => {
    const roto = borrador({
      tipoDeDescuento: 'porcentaje',
      valorDeDescuento: '-1',
      formaPago: 'tarjeta',
    });
    // Una lista de tres errores frente a un cliente que espera se lee peor que
    // arreglar uno por vez.
    expect(problemaDelCobro(roto)).toMatch(/no puede ser negativo/);
  });
});
