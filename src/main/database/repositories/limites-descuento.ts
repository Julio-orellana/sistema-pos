/** Acceso a datos de los topes de descuento por rol. */

import type { LimiteDescuento, NuevoLimiteDescuento, Rol } from './entidades';
import { RepositorioBase, ahora } from './base';
import { aColumnaMonto, desdeColumnaDecimal } from '../decimal-columns';

/**
 * EL ID DE UN TOPE NO SE SORTEA: ES FIJO POR ROL.
 *
 * Rompe a propósito la regla general de «UUID generados en el cliente», por la
 * misma razón que `denominaciones` la rompe desde el Prompt 13: esa regla
 * existe para que dos filas creadas sin internet en máquinas distintas no
 * colisionen al subir, y acá **la colisión es justamente lo que se busca**. Hay
 * como mucho dos filas, siempre las mismas dos, una por rol.
 *
 * Con el id sorteado había un defecto real, medido contra la nube el
 * 2026-09-14: `escribir_fila` hace `ON CONFLICT (id) DO UPDATE`, así que un
 * mismo `rol` bajo dos id distintos no lo absorbe el upsert y choca contra
 * `UNIQUE (rol)` con un `23505` que **detiene la cola entera**. Con el id fijo,
 * la misma fila de negocio tiene la misma llave primaria en toda instalación y
 * el choque no puede ocurrir.
 *
 * **Estos dos valores son parte del esquema**, no un detalle de este archivo:
 * los fija la migración 028 con un CHECK, y su espejo `0028` hace lo mismo en
 * Postgres. Cambiarlos rompería la correspondencia con lo ya subido.
 */
export const ID_DE_LIMITE_POR_ROL: Readonly<Record<Rol, string>> = {
  venta: '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca',
  administrativo: 'a6385986-bf18-4bb2-841d-cf154702cc1f',
};

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

    this.ejecutar(() => {
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
            id: ID_DE_LIMITE_POR_ROL[datos.rol],
            rol: datos.rol,
            porcentaje: aColumnaMonto(datos.descuentoMaxPorcentaje),
            monto: aColumnaMonto(datos.descuentoMaxMontoFijo),
            editado_por: datos.editadoPor ?? null,
            creado_en: momento,
            actualizado_en: momento,
          });
      }

    });
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

  /**
   * Quita el límite de un rol y devuelve si había alguno que quitar.
   *
   * ES UNA DE LAS POCAS OPERACIONES DEL PROYECTO QUE BORRA DE VERDAD, y se
   * sostiene por la misma razón que la limpieza del catálogo de ejemplo: esta
   * fila es CONFIGURACIÓN, no historial. Sin ella el rol vuelve a su estado de
   * fábrica —tope cero, todo descuento pide autorización— y lo que ocurrió
   * mientras estuvo puesta sigue guardado en `ventas` y en `auditoria_log`,
   * que no se tocan.
   */
  public borrarPorRol(rol: Rol): boolean {
    return this.ejecutar(() => {
      const resultado = this.base.prepare('DELETE FROM limites_descuento WHERE rol = ?').run(rol);
      return resultado.changes > 0;
    });
  }
}
