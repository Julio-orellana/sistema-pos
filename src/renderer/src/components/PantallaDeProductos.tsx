/**
 * Administración de productos.
 *
 * Lista con miniatura, nombre, categoría, precio e inventario, con filtro por
 * categoría y buscador por nombre. Muestra también los desactivados, marcados:
 * si se ocultaran, alguien intentaría crear uno con el mismo nombre y chocaría
 * contra el UNIQUE de la tabla sin entender por qué.
 *
 * «Ajustar inventario» es una acción propia y visible, no una opción escondida
 * dentro de «Editar»: recibir mercadería es un hecho distinto de corregir el
 * catálogo, y deja su propio asiento de auditoría.
 *
 * «Desactivar» pide confirmación explícita, porque saca el producto de la
 * pantalla de venta.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CategoriaIpc, ProductoIpc } from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { FormularioDeProducto } from './FormularioDeProducto';
import { ModalDeAjusteDeInventario } from './ModalDeAjusteDeInventario';

/** Valor del filtro que significa "todas las categorías". */
const TODAS = '__todas__';

/** Qué está haciendo la pantalla ahora mismo. */
type Vista =
  | { readonly tipo: 'lista' }
  | { readonly tipo: 'formulario'; readonly producto: ProductoIpc | null };

export function PantallaDeProductos({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [productos, setProductos] = useState<readonly ProductoIpc[]>([]);
  const [categorias, setCategorias] = useState<readonly CategoriaIpc[]>([]);
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });
  const [ajustando, setAjustando] = useState<ProductoIpc | null>(null);
  const [porDesactivar, setPorDesactivar] = useState<ProductoIpc | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState<string>(TODAS);
  const [busqueda, setBusqueda] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const [respuestaProductos, respuestaCategorias] = await Promise.all([
        window.pos.catalogo.listarProductos(),
        window.pos.catalogo.listarCategorias(),
      ]);
      if (control.signal.aborted) {
        return;
      }
      if (respuestaProductos.ok) {
        setProductos(respuestaProductos.datos);
      } else {
        setMensaje(respuestaProductos.error.mensaje);
      }
      if (respuestaCategorias.ok) {
        setCategorias(respuestaCategorias.datos);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const refrescar = useCallback((): void => {
    setRecarga((anterior) => anterior + 1);
  }, []);

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase('es');
    return productos.filter((producto) => {
      const porCategoria =
        filtroCategoria === TODAS || producto.categoriaId === filtroCategoria;
      const porNombre =
        termino === '' || producto.nombre.toLocaleLowerCase('es').includes(termino);
      return porCategoria && porNombre;
    });
  }, [productos, filtroCategoria, busqueda]);

  const cambiarEstado = useCallback(
    (producto: ProductoIpc, activo: boolean): void => {
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await window.pos.catalogo.fijarActivoProducto(producto.id, activo);
        setTrabajando(false);
        setPorDesactivar(null);
        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          return;
        }
        setMensaje(null);
        refrescar();
      })();
    },
    [refrescar],
  );

  if (vista.tipo === 'formulario') {
    // Al editar se ofrecen las categorías activas MÁS la del propio producto,
    // aunque esté desactivada: si no, el desplegable no podría mostrar dónde
    // está hoy y guardar lo movería de categoría sin que nadie lo pidiera.
    const disponibles = categorias.filter(
      (categoria) => categoria.activo || categoria.id === vista.producto?.categoriaId,
    );
    return (
      <div data-prueba="pantalla-de-productos">
        <FormularioDeProducto
          producto={vista.producto}
          categorias={disponibles}
          alGuardar={() => {
            setVista({ tipo: 'lista' });
            refrescar();
          }}
          alCancelar={() => {
            setVista({ tipo: 'lista' });
          }}
        />
      </div>
    );
  }

  return (
    <div data-prueba="pantalla-de-productos">
      <header className="encabezado">
        <h1>Productos</h1>
        <p className="subtitulo">
          Catálogo de la tienda. Un producto desactivado desaparece de la pantalla de venta pero
          conserva su historial.
        </p>
      </header>

      {mensaje !== null && <p className="alerta">{mensaje}</p>}

      <section className="tarjeta">
        <div className="filtros">
          <label className="campo">
            <span className="campo__etiqueta">Buscar por nombre</span>
            <input
              type="search"
              value={busqueda}
              placeholder="Maíz, azúcar…"
              data-prueba="productos-buscador"
              onChange={(evento) => {
                setBusqueda(evento.target.value);
              }}
            />
          </label>

          <label className="campo">
            <span className="campo__etiqueta">Categoría</span>
            <select
              value={filtroCategoria}
              data-prueba="productos-filtro-categoria"
              onChange={(evento) => {
                setFiltroCategoria(evento.target.value);
              }}
            >
              <option value={TODAS}>Todas</option>
              {categorias.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.nombre}
                  {categoria.activo ? '' : ' (desactivada)'}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            data-prueba="productos-nuevo"
            onClick={() => {
              setVista({ tipo: 'formulario', producto: null });
            }}
          >
            Nuevo producto
          </button>
        </div>
      </section>

      <section className="tarjeta">
        {visibles.length === 0 ? (
          <p className="pendiente">
            {productos.length === 0
              ? 'Todavía no hay productos. Creá el primero con «Nuevo producto».'
              : 'Ningún producto coincide con el filtro.'}
          </p>
        ) : (
          <ul className="lista" data-prueba="lista-de-productos">
            {visibles.map((producto) => (
              <li
                key={producto.id}
                className={producto.activo ? 'lista__fila' : 'lista__fila lista__fila--inactiva'}
              >
                {producto.fotoUrl === null ? (
                  <span className="miniatura miniatura--vacia" aria-hidden="true" />
                ) : (
                  <img className="miniatura" src={producto.fotoUrl} alt={`Foto de ${producto.nombre}`} />
                )}

                <div className="lista__principal">
                  <span className="lista__nombre">{producto.nombre}</span>
                  {!producto.activo && <span className="etiqueta">Desactivado</span>}
                  <span className="lista__detalle">
                    {producto.categoriaNombre} · {formatearQuetzales(producto.precioBase)}
                    {producto.tipoMedida === 'peso' ? ` por ${producto.unidadPeso ?? ''}` : ' c/u'}
                  </span>
                  <span className="lista__detalle">
                    Inventario: {producto.inventarioDisponible}{' '}
                    {producto.tipoMedida === 'peso' ? (producto.unidadPeso ?? '') : 'unidades'}
                  </span>
                </div>

                <div className="lista__acciones">
                  <button
                    type="button"
                    className="boton--secundario"
                    onClick={() => {
                      setVista({ tipo: 'formulario', producto });
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    data-prueba="producto-ajustar-inventario"
                    onClick={() => {
                      setAjustando(producto);
                    }}
                  >
                    Ajustar inventario
                  </button>
                  {producto.activo ? (
                    <button
                      type="button"
                      className="boton--secundario"
                      disabled={trabajando}
                      onClick={() => {
                        setPorDesactivar(producto);
                      }}
                    >
                      Desactivar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="boton--secundario"
                      disabled={trabajando}
                      onClick={() => {
                        cambiarEstado(producto, true);
                      }}
                    >
                      Reactivar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ajustando !== null && (
        <ModalDeAjusteDeInventario
          producto={ajustando}
          alTerminar={() => {
            setAjustando(null);
            refrescar();
          }}
          alCancelar={() => {
            setAjustando(null);
          }}
        />
      )}

      {/* Confirmación explícita: desactivar oculta el producto de la venta. */}
      {porDesactivar !== null && (
        <div className="capa-modal">
          <section className="modal" data-prueba="modal-desactivar-producto">
            <h2>¿Desactivar {porDesactivar.nombre}?</h2>
            <p className="modal__texto">
              Deja de aparecer en la pantalla de venta de inmediato. No se borra: conserva su
              historial y su inventario de {porDesactivar.inventarioDisponible}, y se puede
              reactivar cuando quieras.
            </p>
            <div className="modal__acciones">
              <button
                type="button"
                disabled={trabajando}
                data-prueba="confirmar-desactivar"
                onClick={() => {
                  cambiarEstado(porDesactivar, false);
                }}
              >
                Sí, desactivar
              </button>
              <button
                type="button"
                className="boton--secundario"
                onClick={() => {
                  setPorDesactivar(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}
