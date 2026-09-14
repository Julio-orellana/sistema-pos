/**
 * La poda de `sync_cola` (fase 4.c, riesgo 8.6), contra una base SQLite REAL.
 *
 * Esta es de las pocas operaciones del proyecto que BORRA, en un sistema cuya
 * regla es que nada se borra (§4.11). Lo que estas pruebas tienen que sostener
 * no es que borre, que es lo fácil: es **qué NO borra**, que es lo que hace
 * que borrar se justifique.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import type { EstadoSincronizacion, ResultadoEmpuje, SyncProvider } from '@shared/adapters';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { enTransaccionDeNegocio } from '@main/database/transaccion-en-curso';
import { TrabajadorDeSincronizacion } from '../trabajador';
import { PREFIJO_DE_LOTE_SALTADO, RepositorioDeSyncCola } from '@main/database/repositories/sync-cola';
import { DIAS_QUE_SE_CONSERVAN, ESPERA_ENTRE_PODAS_MS, PodaDeLaCola } from '../poda-de-la-cola';

const AHORA = Date.UTC(2026, 8, 14, 12, 0, 0);
const MS_POR_DIA = 24 * 60 * 60 * 1000;

let base: Database;
let limpiar: () => void;
let cola: RepositorioDeSyncCola;

/** Escribe una fila cruda en la cola, con el estado exacto que la prueba quiere. */
function sembrar(opciones: {
  readonly id: string;
  readonly diasAtras: number;
  readonly sincronizada: boolean;
  readonly error?: string | null;
  readonly bloqueante?: boolean;
}): void {
  const cuando = new Date(AHORA - opciones.diasAtras * MS_POR_DIA).toISOString();
  base
    .prepare(
      `INSERT INTO sync_cola (id, entidad_tipo, entidad_id, operacion, payload, creado_en,
                              sincronizado_en, error, bloqueante, lote_id, orden_en_lote, intentos)
       VALUES (@id, 'ventas', @entidadId, 'insertar', '{"id":"x"}', @creadoEn,
               @sincronizadoEn, @error, @bloqueante, @loteId, 0, 0)`,
    )
    .run({
      id: opciones.id,
      entidadId: opciones.id,
      creadoEn: cuando,
      sincronizadoEn: opciones.sincronizada ? cuando : null,
      error: opciones.error ?? null,
      bloqueante: opciones.bloqueante === true ? 1 : 0,
      loteId: opciones.id,
    });
}

function idsEnLaCola(): string[] {
  return (base.prepare('SELECT id FROM sync_cola ORDER BY id').all() as { id: string }[]).map((f) => f.id);
}

function unId(sufijo: string): string {
  return `00000000-0000-4000-8000-${sufijo.padStart(12, '0')}`;
}

beforeEach(() => {
  const creada = crearBaseMigrada();
  base = creada.base;
  limpiar = creada.limpiar;
  cola = new RepositorioDeSyncCola(base);
});

afterEach(() => {
  limpiar();
});

describe('Qué borra la poda, y sobre todo qué NO', () => {
  it('borra lo YA SUBIDO hace más de 30 días', () => {
    sembrar({ id: unId('1'), diasAtras: 40, sincronizada: true });
    const poda = new PodaDeLaCola({ cola, ahora: (): number => AHORA });
    expect(poda.podar()).toBe(1);
    expect(idsEnLaCola()).toEqual([]);
  });

  it('NO borra lo ya subido RECIENTE: 29 días se conservan y 31 no', () => {
    sembrar({ id: unId('29'), diasAtras: 29, sincronizada: true });
    sembrar({ id: unId('31'), diasAtras: 31, sincronizada: true });
    const poda = new PodaDeLaCola({ cola, ahora: (): number => AHORA });
    expect(poda.podar()).toBe(1);
    expect(idsEnLaCola()).toEqual([unId('29')]);
  });

  it('NO BORRA LO PENDIENTE, por viejo que sea: es justo lo que la cola existe para no perder', () => {
    sembrar({ id: unId('a'), diasAtras: 400, sincronizada: false });
    const poda = new PodaDeLaCola({ cola, ahora: (): number => AHORA });
    expect(poda.podar()).toBe(0);
    expect(idsEnLaCola()).toEqual([unId('a')]);
  });

  it('NO borra un lote BLOQUEANTE viejo: es un pendiente con otro nombre', () => {
    sembrar({ id: unId('b'), diasAtras: 400, sincronizada: false, bloqueante: true, error: '23505 duplicate key' });
    const poda = new PodaDeLaCola({ cola, ahora: (): number => AHORA });
    expect(poda.podar()).toBe(0);
    expect(idsEnLaCola()).toEqual([unId('b')]);
  });

  it('NO BORRA UN LOTE SALTADO A MANO, por viejo que sea: es un hueco deliberado, no una tarea cumplida', () => {
    sembrar({
      id: unId('c'),
      diasAtras: 400,
      sincronizada: true,
      error: `${PREFIJO_DE_LOTE_SALTADO} el 2025-08-01T00:00:00.000Z: ventas, 3 fila(s).`,
    });
    const poda = new PodaDeLaCola({ cola, ahora: (): number => AHORA });
    expect(poda.podar()).toBe(0);
    expect(idsEnLaCola()).toEqual([unId('c')]);
  });

  it('la marca del saltado sigue legible después de podar todo lo demás', () => {
    sembrar({ id: unId('d'), diasAtras: 400, sincronizada: true });
    sembrar({ id: unId('e'), diasAtras: 400, sincronizada: true, error: `${PREFIJO_DE_LOTE_SALTADO} el …` });
    new PodaDeLaCola({ cola, ahora: (): number => AHORA }).podar();
    const queda = base.prepare('SELECT error FROM sync_cola').get() as { error: string };
    expect(queda.error).toContain(PREFIJO_DE_LOTE_SALTADO);
  });

  it('una cola entera de pendientes sobrevive intacta', () => {
    for (let i = 0; i < 20; i += 1) {
      sembrar({ id: unId(String(i)), diasAtras: 100, sincronizada: false });
    }
    expect(new PodaDeLaCola({ cola, ahora: (): number => AHORA }).podar()).toBe(0);
    expect(idsEnLaCola()).toHaveLength(20);
  });
});

describe('Cuándo corre', () => {
  it('la primera vez SIEMPRE poda: es la del arranque', () => {
    sembrar({ id: unId('1'), diasAtras: 40, sincronizada: true });
    const poda = new PodaDeLaCola({ cola, ahora: (): number => AHORA });
    expect(poda.podarSiTocaba()).toBe(1);
  });

  it('la segunda vez en el mismo día NO poda, y lo dice con null', () => {
    sembrar({ id: unId('1'), diasAtras: 40, sincronizada: true });
    let reloj = AHORA;
    const poda = new PodaDeLaCola({ cola, ahora: (): number => reloj });
    expect(poda.podarSiTocaba()).toBe(1);
    reloj += ESPERA_ENTRE_PODAS_MS / 2;
    expect(poda.podarSiTocaba()).toBeNull();
  });

  it('pasadas 24 h vuelve a podar', () => {
    let reloj = AHORA;
    const poda = new PodaDeLaCola({ cola, ahora: (): number => reloj });
    poda.podarSiTocaba();
    sembrar({ id: unId('2'), diasAtras: 40, sincronizada: true });
    reloj += ESPERA_ENTRE_PODAS_MS + 1;
    expect(poda.podarSiTocaba()).toBe(1);
  });

  it('el corte se calcula contra el reloj de cada corrida, no contra el del arranque', () => {
    sembrar({ id: unId('1'), diasAtras: 20, sincronizada: true });
    let reloj = AHORA;
    const poda = new PodaDeLaCola({ cola, ahora: (): number => reloj });
    expect(poda.podar()).toBe(0);
    // Quince días después, esa misma fila ya tiene 35 y sí se poda.
    reloj += 15 * MS_POR_DIA;
    expect(poda.podar()).toBe(1);
  });
});

describe('Qué deja dicho, y qué pasa si falla', () => {
  it('anota cuántas borró, y no anota nada cuando no borró ninguna', () => {
    sembrar({ id: unId('1'), diasAtras: 40, sincronizada: true });
    const bitacora: string[] = [];
    const poda = new PodaDeLaCola({ cola, ahora: (): number => AHORA, registrar: (m: string): void => {
        bitacora.push(m);
      } });
    poda.podar();
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]).toContain('1 fila(s)');
    expect(bitacora[0]).toContain('30 días');
    poda.podar();
    expect(bitacora).toHaveLength(1);
  });

  it('SI FALLA NO LANZA: la poda es mantenimiento y no puede impedir que la cola suba', () => {
    const bitacora: string[] = [];
    const colaRota = {
      podarSincronizadasAntesDe: (): number => {
        throw new Error('la base está bloqueada');
      },
    } as unknown as RepositorioDeSyncCola;
    const poda = new PodaDeLaCola({ cola: colaRota, ahora: (): number => AHORA, registrar: (m: string): void => {
        bitacora.push(m);
      } });
    expect(() => poda.podar()).not.toThrow();
    expect(poda.podar()).toBe(0);
    expect(bitacora[0]).toContain('la poda de sync_cola falló');
  });
});

describe('Cuánto cuesta, medido', () => {
  it('poda una cola de 50 000 filas en un tiempo razonable, y deja las pendientes', () => {
    const CUANTAS = 50_000;
    const insertar = base.prepare(
      `INSERT INTO sync_cola (id, entidad_tipo, entidad_id, operacion, payload, creado_en,
                              sincronizado_en, error, bloqueante, lote_id, orden_en_lote, intentos)
       VALUES (?, 'ventas', ?, 'insertar', '{"id":"x"}', ?, ?, NULL, 0, ?, 0, 0)`,
    );
    const viejo = new Date(AHORA - 60 * MS_POR_DIA).toISOString();
    const sembrarTodo = base.transaction(() => {
      for (let i = 0; i < CUANTAS; i += 1) {
        const id = unId(String(i));
        // Una de cada mil queda PENDIENTE, para comprobar que sobreviven.
        insertar.run(id, id, viejo, i % 1000 === 0 ? null : viejo, id);
      }
    });
    sembrarTodo();

    const comenzo = Date.now();
    const borradas = new PodaDeLaCola({ cola, ahora: (): number => AHORA }).podar();
    const tardo = Date.now() - comenzo;
    const pendientes = CUANTAS / 1000;

    console.info(`[poda] ${String(borradas)} de ${String(CUANTAS)} filas borradas en ${String(tardo)} ms (macOS, no es la máquina de la tienda)`);
    expect(borradas).toBe(CUANTAS - pendientes);
    expect(base.prepare('SELECT count(*) AS n FROM sync_cola').get()).toEqual({ n: pendientes });
    // Cota deliberadamente floja: lo que se quiere sostener es que es una
    // operación de una vez por día y no un problema, no un número exacto. El
    // número real queda en la línea de arriba, y en un i3 será otro (§8.8).
    const COTA_MS = 10_000;
    expect(tardo).toBeLessThan(COTA_MS);
  });
});

describe('La constante', () => {
  it('conserva 30 días, que es lo que el módulo documenta', () => {
    expect(DIAS_QUE_SE_CONSERVAN).toBe(30);
  });
});

describe('EL TRABAJADOR LA LLAMA DE VERDAD: sin esto, la poda sería código que nadie corre', () => {
  /** Un proveedor que acepta todo, para que el ciclo llegue a su fin sin red. */
  const proveedorQueAceptaTodo: SyncProvider = {
    nombre: 'ProveedorDePruebaDeLaPoda',
    empujarCambios: (cambios): Promise<ResultadoEmpuje> =>
      Promise.resolve({
        ok: true,
        adaptador: 'ProveedorDePruebaDeLaPoda',
        cambiosAceptados: cambios.length,
        cambiosRechazados: 0,
        errores: [],
        simulado: true,
      }),
    consultarEstado: (): Promise<EstadoSincronizacion> =>
      Promise.resolve({ disponible: true, adaptador: 'ProveedorDePruebaDeLaPoda', descripcion: 'de prueba', simulado: true }),
  };

  it('un ciclo del trabajador poda la cola', async () => {
    sembrar({ id: unId('1'), diasAtras: 40, sincronizada: true });
    const trabajador = new TrabajadorDeSincronizacion({
      cola,
      proveedor: proveedorQueAceptaTodo,
      poda: new PodaDeLaCola({ cola, ahora: (): number => AHORA }),
    });
    await trabajador.ejecutarCiclo();
    expect(idsEnLaCola()).toEqual([]);
  });

  it('CEDE ANTE UNA TRANSACCIÓN DE NEGOCIO: la poda escribe, y no se mete en medio de una venta', async () => {
    sembrar({ id: unId('1'), diasAtras: 40, sincronizada: true });
    const trabajador = new TrabajadorDeSincronizacion({
      cola,
      proveedor: proveedorQueAceptaTodo,
      poda: new PodaDeLaCola({ cola, ahora: (): number => AHORA }),
    });
    /*
      El ciclo se LANZA DESDE DENTRO de una transacción de negocio, que es la
      única forma de que la señal esté levantada cuando el ciclo la mira: el
      cuerpo de `ejecutarCiclo` corre síncrono hasta el primer `await`, y una
      transacción de better-sqlite3 es síncrona entera. Es el mismo montaje con
      el que §4.18 falsifica que el trabajador cede.
    */
    let ciclo: Promise<unknown> = Promise.resolve();
    enTransaccionDeNegocio(base, () => {
      ciclo = trabajador.ejecutarCiclo();
    });
    await ciclo;
    expect(idsEnLaCola()).toEqual([unId('1')]);

    // Y en el ciclo siguiente, sin transacción, sí poda.
    await trabajador.ejecutarCiclo();
    expect(idsEnLaCola()).toEqual([]);
  });

  it('un trabajador SIN poda se comporta igual que antes: no borra nada', async () => {
    sembrar({ id: unId('1'), diasAtras: 400, sincronizada: true });
    const trabajador = new TrabajadorDeSincronizacion({ cola, proveedor: proveedorQueAceptaTodo });
    await trabajador.ejecutarCiclo();
    expect(idsEnLaCola()).toEqual([unId('1')]);
  });
});
