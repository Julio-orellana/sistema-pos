/**
 * @vitest-environment jsdom
 *
 * Los TRES ESTADOS de la pantalla de caja.
 *
 * Esta prueba existe por un defecto concreto: la pantalla decidía qué mostrar
 * consultando el turno DEL USUARIO EN SESIÓN, no el del sistema. Con la caja
 * abierta por otra persona respondía "no hay ninguna" y ofrecía abrir una
 * segunda caja sobre el mismo cajón de dinero.
 *
 * Lo que se verifica es que la pantalla dibuja lo que le dice el proceso
 * principal, y nada fijo: sin caja no aparece la palabra «cerrar» en ninguna
 * parte, y con una caja ajena aparece de quién es y que hace falta permiso.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { EstadoDeCaja, TurnoAbierto } from '@shared/types/ipc';
import { PantallaDeCaja } from '../PantallaDeCaja';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Turno abierto por Rosa, la cajera de la mañana. */
const TURNO_DE_ROSA: TurnoAbierto = {
  id: 'turno-1',
  montoInicial: '500.00',
  abiertaEn: '2026-09-08T13:30:00.000Z',
  abiertaPorId: 'usuario-rosa',
  abiertaPorNombre: 'Rosa',
  esDeOtroUsuario: true,
};

/** El mismo turno, pero abierto por quien está en sesión. */
const TURNO_PROPIO: TurnoAbierto = { ...TURNO_DE_ROSA, esDeOtroUsuario: false };

let contenedor: HTMLDivElement;
let raiz: Root;

/** Instala un `window.pos` que responde con el estado dado. */
function instalarApi(turnoAbierto: TurnoAbierto | null): void {
  const estado: EstadoDeCaja = {
    turnoAbierto,
    denominaciones: [
      { id: 'd1', valor: '100.00', tipo: 'billete', orden: 1 },
      { id: 'd2', valor: '50.00', tipo: 'billete', orden: 2 },
    ],
  };

  (window as unknown as { pos: unknown }).pos = {
    caja: {
      estado: async (): Promise<unknown> => Promise.resolve({ ok: true as const, datos: estado }),
      abrir: async (): Promise<unknown> =>
        Promise.resolve({ ok: true as const, datos: turnoAbierto }),
      cerrar: async (): Promise<unknown> =>
        Promise.resolve({
          ok: true as const,
          datos: {
            cerrada: false,
            codigo: 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA',
            mensaje: 'Esta caja la abrió otra persona.',
            diferencia: '0.00',
            montoEsperado: '500.00',
            montoReal: '0.00',
            autorizadaVia: null,
            segundosParaReintentar: null,
          },
        }),
    },
  };
}

/** Monta la pantalla y espera a que termine de consultar el estado. */
async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(createElement(PantallaDeCaja, { alVolver: () => undefined }));
    await Promise.resolve();
  });
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

/** Todo el texto visible, para preguntar si una palabra aparece o no. */
function texto(): string {
  return contenedor.textContent;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  contenedor.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

// ===========================================================================
describe('Estado 1: no hay ninguna caja abierta en el sistema', () => {
  beforeEach(() => {
    instalarApi(null);
  });

  it('ofrece abrir la caja', async () => {
    await montar();

    expect(porPrueba('estado-sin-caja')).not.toBeNull();
    expect(porPrueba('confirmar-caja')?.textContent).toBe('Abrir turno');
  });

  it('NO menciona cerrar en ninguna parte', async () => {
    await montar();

    // Este era el bug reportado: un botón de cerrar donde no había nada que
    // cerrar. Ahora la palabra no aparece si no hay caja.
    expect(texto().toLowerCase()).not.toContain('cerrar');
  });

  it('no muestra el resumen de ningún turno', async () => {
    await montar();

    expect(porPrueba('estado-caja-propia')).toBeNull();
    expect(porPrueba('estado-caja-ajena')).toBeNull();
  });
});

// ===========================================================================
describe('Estado 2: hay una caja abierta y la abrió quien está en sesión', () => {
  beforeEach(() => {
    instalarApi(TURNO_PROPIO);
  });

  it('muestra el resumen del turno propio', async () => {
    await montar();

    expect(porPrueba('estado-caja-propia')).not.toBeNull();
    expect(porPrueba('abierta-por')?.textContent).toBe('Vos');
    expect(texto()).toContain('500.00');
  });

  it('ofrece cerrar SIN avisar de ninguna autorización', async () => {
    await montar();

    expect(porPrueba('confirmar-caja')?.textContent).toBe('Cerrar turno');
    expect(porPrueba('aviso-de-caja-ajena')).toBeNull();
  });

  it('no ofrece abrir otra caja', async () => {
    await montar();
    expect(porPrueba('estado-sin-caja')).toBeNull();
  });
});

// ===========================================================================
describe('Estado 3: hay una caja abierta y la abrió OTRA persona', () => {
  beforeEach(() => {
    instalarApi(TURNO_DE_ROSA);
  });

  it('dice quién la abrió y desde cuándo', async () => {
    await montar();

    expect(porPrueba('estado-caja-ajena')).not.toBeNull();
    expect(porPrueba('abierta-por')?.textContent).toBe('Rosa');
    expect(texto()).toContain('500.00');
  });

  it('avisa que cerrarla necesita autorización', async () => {
    await montar();

    const aviso = porPrueba('aviso-de-caja-ajena');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toContain('Rosa');
    expect(aviso?.textContent).toContain('autorización');
  });

  it('el botón de cerrar lo dice también', async () => {
    await montar();
    expect(porPrueba('confirmar-caja')?.textContent).toBe(
      'Cerrar turno (requiere autorización)',
    );
  });

  it('tampoco ofrece abrir otra caja', async () => {
    await montar();
    expect(porPrueba('estado-sin-caja')).toBeNull();
  });
});
