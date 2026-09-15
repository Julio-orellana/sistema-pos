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
  ventasEnEfectivo: '0.00',
  cantidadDeVentasEnEfectivo: 0,
  montoTeorico: '500.00',
  primerConteoSellado: null,
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

// ===========================================================================
// Lo que agregó el 2026-09-14 (§4.39): teórico en vivo, confirmación del
// cierre con sus tres montos, y el reconteo que muestra los dos conteos.
// ===========================================================================

/** Instala una API cuyo `cerrar` contesta lo que se le pase, en orden. */
function instalarApiConCierres(turno: TurnoAbierto, respuestas: readonly unknown[]): void {
  instalarApi(turno);
  const pendientes = [...respuestas];
  const api = (window as unknown as { pos: { caja: Record<string, unknown> } }).pos;
  api.caja.cerrar = async (): Promise<unknown> =>
    Promise.resolve({ ok: true as const, datos: pendientes.shift() });
}

/** Cuenta un billete de Q100 y confirma el cierre. */
async function contarYConfirmar(): Promise<void> {
  const mas = contenedor.querySelector<HTMLButtonElement>(
    'button[aria-label="Agregar una pieza de 100.00"]',
  );
  if (mas === null) {
    throw new Error('No está el botón para contar Q100.');
  }
  act(() => {
    mas.click();
  });
  await act(async () => {
    porPrueba('confirmar-caja')?.click();
    await Promise.resolve();
  });
}

const RESPUESTA_BASE = {
  mensaje: '',
  autorizadaVia: null,
  segundosParaReintentar: null,
  montoInicial: '500.00',
  primerConteo: null,
};

describe('EL EFECTIVO TEÓRICO se ve mientras la caja está abierta', () => {
  it('muestra las ventas en efectivo y el teórico que manda el proceso principal', async () => {
    instalarApi({
      ...TURNO_PROPIO,
      ventasEnEfectivo: '130.50',
      cantidadDeVentasEnEfectivo: 4,
      montoTeorico: '630.50',
    });
    await montar();

    expect(porPrueba('monto-teorico')?.textContent).toContain('630.50');
    expect(porPrueba('ventas-en-efectivo')?.textContent).toContain('130.50');
    expect(texto()).toContain('Ventas en efectivo (4)');
  });

  it('si el turno ya tiene un conteo sellado, lo avisa aunque se haya salido de la pantalla', async () => {
    instalarApi({
      ...TURNO_PROPIO,
      primerConteoSellado: {
        fecha: '2026-09-14T20:00:00.000Z',
        montoEsperado: '500.00',
        montoReal: '480.00',
        diferencia: '-20.00',
      },
    });
    await montar();

    const aviso = porPrueba('aviso-de-conteo-sellado');
    expect(aviso?.textContent).toContain('480.00');
    expect(aviso?.textContent).toContain('autorización');
  });
});

describe('LA CONFIRMACIÓN DEL CIERRE muestra los tres montos', () => {
  it('cuadrada: inicial, teórico y final, sin renglón de diferencia', async () => {
    instalarApiConCierres(TURNO_PROPIO, [
      {
        ...RESPUESTA_BASE,
        cerrada: true,
        codigo: 'CIERRE_CORRECTO',
        diferencia: '0.00',
        montoEsperado: '630.50',
        montoReal: '630.50',
      },
    ]);
    await montar();
    await contarYConfirmar();

    expect(porPrueba('confirmacion-de-cierre')?.textContent).toContain('Caja cerrada con éxito');
    expect(porPrueba('cierre-efectivo-inicial')?.textContent).toContain('500.00');
    expect(porPrueba('cierre-efectivo-teorico')?.textContent).toContain('630.50');
    expect(porPrueba('cierre-efectivo-final')?.textContent).toContain('630.50');
    expect(porPrueba('cierre-diferencia')).toBeNull();
  });

  it('con diferencia autorizada: la muestra, con su signo en palabras', async () => {
    instalarApiConCierres(TURNO_PROPIO, [
      {
        ...RESPUESTA_BASE,
        cerrada: true,
        codigo: 'CIERRE_CORRECTO',
        diferencia: '-20.00',
        montoEsperado: '500.00',
        montoReal: '480.00',
        autorizadaVia: 'presencial',
      },
    ]);
    await montar();
    await contarYConfirmar();

    expect(porPrueba('cierre-diferencia')?.textContent).toContain('20.00');
    expect(porPrueba('confirmacion-de-cierre')?.textContent).toContain('Faltante');
  });
});

describe('EL RECONTEO: quien autoriza ve LOS DOS conteos', () => {
  it('pide autorización mostrando el primer conteo y el de ahora', async () => {
    instalarApiConCierres(TURNO_PROPIO, [
      {
        ...RESPUESTA_BASE,
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION_DE_RECONTEO',
        diferencia: '0.00',
        montoEsperado: '500.00',
        montoReal: '500.00',
        primerConteo: {
          fecha: '2026-09-14T20:00:00.000Z',
          montoEsperado: '500.00',
          montoReal: '480.00',
          diferencia: '-20.00',
        },
      },
    ]);
    await montar();
    await contarYConfirmar();

    expect(porPrueba('autorizacion-de-reconteo')).not.toBeNull();
    expect(porPrueba('reconteo-primer-conteo')?.textContent).toContain('480.00');
    expect(porPrueba('reconteo-conteo-actual')?.textContent).toContain('500.00');
    expect(porPrueba('autorizacion-de-reconteo')?.textContent).toContain('aunque ahora cuadre');
    // Y NO se cerró: no hay confirmación.
    expect(porPrueba('confirmacion-de-cierre')).toBeNull();
  });
});
