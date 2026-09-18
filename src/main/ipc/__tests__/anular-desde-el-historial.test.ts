/**
 * El historial de recibos como PUNTO DE ENTRADA de la anulación, de punta a
 * punta: los canales reales de `ipc/recibos.ts` sobre SQLite real, con la
 * venta, la caja, el recibo y la anulación registrados por sus servicios.
 *
 * QUÉ SOSTIENE ESTA PRUEBA, que ninguna del servicio puede sostener sola:
 *
 *   · El botón «Anular» se ofrece EXACTAMENTE en las ventas de la caja que
 *     sigue abierta y sin anular, y en ninguna otra. Lo decide el proceso
 *     principal, no la pantalla.
 *   · Lo que ofrece el historial y lo que acepta el servicio son LA MISMA
 *     REGLA: para cada venta, `sePuedeAnular` dice que sí si y solo si
 *     `prepararAnulacion` no la rechaza por la caja o por estar ya anulada.
 *     Es la prueba de acoplamiento que impide que el historial ofrezca algo que
 *     el servicio después niegue, o al revés.
 *   · El recibo reimpreso de una venta anulada lleva la marca **con las mismas
 *     cifras de siempre**: se comparan los dos textos y lo único que cambia son
 *     los renglones de la marca.
 *   · Las respuestas de los tres canales pasan `structuredClone` (§4.42).
 *
 * DESDE EL 2026-09-17 SOSTIENE ADEMÁS EL FILTRO Y LOS TOTALES del historial,
 * que reemplazan al reporte «Cobros con tarjeta» de §3.5 del diseño. Viven acá
 * y no en un archivo aparte porque necesitan EXACTAMENTE este armado —dos
 * ventas de distinta forma de pago, una anulable y una anulada, con sesión de
 * un rol y del otro—, y duplicarlo sería mantener dos copias del mismo
 * escenario que pueden derivar.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';

import { NullPrinterProvider } from '@shared/adapters/receipt-printer';
import { generarHashDePin } from '@shared/auth';
import { montoACadena, sumarLista } from '@shared/money';
import {
  CANALES_IPC,
  type FiltroDeFormaPagoIpc,
  type HistorialDeRecibosIpc,
  type ReciboEnHistorialIpc,
  type ReciboVistoIpc,
  type RespuestaIpc,
} from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { CifradoDePrueba } from '@main/domain/usuarios/__tests__/ayuda-totp';
import { SesionActual, type UsuarioEnSesion } from '@main/domain/usuarios/sesion';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeConfiguracionDeNegocio } from '@main/domain/negocio/servicio-de-configuracion';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { MARCA_DE_VENTA_ANULADA } from '@main/domain/recibo/modelo-de-recibo';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ServicioDeAnulacionDeVenta } from '@main/domain/venta/servicio-de-anulacion';
import { LogTecnicoSilencioso } from '@main/log-tecnico';
import { FlujoDeAnulacionDeVenta } from '../anulacion-de-venta';
import { registrarManejadoresDeRecibos } from '../recibos';

// ---------------------------------------------------------------------------
// Electron de mentira: solo hace falta capturar los manejadores.
// ---------------------------------------------------------------------------
type Manejador = (evento: unknown, payload?: unknown) => Promise<unknown>;

const electron = vi.hoisted(() => ({ manejadores: new Map<string, Manejador>() }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, manejador: Manejador): void => {
      electron.manejadores.set(canal, manejador);
    },
  },
}));

const PIN_DE_JIMMY = '2468';
const PIN_DE_ANA = '1357';
const MOTIVO = 'el cliente devolvió el producto';
const VOUCHER = '004512';

let base: Database;
let repos: Repositorios;
let limpiar: () => void;
let carpeta: string;
let caja: ServicioDeCaja;
let venta: ServicioDeVenta;
let recibos: ServicioDeRecibos;
let anulacion: ServicioDeAnulacionDeVenta;
let flujo: FlujoDeAnulacionDeVenta;
let sesion: SesionActual;

let idJimmy: string;
let idAna: string;
let idMaiz: string;
let idCaja: string;

function sesionDe(id: string, nombre: string, rol: 'venta' | 'administrativo'): UsuarioEnSesion {
  return { id, nombre, rol, desde: '2026-09-15T15:00:00.000Z' };
}

async function llamar<T>(canal: string, payload?: unknown): Promise<RespuestaIpc<T>> {
  const manejador = electron.manejadores.get(canal);
  if (manejador === undefined) {
    throw new Error(`El canal ${canal} no quedó registrado.`);
  }
  const respuesta = (await manejador({}, payload)) as RespuestaIpc<T>;
  // Lo mismo que rechaza el puente de Electron. Si esto lanza, la ventana se
  // quedaría esperando para siempre (§4.42).
  structuredClone(respuesta);
  return respuesta;
}

async function historialCompleto(
  formaPago: FiltroDeFormaPagoIpc = 'todas',
): Promise<HistorialDeRecibosIpc> {
  const respuesta = await llamar<HistorialDeRecibosIpc>(CANALES_IPC.recibosListar, { formaPago });
  if (!respuesta.ok) {
    throw new Error(`El historial falló: ${respuesta.error.mensaje}`);
  }
  return respuesta.datos;
}

async function historial(): Promise<readonly ReciboEnHistorialIpc[]> {
  return (await historialCompleto()).recibos;
}

/** La fila del historial de una venta, o falla la prueba. */
function filaDe(lista: readonly ReciboEnHistorialIpc[], ventaId: string): ReciboEnHistorialIpc {
  const fila = lista.find((recibo) => recibo.ventaId === ventaId);
  if (fila === undefined) {
    throw new Error(`No está en el historial la venta ${ventaId}.`);
  }
  return fila;
}

/** Cobra y emite el recibo, como la aplicación. Devuelve el id de la venta. */
async function venderConRecibo(
  formaPago: 'efectivo' | 'tarjeta' = 'efectivo',
  cantidad = '2',
  productoId = idMaiz,
): Promise<string> {
  const registrada = venta.registrar(idAna, 'venta', {
    lineas: [{ productoId, cantidad }],
    descuento: null,
    formaPago,
    numBoleta: formaPago === 'tarjeta' ? VOUCHER : null,
  });
  await recibos.emitir(registrada.venta.id);
  return registrada.venta.id;
}

/**
 * Cierra la caja abierta contando EXACTAMENTE lo que el sistema espera, para
 * que no haga falta autorizar ninguna diferencia: lo que se prueba acá es qué
 * pasa con el historial después del cierre, no el cierre.
 */
function cerrarLaCaja(): void {
  const sesionDeCaja = repos.cajaSesiones.obtenerPorId(idCaja);
  if (sesionDeCaja === null) {
    throw new Error('No está la caja de la prueba.');
  }
  const resultado = caja.intentarCerrar(
    idCaja,
    { modo: 'simple', monto: montoACadena(caja.montoEsperadoDe(sesionDeCaja)) },
    { usuarioQueCierra: idAna },
  );
  if (!resultado.cerrada) {
    throw new Error(`La caja no se cerró: ${resultado.codigo} ${resultado.mensaje}`);
  }
}

/**
 * ¿El SERVICIO acepta preparar esta anulación, mirando solo la caja y si ya
 * está anulada? Es la otra mitad de la prueba de acoplamiento: se ignoran los
 * motivos que dependen de lo que se teclee (voucher, motivo, unidad).
 */
function elServicioLaPrepara(ventaId: string, voucher: string | null): boolean {
  try {
    anulacion.prepararAnulacion({ ventaId, motivo: MOTIVO, voucher });
    return true;
  } catch (error) {
    if (
      error instanceof ErrorDeNegocio &&
      (error.codigo === 'CAJA_DE_LA_VENTA_CERRADA' || error.codigo === 'VENTA_YA_ANULADA')
    ) {
      return false;
    }
    throw error;
  }
}

beforeEach(() => {
  electron.manejadores.clear();
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  carpeta = mkdtempSync(join(tmpdir(), 'pos-anulacion-historial-'));

  caja = new ServicioDeCaja({
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
    impresora: new NullPrinterProvider(),
    generarPdf: (): Promise<void> => Promise.resolve(),
    carpetaDeDatos: carpeta,
    log: new LogTecnicoSilencioso(),
  });
  anulacion = new ServicioDeAnulacionDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    cajaSesiones: repos.cajaSesiones,
    recibos: repos.recibos,
    usuarios: repos.usuarios,
    anulaciones: repos.anulacionesDeVenta,
    auditoria: repos.auditoria,
    log: new LogTecnicoSilencioso(),
  });
  flujo = new FlujoDeAnulacionDeVenta({
    anulacion,
    // El mismo servicio de recibos que usan los canales: el flujo regenera el
    // PDF del recibo en cuanto la anulación se confirma (§5.2).
    recibos,
    autenticacion: new ServicioDeAutenticacion({
      base,
      usuarios: repos.usuarios,
      auditoria: repos.auditoria,
      bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
      cifrado: new CifradoDePrueba(),
    }),
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin(PIN_DE_JIMMY),
  }).id;
  idAna = repos.usuarios.crear({
    nombre: 'Ana',
    rol: 'venta',
    pinHash: generarHashDePin(PIN_DE_ANA),
  }).id;
  const idCategoria = repos.categorias.crear({ nombre: 'Granos' }).id;
  idMaiz = repos.productos.crear({
    nombre: 'Maíz blanco',
    categoriaId: idCategoria,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '4.25',
    inventarioDisponible: '100',
  }).id;
  idCaja = caja.abrir(idAna, { modo: 'simple', monto: '500' }).id;

  sesion = new SesionActual();
  // El historial lo pide cualquiera con sesión: acá la tiene Ana, que es del
  // rol venta. Lo que autoriza la anulación es el PIN, no el rol de quien pide.
  const ana = repos.usuarios.obtenerPorId(idAna);
  if (ana === null) {
    throw new Error('No está Ana.');
  }
  sesion.iniciar(ana);
  registrarManejadoresDeRecibos({
    sesion,
    negocio: new ServicioDeConfiguracionDeNegocio({
      base,
      configuracion: repos.configuracionNegocio,
      auditoria: repos.auditoria,
    }),
    recibos,
    repositorioDeRecibos: repos.recibos,
    anulacionDeVenta: anulacion,
  });
});

afterEach(() => {
  limpiar();
  rmSync(carpeta, { recursive: true, force: true });
});

// ===========================================================================
describe('EL BOTÓN «ANULAR» solo se ofrece en las ventas de la caja ABIERTA', () => {
  it('una venta de la caja abierta y sin anular SÍ se ofrece', async () => {
    const ventaId = await venderConRecibo();
    expect(filaDe(await historial(), ventaId).sePuedeAnular).toBe(true);
  });

  it('NINGUNA venta se ofrece cuando su caja ya se cerró', async () => {
    const ventaId = await venderConRecibo();
    const otra = await venderConRecibo('efectivo', '3');
    cerrarLaCaja();

    const lista = await historial();
    expect(lista).toHaveLength(2);
    expect(lista.every((fila) => !fila.sePuedeAnular)).toBe(true);
    expect([filaDe(lista, ventaId).sePuedeAnular, filaDe(lista, otra).sePuedeAnular]).toEqual([
      false,
      false,
    ]);
  });

  it('una venta de una caja CERRADA no se ofrece aunque haya OTRA caja abierta ahora', async () => {
    const deLaCajaVieja = await venderConRecibo();
    cerrarLaCaja();
    idCaja = caja.abrir(idAna, { modo: 'simple', monto: '500' }).id;
    const deLaCajaNueva = await venderConRecibo();

    const lista = await historial();
    // La regla es «la caja DE ESA VENTA sigue abierta», no «hay una caja
    // abierta»: si fuera lo segundo, abrir un turno nuevo volvería anulables
    // las ventas de todos los turnos anteriores.
    expect(filaDe(lista, deLaCajaVieja).sePuedeAnular).toBe(false);
    expect(filaDe(lista, deLaCajaNueva).sePuedeAnular).toBe(true);
  });

  it('una venta YA ANULADA deja de ofrecerse, y la fila lo dice con fecha, quién autorizó y motivo', async () => {
    const ventaId = await venderConRecibo();
    await flujo.pedir(
      { ventaId, motivo: MOTIVO, voucher: null, pin: PIN_DE_JIMMY },
      sesionDe(idAna, 'Ana', 'venta'),
    );

    const fila = filaDe(await historial(), ventaId);
    expect(fila.sePuedeAnular).toBe(false);
    expect(fila.anulacion).not.toBeNull();
    expect(fila.anulacion?.autorizadaPor).toBe('Jimmy');
    expect(fila.anulacion?.motivo).toBe(MOTIVO);
    expect(fila.anulacion?.fecha).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(fila.anulacion?.hora).toMatch(/^\d{2}:\d{2}$/);
  });

  it('una venta sin anular trae `anulacion` en null: la fila no dibuja ninguna etiqueta', async () => {
    const ventaId = await venderConRecibo();
    expect(filaDe(await historial(), ventaId).anulacion).toBeNull();
  });
});

// ===========================================================================
describe('EL HISTORIAL Y EL SERVICIO APLICAN LA MISMA REGLA', () => {
  it('para cada venta, `sePuedeAnular` coincide con que el servicio la prepare, en los cuatro estados', async () => {
    const enEfectivo = await venderConRecibo();
    const conTarjeta = await venderConRecibo('tarjeta');
    const anulada = await venderConRecibo('efectivo', '1');
    await flujo.pedir(
      { ventaId: anulada, motivo: MOTIVO, voucher: null, pin: PIN_DE_JIMMY },
      sesionDe(idAna, 'Ana', 'venta'),
    );

    // Control: las tres formas posibles están representadas, y no todas dan lo
    // mismo. Sin esto, dos funciones que devolvieran siempre `false`
    // «coincidirían» y la comprobación pasaría sin probar nada.
    const antes = await historial();
    expect(antes.map((fila) => fila.sePuedeAnular).sort()).toEqual([false, true, true]);

    const vouchers = new Map([[conTarjeta, VOUCHER]]);
    for (const fila of antes) {
      expect(
        fila.sePuedeAnular,
        `El historial y el servicio no coinciden en la venta ${fila.ventaId}.`,
      ).toBe(elServicioLaPrepara(fila.ventaId, vouchers.get(fila.ventaId) ?? null));
    }

    // Y con la caja cerrada, las dos respuestas cambian JUNTAS.
    cerrarLaCaja();
    for (const fila of await historial()) {
      expect(fila.sePuedeAnular).toBe(false);
      expect(elServicioLaPrepara(fila.ventaId, vouchers.get(fila.ventaId) ?? null)).toBe(false);
    }
    expect(enEfectivo).not.toBe(conTarjeta);
  });
});

// ===========================================================================
describe('EL RECIBO REIMPRESO de una venta anulada', () => {
  it('lleva la marca con la fecha, quién autorizó y el motivo, y NINGUNA cifra cambia', async () => {
    const ventaId = await venderConRecibo();
    const recibo = filaDe(await historial(), ventaId);

    const antes = await llamar<ReciboVistoIpc>(CANALES_IPC.recibosReimprimir, { id: recibo.id });
    if (!antes.ok) {
      throw new Error('La primera reimpresión falló.');
    }

    await flujo.pedir(
      { ventaId, motivo: MOTIVO, voucher: null, pin: PIN_DE_JIMMY },
      sesionDe(idAna, 'Ana', 'venta'),
    );

    const despues = await llamar<ReciboVistoIpc>(CANALES_IPC.recibosReimprimir, { id: recibo.id });
    if (!despues.ok) {
      throw new Error('La reimpresión de la venta anulada falló.');
    }

    expect(despues.datos.texto).toContain(MARCA_DE_VENTA_ANULADA);
    expect(despues.datos.texto).toContain('Autorizó: Jimmy');
    expect(despues.datos.texto).toContain(`Motivo: ${MOTIVO}`);
    expect(despues.datos.texto).toMatch(/Anulada: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);

    // NO ES UN DOCUMENTO NUEVO: el mismo número y, línea por línea, el mismo
    // papel más los renglones de la marca. Cualquier cifra que cambiara
    // aparecería acá como una línea quitada.
    expect(despues.datos.numeroRecibo).toBe(antes.datos.numeroRecibo);
    const renglonesDeAntes = antes.datos.texto.split('\n');
    const renglonesDeDespues = despues.datos.texto.split('\n');
    expect(renglonesDeDespues.filter((linea) => renglonesDeAntes.includes(linea))).toEqual(
      renglonesDeAntes,
    );
    expect(renglonesDeDespues.length - renglonesDeAntes.length).toBe(4);
  });

  it('el recibo VISTO desde el historial muestra la misma marca que el papel', async () => {
    const ventaId = await venderConRecibo();
    const recibo = filaDe(await historial(), ventaId);
    await flujo.pedir(
      { ventaId, motivo: MOTIVO, voucher: null, pin: PIN_DE_JIMMY },
      sesionDe(idAna, 'Ana', 'venta'),
    );

    const visto = await llamar<ReciboVistoIpc>(CANALES_IPC.recibosVer, { id: recibo.id });
    expect(visto.ok && visto.datos.texto).toContain(MARCA_DE_VENTA_ANULADA);
  });

  it('el de una venta que sigue en pie NO lleva ninguna marca', async () => {
    const ventaId = await venderConRecibo();
    const recibo = filaDe(await historial(), ventaId);
    const visto = await llamar<ReciboVistoIpc>(CANALES_IPC.recibosVer, { id: recibo.id });
    expect(visto.ok && visto.datos.texto).not.toContain('ANULADA');
    expect(idJimmy).not.toBe(idAna);
  });
});

// ===========================================================================
// EL FILTRO POR MÉTODO DE PAGO Y LOS TOTALES (§3.5, reemplazado)
// ===========================================================================

/**
 * Un producto a Q1.10, para que las sumas de la prueba sean de las que el
 * punto flotante arruina.
 *
 * El maíz de arriba cuesta Q4.25, y todo múltiplo de 0.25 es exacto en binario:
 * con él, sumar con `Number` daría el mismo resultado que con Decimal y la
 * prueba no distinguiría una implementación de la otra. Con Q1.10, en cambio,
 * `1.1 + 2.2 + 4.4` da **7.700000000000001** y `3.3 + 6.6` da
 * **9.899999999999999`, medido con Node.
 */
function productoDeDecimalesFeos(): string {
  const categoria = repos.categorias.crear({ nombre: 'Feos' }).id;
  return repos.productos.crear({
    nombre: 'Azúcar',
    categoriaId: categoria,
    tipoMedida: 'unidad',
    unidadPeso: null,
    cantidadPredefinidaIcono: '1',
    precioBase: '1.10',
    inventarioDisponible: '100',
  }).id;
}

/** Deja a Jimmy en sesión: es quien puede ver los totales. */
function entraJimmy(): void {
  const jimmy = repos.usuarios.obtenerPorId(idJimmy);
  if (jimmy === null) {
    throw new Error('No está Jimmy.');
  }
  sesion.iniciar(jimmy);
}

describe('EL HISTORIAL FILTRA POR MÉTODO DE PAGO', () => {
  it('«todas» trae las de efectivo y las de tarjeta', async () => {
    const enEfectivo = await venderConRecibo('efectivo');
    const conTarjeta = await venderConRecibo('tarjeta');

    const historial = await historialCompleto('todas');

    expect(historial.filtro).toBe('todas');
    expect(historial.recibos.map((fila) => fila.ventaId).sort()).toEqual(
      [enEfectivo, conTarjeta].sort(),
    );
  });

  it('«tarjeta» no trae NINGUNA venta en efectivo, y «efectivo» ninguna con tarjeta', async () => {
    await venderConRecibo('efectivo');
    await venderConRecibo('efectivo');
    const conTarjeta = await venderConRecibo('tarjeta');

    const soloTarjeta = await historialCompleto('tarjeta');
    const soloEfectivo = await historialCompleto('efectivo');

    expect(soloTarjeta.recibos.map((fila) => fila.ventaId)).toEqual([conTarjeta]);
    expect(soloTarjeta.recibos.every((fila) => fila.formaPago === 'tarjeta')).toBe(true);
    expect(soloEfectivo.recibos).toHaveLength(2);
    expect(soloEfectivo.recibos.every((fila) => fila.formaPago === 'efectivo')).toBe(true);
  });

  it('el filtro con el que se armó la lista VUELVE en la respuesta, para que la pantalla no lo suponga', async () => {
    await venderConRecibo('tarjeta');

    expect((await historialCompleto('tarjeta')).filtro).toBe('tarjeta');
    expect((await historialCompleto('efectivo')).filtro).toBe('efectivo');
    expect((await historialCompleto('todas')).filtro).toBe('todas');
  });

  it('un filtro sin ninguna venta devuelve la lista vacía, no un error', async () => {
    await venderConRecibo('efectivo');

    const soloTarjeta = await historialCompleto('tarjeta');

    expect(soloTarjeta.recibos).toEqual([]);
    expect(soloTarjeta.filtro).toBe('tarjeta');
  });

  it('LA FILA CON TARJETA TRAE SU VOUCHER; la de efectivo lo trae en null', async () => {
    const enEfectivo = await venderConRecibo('efectivo');
    const conTarjeta = await venderConRecibo('tarjeta');

    const lista = (await historialCompleto('todas')).recibos;

    expect(filaDe(lista, conTarjeta).numBoleta).toBe(VOUCHER);
    expect(filaDe(lista, enEfectivo).numBoleta).toBeNull();
  });

  it('el voucher que viaja es el MISMO que guardó la venta, no uno recalculado', async () => {
    const conTarjeta = await venderConRecibo('tarjeta');

    const fila = filaDe((await historialCompleto('tarjeta')).recibos, conTarjeta);

    expect(fila.numBoleta).toBe(repos.ventas.obtenerPorId(conTarjeta)?.numBoleta);
  });
});

describe('LOS TOTALES SON DEL CONJUNTO FILTRADO, y se suman con Decimal', () => {
  beforeEach(() => {
    entraJimmy();
  });

  it('SUMA EXACTA: tres ventas que en punto flotante darían 7.700000000000001 dan 7.70', async () => {
    const azucar = productoDeDecimalesFeos();
    await venderConRecibo('efectivo', '1', azucar); // 1.10
    await venderConRecibo('efectivo', '2', azucar); // 2.20
    await venderConRecibo('efectivo', '4', azucar); // 4.40

    const totales = (await historialCompleto('efectivo')).totales;

    // El control: así de mal sale sumando como sumaría la ventana.
    expect(1.1 + 2.2 + 4.4).not.toBe(7.7);
    expect(totales?.enEfectivo).toBe('7.70');
  });

  it('EFECTIVO + TARJETA DA EXACTAMENTE EL GENERAL, con decimales feos de los dos lados', async () => {
    const azucar = productoDeDecimalesFeos();
    await venderConRecibo('efectivo', '1', azucar); // 1.10
    await venderConRecibo('efectivo', '2', azucar); // 2.20
    await venderConRecibo('efectivo', '4', azucar); // 4.40
    await venderConRecibo('tarjeta', '3', azucar); // 3.30
    await venderConRecibo('tarjeta', '6', azucar); // 6.60

    const totales = (await historialCompleto('todas')).totales;

    expect(3.3 + 6.6).not.toBe(9.9);
    expect(totales?.enEfectivo).toBe('7.70');
    expect(totales?.enTarjeta).toBe('9.90');
    expect(totales?.general).toBe('17.60');
    expect(sumarLista([totales?.enEfectivo ?? '0', totales?.enTarjeta ?? '0']).toFixed(2)).toBe(
      totales?.general,
    );
  });

  it('CON EL FILTRO EN TARJETA, el total en efectivo es cero: los totales son de lo que se ve', async () => {
    const azucar = productoDeDecimalesFeos();
    await venderConRecibo('efectivo', '4', azucar); // 4.40
    await venderConRecibo('tarjeta', '3', azucar); // 3.30

    const soloTarjeta = (await historialCompleto('tarjeta')).totales;

    expect(soloTarjeta?.enEfectivo).toBe('0.00');
    expect(soloTarjeta?.enTarjeta).toBe('3.30');
    expect(soloTarjeta?.general).toBe('3.30');
    expect(soloTarjeta?.cantidadDeVentas).toBe(1);
  });

  it('cuenta las ventas de cada montón, no solo los montos', async () => {
    await venderConRecibo('efectivo');
    await venderConRecibo('efectivo');
    await venderConRecibo('tarjeta');

    const totales = (await historialCompleto('todas')).totales;

    expect(totales?.ventasEnEfectivo).toBe(2);
    expect(totales?.ventasEnTarjeta).toBe(1);
    expect(totales?.cantidadDeVentas).toBe(3);
  });

  it('UNA VENTA ANULADA NO CUENTA en los totales, y se informa aparte', async () => {
    const azucar = productoDeDecimalesFeos();
    const queSigue = await venderConRecibo('efectivo', '4', azucar); // 4.40
    const queSeAnula = await venderConRecibo('efectivo', '2', azucar); // 2.20
    anulacion.anular({ ventaId: queSeAnula, motivo: MOTIVO, voucher: null }, idAna, {
      autorizadaPor: idJimmy,
      via: 'presencial',
    });

    const historial = await historialCompleto('efectivo');

    // La fila SIGUE en la lista: el historial muestra todos los recibos.
    expect(historial.recibos).toHaveLength(2);
    expect(filaDe(historial.recibos, queSeAnula).anulacion).not.toBeNull();
    // Pero fuera de la suma, y dicho aparte para que el número se pueda leer.
    expect(historial.totales?.enEfectivo).toBe('4.40');
    expect(historial.totales?.cantidadDeVentas).toBe(1);
    expect(historial.totales?.anuladas).toBe(1);
    expect(historial.totales?.totalAnulado).toBe('2.20');
    expect(queSigue).toBeTruthy();
  });

  it('lo anulado se decide por su FILA, nunca por `ventas.estado`, que sigue en «completada»', async () => {
    const queSeAnula = await venderConRecibo('efectivo');
    anulacion.anular({ ventaId: queSeAnula, motivo: MOTIVO, voucher: null }, idAna, {
      autorizadaPor: idJimmy,
      via: 'presencial',
    });

    expect(repos.ventas.obtenerPorId(queSeAnula)?.estado).toBe('completada');
    expect((await historialCompleto('todas')).totales?.cantidadDeVentas).toBe(0);
  });

  it('`ventas.estado` NO DECIDE NADA: una venta marcada «anulada» a mano SIGUE contando', async () => {
    await venderConRecibo('efectivo'); // 8.50
    const rara = await venderConRecibo('efectivo'); // 8.50
    /*
      Nada en producción escribe 'anulada' —`RepositorioDeVentas.anular()` se
      eliminó con el diseño de la anulación—, pero el CHECK del esquema lo
      admite. Lo que esta prueba fija es que, si apareciera, **el historial
      igual NO la trata como anulada**: lo que decide es la fila de
      `anulaciones_de_venta` y nada más (§1.3 del diseño). Mirar `estado`
      sería tener dos criterios que pueden discrepar, y hay una prueba
      estructural que lo prohíbe en todo el código de producción.
    */
    base.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?").run(rara);

    const historial = await historialCompleto('efectivo');

    expect(historial.recibos).toHaveLength(2);
    expect(historial.totales?.general).toBe('17.00');
    expect(historial.totales?.cantidadDeVentas).toBe(2);
    expect(historial.totales?.anuladas).toBe(0);
  });

  it('sin ninguna venta, los totales son cero y no `null`', async () => {
    const totales = (await historialCompleto('todas')).totales;

    expect(totales?.general).toBe('0.00');
    expect(totales?.enEfectivo).toBe('0.00');
    expect(totales?.enTarjeta).toBe('0.00');
    expect(totales?.anuladas).toBe(0);
  });
});

describe('LOS TOTALES SON INFORMACIÓN DE DUEÑO: sin rol administrativo no viajan', () => {
  it('con la sesión de ANA (rol venta) el canal NO manda ningún total', async () => {
    await venderConRecibo('efectivo');
    await venderConRecibo('tarjeta');

    // El `beforeEach` deja a Ana en sesión.
    const historial = await historialCompleto('todas');

    expect(sesion.obtener()?.rol).toBe('venta');
    expect(historial.totales).toBeNull();
  });

  it('con la sesión de JIMMY (administrativo) sí los manda', async () => {
    await venderConRecibo('efectivo');
    entraJimmy();

    const historial = await historialCompleto('todas');

    expect(historial.totales).not.toBeNull();
    expect(historial.totales?.general).toBe('8.50');
  });

  it('LAS FILAS LLEGAN IGUAL A LOS DOS: lo único que cambia son los totales', async () => {
    await venderConRecibo('efectivo');
    await venderConRecibo('tarjeta');

    const comoAna = await historialCompleto('todas');
    entraJimmy();
    const comoJimmy = await historialCompleto('todas');

    expect(comoAna.recibos).toEqual(comoJimmy.recibos);
    expect(comoAna.totales).toBeNull();
    expect(comoJimmy.totales).not.toBeNull();
  });

  it('el voucher SÍ llega al rol venta: ya está impreso en el papel del cliente', async () => {
    const conTarjeta = await venderConRecibo('tarjeta');

    const comoAna = await historialCompleto('tarjeta');

    expect(sesion.obtener()?.rol).toBe('venta');
    expect(filaDe(comoAna.recibos, conTarjeta).numBoleta).toBe(VOUCHER);
  });
});
