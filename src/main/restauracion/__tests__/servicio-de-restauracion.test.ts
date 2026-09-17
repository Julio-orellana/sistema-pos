/**
 * La restauración de punta a punta, con base SQLite REAL de los dos lados.
 *
 * La «nube» es `NubeDeMentira`: contesta con la forma exacta de PostgREST
 * sobre una terminal de origen llenada con los servicios de verdad. La
 * restauración corre entera —precondiciones, tablas por páginas, fotos,
 * verificación, revisión, PIN, cierre— y el resultado se compara contra la
 * terminal de origen ID POR ID y BYTE A BYTE, que es lo que a la tienda le
 * importa: que la base reconstruida no se vea completa estando sutilmente mal.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HASH_SIN_PIN, verificarPin } from '@shared/auth';
import { NullPrinterProvider } from '@shared/adapters/receipt-printer';
import { COLUMNAS_EXCLUIDAS } from '@main/database/bandeja-de-salida';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { reiniciarSenalDeTransaccion } from '@main/database/transaccion-en-curso';
import { observarLotesEncolados } from '@main/database/bandeja-de-salida';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeAnulacionDeVenta } from '@main/domain/venta/servicio-de-anulacion';
import { ErrorDeNegocio } from '@main/database/errores';
import { LogTecnicoSilencioso } from '@main/log-tecnico';

import { AlmacenDelPuestoDeControl, ARCHIVO_DEL_PUESTO_DE_CONTROL } from '../puesto-de-control';
import { ORDEN_DE_RESTAURACION } from '../orden-de-restauracion';
import { ACCIONES_DE_RESTAURACION, ServicioDeRestauracion } from '../servicio-de-restauracion';
import { contratoDeLaFoto, NubeDeMentira, type OpcionesDeLaNubeDeMentira } from './nube-de-mentira';
import { PIN_DE_ANA, PIN_DE_JIMMY, sembrarTerminalDeOrigen, type TerminalDeOrigen } from './terminal-de-origen';
import { CifradoDePrueba } from '@main/domain/usuarios/__tests__/ayuda-totp';

const URL_DEL_PROYECTO = 'https://ztidrshifrblhfraiowg.supabase.co';
const CORREO = 'julio@restauracion.invalid';
const CONTRASENA = 'una-contraseña-que-no-se-guarda';

let carpetaA: string;
let carpetaB: string;
let origen: { base: Database; limpiar: () => void };
let destino: { base: Database; limpiar: () => void };
let terminal: TerminalDeOrigen;
let reposB: Repositorios;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function crearNube(opciones: Partial<OpcionesDeLaNubeDeMentira> = {}): NubeDeMentira {
  return new NubeDeMentira({
    origen: origen.base,
    fotos: new Map([[terminal.fotoDelMaiz.objeto, terminal.fotoDelMaiz.bytes]]),
    ...opciones,
  });
}

function crearServicio(nube: NubeDeMentira | null, extra: { filasPorPagina?: number; base?: Database } = {}): ServicioDeRestauracion {
  const base = extra.base ?? destino.base;
  const repos = extra.base === undefined ? reposB : crearRepositorios(base);
  return new ServicioDeRestauracion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    cliente: nube,
    urlDelProyecto: nube === null ? null : URL_DEL_PROYECTO,
    puestoDeControl: new AlmacenDelPuestoDeControl(carpetaB),
    carpetaDeDatos: carpetaB,
    filasPorPagina: extra.filasPorPagina ?? 2,
  });
}

async function restaurarEntera(nube: NubeDeMentira, filasPorPagina = 2): Promise<ServicioDeRestauracion> {
  const servicio = crearServicio(nube, { filasPorPagina });
  await servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null });
  await servicio.esperarACorrida();
  return servicio;
}

function contar(base: Database, tabla: string): number {
  return (base.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n;
}

function ids(base: Database, tabla: string): string[] {
  return (base.prepare(`SELECT id FROM ${tabla} ORDER BY id`).all() as { id: string }[]).map((f) => f.id);
}

function filas(base: Database, tabla: string): Record<string, unknown>[] {
  return base.prepare(`SELECT * FROM ${tabla} ORDER BY id`).all() as Record<string, unknown>[];
}

beforeEach(() => {
  reiniciarSenalDeTransaccion();
  observarLotesEncolados(null);
  carpetaA = mkdtempSync(join(tmpdir(), 'pos-restauracion-origen-'));
  carpetaB = mkdtempSync(join(tmpdir(), 'pos-restauracion-destino-'));
  origen = crearBaseMigrada();
  destino = crearBaseMigrada();
  terminal = sembrarTerminalDeOrigen(origen.base, carpetaA);
  reposB = crearRepositorios(destino.base);
});

afterEach(() => {
  observarLotesEncolados(null);
  reiniciarSenalDeTransaccion();
  origen.limpiar();
  destino.limpiar();
  rmSync(carpetaA, { recursive: true, force: true });
  rmSync(carpetaB, { recursive: true, force: true });
});

// ===========================================================================
describe('La terminal de origen tiene lo que el diseño pide', () => {
  it('dos usuarios, uno bloqueado con sus asientos sueltos; tres productos; cuatro ventas, UNA ANULADA; dos cajas; un tope con id fijo', () => {
    expect(contar(origen.base, 'usuarios')).toBe(2);
    expect(terminal.repos.usuarios.obtenerPorId(terminal.ids.ana)?.bloqueadoHasta).not.toBeNull();
    const acciones = (origen.base.prepare('SELECT accion FROM auditoria_log').all() as { accion: string }[]).map((a) => a.accion);
    expect(acciones).toContain('usuario_bloqueado');
    expect(acciones.filter((a) => a === 'ingreso_fallido')).toHaveLength(2);
    expect(contar(origen.base, 'productos')).toBe(3);
    expect(contar(origen.base, 'ventas')).toBe(4);
    expect(contar(origen.base, 'venta_detalle')).toBe(6);
    expect(contar(origen.base, 'recibos')).toBe(3);
    expect(ids(origen.base, 'anulaciones_de_venta')).toEqual([terminal.ids.anulacion]);
    expect(contar(origen.base, 'caja_sesiones')).toBe(2);
    expect(contar(origen.base, 'caja_sesion_denominaciones')).toBe(2);
    expect(contar(origen.base, 'precios_especiales')).toBe(1);
    expect(ids(origen.base, 'limites_descuento')).toEqual(['0c2ebde1-fe5f-4d8b-a7c4-d137888109ca']);
  });

  it('la venta combinada tiene precio especial y descuento autorizado, y su subtotal_exacto lleva tres decimales', () => {
    const venta = terminal.repos.ventas.obtenerPorId(terminal.ids.ventaCombinada);
    expect(venta?.descuentoAutorizadoPor).toBe(terminal.ids.jimmy);
    expect(venta?.descuentoAutorizadoVia).toBe('presencial');
    const linea = filas(origen.base, 'venta_detalle').find((f) => f.venta_id === terminal.ids.ventaCombinada);
    expect(linea?.precio_unitario_snap).toBe('1.19');
    expect(linea?.subtotal_exacto).toBe('4.165');
  });
});

// ===========================================================================
describe('Una restauración completa, por falla, contra la nube de mentira', () => {
  it('termina en revisión con TODAS las tablas listas y la verificación OK', async () => {
    const nube = crearNube();
    const servicio = await restaurarEntera(nube);
    const progreso = servicio.progreso();
    expect(progreso.fase).toBe('revision');
    expect(progreso.mensaje).toBeNull();
    expect(progreso.tablas.every((t) => t.estado === 'lista')).toBe(true);
    expect(progreso.verificacion?.ok).toBe(true);
    expect(progreso.verificacion?.detalle).toEqual([]);
    expect(nube.sesionesIniciadas).toEqual([CORREO]);
    // Con páginas de 2 filas hubo varias páginas por tabla: se ejercitó el paginado.
    expect(nube.paginasLeidas).toBeGreaterThan(ORDEN_DE_RESTAURACION.length);
  });

  it('cada tabla tiene los MISMOS ids que la terminal de origen: ninguno se regeneró', async () => {
    await restaurarEntera(crearNube());
    for (const tabla of ORDEN_DE_RESTAURACION) {
      expect(ids(destino.base, tabla), tabla).toEqual(ids(origen.base, tabla));
    }
  });

  it('el conteo por tabla coincide, y también las 11 denominaciones', async () => {
    const servicio = await restaurarEntera(crearNube());
    for (const conteo of servicio.progreso().verificacion?.conteos ?? []) {
      expect(conteo.coincide, conteo.tabla).toBe(true);
      expect(conteo.local).toBe(contar(origen.base, conteo.tabla));
    }
    expect(contar(destino.base, 'denominaciones')).toBe(11);
  });

  it('LOS DECIMALES SOBREVIVEN BYTE A BYTE: venta_detalle y productos son idénticos a los de origen, subtotal_exacto incluido', async () => {
    await restaurarEntera(crearNube());
    expect(filas(destino.base, 'venta_detalle')).toEqual(filas(origen.base, 'venta_detalle'));
    expect(filas(destino.base, 'productos')).toEqual(filas(origen.base, 'productos'));
    expect(filas(destino.base, 'caja_sesiones')).toEqual(filas(origen.base, 'caja_sesiones'));
    expect(filas(destino.base, 'caja_sesion_denominaciones')).toEqual(filas(origen.base, 'caja_sesion_denominaciones'));
    expect(filas(destino.base, 'precios_especiales')).toEqual(filas(origen.base, 'precios_especiales'));
    expect(filas(destino.base, 'limites_descuento')).toEqual(filas(origen.base, 'limites_descuento'));
    expect(filas(destino.base, 'categorias')).toEqual(filas(origen.base, 'categorias'));
    expect(filas(destino.base, 'configuracion_negocio')).toEqual(filas(origen.base, 'configuracion_negocio'));
  });

  it('ventas es idéntica salvo estado_sincronizacion, que queda en «sincronizado» porque de la nube viene', async () => {
    await restaurarEntera(crearNube());
    const sinEstado = (fila: Record<string, unknown>): Record<string, unknown> => {
      const { estado_sincronizacion: _estado, ...resto } = fila;
      return resto;
    };
    expect(filas(destino.base, 'ventas').map(sinEstado)).toEqual(filas(origen.base, 'ventas').map(sinEstado));
    expect(filas(destino.base, 'ventas').every((f) => f.estado_sincronizacion === 'sincronizado')).toBe(true);
  });

  it('auditoria_log llega entera, con los asientos sueltos del bloqueo, y los JSON son los mismos', async () => {
    await restaurarEntera(crearNube());
    const enOrigen = filas(origen.base, 'auditoria_log');
    const enDestino = filas(destino.base, 'auditoria_log');
    expect(enDestino.map((f) => f.id)).toEqual(enOrigen.map((f) => f.id));
    for (const [indice, fila] of enOrigen.entries()) {
      const restaurada = enDestino[indice];
      expect(restaurada?.accion).toBe(fila.accion);
      expect(restaurada?.usuario_id).toBe(fila.usuario_id);
      expect(restaurada?.fecha).toBe(fila.fecha);
      // El JSON se compara PARSEADO: jsonb puede devolver las claves en otro orden.
      const parsear = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
      expect(parsear(restaurada?.valor_nuevo)).toEqual(parsear(fila.valor_nuevo));
    }
    expect(enDestino.some((f) => f.accion === 'usuario_bloqueado')).toBe(true);
  });

  it('TODO usuario restaurado queda SIN PIN: ni el PIN viejo ni ninguno entra, y sin intentos ni bloqueo', async () => {
    await restaurarEntera(crearNube());
    for (const fila of filas(destino.base, 'usuarios')) {
      expect(fila.pin_hash).toBe(HASH_SIN_PIN);
      expect(fila.totp_secreto_cifrado).toBeNull();
      expect(fila.totp_ultimo_paso).toBeNull();
      expect(fila.intentos_fallidos).toBe(0);
      expect(fila.bloqueado_hasta).toBeNull();
    }
    expect(verificarPin(PIN_DE_JIMMY, HASH_SIN_PIN)).toBe(false);
    expect(verificarPin(PIN_DE_ANA, HASH_SIN_PIN)).toBe(false);
    // Y la pantalla de ingreso lo rechaza como PIN incorrecto, sin lanzar.
    const autenticacion = new ServicioDeAutenticacion({
      base: destino.base,
      usuarios: reposB.usuarios,
      auditoria: reposB.auditoria,
      bloqueosDeAutorizacion: reposB.bloqueosDeAutorizacion,
      cifrado: new CifradoDePrueba(),
    });
    expect(autenticacion.autenticar(terminal.ids.jimmy, PIN_DE_JIMMY).codigo).toBe('PIN_INCORRECTO');
  });

  it('la caja que quedó ABIERTA en la nube se restaura abierta', async () => {
    await restaurarEntera(crearNube());
    const abierta = reposB.cajaSesiones.obtenerPorId(terminal.ids.cajaAbierta);
    expect(abierta?.estado).toBe('abierta');
    expect(abierta?.usuarioId).toBe(terminal.ids.jimmy);
  });

  it('la foto que la nube tiene se baja a su ruta local con el MISMO sha256; la que no tiene se lista; el producto sin foto no pide nada', async () => {
    const nube = crearNube();
    const servicio = await restaurarEntera(nube);
    const rutaLocal = join(carpetaB, terminal.fotoDelMaiz.rutaRelativa);
    expect(existsSync(rutaLocal)).toBe(true);
    expect(sha256(readFileSync(rutaLocal))).toBe(sha256(terminal.fotoDelMaiz.bytes));
    expect(existsSync(join(carpetaB, terminal.fotoDeLosHuevos.rutaRelativa))).toBe(false);
    expect(servicio.progreso().fotos).toEqual({ hechas: 2, total: 2, faltantes: [terminal.fotoDeLosHuevos.rutaRelativa] });
    expect(nube.fotosPedidas.sort()).toEqual([terminal.fotoDelMaiz.objeto, terminal.fotoDeLosHuevos.objeto].sort());
    // La fila del producto conserva su foto_path: es el dato del negocio.
    expect(reposB.productos.obtenerPorId(terminal.ids.huevos)?.fotoPath).toBe(terminal.fotoDeLosHuevos.rutaRelativa);
  });

  it('pdf_path llega IDÉNTICA a la del origen: es relativa (recibos/<nombre>.pdf) y no depende de la máquina; impreso queda en 0', async () => {
    await restaurarEntera(crearNube());
    const restauradas = filas(destino.base, 'recibos');
    expect(restauradas).toHaveLength(3);
    for (const fila of restauradas) {
      const original = filas(origen.base, 'recibos').find((f) => f.id === fila.id);
      expect(fila.pdf_path).toBe(original?.pdf_path);
      expect(String(fila.pdf_path)).toMatch(/^recibos\/recibo-\d{6}-.*\.pdf$/);
      expect(String(fila.pdf_path)).not.toContain(carpetaA);
      expect(fila.impreso).toBe(0);
    }
  });

  it('COMPATIBILIDAD HACIA ATRÁS: una fila subida ANTES de la migración 030 trae la ruta ABSOLUTA de la terminal vieja (macOS o Windows) y se convierte a la relativa canónica', async () => {
    // La nube de mentira sirve lo que tiene la base de origen: se le ponen a
    // mano las rutas con la convención vieja, tal como quedaron en la nube
    // real las filas subidas antes del 2026-09-14. Una fila nueva nunca viene así.
    const [primero, segundo] = filas(origen.base, 'recibos');
    origen.base
      .prepare('UPDATE recibos SET pdf_path = ? WHERE id = ?')
      .run('/Users/jimmy/Library/Application Support/pos-agricola/recibos/recibo-000001-2026-09-11T19-09-34-701Z.pdf', primero?.id);
    origen.base
      .prepare('UPDATE recibos SET pdf_path = ? WHERE id = ?')
      .run('C:\\Users\\Jimmy\\AppData\\Roaming\\pos-agricola\\recibos\\recibo-000002-2026-09-11T19-10-02-118Z.pdf', segundo?.id);
    await restaurarEntera(crearNube());
    expect(reposB.recibos.obtenerPorId(String(primero?.id))?.pdfPath).toBe('recibos/recibo-000001-2026-09-11T19-09-34-701Z.pdf');
    expect(reposB.recibos.obtenerPorId(String(segundo?.id))?.pdfPath).toBe('recibos/recibo-000002-2026-09-11T19-10-02-118Z.pdf');
  });

  it('LA REIMPRESIÓN TOLERA EL PDF AUSENTE: regenera desde las filas y escribe en la carpeta local', async () => {
    await restaurarEntera(crearNube());
    const destinos: string[] = [];
    const recibos = new ServicioDeRecibos({
      base: destino.base,
      ventas: reposB.ventas,
      ventaDetalle: reposB.ventaDetalle,
      recibos: reposB.recibos,
      usuarios: reposB.usuarios,
      configuracion: reposB.configuracionNegocio,
      anulaciones: reposB.anulacionesDeVenta,
      impresora: new NullPrinterProvider(),
      generarPdf: (_html, ruta): Promise<void> => {
        destinos.push(ruta);
        return Promise.resolve();
      },
      carpetaDeDatos: carpetaB,
      log: new LogTecnicoSilencioso(),
    });
    // El archivo de la terminal vieja no existe acá: la ruta relativa apunta a un PDF que esta máquina nunca escribió.
    expect(existsSync(join(carpetaB, String(reposB.recibos.obtenerPorId(terminal.ids.reciboCombinado)?.pdfPath)))).toBe(false);
    const resultado = await recibos.reimprimir(terminal.ids.reciboCombinado);
    expect(resultado.pdfGenerado).toBe(true);
    expect(destinos[0]?.startsWith(join(carpetaB, 'recibos'))).toBe(true);
    // Y el modelo se arma desde las filas restauradas: cuadra con la venta.
    expect(resultado.modelo.total).toBe(reposB.ventas.obtenerPorId(terminal.ids.ventaCombinada)?.total.toFixed(2));
  });

  it('las filas restauradas NO se encolan: sync_cola sigue vacía después de la transferencia', async () => {
    await restaurarEntera(crearNube());
    expect(reposB.syncCola.contarPendientes()).toBe(0);
  });
});

// ===========================================================================
describe('UNA VENTA ANULADA EN LA NUBE SE RESTAURA ANULADA, sin tocar ventas.estado (ANULACION-DE-VENTA.md §8)', () => {
  function servicioDeCajaDe(base: Database, repos: Repositorios): ServicioDeCaja {
    return new ServicioDeCaja({
      base,
      cajaSesiones: repos.cajaSesiones,
      denominaciones: repos.denominaciones,
      desglose: repos.desgloseDeCaja,
      ventas: repos.ventas,
      auditoria: repos.auditoria,
    });
  }

  function anulacionesDe(base: Database, repos: Repositorios): ServicioDeAnulacionDeVenta {
    return new ServicioDeAnulacionDeVenta({
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
  }

  /** El código del ErrorDeNegocio que lanza `operacion`, o null si no lanza. */
  function codigoDe(operacion: () => unknown): string | null {
    try {
      operacion();
      return null;
    } catch (error) {
      return error instanceof ErrorDeNegocio ? error.codigo : `no es de negocio: ${String(error)}`;
    }
  }

  it('la fila de anulaciones_de_venta llega con el MISMO id y byte a byte igual a la de origen', async () => {
    await restaurarEntera(crearNube());
    expect(filas(destino.base, 'anulaciones_de_venta')).toEqual(filas(origen.base, 'anulaciones_de_venta'));
    expect(ids(destino.base, 'anulaciones_de_venta')).toEqual([terminal.ids.anulacion]);
  });

  it('la venta anulada y la activa quedan las dos con estado «completada», igual que en el origen: lo que las distingue es la fila de anulación', async () => {
    await restaurarEntera(crearNube());
    const estado = (base: Database, id: string): unknown => (base.prepare('SELECT estado FROM ventas WHERE id = ?').get(id) as { estado: string }).estado;
    expect(estado(destino.base, terminal.ids.ventaAnulada)).toBe('completada');
    expect(estado(destino.base, terminal.ids.ventaActiva)).toBe('completada');
    expect(estado(origen.base, terminal.ids.ventaAnulada)).toBe('completada');
    expect(reposB.anulacionesDeVenta.obtenerPorVenta(terminal.ids.ventaAnulada)?.id).toBe(terminal.ids.anulacion);
    expect(reposB.anulacionesDeVenta.obtenerPorVenta(terminal.ids.ventaActiva)).toBeNull();
  });

  it('el sistema restaurado la trata como ANULADA: el efectivo esperado de la caja abierta es el mismo que en el origen, y no la cuenta', async () => {
    await restaurarEntera(crearNube());
    const cajaOrigen = terminal.repos.cajaSesiones.obtenerPorId(terminal.ids.cajaAbierta);
    const cajaRestaurada = reposB.cajaSesiones.obtenerPorId(terminal.ids.cajaAbierta);
    if (cajaOrigen === null || cajaRestaurada === null) throw new Error('falta la caja abierta');
    const esperadoOrigen = servicioDeCajaDe(origen.base, terminal.repos).montoEsperadoDe(cajaOrigen).toFixed(2);
    const esperadoRestaurado = servicioDeCajaDe(destino.base, reposB).montoEsperadoDe(cajaRestaurada).toFixed(2);
    const activa = reposB.ventas.obtenerPorId(terminal.ids.ventaActiva);
    expect(esperadoRestaurado).toBe(esperadoOrigen);
    // Q250 de apertura más la venta activa; la anulada, no.
    expect(esperadoRestaurado).toBe(cajaRestaurada.montoInicial.plus(activa?.total ?? 0).toFixed(2));
  });

  it('anularla otra vez en la terminal restaurada se rechaza con VENTA_YA_ANULADA; la venta activa de la misma caja SÍ se puede anular', async () => {
    await restaurarEntera(crearNube());
    const anulaciones = anulacionesDe(destino.base, reposB);
    expect(codigoDe(() => anulaciones.prepararAnulacion({ ventaId: terminal.ids.ventaAnulada, motivo: 'otra vez', voucher: null }))).toBe(
      'VENTA_YA_ANULADA',
    );
    expect(codigoDe(() => anulaciones.prepararAnulacion({ ventaId: terminal.ids.ventaActiva, motivo: 'el cliente la devolvió', voucher: null }))).toBeNull();
  });

  describe('con motivo ROBO: la anulación se excluye por su recibido_en, como toda tabla de solo inserción', () => {
    const FECHA_DEL_ROBO = '2026-09-12T12:00:00.000Z';
    const DESPUES_DEL_ROBO = '2026-09-12T15:30:00.123456+00:00';

    async function restaurarConRobo(recibidoEn: ReadonlyMap<string, string>): Promise<ServicioDeRestauracion> {
      const servicio = crearServicio(crearNube({ recibidoEn }));
      await servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'robo', fechaDelRobo: FECHA_DEL_ROBO });
      await servicio.esperarACorrida();
      return servicio;
    }

    /** La venta anulada, con sus hijas, marcada como posterior al robo. */
    function ventaAnuladaPosterior(): [string, string][] {
      const lineas = (origen.base.prepare('SELECT id FROM venta_detalle WHERE venta_id = ?').all(terminal.ids.ventaAnulada) as { id: string }[]).map(
        (l): [string, string] => [`venta_detalle/${l.id}`, DESPUES_DEL_ROBO],
      );
      return [[`ventas/${terminal.ids.ventaAnulada}`, DESPUES_DEL_ROBO], [`recibos/${terminal.ids.reciboDeLaAnulada}`, DESPUES_DEL_ROBO], ...lineas];
    }

    /** Los productos que la anulación repuso: la nube los ACTUALIZÓ al recibirla, así que su recibido_en también es posterior. */
    function productosDeLaAnulacionPosteriores(): [string, string][] {
      return [
        [`productos/${terminal.ids.frijol}`, DESPUES_DEL_ROBO],
        [`productos/${terminal.ids.huevos}`, DESPUES_DEL_ROBO],
      ];
    }

    it('VENTA ANTERIOR, ANULACIÓN POSTERIOR: la venta se restaura VÁLIDA y vuelve a contar en el efectivo esperado; la anulación queda excluida y listada', async () => {
      const servicio = await restaurarConRobo(
        new Map([[`anulaciones_de_venta/${terminal.ids.anulacion}`, DESPUES_DEL_ROBO], ...productosDeLaAnulacionPosteriores()]),
      );
      const anomalia = servicio.progreso().anomalias.find((a) => a.tabla === 'anulaciones_de_venta');
      expect(anomalia).toMatchObject({ id: terminal.ids.anulacion, excluida: true, aceptada: false });
      expect(anomalia?.resumen).toMatch(/anulación de la venta/);
      expect(reposB.ventas.obtenerPorId(terminal.ids.ventaAnulada)).not.toBeNull();
      expect(reposB.anulacionesDeVenta.obtenerPorVenta(terminal.ids.ventaAnulada)).toBeNull();

      // El ladrón no puede sacar una venta legítima del corte restaurado.
      const caja = reposB.cajaSesiones.obtenerPorId(terminal.ids.cajaAbierta);
      if (caja === null) throw new Error('falta la caja abierta');
      const anulada = reposB.ventas.obtenerPorId(terminal.ids.ventaAnulada);
      const activa = reposB.ventas.obtenerPorId(terminal.ids.ventaActiva);
      expect(servicioDeCajaDe(destino.base, reposB).montoEsperadoDe(caja).toFixed(2)).toBe(
        caja.montoInicial.plus(anulada?.total ?? 0).plus(activa?.total ?? 0).toFixed(2),
      );

      expect(servicio.progreso().verificacion?.conteos.find((c) => c.tabla === 'anulaciones_de_venta')).toEqual({
        tabla: 'anulaciones_de_venta',
        nube: 1,
        local: 0,
        excluidas: 1,
        coincide: true,
      });
      expect(servicio.progreso().verificacion?.ok).toBe(true);
    });

    it('LO QUE §8 NO RESUELVE, MEDIDO: los productos que esa anulación repuso se restauran CON la reposición aplicada (se listan, no se excluyen), y por eso volver a anular la venta se rechaza con CONTADORES_INCONSISTENTES', async () => {
      const servicio = await restaurarConRobo(
        new Map([[`anulaciones_de_venta/${terminal.ids.anulacion}`, DESPUES_DEL_ROBO], ...productosDeLaAnulacionPosteriores()]),
      );
      const productosListados = servicio.progreso().anomalias.filter((a) => a.tabla === 'productos');
      expect(productosListados.map((a) => a.id).sort()).toEqual([terminal.ids.frijol, terminal.ids.huevos].sort());
      expect(productosListados.every((a) => !a.excluida)).toBe(true);
      // Inventario y contadores llegan como los dejó la anulación excluida: iguales a los del origen.
      for (const id of [terminal.ids.frijol, terminal.ids.huevos]) {
        expect(filas(destino.base, 'productos').find((f) => f.id === id)).toEqual(filas(origen.base, 'productos').find((f) => f.id === id));
      }
      expect(codigoDe(() => anulacionesDe(destino.base, reposB).prepararAnulacion({ ventaId: terminal.ids.ventaAnulada, motivo: 'x', voucher: null }))).toBe(
        'CONTADORES_INCONSISTENTES',
      );
    });

    it('VENTA Y ANULACIÓN, LAS DOS POSTERIORES: las dos quedan excluidas y listadas', async () => {
      const servicio = await restaurarConRobo(new Map([...ventaAnuladaPosterior(), [`anulaciones_de_venta/${terminal.ids.anulacion}`, DESPUES_DEL_ROBO]]));
      const excluidas = servicio.progreso().anomalias.filter((a) => a.excluida).map((a) => a.tabla);
      expect(excluidas).toContain('ventas');
      expect(excluidas).toContain('anulaciones_de_venta');
      expect(reposB.ventas.obtenerPorId(terminal.ids.ventaAnulada)).toBeNull();
      expect(contar(destino.base, 'anulaciones_de_venta')).toBe(0);
      expect(servicio.progreso().verificacion?.ok).toBe(true);
    });

    it('«restaurar igual» la anulación sin su venta se RECHAZA explicando el orden, y no escribe nada', async () => {
      const servicio = await restaurarConRobo(new Map([...ventaAnuladaPosterior(), [`anulaciones_de_venta/${terminal.ids.anulacion}`, DESPUES_DEL_ROBO]]));
      await expect(servicio.aceptarExcluida('anulaciones_de_venta', terminal.ids.anulacion)).rejects.toThrow(/primero restaurá la venta/);
      expect(contar(destino.base, 'anulaciones_de_venta')).toBe(0);
    });

    it('aceptar la venta NO trae su anulación (es otro hecho, con otro autor); aceptarla aparte después sí, y la venta queda ANULADA', async () => {
      const servicio = await restaurarConRobo(new Map([...ventaAnuladaPosterior(), [`anulaciones_de_venta/${terminal.ids.anulacion}`, DESPUES_DEL_ROBO]]));
      await servicio.aceptarExcluida('ventas', terminal.ids.ventaAnulada);
      expect(reposB.ventas.obtenerPorId(terminal.ids.ventaAnulada)).not.toBeNull();
      expect(reposB.anulacionesDeVenta.obtenerPorVenta(terminal.ids.ventaAnulada)).toBeNull();
      expect(servicio.progreso().anomalias.find((a) => a.tabla === 'anulaciones_de_venta')?.aceptada).toBe(false);

      await servicio.aceptarExcluida('anulaciones_de_venta', terminal.ids.anulacion);
      expect(reposB.anulacionesDeVenta.obtenerPorVenta(terminal.ids.ventaAnulada)?.id).toBe(terminal.ids.anulacion);
      expect(codigoDe(() => anulacionesDe(destino.base, reposB).prepararAnulacion({ ventaId: terminal.ids.ventaAnulada, motivo: 'x', voucher: null }))).toBe(
        'VENTA_YA_ANULADA',
      );
      expect(servicio.progreso().verificacion?.ok).toBe(true);
    });
  });
});

// ===========================================================================
describe('Precondiciones: se niega ANTES de bajar una sola fila', () => {
  it('con la base local NO vacía se niega nombrando las tablas, sin siquiera iniciar sesión', async () => {
    const nube = crearNube();
    const servicio = crearServicio(nube, { base: origen.base });
    await expect(servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null })).rejects.toThrow(
      /ya tiene datos \(usuarios, categorias/,
    );
    expect(nube.sesionesIniciadas).toEqual([]);
  });

  it('con deriva de esquema (sin ventas.total en la nube) se detiene nombrándola, y la base queda VACÍA', async () => {
    const contrato = contratoDeLaFoto();
    contrato.tablas.ventas = (contrato.tablas.ventas ?? []).filter((c) => c.nombre !== 'total');
    const nube = crearNube({ contrato });
    const servicio = crearServicio(nube);
    await expect(servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null })).rejects.toThrow(
      /NO coinciden.*ventas\.total existe en SQLite y no en la nube/,
    );
    for (const tabla of ORDEN_DE_RESTAURACION.filter((t) => t !== 'configuracion_negocio')) {
      expect(contar(destino.base, tabla), tabla).toBe(0);
    }
    expect(nube.sesionesCerradas).toBe(1);
    expect(existsSync(join(carpetaB, ARCHIVO_DEL_PUESTO_DE_CONTROL))).toBe(false);
    expect(servicio.progreso().fase).toBe('inactiva');
  });

  it('con otras denominaciones se detiene: sin las once iguales los arqueos no se pueden restaurar', async () => {
    const servicio = crearServicio(crearNube({ denominacionesADevolver: 10 }));
    await expect(servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null })).rejects.toThrow(
      /la nube tiene 10 denominaciones y esta base 11/,
    );
    expect(contar(destino.base, 'usuarios')).toBe(0);
  });

  it('con la contraseña rechazada no se toca nada', async () => {
    const servicio = crearServicio(crearNube({ rechazarSesion: true }));
    await expect(servicio.iniciar({ correo: CORREO, contrasena: 'mala', motivo: 'falla', fechaDelRobo: null })).rejects.toThrow(/rechazó/);
    expect(contar(destino.base, 'usuarios')).toBe(0);
  });

  it('un robo sin fecha se rechaza: sin fecha no hay revisión posible', async () => {
    const servicio = crearServicio(crearNube());
    await expect(servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'robo', fechaDelRobo: null })).rejects.toThrow(/fecha y hora/);
  });

  it('sin proyecto configurado lo dice y no hace nada', async () => {
    const servicio = crearServicio(null);
    expect(servicio.progreso().configurada).toBe(false);
    await expect(servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null })).rejects.toThrow(/no tiene configurado/);
  });
});

// ===========================================================================
describe('Cancelar y retomar: ni se duplica ni se pierde', () => {
  it('cancelada a mitad, la base queda con páginas COMPLETAS y el puesto de control; retomada, termina igual que una restauración de un tirón', async () => {
    let servicio: ServicioDeRestauracion | null = null;
    const PAGINA_EN_QUE_SE_CANCELA = 4;
    const nube = crearNube({
      alLeerPagina: (numero): void => {
        if (numero === PAGINA_EN_QUE_SE_CANCELA) {
          void servicio?.cancelar();
        }
      },
    });
    servicio = crearServicio(nube, { filasPorPagina: 1 });
    await servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null });
    await servicio.esperarACorrida();

    expect(servicio.progreso().fase).toBe('cancelada');
    expect(servicio.hayRestauracionIncompleta()).toBe(true);
    expect(existsSync(join(carpetaB, ARCHIVO_DEL_PUESTO_DE_CONTROL))).toBe(true);
    const parciales = ORDEN_DE_RESTAURACION.map((t) => contar(destino.base, t));
    expect(parciales.some((n) => n > 0)).toBe(true);
    expect(parciales.some((n, i) => n < contar(origen.base, ORDEN_DE_RESTAURACION[i] ?? ''))).toBe(true);
    expect(nube.sesionesCerradas).toBe(1);

    // Un servicio NUEVO, como después de reabrir la aplicación: lee el puesto de control del disco.
    const retomado = crearServicio(crearNube(), { filasPorPagina: 1 });
    expect(retomado.hayRestauracionIncompleta()).toBe(true);
    await retomado.retomar({ correo: CORREO, contrasena: CONTRASENA });
    await retomado.esperarACorrida();
    expect(retomado.progreso().fase).toBe('revision');
    expect(retomado.progreso().verificacion?.ok).toBe(true);
    for (const tabla of ORDEN_DE_RESTAURACION) {
      expect(ids(destino.base, tabla), tabla).toEqual(ids(origen.base, tabla));
    }
    expect(filas(destino.base, 'venta_detalle')).toEqual(filas(origen.base, 'venta_detalle'));
  });

  it('retomar contra OTRO proyecto se niega', async () => {
    let servicio: ServicioDeRestauracion | null = null;
    const nube = crearNube({
      alLeerPagina: (numero): void => {
        if (numero === 2) {
          void servicio?.cancelar();
        }
      },
    });
    servicio = crearServicio(nube, { filasPorPagina: 1 });
    await servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null });
    await servicio.esperarACorrida();

    const otro = new ServicioDeRestauracion({
      base: destino.base,
      usuarios: reposB.usuarios,
      auditoria: reposB.auditoria,
      cliente: crearNube(),
      urlDelProyecto: 'https://otroproyecto.supabase.co',
      puestoDeControl: new AlmacenDelPuestoDeControl(carpetaB),
      carpetaDeDatos: carpetaB,
    });
    await expect(otro.retomar({ correo: CORREO, contrasena: CONTRASENA })).rejects.toThrow(/otro proyecto/);
  });

  it('iniciar de nuevo con un puesto de control presente se niega: hay que retomar', async () => {
    let servicio: ServicioDeRestauracion | null = null;
    const nube = crearNube({
      alLeerPagina: (numero): void => {
        if (numero === 2) {
          void servicio?.cancelar();
        }
      },
    });
    servicio = crearServicio(nube, { filasPorPagina: 1 });
    await servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null });
    await servicio.esperarACorrida();
    await expect(crearServicio(crearNube()).iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'falla', fechaDelRobo: null })).rejects.toThrow(
      /restauración incompleta/,
    );
  });
});

// ===========================================================================
describe('Anomalías por recibido_en, con motivo ROBO (§6.5)', () => {
  const FECHA_DEL_ROBO = '2026-09-12T12:00:00.000Z';
  const DESPUES_DEL_ROBO = '2026-09-12T15:30:00.123456+00:00';

  /** Marca como posteriores al robo: la venta combinada con sus hijas, un asiento, un producto y a Ana. */
  function nubeConRobo(): { nube: NubeDeMentira; asiento: string } {
    const asiento = (origen.base.prepare("SELECT id FROM auditoria_log WHERE accion = 'usuario_bloqueado'").get() as { id: string }).id;
    const detalle = (origen.base.prepare('SELECT id FROM venta_detalle WHERE venta_id = ?').get(terminal.ids.ventaCombinada) as { id: string }).id;
    const recibidoEn = new Map<string, string>([
      [`ventas/${terminal.ids.ventaCombinada}`, DESPUES_DEL_ROBO],
      [`venta_detalle/${detalle}`, DESPUES_DEL_ROBO],
      [`recibos/${terminal.ids.reciboCombinado}`, DESPUES_DEL_ROBO],
      [`auditoria_log/${asiento}`, DESPUES_DEL_ROBO],
      [`productos/${terminal.ids.maiz}`, DESPUES_DEL_ROBO],
      [`usuarios/${terminal.ids.ana}`, DESPUES_DEL_ROBO],
    ]);
    return { nube: crearNube({ recibidoEn }), asiento };
  }

  async function restaurarConRobo(): Promise<{ servicio: ServicioDeRestauracion; asiento: string }> {
    const { nube, asiento } = nubeConRobo();
    const servicio = crearServicio(nube);
    await servicio.iniciar({ correo: CORREO, contrasena: CONTRASENA, motivo: 'robo', fechaDelRobo: FECHA_DEL_ROBO });
    await servicio.esperarACorrida();
    return { servicio, asiento };
  }

  it('encuentra las seis filas posteriores a la fecha, en cinco tablas distintas', async () => {
    const { servicio } = await restaurarConRobo();
    const anomalias = servicio.progreso().anomalias;
    expect(anomalias.map((a) => a.tabla).sort()).toEqual(['auditoria_log', 'productos', 'recibos', 'usuarios', 'venta_detalle', 'ventas']);
    expect(anomalias.every((a) => a.recibidoEn === DESPUES_DEL_ROBO)).toBe(true);
  });

  it('las de tablas que la nube SOLO INSERTA quedan EXCLUIDAS y no se restauran; las que también actualiza se restauran y se listan', async () => {
    const { servicio } = await restaurarConRobo();
    const porTabla = new Map(servicio.progreso().anomalias.map((a) => [a.tabla, a]));
    expect(porTabla.get('ventas')?.excluida).toBe(true);
    expect(porTabla.get('venta_detalle')?.excluida).toBe(true);
    expect(porTabla.get('recibos')?.excluida).toBe(true);
    expect(porTabla.get('auditoria_log')?.excluida).toBe(true);
    expect(porTabla.get('productos')?.excluida).toBe(false);
    expect(porTabla.get('usuarios')?.excluida).toBe(false);

    expect(reposB.ventas.obtenerPorId(terminal.ids.ventaCombinada)).toBeNull();
    expect(reposB.ventas.obtenerPorId(terminal.ids.ventaConTarjeta)).not.toBeNull();
    expect(reposB.productos.obtenerPorId(terminal.ids.maiz)).not.toBeNull();
    expect(reposB.usuarios.obtenerPorId(terminal.ids.ana)).not.toBeNull();
    expect(porTabla.get('ventas')?.resumen).toMatch(/venta de Q/);
    expect(porTabla.get('usuarios')?.resumen).toMatch(/Ana · venta · activo/);
  });

  it('la verificación CUADRA contando las excluidas: nube = local + excluidas, en filas y en quetzales por mes', async () => {
    const { servicio } = await restaurarConRobo();
    const verificacion = servicio.progreso().verificacion;
    expect(verificacion?.ok).toBe(true);
    const ventas = verificacion?.conteos.find((c) => c.tabla === 'ventas');
    expect(ventas).toEqual({ tabla: 'ventas', nube: 4, local: 3, excluidas: 1, coincide: true });
    const [mes] = verificacion?.ventasPorMes ?? [];
    expect(mes?.coincide).toBe(true);
    expect(mes?.excluidas).toBe(String(terminal.repos.ventas.obtenerPorId(terminal.ids.ventaCombinada)?.total.toFixed(2)));
  });

  it('no se puede terminar sin revisar al usuario anómalo', async () => {
    const { servicio } = await restaurarConRobo();
    expect(servicio.impedimentosParaTerminar().join(' ')).toMatch(/falta revisar 1 usuario\(s\).*Ana/);
  });

  it('aceptar una línea ANTES que su venta se rechaza explicando el orden', async () => {
    const { servicio } = await restaurarConRobo();
    const detalle = servicio.progreso().anomalias.find((a) => a.tabla === 'venta_detalle');
    await expect(servicio.aceptarExcluida('venta_detalle', detalle?.id ?? '')).rejects.toThrow(/primero restaurá la venta/);
  });

  it('aceptar la venta la restaura CON su línea y su recibo, deja asiento, y la verificación sigue cuadrando', async () => {
    const { servicio } = await restaurarConRobo();
    await servicio.aceptarExcluida('ventas', terminal.ids.ventaCombinada);
    const progreso = servicio.progreso();
    expect(reposB.ventas.obtenerPorId(terminal.ids.ventaCombinada)).not.toBeNull();
    expect(contar(destino.base, 'venta_detalle')).toBe(6);
    expect(reposB.recibos.obtenerPorId(terminal.ids.reciboCombinado)).not.toBeNull();
    const aceptadas = progreso.anomalias.filter((a) => a.aceptada).map((a) => a.tabla).sort();
    expect(aceptadas).toEqual(['recibos', 'venta_detalle', 'ventas']);
    expect(progreso.verificacion?.conteos.find((c) => c.tabla === 'ventas')).toEqual({ tabla: 'ventas', nube: 4, local: 4, excluidas: 0, coincide: true });
    expect(progreso.verificacion?.ok).toBe(true);
    const asiento = destino.base.prepare('SELECT * FROM auditoria_log WHERE accion = ?').get(ACCIONES_DE_RESTAURACION.filaRestauradaAMano) as
      | Record<string, unknown>
      | undefined;
    expect(asiento?.entidad_id).toBe(terminal.ids.ventaCombinada);
    expect(reposB.syncCola.contarPendientes()).toBeGreaterThan(0);
  });

  it('revisar al usuario anómalo cambia rol y estado, deja asiento, se encola, y destraba el cierre', async () => {
    const { servicio } = await restaurarConRobo();
    servicio.revisarUsuario(terminal.ids.ana, { rol: 'venta', activo: false });
    const ana = reposB.usuarios.obtenerPorId(terminal.ids.ana);
    expect(ana?.activo).toBe(false);
    expect(servicio.progreso().usuarios.find((u) => u.id === terminal.ids.ana)?.revisado).toBe(true);
    expect(servicio.impedimentosParaTerminar().join(' ')).not.toMatch(/falta revisar/);
    const asiento = destino.base.prepare('SELECT valor_anterior, valor_nuevo FROM auditoria_log WHERE accion = ?').get(ACCIONES_DE_RESTAURACION.usuarioRevisado) as
      | { valor_anterior: string; valor_nuevo: string }
      | undefined;
    expect(JSON.parse(asiento?.valor_anterior ?? '{}')).toEqual({ rol: 'venta', activo: true });
    expect(JSON.parse(asiento?.valor_nuevo ?? '{}')).toEqual({ rol: 'venta', activo: false, revisadoPor: CORREO });
  });

  it('el último administrador activo no se puede dar de baja ni degradar en la revisión', async () => {
    const { servicio } = await restaurarConRobo();
    expect(() => servicio.revisarUsuario(terminal.ids.jimmy, { rol: 'venta', activo: true })).toThrow(/único administrador activo/);
  });

  it('un asiento suelto excluido se puede restaurar solo', async () => {
    const { servicio, asiento } = await restaurarConRobo();
    expect(reposB.auditoria.obtenerPorId(asiento)).toBeNull();
    await servicio.aceptarExcluida('auditoria_log', asiento);
    expect(reposB.auditoria.obtenerPorId(asiento)?.accion).toBe('usuario_bloqueado');
  });
});

// ===========================================================================
describe('PIN nuevo y cierre de la restauración', () => {
  it('no se puede terminar mientras un usuario ACTIVO siga sin PIN', async () => {
    const servicio = await restaurarEntera(crearNube());
    expect(servicio.impedimentosParaTerminar().join(' ')).toMatch(/falta asignar PIN a 2 usuario\(s\)/);
    await expect(servicio.terminar()).rejects.toThrow(/falta asignar PIN/);
  });

  it('asignar un PIN lo deja utilizable, deja asiento sin el PIN, y se encola', async () => {
    const servicio = await restaurarEntera(crearNube());
    servicio.asignarPin(terminal.ids.jimmy, '9753');
    const autenticacion = new ServicioDeAutenticacion({
      base: destino.base,
      usuarios: reposB.usuarios,
      auditoria: reposB.auditoria,
      bloqueosDeAutorizacion: reposB.bloqueosDeAutorizacion,
      cifrado: new CifradoDePrueba(),
    });
    expect(autenticacion.autenticar(terminal.ids.jimmy, '9753').autenticado).toBe(true);
    expect(autenticacion.autenticar(terminal.ids.jimmy, PIN_DE_JIMMY).autenticado).toBe(false);
    const asientos = destino.base.prepare('SELECT valor_nuevo FROM auditoria_log WHERE accion = ?').all(ACCIONES_DE_RESTAURACION.pinAsignado) as { valor_nuevo: string }[];
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.valor_nuevo).not.toContain('9753');
    expect(JSON.parse(asientos[0]?.valor_nuevo ?? '{}')).toEqual({ asignadoPor: CORREO });
    expect(servicio.progreso().usuarios.find((u) => u.id === terminal.ids.jimmy)?.sinPin).toBe(false);
  });

  it('un PIN que ya usa otro usuario activo se rechaza sin decir de quién es; un formato inválido también', async () => {
    const servicio = await restaurarEntera(crearNube());
    servicio.asignarPin(terminal.ids.jimmy, '9753');
    expect(() => servicio.asignarPin(terminal.ids.ana, '9753')).toThrow(/ya está en uso/);
    expect(() => servicio.asignarPin(terminal.ids.ana, '975')).toThrow(/cuatro dígitos/);
  });

  it('con todos los PIN asignados TERMINA: asiento de restauración completada encolado, sesión cerrada, puesto de control borrado', async () => {
    const nube = crearNube();
    const servicio = await restaurarEntera(nube);
    servicio.asignarPin(terminal.ids.jimmy, '9753');
    servicio.asignarPin(terminal.ids.ana, '8642');
    const final = await servicio.terminar();
    expect(final.fase).toBe('terminada');
    expect(final.hayRestauracionIncompleta).toBe(false);
    expect(existsSync(join(carpetaB, ARCHIVO_DEL_PUESTO_DE_CONTROL))).toBe(false);
    expect(nube.sesionesCerradas).toBe(1);
    const asiento = destino.base.prepare('SELECT valor_nuevo FROM auditoria_log WHERE accion = ?').get(ACCIONES_DE_RESTAURACION.completada) as
      | { valor_nuevo: string }
      | undefined;
    const detalle = JSON.parse(asiento?.valor_nuevo ?? '{}') as { proyecto: string; restauradoPor: string; filasPorTabla: Record<string, number> };
    expect(detalle.proyecto).toBe(URL_DEL_PROYECTO);
    expect(detalle.restauradoPor).toBe(CORREO);
    expect(detalle.filasPorTabla.ventas).toBe(4);
    expect(detalle.filasPorTabla.anulaciones_de_venta).toBe(1);
    // Lo que se decidió durante la restauración viaja a la nube; lo restaurado no.
    const pendientes = destino.base.prepare('SELECT entidad_tipo, operacion FROM sync_cola WHERE sincronizado_en IS NULL ORDER BY creado_en').all() as { entidad_tipo: string; operacion: string }[];
    expect(pendientes.filter((p) => p.entidad_tipo === 'auditoria_log')).toHaveLength(3);
    expect(pendientes.filter((p) => p.entidad_tipo === 'usuarios' && p.operacion === 'actualizar')).toHaveLength(2);
    expect(pendientes.some((p) => p.entidad_tipo === 'ventas' || p.entidad_tipo === 'productos')).toBe(false);
  });

  it('las columnas que nunca viajan no salen de la restauración por accidente: el payload encolado de usuarios no lleva pin_hash', async () => {
    const servicio = await restaurarEntera(crearNube());
    servicio.asignarPin(terminal.ids.jimmy, '9753');
    const payload = (destino.base.prepare("SELECT payload FROM sync_cola WHERE entidad_tipo = 'usuarios'").get() as { payload: string }).payload;
    for (const columna of COLUMNAS_EXCLUIDAS.usuarios ?? []) {
      expect(payload).not.toContain(`"${columna}"`);
    }
  });
});
