/**
 * Datos de ejemplo del catálogo — HERRAMIENTA DE DESARROLLO, NO UNA MIGRACIÓN.
 *
 * POR QUÉ NO ES UNA MIGRACIÓN, que es la confusión probable: una migración es
 * historial permanente del esquema. Se aplica una vez, queda con su checksum
 * registrado y no se deshace. Estos datos son lo contrario: existen solo hasta
 * que Jimmy entregue su catálogo real, y hay que poder sembrarlos, borrarlos y
 * volver a sembrarlos tantas veces como haga falta. Mezclarlos con las
 * migraciones dejaría productos inventados en la base de la tienda para
 * siempre, y borrarlos después exigiría otra migración.
 *
 * CÓMO SE RECONOCEN: el nombre empieza con `[Ejemplo] `. Se eligió un prefijo
 * en el nombre y no una columna nueva por dos razones. Primero, una columna
 * `es_de_ejemplo` sería esquema permanente para un problema temporal, y habría
 * que espejarla en Postgres y quitarla después. Segundo, el prefijo se VE:
 * quien abra la pantalla de productos sabe de un vistazo que ese catálogo no
 * es el de la tienda, en vez de descubrirlo el día que algo no cuadre.
 *
 * Se usa con `npm run seed:ejemplo` y `npm run seed:limpiar`.
 */

import type { Database } from 'better-sqlite3';

import { ErrorDeNegocio } from '@main/database/errores';
import type { Repositorios } from '@main/database/repositories';
import type { TipoMedida, UnidadPeso } from '@main/database/repositories/entidades';

/**
 * Marca que distingue un registro de ejemplo de uno real.
 *
 * Va al principio del nombre. La limpieza busca exactamente este prefijo, así
 * que cambiarlo dejaría huérfanos los datos ya sembrados.
 */
export const PREFIJO_DE_EJEMPLO = '[Ejemplo] ';

/** ¿Este nombre corresponde a un registro sembrado por esta herramienta? */
export function esDeEjemplo(nombre: string): boolean {
  return nombre.startsWith(PREFIJO_DE_EJEMPLO);
}

/** Una categoría de ejemplo, sin el prefijo (lo agrega la siembra). */
interface CategoriaDeEjemplo {
  readonly nombre: string;
}

/** Un producto de ejemplo, sin el prefijo. */
interface ProductoDeEjemplo {
  readonly nombre: string;
  /** Nombre de la categoría, sin prefijo. */
  readonly categoria: string;
  readonly tipoMedida: TipoMedida;
  readonly unidadPeso: UnidadPeso | null;
  readonly cantidadPredefinidaIcono: string;
  readonly precioBase: string;
  readonly inventarioInicial: string;
}

/**
 * Las categorías de ejemplo.
 *
 * Coherentes con lo que ya se usó en este proyecto al razonar sobre el negocio
 * de Jimmy: granos a granel y abarrotes, más los huevos, que se venden por
 * unidad en dos presentaciones distintas.
 */
const CATEGORIAS: readonly CategoriaDeEjemplo[] = [
  { nombre: 'Granos' },
  { nombre: 'Abarrotes' },
  { nombre: 'Huevos' },
];

/**
 * Los productos de ejemplo.
 *
 * Los precios son verosímiles pero INVENTADOS: no salieron de la lista de
 * Jimmy, que todavía no la entregó. Por eso van con prefijo.
 */
const PRODUCTOS: readonly ProductoDeEjemplo[] = [
  {
    nombre: 'Maíz blanco',
    categoria: 'Granos',
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '4.25',
    inventarioInicial: '250',
  },
  {
    nombre: 'Frijol negro',
    categoria: 'Granos',
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '9.50',
    inventarioInicial: '120.5',
  },
  {
    nombre: 'Azúcar',
    categoria: 'Abarrotes',
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '5.75',
    inventarioInicial: '300',
  },
  {
    nombre: 'Huevos, cartón de 30',
    categoria: 'Huevos',
    tipoMedida: 'unidad',
    unidadPeso: null,
    cantidadPredefinidaIcono: '1',
    precioBase: '42.00',
    inventarioInicial: '24',
  },
  {
    nombre: 'Huevos, docena',
    categoria: 'Huevos',
    tipoMedida: 'unidad',
    unidadPeso: null,
    cantidadPredefinidaIcono: '1',
    precioBase: '18.00',
    inventarioInicial: '40',
  },
];

/** Qué hizo la siembra. */
export interface InformeDeSiembra {
  readonly categoriasCreadas: number;
  readonly productosCreados: number;
  /** Cuántos ya existían de una corrida anterior y se dejaron como estaban. */
  readonly yaExistian: number;
}

/** Qué hizo la limpieza. */
export interface InformeDeLimpieza {
  readonly productosEliminados: number;
  readonly categoriasEliminadas: number;
  /**
   * Nombres que NO se pudieron eliminar porque tienen ventas asociadas.
   *
   * No debería ocurrir mientras los datos de ejemplo se usen para lo que son,
   * pero si alguien cobró una venta de prueba, borrar el producto rompería el
   * comprobante. En ese caso se informa y no se borra nada.
   */
  readonly conservadosPorTenerVentas: readonly string[];
}

/** Cuántos registros de ejemplo hay ahora mismo. */
export interface ConteoDeEjemplo {
  readonly categorias: number;
  readonly productos: number;
}

/** Nombre completo, con prefijo, tal como se guarda. */
function conPrefijo(nombre: string): string {
  return `${PREFIJO_DE_EJEMPLO}${nombre}`;
}

/**
 * Siembra el catálogo de ejemplo.
 *
 * Es IDEMPOTENTE: lo que ya existe se deja como está y se cuenta aparte, así
 * que correrla dos veces no duplica nada ni pisa un precio que alguien haya
 * cambiado a mano para probar.
 *
 * Todo ocurre dentro de una sola transacción: si algo falla a la mitad, no
 * queda un catálogo sembrado por partes.
 */
export function sembrarDatosDeEjemplo(
  base: Database,
  repos: Repositorios,
): InformeDeSiembra {
  const sembrar = base.transaction((): InformeDeSiembra => {
    let categoriasCreadas = 0;
    let productosCreados = 0;
    let yaExistian = 0;

    const idPorCategoria = new Map<string, string>();
    const categoriasExistentes = new Map(
      repos.categorias.listar().map((categoria) => [categoria.nombre, categoria]),
    );

    for (const plantilla of CATEGORIAS) {
      const nombre = conPrefijo(plantilla.nombre);
      const existente = categoriasExistentes.get(nombre);

      if (existente !== undefined) {
        idPorCategoria.set(plantilla.nombre, existente.id);
        yaExistian += 1;
        continue;
      }

      const creada = repos.categorias.crear({ nombre });
      idPorCategoria.set(plantilla.nombre, creada.id);
      categoriasCreadas += 1;
    }

    const nombresDeProductos = new Set(
      repos.productos.listarTodos().map((producto) => producto.nombre),
    );

    for (const plantilla of PRODUCTOS) {
      const nombre = conPrefijo(plantilla.nombre);
      if (nombresDeProductos.has(nombre)) {
        yaExistian += 1;
        continue;
      }

      const categoriaId = idPorCategoria.get(plantilla.categoria);
      if (categoriaId === undefined) {
        throw new Error(
          `Los datos de ejemplo declaran el producto "${plantilla.nombre}" en la categoría ` +
            `"${plantilla.categoria}", que no está en la lista de categorías de ejemplo.`,
        );
      }

      repos.productos.crear({
        nombre,
        categoriaId,
        fotoPath: null,
        tipoMedida: plantilla.tipoMedida,
        unidadPeso: plantilla.unidadPeso,
        cantidadPredefinidaIcono: plantilla.cantidadPredefinidaIcono,
        precioBase: plantilla.precioBase,
        inventarioDisponible: plantilla.inventarioInicial,
        activo: true,
      });
      productosCreados += 1;
    }

    return { categoriasCreadas, productosCreados, yaExistian };
  });

  return sembrar();
}

/**
 * Quita todo lo que sembró `sembrarDatosDeEjemplo`, y nada más.
 *
 * Aquí SÍ se borra físicamente, que es la única excepción del proyecto a la
 * regla de "nunca eliminar, solo desactivar". La regla existe para proteger el
 * historial de la tienda; estos registros no tienen historial que proteger,
 * son andamiaje. Dejarlos desactivados sería peor: seguirían ocupando los
 * nombres por el UNIQUE de la tabla, y el día que Jimmy cargue su "Maíz
 * blanco" real chocaría con el de mentira.
 *
 * Si algún producto de ejemplo llegara a tener ventas, NO se borra nada: se
 * informa cuál y se conserva todo, porque borrarlo rompería un comprobante.
 */
export function limpiarDatosDeEjemplo(
  base: Database,
  repos: Repositorios,
): InformeDeLimpieza {
  const limpiar = base.transaction((): InformeDeLimpieza => {
    const productos = repos.productos.listarTodos().filter((p) => esDeEjemplo(p.nombre));
    const categorias = repos.categorias.listar().filter((c) => esDeEjemplo(c.nombre));

    const contarVentas = base.prepare(
      'SELECT count(*) AS total FROM venta_detalle WHERE producto_id = ?',
    );
    const conVentas = productos.filter(
      (producto) => (contarVentas.get(producto.id) as { total: number }).total > 0,
    );

    if (conVentas.length > 0) {
      return {
        productosEliminados: 0,
        categoriasEliminadas: 0,
        conservadosPorTenerVentas: conVentas.map((producto) => producto.nombre),
      };
    }

    const borrarProducto = base.prepare('DELETE FROM productos WHERE id = ?');
    for (const producto of productos) {
      borrarProducto.run(producto.id);
    }

    // Las categorías van después: `productos.categoria_id` las referencia con
    // ON DELETE RESTRICT, así que borrarlas antes fallaría.
    const borrarCategoria = base.prepare('DELETE FROM categorias WHERE id = ?');
    for (const categoria of categorias) {
      if (repos.categorias.contarProductos(categoria.id) > 0) {
        // Un producto REAL quedó dentro de una categoría de ejemplo. No se
        // borra: se dejaría el producto sin categoría, y la base lo impediría
        // igual. Se avisa con un error de negocio en vez de fallar por FK.
        throw new ErrorDeNegocio(
          'REGISTRO_EN_USO',
          `La categoría "${categoria.nombre}" tiene productos que no son de ejemplo. ` +
            'Movelos a otra categoría antes de limpiar.',
          `categoría de ejemplo ${categoria.id} con productos reales.`,
        );
      }
      borrarCategoria.run(categoria.id);
    }

    return {
      productosEliminados: productos.length,
      categoriasEliminadas: categorias.length,
      conservadosPorTenerVentas: [],
    };
  });

  return limpiar();
}

/** Cuántos registros de ejemplo hay ahora mismo, para el informe del script. */
export function contarDatosDeEjemplo(repos: Repositorios): ConteoDeEjemplo {
  return {
    categorias: repos.categorias.listar().filter((c) => esDeEjemplo(c.nombre)).length,
    productos: repos.productos.listarTodos().filter((p) => esDeEjemplo(p.nombre)).length,
  };
}
