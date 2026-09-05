/**
 * Acceso a la bitácora de auditoría.
 *
 * Solo escribe y lee: no hay actualizar ni borrar, y no es un olvido. La base
 * misma rechaza cualquier UPDATE o DELETE sobre esta tabla mediante triggers,
 * porque un registro de auditoría que se puede editar no sirve como evidencia.
 */

import type { AsientoAuditoria, NuevoAsientoAuditoria } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';

/** Fila cruda de la tabla `auditoria_log`. */
interface FilaAuditoria {
  readonly id: string;
  readonly usuario_id: string | null;
  readonly accion: string;
  readonly entidad_tipo: string;
  readonly entidad_id: string | null;
  readonly valor_anterior: string | null;
  readonly valor_nuevo: string | null;
  readonly fecha: string;
}

function aEntidad(fila: FilaAuditoria): AsientoAuditoria {
  return {
    id: fila.id,
    usuarioId: fila.usuario_id,
    accion: fila.accion,
    entidadTipo: fila.entidad_tipo,
    entidadId: fila.entidad_id,
    valorAnterior: fila.valor_anterior,
    valorNuevo: fila.valor_nuevo,
    fecha: fila.fecha,
  };
}

/** Serializa un valor a JSON, o `null` si no hay nada que guardar. */
function aJson(valor: unknown): string | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  return JSON.stringify(valor);
}

export class RepositorioDeAuditoria extends RepositorioBase {
  public registrar(datos: NuevoAsientoAuditoria): AsientoAuditoria {
    const id = nuevoId();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO auditoria_log (
             id, usuario_id, accion, entidad_tipo, entidad_id, valor_anterior, valor_nuevo, fecha
           ) VALUES (
             @id, @usuario_id, @accion, @entidad_tipo, @entidad_id, @valor_anterior, @valor_nuevo, @fecha
           )`,
        )
        .run({
          id,
          usuario_id: datos.usuarioId ?? null,
          accion: datos.accion,
          entidad_tipo: datos.entidadTipo,
          entidad_id: datos.entidadId ?? null,
          valor_anterior: aJson(datos.valorAnterior),
          valor_nuevo: aJson(datos.valorNuevo),
          fecha: datos.fecha ?? ahora(),
        });
    });

    const asiento = this.obtenerPorId(id);
    if (asiento === null) {
      throw new Error(`No se encontró el asiento de auditoría recién creado con id ${id}.`);
    }
    return asiento;
  }

  public obtenerPorId(id: string): AsientoAuditoria | null {
    const fila = this.base.prepare('SELECT * FROM auditoria_log WHERE id = ?').get(id) as
      | FilaAuditoria
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public listarPorRango(desde: string, hasta: string): AsientoAuditoria[] {
    const filas = this.base
      .prepare('SELECT * FROM auditoria_log WHERE fecha >= ? AND fecha <= ? ORDER BY fecha DESC')
      .all(desde, hasta) as FilaAuditoria[];
    return filas.map(aEntidad);
  }

  /** Historial de una entidad concreta: qué le pasó y quién lo hizo. */
  public listarPorEntidad(entidadTipo: string, entidadId: string): AsientoAuditoria[] {
    const filas = this.base
      .prepare(
        'SELECT * FROM auditoria_log WHERE entidad_tipo = ? AND entidad_id = ? ORDER BY fecha DESC',
      )
      .all(entidadTipo, entidadId) as FilaAuditoria[];
    return filas.map(aEntidad);
  }
}
