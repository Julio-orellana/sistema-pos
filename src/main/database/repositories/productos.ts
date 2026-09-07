/** Acceso a datos de productos y de su inventario acumulado. */

import type Decimal from 'decimal.js';

import type {
  CambiosDeProducto,
  NuevoProducto,
  Producto,
  TipoMedida,
  UnidadPeso,
} from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import {
  aColumnaBooleana,
  aColumnaCantidad,
  aColumnaMonto,
  desdeColumnaBooleana,
  desdeColumnaDecimal,
} from '../decimal-columns';

/** Fila cruda de la tabla `productos`. Los decimales llegan como TEXT. */
interface FilaProducto {
  readonly id: string;
  readonly nombre: string;
  readonly categoria_id: string;
  readonly foto_path: string | null;
  readonly tipo_medida: TipoMedida;
  readonly unidad_peso: UnidadPeso | null;
  readonly cantidad_predefinida_icono: string;
  readonly precio_base: string;
  readonly inventario_disponible: string;
  readonly contador_ventas: number;
  readonly activo: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaProducto): Producto {
  return {
    id: fila.id,
    nombre: fila.nombre,
    categoriaId: fila.categoria_id,
    fotoPath: fila.foto_path,
    tipoMedida: fila.tipo_medida,
    unidadPeso: fila.unidad_peso,
    cantidadPredefinidaIcono: desdeColumnaDecimal(
      fila.cantidad_predefinida_icono,
      'productos.cantidad_predefinida_icono',
    ),
    precioBase: desdeColumnaDecimal(fila.precio_base, 'productos.precio_base'),
    inventarioDisponible: desdeColumnaDecimal(
      fila.inventario_disponible,
      'productos.inventario_disponible',
    ),
    contadorVentas: fila.contador_ventas,
    activo: desdeColumnaBooleana(fila.activo, 'productos.activo'),
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDeProductos extends RepositorioBase {
  public crear(datos: NuevoProducto): Producto {
    const id = nuevoId();
    const momento = ahora();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO productos (
             id, nombre, categoria_id, foto_path, tipo_medida, unidad_peso,
             cantidad_predefinida_icono, precio_base, inventario_disponible,
             contador_ventas, activo, creado_en, actualizado_en
           ) VALUES (
             @id, @nombre, @categoria_id, @foto_path, @tipo_medida, @unidad_peso,
             @cantidad_predefinida_icono, @precio_base, @inventario_disponible,
             0, @activo, @creado_en, @actualizado_en
           )`,
        )
        .run({
          id,
          nombre: datos.nombre,
          categoria_id: datos.categoriaId,
          foto_path: datos.fotoPath ?? null,
          tipo_medida: datos.tipoMedida,
          unidad_peso: datos.unidadPeso ?? null,
          cantidad_predefinida_icono: aColumnaCantidad(datos.cantidadPredefinidaIcono),
          precio_base: aColumnaMonto(datos.precioBase),
          inventario_disponible: aColumnaCantidad(datos.inventarioDisponible),
          activo: aColumnaBooleana(datos.activo ?? true),
          creado_en: momento,
          actualizado_en: momento,
        });
    });

    const creado = this.obtenerPorId(id);
    if (creado === null) {
      throw new Error(`No se encontró el producto recién creado con id ${id}.`);
    }
    return creado;
  }

  public obtenerPorId(id: string): Producto | null {
    const fila = this.base.prepare('SELECT * FROM productos WHERE id = ?').get(id) as
      | FilaProducto
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /**
   * TODOS los productos, activos e inactivos.
   *
   * Es lo que necesita la pantalla de administración: un producto desactivado
   * tiene que seguir viéndose para poder consultarlo o reactivarlo. La
   * pantalla de venta usa `listarActivos`.
   */
  public listarTodos(): Producto[] {
    const filas = this.base
      .prepare('SELECT * FROM productos ORDER BY nombre')
      .all() as FilaProducto[];
    return filas.map(aEntidad);
  }

  public listarActivos(): Producto[] {
    const filas = this.base
      .prepare('SELECT * FROM productos WHERE activo = 1 ORDER BY nombre')
      .all() as FilaProducto[];
    return filas.map(aEntidad);
  }

  public listarPorCategoria(categoriaId: string): Producto[] {
    const filas = this.base
      .prepare('SELECT * FROM productos WHERE categoria_id = ? AND activo = 1 ORDER BY nombre')
      .all(categoriaId) as FilaProducto[];
    return filas.map(aEntidad);
  }

  /** Los más vendidos primero: es el orden de los íconos en la caja. */
  public listarMasVendidos(limite: number): Producto[] {
    const filas = this.base
      .prepare(
        'SELECT * FROM productos WHERE activo = 1 ORDER BY contador_ventas DESC, nombre LIMIT ?',
      )
      .all(limite) as FilaProducto[];
    return filas.map(aEntidad);
  }

  /**
   * Edita los datos de catálogo de un producto.
   *
   * NO toca `inventario_disponible` ni `contador_ventas`, y no es un olvido:
   * el saldo se mueve con `fijarInventario`, desde la operación de ajuste, que
   * deja su propio asiento de auditoría. Si la edición pudiera cambiarlo,
   * entraría mercadería sin que quedara constancia de que entró.
   */
  public actualizar(id: string, cambios: CambiosDeProducto): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE productos
              SET nombre = @nombre,
                  categoria_id = @categoria_id,
                  foto_path = @foto_path,
                  tipo_medida = @tipo_medida,
                  unidad_peso = @unidad_peso,
                  cantidad_predefinida_icono = @cantidad_predefinida_icono,
                  precio_base = @precio_base,
                  actualizado_en = @actualizado_en
            WHERE id = @id`,
        )
        .run({
          id,
          nombre: cambios.nombre,
          categoria_id: cambios.categoriaId,
          foto_path: cambios.fotoPath,
          tipo_medida: cambios.tipoMedida,
          unidad_peso: cambios.unidadPeso,
          cantidad_predefinida_icono: aColumnaCantidad(cambios.cantidadPredefinidaIcono),
          precio_base: aColumnaMonto(cambios.precioBase),
          actualizado_en: ahora(),
        });
    });
  }

  /**
   * Fija el saldo de inventario a un valor exacto.
   *
   * El repositorio no decide cuánto queda: recibe el saldo ya calculado por el
   * módulo de inventario con aritmética de Decimal.js. Aquí no se hace ninguna
   * suma ni resta en SQL sobre un valor decimal, porque SQL trabajaría con
   * punto flotante y arruinaría la exactitud.
   */
  public fijarInventario(id: string, nuevoSaldo: Decimal | string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE productos SET inventario_disponible = ?, actualizado_en = ? WHERE id = ?')
        .run(aColumnaCantidad(nuevoSaldo), ahora(), id);
    });
  }

  public actualizarPrecioBase(id: string, precio: Decimal | string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE productos SET precio_base = ?, actualizado_en = ? WHERE id = ?')
        .run(aColumnaMonto(precio), ahora(), id);
    });
  }

  /**
   * Suma uno al contador de ventas del producto.
   *
   * Es un entero, no un decimal, así que sí puede incrementarse en SQL. DEBE
   * llamarse dentro de la MISMA transacción que registra la venta: si se hace
   * en una operación aparte y esa falla, el orden de los íconos deja de
   * corresponder a lo que realmente se vendió.
   */
  public incrementarContadorVentas(id: string): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          'UPDATE productos SET contador_ventas = contador_ventas + 1, actualizado_en = ? WHERE id = ?',
        )
        .run(ahora(), id);
    });
  }

  /** Baja lógica: nunca se borra, porque las ventas históricas lo referencian. */
  public desactivar(id: string): void {
    this.fijarActivo(id, false);
  }

  /**
   * Baja o alta lógica. Un producto desactivado desaparece de la pantalla de
   * venta pero conserva su historial: `venta_detalle` lo referencia, y además
   * guarda una foto de su nombre y su precio, así que las ventas viejas se
   * reimprimen igual aunque el producto ya no se venda.
   */
  public fijarActivo(id: string, activo: boolean): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE productos SET activo = ?, actualizado_en = ? WHERE id = ?')
        .run(aColumnaBooleana(activo), ahora(), id);
    });
  }
}
