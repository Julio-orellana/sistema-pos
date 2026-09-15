/**
 * Pruebas de las reglas de entrada del modo kiosko.
 *
 * Responden con casos concretos a tres preguntas de auditoría:
 *   1. ¿Ctrl+scroll está realmente bloqueado, y no solo el zoom en 1?
 *   2. ¿El menú de clic derecho está deshabilitado?
 *   3. ¿El atajo de salida del administrador funciona en macOS y en Windows,
 *      incluso con el teclado latinoamericano de la tienda?
 *
 * El bloqueo efectivo en el DOM se prueba aparte, con un navegador simulado,
 * en src/main/preload/__tests__/kiosk-dom-guards.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  ATAJO_SALIDA_CONTROLADA,
  describirAtajo,
  esAtajoDeHerramientasDeDesarrollo,
  esAtajoDeRecarga,
  esAtajoDeSalidaControlada,
  esAtajoDeZoomPorTeclado,
  esGestoDeZoomConRueda,
  type EntradaDeTeclado,
} from '../kiosk-input';

/** Arma una entrada de teclado con los modificadores apagados por omisión. */
function tecla(parcial: EntradaDeTeclado): EntradaDeTeclado {
  return { type: 'keyDown', control: false, shift: false, alt: false, meta: false, ...parcial };
}

// ===========================================================================
describe('Zoom con la rueda del mouse', () => {
  it('Ctrl + rueda se bloquea', () => {
    expect(esGestoDeZoomConRueda({ ctrlKey: true, metaKey: false })).toBe(true);
  });

  it('Cmd + rueda se bloquea (gesto de zoom en macOS)', () => {
    expect(esGestoDeZoomConRueda({ ctrlKey: false, metaKey: true })).toBe(true);
  });

  it('la rueda sola NO se bloquea: el cajero tiene que poder desplazar una lista', () => {
    expect(esGestoDeZoomConRueda({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

// ===========================================================================
describe('Zoom con el teclado', () => {
  it('bloquea Ctrl + más, Ctrl + menos y Ctrl + cero', () => {
    expect(esAtajoDeZoomPorTeclado(tecla({ control: true, code: 'Equal', key: '+' }))).toBe(true);
    expect(esAtajoDeZoomPorTeclado(tecla({ control: true, code: 'Minus', key: '-' }))).toBe(true);
    expect(esAtajoDeZoomPorTeclado(tecla({ control: true, code: 'Digit0', key: '0' }))).toBe(true);
  });

  it('bloquea las mismas teclas del teclado numérico', () => {
    expect(esAtajoDeZoomPorTeclado(tecla({ control: true, code: 'NumpadAdd', key: '+' }))).toBe(true);
    expect(esAtajoDeZoomPorTeclado(tecla({ control: true, code: 'NumpadSubtract', key: '-' }))).toBe(true);
  });

  it('bloquea la variante con Cmd de macOS', () => {
    expect(esAtajoDeZoomPorTeclado(tecla({ meta: true, code: 'Equal', key: '+' }))).toBe(true);
  });

  it('NO bloquea esas teclas sin modificador: escribir un precio debe funcionar', () => {
    expect(esAtajoDeZoomPorTeclado(tecla({ code: 'Digit0', key: '0' }))).toBe(false);
    expect(esAtajoDeZoomPorTeclado(tecla({ code: 'Minus', key: '-' }))).toBe(false);
  });

  it('NO bloquea Ctrl con una tecla cualquiera', () => {
    expect(esAtajoDeZoomPorTeclado(tecla({ control: true, code: 'KeyA', key: 'a' }))).toBe(false);
  });

  it('ignora la liberación de la tecla y actúa solo al presionar', () => {
    expect(esAtajoDeZoomPorTeclado(tecla({ type: 'keyUp', control: true, code: 'Equal' }))).toBe(false);
  });
});

// ===========================================================================
describe('Atajo de salida controlada del administrador', () => {
  it('la combinación acordada es Ctrl + Shift + Alt + Q', () => {
    expect(ATAJO_SALIDA_CONTROLADA).toEqual({
      code: 'KeyQ',
      control: true,
      shift: true,
      alt: true,
      meta: false,
    });
  });

  it('se reconoce la combinación completa', () => {
    expect(
      esAtajoDeSalidaControlada(tecla({ control: true, shift: true, alt: true, code: 'KeyQ' })),
    ).toBe(true);
  });

  it('se reconoce en un teclado latinoamericano de Windows, donde AltGr+Q escribe una arroba', () => {
    // Con distribución latinoamericana la tecla física KeyQ produce "@" al
    // combinarse con AltGr (que Windows reporta como Ctrl+Alt). Como el atajo
    // se identifica por la tecla FÍSICA, sigue funcionando aunque el carácter
    // que llega no sea "q".
    expect(
      esAtajoDeSalidaControlada(
        tecla({ control: true, shift: true, alt: true, code: 'KeyQ', key: '@' }),
      ),
    ).toBe(true);
  });

  it('NO se dispara si falta un modificador', () => {
    expect(esAtajoDeSalidaControlada(tecla({ control: true, shift: true, code: 'KeyQ' }))).toBe(false);
    expect(esAtajoDeSalidaControlada(tecla({ control: true, alt: true, code: 'KeyQ' }))).toBe(false);
    expect(esAtajoDeSalidaControlada(tecla({ shift: true, alt: true, code: 'KeyQ' }))).toBe(false);
  });

  it('NO se dispara con Cmd en lugar de Ctrl: Cmd+Q ya es el atajo del sistema en macOS', () => {
    expect(
      esAtajoDeSalidaControlada(tecla({ meta: true, shift: true, alt: true, code: 'KeyQ' })),
    ).toBe(false);
  });

  it('NO se dispara con Ctrl+Q a secas', () => {
    expect(esAtajoDeSalidaControlada(tecla({ control: true, code: 'KeyQ' }))).toBe(false);
  });

  it('NO se dispara con otra tecla y los tres modificadores', () => {
    expect(
      esAtajoDeSalidaControlada(tecla({ control: true, shift: true, alt: true, code: 'KeyW' })),
    ).toBe(false);
  });

  it('NO se dispara al soltar la tecla, solo al presionarla', () => {
    expect(
      esAtajoDeSalidaControlada({
        type: 'keyUp',
        control: true,
        shift: true,
        alt: true,
        code: 'KeyQ',
      }),
    ).toBe(false);
  });

  it('se describe con el nombre correcto de la tecla en cada sistema operativo', () => {
    expect(describirAtajo(ATAJO_SALIDA_CONTROLADA, 'darwin')).toBe('Ctrl + Shift + Option + Q');
    expect(describirAtajo(ATAJO_SALIDA_CONTROLADA, 'win32')).toBe('Ctrl + Shift + Alt + Q');
    expect(describirAtajo(ATAJO_SALIDA_CONTROLADA, 'linux')).toBe('Ctrl + Shift + Alt + Q');
  });
});

// ===========================================================================
describe('Herramientas de desarrollo y recarga', () => {
  it('reconoce F12 y Ctrl+Shift+I como intentos de abrir las herramientas', () => {
    expect(esAtajoDeHerramientasDeDesarrollo(tecla({ code: 'F12' }))).toBe(true);
    expect(
      esAtajoDeHerramientasDeDesarrollo(tecla({ control: true, shift: true, code: 'KeyI' })),
    ).toBe(true);
  });

  it('reconoce F5 y Ctrl+R como intentos de recargar', () => {
    expect(esAtajoDeRecarga(tecla({ code: 'F5' }))).toBe(true);
    expect(esAtajoDeRecarga(tecla({ control: true, code: 'KeyR' }))).toBe(true);
  });

  it('no confunde una tecla normal con esos atajos', () => {
    expect(esAtajoDeHerramientasDeDesarrollo(tecla({ code: 'KeyI', key: 'i' }))).toBe(false);
    expect(esAtajoDeRecarga(tecla({ code: 'KeyR', key: 'r' }))).toBe(false);
  });
});
