/**
 * El panel del ticket: las líneas de la venta en curso y su total.
 *
 * NO ESCRIBE NADA. Muestra y edita el carrito en memoria; el botón de cobrar
 * abre el diálogo que sí registra la venta, en el proceso principal.
 *
 * CUANDO UNA LÍNEA LLEVA PRECIO ESPECIAL SE VE. Se marca la línea y se muestra
 * el precio de lista tachado al lado del que se está cobrando. Aplicar una
 * rebaja en silencio dejaría al cajero sin poder explicarle al cliente de
 * dónde salió el precio, y sin poder notar que una promoción vencida sigue
 * puesta.
 */

import { formatearQuetzales } from '@shared/money';
import { MiniaturaDeProducto } from './MiniaturaDeProducto';
import {
  avisoDeInventario,
  cantidadLegible,
  descripcionDePrecioEspecial,
  subtotalDeLineaParaMostrar,
  totalDelTicketParaMostrar,
  unidadDe,
  type LineaDeTicket,
} from '../venta/ticket';

export interface TicketDeVentaProps {
  readonly lineas: readonly LineaDeTicket[];
  /** Línea que se está editando, para resaltarla. */
  readonly lineaEnEdicion: string | null;
  readonly alTocarLinea: (linea: LineaDeTicket) => void;
  readonly alQuitarLinea: (productoId: string) => void;
  readonly alVaciar: () => void;
  readonly alCobrar: () => void;
}

export function TicketDeVenta({
  lineas,
  lineaEnEdicion,
  alTocarLinea,
  alQuitarLinea,
  alVaciar,
  alCobrar,
}: TicketDeVentaProps): React.JSX.Element {
  const vacio = lineas.length === 0;
  const total = totalDelTicketParaMostrar(lineas);

  return (
    <aside className="ticket" data-prueba="ticket-de-venta">
      <header className="ticket__encabezado">
        <h2 className="ticket__titulo">Ticket</h2>
        <div className="venta__espacio" />
        <span className="ticket__conteo" data-prueba="ticket-conteo">
          {lineas.length} {lineas.length === 1 ? 'producto' : 'productos'}
        </span>
      </header>

      <div className="ticket__lineas">
        {vacio ? (
          <p className="pendiente" data-prueba="ticket-vacio">
            Tocá un producto para empezar la venta.
          </p>
        ) : (
          <ul className="ticket__lista">
            {lineas.map((linea) => {
              const aviso = avisoDeInventario(linea);
              return (
                <li
                  key={linea.productoId}
                  className={[
                    'ticket__linea',
                    lineaEnEdicion === linea.productoId ? 'ticket__linea--activa' : '',
                    linea.precioEspecial === null ? '' : 'ticket__linea--especial',
                  ]
                    .filter((clase) => clase !== '')
                    .join(' ')}
                  data-prueba="linea-de-ticket"
                  data-producto={linea.productoId}
                >
                  <button
                    type="button"
                    className="ticket__tocar"
                    data-prueba="tocar-linea"
                    onClick={() => {
                      alTocarLinea(linea);
                    }}
                  >
                    <span className="ticket__miniatura">
                      <MiniaturaDeProducto nombre={linea.nombre} fotoUrl={linea.fotoUrl} />
                    </span>
                    <span className="ticket__datos">
                      <span className="ticket__nombre">{linea.nombre}</span>
                      <span className="ticket__detalle">
                        {cantidadLegible(linea.cantidad)} {unidadDe(linea)} ·{' '}
                        {formatearQuetzales(linea.precioUnitario)} c/u
                      </span>
                    </span>
                    <span className="ticket__subtotal" data-prueba="subtotal-de-linea">
                      {formatearQuetzales(subtotalDeLineaParaMostrar(linea))}
                    </span>
                  </button>

                  {/*
                    El distintivo de precio especial va en su PROPIA fila, a lo
                    ancho de la línea, y no dentro de la columna del nombre: ahí
                    compite por espacio con el subtotal y se parte en cuatro
                    renglones. Se vio manejando la aplicación real.
                  */}
                  {linea.precioEspecial !== null && (
                    <p className="ticket__especial" data-prueba="precio-especial">
                      Precio especial · {descripcionDePrecioEspecial(linea.precioEspecial)} ·{' '}
                      antes{' '}
                      <s className="ticket__precio-viejo" data-prueba="precio-de-lista">
                        {formatearQuetzales(linea.precioBase)}
                      </s>
                    </p>
                  )}

                  {/*
                    Aviso de inventario: es de INTERFAZ solamente. Compara
                    contra el saldo que se conocía al abrir la pantalla, que
                    puede haber cambiado desde entonces. Por eso avisa y no
                    bloquea: la comprobación real y atómica ocurre al registrar
                    la venta, en su propia transacción (CLAUDE.md §4.3).
                  */}
                  {aviso !== null && (
                    <p className="ticket__aviso" data-prueba="aviso-de-inventario">
                      {aviso}
                    </p>
                  )}

                  <button
                    type="button"
                    className="ticket__quitar"
                    data-prueba="quitar-linea"
                    aria-label={`Quitar ${linea.nombre} del ticket`}
                    onClick={() => {
                      alQuitarLinea(linea.productoId);
                    }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!vacio && (
          <p className="ticket__pista">Tocá una línea para corregir su cantidad.</p>
        )}
      </div>

      <footer className="ticket__pie">
        <div className="ticket__total">
          <span className="ticket__total-etiqueta">Total</span>
          <span className="ticket__total-valor" data-prueba="total-del-ticket">
            {formatearQuetzales(total)}
          </span>
        </div>

        <div className="ticket__acciones">
          <button
            type="button"
            className="ticket__cancelar"
            data-prueba="vaciar-ticket"
            disabled={vacio}
            onClick={alVaciar}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="ticket__cobrar"
            data-prueba="cobrar"
            disabled={vacio}
            onClick={alCobrar}
          >
            <span className="ticket__cobrar-texto">COBRAR</span>
            <span className="ticket__cobrar-monto">{formatearQuetzales(total)}</span>
          </button>
        </div>
      </footer>
    </aside>
  );
}
