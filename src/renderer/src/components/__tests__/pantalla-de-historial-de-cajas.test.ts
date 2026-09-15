/**
 * @vitest-environment jsdom
 *
 * La pantalla del historial de cajas, sin proceso principal (§4.44).
 *
 * Se verifica que cada uno de los cuatro casos se VEA distinto en la lista —
 * no solo que los datos lleguen— y que los filtros manden lo que la persona
 * eligió. Los datos vienen con la forma exacta que devuelve el servicio.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  DetalleDeSesionDeCajaIpc,
  FiltroDeHistorialDeCajasIpc,
  HistorialDeCajasIpc,
  SesionDeCajaEnHistorialIpc,
} from '@shared/types/ipc';
import { PantallaDeHistorialDeCajas } from '../PantallaDeHistorialDeCajas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const JIMMY = { id: 'j', nombre: 'Jimmy' };
const ANA = { id: 'a', nombre: 'Ana' };
const ROSA = { id: 'r', nombre: 'Rosa' };

const base = { montoInicial: '500.00', cantidadDeConteosSellados: 0, reconteo: null, avisos: [] as string[] };

const CON_DIFERENCIA: SesionDeCajaEnHistorialIpc = {
  ...base,
  id: 'sesion-a',
  estado: 'cerrada',
  abiertaEn: '2026-09-10T16:00:00.000Z',
  abiertaPor: ANA,
  cantidadDeConteosSellados: 1,
  cierre: {
    cerradaEn: '2026-09-10T23:00:00.000Z',
    cerradaPor: ANA,
    cerradaPorOtraPersona: false,
    cierreAjenoAutorizadoPor: null,
    montoTeorico: '500.00',
    montoReal: '480.00',
    diferencia: '-20.00',
    tipoDeDiferencia: 'faltante',
    diferenciaAutorizada: { por: JIMMY, via: 'remoto' },
  },
};

const SIN_DIFERENCIA: SesionDeCajaEnHistorialIpc = {
  ...base,
  id: 'sesion-b',
  estado: 'cerrada',
  abiertaEn: '2026-09-11T16:00:00.000Z',
  abiertaPor: ANA,
  cierre: {
    cerradaEn: '2026-09-11T23:00:00.000Z',
    cerradaPor: ANA,
    cerradaPorOtraPersona: false,
    cierreAjenoAutorizadoPor: null,
    montoTeorico: '500.00',
    montoReal: '500.00',
    diferencia: '0.00',
    tipoDeDiferencia: 'cuadra',
    diferenciaAutorizada: null,
  },
};

const AJENA: SesionDeCajaEnHistorialIpc = {
  ...base,
  id: 'sesion-c',
  estado: 'cerrada',
  abiertaEn: '2026-09-13T05:30:00.000Z',
  abiertaPor: ROSA,
  montoInicial: '300.00',
  cierre: {
    cerradaEn: '2026-09-13T05:45:00.000Z',
    cerradaPor: JIMMY,
    cerradaPorOtraPersona: true,
    cierreAjenoAutorizadoPor: JIMMY,
    montoTeorico: '300.00',
    montoReal: '300.00',
    diferencia: '0.00',
    tipoDeDiferencia: 'cuadra',
    diferenciaAutorizada: null,
  },
};

const RECONTEO: SesionDeCajaEnHistorialIpc = {
  ...base,
  id: 'sesion-d',
  estado: 'cerrada',
  abiertaEn: '2026-09-13T16:00:00.000Z',
  abiertaPor: ANA,
  cantidadDeConteosSellados: 1,
  cierre: {
    cerradaEn: '2026-09-13T23:02:00.000Z',
    cerradaPor: ANA,
    cerradaPorOtraPersona: false,
    cierreAjenoAutorizadoPor: null,
    montoTeorico: '500.00',
    montoReal: '500.00',
    diferencia: '0.00',
    tipoDeDiferencia: 'cuadra',
    diferenciaAutorizada: null,
  },
  reconteo: {
    fecha: '2026-09-13T23:02:00.000Z',
    conteosSellados: [{ fecha: '2026-09-13T23:00:00.000Z', montoEsperado: '500.00', montoReal: '480.00', diferencia: '-20.00' }],
    conteoFinal: { montoEsperado: '500.00', montoReal: '500.00', diferencia: '0.00' },
    autorizadoPor: JIMMY,
    via: 'presencial',
  },
};

const ABIERTA: SesionDeCajaEnHistorialIpc = {
  ...base,
  id: 'sesion-e',
  estado: 'abierta',
  abiertaEn: '2026-09-14T16:00:00.000Z',
  abiertaPor: ROSA,
  montoInicial: '200.00',
  cantidadDeConteosSellados: 1,
  cierre: null,
};

const HISTORIAL: HistorialDeCajasIpc = {
  sesiones: [ABIERTA, RECONTEO, AJENA, SIN_DIFERENCIA, CON_DIFERENCIA],
  periodo: null,
  personasQueAbrieron: [ANA, ROSA],
};

let contenedor: HTMLDivElement;
let raiz: Root;
let filtrosPedidos: FiltroDeHistorialDeCajasIpc[];
let detallesPedidos: string[];

function instalarApi(): void {
  filtrosPedidos = [];
  detallesPedidos = [];
  (window as unknown as { pos: unknown }).pos = {
    historialDeCajas: {
      listar: (filtro: FiltroDeHistorialDeCajasIpc): Promise<unknown> => {
        filtrosPedidos.push(filtro);
        const sesiones = HISTORIAL.sesiones.filter((s) => filtro.abiertaPor === null || s.abiertaPor.id === filtro.abiertaPor);
        return Promise.resolve({
          ok: true,
          datos: {
            ...HISTORIAL,
            sesiones,
            periodo:
              filtro.desde === null ? null : { clase: 'personalizado', desdeDia: filtro.desde, hastaDia: filtro.hasta, etiqueta: 'rango' },
          },
        });
      },
      detalle: (id: string): Promise<unknown> => {
        detallesPedidos.push(id);
        const sesion = HISTORIAL.sesiones.find((s) => s.id === id)!;
        const detalle: DetalleDeSesionDeCajaIpc = {
          sesion,
          conteosSellados: sesion.reconteo?.conteosSellados ?? [],
          desgloseDeApertura:
            id === 'sesion-b'
              ? {
                  lineas: [
                    { valor: '100.00', tipo: 'billete', cantidad: 1, subtotal: '100.00' },
                    { valor: '200.00', tipo: 'billete', cantidad: 2, subtotal: '400.00' },
                  ],
                  total: '500.00',
                }
              : null,
          desgloseDeCierre: null,
        };
        return Promise.resolve({ ok: true, datos: detalle });
      },
    },
  };
}

async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(createElement(PantallaDeHistorialDeCajas, { alVolver: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fila(id: string): HTMLElement {
  const elemento = contenedor.querySelector<HTMLElement>(`[data-prueba="historial-fila"][data-id="${id}"]`);
  if (elemento === null) {
    throw new Error(`No está la fila ${id}.`);
  }
  return elemento;
}

function dentro(elemento: ParentNode, prueba: string): HTMLElement | null {
  return elemento.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`);
}

async function tocar(elemento: HTMLElement | null): Promise<void> {
  if (elemento === null) {
    throw new Error('No está el elemento a tocar.');
  }
  await act(async () => {
    elemento.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  instalarApi();
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  contenedor.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('La lista: cada caso se ve distinto', () => {
  it('al entrar pide TODAS las sesiones, sin filtros, y las muestra en el orden recibido', async () => {
    await montar();
    expect(filtrosPedidos).toEqual([{ desde: null, hasta: null, abiertaPor: null }]);
    const ids = [...contenedor.querySelectorAll('[data-prueba="historial-fila"]')].map((e) => e.getAttribute('data-id'));
    expect(ids).toEqual(['sesion-e', 'sesion-d', 'sesion-c', 'sesion-b', 'sesion-a']);
  });

  it('CON DIFERENCIA AUTORIZADA: el faltante y quién lo autorizó por teléfono', async () => {
    await montar();
    const a = fila('sesion-a');
    expect(dentro(a, 'historial-cierre')?.textContent).toContain('faltante de Q20.00');
    expect(dentro(a, 'historial-cierre')?.textContent).toContain('teórico Q500.00');
    expect(dentro(a, 'historial-autorizacion')?.textContent).toBe('Diferencia autorizada por Jimmy, por teléfono (PIN remoto)');
    expect(dentro(a, 'historial-etiqueta-reconteo')).toBeNull();
    expect(dentro(a, 'historial-etiqueta-ajena')).toBeNull();
  });

  it('SIN DIFERENCIA: dice que cuadra y no muestra autorización ni etiquetas', async () => {
    await montar();
    const b = fila('sesion-b');
    expect(dentro(b, 'historial-cierre')?.textContent).toContain('cuadra');
    expect(dentro(b, 'historial-autorizacion')).toBeNull();
    expect(b.querySelectorAll('.etiqueta')).toHaveLength(0);
  });

  it('CERRADA POR OTRA PERSONA: abrió Rosa, cerró Jimmy, con su etiqueta', async () => {
    await montar();
    const c = fila('sesion-c');
    expect(c.textContent).toContain('Abrió Rosa');
    expect(dentro(c, 'historial-cierre')?.textContent).toContain('Cerró Jimmy (otra persona)');
    expect(dentro(c, 'historial-etiqueta-ajena')?.textContent).toBe('Cerrada por otra persona');
  });

  it('RECUENTO CORREGIDO: la etiqueta dice el primer conteo, el final y quién autorizó, sin abrir el detalle', async () => {
    await montar();
    const d = fila('sesion-d');
    expect(dentro(d, 'historial-etiqueta-reconteo')?.textContent).toBe(
      'Recuento corregido: contó Q480.00, cerró con Q500.00 · autorizó Jimmy, en persona',
    );
  });

  it('ABIERTA: la etiqueta y el conteo con diferencia ya registrado', async () => {
    await montar();
    const e = fila('sesion-e');
    expect(dentro(e, 'historial-etiqueta-abierta')?.textContent).toBe('Abierta');
    expect(dentro(e, 'historial-cierre')).toBeNull();
    expect(dentro(e, 'historial-sellos-pendientes')?.textContent).toBe('Tiene un conteo con diferencia ya registrado');
  });
});

describe('Los filtros', () => {
  it('mandan el rango y la persona elegidos, y «Quitar filtros» vuelve a pedir todo', async () => {
    await montar();
    const desde = dentro(contenedor, 'historial-desde') as HTMLInputElement;
    const hasta = dentro(contenedor, 'historial-hasta') as HTMLInputElement;
    const persona = dentro(contenedor, 'historial-abierta-por') as HTMLSelectElement;
    const cambiar = (elemento: HTMLInputElement | HTMLSelectElement, valor: string): void => {
      const prototipo = Object.getPrototypeOf(elemento) as object;
      const escribirValor = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set?.bind(elemento);
      act(() => {
        escribirValor?.(valor);
        elemento.dispatchEvent(new Event(elemento instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      });
    };
    cambiar(desde, '2026-09-10');
    cambiar(hasta, '2026-09-12');
    cambiar(persona, 'r');
    await tocar(dentro(contenedor, 'historial-aplicar'));

    expect(filtrosPedidos.at(-1)).toEqual({ desde: '2026-09-10', hasta: '2026-09-12', abiertaPor: 'r' });
    const ids = [...contenedor.querySelectorAll('[data-prueba="historial-fila"]')].map((e) => e.getAttribute('data-id'));
    expect(ids).toEqual(['sesion-e', 'sesion-c']);
    expect(dentro(contenedor, 'historial-periodo')?.textContent).toBe('Aperturas del rango');

    await tocar(dentro(contenedor, 'historial-quitar-filtros'));
    expect(filtrosPedidos.at(-1)).toEqual({ desde: null, hasta: null, abiertaPor: null });
  });

  it('el selector ofrece solo a quienes abrieron alguna caja', async () => {
    await montar();
    const opciones = [...(dentro(contenedor, 'historial-abierta-por') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opciones).toEqual(['Cualquier persona', 'Ana', 'Rosa']);
  });
});

describe('El detalle', () => {
  it('RECUENTO CORREGIDO: muestra el primer conteo, el final y quién autorizó la corrección', async () => {
    await montar();
    await tocar(dentro(fila('sesion-d'), 'historial-ver'));
    expect(detallesPedidos).toEqual(['sesion-d']);
    const reconteo = dentro(contenedor, 'detalle-reconteo');
    expect(reconteo?.textContent).toContain('La corrección la autorizó Jimmy, en persona');
    expect(dentro(contenedor, 'detalle-reconteo-sellado')?.textContent).toContain('Primer conteo: Q480.00 contra Q500.00 teórico, diferencia −Q20.00');
    expect(dentro(contenedor, 'detalle-reconteo-final')?.textContent).toContain('Conteo final: Q500.00');
  });

  it('CERRADA POR OTRA PERSONA: quién cerró y quién autorizó el cierre ajeno', async () => {
    await montar();
    await tocar(dentro(fila('sesion-c'), 'historial-ver'));
    expect(dentro(contenedor, 'detalle-cerro')?.textContent).toBe('Jimmy — otra persona, no quien abrió');
    expect(dentro(contenedor, 'detalle-cierre-ajeno')?.textContent).toBe('Jimmy');
  });

  it('con desglose por denominación: renglones y total; sin desglose, lo dice', async () => {
    await montar();
    await tocar(dentro(fila('sesion-b'), 'historial-ver'));
    const apertura = dentro(contenedor, 'detalle-desglose-apertura');
    expect(apertura?.textContent).toContain('2 × Q200.00 = Q400.00');
    expect(dentro(contenedor, 'detalle-desglose-apertura-total')?.textContent).toBe('Q500.00');
    expect(dentro(contenedor, 'detalle-desglose-cierre')?.textContent).toContain('sin desglose por denominación');
  });

  it('«Volver a la lista» vuelve a la lista', async () => {
    await montar();
    await tocar(dentro(fila('sesion-a'), 'historial-ver'));
    await tocar(dentro(contenedor, 'detalle-volver'));
    expect(dentro(contenedor, 'historial-lista')).not.toBeNull();
  });
});
