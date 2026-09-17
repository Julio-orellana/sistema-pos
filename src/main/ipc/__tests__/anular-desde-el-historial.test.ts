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
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';

import { NullPrinterProvider } from '@shared/adapters/receipt-printer';
import { generarHashDePin } from '@shared/auth';
import { montoACadena } from '@shared/money';
import { CANALES_IPC, type ReciboEnHistorialIpc, type ReciboVistoIpc, type RespuestaIpc } from '@shared/types/ipc';
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

async function historial(): Promise<readonly ReciboEnHistorialIpc[]> {
  const respuesta = await llamar<readonly ReciboEnHistorialIpc[]>(CANALES_IPC.recibosListar);
  if (!respuesta.ok) {
    throw new Error(`El historial falló: ${respuesta.error.mensaje}`);
  }
  return respuesta.datos;
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
): Promise<string> {
  const registrada = venta.registrar(idAna, 'venta', {
    lineas: [{ productoId: idMaiz, cantidad }],
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
  const idCategoria = repos.categorias.crear({ nombre: 'Granos', orden: 1 }).id;
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
