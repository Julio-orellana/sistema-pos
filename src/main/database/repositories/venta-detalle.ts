/** Acceso a datos de las líneas de una venta. */

import type { NuevaVentaDetalle, VentaDetalle } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaCantidad, aColumnaExacta, aColumnaMonto, desdeColumnaDecimal } from '../decimal-columns';

/** Fila cruda de la tabla `venta_detalle`. */
interface FilaVentaDetalle {
  readonly id: string;
  readonly venta_id: string;
  readonly producto_id: string;
  readonly producto_nombre_snap: string;
  readonly unidad_snap: string;
  readonly cantidad: string;
  readonly precio_unitario_snap: string;
  readonly subtotal_exacto: string;
  readonly subtotal_impreso: string;
  readonly orden_linea: number;
  readonly creado_en: string;
}

function aEntidad(fila: FilaVentaDetalle): VentaDetalle {
  return {
    id: fila.id,
    ventaId: fila.venta_id,
    productoId: fila.producto_id,
    productoNombreSnap: fila.producto_nombre_snap,
    unidadSnap: fila.unidad_snap,
    cantidad: desdeColumnaDecimal(fila.cantidad, 'venta_detalle.cantidad'),
    precioUnitarioSnap: desdeColumnaDecimal(
      fila.precio_unitario_snap,
      'venta_detalle.precio_unitario_snap',
    ),
    subtotalExacto: desdeColumnaDecimal(fila.subtotal_exacto, 'venta_detalle.subtotal_exacto'),
    subtotalImpreso: desdeColumnaDecimal(fila.subtotal_impreso, 'venta_detalle.subtotal_impreso'),
    ordenLinea: fila.orden_linea,
    creadoEn: fila.creado_en,
  };
}

export class RepositorioDeVentaDetalle extends RepositorioBase {
  /**
   * Inserta una línea.
   *
   * `subtotalExacto` se guarda SIN redondear porque de él se deriva el total
   * real; `subtotalImpreso` es el valor conciliado que sale en el recibo. Los
   * dos se guardan porque son dos cosas distintas y el auditor tiene que poder
   * ver ambas.
   */
  public crear(datos: NuevaVentaDetalle): VentaDetalle {
    const id = nuevoId();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO venta_detalle (
             id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad,
             precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en
           ) VALUES (
             @id, @venta_id, @producto_id, @producto_nombre_snap, @unidad_snap, @cantidad,
             @precio_unitario_snap, @subtotal_exacto, @subtotal_impreso, @orden_linea, @creado_en
           )`,
        )
        .run({
          id,
          venta_id: datos.ventaId,
          producto_id: datos.productoId,
          producto_nombre_snap: datos.productoNombreSnap,
          unidad_snap: datos.unidadSnap,
          cantidad: aColumnaCantidad(datos.cantidad),
          precio_unitario_snap: aColumnaMonto(datos.precioUnitarioSnap),
          subtotal_exacto: aColumnaExacta(datos.subtotalExacto),
          subtotal_impreso: aColumnaMonto(datos.subtotalImpreso),
          orden_linea: datos.ordenLinea,
          creado_en: ahora(),
        });
    });

    const creada = this.obtenerPorId(id);
    if (creada === null) {
      throw new Error(`No se encontró la línea de venta recién creada con id ${id}.`);
    }
    return creada;
  }

  public obtenerPorId(id: string): VentaDetalle | null {
    const fila = this.base.prepare('SELECT * FROM venta_detalle WHERE id = ?').get(id) as
      | FilaVentaDetalle
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /**
   * Líneas de una venta EN SU ORDEN DE CAPTURA.
   *
   * El orden no es cosmético: decide el desempate del reparto de centavos, así
   * que reimprimir un recibo debe recorrer las líneas exactamente igual que la
   * primera vez.
   */
  public listarPorVenta(ventaId: string): VentaDetalle[] {
    const filas = this.base
      .prepare('SELECT * FROM venta_detalle WHERE venta_id = ? ORDER BY orden_linea')
      .all(ventaId) as FilaVentaDetalle[];
    return filas.map(aEntidad);
  }

  public listarPorProducto(productoId: string, limite: number): VentaDetalle[] {
    const filas = this.base
      .prepare('SELECT * FROM venta_detalle WHERE producto_id = ? ORDER BY creado_en DESC LIMIT ?')
      .all(productoId, limite) as FilaVentaDetalle[];
    return filas.map(aEntidad);
  }
}
