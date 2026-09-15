/**
 * El centinela «sin PIN» de un usuario restaurado desde la nube (fase 4.b).
 *
 * Es la decisión 15 del diseño de sincronización —toda restauración resetea
 * todos los PIN— hecha por construcción: un usuario restaurado no trae hash,
 * porque `pin_hash` no existe en Postgres (decisión 17), y lo que se escribe
 * localmente es una marca que ningún PIN puede acertar. Las tres propiedades
 * que la marca tiene que cumplir están acá, cada una con su prueba.
 */

import { describe, expect, it } from 'vitest';

import { generarHashDePin, HASH_SIN_PIN, tienePin, verificarPin } from '../auth';

describe('El centinela «sin PIN» de un usuario restaurado', () => {
  it('satisface el CHECK de la columna: es texto y no está vacío', () => {
    expect(typeof HASH_SIN_PIN).toBe('string');
    expect(HASH_SIN_PIN.length).toBeGreaterThan(0);
  });

  it('verificarPin lo rechaza SIEMPRE, sin lanzar: ningún PIN bien formado coincide', () => {
    for (const pin of ['0000', '1234', '2468', '9999']) {
      expect(() => verificarPin(pin, HASH_SIN_PIN)).not.toThrow();
      expect(verificarPin(pin, HASH_SIN_PIN)).toBe(false);
    }
  });

  it('un PIN mal formado tampoco lanza contra el centinela', () => {
    expect(verificarPin('', HASH_SIN_PIN)).toBe(false);
    expect(verificarPin('abc', HASH_SIN_PIN)).toBe(false);
  });

  it('los 10 000 PIN posibles: NINGUNO verifica contra el centinela', () => {
    // Es barato porque el centinela se rechaza antes de llegar a scrypt.
    const TOTAL_DE_PINES = 10_000;
    const LARGO = 4;
    let aciertos = 0;
    for (let n = 0; n < TOTAL_DE_PINES; n += 1) {
      if (verificarPin(String(n).padStart(LARGO, '0'), HASH_SIN_PIN)) {
        aciertos += 1;
      }
    }
    expect(aciertos).toBe(0);
  });

  it('generarHashDePin NUNCA produce el centinela: todo hash real empieza por scrypt$', () => {
    for (const pin of ['0000', '1234', '9999']) {
      const hash = generarHashDePin(pin);
      expect(hash).not.toBe(HASH_SIN_PIN);
      expect(hash.startsWith('scrypt$')).toBe(true);
      expect(tienePin(hash)).toBe(true);
    }
  });

  it('tienePin distingue el centinela de un hash real', () => {
    expect(tienePin(HASH_SIN_PIN)).toBe(false);
    expect(tienePin(generarHashDePin('2468'))).toBe(true);
  });

  it('un hash corrupto que NO es el centinela sigue lanzando, igual que antes: el centinela no abre la puerta a hashes ilegibles', () => {
    expect(() => verificarPin('2468', 'esto-no-es-un-hash')).toThrow(/formato esperado/);
  });
});
