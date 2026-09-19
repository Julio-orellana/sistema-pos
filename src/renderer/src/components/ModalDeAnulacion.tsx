/**
 * Anular una venta, desde el historial de recibos.
 *
 * ---------------------------------------------------------------------------
 * CUATRO PASOS, Y EL ORDEN NO ES COSMÉTICO
 * ---------------------------------------------------------------------------
 *   1. FORMULARIO — el motivo, y el número de voucher si la venta fue con
 *      tarjeta. El voucher se pide ACÁ, antes de la vista previa, porque si no
 *      coincide con el de la venta original la anulación se rechaza y **no se
 *      llega a pedir el PIN** (§3.3 del diseño, decisión 9).
 *   2. VISTA PREVIA — qué se va a anular: el dinero que sale del cajón, el
 *      producto y la cantidad que vuelven al inventario, y los productos que
 *      hoy están desactivados. Es el patrón del descuento excedente: primero se
 *      muestra qué se autoriza, después se pide el PIN.
 *   3. AUTORIZACIÓN — de un administrador, siempre, también si quien pide ya
 *      es administrador: su PIN de cuatro dígitos en persona, o el código de
 *      seis dígitos de su app dictado por teléfono. Qué fue lo decide el largo
 *      en el proceso principal, y la vía queda en la fila y en el asiento.
 *      **Acepta el código a distancia desde el 2026-09-19, a pedido del cliente
 *      (spec 003, CLAUDE.md §4.70).** Hasta ese día este punto decía, y la
 *      razón sigue siendo cierta: «La superficie `anulacion_de_venta` no acepta
 *      el código remoto: el fraude que este control frena —cobrar, anular y
 *      quedarse con el dinero— es justo el que un teléfono no puede verificar
 *      (§4.2).»
 *   4. CONFIRMACIÓN — con los montos ya ajustados: cuánto dejó de contar la
 *      caja y cómo quedó el saldo de cada producto.
 *
 * ---------------------------------------------------------------------------
 * ESTA PANTALLA NO DECIDE NADA
 * ---------------------------------------------------------------------------
 * No valida el voucher, no mira si la caja sigue abierta, no calcula un monto
 * ni arma la vista previa: todo eso lo contesta el proceso principal por el
 * mismo canal, llamado dos veces (`pin: null` y después con el PIN). Lo único
 * que decide acá es qué botón se dibuja, y el proceso principal ya dijo en
 * `sePuedeAnular` si esta venta se puede anular.
 *
 * CANCELAR EN CUALQUIER PASO ANTES DEL PIN CORRECTO NO DEJA RASTRO: el primer
 * pedido no escribe nada, y cerrar esta ventana no llama a ningún canal. Lo que
 * sí queda escrito es un PIN **tecleado** y equivocado, con su asiento
 * `anulacion_de_venta_rechazada`, y es a propósito: probar PIN para anular una
 * venta es evidencia del mismo fraude que el control existe para frenar (§6.1).
 */

import { useCallback, useState } from 'react';

import type {
  AnulacionRegistradaIpc,
  ReciboEnHistorialIpc,
  VistaPreviaDeAnulacionIpc,
} from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { LARGOS_DE_AUTORIZACION } from '@shared/pin';
import { CampoDeTexto } from './TecladoEnPantalla';
import { TecladoNumerico } from './TecladoNumerico';
import { llamarAlProcesoPrincipal } from './llamar-al-proceso-principal';

/** Largo máximo del motivo: el mismo tope del esquema y del ajuste de inventario. */
const LARGO_MAXIMO_DEL_MOTIVO = 200;

/** Largo máximo de un voucher, el mismo que admite el cobro con tarjeta. */
const LARGO_MAXIMO_DEL_VOUCHER = 40;

/**
 * Qué se le dice a quien anula si el canal no contesta.
 *
 * No afirma que no pasó nada: si el proceso principal llegó a escribir y lo que
 * se perdió fue la respuesta, la venta puede haber quedado anulada.
 */
export const MENSAJE_SIN_RESPUESTA_AL_ANULAR =
  'El sistema no respondió y no se sabe si la venta se anuló. Cerrá esta ventana y volvé a abrir el historial para ver cómo quedó antes de reintentar.';

/** En qué paso del flujo está el diálogo. */
type PasoDeAnulacion = 'formulario' | 'vista-previa' | 'pin' | 'confirmacion';

export interface ModalDeAnulacionProps {
  readonly recibo: ReciboEnHistorialIpc;
  /** Se llama al cerrar la confirmación, con la anulación ya hecha. */
  readonly alTerminar: (anulacion: AnulacionRegistradaIpc) => void;
  /** Se llama al cancelar, en cualquier paso anterior al PIN correcto. */
  readonly alCancelar: () => void;
}

export function ModalDeAnulacion({
  recibo,
  alTerminar,
  alCancelar,
}: ModalDeAnulacionProps): React.JSX.Element {
  const [paso, setPaso] = useState<PasoDeAnulacion>('formulario');
  const [motivo, setMotivo] = useState('');
  const [voucher, setVoucher] = useState('');
  const [pin, setPin] = useState('');
  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaDeAnulacionIpc | null>(null);
  const [anulacion, setAnulacion] = useState<AnulacionRegistradaIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const conTarjeta = recibo.formaPago === 'tarjeta';

  /**
   * El pedido, con o sin PIN. Es el MISMO canal las dos veces: sin PIN valida y
   * devuelve la vista previa; con PIN autoriza y anula.
   */
  const pedir = useCallback(
    (pinTecleado: string | null): void => {
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await llamarAlProcesoPrincipal(
          () =>
            window.pos.venta.anular({
              ventaId: recibo.ventaId,
              motivo: motivo.trim(),
              // Una venta en efectivo no lleva voucher, y mandar uno se rechaza.
              voucher: conTarjeta ? voucher.trim() : null,
              pin: pinTecleado,
            }),
          undefined,
          MENSAJE_SIN_RESPUESTA_AL_ANULAR,
        );
        setTrabajando(false);
        setPin('');

        // Una validación que falla —voucher distinto, caja cerrada, unidad
        // cambiada, motivo vacío— llega como error y NO pide el PIN: se vuelve
        // al formulario, que es donde se corrige.
        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          setPaso('formulario');
          return;
        }

        if (respuesta.datos.anulada && respuesta.datos.anulacion !== null) {
          setMensaje(respuesta.datos.mensaje);
          setAnulacion(respuesta.datos.anulacion);
          setPaso('confirmacion');
          return;
        }

        // Falta el PIN, o el que se tecleó no se aceptó. En el primer caso se
        // muestra la vista previa; en el segundo se queda en el teclado con el
        // motivo del rechazo.
        setVistaPrevia(respuesta.datos.vistaPrevia);
        if (pinTecleado === null) {
          setMensaje(null);
          setPaso('vista-previa');
          return;
        }
        setMensaje(respuesta.datos.mensaje);
        setPaso('pin');
      })();
    },
    [recibo.ventaId, motivo, voucher, conTarjeta],
  );

  const faltaAlgoDelFormulario = motivo.trim() === '' || (conTarjeta && voucher.trim() === '');

  return (
    <div className="capa-modal capa-modal--arriba">
      <section className="modal" data-prueba="modal-de-anulacion" data-paso={paso}>
        <h2>Anular la venta del recibo No. {recibo.numeroRecibo}</h2>

        {mensaje !== null && (
          <p
            className={paso === 'confirmacion' ? 'aviso-exito' : 'modal__error'}
            data-prueba="anulacion-mensaje"
          >
            {mensaje}
          </p>
        )}

        {paso === 'formulario' && (
          <>
            <p className="modal__texto">
              {recibo.fecha} {recibo.hora} · {recibo.cajero} ·{' '}
              {conTarjeta ? 'Tarjeta' : 'Efectivo'} · {formatearQuetzales(recibo.total)}
            </p>

            {conTarjeta && (
              <label className="campo">
                <span className="campo__etiqueta">Número de voucher de esta venta</span>
                <CampoDeTexto
                  etiqueta="Número de voucher"
                  valor={voucher}
                  mayusculaInicial={false}
                  maxLength={LARGO_MAXIMO_DEL_VOUCHER}
                  autoFocus
                  data-prueba="anulacion-voucher"
                  alCambiar={setVoucher}
                />
                <span className="nota">
                  Tiene que ser el mismo de la venta original. La devolución del cobro se hace
                  después en la terminal del banco.
                </span>
              </label>
            )}

            <label className="campo">
              <span className="campo__etiqueta">Motivo de la anulación</span>
              <CampoDeTexto
                etiqueta="Motivo de la anulación"
                valor={motivo}
                maxLength={LARGO_MAXIMO_DEL_MOTIVO}
                autoFocus={!conTarjeta}
                placeholder="El cliente devolvió el producto…"
                data-prueba="anulacion-motivo"
                alCambiar={setMotivo}
              />
            </label>

            <div className="modal__acciones">
              <button
                type="button"
                disabled={trabajando || faltaAlgoDelFormulario}
                data-prueba="anulacion-continuar"
                onClick={() => {
                  pedir(null);
                }}
              >
                Continuar
              </button>
              <button
                type="button"
                className="boton--secundario"
                data-prueba="anulacion-cancelar"
                onClick={alCancelar}
              >
                Cancelar
              </button>
            </div>
          </>
        )}

        {paso === 'vista-previa' && vistaPrevia !== null && (
          <>
            {/* Qué se va a anular. Nunca lleva el efectivo teórico de la caja
                (§3.4): esta ventana la puede estar mirando un cajero. */}
            <p className="modal__texto" data-prueba="anulacion-aviso-devolucion">
              {vistaPrevia.avisoDeDevolucion}
            </p>

            <dl className="datos" data-prueba="anulacion-resumen">
              <dt>Total de la venta</dt>
              <dd data-prueba="anulacion-total">{formatearQuetzales(vistaPrevia.total)}</dd>
              <dt>La vendió</dt>
              <dd>{vistaPrevia.vendidaPor.nombre}</dd>
              <dt>Abrió la caja</dt>
              <dd>{vistaPrevia.cajaAbiertaPor.nombre}</dd>
              {vistaPrevia.numBoleta !== null && (
                <>
                  <dt>Voucher</dt>
                  <dd>{vistaPrevia.numBoleta}</dd>
                </>
              )}
              <dt>Motivo</dt>
              <dd data-prueba="anulacion-motivo-elegido">{motivo.trim()}</dd>
            </dl>

            <p className="campo__etiqueta">Vuelve al inventario</p>
            <ul className="lista" data-prueba="anulacion-lineas">
              {vistaPrevia.lineas.map((linea) => (
                <li className="lista__fila" key={linea.productoId} data-prueba="anulacion-linea">
                  <span className="lista__nombre">{linea.nombreSnap}</span>
                  <span className="lista__detalle">
                    {linea.cantidad} {linea.unidadSnap}
                    {!linea.productoActivo && ' · producto desactivado'}
                  </span>
                </li>
              ))}
            </ul>

            {vistaPrevia.productosDesactivados.length > 0 && (
              <p className="nota" data-prueba="anulacion-desactivados">
                {vistaPrevia.productosDesactivados.join(', ')}:{' '}
                {vistaPrevia.productosDesactivados.length === 1
                  ? 'está desactivado y se repone igual, sin reactivarse.'
                  : 'están desactivados y se reponen igual, sin reactivarse.'}
              </p>
            )}

            <div className="modal__acciones">
              <button
                type="button"
                disabled={trabajando}
                data-prueba="anulacion-autorizar"
                onClick={() => {
                  setMensaje(null);
                  setPaso('pin');
                }}
              >
                Pedir la autorización de un administrador
              </button>
              <button
                type="button"
                className="boton--secundario"
                data-prueba="anulacion-cancelar"
                onClick={alCancelar}
              >
                Cancelar
              </button>
            </div>
          </>
        )}

        {paso === 'pin' && (
          <>
            {/*
              Hasta el 2026-09-19 este texto decía «Un administrador debe
              autorizar con su PIN, en persona. El código de autorización remota
              no sirve para anular una venta.», y el teclado solo confirmaba
              cuatro dígitos. Cambió a pedido del cliente (spec 003): la
              redacción es la misma del cobro y del cierre de caja.
            */}
            <p className="subtitulo" data-prueba="anulacion-como-autorizar">
              Un administrador debe autorizar la anulación con su PIN en persona, o dictando por
              teléfono el código de seis dígitos de su aplicación.
            </p>

            <TecladoNumerico
              valor={pin}
              alCambiar={setPin}
              alConfirmar={() => {
                pedir(pin);
              }}
              deshabilitado={trabajando}
              largos={LARGOS_DE_AUTORIZACION}
            />

            <div className="modal__acciones">
              <button
                type="button"
                className="boton--secundario"
                data-prueba="anulacion-volver"
                onClick={() => {
                  setPin('');
                  setMensaje(null);
                  setPaso('vista-previa');
                }}
              >
                Volver
              </button>
              <button
                type="button"
                className="boton--secundario"
                data-prueba="anulacion-cancelar"
                onClick={alCancelar}
              >
                Cancelar
              </button>
            </div>
          </>
        )}

        {paso === 'confirmacion' && anulacion !== null && (
          <>
            <dl className="datos" data-prueba="anulacion-confirmacion">
              <dt>Total de la venta anulada</dt>
              <dd data-prueba="anulacion-hecha-total">{formatearQuetzales(anulacion.total)}</dd>
              <dt>Deja de contar en la caja</dt>
              <dd data-prueba="anulacion-efectivo">
                {formatearQuetzales(anulacion.efectivoQueDejaDeContar)}
              </dd>
              <dt>Autorizó</dt>
              <dd data-prueba="anulacion-via">
                {anulacion.autorizadaVia === 'presencial' ? 'En persona' : 'A distancia'}
              </dd>
              <dt>Motivo</dt>
              <dd>{anulacion.motivo}</dd>
            </dl>

            <p className="campo__etiqueta">Inventario repuesto</p>
            <ul className="lista" data-prueba="anulacion-repuestos">
              {anulacion.productos.map((producto) => (
                <li
                  className="lista__fila"
                  key={producto.productoId}
                  data-prueba="anulacion-repuesto"
                >
                  <span className="lista__nombre">{producto.nombreSnap}</span>
                  <span className="lista__detalle">
                    {producto.saldoAnterior} → {producto.saldoNuevo} {producto.unidadSnap}
                  </span>
                </li>
              ))}
            </ul>

            <div className="modal__acciones">
              <button
                type="button"
                data-prueba="anulacion-listo"
                onClick={() => {
                  alTerminar(anulacion);
                }}
              >
                Listo
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
