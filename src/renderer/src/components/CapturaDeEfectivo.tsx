/**
 * Captura de efectivo en uno de los dos modos, nunca los dos a la vez.
 *
 * El selector de modo es excluyente por construcción: no existe un estado de
 * la pantalla donde estén activos los dos.
 */

import { useState } from 'react';

import type { DenominacionParaContar, EfectivoDeclaradoIpc } from '@shared/types/ipc';
import { ContadorDeDenominaciones } from './ContadorDeDenominaciones';

export interface CapturaDeEfectivoProps {
  readonly denominaciones: readonly DenominacionParaContar[];
  readonly alCambiar: (efectivo: EfectivoDeclaradoIpc | null) => void;
  readonly deshabilitado?: boolean;
}

/** Deja solo dígitos y un punto decimal, para escribir un monto a mano. */
function normalizarMonto(texto: string): string {
  const limpio = texto.replace(/[^0-9.]/g, '');
  const partes = limpio.split('.');
  return partes.length <= 1 ? limpio : `${partes[0] ?? ''}.${partes.slice(1).join('')}`;
}

export function CapturaDeEfectivo({
  denominaciones,
  alCambiar,
  deshabilitado = false,
}: CapturaDeEfectivoProps): React.JSX.Element {
  const [modo, setModo] = useState<'simple' | 'detallado'>('detallado');
  const [monto, setMonto] = useState('');
  const [conteo, setConteo] = useState<Record<string, number>>({});

  const cambiarModo = (nuevo: 'simple' | 'detallado'): void => {
    setModo(nuevo);
    // Al cambiar de modo se descarta lo del otro: nunca conviven los dos.
    setMonto('');
    setConteo({});
    alCambiar(null);
  };

  return (
    <div className="captura">
      <div className="captura__modos" role="group" aria-label="Modo de captura de efectivo">
        <button
          type="button"
          data-prueba="modo-detallado"
          className={modo === 'detallado' ? 'captura__modo captura__modo--activo' : 'captura__modo'}
          onClick={() => { cambiarModo('detallado'); }}
          disabled={deshabilitado}
        >
          Contar billetes y monedas
        </button>
        <button
          type="button"
          data-prueba="modo-simple"
          className={modo === 'simple' ? 'captura__modo captura__modo--activo' : 'captura__modo'}
          onClick={() => { cambiarModo('simple'); }}
          disabled={deshabilitado}
        >
          Escribir el total
        </button>
      </div>

      {modo === 'simple' ? (
        <div className="captura__simple">
          <label className="configuracion__etiqueta" htmlFor="monto-simple">
            Total en caja (Q)
          </label>
          <input
            id="monto-simple"
            className="configuracion__campo"
            data-prueba="campo-monto"
            type="text"
            inputMode="decimal"
            value={monto}
            disabled={deshabilitado}
            onChange={(evento) => {
              const valor = normalizarMonto(evento.target.value);
              setMonto(valor);
              alCambiar(valor.length === 0 ? null : { modo: 'simple', monto: valor });
            }}
          />
        </div>
      ) : (
        <ContadorDeDenominaciones
          denominaciones={denominaciones}
          conteo={conteo}
          deshabilitado={deshabilitado}
          alCambiar={(nuevo) => {
            setConteo(nuevo);
            alCambiar({
              modo: 'detallado',
              lineas: Object.entries(nuevo).map(([denominacionId, cantidad]) => ({
                denominacionId,
                cantidad,
              })),
            });
          }}
        />
      )}
    </div>
  );
}
