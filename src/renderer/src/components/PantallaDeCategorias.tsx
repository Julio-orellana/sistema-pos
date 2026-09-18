/**
 * Administración de categorías.
 *
 * Muestra TODAS —activas e inactivas— porque una categoría desactivada tiene
 * que poder verse para reactivarla. Se distinguen visualmente: si se ocultaran
 * las inactivas, alguien intentaría crear una con el mismo nombre y chocaría
 * contra un UNIQUE sin entender por qué.
 *
 * Esta pantalla solo es alcanzable con rol administrativo, pero eso no lo
 * decide ella: el proceso principal rechaza cada canal con `requiereRol`.
 * Esconder el botón es comodidad, no control.
 *
 * NO SE LE PIDE NINGÚN ORDEN A NADIE (§4.63). La posición de cada categoría
 * la calcula el proceso principal al leerla, sumando las ventas de sus
 * productos, y la lista ya llega ordenada: esta pantalla no ordena nada.
 */

import { useCallback, useEffect, useState } from 'react';

import type { CategoriaIpc } from '@shared/types/ipc';
import { CampoDeTexto } from './TecladoEnPantalla';

/** Estado del formulario, tanto para crear como para editar. */
interface Borrador {
  /** `null` cuando se está creando una categoría nueva. */
  readonly id: string | null;
  readonly nombre: string;
}

const BORRADOR_VACIO: Borrador = { id: null, nombre: '' };

export function PantallaDeCategorias({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [categorias, setCategorias] = useState<readonly CategoriaIpc[]>([]);
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.catalogo.listarCategorias();
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setCategorias(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const refrescar = useCallback((): void => {
    setRecarga((anterior) => anterior + 1);
  }, []);

  const guardar = useCallback((): void => {
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta =
        borrador.id === null
          ? await window.pos.catalogo.crearCategoria(borrador.nombre.trim())
          : await window.pos.catalogo.editarCategoria(borrador.id, borrador.nombre.trim());
      setTrabajando(false);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setBorrador(BORRADOR_VACIO);
      refrescar();
    })();
  }, [borrador, refrescar]);

  const cambiarEstado = useCallback(
    (categoria: CategoriaIpc): void => {
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await window.pos.catalogo.fijarActivoCategoria(
          categoria.id,
          !categoria.activo,
        );
        setTrabajando(false);
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

  const editando = borrador.id !== null;

  return (
    <div data-prueba="pantalla-de-categorias">
      <header className="encabezado">
        <h1>Categorías</h1>
        <p className="subtitulo">
          Agrupan los productos en la pantalla de venta. Desactivar una categoría solo la retira
          de las opciones al crear un producto: los productos que ya la usan siguen vendiéndose.
        </p>
        <p className="subtitulo" data-prueba="categorias-orden-automatico">
          Se ordenan solas: primero las que más se venden. Una categoría nueva aparece al final
          hasta que se venda algo de ella.
        </p>
      </header>

      {mensaje !== null && <p className="alerta">{mensaje}</p>}

      <section className="tarjeta">
        <h2>{editando ? 'Editar categoría' : 'Nueva categoría'}</h2>

        <label className="campo">
          <span className="campo__etiqueta">Nombre</span>
          <CampoDeTexto
            etiqueta="Nombre de la categoría"
            valor={borrador.nombre}
            maxLength={60}
            data-prueba="categoria-nombre"
            alCambiar={(nombre) => {
              setBorrador((anterior) => ({ ...anterior, nombre }));
            }}
          />
        </label>

        <div className="acciones">
          <button
            type="button"
            disabled={trabajando || borrador.nombre.trim().length === 0}
            data-prueba="categoria-guardar"
            onClick={guardar}
          >
            {editando ? 'Guardar cambios' : 'Crear categoría'}
          </button>
          {editando && (
            <button
              type="button"
              className="boton--secundario"
              onClick={() => {
                setBorrador(BORRADOR_VACIO);
                setMensaje(null);
              }}
            >
              Cancelar
            </button>
          )}
        </div>
      </section>

      <section className="tarjeta">
        <h2>Todas las categorías</h2>
        {categorias.length === 0 ? (
          <p className="pendiente">Todavía no hay categorías. Creá la primera arriba.</p>
        ) : (
          <ul className="lista" data-prueba="lista-de-categorias">
            {categorias.map((categoria) => (
              <li
                key={categoria.id}
                className={categoria.activo ? 'lista__fila' : 'lista__fila lista__fila--inactiva'}
              >
                <div className="lista__principal">
                  <span className="lista__nombre">{categoria.nombre}</span>
                  {!categoria.activo && <span className="etiqueta">Desactivada</span>}
                  <span className="lista__detalle">
                    {categoria.ventas} {categoria.ventas === 1 ? 'venta' : 'ventas'} ·{' '}
                    {categoria.productosAsociados}{' '}
                    {categoria.productosAsociados === 1 ? 'producto' : 'productos'}
                  </span>
                </div>

                <div className="lista__acciones">
                  <button
                    type="button"
                    className="boton--secundario"
                    onClick={() => {
                      setBorrador({
                        id: categoria.id,
                        nombre: categoria.nombre,
                      });
                      setMensaje(null);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="boton--secundario"
                    disabled={trabajando}
                    onClick={() => {
                      cambiarEstado(categoria);
                    }}
                  >
                    {categoria.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}
