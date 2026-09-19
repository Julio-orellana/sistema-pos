/**
 * TODO CANAL IPC DEVUELVE ALGO QUE CRUZA EL PUENTE.
 *
 * POR QUÉ EXISTE. En `v1.0.0-prueba.1`, cerrar la caja que abrió otra persona
 * devolvía la `sesion` de dominio, con montos Decimal. decimal.js les pone
 * `constructor` como propiedad PROPIA —una función— y el puente IPC de
 * Electron no clona funciones. Medido con Electron 44: la llamada no se
 * rechaza, queda pendiente para siempre, y el botón de Jimmy no hacía nada
 * (§4.42). Ninguna prueba lo vio porque todas llamaban a los servicios
 * directo, sin cruzar el puente.
 *
 * Es un defecto de PATRÓN —un servicio que devuelve un objeto de dominio y un
 * manejador que lo pasa tal cual—, así que si existe en un canal puede existir
 * en otro. Por eso esta prueba no mira un canal: registra TODOS los manejadores
 * con los servicios REALES sobre SQLite y los llama, uno por uno, pasando cada
 * respuesta por `structuredClone`, que rechaza lo mismo que el puente.
 *
 * Y NO se puede olvidar un canal: la última comprobación exige que cada canal
 * registrado se haya llamado y haya devuelto al menos una respuesta `ok`. El
 * canal que alguien agregue el año que viene hace fallar esta prueba hasta que
 * alguien le escriba su llamada. Es el mismo criterio de la prueba estructural
 * de §4.26: el riesgo no es el código de hoy, es el canal de mañana.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';

import { NullPrinterProvider } from '@shared/adapters/receipt-printer';
import { CANALES_IPC, type RespuestaIpc } from '@shared/types/ipc';
import { abrirBaseDeDatos, cerrarBaseDeDatos, obtenerBaseDeDatos } from '@main/database/connection';
import { crearBaseMigrada, type BaseDePrueba } from '@main/database/__tests__/ayuda-base-de-datos';
import { observarLotesEncolados, type ArchivoParaSubir } from '@main/database/bandeja-de-salida';
import { reiniciarSenalDeTransaccion } from '@main/database/transaccion-en-curso';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { CifradoDePrueba, codigoDeLaApp } from '@main/domain/usuarios/__tests__/ayuda-totp';
import { SesionActual } from '@main/domain/usuarios/sesion';
import { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import { AlmacenDeFotos } from '@main/domain/catalogo/almacen-de-fotos';
import { ServicioDeConfiguracionDeNegocio } from '@main/domain/negocio/servicio-de-configuracion';
import { ServicioDeLimitesDeDescuento } from '@main/domain/venta/servicio-de-limites-de-descuento';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ServicioDeAnulacionDeVenta } from '@main/domain/venta/servicio-de-anulacion';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { ServicioDeReportes } from '@main/domain/reportes/servicio-de-reportes';
import { LogTecnicoSilencioso } from '@main/log-tecnico';
import { ServicioDeSincronizacion } from '@main/sincronizacion/servicio-de-sincronizacion';
import { SesionDeNube } from '@main/sincronizacion/sesion-de-nube';
import type { ClienteDeAuth, ResultadoDeAuth } from '@main/sincronizacion/auth-de-nube';
import { AlmacenDeCredencial, type CifradoSeguro } from '@main/sincronizacion/credencial';
import { ServicioDeRestauracion } from '@main/restauracion/servicio-de-restauracion';
import { AlmacenDelPuestoDeControl } from '@main/restauracion/puesto-de-control';
import { ControladorDeSalidaControlada } from '@main/windows/controlled-exit';
import { ServicioDeImpresora } from '@main/impresora/servicio-de-impresora';
import { ServicioDeHistorialDeCajas } from '@main/domain/caja/historial-de-cajas';
import {
  EnviadorSimulado,
  IMPRESORA_SIMULADA_DESCONECTADA,
  IMPRESORA_SIMULADA_QUE_RECIBE,
  impresorasSimuladas,
} from '@main/adapters/impresoras-simuladas';
import { NubeDeMentira } from '@main/restauracion/__tests__/nube-de-mentira';
import {
  PIN_DE_JIMMY,
  PNG_DE_UN_PIXEL,
  sembrarTerminalDeOrigen,
  type TerminalDeOrigen,
} from '@main/restauracion/__tests__/terminal-de-origen';

import { registrarManejadoresIpc, type DependenciasDeIpc } from '../register-handlers';
import { CODIGO_RESPUESTA_NO_SERIALIZABLE, rutaDelPrimerValorNoClonable } from '../respuesta';

// ---------------------------------------------------------------------------
// Electron de mentira: lo único que hace falta es capturar los manejadores.
// ---------------------------------------------------------------------------

type Manejador = (evento: unknown, payload?: unknown) => Promise<unknown>;

const electron = vi.hoisted(() => ({
  manejadores: new Map<string, (evento: unknown, payload?: unknown) => Promise<unknown>>(),
  rutaDeLaFotoElegida: '',
}));

vi.mock('electron', () => {
  const ventana = { webContents: { send: (): void => undefined }, isDestroyed: (): boolean => false };
  return {
    ipcMain: {
      handle: (canal: string, manejador: (evento: unknown, payload?: unknown) => Promise<unknown>): void => {
        electron.manejadores.set(canal, manejador);
      },
    },
    BrowserWindow: { fromWebContents: (): unknown => ventana, getAllWindows: (): unknown[] => [ventana] },
    dialog: {
      showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
        Promise.resolve({ canceled: false, filePaths: [electron.rutaDeLaFotoElegida] }),
    },
    app: {
      getName: (): string => 'pos-agricola',
      getVersion: (): string => '0.0.0',
      isPackaged: false,
      getPath: (): string => tmpdir(),
      getGPUFeatureStatus: (): Record<string, string> => ({ gpu_compositing: 'enabled', rasterization: 'enabled' }),
      getGPUInfo: (): Promise<unknown> => Promise.resolve({ gpuDevice: [{ vendorId: 0x8086, deviceId: 0x0116, active: true }] }),
    },
    nativeImage: { createFromBuffer: (): unknown => ({ isEmpty: (): boolean => true }) },
    safeStorage: { isEncryptionAvailable: (): boolean => false },
    net: { isOnline: (): boolean => false },
  };
});

// ---------------------------------------------------------------------------
// El registro de lo que devolvió cada canal
// ---------------------------------------------------------------------------

interface Llamada {
  readonly canal: string;
  readonly paso: string;
  readonly ok: boolean;
  /** El código de error, si la respuesta no fue `ok`. */
  readonly codigo: string | null;
  /** El detalle técnico del error, si lo trae. */
  readonly detalle: string | null;
  /** `null` si se pudo clonar; si no, el error y la ruta del primer valor que lo impide. */
  readonly noSeClona: string | null;
}

const llamadas: Llamada[] = [];
const canalesRegistrados = new Set<string>();

/** Llama al canal como lo haría la ventana y anota si la respuesta cruza el puente. */
async function llamar(canal: string, paso: string, payload?: unknown): Promise<RespuestaIpc<unknown>> {
  const manejador: Manejador | undefined = electron.manejadores.get(canal);
  if (manejador === undefined) {
    throw new Error(`No hay manejador registrado para ${canal}`);
  }
  // El `sender` es la ventana que llamó: el cobro le manda después el aviso de
  // impresión terminada (§4.64), así que tiene que parecerse a un webContents.
  const sender = { isDestroyed: (): boolean => false, send: (): void => undefined };
  const respuesta = (await manejador({ sender }, payload)) as RespuestaIpc<unknown>;
  let noSeClona: string | null = null;
  try {
    structuredClone(respuesta);
  } catch (error) {
    const mensaje = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
    noSeClona = `${mensaje} — ${rutaDelPrimerValorNoClonable(respuesta, 'respuesta') ?? 'ruta no encontrada'}`;
  }
  llamadas.push({ canal, paso, ok: respuesta.ok, codigo: respuesta.ok ? null : respuesta.error.codigo, detalle: respuesta.ok ? null : (respuesta.error.detalle ?? null), noSeClona });
  return respuesta;
}

/** Los datos de una respuesta que tiene que haber salido bien, o falla con su mensaje. */
function datosDe(respuesta: RespuestaIpc<unknown>, que: string): Record<string, unknown> {
  if (!respuesta.ok) {
    throw new Error(`${que}: ${respuesta.error.codigo} ${respuesta.error.mensaje} ${respuesta.error.detalle ?? ''}`);
  }
  return respuesta.datos as Record<string, unknown>;
}

function anotarRegistrados(): void {
  for (const canal of electron.manejadores.keys()) {
    canalesRegistrados.add(canal);
  }
}

// ---------------------------------------------------------------------------
// Dobles que no son de negocio: Auth de la nube y el cifrado de la credencial
// ---------------------------------------------------------------------------

const SEGUNDOS_DE_VIDA_DEL_TOKEN = 900;
const IAT_FIJO = 1_700_000_000;

function jwtDeTerminal(): string {
  const parte = (objeto: object): string => Buffer.from(JSON.stringify(objeto)).toString('base64url');
  return `${parte({ alg: 'HS256' })}.${parte({
    iat: IAT_FIJO,
    exp: IAT_FIJO + SEGUNDOS_DE_VIDA_DEL_TOKEN,
    email: 'terminal@pruebas.invalid',
    is_anonymous: false,
    app_metadata: { rol: 'terminal' },
  })}.firma`;
}

class AuthDeMentira implements ClienteDeAuth {
  public iniciarSesionConContrasena(): Promise<ResultadoDeAuth> {
    return Promise.resolve({
      ok: true,
      sesion: { accessToken: jwtDeTerminal(), tokenDeRefresco: 'refresco', duracionDeclaradaEnSegundos: SEGUNDOS_DE_VIDA_DEL_TOKEN },
    });
  }
  public refrescar(): Promise<ResultadoDeAuth> {
    return this.iniciarSesionConContrasena();
  }
}

class CifradoDeMentira implements CifradoSeguro {
  public isEncryptionAvailable(): boolean {
    return true;
  }
  public encryptString(texto: string): Buffer {
    return Buffer.from(texto, 'utf8');
  }
  public decryptString(cifrado: Buffer): string {
    return cifrado.toString('utf8');
  }
}

// ---------------------------------------------------------------------------
// Las dependencias REALES de los manejadores, sobre una base dada
// ---------------------------------------------------------------------------

function dependenciasSobre(
  base: Database,
  carpeta: string,
  extra: { restauracion?: ServicioDeRestauracion } = {},
): { dependencias: DependenciasDeIpc; repos: Repositorios } {
  const repos = crearRepositorios(base);
  const autenticacion = new ServicioDeAutenticacion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
    cifrado: new CifradoDePrueba(),
  });
  const fotos = new AlmacenDeFotos(carpeta, { reducir: (): Buffer | null => null });
  const productos = new ServicioDeProductos({
    base,
    productos: repos.productos,
    categorias: repos.categorias,
    auditoria: repos.auditoria,
    describirFoto: (ruta): ArchivoParaSubir | null => fotos.describirParaSubir(ruta),
  });
  const caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  const sesionDeNube = new SesionDeNube({
    auth: new AuthDeMentira(),
    credencial: new AlmacenDeCredencial(carpeta, new CifradoDeMentira()),
    programar: (): number => 0,
    cancelar: (): void => undefined,
    registrar: (): void => undefined,
  });
  const dependencias: DependenciasDeIpc = {
    controladorDeSalida: new ControladorDeSalidaControlada({ autenticacion, cerrarAplicacion: (): void => undefined }),
    autenticacion,
    sesion: new SesionActual(),
    usuarios: repos.usuarios,
    caja,
    catalogo: {
      categorias: new ServicioDeCategorias({ base, categorias: repos.categorias, auditoria: repos.auditoria }),
      productos,
      fotos,
    },
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
    anulacionDeVenta: new ServicioDeAnulacionDeVenta({
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
    }),
    gestionDeUsuarios: new ServicioDeUsuarios({ base, usuarios: repos.usuarios, auditoria: repos.auditoria }),
    negocio: new ServicioDeConfiguracionDeNegocio({ base, configuracion: repos.configuracionNegocio, auditoria: repos.auditoria }),
    recibos: new ServicioDeRecibos({
      base,
      ventas: repos.ventas,
      ventaDetalle: repos.ventaDetalle,
      recibos: repos.recibos,
      usuarios: repos.usuarios,
      configuracion: repos.configuracionNegocio,
      anulaciones: repos.anulacionesDeVenta,
      impresora: new NullPrinterProvider(),
      generarPdf: (_html, destino): Promise<void> => {
        writeFileSync(destino, '%PDF-1.4 de mentira\n');
        return Promise.resolve();
      },
      carpetaDeDatos: carpeta,
      log: new LogTecnicoSilencioso(),
    }),
    repositorioDeRecibos: repos.recibos,
    preciosEspeciales: repos.preciosEspeciales,
    reportes: new ServicioDeReportes({
      ventas: repos.ventas,
      ventaDetalle: repos.ventaDetalle,
      productos: repos.productos,
      categorias: repos.categorias,
      anulaciones: repos.anulacionesDeVenta,
    }),
    limitesDeDescuento: new ServicioDeLimitesDeDescuento({
      base,
      limites: repos.limitesDescuento,
      auditoria: repos.auditoria,
      nombreDeUsuario: (id): string | null => repos.usuarios.obtenerPorId(id)?.nombre ?? null,
    }),
    historialDeCajas: new ServicioDeHistorialDeCajas({
      cajaSesiones: repos.cajaSesiones,
      auditoria: repos.auditoria,
      usuarios: repos.usuarios,
      desglose: repos.desgloseDeCaja,
      denominaciones: repos.denominaciones,
    }),
    impresora: new ServicioDeImpresora({
      carpetaDeDatos: carpeta,
      listar: (): Promise<ReturnType<typeof impresorasSimuladas>> => Promise.resolve(impresorasSimuladas()),
      enviador: new EnviadorSimulado(carpeta),
      log: new LogTecnicoSilencioso(),
    }),
    nube: sesionDeNube,
    sincronizacion: new ServicioDeSincronizacion({
      base,
      cola: repos.syncCola,
      auditoria: repos.auditoria,
      credencial: (): {
        hayCredencial: boolean;
        revocada: boolean;
        conectada: boolean;
        yaSeIntentoConectar: boolean;
        ilegible: boolean;
      } => {
        const estado = sesionDeNube.estado();
        return {
          hayCredencial: estado.hayCredencial,
          revocada: estado.revocada,
          conectada: estado.conectada,
          yaSeIntentoConectar: sesionDeNube.primerIntentoTerminado,
          ilegible: estado.credencialIlegible,
        };
      },
      ejecutarCicloAhora: (): Promise<unknown> => Promise.resolve(null),
      conexionTrasElUltimoFallo: (): null => null,
      medicionEnCurso: (): null => null,
    }),
    restauracion:
      extra.restauracion ??
      new ServicioDeRestauracion({
        base,
        usuarios: repos.usuarios,
        auditoria: repos.auditoria,
        cliente: null,
        urlDelProyecto: null,
        puestoDeControl: new AlmacenDelPuestoDeControl(carpeta),
        carpetaDeDatos: carpeta,
      }),
  };
  return { dependencias, repos };
}

// ===========================================================================
// 1. LA TIENDA: una terminal con datos de verdad, todos los canales de uso
// ===========================================================================

describe('1. En una tienda con datos, cada canal devuelve algo que el puente puede clonar', () => {
  let carpeta: string;
  let base: Database;
  let terminal: TerminalDeOrigen;
  let repos: Repositorios;

  beforeAll(() => {
    reiniciarSenalDeTransaccion();
    observarLotesEncolados(null);
    electron.manejadores.clear();
    carpeta = mkdtempSync(join(tmpdir(), 'pos-canales-tienda-'));
    abrirBaseDeDatos(join(carpeta, 'pos-agricola.db'));
    base = obtenerBaseDeDatos();
    terminal = sembrarTerminalDeOrigen(base, carpeta);
    electron.rutaDeLaFotoElegida = join(carpeta, 'elegida.png');
    writeFileSync(electron.rutaDeLaFotoElegida, PNG_DE_UN_PIXEL);
    const armado = dependenciasSobre(base, carpeta);
    repos = armado.repos;
    registrarManejadoresIpc(armado.dependencias);
    anotarRegistrados();
  });

  afterAll(() => {
    observarLotesEncolados(null);
    cerrarBaseDeDatos();
    rmSync(carpeta, { recursive: true, force: true });
  });

  it('diagnóstico, sesión e ingreso', async () => {
    await llamar(CANALES_IPC.diagnosticoAplicacion, 'aplicación');
    await llamar(CANALES_IPC.diagnosticoBaseDeDatos, 'base con conteos', { incluirConteoDeRegistros: true });
    await llamar(CANALES_IPC.estadoDeSesion, 'antes de ingresar');
    await llamar(CANALES_IPC.listarUsuariosParaIngreso, 'con Ana bloqueada');
    await llamar(CANALES_IPC.crearPrimerAdministrador, 'con usuarios ya creados (se niega)', { nombre: 'Otro', pin: '9999' });
    const ingreso = await llamar(CANALES_IPC.iniciarSesion, 'Jimmy', { usuarioId: terminal.ids.jimmy, pin: PIN_DE_JIMMY });
    expect(datosDe(ingreso, 'ingreso').autenticado).toBe(true);
    await llamar(CANALES_IPC.estadoDeSesion, 'con sesión');
    // La autorización remota por TOTP: iniciar devuelve el secreto y la matriz
    // del QR, confirmar lo guarda con el código de la app, cancelar descarta.
    const inscripcion = datosDe(await llamar(CANALES_IPC.iniciarAutorizacionRemota, 'iniciar inscripción remota de Jimmy'), 'iniciar');
    await llamar(CANALES_IPC.confirmarAutorizacionRemota, 'confirmar con un código mal formado', { codigo: '12' });
    await llamar(CANALES_IPC.confirmarAutorizacionRemota, 'confirmar con el código de la app', {
      codigo: codigoDeLaApp(inscripcion.secreto as string, Date.now()),
    });
    await llamar(CANALES_IPC.iniciarAutorizacionRemota, 'iniciar otra (reemplazaría la anterior)');
    await llamar(CANALES_IPC.cancelarAutorizacionRemota, 'cancelar la inscripción en curso');
  });

  it('catálogo: categorías, productos, ajuste y foto', async () => {
    await llamar(CANALES_IPC.categoriasListar, 'listar');
    const categoria = datosDe(
      await llamar(CANALES_IPC.categoriasCrear, 'crear', { nombre: 'Semillas' }),
      'crear categoría',
    );
    await llamar(CANALES_IPC.categoriasEditar, 'editar', { id: categoria.id, nombre: 'Semillas y abonos' });
    await llamar(CANALES_IPC.categoriasFijarActivo, 'desactivar', { id: categoria.id, activo: false });
    await llamar(CANALES_IPC.productosListar, 'listar');
    const foto = datosDe(await llamar(CANALES_IPC.productosElegirFoto, 'elegir foto'), 'elegir foto');
    const campos = {
      nombre: 'Abono 15-15-15',
      categoriaId: terminal.ids.categoria,
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '1',
      precioBase: '4.75',
      precioCompra: '3.10',
      // Desde la spec 002 el payload los exige; con valores, para que el
      // objeto `mayorista` también cruce el puente en la respuesta.
      precioMayorista: '4.50',
      cantidadMinimaMayorista: '50',
      fotoPath: foto.fotoPath,
    };
    const producto = datosDe(
      await llamar(CANALES_IPC.productosCrear, 'crear con costo y foto', { ...campos, inventarioInicial: '40' }),
      'crear producto',
    );
    await llamar(CANALES_IPC.productosEditar, 'editar', { ...campos, id: producto.id, precioBase: '4.95' });
    await llamar(CANALES_IPC.productosAjustarInventario, 'sumar', { productoId: producto.id, cantidad: '10', motivo: 'llegó un pedido' });
    await llamar(CANALES_IPC.productosFijarActivo, 'desactivar', { id: producto.id, activo: false });
    await llamar(CANALES_IPC.productosFijarActivo, 'reactivar', { id: producto.id, activo: true });
  });

  it('venta: estado, cobro simple, cobro con descuento que exige PIN, y la anulación en sus dos pasos', async () => {
    await llamar(CANALES_IPC.ventaEstado, 'con la caja de Jimmy abierta');
    const lineas = [{ productoId: terminal.ids.frijol, cantidad: '1' }];
    const enEfectivo = datosDe(
      await llamar(CANALES_IPC.ventaCobrar, 'efectivo sin descuento', { lineas, descuento: null, formaPago: 'efectivo', numBoleta: null }),
      'cobro en efectivo',
    );
    const descuento = { tipo: 'porcentaje', valor: '5' };
    await llamar(CANALES_IPC.ventaCobrar, 'descuento sin PIN', { lineas, descuento, formaPago: 'efectivo', numBoleta: null });
    const conTarjeta = datosDe(
      await llamar(CANALES_IPC.ventaCobrar, 'descuento con PIN', {
        lineas,
        descuento,
        formaPago: 'tarjeta',
        numBoleta: 'B-1',
        pinDescuento: PIN_DE_JIMMY,
      }),
      'cobro con tarjeta',
    );

    // La anulación (docs/ANULACION-DE-VENTA.md §4.3): sin PIN devuelve la vista
    // previa; con un PIN equivocado, el rechazo; con el correcto, la anulación.
    const efectivo = { ventaId: enEfectivo.ventaId, motivo: 'el cliente devolvió el producto', voucher: null };
    await llamar(CANALES_IPC.ventaAnular, 'anulación en efectivo, sin PIN', { ...efectivo, pin: null });
    await llamar(CANALES_IPC.ventaAnular, 'anulación en efectivo, PIN equivocado', { ...efectivo, pin: '0000' });
    await llamar(CANALES_IPC.ventaAnular, 'anulación en efectivo, con PIN', { ...efectivo, pin: PIN_DE_JIMMY });
    const tarjeta = { ventaId: conTarjeta.ventaId, motivo: 'cobro duplicado', voucher: 'B-1' };
    await llamar(CANALES_IPC.ventaAnular, 'anulación con tarjeta, voucher equivocado (se niega)', { ...tarjeta, voucher: 'B-2', pin: null });
    await llamar(CANALES_IPC.ventaAnular, 'anulación con tarjeta, con PIN', { ...tarjeta, pin: PIN_DE_JIMMY });
  });

  it('usuarios', async () => {
    await llamar(CANALES_IPC.usuariosListar, 'listar');
    const rosa = datosDe(
      await llamar(CANALES_IPC.usuariosCrear, 'crear', { nombre: 'Rosa', rol: 'venta', pin: '4321' }),
      'crear usuario',
    );
    await llamar(CANALES_IPC.usuariosEditar, 'editar', { id: rosa.id, nombre: 'Rosa María', rol: 'venta' });
    await llamar(CANALES_IPC.usuariosCambiarPin, 'cambiar PIN', { id: rosa.id, pin: '4322' });
    await llamar(CANALES_IPC.usuariosFijarActivo, 'dar de baja', { id: rosa.id, activo: false });
    await llamar(CANALES_IPC.usuariosFijarActivo, 'reactivar', { id: rosa.id, activo: true });
  });

  it('negocio y recibos', async () => {
    await llamar(CANALES_IPC.negocioObtener, 'obtener');
    await llamar(CANALES_IPC.negocioGuardar, 'guardar', {
      nombreComercial: 'Agroservicios Cano',
      direccion: 'Km 12',
      telefono: '5555-1234',
      nit: null,
    });
    await llamar(CANALES_IPC.recibosListar, 'listar todas', { formaPago: 'todas' });
    await llamar(CANALES_IPC.recibosListar, 'listar solo tarjeta', { formaPago: 'tarjeta' });
    await llamar(CANALES_IPC.recibosVer, 'ver el combinado', { id: terminal.ids.reciboCombinado });
    await llamar(CANALES_IPC.recibosReimprimir, 'reimprimir', { id: terminal.ids.reciboConTarjeta });
  });

  it('reportes y topes', async () => {
    await llamar(CANALES_IPC.reportesResumenDeVentas, 'hoy', { clase: 'hoy' });
    await llamar(CANALES_IPC.reportesVentasPorProducto, 'este mes', { clase: 'este-mes' });
    await llamar(CANALES_IPC.reportesInventario, 'por cantidad', { orden: 'cantidad' });
    await llamar(CANALES_IPC.limitesListar, 'listar');
    await llamar(CANALES_IPC.limitesFijar, 'fijar', { rol: 'venta', porcentaje: '12', montoFijo: '25' });
  });

  it('impresora: estado, lista, las dos pruebas, la confirmación, guardar y quitar', async () => {
    await llamar(CANALES_IPC.impresoraEstado, 'sin impresora');
    await llamar(CANALES_IPC.impresoraListar, 'simuladas');
    await llamar(CANALES_IPC.impresoraImprimirPrueba, 'desconectada', { nombre: IMPRESORA_SIMULADA_DESCONECTADA });
    const prueba = datosDe(
      await llamar(CANALES_IPC.impresoraImprimirPrueba, 'la que recibe', { nombre: IMPRESORA_SIMULADA_QUE_RECIBE }),
      'prueba que recibe',
    );
    await llamar(CANALES_IPC.impresoraConfirmarPrueba, 'ilegible', { pruebaId: prueba.pruebaId, resultado: 'ilegible' });
    await llamar(CANALES_IPC.impresoraGuardar, 'guardar', { nombre: IMPRESORA_SIMULADA_QUE_RECIBE });
    await llamar(CANALES_IPC.impresoraEstado, 'con impresora');
    await llamar(CANALES_IPC.impresoraQuitar, 'quitar');
  });

  it('nube y sincronización, con un lote detenido de verdad', async () => {
    await llamar(CANALES_IPC.nubeEstado, 'sin conectar');
    await llamar(CANALES_IPC.nubeConectar, 'conectar', { correo: 'terminal@pruebas.invalid', contrasena: 'x' });
    await llamar(CANALES_IPC.nubeEstado, 'conectada');
    const [lote] = base.prepare('SELECT lote_id FROM sync_cola WHERE sincronizado_en IS NULL LIMIT 2').all() as { lote_id: string }[];
    const [otro] = base
      .prepare('SELECT DISTINCT lote_id FROM sync_cola WHERE sincronizado_en IS NULL AND lote_id <> ? LIMIT 1')
      .all(lote?.lote_id ?? '') as { lote_id: string }[];
    base.prepare("UPDATE sync_cola SET bloqueante = 1, error = '23505 duplicate key' WHERE lote_id IN (?, ?)").run(lote?.lote_id, otro?.lote_id);
    await llamar(CANALES_IPC.sincronizacionResumen, 'detenida');
    await llamar(CANALES_IPC.sincronizacionDetalle, 'con el lote bloqueante');
    await llamar(CANALES_IPC.sincronizacionReintentarLote, 'reintentar', { loteId: lote?.lote_id });
    await llamar(CANALES_IPC.sincronizacionSaltarLote, 'saltar', { loteId: otro?.lote_id, pin: PIN_DE_JIMMY });
  });

  it('caja: cierre propio con autorización, apertura de otra persona y cierre de CAJA AJENA', async () => {
    await llamar(CANALES_IPC.estadoDeCaja, 'la de Jimmy abierta');
    const deMenos = { modo: 'simple', monto: '1.00' };
    await llamar(CANALES_IPC.cerrarCaja, 'propia, con diferencia', { efectivo: deMenos });
    await llamar(CANALES_IPC.cerrarCaja, 'PIN correcto: revela', { efectivo: deMenos, pin: PIN_DE_JIMMY });
    await llamar(CANALES_IPC.cancelarAutorizacionDeCierre, 'cancelar');
    await llamar(CANALES_IPC.cerrarCaja, 'PIN otra vez', { efectivo: deMenos, pin: PIN_DE_JIMMY });
    const cerrada = await llamar(CANALES_IPC.cerrarCaja, 'confirmar', { efectivo: deMenos, confirmarAutorizacion: true });
    expect(datosDe(cerrada, 'cierre propio').cerrada).toBe(true);

    // Rosa abre, y Jimmy cierra la caja de ella: el caso de §4.42.
    const rosa = repos.usuarios.listarActivos().find((u) => u.nombre === 'Rosa María');
    await llamar(CANALES_IPC.cerrarSesion, 'Jimmy sale');
    await llamar(CANALES_IPC.iniciarSesion, 'Rosa', { usuarioId: rosa?.id, pin: '4322' });
    await llamar(CANALES_IPC.abrirCaja, 'Rosa abre', { efectivo: { modo: 'simple', monto: '100.00' } });
    await llamar(CANALES_IPC.cerrarSesion, 'Rosa sale');
    await llamar(CANALES_IPC.iniciarSesion, 'Jimmy vuelve', { usuarioId: terminal.ids.jimmy, pin: PIN_DE_JIMMY });
    await llamar(CANALES_IPC.estadoDeCaja, 'caja ajena');
    const exacto = { modo: 'simple', monto: '100.00' };
    const pedido = await llamar(CANALES_IPC.cerrarCaja, 'AJENA sin PIN', { efectivo: exacto });
    expect(datosDe(pedido, 'pedido de caja ajena').codigo).toBe('REQUIERE_AUTORIZACION_DE_CAJA_AJENA');
    const ajena = await llamar(CANALES_IPC.cerrarCaja, 'AJENA con PIN', { efectivo: exacto, pinCajaAjena: PIN_DE_JIMMY });
    expect(datosDe(ajena, 'cierre ajeno').cerrada).toBe(true);

    const historial = datosDe(
      await llamar(CANALES_IPC.cajasHistorial, 'todas', { desde: null, hasta: null, abiertaPor: null }),
      'historial',
    );
    await llamar(CANALES_IPC.cajasHistorial, 'solo Rosa', { desde: null, hasta: null, abiertaPor: rosa?.id });
    const primera = (historial.sesiones as { id: string }[])[0];
    await llamar(CANALES_IPC.cajasDetalle, 'la más reciente', { id: primera?.id });
  });

  it('salida controlada', async () => {
    await llamar(CANALES_IPC.solicitarSalidaControlada, 'solicitar');
    await llamar(CANALES_IPC.confirmarSalidaControlada, 'confirmar con el PIN remoto', { pin: '8642' });
    await llamar(CANALES_IPC.cerrarSesion, 'salir');
  });
});

// ===========================================================================
// 2. LA RESTAURACIÓN: una instalación vacía contra una nube de mentira
// ===========================================================================

describe('2. En una instalación vacía, los canales de la restauración también', () => {
  const URL_DEL_PROYECTO = 'https://ztidrshifrblhfraiowg.supabase.co';
  const CREDENCIAL = { correo: 'julio@restauracion.invalid', contrasena: 'no-se-guarda' };
  const FECHA_DEL_ROBO = '2026-09-12T12:00:00.000Z';
  const DESPUES_DEL_ROBO = '2026-09-12T15:30:00.123456+00:00';
  const PAGINA_EN_QUE_SE_CANCELA = 3;

  let carpetaOrigen: string;
  let carpetaDestino: string;
  let origen: BaseDePrueba;
  let destino: BaseDePrueba;
  let terminal: TerminalDeOrigen;

  function servicioCon(nube: NubeDeMentira): ServicioDeRestauracion {
    const reposDestino = crearRepositorios(destino.base);
    return new ServicioDeRestauracion({
      base: destino.base,
      usuarios: reposDestino.usuarios,
      auditoria: reposDestino.auditoria,
      cliente: nube,
      urlDelProyecto: URL_DEL_PROYECTO,
      puestoDeControl: new AlmacenDelPuestoDeControl(carpetaDestino),
      carpetaDeDatos: carpetaDestino,
      filasPorPagina: 1,
    });
  }

  function registrarCon(servicio: ServicioDeRestauracion): void {
    electron.manejadores.clear();
    registrarManejadoresIpc(dependenciasSobre(destino.base, carpetaDestino, { restauracion: servicio }).dependencias);
    anotarRegistrados();
  }

  beforeAll(() => {
    reiniciarSenalDeTransaccion();
    observarLotesEncolados(null);
    carpetaOrigen = mkdtempSync(join(tmpdir(), 'pos-canales-origen-'));
    carpetaDestino = mkdtempSync(join(tmpdir(), 'pos-canales-destino-'));
    origen = crearBaseMigrada();
    destino = crearBaseMigrada();
    terminal = sembrarTerminalDeOrigen(origen.base, carpetaOrigen);
  });

  afterAll(() => {
    observarLotesEncolados(null);
    origen.limpiar();
    destino.limpiar();
    rmSync(carpetaOrigen, { recursive: true, force: true });
    rmSync(carpetaDestino, { recursive: true, force: true });
  });

  it('iniciar, cancelar a mitad y retomar', async () => {
    const nube = new NubeDeMentira({
      origen: origen.base,
      alLeerPagina: (numero): void => {
        if (numero === PAGINA_EN_QUE_SE_CANCELA) {
          void llamar(CANALES_IPC.restauracionCancelar, 'cancelar a mitad');
        }
      },
    });
    const servicio = servicioCon(nube);
    registrarCon(servicio);
    await llamar(CANALES_IPC.restauracionEstado, 'antes de empezar');
    await llamar(CANALES_IPC.restauracionIniciar, 'iniciar', { ...CREDENCIAL, motivo: 'falla', fechaDelRobo: null });
    await servicio.esperarACorrida();
    await llamar(CANALES_IPC.restauracionProgreso, 'cancelada');

    const retomado = servicioCon(new NubeDeMentira({ origen: origen.base }));
    registrarCon(retomado);
    await llamar(CANALES_IPC.restauracionRetomar, 'retomar', CREDENCIAL);
    await retomado.esperarACorrida();
    await llamar(CANALES_IPC.restauracionProgreso, 'en revisión');
    await llamar(CANALES_IPC.restauracionCancelar, 'dejar para después');
  });

  it('robo: aceptar una fila excluida, revisar un usuario, asignar PIN y terminar', async () => {
    destino.limpiar();
    rmSync(carpetaDestino, { recursive: true, force: true });
    carpetaDestino = mkdtempSync(join(tmpdir(), 'pos-canales-destino-'));
    destino = crearBaseMigrada();

    const detalle = (origen.base.prepare('SELECT id FROM venta_detalle WHERE venta_id = ?').get(terminal.ids.ventaCombinada) as { id: string }).id;
    const recibidoEn = new Map<string, string>([
      [`ventas/${terminal.ids.ventaCombinada}`, DESPUES_DEL_ROBO],
      [`venta_detalle/${detalle}`, DESPUES_DEL_ROBO],
      [`recibos/${terminal.ids.reciboCombinado}`, DESPUES_DEL_ROBO],
      [`usuarios/${terminal.ids.ana}`, DESPUES_DEL_ROBO],
    ]);
    const servicio = servicioCon(new NubeDeMentira({ origen: origen.base, recibidoEn }));
    registrarCon(servicio);
    await llamar(CANALES_IPC.restauracionIniciar, 'iniciar por robo', { ...CREDENCIAL, motivo: 'robo', fechaDelRobo: FECHA_DEL_ROBO });
    await servicio.esperarACorrida();
    await llamar(CANALES_IPC.restauracionAceptarExcluida, 'restaurar la venta igual', { tabla: 'ventas', id: terminal.ids.ventaCombinada });
    await llamar(CANALES_IPC.restauracionRevisarUsuario, 'Ana, de baja', { id: terminal.ids.ana, rol: 'venta', activo: false });
    await llamar(CANALES_IPC.restauracionTerminar, 'sin PIN (se niega)');
    await llamar(CANALES_IPC.restauracionAsignarPin, 'PIN para Jimmy', { id: terminal.ids.jimmy, pin: '9753' });
    await llamar(CANALES_IPC.restauracionTerminar, 'terminar');
  });

  it('y el primer administrador de una instalación nueva', async () => {
    const nueva = crearBaseMigrada();
    const carpeta = mkdtempSync(join(tmpdir(), 'pos-canales-nueva-'));
    try {
      electron.manejadores.clear();
      registrarManejadoresIpc(dependenciasSobre(nueva.base, carpeta).dependencias);
      anotarRegistrados();
      await llamar(CANALES_IPC.estadoDeSesion, 'instalación vacía');
      await llamar(CANALES_IPC.crearPrimerAdministrador, 'crear', { nombre: 'Jimmy', pin: '2468' });
    } finally {
      nueva.limpiar();
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// 3. EL VEREDICTO
// ===========================================================================

describe('3. El veredicto, sobre las llamadas de arriba', () => {
  it('deja la salida cruda: cada canal con sus pasos y el código de cada respuesta', () => {
    const porCanal = new Map<string, string[]>();
    for (const l of llamadas) {
      porCanal.set(l.canal, [...(porCanal.get(l.canal) ?? []), `${l.paso}=${l.ok ? 'ok' : (l.codigo ?? '')}${l.noSeClona === null ? '' : ' NO SE CLONA'}`]);
    }
    for (const [canal, pasos] of [...porCanal.entries()].sort()) {
      console.info(`[canal] ${canal.padEnd(42)} ${pasos.join(' · ')}`);
    }
    console.info(`[canal] ${String(canalesRegistrados.size)} canales registrados, ${String(porCanal.size)} llamados, ${String(llamadas.length)} llamadas`);
    expect(porCanal.size).toBeGreaterThan(0);
  });

  it('se registraron los canales que se esperan (control: la prueba no corre vacía)', () => {
    const MINIMO_DE_CANALES = 56;
    expect(canalesRegistrados.size).toBeGreaterThanOrEqual(MINIMO_DE_CANALES);
  });

  it('TODO canal registrado se llamó al menos una vez', () => {
    const llamados = new Set(llamadas.map((l) => l.canal));
    const sinLlamar = [...canalesRegistrados].filter((c) => !llamados.has(c));
    expect(sinLlamar, `canales que nadie llamó: escribí su llamada en esta prueba`).toEqual([]);
  });

  it('TODO canal devolvió al menos una respuesta ok, así que se clonaron DATOS y no solo errores', () => {
    const conOk = new Set(llamadas.filter((l) => l.ok).map((l) => l.canal));
    const sinOk = [...canalesRegistrados].filter((c) => !conOk.has(c));
    expect(sinOk, 'canales que nunca respondieron ok').toEqual([]);
  });

  it('NINGUNA respuesta de ningún canal deja de cruzar el puente IPC', () => {
    const rotas = llamadas.filter((l) => l.noSeClona !== null).map((l) => `${l.canal} [${l.paso}]: ${l.noSeClona ?? ''}`);
    expect(rotas).toEqual([]);
  });

  it('NINGÚN canal tuvo que ser rescatado por el envoltorio: ninguna respuesta con RESPUESTA_NO_SERIALIZABLE', () => {
    // Desde §4.42 el envoltorio convierte un resultado no clonable en un error
    // que la ventana SÍ recibe, así que la comprobación de arriba ya no puede
    // fallar por eso. Esta es la que lo delata: la ventana no se cuelga, pero el
    // canal sigue teniendo el defecto, y el detalle dice dónde.
    const rescatadas = llamadas
      .filter((l) => l.codigo === CODIGO_RESPUESTA_NO_SERIALIZABLE)
      .map((l) => `${l.canal} [${l.paso}]: ${l.detalle ?? ''}`);
    expect(rescatadas).toEqual([]);
  });
});
