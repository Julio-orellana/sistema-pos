/**
 * Apertura y cierre del turno de caja.
 *
 * Si el usuario en sesión no tiene turno abierto, muestra la apertura; si lo
 * tiene, el cierre. Nunca las dos.
 *
 * El cierre tiene dos pasos cuando la caja no cuadra: primero el sistema
 * calcula y MUESTRA la diferencia exacta, y solo después pide el código. Quien
 * autoriza —esté presente o al teléfono— tiene que ver qué está aprobando
 * antes de dictar nada.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  DenominacionParaContar,
  EfectivoDeclaradoIpc,
  ResultadoDeCierreIpc,
  TurnoAbierto,
} from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { CapturaDeEfectivo } from './CapturaDeEfectivo';
import { TecladoNumerico } from './TecladoNumerico';

export function PantallaDeCaja({ alVolver }: { readonly alVolver: () => void }): React.JSX.Element {
  const [denominaciones, setDenominaciones] = useState<readonly DenominacionParaContar[]>([]);
  const [turno, setTurno] = useState<TurnoAbierto | null>(null);
  const [efectivo, setEfectivo] = useState<EfectivoDeclaradoIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  /** Diferencia pendiente de autorizar, con su PIN. */
  const [porAutorizar, setPorAutorizar] = useState<ResultadoDeCierreIpc | null>(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.caja.estado();
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setDenominaciones(respuesta.datos.denominaciones);
        setTurno(respuesta.datos.turnoAbierto);
      } else {
        setMensaje(respuesta.error.mensaje);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const abrir = useCallback((): void => {
    if (efectivo === null) {
      return;
    }
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.caja.abrir(efectivo);
      setTrabajando(false);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setEfectivo(null);
      setRecarga((anterior) => anterior + 1);
    })();
  }, [efectivo]);

  const cerrar = useCallback(
    (codigo?: string): void => {
      if (efectivo === null) {
        return;
      }
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await window.pos.caja.cerrar(efectivo, codigo);
        setTrabajando(false);
        setPin('');

        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          return;
        }
        if (respuesta.datos.cerrada) {
          setMensaje(respuesta.datos.mensaje);
          setPorAutorizar(null);
          setEfectivo(null);
          setRecarga((anterior) => anterior + 1);
          return;
        }
        // No cerró: o hay diferencia por autorizar, o el código falló.
        setPorAutorizar(respuesta.datos);
        setMensaje(codigo === undefined ? null : respuesta.datos.mensaje);
      })();
    },
    [efectivo],
  );

  return (
    <div className="ingreso" data-prueba="pantalla-de-caja">
      <h1>{turno === null ? 'Abrir caja' : 'Cerrar caja'}</h1>

      {turno !== null && (
        <p className="subtitulo">
          Turno abierto con {formatearQuetzales(turno.montoInicial)}
        </p>
      )}

      {mensaje !== null && (
        <p className="alerta" data-prueba="mensaje-de-caja">
          {mensaje}
        </p>
      )}

      {porAutorizar === null ? (
        <>
          <CapturaDeEfectivo
            denominaciones={denominaciones}
            alCambiar={setEfectivo}
            deshabilitado={trabajando}
          />
          <div className="pie">
            <button
              type="button"
              data-prueba="confirmar-caja"
              disabled={efectivo === null || trabajando}
              onClick={() => {
                if (turno === null) {
                  abrir();
                } else {
                  cerrar();
                }
              }}
            >
              {turno === null ? 'Abrir turno' : 'Cerrar turno'}
            </button>
            <button type="button" className="boton--secundario" onClick={alVolver}>
              Volver
            </button>
          </div>
        </>
      ) : (
        <div className="autorizacion" data-prueba="autorizacion-de-diferencia">
          <h2>La caja no cuadra</h2>

          {/* Quien autoriza tiene que VER qué está aprobando antes del código. */}
          <div className="autorizacion__resumen">
            <div className="dato">
              <span className="dato__etiqueta">Debería haber</span>
              <span className="dato__valor">{formatearQuetzales(porAutorizar.montoEsperado)}</span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Se contó</span>
              <span className="dato__valor">{formatearQuetzales(porAutorizar.montoReal)}</span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">
                {porAutorizar.diferencia.startsWith('-') ? 'FALTANTE' : 'SOBRANTE'}
              </span>
              <span className="dato__valor autorizacion__diferencia" data-prueba="diferencia">
                {formatearQuetzales(porAutorizar.diferencia.replace('-', ''))}
              </span>
            </div>
          </div>

          <p className="subtitulo">
            Un administrador debe autorizar el cierre con su PIN, en persona o dictándolo
            por teléfono.
          </p>

          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => { cerrar(pin); }}
            deshabilitado={trabajando}
          />

          <button
            type="button"
            className="boton--secundario"
            onClick={() => {
              setPorAutorizar(null);
              setPin('');
              setMensaje(null);
            }}
          >
            Volver a contar
          </button>
        </div>
      )}
    </div>
  );
}
