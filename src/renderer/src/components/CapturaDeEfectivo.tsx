/**
 * Captura de efectivo en uno de los dos modos, nunca los dos a la vez.
 *
 * El selector de modo es excluyente por construcción: no existe un estado de
 * la pantalla donde estén activos los dos.
 *
 * LOS DOS MODOS SE CAPTURAN CON EL TECLADO NUMÉRICO EN PANTALLA. Hasta el
 * 2026-09-14 el modo simple era un `<input>` común, y en la pantalla táctil de
 * la tienda no aparecía ningún teclado al tocarlo: Jimmy no podía escribir el
 * efectivo contado al cerrar. Era una regresión y no una función nueva: el
 * teclado numérico ya existía para el PIN y para las cantidades del ticket.
 */

import { useState } from 'react';

import type { DenominacionParaContar, EfectivoDeclaradoIpc } from '@shared/types/ipc';
import { ContadorDeDenominaciones } from './ContadorDeDenominaciones';
import { TecladoNumerico } from './TecladoNumerico';

export interface CapturaDeEfectivoProps {
  readonly denominaciones: readonly DenominacionParaContar[];
  readonly alCambiar: (efectivo: EfectivoDeclaradoIpc | null) => void;
  readonly deshabilitado?: boolean;
  /**
   * La tecla ✓ del teclado del modo simple confirma el conteo, igual que el
   * botón de la pantalla. Sin esto habría una tecla de confirmar que no hace
   * nada al tocarla.
   */
  readonly alConfirmar?: () => void;
}

export function CapturaDeEfectivo({
  denominaciones,
  alCambiar,
  deshabilitado = false,
  alConfirmar,
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
          <span className="configuracion__etiqueta">Total en caja (Q)</span>
          {/* Dos decimales: son quetzales y centavos. El teclado ya no deja
              escribir un tercero ni un segundo punto. */}
          <TecladoNumerico
            modo="cantidad"
                  admiteCero
            decimales={2}
            leyenda="quetzales"
            valor={monto}
            deshabilitado={deshabilitado}
            alCambiar={(valor) => {
              setMonto(valor);
              alCambiar(valor.length === 0 || valor === '0.' ? null : { modo: 'simple', monto: valor });
            }}
            alConfirmar={() => {
              alConfirmar?.();
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
