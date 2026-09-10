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
  readonly cantidad_vendida: string;
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
    cantidadVendida: desdeColumnaDecimal(fila.cantidad_vendida, 'productos.cantidad_vendida'),
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

  /**
   * Los productos que se pueden vender hoy, EN EL ORDEN DE LA CUADRÍCULA.
   *
   * `contador_ventas DESC` pone arriba lo que más se mueve, que es lo que el
   * cajero busca primero. `nombre ASC` desempata, y no es decorativo: sin él,
   * con todos los contadores en cero —que es el estado de hoy, porque nada
   * incrementa ese campo todavía— SQLite podría devolver las filas en
   * cualquier orden y la cuadrícula se reacomodaría sola entre recargas. Es el
   * mismo criterio de «nunca dejar un orden ambiguo» del reparto de centavos.
   *
   * El desempate usa la comparación binaria de SQLite, que ordena por punto de
   * código: determinista, aunque ponga 'Ñ' después de 'Z'. Lo que importa aquí
   * es que dos corridas den siempre lo mismo.
   */
  public listarParaVenta(): Producto[] {
    const filas = this.base
      .prepare(
        `SELECT * FROM productos
          WHERE activo = 1
          ORDER BY contador_ventas DESC, nombre ASC`,
      )
      .all() as FilaProducto[];
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

  /**
   * COMPARAR-Y-CAMBIAR del inventario. Es el patrón de CLAUDE.md §4.3, que
   * estaba documentado pero no escrito hasta ahora.
   *
   * Solo actualiza si el saldo sigue siendo EXACTAMENTE el que se leyó. Si
   * entre la lectura y la escritura alguien lo movió, no toca nada y devuelve
   * `false`: quien llama debe abortar la transacción entera.
   *
   * POR QUÉ NO SE RESTA EN SQL, que sería lo evidente: `inventario_disponible`
   * es TEXT, así que `columna - :cantidad` obligaría a SQLite a convertir
   * ambos a REAL y hacer aritmética de punto flotante —justo lo que money.ts
   * existe para evitar—, y el resultado ni siquiera pasaría el CHECK de forma
   * canónica. El saldo nuevo se calcula afuera con Decimal.js y entra ya hecho.
   *
   * La comparación es de CADENAS canónicas, que es exacta: dos saldos iguales
   * tienen siempre la misma representación de tres decimales.
   */
  public descontarSiSigueIgual(
    id: string,
    saldoQueSeLeyo: Decimal | string,
    saldoNuevo: Decimal | string,
  ): boolean {
    return this.ejecutar(() => {
      const resultado = this.base
        .prepare(
          `UPDATE productos
              SET inventario_disponible = @saldo_nuevo,
                  actualizado_en = @actualizado_en
            WHERE id = @id
              AND inventario_disponible = @saldo_leido`,
        )
        .run({
          id,
          saldo_nuevo: aColumnaCantidad(saldoNuevo),
          saldo_leido: aColumnaCantidad(saldoQueSeLeyo),
          actualizado_en: ahora(),
        });
      return resultado.changes === 1;
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
   * Anota que el producto se vendió: una vez más, y tanta cantidad más.
   *
   * LAS DOS MEDIDAS SUBEN EN UN SOLO UPDATE, a propósito. Son dos preguntas
   * distintas —cuántas veces se vendió y cuánta mercadería salió— y separarlas
   * en dos llamadas dejaría abierta la posibilidad de mover una sin la otra.
   *
   * `contador_ventas` es INTEGER, así que se incrementa en SQL sin riesgo.
   * `cantidad_vendida` es TEXT canónico: el valor nuevo se calcula ACÁ con
   * Decimal.js y entra ya hecho, por la misma razón que el inventario (§4.3);
   * `columna + :cantidad` obligaría a SQLite a convertir a REAL y haría
   * aritmética de punto flotante.
   *
   * Como el saldo nuevo se calcula a partir del que se leyó, se escribe con la
   * MISMA condición de comparar-y-cambiar del inventario: si alguien movió el
   * acumulado entremedio, el UPDATE no afecta ninguna fila y quien llama se
   * entera. DEBE ejecutarse dentro de la misma transacción que registra la
   * venta: si corriera aparte y esa fallara, el orden de los íconos dejaría de
   * corresponder a lo que realmente se vendió.
   *
   * Devuelve `false` si no afectó exactamente una fila.
   */
  public registrarVentaDeProducto(
    id: string,
    cantidadQueSeLeyo: Decimal | string,
    cantidadNueva: Decimal | string,
  ): boolean {
    return this.ejecutar(() => {
      const resultado = this.base
        .prepare(
          `UPDATE productos
              SET contador_ventas = contador_ventas + 1,
                  cantidad_vendida = @cantidad_nueva,
                  actualizado_en = @actualizado_en
            WHERE id = @id
              AND cantidad_vendida = @cantidad_leida`,
        )
        .run({
          id,
          cantidad_nueva: aColumnaCantidad(cantidadNueva),
          cantidad_leida: aColumnaCantidad(cantidadQueSeLeyo),
          actualizado_en: ahora(),
        });
      return resultado.changes === 1;
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
