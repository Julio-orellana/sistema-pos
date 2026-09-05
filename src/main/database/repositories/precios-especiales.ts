/** Acceso a datos de precios especiales por producto. */

import type { NuevoPrecioEspecial, PrecioEspecial, TipoValor } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaBooleana, aColumnaMonto, desdeColumnaBooleana, desdeColumnaDecimal } from '../decimal-columns';

/** Fila cruda de la tabla `precios_especiales`. */
interface FilaPrecioEspecial {
  readonly id: string;
  readonly producto_id: string;
  readonly tipo: TipoValor;
  readonly valor: string;
  readonly vigente_desde: string;
  readonly vigente_hasta: string | null;
  readonly activo: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaPrecioEspecial): PrecioEspecial {
  return {
    id: fila.id,
    productoId: fila.producto_id,
    tipo: fila.tipo,
    valor: desdeColumnaDecimal(fila.valor, 'precios_especiales.valor'),
    vigenteDesde: fila.vigente_desde,
    vigenteHasta: fila.vigente_hasta,
    activo: desdeColumnaBooleana(fila.activo, 'precios_especiales.activo'),
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDePreciosEspeciales extends RepositorioBase {
  public crear(datos: NuevoPrecioEspecial): PrecioEspecial {
    const id = nuevoId();
    const momento = ahora();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO precios_especiales (
             id, producto_id, tipo, valor, vigente_desde, vigente_hasta, activo, creado_en, actualizado_en
           ) VALUES (
             @id, @producto_id, @tipo, @valor, @vigente_desde, @vigente_hasta, @activo, @creado_en, @actualizado_en
           )`,
        )
        .run({
          id,
          producto_id: datos.productoId,
          tipo: datos.tipo,
          valor: aColumnaMonto(datos.valor),
          vigente_desde: datos.vigenteDesde,
          vigente_hasta: datos.vigenteHasta ?? null,
          activo: aColumnaBooleana(datos.activo ?? true),
          creado_en: momento,
          actualizado_en: momento,
        });
    });

    const creado = this.obtenerPorId(id);
    if (creado === null) {
      throw new Error(`No se encontró el precio especial recién creado con id ${id}.`);
    }
    return creado;
  }

  public obtenerPorId(id: string): PrecioEspecial | null {
    const fila = this.base.prepare('SELECT * FROM precios_especiales WHERE id = ?').get(id) as
      | FilaPrecioEspecial
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public listarPorProducto(productoId: string): PrecioEspecial[] {
    const filas = this.base
      .prepare('SELECT * FROM precios_especiales WHERE producto_id = ? ORDER BY vigente_desde DESC')
      .all(productoId) as FilaPrecioEspecial[];
    return filas.map(aEntidad);
  }

  /**
   * Precios activos de un producto vigentes en un momento dado.
   * Devuelve la lista; decidir cuál se aplica es del módulo de precios.
   */
  public listarVigentes(productoId: string, momento: string): PrecioEspecial[] {
    const filas = this.base
      .prepare(
        `SELECT * FROM precios_especiales
          WHERE producto_id = ?
            AND activo = 1
            AND vigente_desde <= ?
            AND (vigente_hasta IS NULL OR vigente_hasta > ?)
          ORDER BY vigente_desde DESC`,
      )
      .all(productoId, momento, momento) as FilaPrecioEspecial[];
    return filas.map(aEntidad);
  }

  public desactivar(id: string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE precios_especiales SET activo = 0, actualizado_en = ? WHERE id = ?')
        .run(ahora(), id);
    });
  }
}
