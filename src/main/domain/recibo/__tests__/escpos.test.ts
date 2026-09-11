/**
 * Los bytes que salen hacia la impresora térmica.
 *
 * SE PRUEBAN BYTE POR BYTE porque es lo único que se puede verificar sin tener
 * la impresora enfrente, y porque el modelo real de Jimmy todavía no se conoce:
 * cuando llegue, estas pruebas dicen exactamente qué se le está mandando, y si
 * hubiera que ajustar algo se verá qué cambió.
 *
 * Lo que NO prueban, y hay que decirlo: que ESA impresora entienda estos bytes.
 * Eso solo se confirma con el aparato conectado.
 */

import { describe, expect, it } from 'vitest';

import { aCp850, reciboComoEscPos } from '../escpos';

/** Los bytes como lista, para poder compararlos cómodo. */
function bytesDe(texto: string): number[] {
  return [...reciboComoEscPos(texto)];
}

// ===========================================================================
describe('La estructura del flujo ESC/POS', () => {
  it('empieza inicializando la impresora', () => {
    // ESC @ deja la impresora en su estado por omisión: sin eso, hereda lo que
    // le dejó el trabajo anterior, que puede ser otra fuente u otro tamaño.
    expect(bytesDe('hola').slice(0, 2)).toEqual([0x1b, 0x40]);
  });

  it('fija la página de códigos CP850 antes de escribir nada', () => {
    // Es lo que hace que «Maíz» salga con la í y no con un símbolo cualquiera.
    expect(bytesDe('hola').slice(2, 5)).toEqual([0x1b, 0x74, 0x02]);
  });

  it('termina avanzando el papel y cortándolo', () => {
    const bytes = bytesDe('hola');
    // ESC d 3: avanza tres líneas, para que el corte no se coma el pie.
    expect(bytes.slice(-7, -4)).toEqual([0x1b, 0x64, 0x03]);
    // GS V B 0: corte PARCIAL, que deja el papel unido por un punto y no se
    // cae al piso mientras el cajero atiende.
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('el texto va entre el encabezado y el corte, con su salto final', () => {
    const bytes = bytesDe('AB');
    expect(bytes.slice(5, 8)).toEqual([0x41, 0x42, 0x0a]);
  });
});

// ===========================================================================
describe('El español sale bien: CP850, no UTF-8', () => {
  it('el ASCII pasa tal cual', () => {
    expect([...aCp850('Total')]).toEqual([0x54, 0x6f, 0x74, 0x61, 0x6c]);
  });

  it('las vocales acentuadas usan los bytes de CP850', () => {
    // Si se usara UTF-8, cada una ocuparía dos bytes y la impresora sacaría dos
    // símbolos raros por cada acento.
    expect([...aCp850('áéíóú')]).toEqual([0xa0, 0x82, 0xa1, 0xa2, 0xa3]);
  });

  it('la eñe y la diéresis también', () => {
    expect([...aCp850('ñÑü')]).toEqual([0xa4, 0xa5, 0x81]);
  });

  it('«Maíz» ocupa cuatro bytes, uno por letra', () => {
    // Es la comprobación que importa: una térmica cuenta columnas en bytes, así
    // que un acento de dos bytes desalinearía toda la línea.
    expect(aCp850('Maíz')).toHaveLength(4);
  });

  it('los signos de apertura salen, que en un recibo aparecen', () => {
    expect([...aCp850('¿¡')]).toEqual([0xa8, 0xad]);
  });

  it('un carácter sin lugar en CP850 se reemplaza, nunca se cuela crudo', () => {
    // Antes que un byte que la impresora interprete como quiera.
    const bytes = [...aCp850('日')];
    expect(bytes).toEqual([0x3f]);
  });

  it('las comillas tipográficas y el signo de multiplicar se sustituyen', () => {
    // El recibo usa «×» entre cantidad y precio; en CP850 no existe, y una «x»
    // se lee igual de bien.
    expect([...aCp850('×')]).toEqual([0x78]);
    expect([...aCp850('“”')]).toEqual([0x22, 0x22]);
  });

  it('el texto completo de un recibo no genera ningún byte de control suelto', () => {
    // Un byte por debajo de 0x20 en medio del texto sería un comando accidental.
    const cuerpo = [...aCp850('Maíz blanco  0.5 lb x 6.69          3.35')];
    expect(cuerpo.every((byte) => byte >= 0x20)).toBe(true);
  });
});
