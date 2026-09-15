/**
 * @vitest-environment jsdom
 *
 * El diálogo de salida controlada, en la pantalla táctil (2026-09-15).
 *
 * Existe porque el PIN de salida era un `<input>` nativo: en la tienda, sin
 * teclado físico, NO HABÍA CÓMO ESCRIBIRLO. Estas pruebas fijan que se teclea
 * en pantalla y que la ventana sigue siendo solo un recolector de dígitos:
 * cada intento viaja al proceso principal tal cual, sin candado propio ni
 * reintentos, porque el candado de intentos vive allá (`controlled-exit.ts`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ModalDeSalida } from '../ModalDeSalida';
import { CampoDeTexto, ProveedorDeTeclado, type CampoDeTextoProps } from '../TecladoEnPantalla';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type RespuestaDeSalida =
  | { ok: true; datos: { autorizado: boolean; mensaje: string } }
  | { ok: false; error: { codigo: string; mensaje: string } };

let contenedor: HTMLDivElement;
let raiz: Root;
let avisarSolicitud: (() => void) | null;
let pinesEnviados: string[];
let proximaRespuesta: RespuestaDeSalida;

function instalarApi(): void {
  avisarSolicitud = null;
  pinesEnviados = [];
  proximaRespuesta = { ok: true, datos: { autorizado: false, mensaje: 'PIN incorrecto.' } };
  (window as unknown as { pos: unknown }).pos = {
    kiosko: {
      alSolicitarSalida: (aviso: () => void): (() => void) => {
        avisarSolicitud = aviso;
        return (): void => {
          avisarSolicitud = null;
        };
      },
      confirmarSalida: async (pin: string): Promise<RespuestaDeSalida> => {
        pinesEnviados.push(pin);
        return Promise.resolve(proximaRespuesta);
      },
    },
  };
}

/** Un formulario con un campo de texto, para el caso del teclado abierto. */
function Formulario(): React.JSX.Element {
  const [nombre, setNombre] = useState('');
  return createElement(CampoDeTexto, {
    etiqueta: 'Nombre',
    valor: nombre,
    alCambiar: setNombre,
    'data-prueba': 'campo-nombre',
  } as CampoDeTextoProps);
}

function montar(): void {
  act(() => {
    raiz.render(
      createElement(ProveedorDeTeclado, null, createElement(ModalDeSalida), createElement(Formulario)),
    );
  });
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

function dentroDelDialogo(nombre: string): HTMLButtonElement {
  const elemento = porPrueba('dialogo-salida')?.querySelector<HTMLButtonElement>(`[data-prueba="${nombre}"]`);
  if (elemento === null || elemento === undefined) {
    throw new Error(`No existe ${nombre} dentro del diálogo de salida.`);
  }
  return elemento;
}

function pedirSalida(): void {
  act(() => {
    avisarSolicitud?.();
  });
}

function puntosLlenos(): number {
  return porPrueba('dialogo-salida')?.querySelectorAll('.teclado__punto--lleno').length ?? -1;
}

async function tocarPin(pin: string): Promise<void> {
  for (const digito of pin) {
    act(() => {
      dentroDelDialogo(`tecla-${digito}`).click();
    });
  }
  await act(async () => {
    dentroDelDialogo('tecla-confirmar').click();
    await Promise.resolve();
  });
}

function teclaFisica(key: string): void {
  act(() => {
    porPrueba('dialogo-salida')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function botonCerrarAplicacion(): HTMLButtonElement {
  const boton = Array.from(porPrueba('dialogo-salida')?.querySelectorAll('button') ?? []).find(
    (b) => b.textContent === 'Cerrar aplicación',
  );
  if (boton === undefined) {
    throw new Error('No está el botón «Cerrar aplicación».');
  }
  return boton;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (): number => 0;
  instalarApi();
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  montar();
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  contenedor.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('El PIN de salida se teclea EN PANTALLA', () => {
  it('sin que el proceso principal lo pida, no se dibuja nada', () => {
    expect(porPrueba('dialogo-salida')).toBeNull();
  });

  it('al pedirse la salida aparece el teclado numérico, y en el diálogo NO hay ningún campo nativo', () => {
    pedirSalida();
    const dialogo = porPrueba('dialogo-salida');
    expect(dialogo).not.toBeNull();
    expect(dialogo?.querySelectorAll('input, textarea, [contenteditable]')).toHaveLength(0);
    for (const digito of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(dentroDelDialogo(`tecla-${digito}`).disabled).toBe(false);
    }
    expect(dentroDelDialogo('tecla-confirmar')).toBeTruthy();
  });

  it('tocar cuatro dígitos y ✓ manda ESE PIN al proceso principal, una sola vez', async () => {
    pedirSalida();
    await tocarPin('5678');
    expect(pinesEnviados).toEqual(['5678']);
  });

  it('el PIN nunca se muestra: un punto lleno por dígito, sin el número en el diálogo', () => {
    pedirSalida();
    act(() => {
      dentroDelDialogo('tecla-7').click();
    });
    act(() => {
      dentroDelDialogo('tecla-3').click();
    });
    expect(puntosLlenos()).toBe(2);
    expect(porPrueba('dialogo-salida')?.textContent).not.toContain('73');
  });

  it('«Cerrar aplicación» y ✓ quedan deshabilitados hasta tener los cuatro dígitos', () => {
    pedirSalida();
    expect(botonCerrarAplicacion().disabled).toBe(true);
    for (const digito of '123') {
      act(() => {
        dentroDelDialogo(`tecla-${digito}`).click();
      });
    }
    expect(botonCerrarAplicacion().disabled).toBe(true);
    expect(dentroDelDialogo('tecla-confirmar').disabled).toBe(true);
    act(() => {
      dentroDelDialogo('tecla-4').click();
    });
    expect(botonCerrarAplicacion().disabled).toBe(false);
    expect(dentroDelDialogo('tecla-confirmar').disabled).toBe(false);
  });

  it('un PIN rechazado muestra el mensaje del proceso principal, vacía los puntos y deja reintentar', async () => {
    pedirSalida();
    await tocarPin('1111');
    expect(porPrueba('mensaje-de-salida')?.textContent).toBe('PIN incorrecto.');
    expect(puntosLlenos()).toBe(0);
    expect(porPrueba('dialogo-salida')).not.toBeNull();
    await tocarPin('2222');
    expect(pinesEnviados).toEqual(['1111', '2222']);
  });

  it('LA VENTANA NO TIENE CANDADO PROPIO: cada intento viaja al proceso principal, y el mensaje de bloqueo se muestra tal cual', async () => {
    pedirSalida();
    await tocarPin('1111');
    await tocarPin('2222');
    proximaRespuesta = {
      ok: true,
      datos: { autorizado: false, mensaje: 'Demasiados intentos. Esperá 30 segundos.' },
    };
    await tocarPin('3333');
    await tocarPin('4444');
    expect(pinesEnviados).toEqual(['1111', '2222', '3333', '4444']);
    expect(porPrueba('mensaje-de-salida')?.textContent).toBe('Demasiados intentos. Esperá 30 segundos.');
  });

  it('un error del canal también se muestra y no deja el teclado bloqueado', async () => {
    pedirSalida();
    proximaRespuesta = { ok: false, error: { codigo: 'X', mensaje: 'No se pudo verificar.' } };
    await tocarPin('1234');
    expect(porPrueba('mensaje-de-salida')?.textContent).toBe('No se pudo verificar.');
    expect(dentroDelDialogo('tecla-1').disabled).toBe(false);
  });

  it('«Cancelar» cierra el diálogo sin mandar nada', () => {
    pedirSalida();
    act(() => {
      dentroDelDialogo('tecla-1').click();
    });
    act(() => {
      Array.from(porPrueba('dialogo-salida')?.querySelectorAll('button') ?? [])
        .find((b) => b.textContent === 'Cancelar')
        ?.click();
    });
    expect(porPrueba('dialogo-salida')).toBeNull();
    expect(pinesEnviados).toEqual([]);
  });
});

describe('Un teclado físico, si hay uno, sigue sirviendo igual que antes', () => {
  it('dígitos, borrar y Enter', async () => {
    pedirSalida();
    for (const tecla of ['9', '8', '7', '6', 'Backspace', '5']) {
      teclaFisica(tecla);
    }
    expect(puntosLlenos()).toBe(4);
    await act(async () => {
      porPrueba('dialogo-salida')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(pinesEnviados).toEqual(['9875']);
  });

  it('una letra no escribe nada, y un SÉPTIMO dígito tampoco: seis es el código de la app (migración 036)', () => {
    pedirSalida();
    for (const tecla of ['a', '1', '2', '3', '4', '5', '6', '7']) {
      teclaFisica(tecla);
    }
    expect(puntosLlenos()).toBe(6);
  });

  it('seis dígitos y Enter mandan el CÓDIGO DE LA APP; cinco no mandan nada', async () => {
    pedirSalida();
    for (const tecla of ['1', '2', '3', '4', '5']) {
      teclaFisica(tecla);
    }
    teclaFisica('Enter');
    expect(pinesEnviados).toEqual([]);
    teclaFisica('6');
    teclaFisica('Enter');
    await act(async () => {
      await Promise.resolve();
    });
    expect(pinesEnviados).toEqual(['123456']);
  });

  it('Enter con menos de cuatro dígitos no manda nada', () => {
    pedirSalida();
    teclaFisica('1');
    teclaFisica('Enter');
    expect(pinesEnviados).toEqual([]);
  });

  it('Escape cancela, como antes', () => {
    pedirSalida();
    teclaFisica('Escape');
    expect(porPrueba('dialogo-salida')).toBeNull();
  });
});

describe('Si había un formulario a medio escribir', () => {
  it('el teclado ALFANUMÉRICO se cierra al aparecer el diálogo, para no tapar las teclas del PIN', () => {
    act(() => {
      porPrueba('campo-nombre')?.focus();
    });
    expect(porPrueba('teclado-en-pantalla')).not.toBeNull();
    pedirSalida();
    expect(porPrueba('teclado-en-pantalla')).toBeNull();
    expect(porPrueba('dialogo-salida')).not.toBeNull();
  });
});
