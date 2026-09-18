/**
 * El recibo de una venta: el PDF se espera, la impresora NO (§4.64).
 *
 * Todo corre sobre SQLite real con los servicios reales. Lo único de mentira
 * es la impresora, que no contesta hasta que la prueba lo decide: así se ve
 * exactamente qué espera cada camino y qué no.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import type {
  ComprobanteImprimible,
  EstadoImpresora,
  ReceiptPrinterProvider,
  ResultadoImpresion,
} from '@shared/adapters';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import type { LogTecnico, OrigenTecnico } from '@main/log-tecnico';
import { LogTecnicoSilencioso } from '@main/log-tecnico';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ServicioDeRecibos } from '../servicio-de-recibos';

/** Una impresora que contesta cuando la prueba quiere, y anota qué le mandaron. */
class ImpresoraQueEspera implements ReceiptPrinterProvider {
  public readonly nombre = 'ImpresoraQueEspera';
  public readonly pedidos: string[] = [];
  private readonly pendientes: {
    resolver: (resultado: ResultadoImpresion) => void;
    rechazar: (error: Error) => void;
  }[] = [];

  public imprimirComprobante(comprobante: ComprobanteImprimible): Promise<ResultadoImpresion> {
    this.pedidos.push(comprobante.idComprobante);
    return new Promise<ResultadoImpresion>((resolver, rechazar) => {
      this.pendientes.push({ resolver, rechazar });
    });
  }

  public consultarEstado(): Promise<EstadoImpresora> {
    return Promise.resolve({ disponible: true, adaptador: this.nombre, descripcion: 'de mentira' });
  }

  /** Contesta el pedido más viejo. */
  public contestar(resultado: Partial<ResultadoImpresion> = {}): void {
    const pendiente = this.pendientes.shift();
    if (pendiente === undefined) {
      throw new Error('No hay ningún pedido esperando respuesta.');
    }
    pendiente.resolver({
      ok: true,
      adaptador: this.nombre,
      omitidaPorDiseno: false,
      mensaje: 'Recibo enviado a la impresora.',
      ...resultado,
    });
  }

  public lanzar(error: Error): void {
    const pendiente = this.pendientes.shift();
    if (pendiente === undefined) {
      throw new Error('No hay ningún pedido esperando respuesta.');
    }
    pendiente.rechazar(error);
  }

  public get esperando(): number {
    return this.pendientes.length;
  }
}

class LogQueAnota implements LogTecnico {
  public readonly lineas: string[] = [];
  public registrar(origen: OrigenTecnico, mensaje: string): void {
    this.lineas.push(`[${origen}] ${mensaje}`);
  }
}

/** Deja correr las promesas ya resueltas. */
async function vaciarMicrotareas(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

let base: Database;
let repos: Repositorios;
let venta: ServicioDeVenta;
let recibos: ServicioDeRecibos;
let impresora: ImpresoraQueEspera;
let log: LogQueAnota;
let pdfEscritos: string[];
let elPdfFalla: boolean;
let limpiar: () => void;
let idCajera: string;
let idMaiz: string;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  impresora = new ImpresoraQueEspera();
  log = new LogQueAnota();
  pdfEscritos = [];
  elPdfFalla = false;

  const caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  venta = new ServicioDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    preciosEspeciales: repos.preciosEspeciales,
    limitesDescuento: repos.limitesDescuento,
    cajaSesiones: repos.cajaSesiones,
    auditoria: repos.auditoria,
    log: new LogTecnicoSilencioso(),
  });
  recibos = new ServicioDeRecibos({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    recibos: repos.recibos,
    usuarios: repos.usuarios,
    configuracion: repos.configuracionNegocio,
    anulaciones: repos.anulacionesDeVenta,
    impresora,
    log,
    carpetaDeDatos: '/datos',
    generarPdf: (_html: string, ruta: string): Promise<void> => {
      if (elPdfFalla) {
        return Promise.reject(new Error('disco lleno'));
      }
      pdfEscritos.push(ruta);
      return Promise.resolve();
    },
  });

  idCajera = repos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pinHash: generarHashDePin('1357') }).id;
  const categoriaId = repos.categorias.crear({ nombre: 'Granos' }).id;
  idMaiz = repos.productos.crear({
    nombre: 'Maíz blanco',
    categoriaId,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '6.69',
    inventarioDisponible: '100',
  }).id;
  caja.abrir(idCajera, { modo: 'simple', monto: '500' });
});

afterEach(() => {
  limpiar();
});

function vender(): string {
  return venta.registrar(idCajera, 'venta', {
    lineas: [{ productoId: idMaiz, cantidad: '0.5' }],
    descuento: null,
    formaPago: 'efectivo',
    numBoleta: null,
  }).venta.id;
}

function asientos(): number {
  return (base.prepare('SELECT count(*) AS n FROM auditoria_log').get() as { n: number }).n;
}

describe('Al cobrar, el recibo NO espera a la impresora', () => {
  it('devuelve con la impresora SIN CONTESTAR, y el PDF ya escrito', async () => {
    const emision = await recibos.emitirSinEsperarLaImpresion(vender());

    expect(emision.pdfGenerado).toBe(true);
    expect(pdfEscritos).toEqual([emision.rutaPdf]);
    expect(impresora.pedidos).toEqual([emision.recibo.id]);
    expect(impresora.esperando).toBe(1);
    expect(repos.recibos.obtenerPorId(emision.recibo.id)?.impreso).toBe(false);
  });

  it('cuando la impresora contesta, la impresión termina SOLA y marca el recibo impreso', async () => {
    const emision = await recibos.emitirSinEsperarLaImpresion(vender());
    impresora.contestar();

    await expect(emision.impresion).resolves.toEqual({ impreso: true, mensaje: 'Recibo enviado a la impresora.' });
    expect(repos.recibos.obtenerPorId(emision.recibo.id)?.impreso).toBe(true);
  });

  it('EL PDF SE SIGUE GENERANDO SIEMPRE: aunque la impresora nunca conteste', async () => {
    const emision = await recibos.emitirSinEsperarLaImpresion(vender());
    expect(emision.pdfGenerado).toBe(true);
    expect(pdfEscritos).toHaveLength(1);
  });

  it('si el PDF falla, igual devuelve y la impresión igual se intenta, como antes', async () => {
    elPdfFalla = true;
    const emision = await recibos.emitirSinEsperarLaImpresion(vender());
    expect(emision.pdfGenerado).toBe(false);
    expect(impresora.pedidos).toHaveLength(1);
    expect(log.lineas.some((linea) => linea.includes('FALLÓ el PDF'))).toBe(true);
  });

  it('UN FALLO DE IMPRESIÓN EN SEGUNDO PLANO va a la bitácora técnica y NO a auditoria_log', async () => {
    const emision = await recibos.emitirSinEsperarLaImpresion(vender());
    const asientosAntes = asientos();

    impresora.lanzar(new Error('la impresora no responde'));

    await expect(emision.impresion).resolves.toEqual({
      impreso: false,
      mensaje: 'No se pudo imprimir. El recibo quedó guardado en PDF.',
    });
    expect(asientos()).toBe(asientosAntes);
    expect(log.lineas.some((linea) => linea.startsWith('[impresion]') && linea.includes('la impresora no responde'))).toBe(
      true,
    );
    expect(repos.recibos.obtenerPorId(emision.recibo.id)?.impreso).toBe(false);
  });

  it('una impresora que contesta «no» deja el mensaje para la pantalla, sin marcar impreso', async () => {
    const emision = await recibos.emitirSinEsperarLaImpresion(vender());
    impresora.contestar({ ok: false, mensaje: 'La impresora reporta un problema.' });
    await expect(emision.impresion).resolves.toEqual({ impreso: false, mensaje: 'La impresora reporta un problema.' });
  });
});

describe('Los tickets salen UNO POR VEZ y en el orden de las ventas', () => {
  it('el segundo no se manda hasta que el primero terminó', async () => {
    const primera = await recibos.emitirSinEsperarLaImpresion(vender());
    const segunda = await recibos.emitirSinEsperarLaImpresion(vender());
    await vaciarMicrotareas();

    expect(impresora.pedidos).toEqual([primera.recibo.id]);

    impresora.contestar();
    await primera.impresion;
    await vaciarMicrotareas();
    expect(impresora.pedidos).toEqual([primera.recibo.id, segunda.recibo.id]);

    impresora.contestar();
    await expect(segunda.impresion).resolves.toMatchObject({ impreso: true });
  });

  it('un ticket que falla no traba la fila', async () => {
    const primera = await recibos.emitirSinEsperarLaImpresion(vender());
    const segunda = await recibos.emitirSinEsperarLaImpresion(vender());
    impresora.lanzar(new Error('atasco'));
    await primera.impresion;
    await vaciarMicrotareas();
    impresora.contestar();
    await expect(segunda.impresion).resolves.toMatchObject({ impreso: true });
  });
});

describe('Lo que SÍ sigue esperando a la impresora', () => {
  it('`emitir` espera la impresión entera, como siempre', async () => {
    let termino = false;
    const emitiendo = recibos.emitir(vender()).then((resultado) => {
      termino = true;
      return resultado;
    });
    await vaciarMicrotareas();
    expect(termino).toBe(false);

    impresora.contestar();
    const resultado = await emitiendo;
    expect(resultado.impreso).toBe(true);
    expect(resultado.recibo.impreso).toBe(true);
  });

  it('reimprimir espera la impresión: quien reimprime pidió el papel', async () => {
    const emision = await recibos.emitirSinEsperarLaImpresion(vender());
    impresora.contestar();
    await emision.impresion;

    let termino = false;
    const reimprimiendo = recibos.reimprimir(emision.recibo.id).then(() => {
      termino = true;
    });
    await vaciarMicrotareas();
    expect(termino).toBe(false);
    impresora.contestar();
    await reimprimiendo;
    expect(termino).toBe(true);
  });
});
