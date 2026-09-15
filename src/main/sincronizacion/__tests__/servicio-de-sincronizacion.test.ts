/**
 * `ServicioDeSincronizacion`, contra SQLite REAL.
 *
 * Se corre con la base y la cola de verdad —no un doble— porque lo que
 * importa comprobar es justo lo que un doble no puede probar: que
 * `saltarLote` escribe la marca en `sync_cola` Y el asiento en
 * `auditoria_log` en la MISMA transacción, y que ese asiento queda encolado
 * para subir como cualquier otro (§4.26 de CLAUDE.md).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import { ErrorDeNegocio } from '@main/database/errores';
import { reiniciarSenalDeTransaccion } from '@main/database/transaccion-en-curso';

import {
  ACCIONES_DE_SINCRONIZACION,
  ServicioDeSincronizacion,
} from '../servicio-de-sincronizacion';
import type { CredencialParaElResumen } from '../resumen-de-sincronizacion';

let base: Database;
let limpiar: () => void;
let repos: Repositorios;
let servicio: ServicioDeSincronizacion;
let idJimmy: string;
/** Cuántas veces se pidió un ciclo inmediato, para comprobar «reintentar ahora». */
let ciclosPedidos: number;
/** Lo que `credencial()` devuelve; las pruebas lo cambian según el caso. */
let credencialActual: CredencialParaElResumen | null;

beforeEach(() => {
  reiniciarSenalDeTransaccion();
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  ciclosPedidos = 0;
  credencialActual = { hayCredencial: true, revocada: false, conectada: true };

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin('2468'),
  }).id;

  servicio = new ServicioDeSincronizacion({
    base,
    cola: repos.syncCola,
    auditoria: repos.auditoria,
    credencial: (): CredencialParaElResumen | null => credencialActual,
    ejecutarCicloAhora: (): Promise<unknown> => {
      ciclosPedidos += 1;
      return Promise.resolve(null);
    },
  });
});

afterEach(() => {
  reiniciarSenalDeTransaccion();
  limpiar();
});

/** Encola un lote de un solo usuario, con su id de lote. */
function encolarUsuario(nombre: string): string {
  conBandejaDeSalida(base, () => {
    const creado = repos.usuarios.crear({
      nombre,
      rol: 'venta',
      pinHash: generarHashDePin('1357'),
    });
    return {
      resultado: undefined,
      entradas: [{ tabla: 'usuarios' as const, id: creado.id, operacion: 'insertar' as const }],
    };
  });
  const fila = base
    .prepare("SELECT lote_id FROM sync_cola WHERE entidad_tipo = 'usuarios' ORDER BY creado_en DESC LIMIT 1")
    .get() as { lote_id: string };
  return fila.lote_id;
}

/** Deja el lote de usuarios como bloqueante, con el error indicado. */
function bloquearLote(loteId: string, error: string): void {
  repos.syncCola.marcarLoteBloqueante(loteId, error);
}

// ===========================================================================
describe('resumen(): lo liviano, sin nada sensible', () => {
  it('sin pendientes: al_dia', () => {
    const r = servicio.resumen();
    expect(r.estado).toBe('al_dia');
    expect(r.pendientes).toBe(0);
    expect(r.configurada).toBe(true);
  });

  it('con pendientes: los cuenta y dice desde cuándo', () => {
    encolarUsuario('Ana');
    const r = servicio.resumen();
    expect(r.pendientes).toBeGreaterThan(0);
    expect(r.pendienteMasViejaDesde).not.toBeNull();
  });

  it('sin nube configurada (credencial null): configurada en false', () => {
    credencialActual = null;
    expect(servicio.resumen().configurada).toBe(false);
  });

  it('un lote bloqueante se refleja como "detenida"', () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'CHECK falló');
    expect(servicio.resumen().estado).toBe('detenida');
  });
});

// ===========================================================================
describe('detalle(): lo completo, para la pantalla', () => {
  it('trae pendientes por tabla', () => {
    encolarUsuario('Ana');
    const d = servicio.detalle();
    const tabla = d.pendientesPorTabla.find((p) => p.entidadTipo === 'usuarios');
    expect(tabla?.total).toBeGreaterThan(0);
  });

  it('sin lote bloqueante, loteBloqueante es null', () => {
    expect(servicio.detalle().loteBloqueante).toBeNull();
  });

  it('con un lote bloqueante, trae el error TAL CUAL y las tablas involucradas', () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, '{"code":"23505","message":"duplicate key"}');

    const detalle = servicio.detalle();
    expect(detalle.loteBloqueante?.loteId).toBe(loteId);
    expect(detalle.loteBloqueante?.error).toBe('{"code":"23505","message":"duplicate key"}');
    expect(detalle.loteBloqueante?.tablas).toContain('usuarios');
  });

  it('último éxito es null hasta que algo se marque sincronizado', () => {
    expect(servicio.detalle().ultimoExitoEn).toBeNull();
  });

  it('último éxito refleja lo que de verdad se marcó', () => {
    const loteId = encolarUsuario('Ana');
    repos.syncCola.marcarLoteSincronizado(loteId);
    expect(servicio.detalle().ultimoExitoEn).not.toBeNull();
  });

  it('sin nube configurada, los campos de credencial son honestos (false), no inventados', () => {
    credencialActual = null;
    const d = servicio.detalle();
    expect(d.hayCredencial).toBe(false);
    expect(d.revocada).toBe(false);
    expect(d.conectada).toBe(false);
  });
});

// ===========================================================================
describe('reintentarLote(): desbloquea y pide un ciclo inmediato', () => {
  it('quita el bloqueo del lote', async () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error');
    expect(servicio.detalle().loteBloqueante).not.toBeNull();

    await servicio.reintentarLote(loteId);

    expect(servicio.detalle().loteBloqueante).toBeNull();
  });

  it('pide un ciclo inmediato', async () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error');

    await servicio.reintentarLote(loteId);

    expect(ciclosPedidos).toBe(1);
  });

  it('un loteId que no existe no lanza: simplemente no hay nada que desbloquear', async () => {
    await expect(servicio.reintentarLote('00000000-0000-4000-8000-000000000000')).resolves.toBeUndefined();
    expect(ciclosPedidos).toBe(1);
  });
});

// ===========================================================================
describe('saltarLote(): la acción que deja el hueco, y con qué evidencia', () => {
  it('marca el lote como resuelto: ya no está entre los pendientes', () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error de Postgres');

    servicio.saltarLote(idJimmy, loteId);

    expect(servicio.detalle().loteBloqueante).toBeNull();
    // El LOTE VIEJO ya no está pendiente. Lo que SÍ queda pendiente es el
    // asiento de auditoría NUEVO que el propio salto generó —eso se comprueba
    // aparte, más abajo— así que `contarPendientes()` no vuelve a cero.
    const filasDelLoteViejo = base
      .prepare('SELECT COUNT(*) AS n FROM sync_cola WHERE lote_id = ? AND sincronizado_en IS NULL')
      .get(loteId) as { n: number };
    expect(filasDelLoteViejo.n).toBe(0);
  });

  it('el registro local NO se limpia a NULL: queda una nota de que fue saltado a mano', () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error original de Postgres');

    servicio.saltarLote(idJimmy, loteId);

    const fila = base
      .prepare("SELECT error, sincronizado_en FROM sync_cola WHERE lote_id = ?")
      .get(loteId) as { error: string; sincronizado_en: string };
    expect(fila.sincronizado_en).not.toBeNull();
    expect(fila.error).toContain('SALTADO A MANO');
    expect(fila.error).toContain('error original de Postgres');
  });

  it('escribe UN asiento en auditoria_log, con el usuario que autorizó', () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error');

    servicio.saltarLote(idJimmy, loteId);

    const asiento = base
      .prepare('SELECT usuario_id, accion, entidad_id FROM auditoria_log WHERE accion = ?')
      .get(ACCIONES_DE_SINCRONIZACION.loteSaltado) as {
      usuario_id: string;
      accion: string;
      entidad_id: string;
    };
    expect(asiento.usuario_id).toBe(idJimmy);
    expect(asiento.entidad_id).toBe(loteId);
  });

  it('ESE asiento queda ENCOLADO: es un hecho de negocio y tiene que llegar a la nube', () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error');

    servicio.saltarLote(idJimmy, loteId);

    const enCola = base
      .prepare("SELECT COUNT(*) AS n FROM sync_cola WHERE entidad_tipo = 'auditoria_log' AND sincronizado_en IS NULL")
      .get() as { n: number };
    expect(enCola.n).toBeGreaterThan(0);
  });

  it('el asiento de auditoría del salto NO se marca sincronizado de una: sigue pendiente', () => {
    // Distingue el asiento NUEVO (que sí tiene que subir) de la fila vieja
    // que se saltó (que se marca resuelta localmente, sin subir).
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error');

    servicio.saltarLote(idJimmy, loteId);

    const pendientes = repos.syncCola.contarPendientes();
    expect(pendientes).toBe(1); // el asiento nuevo, nada más
  });

  it('un lote que ya no existe (o ya se subió) se rechaza con ErrorDeNegocio, no con un asiento vacío', () => {
    expect(() => {
      servicio.saltarLote(idJimmy, '00000000-0000-4000-8000-000000000000');
    }).toThrow(ErrorDeNegocio);

    // Y no queda ningún asiento fantasma.
    const asientos = base
      .prepare('SELECT COUNT(*) AS n FROM auditoria_log WHERE accion = ?')
      .get(ACCIONES_DE_SINCRONIZACION.loteSaltado) as { n: number };
    expect(asientos.n).toBe(0);
  });

  it('un lote que YA se subió no se puede volver a saltar', () => {
    const loteId = encolarUsuario('Ana');
    repos.syncCola.marcarLoteSincronizado(loteId);

    expect(() => { servicio.saltarLote(idJimmy, loteId); }).toThrow(ErrorDeNegocio);
  });

  it('nombra las tablas del lote que contenía, no solo el id', () => {
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error');

    const resultado = servicio.saltarLote(idJimmy, loteId);

    expect(resultado.tablas).toContain('usuarios');
    expect(resultado.filas).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe('FALSIFICACIÓN: si saltarLote NO encolara el asiento, esta prueba lo vería', () => {
  it('control: escribir el asiento SIN conBandejaDeSalida deja la cola sin la fila nueva', () => {
    // No se falsifica el servicio real (eso se hace aparte, sobre el código
    // fuente); esto es el control de que el propio arnés de la prueba de
    // arriba SÍ puede detectar la ausencia si el servicio se rompiera:
    // escribiendo el asiento suelto, la cola NO gana una fila nueva.
    const loteId = encolarUsuario('Ana');
    bloquearLote(loteId, 'error');
    repos.syncCola.marcarLoteSaltado(loteId, 'saltado sin auditoría, a mano, para el control');

    const antes = repos.syncCola.contarPendientes();
    repos.auditoria.registrar({
      usuarioId: idJimmy,
      accion: ACCIONES_DE_SINCRONIZACION.loteSaltado,
      entidadTipo: 'sincronizacion',
      entidadId: loteId,
    });
    const despues = repos.syncCola.contarPendientes();

    // El asiento se escribió en auditoria_log pero NO se encoló: pendientes
    // no cambia. Es justo lo que el envoltorio real evita.
    expect(despues).toBe(antes);
  });
});
