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
 *      CUÁNTO se está por autorizar antes de pedir el código, igual que el
 *      cierre de caja descuadrado (§4.9). El código lo verifica el proceso
 *      principal, que además determina si fue el PIN normal o el remoto: al
 *      cajero nunca se le pregunta cuál de los dos le dictaron.
 *   4. `listo` — la venta quedó registrada. Muestra el total cobrado.
 *
 * NO CALCULA EL TOTAL QUE SE COBRA. Muestra el que resulta de las funciones
 * compartidas, pero el que se guarda lo recalcula el proceso principal contra
 * el catálogo: si el precio de un producto cambió mientras se armaba el
 * ticket, manda el de la base, no el de la pantalla.
 */

import { useState } from 'react';

import { formatearQuetzales, montoACadena } from '@shared/money';
import { LARGOS_DE_AUTORIZACION } from '@shared/pin';
import type {
  ImpresionDeReciboTerminadaIpc,
  PedidoDeCobro,
  ResultadoDeCobro,
  VentaRegistrada,
} from '@shared/types/ipc';
import { estadoDelPapel } from '../venta/impresion-del-recibo';
import { CampoDeTexto } from './TecladoEnPantalla';
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
  /**
   * El último aviso de impresión terminada que recibió la pantalla. El cobro
   * ya no espera a la impresora (§4.64): este aviso completa el renglón del
   * papel, y se empareja por el id del recibo.
   */
  readonly impresionTerminada: ImpresionDeReciboTerminadaIpc | null;
}

export function DialogoDeCobro({
  lineas,
  alCancelar,
  alTerminar,
  impresionTerminada,
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
    const papel = estadoDelPapel(registrada.recibo, impresionTerminada);
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
          {/*
            LA VENTA YA ESTÁ REGISTRADA aunque el papel todavía no haya salido:
            la impresora se manda en segundo plano (§4.64) y este renglón se
            completa solo cuando llega su resultado.
          */}
          <p
            className={
              papel.tipo === 'impreso'
                ? 'aviso-exito'
                : papel.tipo === 'enviando'
                  ? 'modal__texto'
                  : 'advertencia'
            }
            data-prueba="cobro-estado-del-recibo"
            data-estado={papel.tipo}
          >
            Recibo No. {registrada.recibo.numeroRecibo}.{' '}
            {papel.tipo === 'impreso'
              ? 'Se imprimió.'
              : papel.tipo === 'enviando'
                ? 'Enviando el recibo a la impresora…'
                : papel.mensaje}
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

          {/*
            SE PIDE «EL CÓDIGO DE AUTORIZACIÓN», sin preguntar cuál de los dos
            es. Desde el 2026-09-11 esta superficie acepta el PIN normal y el
            remoto, y **quién decide cuál coincidió es el proceso principal**,
            nunca el cajero: pedirle que declare si el código que le dictaron
            es el normal o el remoto sería pedirle un dato que no puede saber y
            abriría la puerta a que la auditoría registre una vía equivocada.

            Es el mismo texto que el cierre de caja descuadrado, que resolvió
            esto mismo en el Prompt 13.
          */}
          <p className="modal__texto">
            Un administrador debe autorizarlo con su PIN en persona, o dictando por teléfono
            el código de seis dígitos de su aplicación.
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
            largos={LARGOS_DE_AUTORIZACION}
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
    // Arriba y no centrado: el valor del descuento y la boleta abren el
    // teclado en pantalla, que centrado le taparía los botones de abajo.
    <div className="capa-modal capa-modal--arriba">
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
                <CampoDeTexto
                  etiqueta={
                    borrador.tipoDeDescuento === 'porcentaje'
                      ? 'Porcentaje de descuento'
                      : 'Descuento en quetzales'
                  }
                  disposicion="decimal"
                  className="campo__entrada"
                  data-prueba="descuento-valor"
                  valor={borrador.valorDeDescuento}
                  autoFocus
                  alCambiar={(valorDeDescuento) => {
                    setBorrador({ ...borrador, valorDeDescuento });
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
                <CampoDeTexto
                  etiqueta="Número de boleta del voucher"
                  mayusculaInicial={false}
                  className="campo__entrada"
                  data-prueba="pago-boleta"
                  valor={borrador.numBoleta}
                  autoFocus
                  alCambiar={(numBoleta) => {
                    setBorrador({ ...borrador, numBoleta });
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
