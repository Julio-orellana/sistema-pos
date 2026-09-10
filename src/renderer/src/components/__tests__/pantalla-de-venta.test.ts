/**
 * @vitest-environment jsdom
 *
 * La pantalla de venta: acceso condicionado, cuadrícula y ticket.
 *
 * Lo que se verifica es que la pantalla NO muestre la cuadrícula sin una caja
 * propia abierta, que el ticket se arme como el cajero espera, y que ninguna
 * acción destructiva ocurra sin confirmar. El cobro no existe todavía y la
 * pantalla tiene que decirlo, no simularlo.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { EstadoDeVenta, ProductoParaVender } from '@shared/types/ipc';
import { PantallaDeVenta } from '../PantallaDeVenta';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const MAIZ: ProductoParaVender = {
  id: 'p-maiz',
  nombre: 'Maíz blanco',
  categoriaId: 'c-granos',
  categoriaNombre: 'Granos',
  tipoMedida: 'peso',
  unidadPeso: 'lb',
  cantidadPredefinidaIcono: '1.000',
  precioBase: '4.25',
  inventarioDisponible: '8.000',
  fotoUrl: null,
  contadorVentas: 0,
};

const HUEVOS: ProductoParaVender = {
  id: 'p-huevos',
  nombre: 'Huevos, cartón de 30',
  categoriaId: 'c-huevos',
  categoriaNombre: 'Huevos',
  tipoMedida: 'unidad',
  unidadPeso: null,
  cantidadPredefinidaIcono: '1.000',
  precioBase: '42.00',
  inventarioDisponible: '24.000',
  fotoUrl: null,
  contadorVentas: 0,
};

/** El estado que devuelve el proceso principal cuando SÍ se puede vender. */
const PUEDE_VENDER: EstadoDeVenta = {
  puedeVender: true,
  motivo: null,
  turnoAbierto: {
    id: 't-1',
    montoInicial: '500.00',
    abiertaEn: '2026-09-09T14:00:00.000Z',
    abiertaPorId: 'u-rosa',
    abiertaPorNombre: 'Rosa',
    esDeOtroUsuario: false,
  },
  categorias: [
    { id: 'c-granos', nombre: 'Granos', productos: 1 },
    { id: 'c-huevos', nombre: 'Huevos', productos: 1 },
  ],
  productos: [MAIZ, HUEVOS],
};

let contenedor: HTMLDivElement;
let raiz: Root;
let fueACaja: number;

function instalarApi(estado: EstadoDeVenta): void {
  fueACaja = 0;
  (window as unknown as { pos: unknown }).pos = {
    venta: {
      estado: async (): Promise<unknown> => Promise.resolve({ ok: true as const, datos: estado }),
    },
  };
}

async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(
      createElement(PantallaDeVenta, {
        alVolver: () => undefined,
        alIrACaja: () => {
          fueACaja += 1;
        },
      }),
    );
    await Promise.resolve();
  });
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

function todos(nombre: string): HTMLElement[] {
  return [...contenedor.querySelectorAll<HTMLElement>(`[data-prueba="${nombre}"]`)];
}

function exigir(nombre: string): HTMLElement {
  const elemento = porPrueba(nombre);
  if (elemento === null) {
    throw new Error(`No se encontró [data-prueba="${nombre}"].`);
  }
  return elemento;
}

async function clic(elemento: HTMLElement): Promise<void> {
  await act(async () => {
    elemento.click();
    await Promise.resolve();
  });
}

/** Toca el ícono del producto con el id dado. */
async function tocarProducto(id: string): Promise<void> {
  const icono = contenedor.querySelector<HTMLElement>(
    `[data-prueba="icono-producto"][data-producto="${id}"]`,
  );
  if (icono === null) {
    throw new Error(`No hay ícono para ${id}.`);
  }
  await clic(icono);
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
describe('Sin caja abierta NO se muestra la pantalla de venta', () => {
  beforeEach(() => {
    instalarApi({
      puedeVender: false,
      motivo: 'SIN_CAJA_ABIERTA',
      turnoAbierto: null,
      categorias: [],
      productos: [],
    });
  });

  it('no dibuja la cuadrícula de productos', async () => {
    await montar();

    expect(porPrueba('cuadricula-de-productos')).toBeNull();
    expect(porPrueba('ticket-de-venta')).toBeNull();
  });

  it('explica por qué y ofrece ir a abrir la caja', async () => {
    await montar();

    expect(porPrueba('venta-bloqueada-sin-caja')).not.toBeNull();
    expect(contenedor.textContent).toContain('No hay ninguna caja abierta');

    await clic(exigir('ir-a-caja-desde-venta'));
    expect(fueACaja).toBe(1);
  });
});

// ===========================================================================
describe('Con la caja de OTRA persona tampoco se vende', () => {
  beforeEach(() => {
    instalarApi({
      puedeVender: false,
      motivo: 'CAJA_DE_OTRO_USUARIO',
      turnoAbierto: {
        id: 't-1',
        montoInicial: '500.00',
        abiertaEn: '2026-09-09T14:00:00.000Z',
        abiertaPorId: 'u-rosa',
        abiertaPorNombre: 'Rosa',
        esDeOtroUsuario: true,
      },
      categorias: [],
      productos: [],
    });
  });

  it('no dibuja la cuadrícula', async () => {
    await montar();
    expect(porPrueba('cuadricula-de-productos')).toBeNull();
  });

  it('dice de quién es la caja', async () => {
    await montar();

    expect(porPrueba('venta-bloqueada-caja-ajena')).not.toBeNull();
    expect(porPrueba('abierta-por')?.textContent).toBe('Rosa');
  });

  it('NO ofrece autorizar con PIN: manda a cerrar ese turno primero', async () => {
    await montar();

    // Vender es continuo; una autorización dejaría toda una tarde de ventas
    // atribuidas a quien no estaba. La salida es cerrar la caja ajena, que ya
    // tiene su propio flujo autorizado.
    expect(contenedor.textContent).not.toContain('PIN');
    expect(exigir('ir-a-caja-desde-venta').textContent).toContain('cerrar ese turno');
  });
});

// ===========================================================================
describe('Con caja propia abierta, la venta funciona', () => {
  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  it('muestra la cuadrícula y el ticket vacío', async () => {
    await montar();

    expect(porPrueba('cuadricula-de-productos')).not.toBeNull();
    expect(porPrueba('ticket-vacio')).not.toBeNull();
    expect(porPrueba('total-del-ticket')?.textContent).toContain('0.00');
  });

  it('tocar un producto agrega su línea con la cantidad predefinida', async () => {
    await montar();
    await tocarProducto('p-maiz');

    expect(todos('linea-de-ticket')).toHaveLength(1);
    expect(porPrueba('total-del-ticket')?.textContent).toContain('4.25');
  });

  it('TOCARLO DE NUEVO suma en la misma línea, no duplica', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await tocarProducto('p-maiz');

    expect(todos('linea-de-ticket')).toHaveLength(1);
    expect(porPrueba('total-del-ticket')?.textContent).toContain('8.50');
  });

  it('productos distintos sí son líneas distintas', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await tocarProducto('p-huevos');

    expect(todos('linea-de-ticket')).toHaveLength(2);
    expect(porPrueba('total-del-ticket')?.textContent).toContain('46.25');
  });

  it('filtrar por categoría deja solo sus productos', async () => {
    await montar();
    const pestanas = todos('categoria');
    await clic(pestanas[1]!);

    expect(contenedor.textContent).toContain('Huevos');
    expect(
      contenedor.querySelector('[data-prueba="icono-producto"][data-producto="p-maiz"]'),
    ).toBeNull();
  });

  it('quitar una línea la saca del ticket', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('quitar-linea'));

    expect(todos('linea-de-ticket')).toHaveLength(0);
  });
});

// ===========================================================================
describe('Vaciar el ticket exige confirmación', () => {
  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  it('el primer toque solo abre la confirmación, no borra nada', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('vaciar-ticket'));

    expect(porPrueba('confirmar-vaciar')).not.toBeNull();
    expect(todos('linea-de-ticket')).toHaveLength(1);
  });

  it('confirmando SÍ se vacía', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('vaciar-ticket'));
    await clic(exigir('confirmar-vaciar-si'));

    expect(todos('linea-de-ticket')).toHaveLength(0);
    expect(porPrueba('ticket-vacio')).not.toBeNull();
  });

  it('arrepintiéndose, el ticket queda intacto', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await tocarProducto('p-huevos');
    await clic(exigir('vaciar-ticket'));
    await clic(exigir('confirmar-vaciar-no'));

    expect(porPrueba('confirmar-vaciar')).toBeNull();
    expect(todos('linea-de-ticket')).toHaveLength(2);
  });

  it('con el ticket vacío el botón de cancelar está deshabilitado', async () => {
    await montar();
    expect((exigir('vaciar-ticket') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ===========================================================================
describe('Corregir la cantidad con el teclado táctil', () => {
  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  it('tocar una línea abre el teclado', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('tocar-linea'));

    expect(porPrueba('editar-cantidad')).not.toBeNull();
  });

  it('un producto por PESO ofrece el punto decimal', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('tocar-linea'));

    expect(porPrueba('tecla-punto')).not.toBeNull();
  });

  it('un producto por UNIDAD no ofrece el punto decimal', async () => {
    await montar();
    await tocarProducto('p-huevos');
    await clic(exigir('tocar-linea'));

    expect(porPrueba('tecla-punto')).toBeNull();
  });

  it('la cantidad tecleada REEMPLAZA la anterior y recalcula el total', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('tocar-linea'));

    for (const digito of ['2', 'punto', '5']) {
      await clic(exigir(`tecla-${digito}`));
    }
    await clic(exigir('tecla-confirmar'));

    // 2.5 lb × Q4.25 = Q10.625 → Q10.63
    expect(porPrueba('editar-cantidad')).toBeNull();
    expect(porPrueba('total-del-ticket')?.textContent).toContain('10.63');
  });
});

// ===========================================================================
describe('El aviso de inventario avisa sin bloquear', () => {
  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  it('no aparece mientras la cantidad cabe', async () => {
    await montar();
    await tocarProducto('p-maiz');

    expect(porPrueba('aviso-de-inventario')).toBeNull();
  });

  it('aparece al pasarse, diciendo cuánto hay', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('tocar-linea'));
    for (const digito of ['1', '2']) {
      await clic(exigir(`tecla-${digito}`));
    }
    await clic(exigir('tecla-confirmar'));

    expect(porPrueba('aviso-de-inventario')?.textContent).toContain('Solo hay 8 lb');
  });

  it('NO impide seguir editando ni cobrar: es un aviso, no un candado', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('tocar-linea'));
    for (const digito of ['1', '2']) {
      await clic(exigir(`tecla-${digito}`));
    }
    await clic(exigir('tecla-confirmar'));

    expect(porPrueba('aviso-de-inventario')).not.toBeNull();
    // La línea sigue editable y el botón de cobrar sigue habilitado.
    expect((exigir('cobrar') as HTMLButtonElement).disabled).toBe(false);
    await clic(exigir('tocar-linea'));
    expect(porPrueba('editar-cantidad')).not.toBeNull();
  });
});

// ===========================================================================
describe('El botón de cobrar todavía no cobra, y lo dice', () => {
  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  it('está deshabilitado con el ticket vacío', async () => {
    await montar();
    expect((exigir('cobrar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('con el ticket lleno avisa que el cobro llega en otro módulo', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));

    // Ni simula un cobro exitoso ni se queda mudo: las dos cosas engañarían al
    // cajero de maneras distintas.
    expect(porPrueba('aviso-de-cobro')?.textContent).toContain('siguiente módulo');
    expect(todos('linea-de-ticket')).toHaveLength(1);
  });
});
