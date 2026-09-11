/**
 * Los tres reportes: resumen de ventas, ventas por producto e inventario.
 *
 * ===========================================================================
 * LA REGLA QUE GOBIERNA TODO ESTE MÓDULO
 * ===========================================================================
 *
 * **NINGÚN REPORTE AGREGA NI ORDENA EN SQL SOBRE UNA COLUMNA DECIMAL.** Se
 * traen las filas con un `SELECT` normal —filtrando por fecha, estado o
 * `activo`, que son texto y enteros de verdad— y se suma y se ordena acá, con
 * Decimal.js. Las dos mitades de la regla están MEDIDAS, no supuestas:
 *
 * | Lo que se evita | Qué devuelve SQLite | Qué es lo correcto |
 * |---|---|---|
 * | `SUM()` sobre TEXT canónico | `13.459999999999999` | `13.47` |
 * | `ORDER BY` sobre TEXT canónico | `10.000 100.000 2.500 85.000 9.000` | `2.500 9.000 10.000 85.000 100.000` |
 * | `MIN()` sobre TEXT canónico | `10.000` | `2.500` |
 *
 * El primer caso es el que CLAUDE.md §5 viene señalando desde el principio:
 * la columna es TEXT, SQLite la convierte a REAL para poder sumarla y
 * reaparece el punto flotante que `money.ts` existe para eliminar, ahora
 * escondido dentro de un reporte que nadie audita línea por línea como sí se
 * audita una venta.
 *
 * **El segundo caso es más traicionero todavía y no estaba anotado en ninguna
 * parte.** SQLite compara TEXT byte a byte, así que `'10.000'` va antes que
 * `'2.500'` porque `'1' < '2'`. En el reporte de inventario, que se ordena
 * ascendente justamente **para ver primero lo que menos queda**, ordenar en SQL
 * habría puesto 10 libras antes que 2.5: exactamente al revés de para lo que
 * sirve el reporte, y sin ningún síntoma visible. Hay una prueba que mide las
 * dos cosas y falla si algún día SQLite cambiara de comportamiento.
 *
 * ===========================================================================
 *
 * TODO SE FILTRA POR `estado = 'completada'`, explícito, aunque hoy nada
 * produzca ventas anuladas. Es una precaución con nombre: el día que exista el
 * módulo de anulación, ningún reporte tiene que acordarse de agregar el filtro.
 */

import type Decimal from 'decimal.js';

import {
  CERO,
  cantidadACadena,
  cantidadLegible,
  comparar,
  montoACadena,
  sumarLista,
} from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import type { Producto } from '@main/database/repositories/entidades';
import type { RepositorioDeCategorias } from '@main/database/repositories/categorias';
import type { RepositorioDeProductos } from '@main/database/repositories/productos';
import type { RepositorioDeVentaDetalle } from '@main/database/repositories/venta-detalle';
import type { RepositorioDeVentas } from '@main/database/repositories/ventas';
import {
  ErrorDePeriodo,
  resolverPeriodo,
  type PeriodoPedido,
  type PeriodoResuelto,
} from './periodo';

/** Cómo se puede ordenar el reporte de inventario. */
export type OrdenDeInventario = 'nombre' | 'cantidad';

/** El resumen de ventas de un período. Todos los montos, como cadena canónica. */
export interface ResumenDeVentas {
  readonly periodo: PeriodoResuelto;
  /** Suma de `ventas.total` de las ventas completadas. */
  readonly totalVendido: string;
  /** Cuántas transacciones, no cuántos artículos. */
  readonly cantidadDeVentas: number;
  readonly totalEnEfectivo: string;
  readonly totalEnTarjeta: string;
  readonly ventasEnEfectivo: number;
  readonly ventasEnTarjeta: number;
  /**
   * Suma de `ventas.descuento_valor` donde no es nulo.
   *
   * **ES UNA REFERENCIA, NO UNA PARTE DEL CÁLCULO.** Ver `descuentosAplicados`.
   */
  readonly totalDeDescuentos: string;
  /** Cuántas ventas llevaron descuento discrecional. */
  readonly ventasConDescuento: number;
}

/** Una fila del reporte de ventas por producto. */
export interface VentasDeUnProducto {
  readonly productoId: string;
  readonly nombre: string;
  readonly unidad: string;
  /**
   * Cantidad vendida EN EL PERÍODO, no el acumulado histórico.
   *
   * Sin ceros decorativos, igual que en el recibo: «2 u» y no «2.000 u».
   */
  readonly cantidadVendida: string;
  /** Suma de `subtotal_impreso` de sus líneas en el período. */
  readonly montoGenerado: string;
  /** En cuántas ventas distintas apareció. */
  readonly vecesVendido: number;
}

/** El reporte de ventas por producto, ya ordenado. */
export interface ReporteDeVentasPorProducto {
  readonly periodo: PeriodoResuelto;
  readonly productos: readonly VentasDeUnProducto[];
  /** Suma de los montos de todos los productos. Cuadra con el reporte 1. */
  readonly montoTotal: string;
}

/** Una fila del reporte de inventario. */
export interface InventarioDeUnProducto {
  readonly productoId: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly unidad: string;
  readonly inventarioDisponible: string;
}

/** La fotografía del inventario. */
export interface ReporteDeInventario {
  readonly productos: readonly InventarioDeUnProducto[];
  readonly orden: OrdenDeInventario;
  /** Cuántos productos activos hay. */
  readonly total: number;
}

/** Dependencias del servicio. */
export interface DependenciasDeReportes {
  readonly ventas: RepositorioDeVentas;
  readonly ventaDetalle: RepositorioDeVentaDetalle;
  readonly productos: RepositorioDeProductos;
  readonly categorias: RepositorioDeCategorias;
  readonly ahora?: () => number;
}

export class ServicioDeReportes {
  private readonly ventas: RepositorioDeVentas;
  private readonly ventaDetalle: RepositorioDeVentaDetalle;
  private readonly productos: RepositorioDeProductos;
  private readonly categorias: RepositorioDeCategorias;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeReportes) {
    this.ventas = dependencias.ventas;
    this.ventaDetalle = dependencias.ventaDetalle;
    this.productos = dependencias.productos;
    this.categorias = dependencias.categorias;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  // =========================================================================
  // Tarea 1 — Resumen de ventas por período
  // =========================================================================

  /**
   * Cuánto se vendió en un período, y cómo se pagó.
   *
   * EFECTIVO + TARJETA TIENE QUE DAR EXACTAMENTE EL TOTAL, y no es una
   * coincidencia aritmética que convenga dar por sentada: cada venta aporta su
   * total a uno solo de los dos montones, y las tres sumas se hacen con
   * Decimal.js sobre los mismos valores guardados. Hay una prueba que lo exige
   * en varios casos, incluido uno con montos que en punto flotante no cerrarían.
   */
  public resumenDeVentas(pedido: PeriodoPedido): ResumenDeVentas {
    const periodo = this.periodo(pedido);
    const ventas = this.ventas.listarCompletadasEnRango(periodo.desdeIso, periodo.hastaIso);

    const enEfectivo = ventas.filter((venta) => venta.formaPago === 'efectivo');
    const conTarjeta = ventas.filter((venta) => venta.formaPago === 'tarjeta');

    /*
      LOS DESCUENTOS SE INFORMAN, NO SE RESTAN. `ventas.total` ya viene con el
      descuento aplicado —lo aplicó la transacción de la venta, una sola vez, y
      es lo que el cliente pagó—, así que restarlo otra vez acá lo contaría dos
      veces. Este número contesta otra pregunta: cuánto se dejó de cobrar.
    */
    const descuentos = ventas
      .map((venta) => venta.descuentoValor)
      .filter((valor): valor is Decimal => valor !== null);

    return {
      periodo,
      totalVendido: montoACadena(sumarLista(ventas.map((venta) => venta.total))),
      cantidadDeVentas: ventas.length,
      totalEnEfectivo: montoACadena(sumarLista(enEfectivo.map((venta) => venta.total))),
      totalEnTarjeta: montoACadena(sumarLista(conTarjeta.map((venta) => venta.total))),
      ventasEnEfectivo: enEfectivo.length,
      ventasEnTarjeta: conTarjeta.length,
      totalDeDescuentos: montoACadena(sumarLista(descuentos)),
      ventasConDescuento: descuentos.length,
    };
  }

  // =========================================================================
  // Tarea 2 — Ventas por producto
  // =========================================================================

  /**
   * Qué se vendió y cuánto generó cada producto, EN EL PERÍODO ELEGIDO.
   *
   * ## POR QUÉ NO SE REUSAN `contador_ventas` NI `cantidad_vendida`
   *
   * Las dos columnas existen, suben con cada venta y guardan exactamente estas
   * dos medidas. Y aun así **no sirven para este reporte**, porque contestan
   * una pregunta distinta:
   *
   * | | `productos.contador_ventas` / `cantidad_vendida` | Este reporte |
   * |---|---|---|
   * | Qué abarca | **Toda la vida del producto**, desde que se dio de alta | **Un período elegido** |
   * | Para qué existe | Ordenar la cuadrícula de la pantalla de venta (§4.12) | Analizar un mes, una semana, un día |
   * | Se puede acotar | **No.** Son acumuladores; nadie guarda su valor al inicio del período | Sí: se recorre `venta_detalle` |
   *
   * Usarlas acá daría el acumulado histórico bajo una etiqueta que dice «este
   * mes», que es la clase de error que no se ve mirando el número: se ve recién
   * cuando alguien suma los reportes de doce meses y no dan el año. Comparten
   * los datos de origen, pero no son la misma pregunta.
   *
   * ## El nombre que se muestra es el ACTUAL, no el del comprobante
   *
   * `venta_detalle.producto_nombre_snap` guarda el nombre que tenía el producto
   * al vender, y el recibo usa ese —es un documento histórico y no puede
   * cambiar—. Acá es al revés a propósito: quien lee el reporte está mirando el
   * catálogo de hoy y busca el producto por el nombre que hoy tiene. Si un
   * producto se renombró, sus ventas viejas y nuevas se suman bajo el nombre
   * nuevo, que es lo que el administrador espera. Se agrupa por `producto_id`,
   * no por nombre, así que renombrar nunca parte un producto en dos filas.
   */
  public ventasPorProducto(pedido: PeriodoPedido): ReporteDeVentasPorProducto {
    const periodo = this.periodo(pedido);
    const lineas = this.ventaDetalle.listarDeVentasCompletadasEnRango(
      periodo.desdeIso,
      periodo.hastaIso,
    );

    /** Lo que se va juntando por producto, antes de sumar. */
    interface Acumulado {
      readonly cantidades: Decimal[];
      readonly montos: Decimal[];
      readonly ventas: Set<string>;
      unidad: string;
      nombreDeRespaldo: string;
    }

    const porProducto = new Map<string, Acumulado>();
    for (const linea of lineas) {
      const acumulado = porProducto.get(linea.productoId) ?? {
        cantidades: [],
        montos: [],
        ventas: new Set<string>(),
        unidad: linea.unidadSnap,
        nombreDeRespaldo: linea.productoNombreSnap,
      };
      acumulado.cantidades.push(linea.cantidad);
      acumulado.montos.push(linea.subtotalImpreso);
      acumulado.ventas.add(linea.ventaId);
      // La unidad y el nombre de respaldo quedan los de la línea MÁS RECIENTE
      // del período, que es la foto más parecida a la realidad de hoy.
      acumulado.unidad = linea.unidadSnap;
      acumulado.nombreDeRespaldo = linea.productoNombreSnap;
      porProducto.set(linea.productoId, acumulado);
    }

    const productos: VentasDeUnProducto[] = [...porProducto.entries()].map(
      ([productoId, acumulado]) => {
        const actual = this.productos.obtenerPorId(productoId);
        return {
          productoId,
          // El nombre de hoy; el del comprobante solo si el producto ya no está.
          nombre: actual?.nombre ?? acumulado.nombreDeRespaldo,
          unidad: acumulado.unidad,
          cantidadVendida: cantidadLegible(sumarLista(acumulado.cantidades)),
          montoGenerado: montoACadena(sumarLista(acumulado.montos)),
          vecesVendido: acumulado.ventas.size,
        };
      },
    );

    /*
      ORDEN POR MONTO GENERADO, DESCENDENTE, comparado con Decimal y no con
      `Number()`. Se desempata por NOMBRE, igual que la cuadrícula de venta
      (§4.12): sin desempate, dos productos con el mismo monto podrían
      intercambiarse entre dos ejecuciones del mismo reporte y quien lo lea dos
      veces vería dos órdenes distintos sin que nada haya cambiado.
    */
    productos.sort((izquierda, derecha) => {
      const porMonto = comparar(derecha.montoGenerado, izquierda.montoGenerado);
      return porMonto !== 0 ? porMonto : izquierda.nombre.localeCompare(derecha.nombre, 'es');
    });

    return {
      periodo,
      productos,
      montoTotal: montoACadena(sumarLista(productos.map((fila) => fila.montoGenerado))),
    };
  }

  // =========================================================================
  // Tarea 3 — Estado de inventario
  // =========================================================================

  /**
   * La fotografía del inventario de hoy. Solo productos activos.
   *
   * NO HAY UMBRAL DE «STOCK BAJO» NI ALERTAS, y es deliberado: cuál es el
   * mínimo de cada producto es una definición de negocio que Jimmy no dio, y
   * un umbral inventado convertiría una suposición nuestra en un aviso que
   * parece una regla de la tienda. Es un módulo futuro con su propio prompt.
   *
   * EL ORDEN SE HACE ACÁ, NUNCA EN SQL. `inventario_disponible` es TEXT
   * canónico: ordenarlo en la base sería un orden alfabético, y pondría 10
   * libras antes que 2.5. Ver la cabecera del módulo, donde está medido.
   */
  public inventario(orden: OrdenDeInventario): ReporteDeInventario {
    const activos = this.productos.listarActivos();
    const nombresDeCategoria = new Map(
      this.categorias.listar().map((categoria) => [categoria.id, categoria.nombre]),
    );

    const filas: InventarioDeUnProducto[] = activos.map((producto) => ({
      productoId: producto.id,
      nombre: producto.nombre,
      categoria: nombresDeCategoria.get(producto.categoriaId) ?? '(sin categoría)',
      unidad: unidadDe(producto),
      inventarioDisponible: cantidadACadena(producto.inventarioDisponible),
    }));

    if (orden === 'cantidad') {
      /*
        ASCENDENTE: primero lo que menos queda, que es para lo que se mira este
        reporte. El desempate por nombre vuelve a ser el de siempre: un catálogo
        recién cargado tiene muchos productos en el mismo saldo.
      */
      filas.sort((izquierda, derecha) => {
        const porCantidad = comparar(
          izquierda.inventarioDisponible,
          derecha.inventarioDisponible,
        );
        return porCantidad !== 0 ? porCantidad : izquierda.nombre.localeCompare(derecha.nombre, 'es');
      });
    } else {
      filas.sort((izquierda, derecha) => izquierda.nombre.localeCompare(derecha.nombre, 'es'));
    }

    return { productos: filas, orden, total: filas.length };
  }

  // =========================================================================

  /** Resuelve el período y traduce su error al del resto del sistema. */
  private periodo(pedido: PeriodoPedido): PeriodoResuelto {
    try {
      return resolverPeriodo(pedido, this.ahora());
    } catch (error) {
      if (error instanceof ErrorDePeriodo) {
        throw new ErrorDeNegocio('DATO_INVALIDO', error.message, 'Período mal formado.');
      }
      throw error;
    }
  }
}

/** La unidad en que se mide un producto, como se lee en el reporte. */
function unidadDe(producto: Producto): string {
  return producto.tipoMedida === 'peso' ? (producto.unidadPeso ?? 'lb') : 'u';
}

/** Cero como cadena canónica de monto, para los reportes vacíos. */
export const MONTO_CERO = montoACadena(CERO);
