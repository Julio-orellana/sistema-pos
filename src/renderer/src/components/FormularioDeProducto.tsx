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
 *
 * EL PRECIO MAYORISTA (spec 002) va detrás de una casilla, desmarcada por
 * omisión. Marcarla muestra sus dos campos; desmarcarla los VACÍA, en el mismo
 * cambio de estado, así que guardar con la casilla desmarcada quita el precio
 * mayorista. Sus reglas se revisan mientras se escribe con
 * `revisarPrecioMayorista`, la MISMA función y los MISMOS textos que usa el
 * servicio: el formulario no puede dejar pasar algo que el servicio rechaza.
 */

import { useCallback, useMemo, useState } from 'react';

import { revisarPrecioMayorista } from '@shared/precio-mayorista';
import type {
  CategoriaIpc,
  ProductoIpc,
  TipoMedidaIpc,
  UnidadPesoIpc,
} from '@shared/types/ipc';
import { MiniaturaDeProducto } from './MiniaturaDeProducto';
import { CampoDeTexto } from './TecladoEnPantalla';

/** Lo que el formulario tiene en pantalla. Todo texto: se valida al guardar. */
interface Borrador {
  readonly nombre: string;
  readonly categoriaId: string;
  readonly tipoMedida: TipoMedidaIpc;
  readonly unidadPeso: UnidadPesoIpc | null;
  readonly cantidadPredefinidaIcono: string;
  readonly precioBase: string;
  /** Vacío es «sin costo cargado», que no es cero. */
  readonly precioCompra: string;
  /** La casilla «¿Aplica precio mayorista?». Desmarcada, los dos campos no existen. */
  readonly aplicaMayorista: boolean;
  readonly precioMayorista: string;
  readonly cantidadMinimaMayorista: string;
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
      precioCompra: producto.precioCompra ?? '',
      // Un producto que YA tiene precio mayorista abre con la casilla marcada
      // y sus valores; uno que no tiene, desmarcada.
      aplicaMayorista: producto.mayorista !== null,
      precioMayorista: producto.mayorista?.precio ?? '',
      cantidadMinimaMayorista: producto.mayorista?.cantidadMinima ?? '',
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
    precioCompra: '',
    aplicaMayorista: false,
    precioMayorista: '',
    cantidadMinimaMayorista: '',
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
  if (borrador.aplicaMayorista) {
    // Con la casilla marcada los dos datos son obligatorios (`exigido`), y el
    // texto de cada rechazo es el del servicio: sale de la misma función.
    const revision = revisarPrecioMayorista({
      precioBase: borrador.precioBase,
      precioMayorista: borrador.precioMayorista,
      cantidadMinima: borrador.cantidadMinimaMayorista,
      exigido: true,
    });
    if (!revision.ok) {
      return revision.mensaje;
    }
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

  /**
   * Marcar o desmarcar la casilla del precio mayorista VACÍA los dos campos.
   *
   * Desmarcarla con valores escritos y guardarlos igual sería guardar algo que
   * la pantalla dice que no aplica; y volver a marcarla muestra los campos
   * vacíos, para que nadie reactive sin querer un precio viejo.
   */
  const cambiarMayorista = useCallback((aplicaMayorista: boolean): void => {
    setBorrador((anterior) => ({
      ...anterior,
      aplicaMayorista,
      precioMayorista: '',
      cantidadMinimaMayorista: '',
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
      // Vacío viaja como `null`: el proceso principal lo guarda sin costo.
      precioCompra: borrador.precioCompra.trim() === '' ? null : borrador.precioCompra.trim(),
      // Con la casilla desmarcada viajan los dos en `null`: quita el precio
      // mayorista, si lo había. Es un valor explícito, no «dejarlo como estaba».
      precioMayorista: borrador.aplicaMayorista ? borrador.precioMayorista.trim() : null,
      cantidadMinimaMayorista: borrador.aplicaMayorista ? borrador.cantidadMinimaMayorista.trim() : null,
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
        <CampoDeTexto
          etiqueta="Nombre del producto"
          valor={borrador.nombre}
          maxLength={80}
          data-prueba="producto-nombre"
          alCambiar={(nombre) => {
            setBorrador((anterior) => ({ ...anterior, nombre }));
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
        <CampoDeTexto
          etiqueta="Cantidad que agrega el ícono"
          disposicion={borrador.tipoMedida === 'peso' ? 'decimal' : 'entero'}
          valor={borrador.cantidadPredefinidaIcono}
          data-prueba="producto-cantidad-icono"
          alCambiar={(cantidadPredefinidaIcono) => {
            setBorrador((anterior) => ({ ...anterior, cantidadPredefinidaIcono }));
          }}
        />
      </label>

      <label className="campo">
        <span className="campo__etiqueta">Precio en quetzales</span>
        <CampoDeTexto
          etiqueta="Precio en quetzales"
          disposicion="decimal"
          valor={borrador.precioBase}
          data-prueba="producto-precio"
          alCambiar={(precioBase) => {
            setBorrador((anterior) => ({ ...anterior, precioBase }));
          }}
        />
      </label>

      <label className="campo">
        <span className="campo__etiqueta">
          Precio de compra en quetzales (opcional, por{' '}
          {borrador.tipoMedida === 'peso' ? (borrador.unidadPeso ?? 'lb') : 'unidad'})
        </span>
        <CampoDeTexto
          etiqueta="Precio de compra"
          disposicion="decimal"
          valor={borrador.precioCompra}
          placeholder="Sin costo cargado"
          data-prueba="producto-precio-compra"
          alCambiar={(precioCompra) => {
            setBorrador((anterior) => ({ ...anterior, precioCompra }));
          }}
        />
        <span className="nota">
          Sirve para calcular el margen en los reportes. Si lo dejás vacío, el margen de este
          producto se muestra como «sin dato», no como cero.
        </span>
      </label>

      <div className="campo" data-prueba="producto-seccion-mayorista">
        <label className="opcion">
          <input
            type="checkbox"
            checked={borrador.aplicaMayorista}
            data-prueba="producto-aplica-mayorista"
            onChange={(evento) => {
              cambiarMayorista(evento.target.checked);
            }}
          />
          ¿Aplica precio mayorista?
        </label>
      </div>

      {/* Los dos campos solo EXISTEN con la casilla marcada: no están ocultos
          con estilos, no están. */}
      {borrador.aplicaMayorista && (
        <>
          <label className="campo">
            <span className="campo__etiqueta">
              Precio mayorista en quetzales (por{' '}
              {borrador.tipoMedida === 'peso' ? (borrador.unidadPeso ?? 'lb') : 'unidad'})
            </span>
            <CampoDeTexto
              etiqueta="Precio mayorista"
              disposicion="decimal"
              valor={borrador.precioMayorista}
              data-prueba="producto-precio-mayorista"
              alCambiar={(precioMayorista) => {
                setBorrador((anterior) => ({ ...anterior, precioMayorista }));
              }}
            />
          </label>

          <label className="campo">
            <span className="campo__etiqueta">
              Cantidad mínima para el precio mayorista (en{' '}
              {borrador.tipoMedida === 'peso' ? (borrador.unidadPeso ?? 'lb') : 'unidades'})
            </span>
            <CampoDeTexto
              etiqueta="Cantidad mínima para el precio mayorista"
              disposicion={borrador.tipoMedida === 'peso' ? 'decimal' : 'entero'}
              valor={borrador.cantidadMinimaMayorista}
              data-prueba="producto-cantidad-minima-mayorista"
              alCambiar={(cantidadMinimaMayorista) => {
                setBorrador((anterior) => ({ ...anterior, cantidadMinimaMayorista }));
              }}
            />
            <span className="nota">
              Desde esa cantidad, la línea entera se cobra a este precio si es el más bajo de los
              que aplican. Tiene que ser menor que el precio de lista.
            </span>
          </label>
        </>
      )}

      {esNuevo ? (
        <label className="campo">
          <span className="campo__etiqueta">Inventario inicial (puede ser 0)</span>
          <CampoDeTexto
            etiqueta="Inventario inicial"
            disposicion={borrador.tipoMedida === 'peso' ? 'decimal' : 'entero'}
            valor={borrador.inventarioInicial}
            data-prueba="producto-inventario-inicial"
            alCambiar={(inventarioInicial) => {
              setBorrador((anterior) => ({ ...anterior, inventarioInicial }));
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
          {/* El MISMO marcador que la lista, para que el producto se vea igual
              en los dos lados y no haya dos formas de decir «sin foto». */}
          <MiniaturaDeProducto
            nombre={borrador.nombre.trim() === '' ? 'Producto nuevo' : borrador.nombre}
            fotoUrl={borrador.fotoUrl}
            tamano="formulario"
          />
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
