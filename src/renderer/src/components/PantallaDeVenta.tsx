/**
 * Pantalla de venta: la cuadrícula de productos y el ticket en curso.
 *
 * ALCANCE DE ESTE MÓDULO: arma el ticket EN MEMORIA y lo manda a cobrar. Lo
 * que NO hace es calcular lo que se cobra: el precio de cada línea y el total
 * los recalcula el proceso principal contra el catálogo, dentro de la misma
 * transacción que descuenta inventario. Acá no se imprime nada todavía.
 *
 * DESPUÉS DE COBRAR, LA PANTALLA VUELVE A CERO: ticket vacío, sin descuento y
 * con el catálogo recargado, porque el inventario y el orden de los íconos
 * acaban de cambiar. Dejar el ticket cobrado a la vista invita a cobrarlo dos
 * veces.
 *
 * ACCESO CONDICIONADO A LA CAJA. Antes de dibujar nada se consulta el estado
 * real, y hay tres respuestas posibles:
 *
 *   1. No hay caja abierta → no se muestra la cuadrícula. Se explica y se
 *      ofrece ir a abrirla.
 *   2. La caja la abrió OTRA persona → tampoco se vende, y NO se ofrece
 *      autorizar con PIN. Una venta se registra contra `caja_sesion_id`: en la
 *      caja ajena, el dinero entraría al corte de alguien que no lo recibió.
 *      Cerrar la caja de otro sí se autoriza —es un acto único y auditado—,
 *      pero vender es continuo, y autorizar una vez dejaría toda una tarde
 *      atribuida a quien no estaba. La salida correcta ya existe: cerrar ese
 *      turno con el PIN del administrador y abrir el propio, y a eso se manda.
 *   3. La caja la abrió quien está en sesión → se vende con normalidad.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  EstadoDeVenta,
  ImpresionDeReciboTerminadaIpc,
  ProductoParaVender,
  ReciboDeLaVentaIpc,
} from '@shared/types/ipc';
import { estadoDelPapel } from '../venta/impresion-del-recibo';
import { formatearQuetzales } from '@shared/money';
import { CuadriculaDeProductos, TODAS_LAS_CATEGORIAS } from './CuadriculaDeProductos';
import { DialogoDeCobro } from './DialogoDeCobro';
import { TecladoNumerico } from './TecladoNumerico';
import { TicketDeVenta } from './TicketDeVenta';
import {
  agregarAlTicket,
  cantidadLegible,
  decimalesDe,
  fijarCantidad,
  quitarDelTicket,
  unidadDe,
  type LineaDeTicket,
} from '../venta/ticket';

/** Fecha y hora en el formato que se lee en el mostrador. */
function momentoLegible(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? iso
    : fecha.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
}

export interface PantallaDeVentaProps {
  readonly alVolver: () => void;
  /** Lleva a la pantalla de caja, que es la salida de los dos casos bloqueados. */
  readonly alIrACaja: () => void;
}

export function PantallaDeVenta({
  alVolver,
  alIrACaja,
}: PantallaDeVentaProps): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoDeVenta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lineas, setLineas] = useState<readonly LineaDeTicket[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string>(TODAS_LAS_CATEGORIAS);
  const [busqueda, setBusqueda] = useState('');

  /** Línea cuya cantidad se está corrigiendo con el teclado. */
  const [enEdicion, setEnEdicion] = useState<LineaDeTicket | null>(null);
  const [cantidadTecleada, setCantidadTecleada] = useState('');

  /** `true` mientras se confirma vaciar el ticket. */
  const [confirmandoVaciar, setConfirmandoVaciar] = useState(false);

  /** `true` mientras está abierto el diálogo de cobro. */
  const [cobrando, setCobrando] = useState(false);

  /** Confirmación de la última venta, que se muestra sobre la cuadrícula. */
  const [ultimaVenta, setUltimaVenta] = useState<string | null>(null);

  /**
   * El recibo de la última venta cobrada, para seguir su impresión después de
   * cerrar el diálogo: si el papel no sale, la cajera se tiene que enterar
   * aunque ya haya tocado «Siguiente venta».
   */
  const [ultimoRecibo, setUltimoRecibo] = useState<ReciboDeLaVentaIpc | null>(null);

  /**
   * El último aviso de impresión terminada. La suscripción vive lo que vive la
   * pantalla, no lo que vive el diálogo: el aviso puede llegar antes de que el
   * diálogo sepa qué recibo se emitió, o después de cerrarlo (§4.64).
   */
  const [impresionTerminada, setImpresionTerminada] = useState<ImpresionDeReciboTerminadaIpc | null>(null);

  useEffect(() => window.pos.recibos.alTerminarImpresion(setImpresionTerminada), []);

  /**
   * Se incrementa después de cada venta para volver a pedir el estado.
   *
   * Hace falta releer y no solo vaciar el ticket: la venta acaba de bajar el
   * inventario y de mover el contador que ordena los íconos, así que el
   * catálogo en pantalla quedó viejo.
   */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.venta.estado();
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setEstado(respuesta.datos);
      } else {
        setError(respuesta.error.mensaje);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const tocarProducto = useCallback((producto: ProductoParaVender): void => {
    setUltimaVenta(null);
    setUltimoRecibo(null);
    setLineas((anteriores) => agregarAlTicket(anteriores, producto));
  }, []);

  const abrirEdicion = useCallback((linea: LineaDeTicket): void => {
    setEnEdicion(linea);
    // Arranca vacío y no con la cantidad actual: el gesto normal es reemplazar
    // lo pesado, y ver el número viejo invita a apilar dígitos sobre él.
    setCantidadTecleada('');
  }, []);

  const confirmarCantidad = useCallback((): void => {
    if (enEdicion === null || cantidadTecleada === '') {
      return;
    }
    setLineas((anteriores) =>
      fijarCantidad(anteriores, enEdicion.productoId, cantidadTecleada),
    );
    setEnEdicion(null);
    setCantidadTecleada('');
  }, [enEdicion, cantidadTecleada]);

  const quitarLinea = useCallback((productoId: string): void => {
    setLineas((anteriores) => quitarDelTicket(anteriores, productoId));
  }, []);

  const vaciarTicket = useCallback((): void => {
    setLineas([]);
    setConfirmandoVaciar(false);
    setEnEdicion(null);
    setUltimaVenta(null);
    setUltimoRecibo(null);
  }, []);

  // El papel de la última venta, después de cerrado el diálogo. Solo se avisa
  // lo que NO salió: que sí salió ya lo ve la cajera en la mano, y un aviso
  // verde por venta sería ruido.
  const papelDelUltimoRecibo =
    ultimoRecibo === null ? null : estadoDelPapel(ultimoRecibo, impresionTerminada);

  const turno = estado?.turnoAbierto ?? null;

  const resumenDelTurno = useMemo(() => {
    if (turno === null) {
      return null;
    }
    return `Turno abierto desde ${momentoLegible(turno.abiertaEn)} · fondo ${formatearQuetzales(turno.montoInicial)}`;
  }, [turno]);

  // -------------------------------------------------------------------------
  // Estados en los que NO se vende
  // -------------------------------------------------------------------------

  if (error !== null) {
    return (
      <div data-prueba="pantalla-de-venta">
        <p className="alerta">{error}</p>
        <div className="pie">
          <button type="button" className="boton--secundario" onClick={alVolver}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (estado === null) {
    return (
      <div data-prueba="pantalla-de-venta">
        <p className="pendiente">Consultando el estado de la caja…</p>
      </div>
    );
  }

  if (!estado.puedeVender) {
    const esDeOtro = estado.motivo === 'CAJA_DE_OTRO_USUARIO';
    return (
      <div data-prueba="pantalla-de-venta">
        <header className="encabezado">
          <h1>No se puede vender todavía</h1>
        </header>

        <section
          className="tarjeta"
          data-prueba={esDeOtro ? 'venta-bloqueada-caja-ajena' : 'venta-bloqueada-sin-caja'}
        >
          {esDeOtro ? (
            <>
              <p className="advertencia">
                La caja la abrió <strong data-prueba="abierta-por">{turno?.abiertaPorNombre}</strong>
                {turno !== null && ` el ${momentoLegible(turno.abiertaEn)}`}. No se puede vender
                en el turno de otra persona: el dinero entraría a su corte de caja.
              </p>
              <p className="nota">
                Para vender, ese turno tiene que cerrarse primero —con la autorización de un
                administrador— y después abrís el tuyo.
              </p>
            </>
          ) : (
            <>
              <p className="advertencia">
                No hay ninguna caja abierta en el sistema. Hay que abrir el turno antes de
                empezar a vender.
              </p>
              <p className="nota">
                Al abrir se cuenta el fondo con el que arranca la caja, para que el corte del
                final signifique algo.
              </p>
            </>
          )}

          <div className="acciones">
            <button type="button" data-prueba="ir-a-caja-desde-venta" onClick={alIrACaja}>
              {esDeOtro ? 'Ir a caja para cerrar ese turno' : 'Abrir caja'}
            </button>
            <button type="button" className="boton--secundario" onClick={alVolver}>
              Volver
            </button>
          </div>
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Venta
  // -------------------------------------------------------------------------

  return (
    <div className="venta" data-prueba="pantalla-de-venta">
      <header className="venta__barra">
        <div className="venta__turno" data-prueba="venta-turno">
          <span className="venta__punto" aria-hidden="true" />
          {resumenDelTurno}
        </div>
        <div className="venta__espacio" />
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </header>

      {ultimaVenta !== null && (
        <p className="aviso-exito" data-prueba="venta-registrada">
          {ultimaVenta}
        </p>
      )}

      {ultimoRecibo !== null && papelDelUltimoRecibo?.tipo === 'no-impreso' && (
        <p className="advertencia" data-prueba="venta-papel-del-recibo">
          Recibo No. {ultimoRecibo.numeroRecibo}: {papelDelUltimoRecibo.mensaje}
        </p>
      )}

      <div className="venta__cuerpo">
        <CuadriculaDeProductos
          productos={estado.productos}
          categorias={estado.categorias}
          categoriaActiva={categoriaActiva}
          alElegirCategoria={setCategoriaActiva}
          busqueda={busqueda}
          alBuscar={setBusqueda}
          alTocarProducto={tocarProducto}
        />

        <TicketDeVenta
          lineas={lineas}
          lineaEnEdicion={enEdicion?.productoId ?? null}
          alTocarLinea={abrirEdicion}
          alQuitarLinea={quitarLinea}
          alVaciar={() => {
            setConfirmandoVaciar(true);
          }}
          alCobrar={() => {
            setEnEdicion(null);
            setCobrando(true);
          }}
        />
      </div>

      {cobrando && (
        <DialogoDeCobro
          lineas={lineas}
          alCancelar={() => {
            setCobrando(false);
          }}
          impresionTerminada={impresionTerminada}
          alTerminar={(venta) => {
            // LA PANTALLA VUELVE A CERO. El ticket se vacía, el diálogo se
            // cierra y se relee el catálogo, que acaba de cambiar.
            setCobrando(false);
            setLineas([]);
            setEnEdicion(null);
            setCantidadTecleada('');
            setBusqueda('');
            setUltimoRecibo(venta.recibo);
            setUltimaVenta(
              `Venta registrada por ${formatearQuetzales(venta.total)}. Lista para la siguiente.`,
            );
            setRecarga((vuelta) => vuelta + 1);
          }}
        />
      )}

      {/* Corrección de cantidad con el mismo teclado táctil del PIN. */}
      {enEdicion !== null && (
        <div className="capa-modal">
          <section className="modal" data-prueba="editar-cantidad">
            <h2>{enEdicion.nombre}</h2>
            <p className="modal__texto">
              Lleva {cantidadLegible(enEdicion.cantidad)} {unidadDe(enEdicion)}. Escribí la
              cantidad correcta.
            </p>

            <TecladoNumerico
              valor={cantidadTecleada}
              alCambiar={setCantidadTecleada}
              alConfirmar={confirmarCantidad}
              modo="cantidad"
              decimales={decimalesDe(enEdicion.tipoMedida)}
              leyenda={unidadDe(enEdicion)}
            />

            <div className="modal__acciones">
              <button
                type="button"
                className="boton--secundario"
                data-prueba="cancelar-edicion"
                onClick={() => {
                  setEnEdicion(null);
                  setCantidadTecleada('');
                }}
              >
                Cancelar
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Vaciar el ticket borra el trabajo de varios minutos: se confirma. */}
      {confirmandoVaciar && (
        <div className="capa-modal">
          <section className="modal" data-prueba="confirmar-vaciar">
            <h2>¿Cancelar la venta en curso?</h2>
            <p className="modal__texto">
              Se van a quitar los {lineas.length}{' '}
              {lineas.length === 1 ? 'producto' : 'productos'} del ticket. No se registra nada
              y el inventario no se toca.
            </p>
            <div className="modal__acciones">
              <button type="button" data-prueba="confirmar-vaciar-si" onClick={vaciarTicket}>
                Sí, vaciar el ticket
              </button>
              <button
                type="button"
                className="boton--secundario"
                data-prueba="confirmar-vaciar-no"
                onClick={() => {
                  setConfirmandoVaciar(false);
                }}
              >
                Seguir con la venta
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
