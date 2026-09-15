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
  readonly costo_unitario_snap: string | null;
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
    costoUnitarioSnap:
      fila.costo_unitario_snap === null
        ? null
        : desdeColumnaDecimal(fila.costo_unitario_snap, 'venta_detalle.costo_unitario_snap'),
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
             precio_unitario_snap, costo_unitario_snap, subtotal_exacto, subtotal_impreso,
             orden_linea, creado_en
           ) VALUES (
             @id, @venta_id, @producto_id, @producto_nombre_snap, @unidad_snap, @cantidad,
             @precio_unitario_snap, @costo_unitario_snap, @subtotal_exacto, @subtotal_impreso,
             @orden_linea, @creado_en
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
          costo_unitario_snap:
            datos.costoUnitarioSnap === undefined || datos.costoUnitarioSnap === null
              ? null
              : aColumnaMonto(datos.costoUnitarioSnap),
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

  /**
   * Las líneas de todas las ventas COMPLETADAS de un rango, para el reporte de
   * ventas por producto.
   *
   * SE UNE CON `ventas` PORQUE LA FECHA ES DE LA VENTA, no de la línea.
   * `venta_detalle.creado_en` existe y sería más cómodo, pero es el instante en
   * que se escribió la fila: si algún día una venta se registrara en diferido,
   * las dos fechas dejarían de coincidir y el reporte contaría la línea en un
   * día distinto del de su propia venta. La fecha del hecho es la de la venta.
   *
   * Igual que en `RepositorioDeVentas.listarCompletadasEnRango`: el filtro se
   * hace en SQL, la SUMA nunca. `cantidad` y `subtotal_impreso` son TEXT
   * canónico y un `SUM()` los pasaría por punto flotante.
   */
  public listarDeVentasCompletadasEnRango(desdeIso: string, hastaIso: string): VentaDetalle[] {
    const filas = this.base
      .prepare(
        `SELECT vd.* FROM venta_detalle vd
           JOIN ventas v ON v.id = vd.venta_id
          WHERE v.fecha >= ? AND v.fecha <= ?
            AND v.estado = 'completada'
          ORDER BY v.fecha, vd.orden_linea`,
      )
      .all(desdeIso, hastaIso) as FilaVentaDetalle[];
    return filas.map(aEntidad);
  }

  public listarPorProducto(productoId: string, limite: number): VentaDetalle[] {
    const filas = this.base
      .prepare('SELECT * FROM venta_detalle WHERE producto_id = ? ORDER BY creado_en DESC LIMIT ?')
      .all(productoId, limite) as FilaVentaDetalle[];
    return filas.map(aEntidad);
  }
}
