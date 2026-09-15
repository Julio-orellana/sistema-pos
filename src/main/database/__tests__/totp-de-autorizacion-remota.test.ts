/**
 * Las migraciones 036 y 037: el secreto de TOTP entra, el PIN remoto fijo sale.
 *
 * Lo que tienen que sostener:
 *
 *   · 036: `totp_secreto_cifrado` solo acepta BYTES (lo que devuelve
 *     `safeStorage`), nunca texto; `totp_ultimo_paso` solo un entero no negativo.
 *   · 037: `pin_remoto_hash` desaparece sin tocar nada más de la fila, y el PIN
 *     remoto que hubiera NO se conserva (decisión de Julio).
 *   · Lo que esperaba en `sync_cola` no cambia: `pin_remoto_hash` ya se
 *     excluía de todo payload desde la fase 1.a, así que no hay payload que
 *     reescribir.
 */

import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { generarHashDePin } from '@shared/auth';
import { encolarLote } from '../bandeja-de-salida';
import { aplicarMigraciones, MIGRACIONES } from '../migrator';
import { crearBaseMigrada, crearBaseVacia } from './ayuda-base-de-datos';

const ID_JIMMY = '44444444-4444-4444-8444-444444444444';
const INSTANTE = '2026-09-15T15:00:00.000Z';

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

function columnasDeUsuarios(base: Database): string[] {
  return (base.prepare('PRAGMA table_info(usuarios)').all() as { name: string }[]).map((c) => c.name);
}

/** Una base como la de hoy: sin la 036 ni la 037, con un PIN remoto fijo configurado. */
function baseConPinRemotoFijo(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(nueva.base, MIGRACIONES.filter((m) => m.orden < 36));
  nueva.base
    .prepare(
      `INSERT INTO usuarios (id, nombre, rol, pin_hash, pin_remoto_hash, activo, intentos_fallidos, creado_en, actualizado_en)
       VALUES (?, 'Jimmy', 'administrativo', ?, ?, 1, 2, ?, ?)`,
    )
    .run(ID_JIMMY, generarHashDePin('2468'), generarHashDePin('8642'), INSTANTE, INSTANTE);
  return nueva.base;
}

describe('LA MIGRACIÓN 037 quita el PIN remoto fijo', () => {
  it('antes existía la columna y tenía un hash; después la columna ya no existe', () => {
    const base = baseConPinRemotoFijo();
    expect(columnasDeUsuarios(base)).toContain('pin_remoto_hash');

    aplicarMigraciones(base, MIGRACIONES);

    expect(columnasDeUsuarios(base)).not.toContain('pin_remoto_hash');
    expect(columnasDeUsuarios(base)).toEqual(expect.arrayContaining(['totp_secreto_cifrado', 'totp_ultimo_paso']));
  });

  it('el resto de la fila queda intacto, y la persona queda SIN autorización remota', () => {
    const base = baseConPinRemotoFijo();
    const antes = base.prepare('SELECT id, nombre, rol, pin_hash, activo, intentos_fallidos, creado_en, actualizado_en FROM usuarios').get();

    aplicarMigraciones(base, MIGRACIONES);

    expect(base.prepare('SELECT id, nombre, rol, pin_hash, activo, intentos_fallidos, creado_en, actualizado_en FROM usuarios').get()).toEqual(antes);
    expect(base.prepare('SELECT totp_secreto_cifrado, totp_ultimo_paso FROM usuarios').get()).toEqual({
      totp_secreto_cifrado: null,
      totp_ultimo_paso: null,
    });
    expect(base.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(base.pragma('foreign_key_check')).toEqual([]);
  });

  it('un lote de usuarios que esperaba en la cola no cambia: nunca llevó pin_remoto_hash', () => {
    const base = baseConPinRemotoFijo();
    base.transaction(() => {
      encolarLote(base, [{ tabla: 'usuarios', id: ID_JIMMY, operacion: 'actualizar' }]);
    })();
    // El `encolarLote` de HOY ya no conoce `pin_remoto_hash` y, sobre una base
    // sin la 037, lo copiaría. La versión anterior lo EXCLUÍA (decisión 17): se
    // deja el payload como lo encolaba ella, que es el que puede estar
    // esperando en una terminal instalada.
    base.prepare("UPDATE sync_cola SET payload = json_remove(payload, '$.pin_remoto_hash')").run();
    const payloadAntes = (base.prepare('SELECT payload FROM sync_cola').get() as { payload: string }).payload;
    expect(payloadAntes).not.toContain('pin_remoto_hash');

    aplicarMigraciones(base, MIGRACIONES);

    expect((base.prepare('SELECT payload FROM sync_cola').get() as { payload: string }).payload).toBe(payloadAntes);
  });
});

describe('LA MIGRACIÓN 036: la base solo acepta el secreto como bytes', () => {
  function baseNueva(): Database {
    const prueba = crearBaseMigrada();
    limpiar = prueba.limpiar;
    prueba.base
      .prepare(
        `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, intentos_fallidos, creado_en, actualizado_en)
         VALUES (?, 'Jimmy', 'administrativo', ?, 1, 0, ?, ?)`,
      )
      .run(ID_JIMMY, generarHashDePin('2468'), INSTANTE, INSTANTE);
    return prueba.base;
  }

  it('acepta bytes', () => {
    const base = baseNueva();
    base.prepare('UPDATE usuarios SET totp_secreto_cifrado = ? WHERE id = ?').run(Buffer.from([1, 2, 3]), ID_JIMMY);
    expect((base.prepare('SELECT typeof(totp_secreto_cifrado) AS t FROM usuarios').get() as { t: string }).t).toBe('blob');
  });

  it('RECHAZA el secreto como TEXTO: un secreto en claro no entra ni por error', () => {
    const base = baseNueva();
    expect(() =>
      base.prepare('UPDATE usuarios SET totp_secreto_cifrado = ? WHERE id = ?').run('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', ID_JIMMY),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rechaza bytes vacíos', () => {
    const base = baseNueva();
    expect(() =>
      base.prepare('UPDATE usuarios SET totp_secreto_cifrado = ? WHERE id = ?').run(Buffer.alloc(0), ID_JIMMY),
    ).toThrow(/CHECK constraint failed/);
  });

  it('el último paso usado solo acepta un entero no negativo', () => {
    const base = baseNueva();
    base.prepare('UPDATE usuarios SET totp_ultimo_paso = 59 WHERE id = ?').run(ID_JIMMY);
    expect(() => base.prepare('UPDATE usuarios SET totp_ultimo_paso = -1 WHERE id = ?').run(ID_JIMMY)).toThrow(/CHECK/);
    expect(() => base.prepare("UPDATE usuarios SET totp_ultimo_paso = '59' WHERE id = ?").run(ID_JIMMY)).not.toThrow();
    // INTEGER tiene afinidad: '59' se guarda como entero 59, que es válido.
    expect(() => base.prepare("UPDATE usuarios SET totp_ultimo_paso = 'cincuenta' WHERE id = ?").run(ID_JIMMY)).toThrow(/CHECK/);
    expect(() => base.prepare('UPDATE usuarios SET totp_ultimo_paso = 1.5 WHERE id = ?').run(ID_JIMMY)).toThrow(/CHECK/);
  });
});
