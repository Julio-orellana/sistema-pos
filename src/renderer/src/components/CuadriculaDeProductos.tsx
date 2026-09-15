/**
 * La cuadrícula de productos de la pantalla de venta.
 *
 * ORDEN: los más vendidos primero, con el nombre como desempate. El orden lo
 * decide el proceso principal en su consulta —no la pantalla— para que sea el
 * mismo criterio determinista sin importar quién pregunte.
 *
 * La insignia de "MÁS VENDIDO" solo aparece en productos que **de verdad se
 * vendieron alguna vez**. Hoy ninguno lo hizo: nada incrementa
 * `contador_ventas` todavía. Poner el número igual sería decorar la pantalla
 * con un dato falso.
 */

import type { CategoriaDeVenta, ProductoParaVender } from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { MiniaturaDeProducto } from './MiniaturaDeProducto';
import { CampoDeTexto } from './TecladoEnPantalla';
import { descripcionDeCantidad } from '../venta/ticket';

/** Valor del filtro que significa "todas las categorías". */
export const TODAS_LAS_CATEGORIAS = '__todas__';

/** Cuántos productos llevan insignia de más vendido. */
const CUANTOS_DESTACADOS = 3;

export interface CuadriculaDeProductosProps {
  readonly productos: readonly ProductoParaVender[];
  readonly categorias: readonly CategoriaDeVenta[];
  readonly categoriaActiva: string;
  readonly alElegirCategoria: (id: string) => void;
  readonly busqueda: string;
  readonly alBuscar: (texto: string) => void;
  readonly alTocarProducto: (producto: ProductoParaVender) => void;
}

export function CuadriculaDeProductos({
  productos,
  categorias,
  categoriaActiva,
  alElegirCategoria,
  busqueda,
  alBuscar,
  alTocarProducto,
}: CuadriculaDeProductosProps): React.JSX.Element {
  const termino = busqueda.trim().toLocaleLowerCase('es');

  const visibles = productos.filter((producto) => {
    const porCategoria =
      categoriaActiva === TODAS_LAS_CATEGORIAS || producto.categoriaId === categoriaActiva;
    const porNombre =
      termino === '' || producto.nombre.toLocaleLowerCase('es').includes(termino);
    return porCategoria && porNombre;
  });

  /**
   * Los tres primeros del listado GENERAL que además tienen ventas.
   *
   * Se calcula sobre el listado completo y no sobre lo visible: el puesto de un
   * producto es su puesto en la tienda, no dentro del filtro que esté puesto.
   */
  const destacados = new Map(
    productos
      .filter((producto) => producto.contadorVentas > 0)
      .slice(0, CUANTOS_DESTACADOS)
      .map((producto, indice) => [producto.id, indice + 1]),
  );

  const nombreDeLaVista =
    categoriaActiva === TODAS_LAS_CATEGORIAS
      ? 'Todos'
      : (categorias.find((categoria) => categoria.id === categoriaActiva)?.nombre ?? 'Todos');

  const totalDeProductos = productos.length;

  return (
    <div className="venta__catalogo">
      <nav className="venta__categorias" aria-label="Categorías">
        <p className="venta__rotulo">Categorías</p>

        <button
          type="button"
          className={
            categoriaActiva === TODAS_LAS_CATEGORIAS
              ? 'categoria categoria--activa'
              : 'categoria'
          }
          data-prueba="categoria-todas"
          onClick={() => {
            alElegirCategoria(TODAS_LAS_CATEGORIAS);
          }}
        >
          <span className="categoria__nombre">Todos</span>
          <span className="categoria__conteo">
            {totalDeProductos} {totalDeProductos === 1 ? 'producto' : 'productos'}
          </span>
        </button>

        {categorias.map((categoria) => (
          <button
            key={categoria.id}
            type="button"
            className={
              categoriaActiva === categoria.id ? 'categoria categoria--activa' : 'categoria'
            }
            data-prueba="categoria"
            onClick={() => {
              alElegirCategoria(categoria.id);
            }}
          >
            <span className="categoria__nombre">{categoria.nombre}</span>
            <span className="categoria__conteo">
              {categoria.productos} {categoria.productos === 1 ? 'producto' : 'productos'}
            </span>
          </button>
        ))}
      </nav>

      <div className="venta__productos">
        <div className="venta__encabezado">
          <h2 className="venta__vista">{nombreDeLaVista}</h2>
          <div className="venta__espacio" />
          <label className="venta__buscador">
            <span className="visualmente-oculto">Buscar producto</span>
            <CampoDeTexto
              etiqueta="Buscar producto"
              valor={busqueda}
              placeholder="Buscar producto"
              mayusculaInicial={false}
              data-prueba="venta-buscador"
              alCambiar={alBuscar}
            />
          </label>
        </div>

        {visibles.length === 0 ? (
          <p className="pendiente" data-prueba="venta-sin-productos">
            {totalDeProductos === 0
              ? 'No hay productos activos en el catálogo.'
              : 'Ningún producto coincide con el filtro.'}
          </p>
        ) : (
          <ul className="cuadricula" data-prueba="cuadricula-de-productos">
            {visibles.map((producto) => {
              const puesto = destacados.get(producto.id);
              return (
                <li key={producto.id}>
                  <button
                    type="button"
                    className="icono-producto"
                    data-prueba="icono-producto"
                    data-producto={producto.id}
                    onClick={() => {
                      alTocarProducto(producto);
                    }}
                  >
                    {puesto !== undefined && (
                      <span className="icono-producto__insignia">
                        <span className="icono-producto__puesto">{puesto}</span>
                        Más vendido
                      </span>
                    )}
                    <span className="icono-producto__foto">
                      <MiniaturaDeProducto
                        nombre={producto.nombre}
                        fotoUrl={producto.fotoUrl}
                        tamano="formulario"
                      />
                    </span>
                    <span className="icono-producto__nombre">{producto.nombre}</span>
                    <span className="icono-producto__medida">
                      {descripcionDeCantidad(producto)}
                    </span>
                    <span className="icono-producto__precio">
                      {formatearQuetzales(producto.precioBase)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
