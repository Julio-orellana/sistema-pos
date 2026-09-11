/**
 * El trabajador de sincronización: la lista de verificación de la Fase 1.b.
 *
 * Corren contra bases SQLite REALES, con los servicios REALES que llenan la
 * bandeja de salida. Nada de red: el `SyncProvider` es el simulado del
 * proyecto o un doble programable que devuelve lo que la prueba necesite.
 *
 * LAS CUATRO PREGUNTAS QUE ESTE ARCHIVO CONTESTA:
 *
 *   1. ¿Sube los lotes completos, en orden, y marca lo que subió?
 *   2. ¿Un fallo transitorio espera lo que dice la escalera, y un
 *      determinístico DETIENE la cola sin saltear el lote?
 *   3. ¿Cortar el proceso a mitad de un lote pierde o duplica algo?
 *   4. ¿Cede de verdad ante una venta, y qué pasaría si no cediera?
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import {
  SimulatedSyncProvider,
  type CambioSincronizable,
  type EstadoSincronizacion,
  type ResultadoEmpuje,
  type SyncProvider,
} from '@shared/adapters';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import {
  encolarLote,
  observarLotesEncolados,
  type EntradaDelLote,
} from '@main/database/bandeja-de-salida';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import {
  durante,
  hayVentaEnCurso,
  reiniciarSenalDeVenta,
} from '@main/domain/venta/venta-en-curso';
import {
  PRESUPUESTO_POR_DEFECTO,
  TrabajadorDeSincronizacion,
  type ResumenDeCiclo,
} from '../trabajador';

// ===========================================================================
// Un proveedor que hace lo que la prueba le diga
// ===========================================================================

/** Lo que el proveedor va a contestar en la próxima llamada. */
type Desenlace =
  | { readonly tipo: 'ok' }
  | { readonly tipo: 'fallo'; readonly estadoHttp?: number; readonly mensaje: string }
  | { readonly tipo: 'excepcion'; readonly mensaje: string }
  /** Una promesa que nunca resuelve: modela que el proceso murió esperando. */
  | { readonly tipo: 'colgado' };

class ProveedorProgramable implements SyncProvider {
  public readonly nombre = 'ProveedorProgramable';

  /** Cada lote que recibió, en orden y completo. */
  public readonly lotesRecibidos: CambioSincronizable[][] = [];

  /** Desenlaces pendientes; cuando se acaban, responde que sí. */
  private readonly guion: Desenlace[] = [];

  /** Espera artificial antes de contestar, para probar que no bloquea. */
  public demoraMs = 0;

  public programar(...desenlaces: readonly Desenlace[]): void {
    this.guion.push(...desenlaces);
  }

  public async empujarCambios(cambios: readonly CambioSincronizable[]): Promise<ResultadoEmpuje> {
    this.lotesRecibidos.push([...cambios]);
    const desenlace = this.guion.shift() ?? { tipo: 'ok' };

    if (this.demoraMs > 0) {
      await new Promise((resolver) => setTimeout(resolver, this.demoraMs));
    }

    if (desenlace.tipo === 'colgado') {
      return new Promise<ResultadoEmpuje>(() => {
        // A propósito: nunca resuelve.
      });
    }
    if (desenlace.tipo === 'excepcion') {
      throw new Error(desenlace.mensaje);
    }
    if (desenlace.tipo === 'fallo') {
      return {
        ok: false,
        adaptador: this.nombre,
        cambiosAceptados: 0,
        cambiosRechazados: cambios.length,
        errores: [desenlace.mensaje],
        simulado: true,
        ...(desenlace.estadoHttp === undefined ? {} : { estadoHttp: desenlace.estadoHttp }),
      };
    }
    return {
      ok: true,
      adaptador: this.nombre,
      cambiosAceptados: cambios.length,
      cambiosRechazados: 0,
      errores: [],
      simulado: true,
    };
  }

  public consultarEstado(): Promise<EstadoSincronizacion> {
    return Promise.resolve({
      disponible: true,
      adaptador: this.nombre,
      descripcion: 'Doble de pruebas.',
      simulado: true,
    });
  }

  /** Las tablas de cada lote recibido, para afirmar sobre el orden de un vistazo. */
  public tablasPorLote(): string[][] {
    return this.lotesRecibidos.map((lote) => lote.map((cambio) => cambio.tabla));
  }
}

// ===========================================================================
// Montaje
// ===========================================================================

let base: Database;
let repos: Repositorios;
let limpiar: () => void;
let proveedor: ProveedorProgramable;

let caja: ServicioDeCaja;
let venta: ServicioDeVenta;
let categorias: ServicioDeCategorias;

let idJimmy: string;
let idCajera: string;
let idCategoria: string;
let idMaiz: string;

/** Reloj de mentira, para que el backoff no dependa del reloj de la máquina. */
let reloj = Date.parse('2026-09-11T12:00:00.000Z');
const ahora = (): number => reloj;
/** Sin variación aleatoria: la espera es exactamente el peldaño. */
const SIN_VARIACION = (): number => 0.5;

/** Un trabajador con el reloj y el azar fijos, y presupuesto a medida. */
function crearTrabajador(
  presupuesto: Partial<typeof PRESUPUESTO_POR_DEFECTO> = {},
  proveedorPropio: SyncProvider = proveedor,
): TrabajadorDeSincronizacion {
  return new TrabajadorDeSincronizacion({
    cola: repos.syncCola,
    proveedor: proveedorPropio,
    ahora,
    azar: SIN_VARIACION,
    presupuesto: { pausaEntreLotesMs: 0, ...presupuesto },
  });
}

/** Las filas pendientes de la cola, crudas, en el orden en que se van a subir. */
function colaPendiente(): {
  lote_id: string;
  entidad_tipo: string;
  intentos: number;
  bloqueante: number;
  proximo_intento_en: string | null;
  error: string | null;
}[] {
  return base
    .prepare(
      `SELECT lote_id, entidad_tipo, intentos, bloqueante, proximo_intento_en, error
         FROM sync_cola WHERE sincronizado_en IS NULL
        ORDER BY creado_en, orden_en_lote`,
    )
    .all() as never;
}

function pendientes(): number {
  return repos.syncCola.contarPendientes();
}

/** Una venta en efectivo de una línea. Deja un lote de cuatro filas. */
function cobrarUnaVenta(): string {
  return venta.registrar(idCajera, 'venta', {
    lineas: [{ productoId: idMaiz, cantidad: '2' }],
    descuento: null,
    formaPago: 'efectivo',
    numBoleta: null,
  }).venta.id;
}

beforeEach(() => {
  reloj = Date.parse('2026-09-11T12:00:00.000Z');
  reiniciarSenalDeVenta();
  observarLotesEncolados(null);

  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  proveedor = new ProveedorProgramable();

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
  });
  categorias = new ServicioDeCategorias({
    base,
    categorias: repos.categorias,
    auditoria: repos.auditoria,
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin('2468'),
  }).id;
  idCajera = repos.usuarios.crear({
    nombre: 'Ana',
    rol: 'venta',
    pinHash: generarHashDePin('1357'),
  }).id;
  idCategoria = repos.categorias.crear({ nombre: 'Granos', orden: 1 }).id;
  idMaiz = repos.productos.crear({
    nombre: 'Maíz blanco',
    categoriaId: idCategoria,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '6.69',
    inventarioDisponible: '100',
  }).id;

  base.prepare('DELETE FROM sync_cola').run();
});

afterEach(() => {
  observarLotesEncolados(null);
  reiniciarSenalDeVenta();
  limpiar();
});

// ===========================================================================
// 1. Sube lo que hay, entero y en orden
// ===========================================================================

describe('Un ciclo sube los lotes pendientes, completos y en orden de llegada', () => {
  it('sube la venta entera en UNA llamada y marca sus cuatro filas', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    cobrarUnaVenta();

    expect(pendientes()).toBe(4);

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(resumen.lotesSubidos).toBe(1);
    expect(resumen.filasSubidas).toBe(4);
    expect(pendientes()).toBe(0);

    // UNA llamada, con las cuatro filas adentro y en el orden padres→hijos.
    expect(proveedor.tablasPorLote()).toEqual([
      ['productos', 'ventas', 'venta_detalle', 'auditoria_log'],
    ]);
  });

  it('sube los lotes en ORDEN DE LLEGADA, no agrupados por tabla ni reordenados', async () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    cobrarUnaVenta();

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.lotesSubidos).toBe(3);
    expect(proveedor.tablasPorLote()).toEqual([
      ['categorias', 'auditoria_log'],
      ['caja_sesiones', 'auditoria_log'],
      ['productos', 'ventas', 'venta_detalle', 'auditoria_log'],
    ]);
  });

  it('el payload que viaja es BYTE A BYTE el que quedó guardado', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    const ventaId = cobrarUnaVenta();

    await crearTrabajador().ejecutarCiclo();

    const enviado = proveedor.lotesRecibidos[0]?.find((cambio) => cambio.tabla === 'ventas');
    const guardada = base.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId) as Record<
      string,
      unknown
    >;

    expect(enviado?.idRegistro).toBe(ventaId);
    expect(enviado?.operacion).toBe('insertar');
    expect(enviado?.datos.total).toBe(guardada.total);
    expect(typeof enviado?.datos.total).toBe('string');
    // Y sigue sin llevar lo que no debe salir de esta terminal.
    expect(Object.keys(enviado?.datos ?? {})).not.toContain('estado_sincronizacion');
  });

  it('sin pendientes no hace ni una llamada: una máquina al día no gasta nada', async () => {
    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('sin_pendientes');
    expect(proveedor.lotesRecibidos).toHaveLength(0);
  });

  it('funciona igual con el SimulatedSyncProvider real del proyecto', async () => {
    const simulado = new SimulatedSyncProvider();
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });

    const resumen = await crearTrabajador({}, simulado).ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(simulado.obtenerCambiosEmpujados().map((cambio) => cambio.tabla)).toEqual([
      'categorias',
      'auditoria_log',
    ]);
    expect(pendientes()).toBe(0);
  });
});

// ===========================================================================
// 2. Fallo transitorio: espera lo que dice la escalera y no adelanta a nadie
// ===========================================================================

describe('Un fallo transitorio reintenta con la espera correcta y respeta el orden', () => {
  beforeEach(() => {
    categorias.crear(idJimmy, { nombre: 'Primera', orden: 1 });
    categorias.crear(idJimmy, { nombre: 'Segunda', orden: 2 });
  });

  it('el primer fallo suma un intento y agenda el reintento a los 5 segundos', async () => {
    proveedor.programar({ tipo: 'fallo', estadoHttp: 503, mensaje: 'servicio no disponible' });

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('fallo_transitorio');
    expect(resumen.lotesSubidos).toBe(0);
    expect(resumen.proximoIntentoEn).toBe('2026-09-11T12:00:05.000Z');

    const cola = colaPendiente();
    expect(cola[0]?.intentos).toBe(1);
    expect(cola[0]?.bloqueante).toBe(0);
    expect(cola[0]?.proximo_intento_en).toBe('2026-09-11T12:00:05.000Z');
    expect(cola[0]?.error).toBe('servicio no disponible');
    // Nada se marcó: el lote sigue entero en la cola.
    expect(pendientes()).toBe(4);
  });

  it('MIENTRAS ESPERA, el lote de atrás NO se adelanta', async () => {
    proveedor.programar({ tipo: 'fallo', estadoHttp: 503, mensaje: 'sin servicio' });
    await crearTrabajador().ejecutarCiclo();

    const segundo = await crearTrabajador().ejecutarCiclo();

    expect(segundo.motivo).toBe('esperando_backoff');
    expect(segundo.lotesSubidos).toBe(0);
    // Una sola llamada en total: la del primer intento. La segunda categoría
    // no viajó, aunque estaba lista y no tenía nada que ver con el fallo.
    expect(proveedor.lotesRecibidos).toHaveLength(1);
  });

  it('cuando vence la espera, el lote sube y la cola sigue con el que estaba detrás', async () => {
    proveedor.programar({ tipo: 'fallo', estadoHttp: 503, mensaje: 'sin servicio' });
    await crearTrabajador().ejecutarCiclo();

    reloj += 5_000;
    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(resumen.lotesSubidos).toBe(2);
    expect(pendientes()).toBe(0);
    expect(proveedor.tablasPorLote()).toEqual([
      ['categorias', 'auditoria_log'],
      ['categorias', 'auditoria_log'],
      ['categorias', 'auditoria_log'],
    ]);
  });

  it('el segundo fallo del MISMO lote espera 30 segundos, no otros 5', async () => {
    proveedor.programar(
      { tipo: 'fallo', estadoHttp: 503, mensaje: 'uno' },
      { tipo: 'fallo', estadoHttp: 503, mensaje: 'dos' },
    );

    await crearTrabajador().ejecutarCiclo();
    reloj += 5_000;
    const segundo = await crearTrabajador().ejecutarCiclo();

    expect(segundo.motivo).toBe('fallo_transitorio');
    expect(segundo.proximoIntentoEn).toBe('2026-09-11T12:00:35.000Z');
    expect(colaPendiente()[0]?.intentos).toBe(2);
  });

  it('una excepción del adaptador —la red que se cae— también es transitoria', async () => {
    proveedor.programar({ tipo: 'excepcion', mensaje: 'ECONNREFUSED' });

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('fallo_transitorio');
    expect(colaPendiente()[0]?.intentos).toBe(1);
    expect(colaPendiente()[0]?.bloqueante).toBe(0);
    expect(colaPendiente()[0]?.error).toContain('ECONNREFUSED');
  });
});

// ===========================================================================
// 3. Fallo determinístico: detiene la cola y NO se saltea el lote
// ===========================================================================

describe('Un fallo determinístico DETIENE la cola en ese lote, sin saltearlo', () => {
  let loteRoto: string;

  beforeEach(() => {
    categorias.crear(idJimmy, { nombre: 'La que rompe', orden: 1 });
    loteRoto = colaPendiente()[0]?.lote_id ?? '';
    categorias.crear(idJimmy, { nombre: 'La de atrás', orden: 2 });
  });

  it('marca el lote como bloqueante y guarda el error completo de la nube', async () => {
    proveedor.programar({
      tipo: 'fallo',
      estadoHttp: 400,
      mensaje: 'new row violates check constraint "categorias_nombre_no_vacio"',
    });

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_detenida');
    expect(resumen.loteEnEspera).toBe(loteRoto);
    expect(resumen.error).toContain('categorias_nombre_no_vacio');

    const filasDelRoto = colaPendiente().filter((fila) => fila.lote_id === loteRoto);
    expect(filasDelRoto).toHaveLength(2);
    for (const fila of filasDelRoto) {
      expect(fila.bloqueante).toBe(1);
      expect(fila.error).toContain('categorias_nombre_no_vacio');
      // NO se agenda reintento: un lote bloqueante no se reintenta solo.
      expect(fila.proximo_intento_en).toBeNull();
    }
  });

  it('EL LOTE DE ATRÁS NO SUBE: un hueco silencioso es peor que una cola detenida', async () => {
    proveedor.programar({ tipo: 'fallo', estadoHttp: 400, mensaje: 'inválido' });
    await crearTrabajador().ejecutarCiclo();

    // Tres ciclos más, y el de atrás sigue sin viajar.
    await crearTrabajador().ejecutarCiclo();
    reloj += 3_600_000;
    await crearTrabajador().ejecutarCiclo();
    reloj += 86_400_000;
    const ultimo = await crearTrabajador().ejecutarCiclo();

    expect(ultimo.motivo).toBe('cola_detenida');
    // Una sola llamada en toda la prueba: la que falló. Ni el lote roto se
    // reintentó solo, ni el de atrás se adelantó.
    expect(proveedor.lotesRecibidos).toHaveLength(1);
    expect(pendientes()).toBe(4);
  });

  it('el lote bloqueante NO se reintenta solo, ni siquiera un año después', async () => {
    proveedor.programar({ tipo: 'fallo', estadoHttp: 422, mensaje: 'no procesable' });
    await crearTrabajador().ejecutarCiclo();

    reloj += 365 * 86_400_000;
    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_detenida');
    expect(colaPendiente()[0]?.intentos).toBe(1);
    expect(proveedor.lotesRecibidos).toHaveLength(1);
  });

  it('desbloquearlo a mano deja pasar el lote roto Y el que estaba detrás, en orden', async () => {
    proveedor.programar({ tipo: 'fallo', estadoHttp: 400, mensaje: 'inválido' });
    await crearTrabajador().ejecutarCiclo();

    repos.syncCola.desbloquearLote(loteRoto);
    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(resumen.lotesSubidos).toBe(2);
    expect(pendientes()).toBe(0);
    expect(proveedor.lotesRecibidos).toHaveLength(3);
  });

  it('un 401 NO toca la cola: lo que falta es una credencial, no un reintento', async () => {
    proveedor.programar({ tipo: 'fallo', estadoHttp: 401, mensaje: 'JWT expired' });

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('sin_credencial');
    const cola = colaPendiente();
    expect(cola[0]?.intentos).toBe(0);
    expect(cola[0]?.bloqueante).toBe(0);
    expect(cola[0]?.proximo_intento_en).toBeNull();
    expect(cola[0]?.error).toBeNull();
  });
});

// ===========================================================================
// 4. Idempotencia y retomar tras un cierre forzado
// ===========================================================================

describe('Cortar el proceso a mitad de un lote no pierde ni duplica nada', () => {
  it('un ciclo abandonado esperando la respuesta no marca NADA', async () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    proveedor.programar({ tipo: 'colgado' });

    // Se lanza el ciclo y se abandona: es lo que pasa cuando alguien mata el
    // proceso desde el Administrador de tareas, que este proyecto permite a
    // propósito (CLAUDE.md §4.5).
    void crearTrabajador().ejecutarCiclo();
    await new Promise((resolver) => setTimeout(resolver, 10));

    expect(proveedor.lotesRecibidos).toHaveLength(1);
    expect(pendientes()).toBe(2);
    expect(colaPendiente()[0]?.intentos).toBe(0);
  });

  it('un trabajador NUEVO sobre la misma base retoma exactamente donde quedó', async () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    proveedor.programar({ tipo: 'colgado' });
    void crearTrabajador().ejecutarCiclo();
    await new Promise((resolver) => setTimeout(resolver, 10));

    // «Reinicio»: un trabajador nuevo, sin nada en memoria del anterior.
    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(pendientes()).toBe(0);
    // La nube recibió el mismo lote dos veces y las dos con las MISMAS filas:
    // ahí es donde el upsert por clave primaria de §3.1 hace su trabajo.
    expect(proveedor.lotesRecibidos).toHaveLength(2);
    expect(proveedor.lotesRecibidos[0]).toEqual(proveedor.lotesRecibidos[1]);
  });

  it('si la respuesta 2xx se pierde, el reintento manda exactamente lo mismo', async () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    // La nube recibió las filas y contestó, pero la respuesta no llegó.
    proveedor.programar({ tipo: 'excepcion', mensaje: 'socket hang up' });

    await crearTrabajador().ejecutarCiclo();
    reloj += 5_000;
    await crearTrabajador().ejecutarCiclo();

    expect(pendientes()).toBe(0);
    expect(proveedor.lotesRecibidos).toHaveLength(2);
    expect(proveedor.lotesRecibidos[0]).toEqual(proveedor.lotesRecibidos[1]);
  });

  it('confirmar DOS VECES el mismo lote no cambia la marca ni duplica filas', () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    const loteId = colaPendiente()[0]?.lote_id ?? '';

    expect(repos.syncCola.marcarLoteSincronizado(loteId)).toBe(2);
    const marcaOriginal = base
      .prepare('SELECT sincronizado_en FROM sync_cola WHERE lote_id = ? ORDER BY orden_en_lote')
      .all(loteId) as { sincronizado_en: string }[];

    // La segunda confirmación no toca ninguna fila.
    expect(repos.syncCola.marcarLoteSincronizado(loteId)).toBe(0);

    const marcaDespues = base
      .prepare('SELECT sincronizado_en FROM sync_cola WHERE lote_id = ? ORDER BY orden_en_lote')
      .all(loteId) as { sincronizado_en: string }[];
    expect(marcaDespues).toEqual(marcaOriginal);
    expect(
      (base.prepare('SELECT COUNT(*) AS n FROM sync_cola').get() as { n: number }).n,
    ).toBe(2);
  });

  it('un lote a medio marcar se completa en el ciclo siguiente, sin volver a subir lo marcado', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    cobrarUnaVenta();
    const loteId = colaPendiente()[0]?.lote_id ?? '';

    // Se simula la peor interrupción posible: el proceso murió DESPUÉS de
    // marcar dos filas del lote y antes de marcar las otras dos.
    base
      .prepare(
        `UPDATE sync_cola SET sincronizado_en = ?
          WHERE lote_id = ? AND orden_en_lote < 2`,
      )
      .run('2026-09-11T12:00:00.000Z', loteId);
    expect(pendientes()).toBe(2);

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(pendientes()).toBe(0);
    // Solo viajaron las dos que faltaban: lo ya confirmado no se vuelve a subir.
    expect(proveedor.tablasPorLote()).toEqual([['venta_detalle', 'auditoria_log']]);
  });
});

// ===========================================================================
// 5. Cede ante la venta — contención real, no intención
// ===========================================================================

describe('El trabajador cede ante una venta en curso', () => {
  beforeEach(() => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
  });

  it('un ciclo lanzado DENTRO de la transacción de la venta no toca la base', async () => {
    const trabajador = crearTrabajador();
    const ciclos: Promise<ResumenDeCiclo>[] = [];
    let senalVistaAdentro = false;

    /*
      El observador de la bandeja de salida corre DENTRO de la transacción de
      la venta, justo después de escribir la cola y antes del COMMIT. Es el
      punto exacto de máxima contención: hay filas de cola visibles para esta
      conexión y la transacción todavía no se confirmó.
    */
    observarLotesEncolados(() => {
      senalVistaAdentro = hayVentaEnCurso();
      ciclos.push(trabajador.ejecutarCiclo());
    });

    cobrarUnaVenta();
    expect(ciclos).toHaveLength(1);
    const resumen = await ciclos[0];

    expect(senalVistaAdentro).toBe(true);
    expect(resumen?.motivo).toBe('cedio_ante_venta');
    // No hizo ni una llamada, y no marcó ni una fila.
    expect(proveedor.lotesRecibidos).toHaveLength(0);
    expect(pendientes()).toBe(4);
  });

  it('en cuanto la venta termina, el mismo trabajador sube el lote sin problema', async () => {
    const trabajador = crearTrabajador();
    const ciclos: Promise<ResumenDeCiclo>[] = [];
    observarLotesEncolados(() => {
      ciclos.push(trabajador.ejecutarCiclo());
    });

    cobrarUnaVenta();
    await ciclos[0];
    observarLotesEncolados(null);

    const despues = await trabajador.ejecutarCiclo();

    expect(despues.motivo).toBe('cola_vaciada');
    expect(despues.filasSubidas).toBe(4);
    expect(pendientes()).toBe(0);
  });

  it('la señal baja aunque la venta FALLE, o el trabajador cedería para siempre', () => {
    expect(hayVentaEnCurso()).toBe(false);
    expect(() =>
      durante(() => {
        throw new Error('conflicto de inventario');
      }),
    ).toThrow('conflicto de inventario');
    expect(hayVentaEnCurso()).toBe(false);
  });

  it('POR QUÉ CEDER NO ES CORTESÍA: sin la señal, subiría una venta que se revierte', async () => {
    /*
      PRUEBA DE FALSIFICACIÓN. Se apaga la señal a propósito y se lanza el
      ciclo desde dentro de una transacción que después se revierte.

      El trabajador lee la cola de forma SÍNCRONA antes de su primer `await`,
      así que ve las filas que esta misma conexión escribió y todavía no
      confirmó. Si no cediera, mandaría a la nube un cambio que nunca existió.
    */
    const trabajador = crearTrabajador();
    const ciclos: Promise<ResumenDeCiclo>[] = [];

    observarLotesEncolados(() => {
      reiniciarSenalDeVenta(); // ← la falsificación: se apaga la señal
      ciclos.push(trabajador.ejecutarCiclo());
    });

    const escribirYRevertir = base.transaction((): void => {
      const id = '99999999-9999-4999-8999-999999999999';
      base
        .prepare(
          `INSERT INTO categorias (id, nombre, orden, activo, creado_en, actualizado_en)
           VALUES (?, 'Categoría fantasma', 9, 1, ?, ?)`,
        )
        .run(id, '2026-09-11T12:00:00.000Z', '2026-09-11T12:00:00.000Z');
      encolarLote(base, [{ tabla: 'categorias', id, operacion: 'insertar' }]);
      throw new Error('la transacción se revierte después de encolar');
    });

    expect(() => {
      escribirYRevertir();
    }).toThrow('se revierte');
    await ciclos[0];

    // La categoría NO existe: la transacción se revirtió.
    const cuantas = base
      .prepare("SELECT COUNT(*) AS n FROM categorias WHERE nombre = 'Categoría fantasma'")
      .get() as { n: number };
    expect(cuantas.n).toBe(0);

    // Y sin embargo la nube la recibió. Eso es exactamente lo que la señal
    // impide, y por eso ceder no es una cortesía de rendimiento.
    expect(proveedor.lotesRecibidos).toHaveLength(1);
    expect(proveedor.lotesRecibidos[0]?.[0]?.tabla).toBe('categorias');
  });
});

// ===========================================================================
// 6. Presupuesto por ciclo
// ===========================================================================

describe('El presupuesto por ciclo es el del diseño y se respeta', () => {
  it('los valores por defecto son los de la sección 2.4, sin inventar ninguno', () => {
    expect(PRESUPUESTO_POR_DEFECTO).toEqual({
      lotesMaximos: 20,
      duracionMaximaMs: 30_000,
      pausaEntreLotesMs: 250,
      descansoTrasPresupuestoMs: 60_000,
      filasPorLoteDeReferencia: 50,
    });
  });

  it('se corta a los N lotes aunque queden pendientes, y el resto espera al ciclo siguiente', async () => {
    for (let i = 0; i < 5; i += 1) {
      categorias.crear(idJimmy, { nombre: `Categoría ${String(i)}`, orden: i + 2 });
    }

    const trabajador = crearTrabajador({ lotesMaximos: 3 });
    const primero = await trabajador.ejecutarCiclo();

    expect(primero.motivo).toBe('presupuesto_agotado');
    expect(primero.lotesSubidos).toBe(3);
    expect(repos.syncCola.contarLotesPendientes()).toBe(2);

    const segundo = await trabajador.ejecutarCiclo();
    expect(segundo.motivo).toBe('cola_vaciada');
    expect(segundo.lotesSubidos).toBe(2);
    expect(pendientes()).toBe(0);
  });

  it('se corta también por TIEMPO, aunque no haya llegado al tope de lotes', async () => {
    for (let i = 0; i < 5; i += 1) {
      categorias.crear(idJimmy, { nombre: `Categoría ${String(i)}`, orden: i + 2 });
    }

    // Cada lectura del reloj avanza 11 segundos: al tercer lote ya pasaron 30.
    let lecturas = 0;
    const trabajador = new TrabajadorDeSincronizacion({
      cola: repos.syncCola,
      proveedor,
      azar: SIN_VARIACION,
      presupuesto: { pausaEntreLotesMs: 0, duracionMaximaMs: 30_000 },
      ahora: (): number => {
        lecturas += 1;
        return reloj + lecturas * 11_000;
      },
    });

    const resumen = await trabajador.ejecutarCiclo();

    expect(resumen.motivo).toBe('presupuesto_agotado');
    expect(resumen.lotesSubidos).toBeLessThan(5);
    expect(repos.syncCola.contarLotesPendientes()).toBeGreaterThan(0);
  });

  it('un lote de negocio más grande que las 50 filas de referencia se sube ENTERO', async () => {
    /*
      Partirlo rompería la garantía de todo-o-nada de §4.3 opción B: la nube
      podría quedar con una venta sin la mitad de sus líneas, indefinidamente,
      si la segunda llamada fallara.
    */
    const entradas: EntradaDelLote[] = [];
    for (let i = 0; i < 60; i += 1) {
      const id = repos.categorias.crear({ nombre: `Masiva ${String(i)}`, orden: i + 10 }).id;
      entradas.push({ tabla: 'categorias' as const, id, operacion: 'insertar' as const });
    }
    base.prepare('DELETE FROM sync_cola').run();
    base.transaction(() => {
      encolarLote(base, entradas);
    })();

    const resumen = await crearTrabajador().ejecutarCiclo();

    expect(resumen.lotesSubidos).toBe(1);
    expect(proveedor.lotesRecibidos).toHaveLength(1);
    expect(proveedor.lotesRecibidos[0]).toHaveLength(60);
  });
});

// ===========================================================================
// 7. No bloquea el proceso
// ===========================================================================

describe('Un ciclo largo NO bloquea el bucle de eventos del proceso principal', () => {
  it('un latido de 1 ms sigue latiendo durante un ciclo de 20 lotes', async () => {
    for (let i = 0; i < 20; i += 1) {
      categorias.crear(idJimmy, { nombre: `Categoría ${String(i)}`, orden: i + 2 });
    }
    proveedor.demoraMs = 1;

    /*
      EL LATIDO ES LA MEDICIÓN, no una afirmación. En el proceso principal de
      Electron, el mismo hilo que corre este ciclo atiende el IPC de la ventana:
      si el ciclo lo ocupara sin soltar, el latido se detendría y la caja
      quedaría congelada. Se mide el hueco MÁS LARGO entre dos latidos.
    */
    const latidos: number[] = [];
    const pulso = setInterval(() => {
      latidos.push(Date.now());
    }, 1);

    const trabajador = crearTrabajador({ pausaEntreLotesMs: 2, lotesMaximos: 20 });
    const resumen = await trabajador.ejecutarCiclo();
    clearInterval(pulso);

    expect(resumen.lotesSubidos).toBe(20);
    expect(latidos.length).toBeGreaterThan(10);

    let huecoMaximo = 0;
    for (let i = 1; i < latidos.length; i += 1) {
      huecoMaximo = Math.max(huecoMaximo, (latidos[i] ?? 0) - (latidos[i - 1] ?? 0));
    }
    /*
      EL UMBRAL SE ELIGIÓ MIDIENDO, no a ojo. Un ciclo sano da un hueco máximo
      de 2 ms de forma reproducible; 15 ms deja margen de sobra para el ruido
      de una máquina cargada y sigue estando muy por debajo de cualquier
      bloqueo real. Se comprobó que muerde: cambiando la pausa por una espera
      OCUPADA de 20 ms —el bucle girando sin soltar— esta prueba falla.
    */
    expect(huecoMaximo).toBeLessThan(15);
  });

  it('dos ciclos encimados no se pisan: el segundo cede', async () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    proveedor.demoraMs = 20;

    const trabajador = crearTrabajador();
    const primero = trabajador.ejecutarCiclo();
    const segundo = await trabajador.ejecutarCiclo();

    expect(segundo.motivo).toBe('cedio_ante_venta');
    expect((await primero).motivo).toBe('cola_vaciada');
    expect(proveedor.lotesRecibidos).toHaveLength(1);
  });
});
