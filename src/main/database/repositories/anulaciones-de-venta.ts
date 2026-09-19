/**
 * Acceso a las anulaciones de venta (docs/ANULACION-DE-VENTA.md, sección 1).
 *
 * SOLO INSERTA Y LEE. No hay método para editar ni para borrar, y la base lo
 * impide además con dos disparadores (migración 033): una anulación es la
 * evidencia de un control contra el fraude.
 */

import type { AnulacionDeVenta, NuevaAnulacionDeVenta, ViaDeAutorizacion } from './entidades';
import { RepositorioBase, nuevoId } from './base';

/** Fila cruda de la tabla `anulaciones_de_venta`. */
interface FilaAnulacionDeVenta {
  readonly id: string;
  readonly venta_id: string;
  readonly solicitada_por: string;
  readonly autorizada_por: string;
  readonly autorizada_via: ViaDeAutorizacion;
  readonly motivo: string;
  readonly fecha: string;
}

function aEntidad(fila: FilaAnulacionDeVenta): AnulacionDeVenta {
  return {
    id: fila.id,
    ventaId: fila.venta_id,
    solicitadaPor: fila.solicitada_por,
    autorizadaPor: fila.autorizada_por,
    autorizadaVia: fila.autorizada_via,
    motivo: fila.motivo,
    fecha: fila.fecha,
  };
}

export class RepositorioDeAnulacionesDeVenta extends RepositorioBase {
  /**
   * Inserta la anulación. DEBE llamarse dentro de la transacción de la
   * anulación: la reposición de inventario, los contadores, el asiento y el
   * lote van con ella o no va ninguno.
   */
  public crear(datos: NuevaAnulacionDeVenta): AnulacionDeVenta {
    const id = nuevoId();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO anulaciones_de_venta
             (id, venta_id, solicitada_por, autorizada_por, autorizada_via, motivo, fecha)
           VALUES (@id, @venta_id, @solicitada_por, @autorizada_por, @autorizada_via, @motivo, @fecha)`,
        )
        .run({
          id,
          venta_id: datos.ventaId,
          solicitada_por: datos.solicitadaPor,
          autorizada_por: datos.autorizadaPor,
          autorizada_via: datos.autorizadaVia,
          motivo: datos.motivo,
          fecha: datos.fecha,
        });
    });

    const creada = this.obtenerPorId(id);
    if (creada === null) {
      throw new Error(`No se encontró la anulación recién creada con id ${id}.`);
    }
    return creada;
  }

  public obtenerPorId(id: string): AnulacionDeVenta | null {
    const fila = this.base.prepare('SELECT * FROM anulaciones_de_venta WHERE id = ?').get(id) as
      | FilaAnulacionDeVenta
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /** La anulación de una venta, o `null` si la venta no está anulada. */
  public obtenerPorVenta(ventaId: string): AnulacionDeVenta | null {
    const fila = this.base
      .prepare('SELECT * FROM anulaciones_de_venta WHERE venta_id = ?')
      .get(ventaId) as FilaAnulacionDeVenta | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /**
   * Cuántas anulaciones se autorizaron A DISTANCIA con fecha dentro del rango
   * (spec 003, CA-18). Es lo único que queda para revisar después el fraude
   * que la autorización a distancia ya no impide.
   *
   * Cuenta por la fecha de la ANULACIÓN, no por la de la venta. Contar en SQL
   * está bien: es un entero, y §4.15 solo prohíbe agregar columnas decimales.
   */
  public contarRemotasEnRango(desdeIso: string, hastaIso: string): number {
    const fila = this.base
      .prepare(
        `SELECT count(*) AS n FROM anulaciones_de_venta
          WHERE autorizada_via = 'remoto' AND fecha >= ? AND fecha <= ?`,
      )
      .get(desdeIso, hastaIso) as { readonly n: number };
    return fila.n;
  }
}
