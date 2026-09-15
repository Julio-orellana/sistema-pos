/**
 * El seguro del modo destructivo de `npm run verify:nube`.
 *
 * `--destructivo` escribe y vacía tablas en un proyecto de Supabase. La única
 * defensa contra correrlo por error contra `pos-jimmy-cano` es la lista fija
 * de `scripts/proyectos-de-prueba.cjs`, así que estas pruebas ejercitan
 * EXACTAMENTE esa función —cargada del mismo archivo que usa el guion— y no
 * una copia. Y comprueban que el guion la use.
 *
 * Es CommonJS porque el guion corre con `node` pelado; se carga con
 * `createRequire`, que es la forma de traer un `.cjs` desde una prueba ESM.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface ModuloDelSeguro {
  readonly PROYECTOS_DE_PRUEBA: readonly string[];
  readonly PROYECTO_REAL: string;
  exigirProyectoDePrueba(referencia: string, url: string, lista?: readonly string[]): string;
}

const cargar = createRequire(import.meta.url);
const RUTA_DEL_SEGURO = fileURLToPath(new URL('../../../../scripts/proyectos-de-prueba.cjs', import.meta.url));
const RUTA_DEL_GUION = fileURLToPath(new URL('../../../../scripts/verificacion-de-nube.cjs', import.meta.url));

const seguro = cargar(RUTA_DEL_SEGURO) as ModuloDelSeguro;

/** La referencia de pos-jimmy-cano, escrita acá aparte para no depender del módulo que se prueba. */
const REAL = 'zgsdaelmbxufgcsideep';
/** La referencia de pos-pruebas-descartable. */
const PRUEBAS = 'ztidrshifrblhfraiowg';

const urlDe = (referencia: string): string => `https://${referencia}.supabase.co`;

describe('El seguro del modo destructivo de verify:nube', () => {
  it('la referencia de pos-jimmy-cano (zgsdaelmbxufgcsideep) NO está en la lista fija', () => {
    expect(seguro.PROYECTO_REAL).toBe(REAL);
    expect(seguro.PROYECTOS_DE_PRUEBA).not.toContain(REAL);
  });

  it('la lista fija contiene el proyecto de pruebas descartable', () => {
    expect(seguro.PROYECTOS_DE_PRUEBA).toContain(PRUEBAS);
  });

  it('deja pasar el proyecto de pruebas con su propia URL', () => {
    expect(seguro.exigirProyectoDePrueba(PRUEBAS, urlDe(PRUEBAS))).toBe(PRUEBAS);
  });

  it('se niega ante la referencia de pos-jimmy-cano, aunque su URL coincida', () => {
    expect(() => seguro.exigirProyectoDePrueba(REAL, urlDe(REAL))).toThrow(/proyecto REAL/);
  });

  it('se niega ante una referencia bien formada que no está en la lista', () => {
    expect(() => seguro.exigirProyectoDePrueba('abcdefghijabcdefghij', urlDe('abcdefghijabcdefghij'))).toThrow(
      /no está en la lista fija/,
    );
  });

  it('se niega si la URL apunta a otro proyecto que el declarado', () => {
    expect(() => seguro.exigirProyectoDePrueba(PRUEBAS, urlDe(REAL))).toThrow(/no corresponde a la referencia/);
  });

  it('se niega ante una URL que no es una URL', () => {
    expect(() => seguro.exigirProyectoDePrueba(PRUEBAS, 'no-es-una-url')).toThrow(/no es una URL válida/);
  });

  it('se niega ante una referencia mal formada', () => {
    expect(() => seguro.exigirProyectoDePrueba('PRUEBAS', urlDe('PRUEBAS'))).toThrow(/no tiene forma de referencia/);
    expect(() => seguro.exigirProyectoDePrueba('', urlDe(''))).toThrow(/no tiene forma de referencia/);
  });

  it('se niega ante TODO proyecto, incluso uno de prueba legítimo, si la lista llegara a contener la referencia real', () => {
    expect(() => seguro.exigirProyectoDePrueba(PRUEBAS, urlDe(PRUEBAS), [PRUEBAS, REAL])).toThrow(
      /contiene la referencia del proyecto REAL/,
    );
  });

  it('el guion verify:nube usa este mismo seguro, y lo llama antes de crear el cliente de red', () => {
    const fuente = readFileSync(RUTA_DEL_GUION, 'utf8');
    expect(fuente).toContain("require('./proyectos-de-prueba.cjs')");

    const modoDestructivo = fuente.slice(fuente.indexOf('async function correrModoDestructivo'));
    const seguroEn = modoDestructivo.indexOf('exigirProyectoDePrueba(');
    const clienteEn = modoDestructivo.indexOf('new ClienteDeNube(');
    expect(seguroEn).toBeGreaterThan(0);
    expect(clienteEn).toBeGreaterThan(seguroEn);
  });
});
