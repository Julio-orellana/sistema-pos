/**
 * @vitest-environment jsdom
 *
 * La pantalla de venta: acceso condicionado, cuadrícula y ticket.
 *
 * Lo que se verifica es que la pantalla NO muestre la cuadrícula sin una caja
 * propia abierta, que el ticket se arme como el cajero espera, que ninguna
 * acción destructiva ocurra sin confirmar, y que después de cobrar la pantalla
 * quede lista para la siguiente venta en vez de dejar el ticket cobrado a la
 * vista.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  ImpresionDeReciboTerminadaIpc,
  EstadoDeVenta,
  PedidoDeCobro,
  ProductoParaVender,
  ResultadoDeCobro,
} from '@shared/types/ipc';
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
  precioEfectivo: '4.25',
  precioEspecial: null,
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
  precioEfectivo: '42.00',
  precioEspecial: null,
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
    ventasEnEfectivo: '0.00',
    cantidadDeVentasEnEfectivo: 0,
    montoTeorico: '500.00',
    primerConteoSellado: null,
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

/** Los pedidos de cobro que la pantalla mandó, en orden. */
let cobrosPedidos: PedidoDeCobro[];

/** Lo que el proceso principal simulado va a responder a cada cobro, en orden. */
let respuestasDeCobro: ResultadoDeCobro[];

/** Una venta registrada de mentira, para el camino feliz. */
const VENTA_OK: ResultadoDeCobro = {
  registrada: true,
  ventaId: 'v-1',
  fecha: '2026-09-10T15:00:00.000Z',
  subtotal: '4.25',
  descuentoAplicado: '0.00',
  total: '4.25',
  formaPago: 'efectivo',
  numBoleta: null,
  lineas: 1,
  lineasConPrecioEspecial: 0,
  recibo: {
    id: 'r-1',
    numeroRecibo: 1,
    rutaPdf: '/pdf/recibo-000001.pdf',
    pdfGenerado: true,
    impreso: false,
    impresionPendiente: true,
    mensajeDeImpresion: 'Enviando el recibo a la impresora…',
  },
};

/**
 * Los suscriptores al aviso de impresión terminada. La prueba manda el aviso
 * cuando quiere, como lo haría el proceso principal al contestar la impresora.
 */
let suscriptoresDeImpresion: ((aviso: ImpresionDeReciboTerminadaIpc) => void)[] = [];

async function avisarImpresion(aviso: ImpresionDeReciboTerminadaIpc): Promise<void> {
  await act(async () => {
    for (const suscriptor of suscriptoresDeImpresion) {
      suscriptor(aviso);
    }
    await Promise.resolve();
  });
}

function instalarApi(estado: EstadoDeVenta): void {
  fueACaja = 0;
  suscriptoresDeImpresion = [];
  cobrosPedidos = [];
  respuestasDeCobro = [VENTA_OK];
  (window as unknown as { pos: unknown }).pos = {
    venta: {
      estado: async (): Promise<unknown> => Promise.resolve({ ok: true as const, datos: estado }),
      cobrar: async (pedido: PedidoDeCobro): Promise<unknown> => {
        cobrosPedidos.push(pedido);
        const respuesta = respuestasDeCobro.shift() ?? VENTA_OK;
        return Promise.resolve({ ok: true as const, datos: respuesta });
      },
    },
    recibos: {
      alTerminarImpresion: (alRecibir: (aviso: ImpresionDeReciboTerminadaIpc) => void): (() => void) => {
        suscriptoresDeImpresion.push(alRecibir);
        return (): void => {
          suscriptoresDeImpresion = suscriptoresDeImpresion.filter((s) => s !== alRecibir);
        };
      },
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
        ventasEnEfectivo: '0.00',
        cantidadDeVentasEnEfectivo: 0,
        montoTeorico: '500.00',
        primerConteoSellado: null,
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
/** Escribe en un campo de texto como lo haría una persona. */
async function escribir(elemento: HTMLElement, texto: string): Promise<void> {
  const campo = elemento as HTMLInputElement;
  /*
    Se escribe por el descriptor nativo y no con `campo.value = texto`: React
    sobreescribe la propiedad del elemento para saber qué cambió, y asignarle
    directamente hace que el evento llegue sin el valor nuevo.
  */
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const escribirValor = descriptor?.set?.bind(campo);
  await act(async () => {
    escribirValor?.(texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('Cobrar: del ticket a la venta registrada', () => {
  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  it('está deshabilitado con el ticket vacío', async () => {
    await montar();
    expect((exigir('cobrar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('el diálogo muestra el total del ticket antes de cobrar nada', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));

    expect(porPrueba('dialogo-de-cobro')).not.toBeNull();
    expect(porPrueba('cobro-total')?.textContent).toContain('4.25');
    // Todavía no se mandó nada al proceso principal.
    expect(cobrosPedidos).toHaveLength(0);
  });

  it('el camino corto: sin descuento y en efectivo', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-continuar'));
    await clic(exigir('cobro-confirmar'));

    expect(cobrosPedidos).toHaveLength(1);
    expect(cobrosPedidos[0]?.descuento).toBeNull();
    expect(cobrosPedidos[0]?.formaPago).toBe('efectivo');
    expect(cobrosPedidos[0]?.numBoleta).toBeNull();
    // El pedido lleva qué producto y cuánto, NUNCA un precio: ese lo pone el
    // proceso principal contra el catálogo.
    expect(cobrosPedidos[0]?.lineas).toEqual([{ productoId: 'p-maiz', cantidad: '1.000' }]);
  });

  it('DESPUÉS DE COBRAR el ticket queda vacío y la pantalla lista', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-continuar'));
    await clic(exigir('cobro-confirmar'));

    expect(porPrueba('cobro-listo')).not.toBeNull();
    expect(porPrueba('cobro-total-cobrado')?.textContent).toContain('4.25');

    await clic(exigir('cobro-siguiente-venta'));

    expect(porPrueba('cobro-listo')).toBeNull();
    expect(todos('linea-de-ticket')).toHaveLength(0);
    expect(porPrueba('ticket-vacio')).not.toBeNull();
    expect(porPrueba('venta-registrada')?.textContent).toContain('4.25');
  });

  it('con tarjeta y SIN boleta no se manda nada: se avisa', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-continuar'));
    await clic(exigir('pago-tarjeta'));
    await clic(exigir('cobro-confirmar'));

    expect(porPrueba('cobro-aviso')?.textContent).toContain('boleta');
    expect(cobrosPedidos).toHaveLength(0);
  });

  it('con tarjeta y boleta, el número viaja tal cual, con su cero a la izquierda', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-continuar'));
    await clic(exigir('pago-tarjeta'));
    await escribir(exigir('pago-boleta'), '004512');
    await clic(exigir('cobro-confirmar'));

    expect(cobrosPedidos[0]?.formaPago).toBe('tarjeta');
    expect(cobrosPedidos[0]?.numBoleta).toBe('004512');
  });

  it('volver a efectivo LIMPIA la boleta escrita por error', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-continuar'));
    await clic(exigir('pago-tarjeta'));
    await escribir(exigir('pago-boleta'), '004512');
    await clic(exigir('pago-efectivo'));
    await clic(exigir('cobro-confirmar'));

    // La base rechaza una venta en efectivo con boleta (migración 014), y ese
    // rechazo sería incomprensible para el cajero.
    expect(cobrosPedidos[0]?.numBoleta).toBeNull();
  });

  it('el descuento se resta del total que se muestra antes de cobrar', async () => {
    await montar();
    await tocarProducto('p-huevos');
    await clic(exigir('cobrar'));
    await clic(exigir('descuento-porcentaje'));
    await escribir(exigir('descuento-valor'), '10');

    expect(porPrueba('cobro-subtotal')?.textContent).toContain('42.00');
    expect(porPrueba('cobro-rebaja')?.textContent).toContain('4.20');
    expect(porPrueba('cobro-total')?.textContent).toContain('37.80');
  });

  it('cancelar el cobro NO toca el ticket', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-cancelar'));

    expect(porPrueba('dialogo-de-cobro')).toBeNull();
    expect(todos('linea-de-ticket')).toHaveLength(1);
    expect(cobrosPedidos).toHaveLength(0);
  });
});

// ===========================================================================
/**
 * El descuento que se pasa del tope del rol.
 *
 * Lo que importa acá no es que pida un PIN: es que MUESTRE CUÁNTO se está por
 * autorizar antes de pedirlo. Quien teclea su código tiene que ver el número
 * que aprueba, igual que en el cierre de caja descuadrado.
 */
describe('Autorización de un descuento que excede el tope', () => {
  const RECHAZO_POR_TOPE: ResultadoDeCobro = {
    registrada: false,
    codigo: 'REQUIERE_AUTORIZACION_DE_DESCUENTO',
    mensaje: 'Ese descuento pasa el límite de tu rol.',
    requiereAutorizacion: true,
    tope: '10.00',
    exceso: '15.00',
    segundosParaReintentar: null,
  };

  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  it('muestra el tope y el exceso ANTES de pedir el PIN', async () => {
    respuestasDeCobro = [RECHAZO_POR_TOPE];
    await montar();
    await tocarProducto('p-huevos');
    await clic(exigir('cobrar'));
    await clic(exigir('descuento-porcentaje'));
    await escribir(exigir('descuento-valor'), '25');
    await clic(exigir('cobro-continuar'));
    await clic(exigir('cobro-confirmar'));

    expect(porPrueba('cobro-autorizacion')).not.toBeNull();
    expect(porPrueba('cobro-descuento-pedido')?.textContent).toContain('25');
    expect(porPrueba('cobro-tope')?.textContent).toContain('10.00');
    expect(porPrueba('cobro-exceso')?.textContent).toContain('15.00');
  });

  it('el PIN viaja en el SEGUNDO intento, no en el primero', async () => {
    respuestasDeCobro = [RECHAZO_POR_TOPE, VENTA_OK];
    await montar();
    await tocarProducto('p-huevos');
    await clic(exigir('cobrar'));
    await clic(exigir('descuento-porcentaje'));
    await escribir(exigir('descuento-valor'), '25');
    await clic(exigir('cobro-continuar'));
    await clic(exigir('cobro-confirmar'));

    for (const digito of '2468') {
      await clic(exigir(`tecla-${digito}`));
    }
    await clic(exigir('tecla-confirmar'));

    expect(cobrosPedidos).toHaveLength(2);
    expect(cobrosPedidos[0]?.pinDescuento).toBeUndefined();
    expect(cobrosPedidos[1]?.pinDescuento).toBe('2468');
    expect(porPrueba('cobro-listo')).not.toBeNull();
  });

  it('un PIN equivocado deja el diálogo abierto con su aviso', async () => {
    respuestasDeCobro = [
      RECHAZO_POR_TOPE,
      {
        registrada: false,
        codigo: 'PIN_INCORRECTO',
        mensaje: 'El PIN no es correcto.',
        requiereAutorizacion: true,
        tope: '10.00',
        exceso: '15.00',
        segundosParaReintentar: null,
      },
    ];
    await montar();
    await tocarProducto('p-huevos');
    await clic(exigir('cobrar'));
    await clic(exigir('descuento-porcentaje'));
    await escribir(exigir('descuento-valor'), '25');
    await clic(exigir('cobro-continuar'));
    await clic(exigir('cobro-confirmar'));

    for (const digito of '1111') {
      await clic(exigir(`tecla-${digito}`));
    }
    await clic(exigir('tecla-confirmar'));

    expect(porPrueba('cobro-autorizacion')).not.toBeNull();
    expect(porPrueba('cobro-aviso')?.textContent).toContain('no es correcto');
  });
});

describe('LA VENTA SE CONFIRMA SIN ESPERAR A LA IMPRESORA (§4.64)', () => {
  beforeEach(() => {
    instalarApi(PUEDE_VENDER);
  });

  async function cobrarHastaElFinal(): Promise<void> {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-continuar'));
    await clic(exigir('cobro-confirmar'));
  }

  it('«Venta registrada» aparece con el papel todavía EN CAMINO', async () => {
    await cobrarHastaElFinal();
    expect(porPrueba('cobro-listo')).not.toBeNull();
    const papel = exigir('cobro-estado-del-recibo');
    expect(papel.dataset.estado).toBe('enviando');
    expect(papel.textContent).toContain('Enviando el recibo a la impresora');
  });

  it('cuando llega el aviso de ESE recibo, el renglón dice que se imprimió', async () => {
    await cobrarHastaElFinal();
    await avisarImpresion({ reciboId: 'r-1', numeroRecibo: 1, impreso: true, mensaje: 'Recibo enviado a la impresora.' });
    const papel = exigir('cobro-estado-del-recibo');
    expect(papel.dataset.estado).toBe('impreso');
    expect(papel.textContent).toContain('Se imprimió.');
  });

  it('si no salió, lo dice con el mensaje de la impresora', async () => {
    await cobrarHastaElFinal();
    await avisarImpresion({ reciboId: 'r-1', numeroRecibo: 1, impreso: false, mensaje: 'La impresora reporta un problema.' });
    const papel = exigir('cobro-estado-del-recibo');
    expect(papel.dataset.estado).toBe('no-impreso');
    expect(papel.textContent).toContain('La impresora reporta un problema.');
  });

  it('el aviso de OTRO recibo no se toma por el de esta venta', async () => {
    await cobrarHastaElFinal();
    await avisarImpresion({ reciboId: 'r-otro', numeroRecibo: 7, impreso: true, mensaje: 'ok' });
    expect(exigir('cobro-estado-del-recibo').dataset.estado).toBe('enviando');
  });

  it('un aviso que llega ANTES que la respuesta del cobro igual se muestra', async () => {
    await montar();
    await tocarProducto('p-maiz');
    await clic(exigir('cobrar'));
    await clic(exigir('cobro-continuar'));
    await avisarImpresion({ reciboId: 'r-1', numeroRecibo: 1, impreso: true, mensaje: 'ok' });
    await clic(exigir('cobro-confirmar'));
    expect(exigir('cobro-estado-del-recibo').dataset.estado).toBe('impreso');
  });

  it('SI LA CAJERA YA SIGUIÓ con la próxima venta, un papel que no salió se avisa igual en la pantalla', async () => {
    await cobrarHastaElFinal();
    await clic(exigir('cobro-siguiente-venta'));
    expect(porPrueba('venta-papel-del-recibo')).toBeNull();

    await avisarImpresion({ reciboId: 'r-1', numeroRecibo: 1, impreso: false, mensaje: 'La impresora no contestó.' });
    expect(porPrueba('venta-papel-del-recibo')?.textContent).toContain('Recibo No. 1: La impresora no contestó.');
  });

  it('un papel que SÍ salió no deja ningún aviso extra en la pantalla', async () => {
    await cobrarHastaElFinal();
    await clic(exigir('cobro-siguiente-venta'));
    await avisarImpresion({ reciboId: 'r-1', numeroRecibo: 1, impreso: true, mensaje: 'ok' });
    expect(porPrueba('venta-papel-del-recibo')).toBeNull();
  });
});
