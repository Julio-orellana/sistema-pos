/**
 * Pruebas del códec de columnas decimales.
 *
 * Es la única vía autorizada para escribir y leer dinero, peso y cantidad en
 * la base. Si esto falla, todo lo demás hereda el error.
 */

import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';

import {
  ErrorDeColumnaDecimal,
  aColumnaBooleana,
  aColumnaCantidad,
  aColumnaDecimal,
  aColumnaDecimalNulable,
  aColumnaExacta,
  aColumnaMonto,
  aColumnaPeso,
  desdeColumnaBooleana,
  desdeColumnaDecimal,
  desdeColumnaDecimalNulable,
  esFormatoDeColumnaDecimal,
} from '../decimal-columns';
import { aCadena, montoACadena } from '@shared/money';

describe('Escritura: de Decimal a la columna TEXT', () => {
  it('un monto se escribe siempre con dos decimales', () => {
    expect(aColumnaMonto('16.8')).toBe('16.80');
    expect(aColumnaMonto('16')).toBe('16.00');
    expect(aColumnaMonto(new Decimal('16.795'))).toBe('16.80');
  });

  it('un peso y una cantidad se escriben con tres decimales', () => {
    expect(aColumnaPeso('60')).toBe('60.000');
    expect(aColumnaCantidad('1.5')).toBe('1.500');
  });

  it('un valor exacto conserva todos sus decimales sin rellenar', () => {
    expect(aColumnaExacta('3.345')).toBe('3.345');
    expect(aColumnaExacta('16')).toBe('16');
  });

  it('siempre devuelve una cadena, nunca un número', () => {
    expect(typeof aColumnaMonto('16.80')).toBe('string');
    expect(typeof aColumnaExacta(16.8)).toBe('string');
  });

  it('la versión nulable deja pasar el nulo tal cual', () => {
    expect(aColumnaDecimalNulable(null, 'monto')).toBeNull();
    expect(aColumnaDecimalNulable(undefined, 'monto')).toBeNull();
    expect(aColumnaDecimalNulable('5', 'monto')).toBe('5.00');
  });

  it('aColumnaDecimal respeta el tipo que se le pide', () => {
    expect(aColumnaDecimal('1.23456', 'monto')).toBe('1.23');
    expect(aColumnaDecimal('1.23456', 'peso')).toBe('1.235');
    expect(aColumnaDecimal('1.23456', 'cantidad')).toBe('1.235');
    expect(aColumnaDecimal('1.23456', 'exacto')).toBe('1.23456');
  });
});

describe('Lectura: de la columna TEXT a Decimal', () => {
  it('devuelve un Decimal con el valor exacto', () => {
    const valor = desdeColumnaDecimal('16.80', 'ventas.total');
    expect(valor).toBeInstanceOf(Decimal);
    expect(aCadena(valor)).toBe('16.8');
    expect(montoACadena(valor)).toBe('16.80');
  });

  it('conserva la precisión de un valor exacto con muchos decimales', () => {
    expect(aCadena(desdeColumnaDecimal('3.345', 'venta_detalle.subtotal_exacto'))).toBe('3.345');
  });

  it('RECHAZA un número: si la base devolvió un number, el valor ya pasó por punto flotante', () => {
    try {
      desdeColumnaDecimal(16.8, 'ventas.total');
      expect.unreachable('Se esperaba que un número fuera rechazado.');
    } catch (error) {
      expect((error as ErrorDeColumnaDecimal).codigo).toBe('VALOR_NO_ES_TEXTO');
      expect((error as ErrorDeColumnaDecimal).columna).toBe('ventas.total');
    }
  });

  it('RECHAZA texto que no tiene forma de decimal, y dice en qué columna', () => {
    try {
      desdeColumnaDecimal('dieciséis con ochenta', 'ventas.subtotal');
      expect.unreachable('Se esperaba que el texto fuera rechazado.');
    } catch (error) {
      expect((error as ErrorDeColumnaDecimal).codigo).toBe('FORMATO_INVALIDO');
      expect((error as ErrorDeColumnaDecimal).columna).toBe('ventas.subtotal');
      expect((error as Error).message).toContain('ventas.subtotal');
    }
  });

  it('RECHAZA notación científica y valores con dos puntos', () => {
    expect(() => desdeColumnaDecimal('1e5', 'x')).toThrow(ErrorDeColumnaDecimal);
    expect(() => desdeColumnaDecimal('1.2.3', 'x')).toThrow(ErrorDeColumnaDecimal);
  });

  it('la versión nulable deja pasar el nulo', () => {
    expect(desdeColumnaDecimalNulable(null, 'caja_sesiones.monto_real')).toBeNull();
    expect(desdeColumnaDecimalNulable(undefined, 'caja_sesiones.monto_real')).toBeNull();
  });
});

describe('Ida y vuelta: lo que se escribe es exactamente lo que se lee', () => {
  it('un monto sobrevive el viaje completo sin perder un centavo', () => {
    const casos = ['0.00', '0.01', '16.80', '1234567.89', '-16.80'];
    for (const original of casos) {
      const enLaBase = aColumnaMonto(original);
      const recuperado = desdeColumnaDecimal(enLaBase, 'prueba');
      expect(montoACadena(recuperado)).toBe(original);
    }
  });

  it('un valor exacto de cinco decimales sobrevive el viaje', () => {
    const enLaBase = aColumnaExacta('24.09291');
    expect(aCadena(desdeColumnaDecimal(enLaBase, 'prueba'))).toBe('24.09291');
  });
});

describe('Validación de formato', () => {
  it('reconoce la forma canónica', () => {
    expect(esFormatoDeColumnaDecimal('16.80')).toBe(true);
    expect(esFormatoDeColumnaDecimal('-16.80')).toBe(true);
    expect(esFormatoDeColumnaDecimal('16')).toBe(true);
  });

  it('rechaza todo lo demás', () => {
    expect(esFormatoDeColumnaDecimal('16.')).toBe(false);
    expect(esFormatoDeColumnaDecimal('.80')).toBe(false);
    expect(esFormatoDeColumnaDecimal('1e5')).toBe(false);
    expect(esFormatoDeColumnaDecimal('')).toBe(false);
    expect(esFormatoDeColumnaDecimal(16.8)).toBe(false);
    expect(esFormatoDeColumnaDecimal(null)).toBe(false);
  });
});

describe('Booleanos, que SQLite no tiene', () => {
  it('se escriben como 0 y 1', () => {
    expect(aColumnaBooleana(true)).toBe(1);
    expect(aColumnaBooleana(false)).toBe(0);
  });

  it('se leen de vuelta como booleanos', () => {
    expect(desdeColumnaBooleana(1, 'productos.activo')).toBe(true);
    expect(desdeColumnaBooleana(0, 'productos.activo')).toBe(false);
  });

  it('rechazan cualquier otro valor', () => {
    expect(() => desdeColumnaBooleana(2, 'productos.activo')).toThrow(ErrorDeColumnaDecimal);
    expect(() => desdeColumnaBooleana('sí', 'productos.activo')).toThrow(ErrorDeColumnaDecimal);
  });
});
