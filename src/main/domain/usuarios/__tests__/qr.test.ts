/**
 * La matriz del QR de inscripción.
 *
 * Estas pruebas comprueban la FORMA del QR —cuadrado, con los tres patrones de
 * posición donde el estándar los pone— y que la librería no recibe nada fuera
 * de ASCII. Que un teléfono lo lea de verdad no se puede probar acá: se
 * comprobó decodificando la imagen que dibuja la aplicación real.
 */

import { describe, expect, it } from 'vitest';

import { matrizDeQr } from '../qr';
import { uriOtpauth } from '../totp';

const URI = uriOtpauth('POS Jimmy Cano', 'Jimmy', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');

/** El patrón de posición de 7×7: borde oscuro, anillo claro, centro oscuro de 3×3. */
function esPatronDePosicion(matriz: readonly (readonly boolean[])[], fila: number, columna: number): boolean {
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const borde = y === 0 || y === 6 || x === 0 || x === 6;
      const centro = y >= 2 && y <= 4 && x >= 2 && x <= 4;
      if (matriz[fila + y]?.[columna + x] !== (borde || centro)) {
        return false;
      }
    }
  }
  return true;
}

describe('El QR de inscripción', () => {
  it('es una matriz cuadrada de un tamaño válido del estándar (21 + 4k módulos)', () => {
    const matriz = matrizDeQr(URI);
    expect(matriz.every((fila) => fila.length === matriz.length)).toBe(true);
    expect((matriz.length - 21) % 4).toBe(0);
    expect(matriz.length).toBeGreaterThanOrEqual(21);
  });

  it('tiene los TRES patrones de posición, en las esquinas que manda el estándar', () => {
    const matriz = matrizDeQr(URI);
    const ultimo = matriz.length - 7;
    expect(esPatronDePosicion(matriz, 0, 0)).toBe(true);
    expect(esPatronDePosicion(matriz, 0, ultimo)).toBe(true);
    expect(esPatronDePosicion(matriz, ultimo, 0)).toBe(true);
    // Control: la cuarta esquina NO lo tiene; si la función de arriba diera
    // siempre `true`, esto fallaría.
    expect(esPatronDePosicion(matriz, ultimo, ultimo)).toBe(false);
  });

  it('es determinista: el mismo texto da la misma matriz, y otro texto otra', () => {
    expect(matrizDeQr(URI)).toEqual(matrizDeQr(URI));
    expect(matrizDeQr(URI)).not.toEqual(matrizDeQr(uriOtpauth('POS Jimmy Cano', 'Rosa', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')));
  });

  it('rechaza texto fuera de ASCII imprimible: la URI ya tiene que venir codificada', () => {
    expect(() => matrizDeQr('otpauth://totp/José')).toThrow(/ASCII/);
    expect(() => matrizDeQr('')).toThrow(/ASCII/);
  });

  it('la matriz se puede mandar a la ventana: pasa structuredClone', () => {
    const matriz = matrizDeQr(URI);
    expect(structuredClone(matriz)).toEqual(matriz);
  });
});
