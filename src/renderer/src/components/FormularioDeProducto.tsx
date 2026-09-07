/**
 * Alta y edición de un producto.
 *
 * VALIDACIÓN EN TIEMPO REAL de la coherencia entre tipo de medida y unidad de
 * peso: mientras no cuadren, el botón de guardar está deshabilitado y se
 * explica qué falta. No sustituye a la validación del servicio ni al CHECK del
 * esquema —las tres existen y verifican lo mismo—; lo que evita es que alguien
 * llene un formulario largo y descubra el problema recién al enviarlo.
 *
 * NO tiene campo de inventario cuando se edita: mover el saldo es recepción de
 * mercadería, tiene su propia acción y su propio asiento de auditoría. Al
 * CREAR sí se pide el saldo inicial, porque en ese momento no hay nada que
 * ajustar todavía.
 */

import { useCallback, useMemo, useState } from 'react';

import type {
  CategoriaIpc,
  ProductoIpc,
  TipoMedidaIpc,
  UnidadPesoIpc,
} from '@shared/types/ipc';

/** Lo que el formulario tiene en pantalla. Todo texto: se valida al guardar. */
interface Borrador {
  readonly nombre: string;
  readonly categoriaId: string;
  readonly tipoMedida: TipoMedidaIpc;
  readonly unidadPeso: UnidadPesoIpc | null;
  readonly cantidadPredefinidaIcono: string;
  readonly precioBase: string;
  readonly inventarioInicial: string;
  readonly fotoPath: string | null;
  readonly fotoUrl: string | null;
}

export interface FormularioDeProductoProps {
  /** Producto a editar, o `null` para crear uno nuevo. */
  readonly producto: ProductoIpc | null;
  /** Categorías activas, más la del producto aunque esté desactivada. */
  readonly categorias: readonly CategoriaIpc[];
  readonly alGuardar: () => void;
  readonly alCancelar: () => void;
}

/** Borrador inicial: los datos del producto, o valores vacíos razonables. */
function borradorInicial(
  producto: ProductoIpc | null,
  categorias: readonly CategoriaIpc[],
): Borrador {
  if (producto !== null) {
    return {
      nombre: producto.nombre,
      categoriaId: producto.categoriaId,
      tipoMedida: producto.tipoMedida,
      unidadPeso: producto.unidadPeso,
      cantidadPredefinidaIcono: producto.cantidadPredefinidaIcono,
      precioBase: producto.precioBase,
      inventarioInicial: producto.inventarioDisponible,
      fotoPath: producto.fotoPath,
      fotoUrl: producto.fotoUrl,
    };
  }
  return {
    nombre: '',
    categoriaId: categorias[0]?.id ?? '',
    tipoMedida: 'unidad',
    unidadPeso: null,
    cantidadPredefinidaIcono: '1',
    precioBase: '0.00',
    inventarioInicial: '0',
    fotoPath: null,
    fotoUrl: null,
  };
}

/**
 * Qué le falta al borrador para poder guardarse, o `null` si está listo.
 *
 * Devuelve UN solo motivo, el primero: una lista de cinco errores a la vez es
 * más difícil de accionar que decir qué corregir ahora.
 */
function motivoParaNoGuardar(borrador: Borrador, esNuevo: boolean): string | null {
  if (borrador.nombre.trim().length === 0) {
    return 'Falta el nombre del producto.';
  }
  if (borrador.categoriaId === '') {
    return 'Elegí una categoría. Si no hay ninguna, creala primero en la pantalla de categorías.';
  }
  if (borrador.tipoMedida === 'peso' && borrador.unidadPeso === null) {
    return 'Un producto que se vende por peso necesita una unidad: libras o kilogramos.';
  }
  if (borrador.tipoMedida === 'unidad' && borrador.unidadPeso !== null) {
    return 'Un producto que se vende por unidad no lleva unidad de peso.';
  }
  if (borrador.cantidadPredefinidaIcono.trim().length === 0) {
    return 'Falta la cantidad que agrega el ícono al carrito.';
  }
  if (borrador.precioBase.trim().length === 0) {
    return 'Falta el precio.';
  }
  if (esNuevo && borrador.inventarioInicial.trim().length === 0) {
    return 'Falta el inventario inicial. Puede ser 0 si la mercadería todavía no llegó.';
  }
  return null;
}

export function FormularioDeProducto({
  producto,
  categorias,
  alGuardar,
  alCancelar,
}: FormularioDeProductoProps): React.JSX.Element {
  const esNuevo = producto === null;
  const [borrador, setBorrador] = useState<Borrador>(() => borradorInicial(producto, categorias));
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const impedimento = useMemo(
    () => motivoParaNoGuardar(borrador, esNuevo),
    [borrador, esNuevo],
  );

  /**
   * Cambiar el tipo de medida ajusta la unidad de una vez.
   *
   * Pasar a "unidad" borra la unidad de peso y pasar a "peso" propone libras,
   * que es lo que Jimmy usa. Sin esto, el formulario quedaría en un estado
   * incoherente que el propio usuario tendría que arreglar a mano.
   */
  const cambiarTipoDeMedida = useCallback((tipoMedida: TipoMedidaIpc): void => {
    setBorrador((anterior) => ({
      ...anterior,
      tipoMedida,
      unidadPeso: tipoMedida === 'peso' ? (anterior.unidadPeso ?? 'lb') : null,
    }));
  }, []);

  const elegirFoto = useCallback((): void => {
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.catalogo.elegirFoto();
      setTrabajando(false);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      if (!respuesta.datos.elegida) {
        return;
      }
      setMensaje(null);
      setBorrador((anterior) => ({
        ...anterior,
        fotoPath: respuesta.datos.fotoPath,
        fotoUrl: respuesta.datos.fotoUrl,
      }));
    })();
  }, []);

  const guardar = useCallback((): void => {
    if (impedimento !== null) {
      setMensaje(impedimento);
      return;
    }

    const comunes = {
      nombre: borrador.nombre.trim(),
      categoriaId: borrador.categoriaId,
      tipoMedida: borrador.tipoMedida,
      unidadPeso: borrador.unidadPeso,
      cantidadPredefinidaIcono: borrador.cantidadPredefinidaIcono.trim(),
      precioBase: borrador.precioBase.trim(),
      fotoPath: borrador.fotoPath,
    };

    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta =
        producto === null
          ? await window.pos.catalogo.crearProducto({
              ...comunes,
              inventarioInicial: borrador.inventarioInicial.trim(),
            })
          : await window.pos.catalogo.editarProducto({ ...comunes, id: producto.id });
      setTrabajando(false);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      alGuardar();
    })();
  }, [borrador, impedimento, producto, alGuardar]);

  return (
    <section className="tarjeta" data-prueba="formulario-de-producto">
      <h2>{esNuevo ? 'Nuevo producto' : `Editar ${producto.nombre}`}</h2>

      <label className="campo">
        <span className="campo__etiqueta">Nombre</span>
        <input
          type="text"
          value={borrador.nombre}
          maxLength={80}
          data-prueba="producto-nombre"
          onChange={(evento) => {
            setBorrador((anterior) => ({ ...anterior, nombre: evento.target.value }));
          }}
        />
      </label>

      <label className="campo">
        <span className="campo__etiqueta">Categoría</span>
        <select
          value={borrador.categoriaId}
          data-prueba="producto-categoria"
          onChange={(evento) => {
            setBorrador((anterior) => ({ ...anterior, categoriaId: evento.target.value }));
          }}
        >
          {categorias.length === 0 && <option value="">(no hay categorías activas)</option>}
          {categorias.map((categoria) => (
            <option key={categoria.id} value={categoria.id}>
              {categoria.nombre}
              {categoria.activo ? '' : ' (desactivada)'}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="campo">
        <legend className="campo__etiqueta">Cómo se vende</legend>
        <div className="opciones">
          <label className="opcion">
            <input
              type="radio"
              name="tipo-medida"
              checked={borrador.tipoMedida === 'unidad'}
              data-prueba="producto-tipo-unidad"
              onChange={() => {
                cambiarTipoDeMedida('unidad');
              }}
            />
            Por unidad
          </label>
          <label className="opcion">
            <input
              type="radio"
              name="tipo-medida"
              checked={borrador.tipoMedida === 'peso'}
              data-prueba="producto-tipo-peso"
              onChange={() => {
                cambiarTipoDeMedida('peso');
              }}
            />
            Por peso
          </label>
        </div>
      </fieldset>

      {/* La unidad solo se muestra cuando aplica: un desplegable inerte al
          lado de "por unidad" invita a llenarlo y a romper la coherencia. */}
      {borrador.tipoMedida === 'peso' && (
        <label className="campo">
          <span className="campo__etiqueta">Unidad de peso</span>
          <select
            value={borrador.unidadPeso ?? 'lb'}
            data-prueba="producto-unidad-peso"
            onChange={(evento) => {
              setBorrador((anterior) => ({
                ...anterior,
                unidadPeso: evento.target.value === 'kg' ? 'kg' : 'lb',
              }));
            }}
          >
            <option value="lb">Libras (lb)</option>
            <option value="kg">Kilogramos (kg)</option>
          </select>
        </label>
      )}

      <label className="campo">
        <span className="campo__etiqueta">
          Cantidad que agrega el ícono ({borrador.tipoMedida === 'peso' ? 'peso' : 'unidades'})
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={borrador.cantidadPredefinidaIcono}
          data-prueba="producto-cantidad-icono"
          onChange={(evento) => {
            setBorrador((anterior) => ({
              ...anterior,
              cantidadPredefinidaIcono: evento.target.value,
            }));
          }}
        />
      </label>

      <label className="campo">
        <span className="campo__etiqueta">Precio en quetzales</span>
        <input
          type="text"
          inputMode="decimal"
          value={borrador.precioBase}
          data-prueba="producto-precio"
          onChange={(evento) => {
            setBorrador((anterior) => ({ ...anterior, precioBase: evento.target.value }));
          }}
        />
      </label>

      {esNuevo ? (
        <label className="campo">
          <span className="campo__etiqueta">Inventario inicial (puede ser 0)</span>
          <input
            type="text"
            inputMode="decimal"
            value={borrador.inventarioInicial}
            data-prueba="producto-inventario-inicial"
            onChange={(evento) => {
              setBorrador((anterior) => ({
                ...anterior,
                inventarioInicial: evento.target.value,
              }));
            }}
          />
        </label>
      ) : (
        <p className="nota">
          El inventario no se edita acá. Usá «Ajustar inventario» en la lista: es recepción de
          mercadería y queda registrada aparte.
        </p>
      )}

      <div className="campo">
        <span className="campo__etiqueta">Foto (opcional, JPG o PNG, hasta 5 MB)</span>
        <div className="foto">
          {borrador.fotoUrl === null ? (
            <span className="foto__vacia">Sin foto</span>
          ) : (
            <img className="foto__vista" src={borrador.fotoUrl} alt={`Foto de ${borrador.nombre}`} />
          )}
          <div className="acciones">
            <button
              type="button"
              className="boton--secundario"
              disabled={trabajando}
              data-prueba="producto-elegir-foto"
              onClick={elegirFoto}
            >
              Elegir foto…
            </button>
            {borrador.fotoPath !== null && (
              <button
                type="button"
                className="boton--secundario"
                onClick={() => {
                  setBorrador((anterior) => ({ ...anterior, fotoPath: null, fotoUrl: null }));
                }}
              >
                Quitar foto
              </button>
            )}
          </div>
        </div>
      </div>

      {/* El impedimento se muestra siempre, no solo al intentar guardar: es la
          validación en tiempo real de la coherencia tipo de medida / unidad. */}
      {impedimento !== null && (
        <p className="advertencia" data-prueba="producto-impedimento">
          {impedimento}
        </p>
      )}

      {/*
        El aviso de error va JUNTO AL BOTÓN, no en el encabezado del
        formulario. Se descubrió manejando la aplicación real: este formulario
        es más alto que la pantalla, así que al pulsar «Crear producto» —que
        está abajo— un mensaje puesto arriba queda fuera de la vista y parece
        que el botón no hizo nada. El aviso tiene que aparecer donde está
        mirando quien lo pulsó.
      */}
      {mensaje !== null && (
        <p className="alerta" data-prueba="producto-error">
          {mensaje}
        </p>
      )}

      <div className="acciones">
        <button
          type="button"
          disabled={trabajando || impedimento !== null}
          data-prueba="producto-guardar"
          onClick={guardar}
        >
          {esNuevo ? 'Crear producto' : 'Guardar cambios'}
        </button>
        <button type="button" className="boton--secundario" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
