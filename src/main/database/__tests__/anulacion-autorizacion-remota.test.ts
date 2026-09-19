/**
 * Las migraciones 040 (local) y 0040 (nube): la base vuelve a aceptar una
 * anulación autorizada a distancia (spec 003, CLAUDE.md §4.70).
 *
 * Deshacen la 038/0038 a pedido del cliente. Lo que tienen que sostener:
 *
 *   · Con todas las migraciones, 'remoto' entra y 'presencial' también. La
 *     restricción `anulaciones_de_venta_solo_presencial` ya no está, y el CHECK
 *     de la columna sigue rechazando cualquier otra vía (CA-10).
 *   · La 040 sobre una base con anulaciones presenciales las deja IDÉNTICAS
 *     (CA-5). Y si la restricción faltara, falla con ruido: va sin `IF EXISTS`.
 *   · El espejo 0040 es la MISMA sentencia, no agrega nada, no toca el CHECK de
 *     la columna y no toca el contrato de sincronización (CA-12).
 *
 * Que la base y `ACEPTA_PIN_REMOTO` digan lo mismo lo sigue probando
 * `anulacion-solo-presencial.test.ts`, que se conserva como historia de la 038.
 */

import type { Database } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { aplicarMigraciones, ErrorDeMigracion, MIGRACIONES } from '../migrator';
import { crearBaseMigrada, crearBaseVacia } from './ayuda-base-de-datos';

const RAIZ = join(__dirname, '..', '..', '..', '..');
const RESTRICCION = 'anulaciones_de_venta_solo_presencial';
const INSTANTE = '2026-09-19T15:00:00.000Z';

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

/**
 * Inserta una anulación con la vía pedida, SIN las filas a las que apunta. Las
 * llaves foráneas se apagan solo para esto: lo que se prueba es el CHECK, y
 * SQLite lo evalúa igual con las llaves apagadas.
 */
function insertarAnulacion(base: Database, via: string | null, id: string): void {
  base.pragma('foreign_keys = OFF');
  try {
    base
      .prepare(
        `INSERT INTO anulaciones_de_venta (id, venta_id, solicitada_por, autorizada_por, autorizada_via, motivo, fecha)
         VALUES (?, ?, ?, ?, ?, 'El cliente devolvió la mercadería', ?)`,
      )
      .run(
        id,
        `${id.slice(0, 35)}v`,
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        via,
        INSTANTE,
      );
  } finally {
    base.pragma('foreign_keys = ON');
  }
}

function baseMigrada(): Database {
  const prueba = crearBaseMigrada();
  limpiar = prueba.limpiar;
  return prueba.base;
}

/** Una base como la de una terminal con la 1.3.1: hasta la 039, sin la 040. */
function baseHastaLa039(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(
    nueva.base,
    MIGRACIONES.filter((m) => m.orden <= 39),
  );
  return nueva.base;
}

function esquemaDeLaTabla(base: Database): string {
  return (base.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'anulaciones_de_venta'").get() as { sql: string })
    .sql;
}

function nombresDeMigracionesAplicadas(base: Database): string[] {
  return (base.prepare('SELECT nombre FROM migraciones_aplicadas ORDER BY orden').all() as { nombre: string }[]).map(
    (fila) => fila.nombre,
  );
}

describe('CA-10 — LA 040: la base vuelve a aceptar una anulación autorizada a distancia', () => {
  it("con todas las migraciones, la vía 'remoto' ENTRA", () => {
    const base = baseMigrada();
    insertarAnulacion(base, 'remoto', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(base.prepare('SELECT autorizada_via FROM anulaciones_de_venta').all()).toEqual([{ autorizada_via: 'remoto' }]);
  });

  it("y la vía 'presencial' sigue entrando", () => {
    const base = baseMigrada();
    insertarAnulacion(base, 'presencial', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(base.prepare('SELECT autorizada_via FROM anulaciones_de_venta').all()).toEqual([{ autorizada_via: 'presencial' }]);
  });

  it('la restricción de la 038 ya NO está en el esquema guardado, y el CHECK de la columna SÍ', () => {
    const esquema = esquemaDeLaTabla(baseMigrada());
    expect(esquema).not.toContain(RESTRICCION);
    expect(esquema).toContain("CHECK (autorizada_via IN ('presencial', 'remoto'))");
  });

  it('una vía que no es ninguna de las dos se sigue rechazando, por el CHECK de la columna', () => {
    const base = baseMigrada();
    expect(() => {
      insertarAnulacion(base, 'telefono', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    }).toThrow("CHECK constraint failed: autorizada_via IN ('presencial', 'remoto')");
  });

  it('no puede dar NULL: una vía nula la sigue rechazando el NOT NULL de la columna', () => {
    const base = baseMigrada();
    expect(() => {
      insertarAnulacion(base, null, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    }).toThrow(/NOT NULL constraint failed/);
  });
});

describe('CA-5 — LA 040 sobre una terminal que ya tiene anulaciones', () => {
  it('se aplica sola, deja las anulaciones presenciales IDÉNTICAS y la base íntegra', () => {
    const base = baseHastaLa039();
    insertarAnulacion(base, 'presencial', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    insertarAnulacion(base, 'presencial', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    const antes = base.prepare('SELECT * FROM anulaciones_de_venta ORDER BY id').all();
    // Las filas de prueba no tienen sus padres a propósito (ver `insertarAnulacion`),
    // así que la revisión de llaves ya encuentra huecos. Lo que se exige es que la
    // 040 no cambie NADA de eso: ni una fila, ni una llave.
    const llavesAntes = base.pragma('foreign_key_check');
    // Control: antes de la 040, la base todavía rechaza 'remoto'.
    expect(() => {
      insertarAnulacion(base, 'remoto', '12121212-1212-4121-8121-121212121212');
    }).toThrow(`CHECK constraint failed: ${RESTRICCION}`);

    const resultado = aplicarMigraciones(base, MIGRACIONES);

    expect(resultado.aplicadasAhora).toEqual(['040_anulacion_autorizacion_remota']);
    expect(base.prepare('SELECT * FROM anulaciones_de_venta ORDER BY id').all()).toEqual(antes);
    expect(base.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(base.pragma('foreign_key_check')).toEqual(llavesAntes);
  });

  it('si la restricción FALTARA, la 040 falla con ruido y no queda registrada: va sin IF EXISTS', () => {
    const base = baseHastaLa039();
    // Se quita a mano, por fuera del migrador: el estado que la 040 no espera.
    base.exec(`ALTER TABLE anulaciones_de_venta DROP CONSTRAINT ${RESTRICCION}`);

    expect(() => aplicarMigraciones(base, MIGRACIONES)).toThrow(ErrorDeMigracion);
    expect(nombresDeMigracionesAplicadas(base)).not.toContain('040_anulacion_autorizacion_remota');
  });
});

describe('CA-12 — EL ESPEJO de la nube, 0040, es exacto', () => {
  /** El texto sin comentarios de línea y con los espacios normalizados. */
  function sentencias(ruta: string): string {
    return readFileSync(join(RAIZ, ruta), 'utf8')
      .replace(/--[^\n]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const LOCAL = sentencias('src/main/database/migrations/040_anulacion_autorizacion_remota.sql');
  const NUBE = sentencias('supabase/migrations/0040_anulacion_autorizacion_remota.sql');

  it('control: el lector quita los comentarios', () => {
    expect(LOCAL).not.toContain('REVIERTE UNA DECISIÓN');
    expect(NUBE).not.toContain('LA ÚNICA REGLA DE ORDEN');
  });

  it('las dos son UNA sola sentencia que quita la MISMA restricción de la MISMA tabla', () => {
    const quitar = /^ALTER TABLE (?:public\.)?(\w+) DROP CONSTRAINT (\w+);$/;
    expect(quitar.exec(LOCAL)?.slice(1)).toEqual(['anulaciones_de_venta', RESTRICCION]);
    expect(quitar.exec(NUBE)?.slice(1)).toEqual(['anulaciones_de_venta', RESTRICCION]);
  });

  it('ninguna agrega restricciones, ni toca el CHECK de la columna, ni lleva IF EXISTS', () => {
    for (const texto of [LOCAL, NUBE]) {
      expect(texto).not.toMatch(/ADD CONSTRAINT/i);
      expect(texto).not.toContain('autorizada_via_check');
      expect(texto).not.toMatch(/IF EXISTS/i);
    }
  });

  it('la 0040 NO toca el contrato de sincronización: no nombra ninguna función ni la versión', () => {
    // Es lo que la hace aplicable sin actualizar la tienda el mismo día: la
    // forma del payload y la versión de contrato (1) no cambian (plan §1.3).
    expect(NUBE).not.toMatch(/FUNCTION|contrato_de_sincronizacion|version_del_contrato/i);
  });
});
