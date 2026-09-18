/** Acceso a datos de categorías. Sin lógica de negocio. */

import type { CambiosDeCategoria, Categoria, NuevaCategoria } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaBooleana, desdeColumnaBooleana } from '../decimal-columns';

/**
 * Fila de `categorias` con sus ventas sumadas. La columna `orden` viene en la
 * fila (`c.*`) y se ignora a propósito: ver `ORDEN_POR_VENTAS`.
 */
interface FilaCategoria {
  readonly id: string;
  readonly nombre: string;
  readonly activo: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
  readonly ventas: number;
}

/**
 * LA POSICIÓN DE UNA CATEGORÍA LA DECIDEN SUS VENTAS, no un número escrito a
 * mano (§4.63). Es el mismo criterio que ordena los productos en la
 * cuadrícula (`productos.listarParaVenta`): `contador_ventas DESC` y, para
 * desempatar, `nombre ASC` con la comparación binaria de SQLite. Acá se suma
 * el contador de TODOS los productos de la categoría, activos o no: un
 * producto que se dejó de vender no borra lo que la categoría ya vendió.
 *
 * El desempate es determinista porque `categorias.nombre` es UNIQUE: dos
 * categorías con las mismas ventas —cero incluido, que es el caso de toda
 * categoría nueva— salen siempre en el mismo orden.
 *
 * SUMAR EN SQL ESTÁ BIEN ACÁ, y no contradice §4.15: `contador_ventas` es un
 * INTEGER de verdad y SQLite lo suma exacto. La regla de §4.15 es para las
 * columnas decimales guardadas como TEXT.
 *
 * `categorias.orden` sigue en la tabla y se ignora: quitarla no se puede sin
 * una migración que rehaga dos índices en cada terminal y otra en la nube que
 * cambia la forma de los lotes que sube la 1.2.0 ya publicada (§4.63).
 */
const CONSULTA_CON_VENTAS = `
  SELECT c.*, COALESCE(SUM(p.contador_ventas), 0) AS ventas
    FROM categorias c
    LEFT JOIN productos p ON p.categoria_id = c.id`;
const ORDEN_POR_VENTAS = 'GROUP BY c.id ORDER BY ventas DESC, c.nombre ASC';

function aEntidad(fila: FilaCategoria): Categoria {
  return {
    id: fila.id,
    nombre: fila.nombre,
    ventas: fila.ventas,
    activo: desdeColumnaBooleana(fila.activo, 'categorias.activo'),
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDeCategorias extends RepositorioBase {
  public crear(datos: NuevaCategoria): Categoria {
    const id = nuevoId();
    const momento = ahora();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO categorias (id, nombre, activo, creado_en, actualizado_en)
           VALUES (@id, @nombre, 1, @creado_en, @actualizado_en)`,
        )
        .run({
          id,
          nombre: datos.nombre,
          creado_en: momento,
          actualizado_en: momento,
        });
    });

    const creada = this.obtenerPorId(id);
    if (creada === null) {
      throw new Error(`No se encontró la categoría recién creada con id ${id}.`);
    }
    return creada;
  }

  public obtenerPorId(id: string): Categoria | null {
    const fila = this.base
      .prepare(`${CONSULTA_CON_VENTAS} WHERE c.id = ? GROUP BY c.id`)
      .get(id) as FilaCategoria | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /**
   * TODAS las categorías, activas e inactivas.
   *
   * Es lo que necesita la pantalla de administración, donde una categoría
   * desactivada tiene que seguir viéndose para poder reactivarla. En el
   * orden de sus ventas, como en todas partes.
   */
  public listar(): Categoria[] {
    const filas = this.base
      .prepare(`${CONSULTA_CON_VENTAS} ${ORDEN_POR_VENTAS}`)
      .all() as FilaCategoria[];
    return filas.map(aEntidad);
  }

  /**
   * Solo las activas, las que más venden primero.
   *
   * Alimenta la barra de categorías de la pantalla de venta y el selector de
   * categoría al crear o editar un producto: una categoría retirada no debe
   * volver a ofrecerse.
   */
  public listarActivas(): Categoria[] {
    const filas = this.base
      .prepare(`${CONSULTA_CON_VENTAS} WHERE c.activo = 1 ${ORDEN_POR_VENTAS}`)
      .all() as FilaCategoria[];
    return filas.map(aEntidad);
  }

  /** Cambia el nombre. La posición no se edita: la deciden las ventas (§4.63). */
  public actualizar(id: string, cambios: CambiosDeCategoria): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE categorias SET nombre = ?, actualizado_en = ? WHERE id = ?')
        .run(cambios.nombre, ahora(), id);
    });
  }

  /**
   * Baja y alta lógicas. Nunca se borra: `productos.categoria_id` referencia
   * esta tabla con ON DELETE RESTRICT, así que borrar una categoría con
   * productos es imposible, y borrar una sin productos rompería el historial
   * el día que alguno vuelva a apuntarle.
   */
  public fijarActivo(id: string, activo: boolean): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE categorias SET activo = ?, actualizado_en = ? WHERE id = ?')
        .run(aColumnaBooleana(activo), ahora(), id);
    });
  }

  /** Cuántos productos apuntan a esta categoría, activos o no. */
  public contarProductos(id: string): number {
    const fila = this.base
      .prepare('SELECT count(*) AS total FROM productos WHERE categoria_id = ?')
      .get(id) as { total: number };
    return fila.total;
  }
}
