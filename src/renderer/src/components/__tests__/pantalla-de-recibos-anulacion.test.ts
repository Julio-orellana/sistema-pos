/**
 * @vitest-environment jsdom
 *
 * El historial de recibos y el diálogo de anulación, sin proceso principal.
 *
 * Lo que se verifica es lo que ve y toca una persona, que es justo lo que
 * ninguna prueba del servicio puede ver:
 *
 *   · El botón «Anular» aparece SOLO en las ventas que el proceso principal
 *     marcó como anulables, y en las demás no se dibuja ningún botón, ni
 *     siquiera apagado.
 *   · Un voucher equivocado deja el mensaje y **NO abre el teclado del PIN**.
 *   · Cancelar en cualquier paso anterior al PIN correcto no manda ningún
 *     pedido con PIN: lo único que llegó al canal fue la consulta sin PIN, que
 *     no escribe nada.
 *   · El camino completo termina en una confirmación con los montos ajustados.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  AnulacionRegistradaIpc,
  PedidoDeAnulacionIpc,
  ReciboEnHistorialIpc,
  ResultadoDeAnulacionIpc,
  RespuestaIpc,
  VistaPreviaDeAnulacionIpc,
} from '@shared/types/ipc';
import { PantallaDeRecibos } from '../PantallaDeRecibos';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const PIN_CORRECTO = '2468';
const VOUCHER = '004512';
const MOTIVO = 'el cliente devolvió el producto';

const VENTA_EN_EFECTIVO = '11111111-1111-4111-8111-111111111111';
const VENTA_CON_TARJETA = '22222222-2222-4222-8222-222222222222';
const VENTA_DE_CAJA_CERRADA = '33333333-3333-4333-8333-333333333333';
const VENTA_YA_ANULADA = '44444444-4444-4444-8444-444444444444';

function recibo(
  id: string,
  ventaId: string,
  numeroRecibo: number,
  extra: Partial<ReciboEnHistorialIpc> = {},
): ReciboEnHistorialIpc {
  return {
    id,
    ventaId,
    numeroRecibo,
    fecha: '15/09/2026',
    hora: '10:02',
    cajero: 'Ana',
    total: '8.50',
    formaPago: 'efectivo',
    impreso: false,
    lineas: 1,
    conDescuento: false,
    anulacion: null,
    sePuedeAnular: true,
    ...extra,
  };
}

const HISTORIAL: readonly ReciboEnHistorialIpc[] = [
  recibo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', VENTA_EN_EFECTIVO, 4),
  recibo('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', VENTA_CON_TARJETA, 3, {
    formaPago: 'tarjeta',
    total: '4.25',
  }),
  recibo('cccccccc-cccc-4ccc-8ccc-cccccccccccc', VENTA_DE_CAJA_CERRADA, 2, {
    sePuedeAnular: false,
  }),
  recibo('dddddddd-dddd-4ddd-8ddd-dddddddddddd', VENTA_YA_ANULADA, 1, {
    sePuedeAnular: false,
    anulacion: {
      fecha: '15/09/2026',
      hora: '12:04',
      autorizadaPor: 'Jimmy',
      motivo: 'se cobró de más',
    },
  }),
];

const VISTA_PREVIA: VistaPreviaDeAnulacionIpc = {
  ventaId: VENTA_EN_EFECTIVO,
  numeroRecibo: 4,
  fecha: '2026-09-15T16:02:11.000Z',
  vendidaPor: { id: 'ana', nombre: 'Ana' },
  cajaAbiertaPor: { id: 'ana', nombre: 'Ana' },
  formaPago: 'efectivo',
  numBoleta: null,
  total: '8.50',
  lineas: [
    {
      productoId: 'maiz',
      nombreSnap: 'Maíz blanco',
      unidadSnap: 'lb',
      cantidad: '2.000',
      productoActivo: true,
    },
  ],
  productosDesactivados: [],
  avisoDeDevolucion: 'Hay que devolverle Q8.50 al cliente.',
};

const ANULACION_HECHA: AnulacionRegistradaIpc = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  ventaId: VENTA_EN_EFECTIVO,
  fecha: '2026-09-15T18:04:40.000Z',
  solicitadaPor: 'ana',
  autorizadaPor: 'jimmy',
  autorizadaVia: 'presencial',
  motivo: MOTIVO,
  numeroRecibo: 4,
  formaPago: 'efectivo',
  total: '8.50',
  efectivoQueDejaDeContar: '8.50',
  productos: [
    {
      productoId: 'maiz',
      nombreSnap: 'Maíz blanco',
      unidadSnap: 'lb',
      cantidad: '2.000',
      productoActivo: true,
      saldoAnterior: '96.000',
      saldoNuevo: '98.000',
    },
  ],
};

let contenedor: HTMLDivElement;
let raiz: Root;
/** Todo lo que la pantalla le mandó al canal `venta:anular`, en orden. */
let pedidos: PedidoDeAnulacionIpc[];

/**
 * El proceso principal de mentira. Contesta como el real:
 *
 *   · sin PIN, con la vista previa;
 *   · con el PIN correcto, con la anulación hecha;
 *   · con otro PIN, con `PIN_INCORRECTO`;
 *   · y con un voucher que no coincide, con un error, que es lo que hace que
 *     no se llegue a pedir el PIN.
 */
function instalarApi(): void {
  pedidos = [];
  (window as unknown as { pos: unknown }).pos = {
    recibos: {
      listar: (): Promise<RespuestaIpc<readonly ReciboEnHistorialIpc[]>> =>
        Promise.resolve({ ok: true, datos: HISTORIAL }),
      ver: (): Promise<unknown> => Promise.resolve({ ok: false, error: { codigo: 'X', mensaje: 'no' } }),
      reimprimir: (): Promise<unknown> =>
        Promise.resolve({ ok: false, error: { codigo: 'X', mensaje: 'no' } }),
    },
    venta: {
      anular: (pedido: PedidoDeAnulacionIpc): Promise<RespuestaIpc<ResultadoDeAnulacionIpc>> => {
        pedidos.push(pedido);

        if (pedido.ventaId === VENTA_CON_TARJETA && (pedido.voucher ?? '') !== VOUCHER) {
          return Promise.resolve({
            ok: false,
            error: {
              codigo: 'VOUCHER_NO_COINCIDE',
              mensaje: 'El voucher no coincide con el de la venta original.',
            },
          });
        }
        if (pedido.pin === null) {
          return Promise.resolve({
            ok: true,
            datos: {
              anulada: false,
              codigo: 'REQUIERE_AUTORIZACION',
              mensaje: 'Anular una venta exige el PIN de un administrador.',
              vistaPrevia: VISTA_PREVIA,
              segundosParaReintentar: null,
              anulacion: null,
            },
          });
        }
        if (pedido.pin !== PIN_CORRECTO) {
          return Promise.resolve({
            ok: true,
            datos: {
              anulada: false,
              codigo: 'PIN_INCORRECTO',
              mensaje: 'PIN incorrecto.',
              vistaPrevia: VISTA_PREVIA,
              segundosParaReintentar: null,
              anulacion: null,
            },
          });
        }
        return Promise.resolve({
          ok: true,
          datos: {
            anulada: true,
            codigo: 'ANULACION_CORRECTA',
            mensaje: 'Venta anulada. Hay que devolverle Q8.50 al cliente.',
            vistaPrevia: VISTA_PREVIA,
            segundosParaReintentar: null,
            anulacion: ANULACION_HECHA,
          },
        });
      },
    },
  };
}

async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(createElement(PantallaDeRecibos, { alVolver: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

function todos(nombre: string): HTMLElement[] {
  return [...contenedor.querySelectorAll<HTMLElement>(`[data-prueba="${nombre}"]`)];
}

/** La fila del historial de una venta. */
function fila(ventaId: string): HTMLElement {
  const encontrada = todos('fila-de-recibo').find((elemento) =>
    elemento.textContent.includes(numeroDe(ventaId)),
  );
  if (encontrada === undefined) {
    throw new Error(`No está la fila de la venta ${ventaId}.`);
  }
  return encontrada;
}

function numeroDe(ventaId: string): string {
  const fuente = HISTORIAL.find((recibo) => recibo.ventaId === ventaId);
  return `Recibo No. ${String(fuente?.numeroRecibo ?? 0)}`;
}

async function tocar(elemento: Element | null | undefined): Promise<void> {
  if (elemento === null || elemento === undefined) {
    throw new Error('No está el elemento a tocar.');
  }
  await act(async () => {
    (elemento as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Escribe en un campo del diálogo, como lo haría el teclado en pantalla. */
async function escribir(campo: string, texto: string): Promise<void> {
  const elemento = porPrueba(campo) as HTMLInputElement | null;
  if (elemento === null) {
    throw new Error(`No está el campo ${campo}.`);
  }
  /*
    Se usa el asignador NATIVO de `value` y no `elemento.value = …` porque React
    guarda el valor anterior en el nodo y, si se asigna por la propiedad que él
    reemplazó, no dispara `onChange`. Es la forma habitual de simular un tecleo
    sobre un campo controlado.
  */
  const asignarValor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set?.bind(elemento);
  if (asignarValor === undefined) {
    throw new Error('No se pudo tomar el asignador nativo de value.');
  }
  await act(async () => {
    asignarValor(texto);
    elemento.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

/** Teclea un PIN en el teclado numérico y confirma. */
async function teclearPin(pin: string): Promise<void> {
  for (const digito of pin) {
    await tocar(porPrueba(`tecla-${digito}`));
  }
  await tocar(porPrueba('tecla-confirmar'));
}

/** Abre el diálogo de anulación de una venta desde su fila. */
async function abrirAnulacion(ventaId: string): Promise<void> {
  await tocar(fila(ventaId).querySelector('[data-prueba="recibo-anular"]'));
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

// ===========================================================================
describe('EL BOTÓN «ANULAR» solo aparece donde se puede anular', () => {
  it('aparece en las ventas de la caja abierta y NO en las demás, ni apagado', async () => {
    await montar();

    expect(fila(VENTA_EN_EFECTIVO).querySelector('[data-prueba="recibo-anular"]')).not.toBeNull();
    expect(fila(VENTA_CON_TARJETA).querySelector('[data-prueba="recibo-anular"]')).not.toBeNull();
    // Ni el botón ni un botón deshabilitado: no está en el árbol.
    expect(fila(VENTA_DE_CAJA_CERRADA).querySelector('[data-prueba="recibo-anular"]')).toBeNull();
    expect(fila(VENTA_YA_ANULADA).querySelector('[data-prueba="recibo-anular"]')).toBeNull();
    expect(todos('recibo-anular')).toHaveLength(2);
  });

  it('la venta ya anulada se marca, con la fecha, quién autorizó y el motivo', async () => {
    await montar();
    const anulada = fila(VENTA_YA_ANULADA);
    expect(anulada.querySelector('[data-prueba="recibo-anulada"]')?.textContent).toBe('Anulada');
    expect(anulada.querySelector('[data-prueba="recibo-anulacion-detalle"]')?.textContent).toContain(
      'Anulada el 15/09/2026 12:04',
    );
    expect(anulada.querySelector('[data-prueba="recibo-anulacion-detalle"]')?.textContent).toContain(
      'Jimmy',
    );
    expect(anulada.querySelector('[data-prueba="recibo-anulacion-detalle"]')?.textContent).toContain(
      'se cobró de más',
    );
    // Y una que sigue en pie no lleva ninguna marca.
    expect(fila(VENTA_EN_EFECTIVO).querySelector('[data-prueba="recibo-anulada"]')).toBeNull();
  });
});

// ===========================================================================
describe('EL VOUCHER de una venta con tarjeta se pide ANTES de la vista previa', () => {
  it('el campo aparece solo con tarjeta, y sin él no se puede continuar', async () => {
    await montar();
    await abrirAnulacion(VENTA_CON_TARJETA);

    expect(porPrueba('anulacion-voucher')).not.toBeNull();
    await escribir('anulacion-motivo', MOTIVO);
    // Con el motivo escrito pero sin voucher, el botón sigue apagado.
    expect((porPrueba('anulacion-continuar') as HTMLButtonElement).disabled).toBe(true);
    expect(pedidos).toHaveLength(0);
  });

  it('en efectivo NO se pide voucher, y el pedido lo manda en null', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);

    expect(porPrueba('anulacion-voucher')).toBeNull();
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));

    expect(pedidos).toEqual([
      { ventaId: VENTA_EN_EFECTIVO, motivo: MOTIVO, voucher: null, pin: null },
    ]);
  });

  it('UN VOUCHER EQUIVOCADO deja el mensaje y NO abre el teclado del PIN', async () => {
    await montar();
    await abrirAnulacion(VENTA_CON_TARJETA);
    await escribir('anulacion-voucher', '999');
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));

    expect(porPrueba('anulacion-mensaje')?.textContent).toBe(
      'El voucher no coincide con el de la venta original.',
    );
    // Lo que importa: no se llegó al PIN.
    expect(porPrueba('tecla-confirmar')).toBeNull();
    expect(porPrueba('modal-de-anulacion')?.dataset.paso).toBe('formulario');
    // Y al canal solo llegó la consulta SIN PIN, que no escribe nada.
    expect(pedidos).toHaveLength(1);
    expect(pedidos.every((pedido) => pedido.pin === null)).toBe(true);
  });

  it('con el voucher CORRECTO sí llega la vista previa', async () => {
    await montar();
    await abrirAnulacion(VENTA_CON_TARJETA);
    await escribir('anulacion-voucher', VOUCHER);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));

    expect(porPrueba('modal-de-anulacion')?.dataset.paso).toBe('vista-previa');
    expect(pedidos.at(-1)?.voucher).toBe(VOUCHER);
  });
});

// ===========================================================================
describe('LA VISTA PREVIA muestra qué se va a anular', () => {
  it('el dinero que sale del cajón, el total, el motivo y lo que vuelve al inventario', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));

    expect(porPrueba('anulacion-aviso-devolucion')?.textContent).toBe(
      'Hay que devolverle Q8.50 al cliente.',
    );
    expect(porPrueba('anulacion-total')?.textContent).toBe('Q8.50');
    expect(porPrueba('anulacion-motivo-elegido')?.textContent).toBe(MOTIVO);
    expect(todos('anulacion-linea')).toHaveLength(1);
    expect(porPrueba('anulacion-lineas')?.textContent).toContain('Maíz blanco');
    expect(porPrueba('anulacion-lineas')?.textContent).toContain('2.000 lb');
  });

  it('NO muestra el efectivo teórico de la caja', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));

    const texto = porPrueba('modal-de-anulacion')?.textContent ?? '';
    expect(texto.toLowerCase()).not.toContain('teórico');
    expect(texto.toLowerCase()).not.toContain('esperado');
  });
});

// ===========================================================================
describe('CANCELAR antes del PIN correcto no manda ningún pedido con PIN', () => {
  it('cancelar en el FORMULARIO no llama al canal ni una vez', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-cancelar'));

    expect(porPrueba('modal-de-anulacion')).toBeNull();
    expect(pedidos).toEqual([]);
  });

  it('cancelar en la VISTA PREVIA deja solo la consulta sin PIN', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));
    await tocar(porPrueba('anulacion-cancelar'));

    expect(porPrueba('modal-de-anulacion')).toBeNull();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.pin).toBeNull();
  });

  it('cancelar CON EL TECLADO ABIERTO, sin confirmar, tampoco manda el PIN', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));
    await tocar(porPrueba('anulacion-autorizar'));
    // Se teclean los cuatro dígitos y NO se confirma: se cancela.
    for (const digito of PIN_CORRECTO) {
      await tocar(porPrueba(`tecla-${digito}`));
    }
    await tocar(porPrueba('anulacion-cancelar'));

    expect(porPrueba('modal-de-anulacion')).toBeNull();
    expect(pedidos.every((pedido) => pedido.pin === null)).toBe(true);
  });

  it('y se puede REINTENTAR después de cancelar: el diálogo vuelve a abrirse vacío', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-cancelar'));

    await abrirAnulacion(VENTA_EN_EFECTIVO);
    expect(porPrueba('modal-de-anulacion')?.dataset.paso).toBe('formulario');
    expect((porPrueba('anulacion-motivo') as HTMLInputElement).value).toBe('');
    expect((porPrueba('anulacion-continuar') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ===========================================================================
describe('EL PIN, y la confirmación con los montos ajustados', () => {
  it('un PIN equivocado se queda en el teclado con el motivo, sin anular', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));
    await tocar(porPrueba('anulacion-autorizar'));
    await teclearPin('0000');

    expect(porPrueba('modal-de-anulacion')?.dataset.paso).toBe('pin');
    expect(porPrueba('anulacion-mensaje')?.textContent).toBe('PIN incorrecto.');
    expect(porPrueba('anulacion-confirmacion')).toBeNull();
  });

  it('EL CAMINO COMPLETO: motivo, vista previa, PIN y confirmación con los montos ajustados', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));
    await tocar(porPrueba('anulacion-autorizar'));
    await teclearPin(PIN_CORRECTO);

    expect(porPrueba('modal-de-anulacion')?.dataset.paso).toBe('confirmacion');
    expect(porPrueba('anulacion-mensaje')?.textContent).toBe(
      'Venta anulada. Hay que devolverle Q8.50 al cliente.',
    );
    expect(porPrueba('anulacion-hecha-total')?.textContent).toBe('Q8.50');
    expect(porPrueba('anulacion-efectivo')?.textContent).toBe('Q8.50');
    expect(porPrueba('anulacion-repuestos')?.textContent).toContain('96.000 → 98.000 lb');

    // El PIN viajó una sola vez, y nunca queda en la pantalla.
    expect(pedidos.filter((pedido) => pedido.pin !== null)).toHaveLength(1);
    expect(porPrueba('modal-de-anulacion')?.textContent).not.toContain(PIN_CORRECTO);
  });

  it('al cerrar la confirmación, el historial avisa y se vuelve a leer', async () => {
    await montar();
    await abrirAnulacion(VENTA_EN_EFECTIVO);
    await escribir('anulacion-motivo', MOTIVO);
    await tocar(porPrueba('anulacion-continuar'));
    await tocar(porPrueba('anulacion-autorizar'));
    await teclearPin(PIN_CORRECTO);
    await tocar(porPrueba('anulacion-listo'));

    expect(porPrueba('modal-de-anulacion')).toBeNull();
    expect(porPrueba('recibos-aviso')?.textContent).toContain('Venta del recibo 4 anulada');
    expect(porPrueba('recibos-aviso')?.textContent).toContain('Q8.50');
  });
});
