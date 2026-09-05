/** Acceso a datos de la cabecera de las ventas. */

import type Decimal from 'decimal.js';

import type {
  EstadoSincronizacion,
  EstadoVenta,
  FormaPago,
  NuevaVenta,
  TipoValor,
  Venta,
} from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaMonto, aColumnaDecimalNulable, desdeColumnaDecimal, desdeColumnaDecimalNulable } from '../decimal-columns';

/** Fila cruda de la tabla `ventas`. */
interface FilaVenta {
  readonly id: string;
  readonly caja_sesion_id: string;
  readonly usuario_id: string;
  readonly fecha: string;
  readonly subtotal: string;
  readonly descuento_tipo: TipoValor | null;
  readonly descuento_valor: string | null;
  readonly descuento_autorizado_por: string | null;
  readonly total: string;
  readonly forma_pago: FormaPago;
  readonly num_boleta: string | null;
  readonly estado: EstadoVenta;
  readonly estado_sincronizacion: EstadoSincronizacion;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaVenta): Venta {
  return {
    id: fila.id,
    cajaSesionId: fila.caja_sesion_id,
    usuarioId: fila.usuario_id,
    fecha: fila.fecha,
    subtotal: desdeColumnaDecimal(fila.subtotal, 'ventas.subtotal'),
    descuentoTipo: fila.descuento_tipo,
    descuentoValor: desdeColumnaDecimalNulable(fila.descuento_valor, 'ventas.descuento_valor'),
    descuentoAutorizadoPor: fila.descuento_autorizado_por,
    total: desdeColumnaDecimal(fila.total, 'ventas.total'),
    formaPago: fila.forma_pago,
    numBoleta: fila.num_boleta,
    estado: fila.estado,
    estadoSincronizacion: fila.estado_sincronizacion,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDeVentas extends RepositorioBase {
  /**
   * Inserta la cabecera de una venta.
   *
   * Se espera que quien la llama esté dentro de una transacción que también
   * inserta el detalle, descuenta el inventario y actualiza el contador de
   * ventas del producto. El repositorio no abre la transacción: eso es
   * responsabilidad del servicio de aplicación, que sabe qué más va adentro.
   */
  public crear(datos: NuevaVenta): Venta {
    const id = nuevoId();
    const momento = ahora();

    this.base
      .prepare(
        `INSERT INTO ventas (
           id, caja_sesion_id, usuario_id, fecha, subtotal, descuento_tipo, descuento_valor,
           descuento_autorizado_por, total, forma_pago, num_boleta, estado,
           estado_sincronizacion, creado_en, actualizado_en
         ) VALUES (
           @id, @caja_sesion_id, @usuario_id, @fecha, @subtotal, @descuento_tipo, @descuento_valor,
           @descuento_autorizado_por, @total, @forma_pago, @num_boleta, @estado,
           'pendiente', @creado_en, @actualizado_en
         )`,
      )
      .run({
        id,
        caja_sesion_id: datos.cajaSesionId,
        usuario_id: datos.usuarioId,
        fecha: datos.fecha ?? momento,
        subtotal: aColumnaMonto(datos.subtotal),
        descuento_tipo: datos.descuentoTipo ?? null,
        descuento_valor: aColumnaDecimalNulable(datos.descuentoValor, 'monto'),
        descuento_autorizado_por: datos.descuentoAutorizadoPor ?? null,
        total: aColumnaMonto(datos.total),
        forma_pago: datos.formaPago,
        num_boleta: datos.numBoleta ?? null,
        estado: datos.estado ?? 'completada',
        creado_en: momento,
        actualizado_en: momento,
      });

    const creada = this.obtenerPorId(id);
    if (creada === null) {
      throw new Error(`No se encontró la venta recién creada con id ${id}.`);
    }
    return creada;
  }

  public obtenerPorId(id: string): Venta | null {
    const fila = this.base.prepare('SELECT * FROM ventas WHERE id = ?').get(id) as
      | FilaVenta
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /** Ventas de un rango de fechas, en orden cronológico. */
  public listarPorRango(desde: string, hasta: string): Venta[] {
    const filas = this.base
      .prepare('SELECT * FROM ventas WHERE fecha >= ? AND fecha <= ? ORDER BY fecha')
      .all(desde, hasta) as FilaVenta[];
    return filas.map(aEntidad);
  }

  /** Ventas de un turno de caja: la base del corte. */
  public listarPorSesionDeCaja(cajaSesionId: string): Venta[] {
    const filas = this.base
      .prepare('SELECT * FROM ventas WHERE caja_sesion_id = ? ORDER BY fecha')
      .all(cajaSesionId) as FilaVenta[];
    return filas.map(aEntidad);
  }

  /** Lo que falta subir a la nube. */
  public listarPendientesDeSincronizar(limite: number): Venta[] {
    const filas = this.base
      .prepare(
        `SELECT * FROM ventas
          WHERE estado_sincronizacion <> 'sincronizado'
          ORDER BY fecha LIMIT ?`,
      )
      .all(limite) as FilaVenta[];
    return filas.map(aEntidad);
  }

  /** Anula una venta. Nunca se borra: el histórico no se reescribe. */
  public anular(id: string): void {
    this.base
      .prepare("UPDATE ventas SET estado = 'anulada', actualizado_en = ? WHERE id = ?")
      .run(ahora(), id);
  }

  public marcarSincronizacion(id: string, estado: EstadoSincronizacion): void {
    this.base
      .prepare('UPDATE ventas SET estado_sincronizacion = ?, actualizado_en = ? WHERE id = ?')
      .run(estado, ahora(), id);
  }

  /** Suma de los totales de un turno, calculada con Decimal.js y no en SQL. */
  public sumarTotalesDeSesion(cajaSesionId: string): Decimal[] {
    return this.listarPorSesionDeCaja(cajaSesionId)
      .filter((venta) => venta.estado === 'completada')
      .map((venta) => venta.total);
  }
}
