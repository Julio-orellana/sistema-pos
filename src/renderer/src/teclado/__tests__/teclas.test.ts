/**
 * Qué texto queda en un campo después de cada tecla del teclado en pantalla.
 *
 * Es la regla que decide qué se guarda como nombre de un producto o como
 * precio: se prueba como función pura, sin botones (§4.39).
 */

import { describe, expect, it } from 'vitest';

import {
  FILAS_DE_SIMBOLOS,
  FILAS_DE_TEXTO,
  aplicarTecla,
  conMayuscula,
  type OpcionesDeTecla,
  type Tecla,
} from '../teclas';

const texto: OpcionesDeTecla = { disposicion: 'texto' };
const decimal: OpcionesDeTecla = { disposicion: 'decimal' };
const entero: OpcionesDeTecla = { disposicion: 'entero' };

const c = (caracter: string): Tecla => ({ tipo: 'caracter', caracter });
const ESPACIO: Tecla = { tipo: 'espacio' };
const BORRAR: Tecla = { tipo: 'borrar' };

/** Aplica una secuencia de teclas desde un campo vacío. */
function escribir(opciones: OpcionesDeTecla, ...teclas: readonly Tecla[]): string {
  return teclas.reduce((valor, tecla) => aplicarTecla(valor, tecla, opciones), '');
}

describe('Disposición de TEXTO: nombres de productos y categorías', () => {
  it('escribe un nombre con tilde y eñe', () => {
    expect(escribir(texto, c('A'), c('z'), c('ú'), c('c'), c('a'), c('r'))).toBe('Azúcar');
    expect(escribir(texto, c('p'), c('i'), c('ñ'), c('a'))).toBe('piña');
  });

  it('el espacio separa palabras, pero no se acepta al principio ni dos seguidos', () => {
    expect(escribir(texto, ESPACIO, c('M'), c('a'), ESPACIO, ESPACIO, c('b'))).toBe('Ma b');
  });

  it('respeta el largo máximo del campo', () => {
    expect(escribir({ disposicion: 'texto', largoMaximo: 3 }, c('a'), c('b'), c('c'), c('d'))).toBe('abc');
  });

  it('borrar quita el último carácter, aunque sea una vocal con tilde', () => {
    expect(aplicarTecla('Azú', BORRAR, texto)).toBe('Az');
    expect(aplicarTecla('', BORRAR, texto)).toBe('');
  });

  it('Mayús pone en mayúscula las letras, incluidas la ñ y las tildes', () => {
    expect(conMayuscula('ñ', true)).toBe('Ñ');
    expect(conMayuscula('á', true)).toBe('Á');
    expect(conMayuscula('7', true)).toBe('7');
    expect(conMayuscula('a', false)).toBe('a');
  });
});

describe('Disposición DECIMAL: precios y cantidades', () => {
  it('escribe un precio con un solo punto', () => {
    expect(escribir(decimal, c('4'), c('.'), c('5'), c('0'))).toBe('4.50');
  });

  it('un segundo punto no hace nada', () => {
    expect(escribir(decimal, c('4'), c('.'), c('5'), c('.'), c('0'))).toBe('4.50');
  });

  it('el punto sin nada antes da «0.»', () => {
    expect(escribir(decimal, c('.'), c('7'), c('5'))).toBe('0.75');
  });

  it('un cero a la izquierda se reemplaza: «05» no es un precio', () => {
    expect(escribir(decimal, c('0'), c('5'))).toBe('5');
    expect(escribir(decimal, c('0'), c('.'), c('5'))).toBe('0.5');
  });

  it('no admite letras ni espacios', () => {
    expect(escribir(decimal, c('4'), c('a'), ESPACIO, c('2'))).toBe('42');
  });
});

describe('Disposición ENTERO: el orden de una categoría', () => {
  it('solo dígitos: el punto no existe', () => {
    expect(escribir(entero, c('1'), c('.'), c('2'))).toBe('12');
  });
});

describe('Capa de SÍMBOLOS: el correo y la contraseña de la nube (2026-09-15)', () => {
  it('trae la arroba: sin ella no hay correo que escribir', () => {
    expect(FILAS_DE_SIMBOLOS.flat()).toContain('@');
  });

  it('cada tecla escribe UN carácter, y ninguna se repite en la capa (una tecla repetida es un toque ambiguo)', () => {
    for (const capa of [FILAS_DE_TEXTO, FILAS_DE_SIMBOLOS]) {
      const teclas = capa.flat();
      expect(teclas.every((tecla) => Array.from(tecla).length === 1)).toBe(true);
      expect(new Set(teclas).size).toBe(teclas.length);
    }
  });

  it('todo símbolo se admite en la disposición de texto y en ninguna numérica', () => {
    for (const signo of FILAS_DE_SIMBOLOS.flat().filter((tecla) => !/[0-9.]/.test(tecla))) {
      expect(aplicarTecla('', c(signo), texto), signo).toBe(signo);
      expect(aplicarTecla('', c(signo), entero), signo).toBe('');
    }
  });
});
