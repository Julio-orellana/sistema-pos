/**
 * Módulo de catálogo: categorías.
 *
 * Una categoría agrupa productos en la pantalla de venta. Aquí viven las
 * reglas que el repositorio no conoce:
 *
 *   · el nombre no puede estar vacío ni repetirse,
 *   · el orden es un entero no negativo,
 *   · una categoría NUNCA se borra, solo se desactiva.
 *
 * POR QUÉ NUNCA SE BORRA: `productos.categoria_id` la referencia con
 * ON DELETE RESTRICT, así que en cuanto tenga un producto la base impide
 * borrarla; y borrar una vacía tampoco conviene, porque el día que un producto
 * histórico vuelva a apuntarle quedaría una referencia rota. Desactivar
 * resuelve el caso real —"esta categoría ya no se usa"— sin tocar nada más.
 *
 * QUÉ NO HACE desactivar una categoría: no desactiva sus productos, no los
 * mueve de categoría y no los saca de la venta. Solo deja de ofrecerse como
 * opción al crear o editar un producto. Confundir las dos cosas retiraría
 * mercadería de la venta sin que nadie lo haya pedido.
 */

import { ErrorDeNegocio } from '@main/database/errores';
import type { Categoria } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeCategorias } from '@main/database/repositories/categorias';

/** Acciones de categoría que quedan en la bitácora de auditoría. */
export const ACCIONES_DE_CATEGORIA = {
  creada: 'categoria_creada',
  editada: 'categoria_editada',
  desactivada: 'categoria_desactivada',
  reactivada: 'categoria_reactivada',
} as const;

/** Largo máximo del nombre de una categoría. */
const LARGO_MAXIMO_DEL_NOMBRE = 60;

/** Datos con los que se crea o se edita una categoría. */
export interface DatosDeCategoria {
  readonly nombre: string;
  readonly orden: number;
}

/** Dependencias del servicio. */
export interface DependenciasDeCategorias {
  readonly categorias: RepositorioDeCategorias;
  readonly auditoria: RepositorioDeAuditoria;
  readonly ahora?: () => number;
}

export class ServicioDeCategorias {
  private readonly categorias: RepositorioDeCategorias;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeCategorias) {
    this.categorias = dependencias.categorias;
    this.auditoria = dependencias.auditoria;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * Normaliza y valida los datos ANTES de tocar la base.
   *
   * La base también los rechazaría, pero su mensaje sería
   * "CHECK constraint failed: categorias", que no le dice nada a quien está
   * cargando el catálogo. La restricción sigue ahí como última red.
   */
  private validar(datos: DatosDeCategoria): DatosDeCategoria {
    const nombre = datos.nombre.trim();

    if (nombre.length === 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'La categoría necesita un nombre.',
        'nombre vacío o solo espacios.',
      );
    }
    if (nombre.length > LARGO_MAXIMO_DEL_NOMBRE) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El nombre de la categoría no puede pasar de ${String(LARGO_MAXIMO_DEL_NOMBRE)} caracteres.`,
        `nombre de ${String(nombre.length)} caracteres.`,
      );
    }
    if (!Number.isInteger(datos.orden) || datos.orden < 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El orden de la categoría debe ser un número entero de 0 en adelante.',
        `orden recibido: ${String(datos.orden)}`,
      );
    }

    return { nombre, orden: datos.orden };
  }

  /**
   * Comprueba que el nombre no lo tenga ya otra categoría.
   *
   * La base tiene un UNIQUE que lo garantiza; esto existe para dar el mensaje
   * de negocio en vez de "UNIQUE constraint failed: categorias.nombre", y para
   * poder decir que la que lo ocupa está desactivada, que es la confusión
   * probable: el nombre "no aparece" en pantalla pero sigue tomado.
   */
  private exigirNombreLibre(nombre: string, exceptoId: string | null): void {
    const enConflicto = this.categorias
      .listar()
      .find(
        (categoria) =>
          categoria.id !== exceptoId &&
          categoria.nombre.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'),
      );

    if (enConflicto === undefined) {
      return;
    }

    const aclaracion = enConflicto.activo
      ? ''
      : ' Esa categoría está desactivada: reactivala en vez de crear otra igual.';

    throw new ErrorDeNegocio(
      'REGISTRO_DUPLICADO',
      `Ya existe una categoría llamada "${enConflicto.nombre}".${aclaracion}`,
      `nombre en conflicto con la categoría ${enConflicto.id}.`,
    );
  }

  /** Busca una categoría o falla con un mensaje de negocio. */
  private exigirCategoria(id: string): Categoria {
    const categoria = this.categorias.obtenerPorId(id);
    if (categoria === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'Esa categoría no existe.',
        `categoria_id inexistente: ${id}`,
      );
    }
    return categoria;
  }

  public crear(usuarioId: string, datos: DatosDeCategoria): Categoria {
    const validos = this.validar(datos);
    this.exigirNombreLibre(validos.nombre, null);

    const creada = this.categorias.crear(validos);

    this.auditoria.registrar({
      usuarioId,
      accion: ACCIONES_DE_CATEGORIA.creada,
      entidadTipo: 'categorias',
      entidadId: creada.id,
      valorNuevo: { nombre: creada.nombre, orden: creada.orden },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return creada;
  }

  public editar(usuarioId: string, id: string, datos: DatosDeCategoria): Categoria {
    const anterior = this.exigirCategoria(id);
    const validos = this.validar(datos);
    this.exigirNombreLibre(validos.nombre, id);

    this.categorias.actualizar(id, validos);

    this.auditoria.registrar({
      usuarioId,
      accion: ACCIONES_DE_CATEGORIA.editada,
      entidadTipo: 'categorias',
      entidadId: id,
      valorAnterior: { nombre: anterior.nombre, orden: anterior.orden },
      valorNuevo: validos,
      fecha: new Date(this.ahora()).toISOString(),
    });

    return this.exigirCategoria(id);
  }

  /**
   * Desactiva o reactiva. Nunca borra.
   *
   * Se informa cuántos productos quedan apuntando a la categoría desactivada:
   * no impide la operación —esos productos siguen vendiéndose, que es lo
   * correcto— pero es el dato que quien administra el catálogo necesita ver
   * para no llevarse una sorpresa.
   */
  public fijarActivo(usuarioId: string, id: string, activo: boolean): Categoria {
    const anterior = this.exigirCategoria(id);

    if (anterior.activo === activo) {
      return anterior;
    }

    this.categorias.fijarActivo(id, activo);

    this.auditoria.registrar({
      usuarioId,
      accion: activo
        ? ACCIONES_DE_CATEGORIA.reactivada
        : ACCIONES_DE_CATEGORIA.desactivada,
      entidadTipo: 'categorias',
      entidadId: id,
      valorAnterior: { activo: anterior.activo },
      valorNuevo: {
        activo,
        nombre: anterior.nombre,
        productosQueLaSiguenUsando: this.categorias.contarProductos(id),
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return this.exigirCategoria(id);
  }

  /** Para el selector al crear o editar un producto: solo las vigentes. */
  public listarActivas(): readonly Categoria[] {
    return this.categorias.listarActivas();
  }

  /** Para la pantalla de administración: también las desactivadas. */
  public listarTodas(): readonly Categoria[] {
    return this.categorias.listar();
  }

  /** Cuántos productos apuntan a una categoría. Lo muestra la administración. */
  public contarProductos(id: string): number {
    return this.categorias.contarProductos(id);
  }
}
