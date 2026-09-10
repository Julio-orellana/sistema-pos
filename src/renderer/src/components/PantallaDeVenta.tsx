/**
 * Pantalla de venta: la cuadrícula de productos y el ticket en curso.
 *
 * ALCANCE DE ESTE MÓDULO: arma el ticket EN MEMORIA. No registra la venta, no
 * descuenta inventario, no aplica descuentos, no pide forma de pago y no
 * imprime nada. El botón de cobrar avisa que esa parte llega en otro módulo.
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

import type { EstadoDeVenta, ProductoParaVender } from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { CuadriculaDeProductos, TODAS_LAS_CATEGORIAS } from './CuadriculaDeProductos';
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

  /** Aviso del botón de cobrar, que todavía no cobra. */
  const [avisoDeCobro, setAvisoDeCobro] = useState<string | null>(null);

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
  }, []);

  const tocarProducto = useCallback((producto: ProductoParaVender): void => {
    setAvisoDeCobro(null);
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
    setAvisoDeCobro(null);
  }, []);

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

      {avisoDeCobro !== null && (
        <p className="alerta" data-prueba="aviso-de-cobro">
          {avisoDeCobro}
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
            setAvisoDeCobro(
              'El cobro se habilita en el siguiente módulo. Todavía no se registra ninguna venta.',
            );
          }}
        />
      </div>

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
