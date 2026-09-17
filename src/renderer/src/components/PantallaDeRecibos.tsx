/**
 * Historial de recibos y reimpresión.
 *
 * DÓNDE VIVE Y POR QUÉ. Es una pantalla propia, alcanzable desde el menú de
 * sesión y no desde la pantalla de venta. La razón es a quién sirve: reimprimir
 * lo pide un cliente que volvió al rato porque perdió su papel, no alguien que
 * está cobrando. Meterla dentro de la venta obligaría a abandonar un ticket a
 * medio armar para atender ese pedido.
 *
 * LA PIDE CUALQUIERA CON SESIÓN, no solo un administrador: un cajero tiene que
 * poder resolverlo con el cliente enfrente. El recibo no muestra nada que ese
 * cliente no haya visto ya al comprar.
 *
 * REIMPRIMIR REGENERA desde las filas de la venta, nunca desde el PDF que está
 * en el disco. Es lo que permite que un recibo emitido antes de cargar los
 * datos de la tienda salga con el nombre y el NIT correctos.
 *
 * ---------------------------------------------------------------------------
 * ES TAMBIÉN EL PUNTO DE ENTRADA DE LA ANULACIÓN
 * ---------------------------------------------------------------------------
 * Y no por comodidad: acá el cajero ya busca la venta por su número de recibo,
 * que es el dato que tiene a mano cuando un cliente vuelve al mostrador
 * (docs/ANULACION-DE-VENTA.md §4.3).
 *
 * EL BOTÓN «ANULAR» SOLO APARECE EN LAS VENTAS DE LA CAJA QUE SIGUE ABIERTA, y
 * en las demás **no se dibuja en absoluto**, ni siquiera apagado. Una venta de
 * una caja ya cerrada no se va a poder anular nunca más, así que un botón
 * deshabilitado con su explicación prometería algo que no existe; y una venta
 * ya anulada se marca con su etiqueta, que dice lo que pasó mejor que un botón
 * gris. Quién puede y quién no lo decide el proceso principal en
 * `sePuedeAnular`: esta pantalla dibuja lo que le llegó.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ReciboEnHistorialIpc, ReciboVistoIpc } from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { ModalDeAnulacion } from './ModalDeAnulacion';

export function PantallaDeRecibos({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [recibos, setRecibos] = useState<readonly ReciboEnHistorialIpc[] | null>(null);
  const [abierto, setAbierto] = useState<ReciboVistoIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  /** El recibo cuya venta se está anulando, o `null` si no hay ninguno. */
  const [anulando, setAnulando] = useState<ReciboEnHistorialIpc | null>(null);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.recibos.listar();
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setRecibos(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
        setRecibos([]);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const ver = useCallback((id: string): void => {
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.recibos.ver(id);
      setTrabajando(false);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setAviso(null);
      setAbierto(respuesta.datos);
    })();
  }, []);

  const reimprimir = useCallback((id: string): void => {
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.recibos.reimprimir(id);
      setTrabajando(false);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setAbierto(respuesta.datos);
      setAviso(
        `Recibo ${String(respuesta.datos.numeroRecibo)} vuelto a emitir. ` +
          respuesta.datos.mensajeDeImpresion,
      );
      setRecarga((vuelta) => vuelta + 1);
    })();
  }, []);

  return (
    <div data-prueba="pantalla-de-recibos">
      <header className="encabezado">
        <h1>Recibos</h1>
        <p className="subtitulo">
          Los comprobantes emitidos, del más reciente al más viejo. Reimprimir vuelve a armar el
          recibo con los datos guardados de esa venta y con la configuración actual del negocio.
        </p>
      </header>

      {mensaje !== null && (
        <p className="alerta" data-prueba="recibos-error">
          {mensaje}
        </p>
      )}
      {aviso !== null && (
        <p className="aviso-exito" data-prueba="recibos-aviso">
          {aviso}
        </p>
      )}

      <section className="tarjeta">
        {recibos === null ? (
          <p className="pendiente" data-prueba="recibos-cargando">
            Consultando los recibos…
          </p>
        ) : recibos.length === 0 ? (
          <p className="pendiente" data-prueba="recibos-vacio">
            Todavía no se emitió ningún recibo. Aparecen acá en cuanto se cobre la primera venta.
          </p>
        ) : (
          <ul className="lista" data-prueba="lista-de-recibos">
            {recibos.map((recibo) => (
              <li
                className="lista__fila"
                key={recibo.id}
                data-prueba="fila-de-recibo"
                data-recibo={recibo.id}
              >
                <div className="lista__principal">
                  <span className="lista__nombre">Recibo No. {recibo.numeroRecibo}</span>
                  {recibo.anulacion !== null && (
                    <span className="etiqueta" data-prueba="recibo-anulada">
                      Anulada
                    </span>
                  )}
                  {recibo.impreso && <span className="etiqueta">Impreso</span>}
                  {recibo.conDescuento && <span className="etiqueta">Con descuento</span>}
                  <span className="lista__detalle">
                    {recibo.fecha} {recibo.hora} · {recibo.cajero} ·{' '}
                    {recibo.lineas} {recibo.lineas === 1 ? 'producto' : 'productos'} ·{' '}
                    {recibo.formaPago === 'efectivo' ? 'Efectivo' : 'Tarjeta'}
                  </span>
                  {recibo.anulacion !== null && (
                    <span className="lista__detalle" data-prueba="recibo-anulacion-detalle">
                      Anulada el {recibo.anulacion.fecha} {recibo.anulacion.hora} · autorizó{' '}
                      {recibo.anulacion.autorizadaPor} · {recibo.anulacion.motivo}
                    </span>
                  )}
                </div>

                <span className="lista__nombre" data-prueba="recibo-total">
                  {formatearQuetzales(recibo.total)}
                </span>

                <div className="lista__acciones">
                  <button
                    type="button"
                    className="boton--secundario"
                    data-prueba="recibo-ver"
                    disabled={trabajando}
                    onClick={() => {
                      ver(recibo.id);
                    }}
                  >
                    Ver
                  </button>
                  <button
                    type="button"
                    data-prueba="recibo-reimprimir"
                    disabled={trabajando}
                    onClick={() => {
                      reimprimir(recibo.id);
                    }}
                  >
                    Reimprimir
                  </button>
                  {/* Solo en las ventas de la caja abierta y sin anular. Ver la
                      cabecera: en las demás no se dibuja ningún botón. */}
                  {recibo.sePuedeAnular && (
                    <button
                      type="button"
                      className="boton--secundario"
                      data-prueba="recibo-anular"
                      disabled={trabajando}
                      onClick={() => {
                        setMensaje(null);
                        setAviso(null);
                        setAnulando(recibo);
                      }}
                    >
                      Anular
                    </button>
                  )}
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

      {/*
        El recibo se muestra TAL CUAL sale en el papel, en texto plano y con
        tipografía monoespaciada. No es una versión bonita de los mismos datos:
        es el mismo texto que se le manda a la impresora, así que lo que se ve
        en pantalla y lo que sale del rollo no pueden diferir.
      */}
      {anulando !== null && (
        <ModalDeAnulacion
          recibo={anulando}
          alCancelar={() => {
            setAnulando(null);
          }}
          alTerminar={(anulacion) => {
            setAnulando(null);
            setAviso(
              `Venta del recibo ${String(anulacion.numeroRecibo ?? '')} anulada. ` +
                `Deja de contar ${formatearQuetzales(anulacion.efectivoQueDejaDeContar)} en la caja.`,
            );
            // La lista se relee: esa fila pasa a decir «Anulada» y pierde su
            // botón, y las demás pueden haber cambiado mientras tanto.
            setRecarga((vuelta) => vuelta + 1);
          }}
        />
      )}

      {abierto !== null && (
        <div className="capa-modal">
          <section className="modal modal--recibo" data-prueba="vista-de-recibo">
            <h2>Recibo No. {abierto.numeroRecibo}</h2>
            <pre className="recibo-papel" data-prueba="recibo-texto">
              {abierto.texto}
            </pre>
            <p className="modal__texto recibo-ruta" data-prueba="recibo-ruta">
              PDF: {abierto.rutaPdf}
            </p>
            <div className="modal__acciones">
              <button
                type="button"
                className="boton--secundario"
                data-prueba="cerrar-vista-de-recibo"
                onClick={() => {
                  setAbierto(null);
                }}
              >
                Cerrar
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
