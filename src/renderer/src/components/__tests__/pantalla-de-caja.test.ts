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

/** Pasa del resumen de la caja abierta al paso donde se cuenta para cerrar. */
function irAContar(): void {
  const boton = contenedor.querySelector<HTMLButtonElement>('[data-prueba="ir-a-contar"]');
  if (boton === null) {
    throw new Error('No está el botón para pasar a contar.');
  }
  act(() => {
    boton.click();
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
    irAContar();

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
    irAContar();
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

/** Desde el resumen: pasa a contar, cuenta un billete y confirma. */
async function irAContarYConfirmar(): Promise<void> {
  irAContar();
  await contarYConfirmar();
}

const RESPUESTA_BASE = {
  mensaje: '',
  autorizadaVia: null,
  segundosParaReintentar: null,
  montoInicial: '500.00',
  primerConteo: null,
};

/** El turno como lo manda el proceso principal a un ADMINISTRATIVO. */
const TURNO_PROPIO_CON_TEORICO: TurnoAbierto = {
  ...TURNO_PROPIO,
  ventasEnEfectivo: '130.50',
  cantidadDeVentasEnEfectivo: 4,
  montoTeorico: '630.50',
};

/** El mismo turno como lo manda a un usuario de VENTA: sin el teórico (§4.40). */
const TURNO_PROPIO_SIN_TEORICO: TurnoAbierto = {
  ...TURNO_PROPIO,
  ventasEnEfectivo: null,
  cantidadDeVentasEnEfectivo: null,
  montoTeorico: null,
};

describe('EL EFECTIVO TEÓRICO en el RESUMEN: solo si el proceso principal lo mandó', () => {
  it('a un administrativo le muestra las ventas en efectivo y el teórico', async () => {
    instalarApi(TURNO_PROPIO_CON_TEORICO);
    await montar();

    expect(porPrueba('monto-teorico')?.textContent).toContain('630.50');
    expect(porPrueba('ventas-en-efectivo')?.textContent).toContain('130.50');
    expect(texto()).toContain('Ventas en efectivo (4)');
  });

  it('a un usuario de venta (le llega en null) NO le dibuja ni el teórico ni las ventas en efectivo', async () => {
    instalarApi(TURNO_PROPIO_SIN_TEORICO);
    await montar();

    expect(porPrueba('estado-caja-propia')).not.toBeNull();
    expect(porPrueba('monto-teorico')).toBeNull();
    expect(porPrueba('ventas-en-efectivo')).toBeNull();
    expect(texto().toLowerCase()).not.toContain('teórico');
    expect(texto().toLowerCase()).not.toContain('ventas en efectivo');
  });

  it('si el turno ya tiene un conteo sellado, avisa cuánto se contó y NADA del esperado ni de la diferencia', async () => {
    instalarApi({
      ...TURNO_PROPIO_SIN_TEORICO,
      primerConteoSellado: { fecha: '2026-09-14T20:00:00.000Z', montoReal: '480.00' },
    });
    await montar();

    const aviso = porPrueba('aviso-de-conteo-sellado');
    expect(aviso?.textContent).toContain('480.00');
    expect((aviso?.textContent ?? '').toLowerCase()).not.toContain('faltante');
    expect((aviso?.textContent ?? '').toLowerCase()).not.toContain('sobrante');
  });
});

describe('EL PASO DE CONTEO no muestra el teórico A NADIE, administrador incluido', () => {
  it('un ADMINISTRATIVO lo ve en el resumen, y al pasar a contar desaparece de la pantalla', async () => {
    instalarApi(TURNO_PROPIO_CON_TEORICO);
    await montar();
    // Control: en el resumen SÍ está. Sin esto, la aserción de abajo pasaría
    // igual con un turno que nunca trajo el teórico.
    expect(porPrueba('monto-teorico')?.textContent).toContain('630.50');

    irAContar();

    expect(porPrueba('paso-de-conteo')).not.toBeNull();
    expect(porPrueba('confirmar-caja')).not.toBeNull();
    expect(porPrueba('monto-teorico')).toBeNull();
    expect(porPrueba('ventas-en-efectivo')).toBeNull();
    expect(texto()).not.toContain('630.50');
    expect(texto()).not.toContain('130.50');
    expect(texto().toLowerCase()).not.toContain('teórico');
  });

  it('un usuario de VENTA tampoco lo ve al contar', async () => {
    instalarApi(TURNO_PROPIO_SIN_TEORICO);
    await montar();
    irAContar();

    expect(porPrueba('paso-de-conteo')).not.toBeNull();
    expect(porPrueba('monto-teorico')).toBeNull();
    expect(texto().toLowerCase()).not.toContain('teórico');
  });

  it('el conteo sellado se avisa también al contar, sin el esperado', async () => {
    instalarApi({
      ...TURNO_PROPIO_CON_TEORICO,
      primerConteoSellado: { fecha: '2026-09-14T20:00:00.000Z', montoReal: '480.00' },
    });
    await montar();
    irAContar();

    const aviso = porPrueba('aviso-de-conteo-sellado');
    expect(aviso?.textContent).toContain('480.00');
    expect(aviso?.textContent).toContain('autorización');
    expect(texto()).not.toContain('630.50');
  });

  it('«Volver» desde el conteo regresa al resumen, donde el administrativo vuelve a ver el teórico', async () => {
    instalarApi(TURNO_PROPIO_CON_TEORICO);
    await montar();
    irAContar();
    expect(porPrueba('monto-teorico')).toBeNull();

    await act(async () => {
      porPrueba('volver-al-resumen')?.click();
      await Promise.resolve();
    });

    expect(porPrueba('monto-teorico')?.textContent).toContain('630.50');
  });
});

describe('LA CONFIRMACIÓN DEL CIERRE muestra los tres montos, a cualquier rol', () => {
  it('cuadrada: inicial, teórico y final, sin renglón de diferencia', async () => {
    instalarApiConCierres(TURNO_PROPIO_CON_TEORICO, [
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
    await irAContarYConfirmar();

    expect(porPrueba('confirmacion-de-cierre')?.textContent).toContain('Caja cerrada con éxito');
    expect(porPrueba('cierre-efectivo-inicial')?.textContent).toContain('500.00');
    expect(porPrueba('cierre-efectivo-teorico')?.textContent).toContain('630.50');
    expect(porPrueba('cierre-efectivo-final')?.textContent).toContain('630.50');
    expect(porPrueba('cierre-diferencia')).toBeNull();
  });

  it('a un usuario de VENTA, que no vio el teórico ni en el resumen ni al contar, se lo muestra al confirmar', async () => {
    instalarApiConCierres(TURNO_PROPIO_SIN_TEORICO, [
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
    expect(texto()).not.toContain('630.50');
    await irAContarYConfirmar();

    expect(porPrueba('cierre-efectivo-teorico')?.textContent).toContain('630.50');
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
    await irAContarYConfirmar();

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
    await irAContarYConfirmar();

    expect(porPrueba('autorizacion-de-reconteo')).not.toBeNull();
    expect(porPrueba('reconteo-primer-conteo')?.textContent).toContain('480.00');
    expect(porPrueba('reconteo-conteo-actual')?.textContent).toContain('500.00');
    expect(porPrueba('autorizacion-de-reconteo')?.textContent).toContain('aunque ahora cuadre');
    // Y NO se cerró: no hay confirmación.
    expect(porPrueba('confirmacion-de-cierre')).toBeNull();
  });
});

describe('EL DIÁLOGO DE DIFERENCIA: la cajera ve que hay que autorizar, NO cuánto se esperaba', () => {
  it('con esperado y diferencia en null (lo que manda el proceso principal a una cajera), no aparece ningún monto esperado ni el signo', async () => {
    instalarApiConCierres(TURNO_PROPIO_SIN_TEORICO, [
      {
        ...RESPUESTA_BASE,
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION',
        mensaje: 'Este cierre tiene una diferencia registrada. Un administrador tiene que autorizarlo.',
        diferencia: null,
        montoEsperado: null,
        montoReal: '100.00',
      },
    ]);
    await montar();
    await irAContarYConfirmar();

    const dialogo = porPrueba('autorizacion-de-diferencia');
    expect(dialogo).not.toBeNull();
    const visible = texto();
    expect(porPrueba('diferencia-sin-monto')?.textContent).toContain('autorizar');
    expect(porPrueba('diferencia')).toBeNull();
    expect(visible).not.toContain('Debería haber');
    expect(visible).not.toContain('500.00');
    expect(visible.toLowerCase()).not.toContain('faltante');
    expect(visible.toLowerCase()).not.toContain('sobrante');
    expect(visible.toLowerCase()).not.toContain('no cuadra');
    // Lo que ella contó sí se ve.
    expect(visible).toContain('100.00');
  });

  it('si antes selló otro conteo, dice cuánto contó entonces y nada de su diferencia', async () => {
    instalarApiConCierres(TURNO_PROPIO_SIN_TEORICO, [
      {
        ...RESPUESTA_BASE,
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION',
        mensaje: 'Este cierre tiene una diferencia registrada. Un administrador tiene que autorizarlo.',
        diferencia: null,
        montoEsperado: null,
        montoReal: '100.00',
        primerConteo: { fecha: '2026-09-14T20:00:00.000Z', montoEsperado: null, montoReal: '90.00', diferencia: null },
      },
    ]);
    await montar();
    await irAContarYConfirmar();

    expect(porPrueba('primer-conteo-sellado')?.textContent).toContain('90.00');
    expect((porPrueba('primer-conteo-sellado')?.textContent ?? '').toLowerCase()).not.toContain('faltante');
  });

  it('CONTROL: con los montos (lo que recibe un administrativo) el diálogo sí muestra «Debería haber» y el faltante', async () => {
    instalarApiConCierres(TURNO_PROPIO_CON_TEORICO, [
      {
        ...RESPUESTA_BASE,
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION',
        diferencia: '-530.50',
        montoEsperado: '630.50',
        montoReal: '100.00',
      },
    ]);
    await montar();
    await irAContarYConfirmar();

    expect(texto()).toContain('Debería haber');
    expect(texto()).toContain('630.50');
    expect(porPrueba('diferencia')?.textContent).toContain('530.50');
    expect(porPrueba('diferencia-sin-monto')).toBeNull();
  });
});
