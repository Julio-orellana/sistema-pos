/**
 * Las migraciones 038 (local) y 0038 (nube): una anulación de venta solo se
 * autoriza en persona, y ahora lo dice también la base.
 *
 * Lo que tienen que sostener:
 *
 *   · La base rechaza una fila con `autorizada_via = 'remoto'`, nombrando la
 *     restricción, y acepta 'presencial'.
 *   · LA BASE Y `ACEPTA_PIN_REMOTO` DICEN LO MISMO. Es la objeción del diseño
 *     (§1.1: «el segundo lugar») convertida en una prueba: si alguien cambia uno
 *     de los dos lugares sin el otro, esta prueba falla antes de que llegue a una
 *     tienda.
 *   · La 038 se aplica sobre una base que ya tiene anulaciones presenciales, y
 *     se NIEGA —revirtiéndose entera— sobre una que tenga una 'remoto'.
 *   · El espejo de la nube tiene el mismo nombre y la misma expresión, y no
 *     quita el CHECK de la columna.
 *
 * DESDE EL 2026-09-19 LA 040 DESHACE LA 038, a pedido del cliente (spec 003,
 * CLAUDE.md §4.70): la anulación se puede autorizar a distancia y la base
 * vuelve a aceptar 'remoto'. Este archivo NO se borra, porque la 038 es historia
 * aplicada en toda base que exista:
 *
 *   · Las pruebas de lo que la 038 HACE migran hasta la 038 y no con todas las
 *     migraciones. Siguen siendo ciertas para esa migración: una base en la 038
 *     rechaza 'remoto'. Lo que pasa después de la 040 lo prueba
 *     `anulacion-autorizacion-remota.test.ts`.
 *   · La prueba de acoplamiento se queda como está y ahora exige que las dos
 *     digan que SÍ. Su razón de ser no cambió: la base y la tabla cambian juntas.
 */

import type { Database } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ACEPTA_PIN_REMOTO } from '@main/domain/usuarios/autenticacion';
import { aplicarMigraciones, ErrorDeMigracion, MIGRACIONES } from '../migrator';
import { crearBaseMigrada, crearBaseVacia } from './ayuda-base-de-datos';

const RAIZ = join(__dirname, '..', '..', '..', '..');
const RESTRICCION = 'anulaciones_de_venta_solo_presencial';
const INSTANTE = '2026-09-17T15:00:00.000Z';

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

/**
 * Inserta una anulación con la vía pedida, SIN las filas a las que apunta.
 * Las llaves foráneas se apagan solo para esto: lo que se prueba es el CHECK,
 * y SQLite evalúa el CHECK igual con las llaves apagadas.
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

/**
 * Una base con las migraciones HASTA LA 038, sin la 040 que la deshace. Es donde
 * se prueba lo que la 038 hace.
 */
function baseHastaLa038(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(
    nueva.base,
    MIGRACIONES.filter((m) => m.orden <= 38),
  );
  return nueva.base;
}

/** Una base como la de una terminal instalada hoy: con la 037 y sin la 038. */
function baseSinLa038(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(
    nueva.base,
    MIGRACIONES.filter((m) => m.orden < 38),
  );
  return nueva.base;
}

function nombresDeMigracionesAplicadas(base: Database): string[] {
  return (base.prepare('SELECT nombre FROM migraciones_aplicadas ORDER BY orden').all() as { nombre: string }[]).map(
    (fila) => fila.nombre,
  );
}

function esquemaDeLaTabla(base: Database): string {
  return (base.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'anulaciones_de_venta'").get() as { sql: string })
    .sql;
}

describe('LA MIGRACIÓN 038: la base solo acepta una anulación autorizada en persona', () => {
  /*
    HASTA EL 2026-09-19 estas cinco pruebas usaban `baseMigrada()`, es decir TODAS
    las migraciones, y exigían que la base de HOY rechazara 'remoto'. Desde la 040
    (spec 003) la base de hoy lo acepta, a pedido del cliente. Se conservan
    migrando hasta la 038, que es lo que miden: qué hace esa migración, que sigue
    aplicada en toda base que exista.
  */
  it("ACEPTA la vía 'presencial'", () => {
    const base = baseHastaLa038();
    insertarAnulacion(base, 'presencial', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(base.prepare('SELECT autorizada_via FROM anulaciones_de_venta').all()).toEqual([{ autorizada_via: 'presencial' }]);
  });

  it("RECHAZA la vía 'remoto', y el error nombra la restricción nueva", () => {
    const base = baseHastaLa038();
    expect(() => {
      insertarAnulacion(base, 'remoto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    }).toThrow(`CHECK constraint failed: ${RESTRICCION}`);
    expect(base.prepare('SELECT count(*) AS n FROM anulaciones_de_venta').get()).toEqual({ n: 0 });
  });

  it('una vía que no es ninguna de las dos se sigue rechazando', () => {
    const base = baseHastaLa038();
    expect(() => {
      insertarAnulacion(base, 'telefono', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    }).toThrow(/CHECK constraint failed/);
  });

  it('no puede dar NULL: una vía nula la rechaza el NOT NULL de la columna', () => {
    const base = baseHastaLa038();
    expect(() => {
      insertarAnulacion(base, null, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    }).toThrow(/NOT NULL constraint failed/);
  });

  it('el CHECK amplio de la columna SIGUE: los dos conviven en el esquema guardado', () => {
    const esquema = esquemaDeLaTabla(baseHastaLa038());
    expect(esquema).toContain("CHECK (autorizada_via IN ('presencial', 'remoto'))");
    expect(esquema).toContain(`CONSTRAINT ${RESTRICCION} CHECK (autorizada_via = 'presencial')`);
  });
});

describe('LA BASE Y ACEPTA_PIN_REMOTO DICEN LO MISMO sobre la anulación', () => {
  it("si la superficie no acepta el código remoto, la base no acepta 'remoto', y al revés", () => {
    const base = baseMigrada();
    // Control: la misma inserción con 'presencial' entra. Sin esto, un ayudante
    // roto que fallara siempre haría pasar la comparación en falso.
    insertarAnulacion(base, 'presencial', '34343434-3434-4343-8343-343434343434');

    let laBaseLoAcepta: boolean;
    try {
      insertarAnulacion(base, 'remoto', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
      laBaseLoAcepta = true;
    } catch (error) {
      // Solo un CHECK cuenta como «la base no lo acepta». Cualquier otro error
      // es un defecto de la prueba y tiene que verse.
      if (!(error instanceof Error) || !error.message.includes('CHECK constraint failed')) {
        throw error;
      }
      laBaseLoAcepta = false;
    }
    expect(
      laBaseLoAcepta,
      'ACEPTA_PIN_REMOTO.anulacion_de_venta y la restricción ' +
        `${RESTRICCION} tienen que cambiar JUNTOS. La 038/0038 la pusieron y la 040/0040 la ` +
        'quitan (spec 003): con la tabla en true, la base tiene que aceptar remoto, y al revés.',
    ).toBe(ACEPTA_PIN_REMOTO.anulacion_de_venta);
  });
});

describe('LA 038 sobre una terminal que ya tiene datos', () => {
  it('con anulaciones presenciales guardadas, se aplica y las conserva intactas', () => {
    const base = baseSinLa038();
    insertarAnulacion(base, 'presencial', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    const antes = base.prepare('SELECT * FROM anulaciones_de_venta').all();

    /*
      Se migra HASTA LA 038 y no con todas. Hasta el 2026-09-18 esta línea
      pasaba `MIGRACIONES` entero, y era lo mismo porque la 038 era la última.
      Desde la 039 (spec 002) aplicaría también esa, y la prueba mediría otra
      cosa: lo que importa acá es qué hace la 038 con estas filas.
    */
    const resultado = aplicarMigraciones(
      base,
      MIGRACIONES.filter((m) => m.orden <= 38),
    );

    expect(resultado.aplicadasAhora).toEqual(['038_anulacion_solo_presencial']);
    expect(base.prepare('SELECT * FROM anulaciones_de_venta').all()).toEqual(antes);
    expect(base.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });

  it("con una sola fila 'remoto', la 038 FALLA, se revierte entera y la base queda en la 037", () => {
    const base = baseSinLa038();
    // Antes de la 038 la base la acepta: es el CHECK amplio de la 033.
    insertarAnulacion(base, 'remoto', '12121212-1212-4121-8121-121212121212');

    expect(() => aplicarMigraciones(base, MIGRACIONES)).toThrow(ErrorDeMigracion);

    expect(nombresDeMigracionesAplicadas(base)).not.toContain('038_anulacion_solo_presencial');
    expect(nombresDeMigracionesAplicadas(base).at(-1)).toBe('037_quitar_pin_remoto_hash');
    expect(esquemaDeLaTabla(base)).not.toContain(RESTRICCION);
    expect(base.prepare('SELECT autorizada_via FROM anulaciones_de_venta').all()).toEqual([{ autorizada_via: 'remoto' }]);
  });
});

describe('EL ESPEJO de la nube, 0038, es exacto', () => {
  /** El texto sin comentarios de línea y con los espacios normalizados. */
  function sentencias(ruta: string): string {
    return readFileSync(join(RAIZ, ruta), 'utf8')
      .replace(/--[^\n]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const LOCAL = sentencias('src/main/database/migrations/038_anulacion_solo_presencial.sql');
  const NUBE = sentencias('supabase/migrations/0038_anulacion_solo_presencial.sql');

  it('control: el lector quita los comentarios', () => {
    expect(LOCAL).not.toContain('REVIERTE UNA DECISIÓN');
    expect(NUBE).not.toContain('EXIGE LA 0033');
  });

  it('las dos agregan la MISMA restricción, con el mismo nombre y la misma expresión', () => {
    const agregar = /ADD CONSTRAINT (\w+) CHECK \(([^;]*)\);/;
    const local = agregar.exec(LOCAL);
    const nube = agregar.exec(NUBE);
    expect(local?.slice(1)).toEqual([RESTRICCION, "autorizada_via = 'presencial'"]);
    expect(nube?.slice(1)).toEqual(local?.slice(1));
  });

  it('la de la nube NO quita el CHECK de la columna: el espejo queda con los dos, como la local', () => {
    expect(NUBE).not.toMatch(/DROP CONSTRAINT/i);
    expect(LOCAL).not.toMatch(/DROP CONSTRAINT/i);
  });
});
