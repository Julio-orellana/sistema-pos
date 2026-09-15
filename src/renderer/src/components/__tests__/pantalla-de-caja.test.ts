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
import {
  CODIGO_SIN_RESPUESTA,
  LIMITE_DE_RESPUESTA_MS,
  MENSAJE_SIN_RESPUESTA,
  llamarAlProcesoPrincipal,
} from '../llamar-al-proceso-principal';

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

  it('avisa, SIN ambigüedad, quién la abrió y que cerrarla necesita el PIN de un administrador', async () => {
    await montar();

    const aviso = porPrueba('aviso-de-caja-ajena');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toContain('Esta caja la abrió Rosa.');
    expect(aviso?.textContent).toContain('Vas a necesitar el PIN de un administrador para cerrarla.');
  });

  it('dice en qué orden: primero se cuenta y después se pide el PIN, que puede ser el propio', async () => {
    await montar();

    const pasos = porPrueba('aviso-de-caja-ajena-pasos')?.textContent ?? '';
    expect(pasos).toContain('Primero contás el efectivo');
    expect(pasos).toContain('se pide el PIN');
    expect(pasos).toContain('Si sos administrador, sirve el tuyo.');
    // Y lo sigue diciendo en el paso de contar, que es donde se busca el PIN.
    irAContar();
    expect(porPrueba('aviso-de-caja-ajena-pasos')).not.toBeNull();
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
        mensaje:
          'Antes se confirmó un conteo de Q480.00 con un FALTANTE de Q20.00, cuando el sistema esperaba Q500.00. Ahora se contaron Q500.00: cambió lo contado. Corregir un conteo que mostraba una diferencia exige la autorización de un administrador, aunque ahora cuadre.',
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

  it('CUANDO CAMBIÓ LO ESPERADO y no lo contado, el diálogo no dice que el conteo cambió: muestra los dos esperados y el motivo del proceso principal', async () => {
    const motivo =
      'Antes se confirmó un conteo de Q520.00 con un SOBRANTE de Q20.00, cuando el sistema esperaba Q500.00. Lo contado no cambió: lo que cambió es lo que el sistema espera, que era Q500.00 y ahora es Q520.00. Cerrar un turno que tuvo un conteo con diferencia exige la autorización de un administrador, aunque ahora cuadre.';
    instalarApiConCierres(TURNO_PROPIO, [
      {
        ...RESPUESTA_BASE,
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION_DE_RECONTEO',
        mensaje: motivo,
        diferencia: '0.00',
        montoEsperado: '520.00',
        montoReal: '520.00',
        primerConteo: {
          fecha: '2026-09-14T20:00:00.000Z',
          montoEsperado: '500.00',
          montoReal: '520.00',
          diferencia: '20.00',
        },
      },
    ]);
    await montar();
    await irAContarYConfirmar();

    const dialogo = porPrueba('autorizacion-de-reconteo')?.textContent ?? '';
    expect(dialogo).not.toContain('El conteo cambió');
    expect(dialogo).not.toContain('Corregir un conteo');
    expect(porPrueba('reconteo-motivo')?.textContent).toBe(motivo);
    expect(porPrueba('reconteo-esperado-entonces')?.textContent).toContain('500.00');
    expect(porPrueba('reconteo-esperado-ahora')?.textContent).toContain('520.00');
    expect(porPrueba('reconteo-primer-conteo')?.textContent).toContain('520.00');
    expect(porPrueba('reconteo-conteo-actual')?.textContent).toContain('520.00');
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

// ===========================================================================
// §4.40.5 — EL PIN PRIMERO, EL MONTO DESPUÉS, LA CONFIRMACIÓN AL FINAL
// ===========================================================================

/** Lo que registra la API falsa de los dos métodos del segundo paso. */
interface LlamadasDelSegundoPaso {
  cerrar: number;
  confirmar: number;
  cancelar: number;
}

/**
 * Instala una API donde `cerrar` contesta en orden lo que se le pase, y
 * `confirmarCierreAutorizado` contesta `alConfirmar`. Cuenta las llamadas.
 */
function instalarApiDeDosPasos(
  turno: TurnoAbierto,
  respuestasDeCerrar: readonly unknown[],
  alConfirmar: unknown,
): LlamadasDelSegundoPaso {
  instalarApi(turno);
  const llamadas: LlamadasDelSegundoPaso = { cerrar: 0, confirmar: 0, cancelar: 0 };
  const pendientes = [...respuestasDeCerrar];
  const api = (window as unknown as { pos: { caja: Record<string, unknown> } }).pos;
  api.caja.cerrar = async (): Promise<unknown> => {
    llamadas.cerrar += 1;
    return Promise.resolve({ ok: true as const, datos: pendientes.shift() });
  };
  api.caja.confirmarCierreAutorizado = async (): Promise<unknown> => {
    llamadas.confirmar += 1;
    return Promise.resolve({ ok: true as const, datos: alConfirmar });
  };
  api.caja.cancelarAutorizacionDeCierre = async (): Promise<unknown> => {
    llamadas.cancelar += 1;
    return Promise.resolve({ ok: true as const, datos: true });
  };
  return llamadas;
}

/** Teclea un PIN de cuatro dígitos en el teclado del diálogo y lo confirma. */
async function teclearPin(pin: string): Promise<void> {
  for (const digito of pin) {
    act(() => {
      porPrueba(`tecla-${digito}`)?.click();
    });
  }
  await act(async () => {
    porPrueba('tecla-confirmar')?.click();
    await Promise.resolve();
  });
}

async function pulsar(nombre: string): Promise<void> {
  await act(async () => {
    porPrueba(nombre)?.click();
    await Promise.resolve();
  });
}

/** Lo que el proceso principal le manda a una cajera: sin montos. */
const PIDE_PIN_A_LA_CAJERA = {
  ...RESPUESTA_BASE,
  cerrada: false,
  codigo: 'REQUIERE_AUTORIZACION',
  mensaje: 'Este cierre tiene una diferencia registrada. Un administrador tiene que autorizarlo.',
  diferencia: null,
  montoEsperado: null,
  montoReal: '100.00',
};

/** El PIN de un administrador fue correcto: llegan los montos, nada se cerró. */
const AUTORIZACION_VALIDADA = {
  ...RESPUESTA_BASE,
  cerrada: false,
  codigo: 'AUTORIZACION_VALIDADA',
  mensaje: 'Jimmy autorizó por teléfono. Revisá el monto y confirmá el cierre.',
  diferencia: '-530.50',
  montoEsperado: '630.50',
  montoReal: '100.00',
  autorizadaVia: 'remoto',
};

const CIERRE_HECHO = {
  ...RESPUESTA_BASE,
  cerrada: true,
  codigo: 'CIERRE_CORRECTO',
  diferencia: '-530.50',
  montoEsperado: '630.50',
  montoReal: '100.00',
  autorizadaVia: 'remoto',
};

describe('UN PIN CORRECTO NO CIERRA LA CAJA: muestra el monto y espera una segunda confirmación', () => {
  it('después del PIN correcto aparece «esto es lo que se está autorizando» con el esperado y el faltante, y NO la confirmación del cierre', async () => {
    const llamadas = instalarApiDeDosPasos(
      TURNO_PROPIO_SIN_TEORICO,
      [PIDE_PIN_A_LA_CAJERA, AUTORIZACION_VALIDADA],
      CIERRE_HECHO,
    );
    await montar();
    await irAContarYConfirmar();
    expect(texto()).not.toContain('630.50');

    await teclearPin('9753');

    expect(porPrueba('revelacion-de-autorizacion')).not.toBeNull();
    expect(porPrueba('revelacion-esperado')?.textContent).toContain('630.50');
    expect(porPrueba('revelacion-diferencia')?.textContent).toContain('530.50');
    expect(texto()).toContain('FALTANTE');
    expect(porPrueba('revelacion-quien-autoriza')?.textContent).toContain('por teléfono');
    expect(porPrueba('revelacion-caja-abierta')?.textContent).toContain('NO se cerró');
    expect(porPrueba('confirmacion-de-cierre')).toBeNull();
    expect(llamadas.confirmar).toBe(0);
  });

  it('recién «Sí, cerrar la caja» llama a la confirmación y muestra el cierre', async () => {
    const llamadas = instalarApiDeDosPasos(
      TURNO_PROPIO_SIN_TEORICO,
      [PIDE_PIN_A_LA_CAJERA, AUTORIZACION_VALIDADA],
      CIERRE_HECHO,
    );
    await montar();
    await irAContarYConfirmar();
    await teclearPin('9753');
    await pulsar('confirmar-cierre-autorizado');

    expect(llamadas.confirmar).toBe(1);
    expect(porPrueba('confirmacion-de-cierre')).not.toBeNull();
    expect(porPrueba('revelacion-de-autorizacion')).toBeNull();
  });

  it('«Cancelar» retira la autorización en el proceso principal y vuelve al diálogo del PIN, sin monto y sin cerrar', async () => {
    const llamadas = instalarApiDeDosPasos(
      TURNO_PROPIO_SIN_TEORICO,
      [PIDE_PIN_A_LA_CAJERA, AUTORIZACION_VALIDADA],
      CIERRE_HECHO,
    );
    await montar();
    await irAContarYConfirmar();
    await teclearPin('9753');
    await pulsar('cancelar-cierre-autorizado');

    expect(llamadas.cancelar).toBe(1);
    expect(llamadas.confirmar).toBe(0);
    expect(porPrueba('revelacion-de-autorizacion')).toBeNull();
    expect(porPrueba('confirmacion-de-cierre')).toBeNull();
    expect(porPrueba('autorizacion-de-diferencia')).not.toBeNull();
    expect(porPrueba('mensaje-de-caja')?.textContent).toContain('sigue abierta');
    expect(texto()).not.toContain('630.50');
  });

  it('si la autorización ya no vale al confirmar, vuelve al diálogo del PIN y no muestra el cierre', async () => {
    instalarApiDeDosPasos(TURNO_PROPIO_SIN_TEORICO, [PIDE_PIN_A_LA_CAJERA, AUTORIZACION_VALIDADA], {
      ...PIDE_PIN_A_LA_CAJERA,
      codigo: 'AUTORIZACION_NO_VIGENTE',
      mensaje: 'La autorización venció. Tecleá el PIN de un administrador otra vez.',
    });
    await montar();
    await irAContarYConfirmar();
    await teclearPin('9753');
    await pulsar('confirmar-cierre-autorizado');

    expect(porPrueba('confirmacion-de-cierre')).toBeNull();
    expect(porPrueba('autorizacion-de-diferencia')).not.toBeNull();
    expect(porPrueba('mensaje-de-caja')?.textContent).toContain('venció');
  });
});

describe('UN PIN INCORRECTO NUNCA LLEGA A MOSTRAR NINGÚN MONTO', () => {
  it('se queda en el diálogo con el aviso del PIN, sin pantalla de revelación ni esperado', async () => {
    const llamadas = instalarApiDeDosPasos(
      TURNO_PROPIO_SIN_TEORICO,
      [PIDE_PIN_A_LA_CAJERA, { ...PIDE_PIN_A_LA_CAJERA, codigo: 'PIN_INCORRECTO', mensaje: 'PIN incorrecto.' }],
      CIERRE_HECHO,
    );
    await montar();
    await irAContarYConfirmar();
    await teclearPin('1111');

    expect(porPrueba('revelacion-de-autorizacion')).toBeNull();
    expect(porPrueba('mensaje-de-caja')?.textContent).toContain('PIN incorrecto');
    expect(texto()).not.toContain('630.50');
    expect(texto()).not.toContain('Debería haber');
    expect(llamadas.confirmar).toBe(0);
  });
});

// ===========================================================================
/**
 * LO QUE VIO JIMMY: el botón «Cerrar turno (requiere autorización)» no hacía
 * nada. El canal se RECHAZABA (el proceso principal no podía clonar su
 * respuesta) y la pantalla no atrapaba el rechazo: quedaba «trabajando» para
 * siempre, con el botón deshabilitado y sin ningún mensaje.
 */
describe('Si el canal se rechaza, la pantalla lo DICE y no se congela', () => {
  it('al cerrar: aparece el aviso de que no hubo respuesta y el botón vuelve a estar disponible', async () => {
    instalarApi(TURNO_DE_ROSA);
    const pos = (window as unknown as { pos: { caja: Record<string, unknown> } }).pos;
    pos.caja.cerrar = async (): Promise<unknown> =>
      Promise.reject(new Error('Error invoking remote method: An object could not be cloned.'));
    await montar();
    irAContar();

    act(() => {
      porPrueba('modo-simple')?.click();
    });
    for (const digito of '100') {
      act(() => {
        porPrueba(`tecla-${digito}`)?.click();
      });
    }
    const boton = (): HTMLButtonElement | null =>
      contenedor.querySelector<HTMLButtonElement>('[data-prueba="confirmar-caja"]');
    expect(boton()?.disabled).toBe(false);

    await act(async () => {
      boton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(porPrueba('mensaje-de-caja')?.textContent).toBe(MENSAJE_SIN_RESPUESTA);
    expect(boton()?.disabled).toBe(false);
    expect(porPrueba('autorizacion-de-caja-ajena')).toBeNull();
  });

  it('llamarAlProcesoPrincipal deja pasar una respuesta normal tal cual', async () => {
    const respuesta = await llamarAlProcesoPrincipal(async () =>
      Promise.resolve({ ok: true as const, datos: 7 }),
    );
    expect(respuesta).toEqual({ ok: true, datos: 7 });
  });

  it('LO QUE PASÓ DE VERDAD: una llamada que NUNCA contesta también termina en ok: false al vencer el límite', async () => {
    const respuesta = await llamarAlProcesoPrincipal(
      async () => new Promise<never>(() => undefined),
      20,
    );
    expect(respuesta).toEqual({
      ok: false,
      error: { codigo: CODIGO_SIN_RESPUESTA, mensaje: MENSAJE_SIN_RESPUESTA },
    });
  });

  it('el límite por omisión es de 15 segundos', () => {
    expect(LIMITE_DE_RESPUESTA_MS).toBe(15_000);
  });

  it('y convierte un rechazo en ok: false con su código, sin lanzar', async () => {
    const respuesta = await llamarAlProcesoPrincipal(async () => Promise.reject(new Error('x')));
    expect(respuesta).toEqual({
      ok: false,
      error: { codigo: CODIGO_SIN_RESPUESTA, mensaje: MENSAJE_SIN_RESPUESTA },
    });
  });
});
