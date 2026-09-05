/**
 * Sistema de migraciones del esquema local.
 *
 * Principios:
 *   - Las migraciones son archivos .sql numerados y se aplican en orden.
 *   - Una migración YA APLICADA nunca se edita: se agrega otra. El migrador
 *     guarda el checksum de cada una y se niega a arrancar si el contenido de
 *     una migración aplicada cambió, porque eso significa que la base de la
 *     tienda y el código dejaron de coincidir.
 *   - Es idempotente: correrlo dos veces no falla ni duplica nada.
 *   - Cada migración corre dentro de una transacción. Si falla a la mitad, no
 *     deja el esquema en un estado intermedio.
 */

import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';

import sqlEsquemaInicial from './migrations/001_esquema_inicial.sql?raw';

/** Una migración del esquema. */
export interface Migracion {
  /** Número de orden. Determina la secuencia de aplicación. */
  readonly orden: number;
  /** Nombre del archivo sin extensión. Identifica la migración. */
  readonly nombre: string;
  /** Contenido SQL. */
  readonly sql: string;
}

/**
 * Registro explícito de migraciones, en orden.
 *
 * Se declara a mano en vez de descubrir archivos automáticamente para que
 * agregar una migración sea un cambio visible en el historial de git y no algo
 * que aparece por el solo hecho de crear un archivo.
 */
export const MIGRACIONES: readonly Migracion[] = [
  { orden: 1, nombre: '001_esquema_inicial', sql: sqlEsquemaInicial },
];

/** Tabla de control. La crea el propio migrador antes que nada. */
const TABLA_DE_CONTROL = 'migraciones_aplicadas';

/** Fila de la tabla de control. */
interface FilaMigracionAplicada {
  readonly orden: number;
  readonly nombre: string;
  readonly checksum: string;
  readonly aplicada_en: string;
}

/** Informe de lo que hizo el migrador. */
export interface ResultadoMigraciones {
  /** Migraciones que se aplicaron en esta corrida. */
  readonly aplicadasAhora: readonly string[];
  /** Migraciones que ya estaban aplicadas de antes. */
  readonly yaAplicadas: readonly string[];
  /** Cuántas migraciones conoce el sistema en total. */
  readonly totalConocidas: number;
  /** Nombre de la última migración aplicada, o `null` si no hay ninguna. */
  readonly ultimaAplicada: string | null;
}

/** Error de migración, para distinguirlo de un fallo cualquiera de SQLite. */
export class ErrorDeMigracion extends Error {
  public readonly migracion: string;

  public constructor(migracion: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeMigracion';
    this.migracion = migracion;
  }
}

/** Huella del contenido de una migración, para detectar ediciones posteriores. */
export function calcularChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Crea la tabla de control si no existe. */
function asegurarTablaDeControl(base: Database): void {
  base.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLA_DE_CONTROL} (
      orden       INTEGER PRIMARY KEY,
      nombre      TEXT    NOT NULL UNIQUE,
      checksum    TEXT    NOT NULL,
      aplicada_en TEXT    NOT NULL
    );
  `);
}

/** Lee qué migraciones ya se aplicaron, indexadas por nombre. */
function leerAplicadas(base: Database): Map<string, FilaMigracionAplicada> {
  const filas = base
    .prepare(`SELECT orden, nombre, checksum, aplicada_en FROM ${TABLA_DE_CONTROL} ORDER BY orden`)
    .all() as FilaMigracionAplicada[];

  return new Map(filas.map((fila) => [fila.nombre, fila]));
}

/**
 * Aplica todas las migraciones pendientes.
 *
 * Se puede llamar en cada arranque: si no hay nada pendiente, no hace nada.
 */
export function aplicarMigraciones(
  base: Database,
  migraciones: readonly Migracion[] = MIGRACIONES,
): ResultadoMigraciones {
  asegurarTablaDeControl(base);

  const aplicadas = leerAplicadas(base);
  const aplicadasAhora: string[] = [];
  const yaAplicadas: string[] = [];

  const enOrden = [...migraciones].sort((a, b) => a.orden - b.orden);

  for (const migracion of enOrden) {
    const checksum = calcularChecksum(migracion.sql);
    const registro = aplicadas.get(migracion.nombre);

    if (registro !== undefined) {
      if (registro.checksum !== checksum) {
        throw new ErrorDeMigracion(
          migracion.nombre,
          `La migración "${migracion.nombre}" ya se aplicó en esta base pero su contenido cambió desde entonces. ` +
            'Una migración aplicada no se edita: hay que agregar una migración nueva que haga el cambio.',
        );
      }
      yaAplicadas.push(migracion.nombre);
      continue;
    }

    const aplicarUna = base.transaction((): void => {
      base.exec(migracion.sql);
      base
        .prepare(
          `INSERT INTO ${TABLA_DE_CONTROL} (orden, nombre, checksum, aplicada_en) VALUES (?, ?, ?, ?)`,
        )
        .run(migracion.orden, migracion.nombre, checksum, new Date().toISOString());
    });

    try {
      aplicarUna();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      throw new ErrorDeMigracion(
        migracion.nombre,
        `Falló la migración "${migracion.nombre}" y se revirtió por completo: ${detalle}`,
      );
    }

    aplicadasAhora.push(migracion.nombre);
  }

  const todas = [...yaAplicadas, ...aplicadasAhora];

  return {
    aplicadasAhora,
    yaAplicadas,
    totalConocidas: enOrden.length,
    ultimaAplicada: todas.length === 0 ? null : (enOrden[enOrden.length - 1]?.nombre ?? null),
  };
}

/** Cuántas migraciones tiene registradas la base. */
export function contarMigracionesAplicadas(base: Database): number {
  asegurarTablaDeControl(base);
  const fila = base.prepare(`SELECT COUNT(*) AS total FROM ${TABLA_DE_CONTROL}`).get() as {
    readonly total: number;
  };
  return fila.total;
}

/** Nombre de la última migración aplicada, o `null` si la base está virgen. */
export function obtenerUltimaMigracion(base: Database): string | null {
  asegurarTablaDeControl(base);
  const fila = base
    .prepare(`SELECT nombre FROM ${TABLA_DE_CONTROL} ORDER BY orden DESC LIMIT 1`)
    .get() as { readonly nombre: string } | undefined;
  return fila?.nombre ?? null;
}
