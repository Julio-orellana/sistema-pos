/**
 * Acceso a la cola local de sincronización.
 *
 * TABLA EXCLUSIVAMENTE LOCAL: no tiene espejo en Supabase. Es el registro de
 * qué falta subir; subirla sería subir la lista de pendientes junto con los
 * pendientes.
 */

import type { ElementoSyncCola, NuevoElementoSyncCola, OperacionSync } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';

/** Fila cruda de la tabla `sync_cola`. */
interface FilaSyncCola {
  readonly id: string;
  readonly entidad_tipo: string;
  readonly entidad_id: string;
  readonly operacion: OperacionSync;
  readonly payload: string;
  readonly intentado_en: string | null;
  readonly sincronizado_en: string | null;
  readonly error: string | null;
  readonly creado_en: string;
}

function aEntidad(fila: FilaSyncCola): ElementoSyncCola {
  return {
    id: fila.id,
    entidadTipo: fila.entidad_tipo,
    entidadId: fila.entidad_id,
    operacion: fila.operacion,
    payload: fila.payload,
    intentadoEn: fila.intentado_en,
    sincronizadoEn: fila.sincronizado_en,
    error: fila.error,
    creadoEn: fila.creado_en,
  };
}

export class RepositorioDeSyncCola extends RepositorioBase {
  /** Encola un cambio para subirlo cuando haya red. */
  public encolar(datos: NuevoElementoSyncCola): ElementoSyncCola {
    const id = nuevoId();

    this.base
      .prepare(
        `INSERT INTO sync_cola (
           id, entidad_tipo, entidad_id, operacion, payload, creado_en
         ) VALUES (
           @id, @entidad_tipo, @entidad_id, @operacion, @payload, @creado_en
         )`,
      )
      .run({
        id,
        entidad_tipo: datos.entidadTipo,
        entidad_id: datos.entidadId,
        operacion: datos.operacion,
        payload: JSON.stringify(datos.payload),
        creado_en: ahora(),
      });

    const encolado = this.obtenerPorId(id);
    if (encolado === null) {
      throw new Error(`No se encontró el elemento de cola recién creado con id ${id}.`);
    }
    return encolado;
  }

  public obtenerPorId(id: string): ElementoSyncCola | null {
    const fila = this.base.prepare('SELECT * FROM sync_cola WHERE id = ?').get(id) as
      | FilaSyncCola
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /** Lo que falta subir, en orden de llegada. */
  public listarPendientes(limite: number): ElementoSyncCola[] {
    const filas = this.base
      .prepare('SELECT * FROM sync_cola WHERE sincronizado_en IS NULL ORDER BY creado_en LIMIT ?')
      .all(limite) as FilaSyncCola[];
    return filas.map(aEntidad);
  }

  public marcarIntento(id: string): void {
    this.base.prepare('UPDATE sync_cola SET intentado_en = ? WHERE id = ?').run(ahora(), id);
  }

  public marcarSincronizado(id: string): void {
    this.base
      .prepare('UPDATE sync_cola SET sincronizado_en = ?, error = NULL WHERE id = ?')
      .run(ahora(), id);
  }

  public marcarError(id: string, error: string): void {
    this.base
      .prepare('UPDATE sync_cola SET intentado_en = ?, error = ? WHERE id = ?')
      .run(ahora(), error, id);
  }

  public contarPendientes(): number {
    const fila = this.base
      .prepare('SELECT COUNT(*) AS total FROM sync_cola WHERE sincronizado_en IS NULL')
      .get() as { readonly total: number };
    return fila.total;
  }
}
