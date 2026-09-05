/** Acceso a datos de los topes de descuento por rol. */

import type { LimiteDescuento, NuevoLimiteDescuento, Rol } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaMonto, desdeColumnaDecimal } from '../decimal-columns';

/** Fila cruda de la tabla `limites_descuento`. */
interface FilaLimiteDescuento {
  readonly id: string;
  readonly rol: Rol;
  readonly descuento_max_porcentaje: string;
  readonly descuento_max_monto_fijo: string;
  readonly editado_por: string | null;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaLimiteDescuento): LimiteDescuento {
  return {
    id: fila.id,
    rol: fila.rol,
    descuentoMaxPorcentaje: desdeColumnaDecimal(
      fila.descuento_max_porcentaje,
      'limites_descuento.descuento_max_porcentaje',
    ),
    descuentoMaxMontoFijo: desdeColumnaDecimal(
      fila.descuento_max_monto_fijo,
      'limites_descuento.descuento_max_monto_fijo',
    ),
    editadoPor: fila.editado_por,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDeLimitesDescuento extends RepositorioBase {
  /**
   * Fija el límite de un rol. Si ya existía, lo reemplaza: hay un único límite
   * vigente por rol, garantizado por el UNIQUE de la columna.
   */
  public fijar(datos: NuevoLimiteDescuento): LimiteDescuento {
    const existente = this.obtenerPorRol(datos.rol);
    const momento = ahora();

    if (existente !== null) {
      this.base
        .prepare(
          `UPDATE limites_descuento
              SET descuento_max_porcentaje = @porcentaje,
                  descuento_max_monto_fijo = @monto,
                  editado_por = @editado_por,
                  actualizado_en = @actualizado_en
            WHERE rol = @rol`,
        )
        .run({
          porcentaje: aColumnaMonto(datos.descuentoMaxPorcentaje),
          monto: aColumnaMonto(datos.descuentoMaxMontoFijo),
          editado_por: datos.editadoPor ?? null,
          actualizado_en: momento,
          rol: datos.rol,
        });
    } else {
      this.base
        .prepare(
          `INSERT INTO limites_descuento (
             id, rol, descuento_max_porcentaje, descuento_max_monto_fijo,
             editado_por, creado_en, actualizado_en
           ) VALUES (
             @id, @rol, @porcentaje, @monto, @editado_por, @creado_en, @actualizado_en
           )`,
        )
        .run({
          id: nuevoId(),
          rol: datos.rol,
          porcentaje: aColumnaMonto(datos.descuentoMaxPorcentaje),
          monto: aColumnaMonto(datos.descuentoMaxMontoFijo),
          editado_por: datos.editadoPor ?? null,
          creado_en: momento,
          actualizado_en: momento,
        });
    }

    const fijado = this.obtenerPorRol(datos.rol);
    if (fijado === null) {
      throw new Error(`No se encontró el límite de descuento del rol ${datos.rol}.`);
    }
    return fijado;
  }

  public obtenerPorRol(rol: Rol): LimiteDescuento | null {
    const fila = this.base.prepare('SELECT * FROM limites_descuento WHERE rol = ?').get(rol) as
      | FilaLimiteDescuento
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public listar(): LimiteDescuento[] {
    const filas = this.base
      .prepare('SELECT * FROM limites_descuento ORDER BY rol')
      .all() as FilaLimiteDescuento[];
    return filas.map(aEntidad);
  }
}
