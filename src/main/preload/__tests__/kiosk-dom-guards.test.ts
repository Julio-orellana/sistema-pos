/**
 * @vitest-environment jsdom
 *
 * Prueba de los bloqueos del kiosko sobre un navegador simulado.
 *
 * Esta es la respuesta verificable —no la revisión de código— a dos preguntas
 * de auditoría:
 *
 *   ¿Ctrl+scroll está realmente bloqueado, o solo el zoom quedó en 1?
 *   ¿El menú de clic derecho está deshabilitado?
 *
 * El método es directo: se instalan los bloqueos sobre una ventana real de
 * jsdom, se despacha el evento que produciría el cajero y se comprueba si el
 * evento quedó cancelado (`defaultPrevented`). Un evento cancelado es un gesto
 * que el navegador no ejecuta.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { instalarBloqueosDeKioskoEnDom, type QuitarBloqueos } from '../kiosk-dom-guards';

let quitarBloqueos: QuitarBloqueos;

beforeEach(() => {
  quitarBloqueos = instalarBloqueosDeKioskoEnDom(window);
});

afterEach(() => {
  quitarBloqueos();
});

/** Despacha un evento cancelable y responde si quedó bloqueado. */
function despacharYVerSiSeBloqueo(evento: Event): boolean {
  document.body.dispatchEvent(evento);
  return evento.defaultPrevented;
}

/** Arma un evento de rueda del mouse. */
function ruedaDelMouse(modificadores: { ctrlKey?: boolean; metaKey?: boolean }): Event {
  return new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
    ctrlKey: modificadores.ctrlKey ?? false,
    metaKey: modificadores.metaKey ?? false,
  });
}

/** Arma una pulsación de tecla. */
function pulsacion(opciones: KeyboardEventInit): Event {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opciones });
}

// ===========================================================================
describe('Menú de clic derecho', () => {
  it('el menú contextual queda bloqueado: el clic derecho no abre nada', () => {
    const clicDerecho = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    expect(despacharYVerSiSeBloqueo(clicDerecho)).toBe(true);
  });

  it('se bloquea también sobre un campo de texto, donde el navegador ofrece Cortar y Pegar', () => {
    const campo = document.createElement('input');
    document.body.appendChild(campo);

    const clicDerecho = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    campo.dispatchEvent(clicDerecho);

    expect(clicDerecho.defaultPrevented).toBe(true);
    campo.remove();
  });

  it('deja de bloquearse cuando se quitan los bloqueos (prueba de que el bloqueo es real y no un efecto de jsdom)', () => {
    quitarBloqueos();
    const clicDerecho = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    expect(despacharYVerSiSeBloqueo(clicDerecho)).toBe(false);

    // Se reinstalan para que afterEach no falle.
    quitarBloqueos = instalarBloqueosDeKioskoEnDom(window);
  });
});

// ===========================================================================
describe('Zoom con Ctrl + rueda del mouse', () => {
  it('Ctrl + rueda queda bloqueado', () => {
    expect(despacharYVerSiSeBloqueo(ruedaDelMouse({ ctrlKey: true }))).toBe(true);
  });

  it('Cmd + rueda queda bloqueado (el equivalente en macOS)', () => {
    expect(despacharYVerSiSeBloqueo(ruedaDelMouse({ metaKey: true }))).toBe(true);
  });

  it('la rueda sin modificador NO se bloquea: desplazar una lista de productos sigue funcionando', () => {
    expect(despacharYVerSiSeBloqueo(ruedaDelMouse({}))).toBe(false);
  });
});

// ===========================================================================
describe('Zoom con el teclado', () => {
  it('Ctrl + más, Ctrl + menos y Ctrl + cero quedan bloqueados', () => {
    expect(despacharYVerSiSeBloqueo(pulsacion({ ctrlKey: true, code: 'Equal', key: '+' }))).toBe(true);
    expect(despacharYVerSiSeBloqueo(pulsacion({ ctrlKey: true, code: 'Minus', key: '-' }))).toBe(true);
    expect(despacharYVerSiSeBloqueo(pulsacion({ ctrlKey: true, code: 'Digit0', key: '0' }))).toBe(true);
  });

  it('Cmd + más queda bloqueado (macOS)', () => {
    expect(despacharYVerSiSeBloqueo(pulsacion({ metaKey: true, code: 'Equal', key: '+' }))).toBe(true);
  });

  it('escribir un cero o un guion sin Ctrl NO se bloquea: hay que poder teclear precios', () => {
    expect(despacharYVerSiSeBloqueo(pulsacion({ code: 'Digit0', key: '0' }))).toBe(false);
    expect(despacharYVerSiSeBloqueo(pulsacion({ code: 'Minus', key: '-' }))).toBe(false);
  });

  it('el atajo de salida del administrador NO lo bloquea el preload: lo atiende el proceso principal', () => {
    const atajo = pulsacion({ ctrlKey: true, shiftKey: true, altKey: true, code: 'KeyQ', key: 'q' });
    expect(despacharYVerSiSeBloqueo(atajo)).toBe(false);
  });
});
