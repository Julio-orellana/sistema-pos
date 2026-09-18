/**
 * «Venta registrada» NO depende de la velocidad de la impresora (§4.64).
 *
 * Llama al canal `venta:cobrar` REAL —el manejador de `ipc/venta.ts`, con los
 * servicios reales sobre SQLite— igual que lo llama la ventana. La impresora es
 * una que NO CONTESTA hasta que la prueba lo decide: si el canal la esperara,
 * la respuesta no llegaría nunca y la prueba lo diría con su nombre.
 *
 * Es la prueba del hallazgo de la tienda: en el i3, cada ticket lanza un
 * `powershell.exe` que compila su puente a `winspool` y espera 1,5 s fijos, y
 * la cajera veía la venta confirmada recién cuando todo eso terminaba.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import type {
  ComprobanteImprimible,
  EstadoImpresora,
  ReceiptPrinterProvider,
  ResultadoImpresion,
} from '@shared/adapters';
import {
  CANALES_IPC,
  type ImpresionDeReciboTerminadaIpc,
  type RespuestaIpc,
  type ResultadoDeCobro,
} from '@shared/types/ipc';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { LogTecnicoSilencioso } from '@main/log-tecnico';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { CifradoDePrueba } from '@main/domain/usuarios/__tests__/ayuda-totp';
import { SesionActual } from '@main/domain/usuarios/sesion';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { registrarManejadoresDeVenta } from '../venta';

type Manejador = (evento: unknown, payload?: unknown) => Promise<unknown>;

const electron = vi.hoisted(() => ({ manejadores: new Map<string, (evento: unknown, payload?: unknown) => Promise<unknown>>() }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, manejador: (evento: unknown, payload?: unknown) => Promise<unknown>): void => {
      electron.manejadores.set(canal, manejador);
    },
  },
}));

/** Una impresora que no contesta hasta que se le dice. */
class ImpresoraMuda implements ReceiptPrinterProvider {
  public readonly nombre = 'ImpresoraMuda';
  public pedidos = 0;
  private contestar: ((resultado: ResultadoImpresion) => void) | null = null;

  public imprimirComprobante(_comprobante: ComprobanteImprimible): Promise<ResultadoImpresion> {
    this.pedidos += 1;
    return new Promise<ResultadoImpresion>((resolver) => {
      this.contestar = resolver;
    });
  }

  public consultarEstado(): Promise<EstadoImpresora> {
    return Promise.resolve({ disponible: true, adaptador: this.nombre, descripcion: 'de mentira' });
  }

  public responder(resultado: ResultadoImpresion): void {
    if (this.contestar === null) {
      throw new Error('La impresora no recibió ningún pedido.');
    }
    this.contestar(resultado);
    this.contestar = null;
  }
}

/** La ventana que cobró: anota lo que el proceso principal le manda después. */
class VentanaQueAnota {
  public readonly enviados: { canal: string; datos: unknown }[] = [];
  public destruida = false;
  public isDestroyed(): boolean {
    return this.destruida;
  }
  public send(canal: string, datos: unknown): void {
    this.enviados.push({ canal, datos });
  }
}

let base: Database;
let repos: Repositorios;
let impresora: ImpresoraMuda;
let limpiar: () => void;
let idMaiz: string;

beforeEach(() => {
  electron.manejadores.clear();
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  impresora = new ImpresoraMuda();

  const sesion = new SesionActual();
  const caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  registrarManejadoresDeVenta({
    sesion,
    caja,
    categorias: new ServicioDeCategorias({ base, categorias: repos.categorias, auditoria: repos.auditoria }),
    productos: new ServicioDeProductos({
      base,
      productos: repos.productos,
      categorias: repos.categorias,
      auditoria: repos.auditoria,
      describirFoto: (): null => null,
    }),
    venta: new ServicioDeVenta({
      base,
      ventas: repos.ventas,
      ventaDetalle: repos.ventaDetalle,
      productos: repos.productos,
      preciosEspeciales: repos.preciosEspeciales,
      limitesDescuento: repos.limitesDescuento,
      cajaSesiones: repos.cajaSesiones,
      auditoria: repos.auditoria,
      log: new LogTecnicoSilencioso(),
    }),
    autenticacion: new ServicioDeAutenticacion({
      base,
      usuarios: repos.usuarios,
      auditoria: repos.auditoria,
      bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
      cifrado: new CifradoDePrueba(),
    }),
    preciosEspeciales: repos.preciosEspeciales,
    usuarios: repos.usuarios,
    recibos: new ServicioDeRecibos({
      base,
      ventas: repos.ventas,
      ventaDetalle: repos.ventaDetalle,
      recibos: repos.recibos,
      usuarios: repos.usuarios,
      configuracion: repos.configuracionNegocio,
      anulaciones: repos.anulacionesDeVenta,
      impresora,
      log: new LogTecnicoSilencioso(),
      carpetaDeDatos: '/datos',
      generarPdf: (): Promise<void> => Promise.resolve(),
    }),
  });

  const cajera = repos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pinHash: generarHashDePin('1357') });
  sesion.iniciar(cajera);
  const categoriaId = repos.categorias.crear({ nombre: 'Granos' }).id;
  idMaiz = repos.productos.crear({
    nombre: 'Maíz blanco',
    categoriaId,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '4.25',
    inventarioDisponible: '100',
  }).id;
  caja.abrir(cajera.id, { modo: 'simple', monto: '500' });
});

afterEach(() => {
  limpiar();
});

const SIN_RESPUESTA = Symbol('sin respuesta');
/** Holgado a propósito: mide si el canal contesta, no cuán rápido lo hace. */
const LIMITE_MS = 2000;

async function cobrar(ventana: VentanaQueAnota): Promise<RespuestaIpc<ResultadoDeCobro> | typeof SIN_RESPUESTA> {
  const manejador: Manejador | undefined = electron.manejadores.get(CANALES_IPC.ventaCobrar);
  if (manejador === undefined) {
    throw new Error('No se registró venta:cobrar.');
  }
  const pedido = {
    lineas: [{ productoId: idMaiz, cantidad: '2' }],
    descuento: null,
    formaPago: 'efectivo',
    numBoleta: null,
  };
  const limite = new Promise<typeof SIN_RESPUESTA>((resolver) => {
    setTimeout(() => {
      resolver(SIN_RESPUESTA);
    }, LIMITE_MS);
  });
  return Promise.race([
    manejador({ sender: ventana }, pedido) as Promise<RespuestaIpc<ResultadoDeCobro>>,
    limite,
  ]);
}

async function vaciarMicrotareas(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe('Cobrar confirma la venta sin esperar a la impresora', () => {
  it('CON LA IMPRESORA SIN CONTESTAR, el canal responde «venta registrada»', async () => {
    const ventana = new VentanaQueAnota();
    const respuesta = await cobrar(ventana);

    expect(respuesta).not.toBe(SIN_RESPUESTA);
    if (respuesta === SIN_RESPUESTA || !respuesta.ok || !respuesta.datos.registrada) {
      throw new Error(`El cobro no se confirmó: ${JSON.stringify(respuesta)}`);
    }
    expect(impresora.pedidos).toBe(1);
    expect(respuesta.datos.recibo.impresionPendiente).toBe(true);
    expect(respuesta.datos.recibo.impreso).toBe(false);
    expect(respuesta.datos.recibo.pdfGenerado).toBe(true);
    // Todavía no hubo ningún aviso: la impresora no contestó.
    expect(ventana.enviados).toEqual([]);
  });

  it('la venta YA ESTÁ en la base cuando se responde, con su recibo', async () => {
    const respuesta = await cobrar(new VentanaQueAnota());
    if (respuesta === SIN_RESPUESTA || !respuesta.ok || !respuesta.datos.registrada) {
      throw new Error('El cobro no se confirmó.');
    }
    expect(repos.ventas.obtenerPorId(respuesta.datos.ventaId)?.estado).toBe('completada');
    expect(repos.recibos.obtenerPorVenta(respuesta.datos.ventaId)?.numeroRecibo).toBe(1);
  });

  it('CUANDO LA IMPRESORA CONTESTA, la ventana que cobró recibe el aviso con su recibo', async () => {
    const ventana = new VentanaQueAnota();
    const respuesta = await cobrar(ventana);
    if (respuesta === SIN_RESPUESTA || !respuesta.ok || !respuesta.datos.registrada) {
      throw new Error('El cobro no se confirmó.');
    }

    impresora.responder({ ok: true, adaptador: 'ImpresoraMuda', omitidaPorDiseno: false, mensaje: 'Recibo enviado a la impresora.' });
    await vaciarMicrotareas();

    const aviso: ImpresionDeReciboTerminadaIpc = {
      reciboId: respuesta.datos.recibo.id,
      numeroRecibo: 1,
      impreso: true,
      mensaje: 'Recibo enviado a la impresora.',
    };
    expect(ventana.enviados).toEqual([{ canal: CANALES_IPC.recibosImpresionTerminada, datos: aviso }]);
    expect(repos.recibos.obtenerPorId(respuesta.datos.recibo.id)?.impreso).toBe(true);
  });

  it('si la ventana se cerró antes de que la impresora conteste, no se le manda nada ni se rompe nada', async () => {
    const ventana = new VentanaQueAnota();
    const respuesta = await cobrar(ventana);
    if (respuesta === SIN_RESPUESTA || !respuesta.ok || !respuesta.datos.registrada) {
      throw new Error('El cobro no se confirmó.');
    }
    ventana.destruida = true;
    impresora.responder({ ok: true, adaptador: 'ImpresoraMuda', omitidaPorDiseno: false, mensaje: 'ok' });
    await vaciarMicrotareas();

    expect(ventana.enviados).toEqual([]);
    expect(repos.recibos.obtenerPorId(respuesta.datos.recibo.id)?.impreso).toBe(true);
  });
});
