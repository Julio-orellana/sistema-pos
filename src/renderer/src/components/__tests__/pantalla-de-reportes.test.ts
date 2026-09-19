/**
 * @vitest-environment jsdom
 *
 * El resumen de ventas y su contador de anulaciones autorizadas a distancia
 * (spec 003, CA-18), sin proceso principal.
 *
 * Lo que se verifica es lo que ve una persona y que ninguna prueba del
 * servicio puede ver: que el renglón aparezca TAMBIÉN cuando el período no
 * tiene ninguna venta completada. Es justo el caso que importa: si la única
 * venta del día se anuló por teléfono, el resumen dice «No hay ventas» y el
 * contador tiene que seguir a la vista.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { PeriodoIpc, RespuestaIpc, ResumenDeVentasIpc } from '@shared/types/ipc';
import { PantallaDeReportes } from '../PantallaDeReportes';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const PERIODO = {
  clase: 'hoy',
  desdeDia: '2026-09-19',
  hastaDia: '2026-09-19',
  etiqueta: 'Hoy · 19/09/2026',
} as const;

const CON_VENTAS: ResumenDeVentasIpc = {
  periodo: PERIODO,
  totalVendido: '21.00',
  cantidadDeVentas: 2,
  totalEnEfectivo: '12.00',
  totalEnTarjeta: '9.00',
  ventasEnEfectivo: 1,
  ventasEnTarjeta: 1,
  totalDeDescuentos: '0.00',
  ventasConDescuento: 0,
  anulacionesRemotas: 7,
};

let contenedor: HTMLDivElement;
let raiz: Root;
/** Lo que devuelve el canal del resumen. Cada prueba lo fija. */
let resumenQueDevuelveElCanal: ResumenDeVentasIpc;

function instalarApi(): void {
  (window as unknown as { pos: unknown }).pos = {
    reportes: {
      resumenDeVentas: (_periodo: PeriodoIpc): Promise<RespuestaIpc<ResumenDeVentasIpc>> =>
        Promise.resolve({ ok: true, datos: resumenQueDevuelveElCanal }),
      ventasPorProducto: (): Promise<unknown> =>
        Promise.resolve({ ok: false, error: { codigo: 'X', mensaje: 'no' } }),
      inventario: (): Promise<unknown> =>
        Promise.resolve({ ok: false, error: { codigo: 'X', mensaje: 'no' } }),
    },
  };
}

async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(createElement(PantallaDeReportes, { alVolver: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  resumenQueDevuelveElCanal = CON_VENTAS;
  instalarApi();
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  contenedor.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('SPEC 003 (CA-18) — EL CONTADOR DE ANULACIONES AUTORIZADAS A DISTANCIA', () => {
  it('con ventas, el renglón se ve con el número tal cual lo mandó el proceso principal', async () => {
    await montar();

    expect(porPrueba('resumen-total')?.textContent).toBe('Q21.00');
    expect(porPrueba('resumen-anulaciones-remotas')?.textContent).toBe('7');
    expect(porPrueba('reporte-resumen')?.textContent).toContain(
      'Anulaciones autorizadas a distancia',
    );
  });

  it('SIN NINGUNA VENTA COMPLETADA el renglón SIGUE a la vista: es el caso de la única venta anulada por teléfono', async () => {
    resumenQueDevuelveElCanal = {
      ...CON_VENTAS,
      totalVendido: '0.00',
      cantidadDeVentas: 0,
      totalEnEfectivo: '0.00',
      totalEnTarjeta: '0.00',
      ventasEnEfectivo: 0,
      ventasEnTarjeta: 0,
      anulacionesRemotas: 1,
    };

    await montar();

    // Control: de verdad es la rama sin ventas.
    expect(porPrueba('resumen-sin-ventas')).not.toBeNull();
    expect(porPrueba('resumen-total')).toBeNull();
    expect(porPrueba('resumen-anulaciones-remotas')?.textContent).toBe('1');
  });

  it('en cero se dibuja el 0: no se esconde el renglón', async () => {
    resumenQueDevuelveElCanal = { ...CON_VENTAS, anulacionesRemotas: 0 };

    await montar();

    expect(porPrueba('resumen-anulaciones-remotas')?.textContent).toBe('0');
  });
});
