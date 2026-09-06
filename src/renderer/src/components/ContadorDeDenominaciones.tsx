/**
 * Conteo de efectivo por denominación.
 *
 * El cajero cuenta lo que tiene en la mano y toca "+" por cada pieza; el total
 * lo calcula el sistema y se muestra en vivo. **Nunca se le pide además el
 * total**: si se le pidieran las dos cosas, tarde o temprano no coincidirían y
 * habría que decidir a cuál creerle.
 *
 * El total que se muestra acá es solo informativo. El que vale es el que
 * calcula el proceso principal con Decimal.js a partir de las mismas
 * cantidades.
 */

import type { DenominacionParaContar } from '@shared/types/ipc';
import { formatearQuetzales, montoACadena, multiplicar, sumar } from '@shared/money';

export interface ContadorDeDenominacionesProps {
  readonly denominaciones: readonly DenominacionParaContar[];
  /** Cantidad contada por id de denominación. */
  readonly conteo: Readonly<Record<string, number>>;
  readonly alCambiar: (conteo: Record<string, number>) => void;
  readonly deshabilitado?: boolean;
}

export function ContadorDeDenominaciones({
  denominaciones,
  conteo,
  alCambiar,
  deshabilitado = false,
}: ContadorDeDenominacionesProps): React.JSX.Element {
  const ajustar = (id: string, delta: number): void => {
    const actual = conteo[id] ?? 0;
    const nuevo = Math.max(0, actual + delta);
    alCambiar({ ...conteo, [id]: nuevo });
  };

  const total = sumar(
    ...denominaciones.map((d) => multiplicar(d.valor, conteo[d.id] ?? 0)),
  );

  return (
    <div className="contador">
      {denominaciones.map((denominacion) => {
        const cantidad = conteo[denominacion.id] ?? 0;
        return (
          <div key={denominacion.id} className="contador__fila">
            <span className="contador__valor">
              {formatearQuetzales(denominacion.valor)}
              <span className="contador__tipo">{denominacion.tipo}</span>
            </span>

            <div className="contador__controles">
              <button
                type="button"
                onClick={() => { ajustar(denominacion.id, -1); }}
                disabled={deshabilitado || cantidad === 0}
                aria-label={`Quitar una pieza de ${denominacion.valor}`}
              >
                −
              </button>
              <span className="contador__cantidad" data-prueba={`cantidad-${denominacion.valor}`}>
                {cantidad}
              </span>
              <button
                type="button"
                onClick={() => { ajustar(denominacion.id, 1); }}
                disabled={deshabilitado}
                aria-label={`Agregar una pieza de ${denominacion.valor}`}
              >
                +
              </button>
            </div>

            <span className="contador__subtotal">
              {formatearQuetzales(multiplicar(denominacion.valor, cantidad))}
            </span>
          </div>
        );
      })}

      <div className="contador__total" data-prueba="total-contado">
        <span>Total contado</span>
        <strong>{formatearQuetzales(montoACadena(total))}</strong>
      </div>
    </div>
  );
}
