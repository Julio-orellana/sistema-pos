/**
 * De punta a punta: una operación de negocio real sube por la función correcta
 * y queda marcada como sincronizada.
 *
 * **Base SQLite REAL, servicios REALES, trabajador REAL, proveedor REAL.** Lo
 * único de mentira es el `fetch`, que anota qué se habría mandado y contesta
 * lo que contestaría la nube. Es la diferencia entre «el proveedor arma bien
 * el payload» —que ya prueba `supabase-sync-provider.test.ts`— y «una venta
 * cobrada en la caja termina con `sincronizado_en` puesto», que es lo que a la
 * tienda le importa.
 *
 * SIN RED: `npm test` sigue corriendo con el cable desconectado.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { VERSION_DEL_CONTRATO_DE_SINCRONIZACION } from '@shared/contrato-de-sincronizacion';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { observarLotesEncolados } from '@main/database/bandeja-de-salida';
import { reiniciarSenalDeTransaccion } from '@main/database/transaccion-en-curso';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ServicioDeAnulacionDeVenta } from '@main/domain/venta/servicio-de-anulacion';
import { LogTecnicoSilencioso } from '@main/log-tecnico';

import { SupabaseSyncProvider } from '../supabase-sync-provider';
import type { EstadoDeNube, SesionDeNube } from '../sesion-de-nube';
import { TrabajadorDeSincronizacion } from '../trabajador';

const URL_DEL_PROYECTO = 'https://ztidrshifrblhfraiowg.supabase.co';

let base: Database;
let limpiar: () => void;
let repos: Repositorios;
let caja: ServicioDeCaja;
let venta: ServicioDeVenta;
let categorias: ServicioDeCategorias;
let usuarios: ServicioDeUsuarios;
let idJimmy: string;
let idCajera: string;
let idMaiz: string;
/** Las URL a las que se llamó, en orden. Una por lote. */
let llamadas: string[];

/** El `fetch` de mentira: anota la URL y contesta lo que la nube contestaría. */
function fetchQueAcepta(): typeof fetch {
  return ((url: string, opciones: RequestInit): Promise<Response> => {
    llamadas.push(url);
    const cuerpo = JSON.parse(opciones.body as string) as { lote: { tabla: string; id: string }[] };
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            funcion: url.split('/rpc/')[1],
            contrato: VERSION_DEL_CONTRATO_DE_SINCRONIZACION,
            filas: cuerpo.lote.map((c) => ({
              tabla: `public.${c.tabla}`,
              id: c.id,
              resultado: 'insertada',
              huella: 'abc',
              recibido_en: '2026-09-13T22:00:00+00:00',
            })),
          }),
        ),
    } as Response);
  }) as unknown as typeof fetch;
}

function sesionConectada(): SesionDeNube {
  const estado: EstadoDeNube = {
    hayCredencial: true,
    conectada: true,
    correo: 'terminal@pos.invalid',
    rol: 'terminal',
    vidaDelTokenSegundos: 900,
    desfaseDeRelojSegundos: 0,
    relojSospechoso: false,
    renovacionesFallidas: 0,
    ultimoMotivo: null,
    credencialIlegible: false,
    revocada: false,
    revocadaDesde: null,
    exposicionHasta: null,
    filasPendientes: null,
  };
  return {
    accessTokenVigente: (): string | null => 'token-de-mentira',
    estado: (): EstadoDeNube => estado,
  } as unknown as SesionDeNube;
}

function crearTrabajador(buscar: typeof fetch = fetchQueAcepta()): TrabajadorDeSincronizacion {
  return new TrabajadorDeSincronizacion({
    cola: repos.syncCola,
    proveedor: new SupabaseSyncProvider({
      urlDelProyecto: URL_DEL_PROYECTO,
      llavePublicable: 'sb_publishable_de_mentira',
      sesion: sesionConectada(),
      buscar,
    }),
    presupuesto: { pausaEntreLotesMs: 0 },
  });
}

/** Las funciones a las que se llamó, sin la URL alrededor. */
function funcionesLlamadas(): string[] {
  return llamadas.map((url) => url.split('/rpc/')[1] ?? url);
}

beforeEach(() => {
  reiniciarSenalDeTransaccion();
  observarLotesEncolados(null);
  llamadas = [];

  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

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
  categorias = new ServicioDeCategorias({ base, categorias: repos.categorias, auditoria: repos.auditoria });
  usuarios = new ServicioDeUsuarios({ base, usuarios: repos.usuarios, auditoria: repos.auditoria });

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
  const idCategoria = repos.categorias.crear({ nombre: 'Granos' }).id;
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
  reiniciarSenalDeTransaccion();
  limpiar();
});

// ===========================================================================
describe('UNA VENTA REAL sube por sincronizar_venta y queda sincronizada', () => {
  it('llama a sincronizar_venta y deja la cola vacía', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(repos.syncCola.contarPendientes()).toBeGreaterThan(0);

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_venta']);
    expect(repos.syncCola.contarPendientes()).toBe(0);
  });

  it('TODAS las filas del lote quedan con sincronizado_en puesto', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });
    const total = (base.prepare('SELECT count(*) AS n FROM sync_cola').get() as { n: number }).n;

    await crearTrabajador().ejecutarCiclo();

    const marcadas = (
      base.prepare('SELECT count(*) AS n FROM sync_cola WHERE sincronizado_en IS NOT NULL').get() as {
        n: number;
      }
    ).n;
    expect(marcadas).toBe(total);
  });

  it('las filas viajaron en el orden de la cola: padres antes que hijos', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });
    const enLaCola = base
      .prepare('SELECT entidad_tipo FROM sync_cola ORDER BY orden_en_lote')
      .all() as { entidad_tipo: string }[];

    let mandadas: string[] = [];
    const espia = ((url: string, opciones: RequestInit): Promise<Response> => {
      llamadas.push(url);
      const cuerpo = JSON.parse(opciones.body as string) as { lote: { tabla: string; id: string }[] };
      mandadas = cuerpo.lote.map((c) => c.tabla);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              funcion: 'sincronizar_venta',
              contrato: VERSION_DEL_CONTRATO_DE_SINCRONIZACION,
              filas: cuerpo.lote.map((c) => ({ tabla: c.tabla, id: c.id, resultado: 'insertada' })),
            }),
          ),
      } as Response);
    }) as unknown as typeof fetch;

    await crearTrabajador(espia).ejecutarCiclo();

    expect(mandadas).toEqual(enLaCola.map((f) => f.entidad_tipo));
    expect(mandadas[0]).toBe('productos');
    expect(mandadas).toContain('ventas');
  });
});

// ===========================================================================
describe('CADA OPERACIÓN va a SU función, y no se confunden entre sí', () => {
  it('la apertura de caja llama a la de apertura, nunca a la de cierre', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_apertura_de_caja']);
  });

  it('el cierre de caja llama a la de cierre, nunca a la de apertura', async () => {
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    caja.intentarCerrar(sesion.id, { modo: 'simple', monto: '500' }, { usuarioQueCierra: idCajera });

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_cierre_de_caja']);
  });

  it('el alta de un usuario llama a sincronizar_usuario', async () => {
    usuarios.crear(idJimmy, { nombre: 'Nuevo cajero', rol: 'venta', pin: '9876' });

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_usuario']);
  });

  it('una categoría llama a sincronizar_lote_simple', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_lote_simple']);
  });

  it('CUATRO OPERACIONES SEGUIDAS van cada una a su función, en orden de llegada', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });
    usuarios.crear(idJimmy, { nombre: 'Otro cajero', rol: 'venta', pin: '8765' });
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    caja.intentarCerrar(sesion.id, { modo: 'simple', monto: '500' }, { usuarioQueCierra: idCajera });

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual([
      'sincronizar_lote_simple',
      'sincronizar_usuario',
      'sincronizar_apertura_de_caja',
      'sincronizar_cierre_de_caja',
    ]);
  });
});

// ===========================================================================
describe('UNA ANULACIÓN REAL sube por sincronizar_anulacion_de_venta, y una venta normal NO se confunde con ella', () => {
  function anulaciones(): ServicioDeAnulacionDeVenta {
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

  it('PRUEBA CRUZADA: venta, anulación y otra venta, en ese orden, van a sincronizar_venta, sincronizar_anulacion_de_venta y sincronizar_venta', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();
    const lineas = [{ productoId: idMaiz, cantidad: '2' }];
    const anulada = venta.registrar(idCajera, 'venta', { lineas, descuento: null, formaPago: 'efectivo', numBoleta: null });
    anulaciones().anular(
      { ventaId: anulada.venta.id, motivo: 'El cliente devolvió la mercadería', voucher: null },
      idCajera,
      { autorizadaPor: idJimmy, via: 'presencial' },
    );
    venta.registrar(idCajera, 'venta', { lineas, descuento: null, formaPago: 'efectivo', numBoleta: null });

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_venta', 'sincronizar_anulacion_de_venta', 'sincronizar_venta']);
    expect(repos.syncCola.contarPendientes()).toBe(0);
  });

  it('el lote de la anulación viaja con la forma de §7.1: la anulación, sus productos y su asiento, y NUNCA la fila de ventas', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    const vendida = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });
    base.prepare('DELETE FROM sync_cola').run();
    anulaciones().anular({ ventaId: vendida.venta.id, motivo: 'Cobro duplicado', voucher: null }, idCajera, { autorizadaPor: idJimmy, via: 'presencial' });

    let mandadas: { tabla: string; operacion: string }[] = [];
    const espia = ((url: string, opciones: RequestInit): Promise<Response> => {
      mandadas = (JSON.parse(opciones.body as string) as { lote: { tabla: string; operacion: string }[] }).lote.map((c) => ({ tabla: c.tabla, operacion: c.operacion }));
      return fetchQueAcepta()(url, opciones);
    }) as unknown as typeof fetch;

    await crearTrabajador(espia).ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_anulacion_de_venta']);
    expect(mandadas).toEqual([
      { tabla: 'anulaciones_de_venta', operacion: 'insertar' },
      { tabla: 'productos', operacion: 'actualizar' },
      { tabla: 'auditoria_log', operacion: 'insertar' },
    ]);
  });
});

describe('UN CONFLICTO DE INVENTARIO: su asiento sube solo, por sincronizar_asiento (CLAUDE.md §4.3)', () => {
  it('la venta revertida no viaja; el asiento conflicto_de_inventario sí, y queda sincronizado', async () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    base.prepare('DELETE FROM sync_cola').run();

    // El UPDATE real corre con el saldo que se leyó y afecta cero filas: justo
    // antes, «otro escritor» movió el saldo. Usa la misma conexión, así que se
    // revierte con la venta.
    const original = repos.productos.descontarSiSigueIgual.bind(repos.productos);
    repos.productos.descontarSiSigueIgual = (id, leido, nuevo): boolean => {
      base.prepare('UPDATE productos SET inventario_disponible = ? WHERE id = ?').run('90.000', id);
      return original(id, leido, nuevo);
    };
    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: idMaiz, cantidad: '2' }],
        descuento: null,
        formaPago: 'efectivo',
        numBoleta: null,
      }),
    ).toThrow(/cambió mientras se cobraba/);

    let mandado: { tabla: string; operacion: string; datos: Record<string, unknown> }[] = [];
    const espia = ((url: string, opciones: RequestInit): Promise<Response> => {
      mandado = (JSON.parse(opciones.body as string) as { lote: typeof mandado }).lote;
      return fetchQueAcepta()(url, opciones);
    }) as unknown as typeof fetch;

    await crearTrabajador(espia).ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_asiento']);
    expect(mandado.map((cambio) => [cambio.tabla, cambio.operacion])).toEqual([['auditoria_log', 'insertar']]);
    const datos = mandado[0]?.datos ?? {};
    expect(datos.accion).toBe('conflicto_de_inventario');
    expect(datos.usuario_id).toBe(idCajera);
    expect(datos.entidad_tipo).toBe('productos');
    expect(datos.entidad_id).toBe(idMaiz);
    // `valor_nuevo` viaja como el texto JSON que guardó SQLite; lo parsea la nube.
    expect((JSON.parse(datos.valor_nuevo as string) as { operacion: string }).operacion).toBe('venta');
    expect(repos.syncCola.contarPendientes()).toBe(0);
  });
});

// ===========================================================================
describe('Sin credencial, la cola NO se toca y nada se pierde', () => {
  function trabajadorSinCredencial(): TrabajadorDeSincronizacion {
    const sinToken = {
      accessTokenVigente: (): string | null => null,
      estado: (): EstadoDeNube => ({
        hayCredencial: false,
        conectada: false,
        correo: null,
        rol: null,
        vidaDelTokenSegundos: null,
        desfaseDeRelojSegundos: null,
        relojSospechoso: false,
        renovacionesFallidas: 0,
        ultimoMotivo: 'No hay ninguna credencial guardada.',
        credencialIlegible: false,
        revocada: false,
        revocadaDesde: null,
        exposicionHasta: null,
        filasPendientes: null,
      }),
    } as unknown as SesionDeNube;
    return new TrabajadorDeSincronizacion({
      cola: repos.syncCola,
      proveedor: new SupabaseSyncProvider({
        urlDelProyecto: URL_DEL_PROYECTO,
        llavePublicable: 'sb_publishable_de_mentira',
        sesion: sinToken,
        buscar: fetchQueAcepta(),
      }),
      presupuesto: { pausaEntreLotesMs: 0 },
    });
  }

  it('no se hace NINGUNA llamada a la nube', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });

    await trabajadorSinCredencial().ejecutarCiclo();

    expect(llamadas).toEqual([]);
  });

  it('el lote sigue pendiente y NO queda bloqueante: se sube al reconectar', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });
    const antes = repos.syncCola.contarPendientes();

    await trabajadorSinCredencial().ejecutarCiclo();

    expect(repos.syncCola.contarPendientes()).toBe(antes);
    const bloqueantes = (
      base.prepare('SELECT count(*) AS n FROM sync_cola WHERE bloqueante = 1').get() as { n: number }
    ).n;
    expect(bloqueantes).toBe(0);
  });

  it('NO se suma un intento: la escalera de reintentos no se gasta esperando una credencial', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });

    await trabajadorSinCredencial().ejecutarCiclo();

    const intentos = (
      base.prepare('SELECT max(intentos) AS n FROM sync_cola').get() as { n: number }
    ).n;
    expect(intentos).toBe(0);
  });

  it('y cuando VUELVE la credencial, el mismo lote sube', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });
    await trabajadorSinCredencial().ejecutarCiclo();
    expect(repos.syncCola.contarPendientes()).toBeGreaterThan(0);

    await crearTrabajador().ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_lote_simple']);
    expect(repos.syncCola.contarPendientes()).toBe(0);
  });
});

// ===========================================================================
describe('Un desajuste de contrato DETIENE la cola en ese lote', () => {
  const rechazoDeContrato = ((url: string): Promise<Response> => {
    llamadas.push(url);
    return Promise.resolve({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            code: 'P0001',
            message: 'CONTRATO: la terminal manda la versión 1 y la nube declara la 2',
          }),
        ),
    } as Response);
  }) as unknown as typeof fetch;

  it('el lote queda bloqueante, con el mensaje que nombra los dos números', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });

    await crearTrabajador(rechazoDeContrato).ejecutarCiclo();

    const fila = base
      .prepare('SELECT bloqueante, error FROM sync_cola WHERE sincronizado_en IS NULL LIMIT 1')
      .get() as { bloqueante: number; error: string };
    expect(fila.bloqueante).toBe(1);
    expect(fila.error).toMatch(/versión 1 y la nube declara la 2/);
  });

  it('y NO se sube nada detrás de él: la cola se detiene, no lo saltea', async () => {
    categorias.crear(idJimmy, { nombre: 'Abarrotes' });
    usuarios.crear(idJimmy, { nombre: 'Otro', rol: 'venta', pin: '5544' });

    await crearTrabajador(rechazoDeContrato).ejecutarCiclo();

    expect(funcionesLlamadas()).toEqual(['sincronizar_lote_simple']);
    expect(repos.syncCola.contarPendientes()).toBeGreaterThan(0);
  });
});
