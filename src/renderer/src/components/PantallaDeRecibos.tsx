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
 */

import { useCallback, useEffect, useState } from 'react';

import type { ReciboEnHistorialIpc, ReciboVistoIpc } from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';

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
                  {recibo.impreso && <span className="etiqueta">Impreso</span>}
                  {recibo.conDescuento && <span className="etiqueta">Con descuento</span>}
                  <span className="lista__detalle">
                    {recibo.fecha} {recibo.hora} · {recibo.cajero} ·{' '}
                    {recibo.lineas} {recibo.lineas === 1 ? 'producto' : 'productos'} ·{' '}
                    {recibo.formaPago === 'efectivo' ? 'Efectivo' : 'Tarjeta'}
                  </span>
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
