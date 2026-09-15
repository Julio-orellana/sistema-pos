/** Acceso a datos de categorías. Sin lógica de negocio. */

import type { CambiosDeCategoria, Categoria, NuevaCategoria } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaBooleana, desdeColumnaBooleana } from '../decimal-columns';

/** Fila cruda de la tabla `categorias`. */
interface FilaCategoria {
  readonly id: string;
  readonly nombre: string;
  readonly orden: number;
  readonly activo: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaCategoria): Categoria {
  return {
    id: fila.id,
    nombre: fila.nombre,
    orden: fila.orden,
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
          `INSERT INTO categorias (id, nombre, orden, activo, creado_en, actualizado_en)
           VALUES (@id, @nombre, @orden, 1, @creado_en, @actualizado_en)`,
        )
        .run({
          id,
          nombre: datos.nombre,
          orden: datos.orden ?? 0,
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
    const fila = this.base.prepare('SELECT * FROM categorias WHERE id = ?').get(id) as
      | FilaCategoria
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /**
   * TODAS las categorías, activas e inactivas.
   *
   * Es lo que necesita la pantalla de administración, donde una categoría
   * desactivada tiene que seguir viéndose para poder reactivarla.
   */
  public listar(): Categoria[] {
    const filas = this.base
      .prepare('SELECT * FROM categorias ORDER BY orden, nombre')
      .all() as FilaCategoria[];
    return filas.map(aEntidad);
  }

  /**
   * Solo las activas, en su orden de presentación.
   *
   * Es lo que alimenta el selector de categoría al crear o editar un producto:
   * una categoría retirada no debe volver a ofrecerse.
   */
  public listarActivas(): Categoria[] {
    const filas = this.base
      .prepare('SELECT * FROM categorias WHERE activo = 1 ORDER BY orden, nombre')
      .all() as FilaCategoria[];
    return filas.map(aEntidad);
  }

  /** Cambia nombre y orden en una sola escritura. */
  public actualizar(id: string, cambios: CambiosDeCategoria): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          'UPDATE categorias SET nombre = ?, orden = ?, actualizado_en = ? WHERE id = ?',
        )
        .run(cambios.nombre, cambios.orden, ahora(), id);
    });
  }

  public cambiarOrden(id: string, orden: number): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE categorias SET orden = ?, actualizado_en = ? WHERE id = ?')
        .run(orden, ahora(), id);
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
