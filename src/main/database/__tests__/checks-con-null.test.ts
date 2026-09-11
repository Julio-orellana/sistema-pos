/**
 * AUDITORÍA PERMANENTE: ningún CHECK del esquema debe poder dar NULL.
 *
 * ## El defecto que esta prueba vigila
 *
 * En SQL, un CHECK **rechaza solo cuando su expresión da FALSO**. Si da NULL,
 * la fila entra. Y cualquier comparación con NULL —`col IN (...)`, `col = 'x'`,
 * `col > otra`— da NULL, no falso. Así que una restricción escrita como
 *
 *     (via IS NULL AND por IS NULL) OR (via IN ('presencial','remoto') AND por IS NOT NULL)
 *
 * **no rechaza un autorizante sin vía**: con `via` en NULL la segunda rama da
 * NULL, la primera da falso, y `FALSO OR NULL` es NULL. La forma correcta pone
 * los `IS NOT NULL` adelante, que cortocircuitan a falso.
 *
 * Se encontró en la migración 007 al escribir la 017. Esta prueba existe para
 * que no vuelva a entrar una tercera: **recorre TODOS los CHECK del esquema**,
 * los evalúa sobre grillas que incluyen NULL y falla si alguno nuevo puede dar
 * NULL. No hace falta acordarse de la regla al escribir una migración; si se
 * olvida, `npm test` lo dice.
 *
 * ## Qué NO afirma esta prueba
 *
 * Que una restricción pueda dar NULL **no implica que la tabla tenga un hueco**:
 * otra restricción de la misma tabla puede cubrirla. Es exactamente lo que pasa
 * con la 007, y por eso hay un segundo grupo de pruebas que lo comprueba
 * insertando filas de verdad.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { crearBaseMigrada } from './ayuda-base-de-datos';

let base: Database;
let limpiar: () => void;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
});

afterEach(() => {
  limpiar();
});

/**
 * Las restricciones que HOY pueden dar NULL, con su motivo.
 *
 * **NO ES UNA LISTA DE PERDÓN: es el inventario de lo conocido.** Cada entrada
 * tiene que decir por qué sigue ahí. Si alguien agrega una restricción nueva con
 * esta forma, la prueba falla y hay que decidir: corregirla, o anotarla acá con
 * su razón. Lo que no se puede es que entre sin que nadie se entere.
 */
const CONOCIDAS_QUE_DAN_NULL: readonly { readonly fragmento: string; readonly motivo: string }[] = [
  {
    fragmento: "diferencia_autorizada_via IN ('presencial', 'remoto')",
    motivo:
      'Migración 007. La cubre `caja_sesiones_autorizacion_solo_con_diferencia` de la 008, ' +
      'que exige `diferencia_autorizada_via IS NOT NULL` de forma explícita. Ver el segundo ' +
      'grupo de pruebas de este archivo, que lo comprueba con INSERT reales.',
  },
];

/** Una restricción CHECK encontrada en el esquema. */
interface CheckDelEsquema {
  readonly tabla: string;
  readonly expresion: string;
  readonly columnas: readonly string[];
  readonly nulables: readonly string[];
}

/** Saca las expresiones `CHECK(...)` de un `CREATE TABLE`, contando paréntesis. */
function extraerChecks(sql: string): string[] {
  const encontradas: string[] = [];
  const buscador = /\bCHECK\s*\(/gi;
  let coincidencia: RegExpExecArray | null;

  while ((coincidencia = buscador.exec(sql)) !== null) {
    let cursor = coincidencia.index + coincidencia[0].length;
    const inicio = cursor;
    let profundidad = 1;
    let dentroDeTexto = false;

    while (cursor < sql.length && profundidad > 0) {
      const caracter = sql[cursor];
      if (caracter === "'") {
        dentroDeTexto = !dentroDeTexto;
      } else if (!dentroDeTexto && caracter === '(') {
        profundidad += 1;
      } else if (!dentroDeTexto && caracter === ')') {
        profundidad -= 1;
      }
      cursor += 1;
    }
    encontradas.push(sql.slice(inicio, cursor - 1).trim());
  }
  return encontradas;
}

/** Todos los CHECK del esquema, con las columnas que usa cada uno. */
function checksDelEsquema(conexion: Database): CheckDelEsquema[] {
  const tablas = conexion
    .prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all() as { name: string; sql: string }[];

  const todas: CheckDelEsquema[] = [];
  for (const tabla of tablas) {
    const columnas = conexion.prepare(`PRAGMA table_info(${tabla.name})`).all() as {
      name: string;
      notnull: number;
    }[];

    for (const cruda of extraerChecks(tabla.sql)) {
      // Los comentarios de línea traen nombres de columna que no son usos reales.
      const expresion = cruda.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
      const usadas = columnas
        .filter((columna) => new RegExp(`\\b${columna.name}\\b`).test(expresion))
        .map((columna) => columna.name);

      todas.push({
        tabla: tabla.name,
        expresion,
        columnas: usadas,
        nulables: usadas.filter(
          (nombre) => columnas.find((c) => c.name === nombre)?.notnull === 0,
        ),
      });
    }
  }
  return todas;
}

/** Valores de prueba de una columna: NULL si admite nulos, más los literales del CHECK. */
function valoresDe(expresion: string, esNulable: boolean): (string | null)[] {
  const literales = [...expresion.matchAll(/'([^']*)'/g)]
    .map((coincidencia) => coincidencia[1] ?? '')
    // Fuera los patrones de GLOB y LIKE: son moldes, no valores.
    .filter((valor) => !/[[\]*?]/.test(valor) && !valor.includes('_'));

  const genericos = ['10.00', '', 'inventado', '2026-01-01T12:00:00.000Z'];
  const valores = [...new Set([...literales, ...genericos])].slice(0, 5);
  return esNulable ? [null, ...valores] : valores;
}

/** Evalúa un CHECK sobre la grilla y devuelve las combinaciones que dan NULL. */
function combinacionesQueDanNull(
  conexion: Database,
  check: CheckDelEsquema,
): { readonly resultado: number | null }[] {
  if (check.columnas.length === 0) {
    return [];
  }

  const listas = check.columnas.map((columna) =>
    valoresDe(check.expresion, check.nulables.includes(columna)),
  );
  let filas: (string | null)[][] = [[]];
  for (const lista of listas) {
    filas = filas.flatMap((parcial) => lista.map((valor) => [...parcial, valor]));
    // Cota de seguridad: una restricción con muchas columnas no debe hacer
    // explotar la prueba. Con este tope igual se cubren todas las del esquema.
    if (filas.length > 5000) {
      filas = filas.slice(0, 5000);
    }
  }

  const tabla = `grilla_${Math.random().toString(36).slice(2, 10)}`;
  conexion.exec(`CREATE TABLE ${tabla} (${check.columnas.join(', ')})`);
  const insertar = conexion.prepare(
    `INSERT INTO ${tabla} VALUES (${check.columnas.map(() => '?').join(', ')})`,
  );
  conexion.transaction((todas: (string | null)[][]) => {
    for (const fila of todas) {
      insertar.run(fila);
    }
  })(filas);

  const evaluadas = conexion
    .prepare(`SELECT (${check.expresion}) AS resultado, * FROM ${tabla}`)
    .all() as { resultado: number | null }[];
  conexion.exec(`DROP TABLE ${tabla}`);

  return evaluadas.filter((fila) => fila.resultado === null);
}

// ===========================================================================
describe('Ningún CHECK del esquema puede dar NULL, salvo los ya inventariados', () => {
  it('el esquema tiene restricciones CHECK que auditar', () => {
    // Si el extractor se rompiera y devolviera cero, el resto de las pruebas
    // pasaría sin comprobar nada. Este es el seguro contra eso.
    expect(checksDelEsquema(base).length).toBeGreaterThan(100);
  });

  it('SOLO las conocidas pueden dar NULL, y no hay ninguna nueva', () => {
    const conNull = checksDelEsquema(base)
      .filter((check) => combinacionesQueDanNull(base, check).length > 0)
      .map((check) => `${check.tabla}: ${check.expresion}`);

    const noInventariadas = conNull.filter(
      (texto) => !CONOCIDAS_QUE_DAN_NULL.some((conocida) => texto.includes(conocida.fragmento)),
    );

    expect(
      noInventariadas,
      'Hay un CHECK nuevo que puede dar NULL. Un CHECK solo rechaza cuando da FALSO, ' +
        'así que ese deja pasar filas. Poné los `IS NOT NULL` ADELANTE en la rama, ' +
        'o anotalo en CONOCIDAS_QUE_DAN_NULL con su motivo.',
    ).toEqual([]);
  });

  it('y las conocidas siguen siendo exactamente las inventariadas, ni una menos', () => {
    // Si alguien REPARA una, esta prueba falla y obliga a sacarla del inventario.
    // Un inventario que se queda con entradas viejas deja de significar algo.
    const conNull = checksDelEsquema(base)
      .filter((check) => combinacionesQueDanNull(base, check).length > 0)
      .map((check) => check.expresion);

    for (const conocida of CONOCIDAS_QUE_DAN_NULL) {
      expect(
        conNull.some((expresion) => expresion.includes(conocida.fragmento)),
        `«${conocida.fragmento}» ya no da NULL: si se reparó, sacala del inventario.`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
describe('La 007 puede dar NULL, pero la TABLA no deja entrar nada incoherente', () => {
  /*
    La distinción que decide si hay daño real. `caja_sesiones_autorizacion_coherente`
    de la migración 007 deja pasar «autorizante sin vía», pero
    `caja_sesiones_autorizacion_solo_con_diferencia` de la 008 exige las dos
    columnas de forma explícita y la frena. El hueco existe en la expresión y no
    en la tabla.

    ESTAS PRUEBAS SON LAS QUE IMPORTAN: no evalúan expresiones, insertan filas.
  */
  const USUARIO = '11111111-1111-1111-1111-111111111111';
  const FECHA = '2026-01-01T00:00:00.000Z';

  beforeEach(() => {
    base
      .prepare(
        `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, intentos_fallidos,
                               creado_en, actualizado_en)
         VALUES (?, 'Jimmy', 'administrativo', 'hash', 1, 0, ?, ?)`,
      )
      .run(USUARIO, FECHA, FECHA);
  });

  let contador = 0;

  /** Intenta cerrar un turno con la diferencia, el autorizante y la vía que se le den. */
  function cerrarTurno(
    diferencia: string | null,
    autorizadoPor: string | null,
    via: string | null,
  ): void {
    contador += 1;
    base
      .prepare(
        `INSERT INTO caja_sesiones (
           id, usuario_id, monto_inicial, abierta_en, monto_esperado, monto_real, diferencia,
           cerrada_en, estado, creado_en, actualizado_en,
           diferencia_autorizada_por, diferencia_autorizada_via, cerrada_por
         ) VALUES (?, ?, '100.00', ?, '100.00', '95.00', ?, ?, 'cerrada', ?, ?, ?, ?, NULL)`,
      )
      .run(
        `${String(contador).padStart(8, '0')}-1111-1111-1111-111111111111`,
        USUARIO,
        FECHA,
        diferencia,
        FECHA,
        FECHA,
        FECHA,
        autorizadoPor,
        via,
      );
  }

  it('RECHAZA un descuadre con autorizante y SIN vía', () => {
    // Es justamente lo que la expresión de la 007 deja pasar. La 008 lo frena.
    expect(() => { cerrarTurno('-5.00', USUARIO, null); }).toThrow(
      /caja_sesiones_autorizacion_solo_con_diferencia/,
    );
  });

  it('RECHAZA una caja cuadrada con autorizante y SIN vía', () => {
    expect(() => { cerrarTurno('0.00', USUARIO, null); }).toThrow(
      /caja_sesiones_autorizacion_solo_con_diferencia/,
    );
  });

  it('RECHAZA un descuadre con vía y SIN autorizante', () => {
    expect(() => { cerrarTurno('-5.00', null, 'remoto'); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA una vía que no es ninguna de las dos', () => {
    expect(() => { cerrarTurno('-5.00', USUARIO, 'telepatia'); }).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('ACEPTA un descuadre autorizado y completo', () => {
    expect(() => { cerrarTurno('-5.00', USUARIO, 'remoto'); }).not.toThrow();
  });

  it('ACEPTA una caja cuadrada sin ninguna autorización, que es el caso normal', () => {
    expect(() => { cerrarTurno('0.00', null, null); }).not.toThrow();
  });

  it('y tampoco deja ROMPER el par con un UPDATE posterior', () => {
    cerrarTurno('-5.00', USUARIO, 'remoto');
    expect(() => {
      base
        .prepare('UPDATE caja_sesiones SET diferencia_autorizada_via = NULL WHERE diferencia = ?')
        .run('-5.00');
    }).toThrow(/caja_sesiones_autorizacion_solo_con_diferencia/);
  });

  it('LA COBERTURA ES FRÁGIL Y HAY QUE SABERLO: depende de la 008, no de la 007', () => {
    /*
      Se deja escrito como prueba y no solo como comentario. Si algún día se
      relajara `caja_sesiones_autorizacion_solo_con_diferencia` —por ejemplo para
      permitir autorizar un cierre cuadrado— el hueco de la 007 se reabriría, y
      nada más lo taparía. Esta comprobación exige que esa restricción siga
      existiendo y siga nombrando las dos columnas.
    */
    const esquema = (
      base
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='caja_sesiones'")
        .get() as { sql: string }
    ).sql;

    expect(esquema).toContain('caja_sesiones_autorizacion_solo_con_diferencia');
    expect(esquema).toMatch(/diferencia_autorizada_via IS NOT NULL/);
    expect(esquema).toMatch(/diferencia_autorizada_por IS NOT NULL/);
  });
});

// ===========================================================================
describe('Quien edite la migración 008 se topa con la advertencia', () => {
  /*
    ## POR QUÉ LA ADVERTENCIA NO ESTÁ DENTRO DEL PROPIO `.sql`

    Porque no se puede. La 008 **ya está aplicada** —incluida la base de trabajo
    de Julio, que además tiene ventas reales adentro— y el migrador guarda su
    checksum SHA-256. Cambiarle un solo carácter, aunque sea un comentario, hace
    que la aplicación **se niegue a abrir** esa base. Es la misma razón por la
    que §4.2 dejó sin corregir un comentario engañoso de la migración 001.

    Así que la advertencia vive en dos lugares que sí se pueden tocar: un archivo
    `.LEER-ANTES-DE-TOCAR.md` al lado de la migración —inerte para el migrador,
    que importa cada `.sql` por nombre y no recorre el directorio— y esta prueba,
    que es la que de verdad frena a alguien: **editar la 008 la hace fallar**,
    con el motivo escrito en el mensaje.
  */
  const CARPETA = join(__dirname, '..', 'migrations');
  const RUTA_008 = join(CARPETA, '008_autorizacion_solo_con_diferencia.sql');
  const RUTA_ADVERTENCIA = join(
    CARPETA,
    '008_autorizacion_solo_con_diferencia.LEER-ANTES-DE-TOCAR.md',
  );

  /** El checksum que el migrador tiene registrado hoy para esta migración. */
  const CHECKSUM_FIJADO = 'e50641ea0e63a31862e42dfdc1646d426180eb0379b749c7bf459eab630e8a2d';

  it('la migración 008 NO cambió de contenido', () => {
    const actual = createHash('sha256')
      .update(readFileSync(RUTA_008, 'utf8'), 'utf8')
      .digest('hex');

    expect(
      actual,
      'La migración 008 cambió. DOS COSAS, y la segunda es la que importa:\n\n' +
        '1. Está APLICADA, y el migrador guarda su checksum: la aplicación se va a ' +
        'negar a abrir toda base que ya la tenga, incluida la de Julio. Si el cambio ' +
        'era un comentario, revertilo.\n\n' +
        '2. Su restricción `caja_sesiones_autorizacion_solo_con_diferencia` es HOY lo ' +
        'único que tapa el hueco de la migración 007, que deja pasar un autorizante ' +
        'sin vía. Si la relajaste, comprobá primero si reabriste ese hueco; si lo ' +
        'reabriste, hace falta una migración NUEVA con los `IS NOT NULL` adelante.\n\n' +
        'Todo el detalle está en 008_autorizacion_solo_con_diferencia.LEER-ANTES-DE-TOCAR.md.',
    ).toBe(CHECKSUM_FIJADO);
  });

  it('la advertencia existe al lado de la migración, y nombra la dependencia', () => {
    const advertencia = readFileSync(RUTA_ADVERTENCIA, 'utf8');

    expect(advertencia).toContain('diferencia_autorizada_via IS NOT NULL');
    expect(advertencia).toContain('007');
    expect(advertencia).toContain('checksum');
  });
});
