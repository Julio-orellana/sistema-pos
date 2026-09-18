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
 * poder resolverlo con el cliente enfrente.
 *
 * CORREGIDO EL 2026-09-18 (spec 001). Este párrafo terminaba diciendo «El
 * recibo no muestra nada que ese cliente no haya visto ya al comprar». Desde
 * que salen dos copias, la pantalla muestra la versión COMPLETA —quién autorizó
 * un descuento y la boleta—, que el cliente ya no ve en su copia. Alcanza con
 * tener sesión porque la ve personal de la tienda, y esos datos los conoce
 * quien cobró. Reimprimir saca las dos copias.
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
 * ---------------------------------------------------------------------------
 * EL FILTRO POR MÉTODO DE PAGO Y LOS TOTALES
 * ---------------------------------------------------------------------------
 * Desde el 2026-09-17 esta pantalla reemplaza al reporte «Cobros con tarjeta»
 * que docs/ANULACION-DE-VENTA.md §3.5 había diseñado aparte: una sola pantalla
 * con filtro es mejor que dos que muestran casi lo mismo.
 *
 * **NI EL FILTRO NI LOS TOTALES SE RESUELVEN ACÁ.** El filtro viaja al proceso
 * principal, que devuelve las filas ya filtradas Y sus totales ya sumados con
 * Decimal.js. La ventana no suma ni un centavo, por la razón de §4.15: acá no
 * hay Decimal, así que sumar sería hacerlo en punto flotante y el historial
 * diría un número distinto del que dice la base.
 *
 * **LOS TOTALES PUEDEN NO VENIR.** `totales` llega en `null` cuando quien mira
 * no tiene rol administrativo, y esa decisión la toma el proceso principal
 * (§4.40): cuánto entró a la tienda es información de dueño. La pantalla
 * dibuja la línea si le llegó y no la dibuja si no, sin preguntar el rol.
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

import type {
  FiltroDeFormaPagoIpc,
  HistorialDeRecibosIpc,
  ReciboEnHistorialIpc,
  ReciboVistoIpc,
} from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { ModalDeAnulacion } from './ModalDeAnulacion';

/** Las tres opciones del filtro, en el orden en que se dibujan. */
const FILTROS: readonly { readonly clave: FiltroDeFormaPagoIpc; readonly etiqueta: string }[] = [
  { clave: 'todas', etiqueta: 'Todas' },
  { clave: 'efectivo', etiqueta: 'Efectivo' },
  { clave: 'tarjeta', etiqueta: 'Tarjeta' },
];

export function PantallaDeRecibos({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [historial, setHistorial] = useState<HistorialDeRecibosIpc | null>(null);
  /** Por qué método de pago se está filtrando. Se lo resuelve el proceso principal. */
  const [filtro, setFiltro] = useState<FiltroDeFormaPagoIpc>('todas');
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
      const respuesta = await window.pos.recibos.listar(filtro);
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setHistorial(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
        setHistorial({ recibos: [], filtro, totales: null });
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga, filtro]);

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

  /*
    Las filas y los totales salen del MISMO sobre que devolvió el proceso
    principal, así que la línea de totales no puede ser de otro conjunto que el
    que se está dibujando.
  */
  const recibos = historial === null ? null : historial.recibos;
  const totales = historial === null ? null : historial.totales;

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
        <div className="opciones" data-prueba="filtro-de-forma-de-pago">
          {FILTROS.map((una) => (
            <button
              key={una.clave}
              type="button"
              className={filtro === una.clave ? 'opcion opcion--activa' : 'opcion'}
              data-prueba={`filtro-${una.clave}`}
              onClick={() => {
                setMensaje(null);
                setAviso(null);
                setFiltro(una.clave);
              }}
            >
              {una.etiqueta}
            </button>
          ))}
        </div>

        {/*
          LA LÍNEA DE TOTALES SOLO SE DIBUJA SI LLEGÓ. Viene en `null` cuando
          quien mira no es administrativo, y esa decisión es del proceso
          principal: acá no se consulta ningún rol.
        */}
        {totales !== null && (
          <div className="totales-del-historial" data-prueba="totales-del-historial">
            <div className="dato">
              <span className="dato__etiqueta">
                En efectivo <small>({totales.ventasEnEfectivo})</small>
              </span>
              <span className="dato__valor" data-prueba="totales-efectivo">
                {formatearQuetzales(totales.enEfectivo)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">
                Con tarjeta <small>({totales.ventasEnTarjeta})</small>
              </span>
              <span className="dato__valor" data-prueba="totales-tarjeta">
                {formatearQuetzales(totales.enTarjeta)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">
                Total <small>({totales.cantidadDeVentas})</small>
              </span>
              <span className="dato__valor" data-prueba="totales-general">
                {formatearQuetzales(totales.general)}
              </span>
            </div>
            {/*
              LO ANULADO SE INFORMA APARTE Y NO SE RESTA DE NADA: ya está fuera
              de los tres números de arriba. Se muestra para que el total se
              pueda leer sin tener que sumar las filas a mano y descubrir que
              falta algo, con el mismo criterio del renglón de descuentos del
              reporte de ventas (§4.15).
            */}
            {totales.anuladas > 0 && (
              <div className="dato reporte__referencia">
                <span className="dato__etiqueta">
                  Anuladas, fuera del total <small>({totales.anuladas})</small>
                </span>
                <span className="dato__valor" data-prueba="totales-anulado">
                  {formatearQuetzales(totales.totalAnulado)}
                </span>
              </div>
            )}
            <p className="nota">
              Los totales son de lo que se ve arriba y solo cuentan las ventas que siguen en pie:
              una venta anulada es plata que se le devolvió al cliente.
            </p>
          </div>
        )}

        {recibos === null ? (
          <p className="pendiente" data-prueba="recibos-cargando">
            Consultando los recibos…
          </p>
        ) : recibos.length === 0 ? (
          <p className="pendiente" data-prueba="recibos-vacio">
            {filtro === 'todas'
              ? 'Todavía no se emitió ningún recibo. Aparecen acá en cuanto se cobre la primera venta.'
              : `No hay ninguna venta con ${filtro === 'efectivo' ? 'efectivo' : 'tarjeta'} entre los recibos recientes.`}
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
                  {/*
                    EL VOUCHER Y SU ESTADO, solo en las ventas con tarjeta: es
                    lo que reemplaza al reporte de §3.5, y sirve para cotejar
                    contra la terminal del banco qué cobros siguen en pie.

                    El estado NO SE GUARDA en ningún lado: se deriva de la
                    existencia de la fila de anulación, que es la misma regla
                    que usan el efectivo esperado y los reportes (§1.1, §1.3).
                  */}
                  {recibo.formaPago === 'tarjeta' && (
                    <span className="lista__detalle" data-prueba="recibo-voucher">
                      Voucher {recibo.numBoleta ?? '(sin voucher)'} ·{' '}
                      <strong data-prueba="recibo-estado-tarjeta">
                        {recibo.anulacion === null
                          ? 'Activo'
                          : `Anulado el ${recibo.anulacion.fecha} ${recibo.anulacion.hora}`}
                      </strong>
                    </span>
                  )}
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
        El recibo se muestra en texto plano y con tipografía monoespaciada. No
        es una versión bonita de los mismos datos: es la misma función que
        dibuja el papel, así que lo que se ve y lo que sale del rollo no pueden
        diferir en ninguna cifra.

        CORREGIDO EL 2026-09-18 (spec 001): este comentario decía «es el mismo
        texto que se le manda a la impresora». Desde que salen dos copias, lo
        que se ve es la versión COMPLETA, que es la copia de la tienda sin su
        encabezado; la del cliente, además, no lleva quién autorizó el
        descuento ni la boleta.
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
