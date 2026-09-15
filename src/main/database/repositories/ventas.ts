/** Acceso a datos de la cabecera de las ventas. */

import type Decimal from 'decimal.js';

import type {
  EstadoSincronizacion,
  EstadoVenta,
  FormaPago,
  NuevaVenta,
  TipoValor,
  Venta,
  ViaDeAutorizacion,
} from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaMonto, aColumnaDecimalNulable, desdeColumnaDecimal, desdeColumnaDecimalNulable } from '../decimal-columns';

/**
 * EL FILTRO DE «VENTA NO ANULADA», EN UN SOLO FRAGMENTO CON NOMBRE
 * (docs/ANULACION-DE-VENTA.md §1.3).
 *
 * Una venta está anulada si y solo si existe su fila en `anulaciones_de_venta`.
 * **Ninguna consulta decide por `ventas.estado`**, que dice 'completada' también
 * en las anuladas; hay una prueba estructural que lo exige.
 *
 * Exige que la consulta nombre a `ventas` con el alias `v`. Es texto fijo de
 * este archivo, sin ningún dato de afuera adentro: los valores van siempre como
 * parámetros ligados.
 */
export const VENTA_SIN_ANULACION =
  'NOT EXISTS (SELECT 1 FROM anulaciones_de_venta AS anulacion WHERE anulacion.venta_id = v.id)';

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
  readonly descuento_autorizado_via: ViaDeAutorizacion | null;
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
    descuentoAutorizadoVia: fila.descuento_autorizado_via,
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

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO ventas (
             id, caja_sesion_id, usuario_id, fecha, subtotal, descuento_tipo, descuento_valor,
             descuento_autorizado_por, descuento_autorizado_via, total, forma_pago, num_boleta,
             estado, estado_sincronizacion, creado_en, actualizado_en
           ) VALUES (
             @id, @caja_sesion_id, @usuario_id, @fecha, @subtotal, @descuento_tipo, @descuento_valor,
             @descuento_autorizado_por, @descuento_autorizado_via, @total, @forma_pago, @num_boleta,
             @estado, 'pendiente', @creado_en, @actualizado_en
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
          /*
            LA VÍA VA SIEMPRE CON EL AUTORIZANTE. No se normaliza nada acá a
            propósito: si llegara una sin la otra, el CHECK de la migración 017
            rechaza la fila entera y la venta se revierte. Taparlo con un
            `?? 'presencial'` guardaría una vía inventada, que es peor que
            fallar ruidosamente.
          */
          descuento_autorizado_via: datos.descuentoAutorizadoVia ?? null,
          total: aColumnaMonto(datos.total),
          forma_pago: datos.formaPago,
          num_boleta: datos.numBoleta ?? null,
          estado: datos.estado ?? 'completada',
          creado_en: momento,
          actualizado_en: momento,
        });
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

  /**
   * Ventas NO ANULADAS de un rango de fechas, para los reportes.
   *
   * EL FILTRO VA EN SQL Y LA SUMA NO, y la distinción es la regla central de
   * los reportes de este proyecto (CLAUDE.md §4.15). `fecha` es texto de verdad
   * y la anulación es la existencia de una fila, así que filtrar en SQL es
   * exacto y barato. `total`,
   * `subtotal` y `descuento_valor` son TEXT canónico: un `SUM()` de SQLite los
   * convertiría a punto flotante —medido: diez montos que suman Q13.47 exactos
   * dan `13.459999999999999`— y el error quedaría escondido dentro de un
   * reporte que nadie audita línea por línea. Se devuelven las FILAS y suma
   * quien llama, con Decimal.js.
   *
   * La venta anulada queda fuera por `VENTA_SIN_ANULACION`, y NUNCA por
   * `ventas.estado`: esa columna dice 'completada' también en las anuladas
   * (docs/ANULACION-DE-VENTA.md §1.3).
   *
   * Los dos extremos son INCLUSIVOS. Quien arma el rango pone en `hasta` el
   * último milisegundo del día, no la medianoche siguiente.
   */
  public listarNoAnuladasEnRango(desdeIso: string, hastaIso: string): Venta[] {
    const filas = this.base
      .prepare(
        `SELECT v.* FROM ventas v
          WHERE v.fecha >= ? AND v.fecha <= ?
            AND ${VENTA_SIN_ANULACION}
          ORDER BY v.fecha`,
      )
      .all(desdeIso, hastaIso) as FilaVenta[];
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

  public marcarSincronizacion(id: string, estado: EstadoSincronizacion): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE ventas SET estado_sincronizacion = ?, actualizado_en = ? WHERE id = ?')
        .run(estado, ahora(), id);
    });
  }

  /** Los totales de las ventas no anuladas de un turno; la suma la hace quien llama, con Decimal.js. */
  public sumarTotalesDeSesion(cajaSesionId: string): Decimal[] {
    const filas = this.base
      .prepare(
        `SELECT v.* FROM ventas v
          WHERE v.caja_sesion_id = ?
            AND ${VENTA_SIN_ANULACION}
          ORDER BY v.fecha`,
      )
      .all(cajaSesionId) as FilaVenta[];
    return filas.map((fila) => aEntidad(fila).total);
  }

  /**
   * Los totales de las ventas EN EFECTIVO y NO ANULADAS de un turno.
   *
   * Es la base de `monto_esperado` del corte de caja: lo que debería haber en
   * el cajón. Las ventas con tarjeta quedan fuera a propósito —ese dinero
   * nunca entró al cajón, entra por el banco— y las anuladas también.
   *
   * LA ANULADA SE EXCLUYE, NO SE RESTA (docs/ANULACION-DE-VENTA.md §3.2): como
   * solo se anula con la caja abierta, la venta y su anulación caen siempre en
   * el mismo turno, y excluirla da el mismo número sin inventar un movimiento
   * negativo. Es la ÚNICA fórmula del esperado: la usan `montoEsperadoDe` y el
   * resumen del turno.
   *
   * El filtro se hace en SQL porque `forma_pago` es texto de verdad y la
   * anulación es la existencia de una fila, no un decimal. La SUMA, en cambio, se hace afuera con Decimal.js:
   * `total` es TEXT canónico y un `SUM()` de SQLite lo convertiría a punto
   * flotante, que es exactamente lo que descuadraría el corte.
   */
  public totalesEnEfectivoDeSesion(cajaSesionId: string): Decimal[] {
    const filas = this.base
      .prepare(
        `SELECT v.* FROM ventas v
          WHERE v.caja_sesion_id = ?
            AND v.forma_pago = 'efectivo'
            AND ${VENTA_SIN_ANULACION}
          ORDER BY v.fecha`,
      )
      .all(cajaSesionId) as FilaVenta[];
    return filas.map((fila) => aEntidad(fila).total);
  }
}
