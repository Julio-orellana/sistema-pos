/** Acceso a datos de categorías. Sin lógica de negocio. */

import type { Categoria, NuevaCategoria } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';

/** Fila cruda de la tabla `categorias`. */
interface FilaCategoria {
  readonly id: string;
  readonly nombre: string;
  readonly orden: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaCategoria): Categoria {
  return {
    id: fila.id,
    nombre: fila.nombre,
    orden: fila.orden,
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
          `INSERT INTO categorias (id, nombre, orden, creado_en, actualizado_en)
           VALUES (@id, @nombre, @orden, @creado_en, @actualizado_en)`,
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

  /** Ordenadas como se muestran en la pantalla de venta. */
  public listar(): Categoria[] {
    const filas = this.base
      .prepare('SELECT * FROM categorias ORDER BY orden, nombre')
      .all() as FilaCategoria[];
    return filas.map(aEntidad);
  }

  public cambiarOrden(id: string, orden: number): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE categorias SET orden = ?, actualizado_en = ? WHERE id = ?')
        .run(orden, ahora(), id);
    });
  }
}
