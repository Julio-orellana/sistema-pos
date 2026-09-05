/**
 * Piezas comunes de los repositorios.
 *
 * Un repositorio es la ÚNICA puerta hacia una tabla. El dominio le pide datos
 * y no sabe si detrás hay SQL, un archivo o una prueba en memoria. Aquí viven
 * las cosas que todos comparten: cómo se genera un id, cómo se sella una fecha
 * y de dónde sale la conexión.
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';

/**
 * Genera el identificador de un registro nuevo.
 *
 * UUID versión 4 generado EN EL CLIENTE, nunca un autoincremental de la base.
 * La tienda vende sin internet y sincroniza después: con enteros
 * autoincrementales, dos ventas creadas offline en máquinas distintas tendrían
 * el mismo id y colisionarían al subir a Supabase.
 */
export function nuevoId(): string {
  return randomUUID();
}

/** Marca de tiempo actual en ISO-8601 UTC, el formato que guarda el esquema. */
export function ahora(): string {
  return new Date().toISOString();
}

/**
 * Base de todos los repositorios: guarda la conexión y nada más.
 *
 * No contiene lógica de negocio. Las reglas del negocio viven en los módulos
 * de dominio; aquí solo se lee y se escribe.
 */
export abstract class RepositorioBase {
  protected readonly base: Database;

  public constructor(base: Database) {
    this.base = base;
  }
}
