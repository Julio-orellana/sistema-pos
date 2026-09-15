/**
 * Pruebas del hash y la verificación del PIN.
 *
 * Es la pieza de la que depende todo el control de acceso: si esto falla, el
 * sistema deja entrar a quien no debe o deja afuera a quien sí.
 */

import { describe, expect, it } from 'vitest';

import { ErrorDeAuth, describirHash, generarHashDePin, verificarPin } from '../auth';
import { LARGO_DEL_PIN, normalizarEntradaDePin, tieneFormatoDePinValido } from '../pin';

const PIN = '2468';

// ===========================================================================
describe('Formato del PIN: exactamente cuatro dígitos', () => {
  it('acepta cuatro dígitos', () => {
    expect(tieneFormatoDePinValido('0000')).toBe(true);
    expect(tieneFormatoDePinValido('9999')).toBe(true);
    expect(LARGO_DEL_PIN).toBe(4);
  });

  it('rechaza tres dígitos y cinco dígitos', () => {
    expect(tieneFormatoDePinValido('123')).toBe(false);
    expect(tieneFormatoDePinValido('12345')).toBe(false);
  });

  it('rechaza letras, símbolos, espacios y vacío', () => {
    expect(tieneFormatoDePinValido('12a4')).toBe(false);
    expect(tieneFormatoDePinValido('12 4')).toBe(false);
    expect(tieneFormatoDePinValido('12-4')).toBe(false);
    expect(tieneFormatoDePinValido('')).toBe(false);
  });

  it('normalizar deja solo dígitos y recorta al largo del PIN', () => {
    expect(normalizarEntradaDePin('12a3b4c5')).toBe('1234');
    expect(normalizarEntradaDePin('  9 8 ')).toBe('98');
  });
});

// ===========================================================================
describe('Generación del hash', () => {
  it('dos usuarios con el MISMO PIN obtienen hashes distintos', () => {
    // Es el efecto de la sal aleatoria: nadie puede deducir mirando la tabla
    // que dos personas comparten PIN.
    const deJimmy = generarHashDePin(PIN);
    const deLaCajera = generarHashDePin(PIN);

    expect(deJimmy).not.toBe(deLaCajera);
    // Y sin embargo los dos verifican el mismo PIN.
    expect(verificarPin(PIN, deJimmy)).toBe(true);
    expect(verificarPin(PIN, deLaCajera)).toBe(true);
  });

  it('el hash NO contiene el PIN en claro', () => {
    expect(generarHashDePin('1234')).not.toContain('1234');
  });

  it('el formato serializado lleva algoritmo, versión, parámetros, sal y clave', () => {
    const hash = generarHashDePin(PIN);
    const partes = hash.split('$');

    expect(partes).toHaveLength(7);
    expect(partes[0]).toBe('scrypt');
    expect(partes[1]).toBe('1');
    expect(describirHash(hash)).toEqual({
      algoritmo: 'scrypt',
      costoN: 16384,
      bytesDeSal: 16,
      bytesDeClave: 32,
    });
  });

  it('se niega a generar un hash de algo que no es un PIN válido', () => {
    expect(() => generarHashDePin('123')).toThrow(ErrorDeAuth);
    expect(() => generarHashDePin('abcd')).toThrow(/cuatro dígitos|4 dígitos/i);
  });
});

// ===========================================================================
describe('Verificación del PIN', () => {
  it('el PIN correcto verifica true', () => {
    expect(verificarPin(PIN, generarHashDePin(PIN))).toBe(true);
  });

  it('un PIN incorrecto verifica false', () => {
    expect(verificarPin('1357', generarHashDePin(PIN))).toBe(false);
  });

  it('un PIN de formato inválido NUNCA llega a compararse: devuelve false sin lanzar', () => {
    const hash = generarHashDePin(PIN);
    // Ni siquiera se deserializa el hash: la comprobación de formato va primero.
    expect(verificarPin('246', hash)).toBe(false);
    expect(verificarPin('24680', hash)).toBe(false);
    expect(verificarPin('24a8', hash)).toBe(false);
    expect(verificarPin('', hash)).toBe(false);
  });

  it('un PIN de formato inválido devuelve false incluso con un hash corrupto', () => {
    // Prueba de que el formato se comprueba ANTES de tocar el hash: con un hash
    // ilegible, un PIN mal formado devuelve false en vez de lanzar.
    expect(verificarPin('12', 'esto-no-es-un-hash')).toBe(false);
  });

  it('un hash corrupto con un PIN bien formado sí lanza, en vez de decir que no coincide', () => {
    // Una fila corrupta es un problema de datos que hay que ver, no un simple
    // "PIN incorrecto" que quedaría escondido.
    expect(() => verificarPin(PIN, 'esto-no-es-un-hash')).toThrow(ErrorDeAuth);
    expect(() => verificarPin(PIN, 'md5$1$2$3$4$5$6')).toThrow(/formato esperado/);
  });

  it('cambiar un solo dígito del PIN ya no verifica', () => {
    const hash = generarHashDePin('1111');
    expect(verificarPin('1112', hash)).toBe(false);
    expect(verificarPin('2111', hash)).toBe(false);
  });

  it('los 10 000 PIN posibles: solo uno verifica (muestra representativa)', () => {
    const hash = generarHashDePin('0007');
    const candidatos = ['0000', '0001', '0006', '0007', '0008', '0070', '7000', '9999'];
    const aciertos = candidatos.filter((candidato) => verificarPin(candidato, hash));
    expect(aciertos).toEqual(['0007']);
  });
});
