/**
 * El diálogo que cierra la venta: descuento, forma de pago y confirmación.
 *
 * TIENE CUATRO PASOS Y NO UNA PANTALLA SOLA, a propósito. Cada uno es una
 * decisión distinta, y en una pantalla táctil con un cliente enfrente conviene
 * una pregunta por vez:
 *
 *   1. `descuento` — opcional. Se puede saltar de un toque.
 *   2. `pago` — efectivo o tarjeta. Con tarjeta, el número de boleta.
 *   3. `autorizacion` — SOLO si el descuento pasó el tope del rol. Muestra
 *      CUÁNTO se está por autorizar antes de pedir el PIN, igual que el cierre
 *      de caja descuadrado (§4.9). El PIN lo verifica el proceso principal.
 *   4. `listo` — la venta quedó registrada. Muestra el total cobrado.
 *
 * NO CALCULA EL TOTAL QUE SE COBRA. Muestra el que resulta de las funciones
 * compartidas, pero el que se guarda lo recalcula el proceso principal contra
 * el catálogo: si el precio de un producto cambió mientras se armaba el
 * ticket, manda el de la base, no el de la pantalla.
 */

import { useState } from 'react';

import { formatearQuetzales, montoACadena } from '@shared/money';
import type { PedidoDeCobro, ResultadoDeCobro, VentaRegistrada } from '@shared/types/ipc';
import { TecladoNumerico } from './TecladoNumerico';
import {
  boletaDelBorrador,
  descuentoDelBorrador,
  problemaDelCobro,
  COBRO_EN_BLANCO,
  type BorradorDeCobro,
} from '../venta/cobro';
import {
  descuentoDelTicket,
  subtotalExactoDelTicket,
  totalDelTicketConDescuento,
  type LineaDeTicket,
} from '../venta/ticket';

/** En qué paso del cobro está el diálogo. */
type PasoDeCobro = 'descuento' | 'pago' | 'autorizacion' | 'listo';

export interface DialogoDeCobroProps {
  readonly lineas: readonly LineaDeTicket[];
  /** Cierra sin cobrar. El ticket queda intacto. */
  readonly alCancelar: () => void;
  /** La venta quedó registrada: la pantalla vacía el ticket y se recarga. */
  readonly alTerminar: (venta: VentaRegistrada) => void;
}

export function DialogoDeCobro({
  lineas,
  alCancelar,
  alTerminar,
}: DialogoDeCobroProps): React.JSX.Element {
  const [paso, setPaso] = useState<PasoDeCobro>('descuento');
  const [borrador, setBorrador] = useState<BorradorDeCobro>(COBRO_EN_BLANCO);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /** Datos de la autorización pendiente: cuánto es el tope y cuánto el exceso. */
  const [autorizacion, setAutorizacion] = useState<{
    readonly tope: string;
    readonly exceso: string;
  } | null>(null);
  const [pin, setPin] = useState('');

  /** La venta registrada, en el último paso. */
  const [registrada, setRegistrada] = useState<VentaRegistrada | null>(null);

  const descuento = descuentoDelBorrador(borrador);
  const subtotal = montoACadena(subtotalExactoDelTicket(lineas));
  const rebaja = montoACadena(descuentoDelTicket(lineas, descuento));
  const total = montoACadena(totalDelTicketConDescuento(lineas, descuento));

  /** Manda el cobro. `pinDescuento` solo va en el segundo intento. */
  async function cobrar(pinDescuento?: string): Promise<void> {
    const problema = problemaDelCobro(borrador);
    if (problema !== null) {
      setAviso(problema);
      return;
    }

    const pedido: PedidoDeCobro = {
      // Solo qué producto y cuánto. Los precios los pone el proceso principal.
      lineas: lineas.map((linea) => ({
        productoId: linea.productoId,
        cantidad: linea.cantidad,
      })),
      descuento:
        descuento === null
          ? null
          : { tipo: descuento.tipo, valor: montoACadena(descuento.valor) },
      formaPago: borrador.formaPago,
      numBoleta: boletaDelBorrador(borrador),
      ...(pinDescuento === undefined ? {} : { pinDescuento }),
    };

    setEnviando(true);
    setAviso(null);
    try {
      const respuesta = await window.pos.venta.cobrar(pedido);
      if (!respuesta.ok) {
        setAviso(respuesta.error.mensaje);
        return;
      }
      manejarResultado(respuesta.datos);
    } finally {
      setEnviando(false);
      setPin('');
    }
  }

  function manejarResultado(resultado: ResultadoDeCobro): void {
    if (resultado.registrada) {
      setRegistrada(resultado);
      setPaso('listo');
      return;
    }

    if (resultado.requiereAutorizacion && resultado.tope !== null && resultado.exceso !== null) {
      setAutorizacion({ tope: resultado.tope, exceso: resultado.exceso });
      setPaso('autorizacion');
      // El mensaje del primer rechazo no es un error: es la explicación de por
      // qué hace falta el PIN, y ya se muestra completa en el paso. Un segundo
      // rechazo —PIN equivocado o candado cerrado— sí se muestra como aviso.
      setAviso(autorizacion === null ? null : resultado.mensaje);
      return;
    }

    setAviso(resultado.mensaje);
  }

  // =========================================================================
  // Paso 4: la venta quedó registrada
  // =========================================================================
  if (paso === 'listo' && registrada !== null) {
    return (
      <div className="capa-modal">
        <section className="modal cobro" data-prueba="cobro-listo">
          <h2 className="cobro__titulo-listo">Venta registrada</h2>

          <p className="cobro__total-cobrado" data-prueba="cobro-total-cobrado">
            {formatearQuetzales(registrada.total)}
          </p>
          <p className="modal__texto">
            {registrada.lineas} {registrada.lineas === 1 ? 'producto' : 'productos'} ·{' '}
            {registrada.formaPago === 'efectivo' ? 'Efectivo' : 'Tarjeta'}
            {registrada.numBoleta === null ? '' : ` · boleta ${registrada.numBoleta}`}
          </p>

          {/*
            SI EL RECIBO SALIÓ POR LA IMPRESORA O NO, dicho en el mismo aviso.
            No es un detalle técnico: si no salió, el cajero tiene que decírselo
            al cliente en ese momento, no descubrirlo cuando el cliente estire
            la mano esperando un papel.
          */}
          <p
            className={registrada.recibo.impreso ? 'aviso-exito' : 'advertencia'}
            data-prueba="cobro-estado-del-recibo"
          >
            Recibo No. {registrada.recibo.numeroRecibo}.{' '}
            {registrada.recibo.impreso
              ? 'Se imprimió.'
              : registrada.recibo.mensajeDeImpresion}
          </p>

          {/*
            La referencia fina sigue siendo el id de la venta, para poder
            rastrearla en la base. El número que una persona canta o anota es el
            del recibo, y va arriba, junto al estado de la impresión.
          */}
          <p className="cobro__referencia" data-prueba="cobro-referencia">
            Referencia {registrada.ventaId}
          </p>

          <div className="modal__acciones">
            <button
              type="button"
              data-prueba="cobro-siguiente-venta"
              onClick={() => {
                alTerminar(registrada);
              }}
            >
              Siguiente venta
            </button>
          </div>
        </section>
      </div>
    );
  }

  // =========================================================================
  // Paso 3: autorización del descuento excedido
  // =========================================================================
  if (paso === 'autorizacion' && autorizacion !== null) {
    return (
      <div className="capa-modal">
        <section className="modal cobro" data-prueba="cobro-autorizacion">
          <h2>Autorización de descuento</h2>

          {/*
            SE MUESTRA QUÉ SE ESTÁ POR AUTORIZAR ANTES DE PEDIR EL CÓDIGO. Es
            el mismo criterio del cierre de caja descuadrado: quien teclea su
            PIN tiene que ver el número que está aprobando.
          */}
          <dl className="cobro__resumen">
            <div className="cobro__fila">
              <dt>Descuento pedido</dt>
              {/*
                Se muestra el valor NORMALIZADO a dos decimales, el mismo que
                se va a guardar, y no lo tecleado: escrito «10» al lado de un
                tope «10.00 %» parecen dos números de escalas distintas.
              */}
              <dd data-prueba="cobro-descuento-pedido">
                {borrador.tipoDeDescuento === 'porcentaje'
                  ? `${montoACadena(descuento?.valor ?? 0)} %`
                  : formatearQuetzales(descuento?.valor ?? 0)}
              </dd>
            </div>
            <div className="cobro__fila">
              <dt>Tope de tu rol</dt>
              <dd data-prueba="cobro-tope">
                {borrador.tipoDeDescuento === 'porcentaje'
                  ? `${autorizacion.tope} %`
                  : formatearQuetzales(autorizacion.tope)}
              </dd>
            </div>
            <div className="cobro__fila cobro__fila--fuerte">
              <dt>Se pasa por</dt>
              <dd data-prueba="cobro-exceso">
                {borrador.tipoDeDescuento === 'porcentaje'
                  ? `${autorizacion.exceso} %`
                  : formatearQuetzales(autorizacion.exceso)}
              </dd>
            </div>
          </dl>

          <p className="modal__texto">
            Un administrador tiene que autorizarlo con su PIN. Este código no se puede dar
            por teléfono: el PIN remoto sirve solo para las diferencias de caja.
          </p>

          {aviso !== null && (
            <p className="alerta" data-prueba="cobro-aviso">
              {aviso}
            </p>
          )}

          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => {
              void cobrar(pin);
            }}
            deshabilitado={enviando}
          />

          <div className="modal__acciones">
            <button
              type="button"
              className="boton--secundario"
              data-prueba="cobro-cancelar-autorizacion"
              onClick={alCancelar}
            >
              Cancelar la venta
            </button>
          </div>
        </section>
      </div>
    );
  }

  // =========================================================================
  // Pasos 1 y 2: descuento y forma de pago
  // =========================================================================
  return (
    <div className="capa-modal">
      <section className="modal cobro" data-prueba="dialogo-de-cobro">
        <h2>{paso === 'descuento' ? 'Descuento' : 'Forma de pago'}</h2>

        <dl className="cobro__resumen">
          <div className="cobro__fila">
            <dt>Subtotal</dt>
            <dd data-prueba="cobro-subtotal">{formatearQuetzales(subtotal)}</dd>
          </div>
          {descuento !== null && (
            <div className="cobro__fila">
              <dt>Descuento</dt>
              <dd data-prueba="cobro-rebaja">− {formatearQuetzales(rebaja)}</dd>
            </div>
          )}
          <div className="cobro__fila cobro__fila--fuerte">
            <dt>Total</dt>
            <dd data-prueba="cobro-total">{formatearQuetzales(total)}</dd>
          </div>
        </dl>

        {paso === 'descuento' && (
          <div className="cobro__bloque">
            <div className="cobro__opciones" role="group" aria-label="Tipo de descuento">
              <button
                type="button"
                className={
                  borrador.tipoDeDescuento === null
                    ? 'cobro__opcion cobro__opcion--activa'
                    : 'cobro__opcion'
                }
                data-prueba="descuento-ninguno"
                onClick={() => {
                  setBorrador({ ...borrador, tipoDeDescuento: null, valorDeDescuento: '' });
                  setAviso(null);
                }}
              >
                Sin descuento
              </button>
              <button
                type="button"
                className={
                  borrador.tipoDeDescuento === 'porcentaje'
                    ? 'cobro__opcion cobro__opcion--activa'
                    : 'cobro__opcion'
                }
                data-prueba="descuento-porcentaje"
                onClick={() => {
                  setBorrador({ ...borrador, tipoDeDescuento: 'porcentaje' });
                  setAviso(null);
                }}
              >
                Porcentaje
              </button>
              <button
                type="button"
                className={
                  borrador.tipoDeDescuento === 'monto_fijo'
                    ? 'cobro__opcion cobro__opcion--activa'
                    : 'cobro__opcion'
                }
                data-prueba="descuento-monto"
                onClick={() => {
                  setBorrador({ ...borrador, tipoDeDescuento: 'monto_fijo' });
                  setAviso(null);
                }}
              >
                Quetzales
              </button>
            </div>

            {borrador.tipoDeDescuento !== null && (
              <label className="campo">
                <span className="campo__etiqueta">
                  {borrador.tipoDeDescuento === 'porcentaje'
                    ? 'Porcentaje de descuento'
                    : 'Descuento en quetzales'}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="campo__entrada"
                  data-prueba="descuento-valor"
                  value={borrador.valorDeDescuento}
                  autoFocus
                  onChange={(evento) => {
                    setBorrador({ ...borrador, valorDeDescuento: evento.target.value });
                    setAviso(null);
                  }}
                />
              </label>
            )}
          </div>
        )}

        {paso === 'pago' && (
          <div className="cobro__bloque">
            <div className="cobro__opciones" role="group" aria-label="Forma de pago">
              <button
                type="button"
                className={
                  borrador.formaPago === 'efectivo'
                    ? 'cobro__opcion cobro__opcion--activa'
                    : 'cobro__opcion'
                }
                data-prueba="pago-efectivo"
                onClick={() => {
                  // Se limpia la boleta al volver a efectivo: una venta en
                  // efectivo con boleta la rechaza la base (migración 014).
                  setBorrador({ ...borrador, formaPago: 'efectivo', numBoleta: '' });
                  setAviso(null);
                }}
              >
                Efectivo
              </button>
              <button
                type="button"
                className={
                  borrador.formaPago === 'tarjeta'
                    ? 'cobro__opcion cobro__opcion--activa'
                    : 'cobro__opcion'
                }
                data-prueba="pago-tarjeta"
                onClick={() => {
                  setBorrador({ ...borrador, formaPago: 'tarjeta' });
                  setAviso(null);
                }}
              >
                Tarjeta
              </button>
            </div>

            {borrador.formaPago === 'tarjeta' && (
              <label className="campo">
                <span className="campo__etiqueta">Número de boleta del voucher</span>
                <input
                  type="text"
                  className="campo__entrada"
                  data-prueba="pago-boleta"
                  value={borrador.numBoleta}
                  autoFocus
                  onChange={(evento) => {
                    setBorrador({ ...borrador, numBoleta: evento.target.value });
                    setAviso(null);
                  }}
                />
                <span className="campo__pista">
                  Sin este número la venta con tarjeta no se puede conciliar contra el
                  estado de cuenta.
                </span>
              </label>
            )}

            <p className="modal__texto">
              {borrador.formaPago === 'efectivo'
                ? 'El efectivo entra al cajón y suma al corte de este turno.'
                : 'La tarjeta NO suma al corte de caja: ese dinero entra por el banco.'}
            </p>
          </div>
        )}

        {aviso !== null && (
          <p className="alerta" data-prueba="cobro-aviso">
            {aviso}
          </p>
        )}

        <div className="modal__acciones">
          {paso === 'descuento' ? (
            <button
              type="button"
              data-prueba="cobro-continuar"
              disabled={enviando}
              onClick={() => {
                const problema = problemaDelCobro({ ...borrador, formaPago: 'efectivo' });
                if (problema !== null) {
                  setAviso(problema);
                  return;
                }
                setAviso(null);
                setPaso('pago');
              }}
            >
              Continuar
            </button>
          ) : (
            <button
              type="button"
              data-prueba="cobro-confirmar"
              disabled={enviando}
              onClick={() => {
                void cobrar();
              }}
            >
              {enviando ? 'Registrando…' : `Cobrar ${formatearQuetzales(total)}`}
            </button>
          )}

          <button
            type="button"
            className="boton--secundario"
            data-prueba="cobro-cancelar"
            disabled={enviando}
            onClick={() => {
              if (paso === 'pago') {
                setPaso('descuento');
                setAviso(null);
                return;
              }
              alCancelar();
            }}
          >
            {paso === 'pago' ? 'Atrás' : 'Volver al ticket'}
          </button>
        </div>
      </section>
    </div>
  );
}
