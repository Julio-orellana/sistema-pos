/**
 * Apertura y cierre del turno de caja.
 *
 * LA PANTALLA CONSULTA EL ESTADO REAL ANTES DE DECIDIR QUÉ MOSTRAR. Son tres
 * estados posibles, y ninguno es un botón fijo:
 *
 *   1. No hay ninguna caja abierta EN EL SISTEMA → se ofrece abrir. La palabra
 *      «cerrar» no aparece en ninguna parte.
 *   2. Hay una caja abierta y la abrió quien está en sesión → se muestra el
 *      resumen del turno y se puede cerrar directo, sin ningún código.
 *   3. Hay una caja abierta y la abrió OTRA persona → se muestra quién y
 *      cuándo, y cerrarla exige el PIN de un administrador.
 *
 * Antes, el estado se preguntaba por USUARIO: la pantalla mostraba «Abrir
 * caja» a quien no la había abierto, aunque la caja estuviera abierta por otro
 * y el cajón de dinero fuera el mismo. Ahora se pregunta por el sistema.
 *
 * Hay DOS autorizaciones posibles y son distintas, con candados distintos:
 * cerrar una caja ajena (solo PIN normal de administrador) y cerrar con
 * diferencia (acepta también el PIN remoto). Un mismo cierre puede necesitar
 * las dos, y en ese orden.
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

/** Qué está esperando la pantalla ahora mismo. */
type Autorizacion =
  | { readonly tipo: 'ninguna' }
  /** La caja la abrió otro: falta el PIN normal de un administrador. */
  | { readonly tipo: 'caja-ajena'; readonly resultado: ResultadoDeCierreIpc }
  /** La caja no cuadra: falta el código que autorice la diferencia. */
  | { readonly tipo: 'diferencia'; readonly resultado: ResultadoDeCierreIpc };

/** Fecha y hora en el formato que se lee en el mostrador. */
function momentoLegible(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? iso
    : fecha.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
}

export function PantallaDeCaja({ alVolver }: { readonly alVolver: () => void }): React.JSX.Element {
  const [denominaciones, setDenominaciones] = useState<readonly DenominacionParaContar[]>([]);
  const [turno, setTurno] = useState<TurnoAbierto | null>(null);
  const [cargado, setCargado] = useState(false);
  const [efectivo, setEfectivo] = useState<EfectivoDeclaradoIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const [autorizacion, setAutorizacion] = useState<Autorizacion>({ tipo: 'ninguna' });
  const [pin, setPin] = useState('');

  /** PIN ya verificado de la caja ajena, que hay que reenviar con el cierre. */
  const [pinDeCajaAjena, setPinDeCajaAjena] = useState<string | null>(null);

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
      setCargado(true);
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

  /**
   * Intenta cerrar. El proceso principal responde qué falta:
   * `REQUIERE_AUTORIZACION_DE_CAJA_AJENA` si la abrió otro, o
   * `REQUIERE_AUTORIZACION` si no cuadra. La pantalla no decide cuál hace
   * falta: pregunta y muestra lo que le contesten.
   */
  const cerrar = useCallback(
    (codigos: { readonly diferencia?: string; readonly cajaAjena?: string } = {}): void => {
      if (efectivo === null) {
        return;
      }
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await window.pos.caja.cerrar(
          efectivo,
          codigos.diferencia,
          codigos.cajaAjena ?? pinDeCajaAjena ?? undefined,
        );
        setTrabajando(false);
        setPin('');

        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          return;
        }
        if (respuesta.datos.cerrada) {
          setMensaje(respuesta.datos.mensaje);
          setAutorizacion({ tipo: 'ninguna' });
          setPinDeCajaAjena(null);
          setEfectivo(null);
          setRecarga((anterior) => anterior + 1);
          return;
        }

        if (respuesta.datos.codigo === 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA') {
          setAutorizacion({ tipo: 'caja-ajena', resultado: respuesta.datos });
          setMensaje(null);
          return;
        }
        if (respuesta.datos.codigo === 'REQUIERE_AUTORIZACION') {
          // El PIN de caja ajena que ya se validó se recuerda para reenviarlo
          // junto con el de la diferencia: si no, el segundo paso volvería a
          // toparse con el primero y pediría los dos códigos en bucle.
          if (codigos.cajaAjena !== undefined) {
            setPinDeCajaAjena(codigos.cajaAjena);
          }
          setAutorizacion({ tipo: 'diferencia', resultado: respuesta.datos });
          setMensaje(null);
          return;
        }

        // Un intento de autorización que falló: se muestra el motivo y se
        // conserva el diálogo para reintentar.
        setMensaje(respuesta.datos.mensaje);
      })();
    },
    [efectivo, pinDeCajaAjena],
  );

  const volverAContar = useCallback((): void => {
    setAutorizacion({ tipo: 'ninguna' });
    setPin('');
    setMensaje(null);
  }, []);

  // -------------------------------------------------------------------------
  // Diálogos de autorización
  // -------------------------------------------------------------------------

  if (autorizacion.tipo === 'caja-ajena' && turno !== null) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Cerrar una caja ajena</h1>

        {mensaje !== null && (
          <p className="alerta" data-prueba="mensaje-de-caja">
            {mensaje}
          </p>
        )}

        <div className="autorizacion" data-prueba="autorizacion-de-caja-ajena">
          {/* Quien autoriza tiene que VER qué está aprobando, igual que con
              la diferencia: de quién es la caja y desde cuándo está abierta. */}
          <div className="autorizacion__resumen">
            <div className="dato">
              <span className="dato__etiqueta">La abrió</span>
              <span className="dato__valor" data-prueba="abierta-por">
                {turno.abiertaPorNombre}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Desde</span>
              <span className="dato__valor">{momentoLegible(turno.abiertaEn)}</span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Monto inicial</span>
              <span className="dato__valor">{formatearQuetzales(turno.montoInicial)}</span>
            </div>
          </div>

          <p className="subtitulo">
            Un administrador debe autorizar con su PIN, en persona. El PIN de autorización
            remota no sirve para esto.
          </p>

          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => {
              cerrar({ cajaAjena: pin });
            }}
            deshabilitado={trabajando}
          />

          <button type="button" className="boton--secundario" onClick={volverAContar}>
            Volver a contar
          </button>
        </div>
      </div>
    );
  }

  if (autorizacion.tipo === 'diferencia') {
    const resultado = autorizacion.resultado;
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Cerrar caja</h1>

        {mensaje !== null && (
          <p className="alerta" data-prueba="mensaje-de-caja">
            {mensaje}
          </p>
        )}

        <div className="autorizacion" data-prueba="autorizacion-de-diferencia">
          <h2>La caja no cuadra</h2>

          <div className="autorizacion__resumen">
            <div className="dato">
              <span className="dato__etiqueta">Debería haber</span>
              <span className="dato__valor">{formatearQuetzales(resultado.montoEsperado)}</span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Se contó</span>
              <span className="dato__valor">{formatearQuetzales(resultado.montoReal)}</span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">
                {resultado.diferencia.startsWith('-') ? 'FALTANTE' : 'SOBRANTE'}
              </span>
              <span className="dato__valor autorizacion__diferencia" data-prueba="diferencia">
                {formatearQuetzales(resultado.diferencia.replace('-', ''))}
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
            alConfirmar={() => {
              cerrar({ diferencia: pin });
            }}
            deshabilitado={trabajando}
          />

          <button type="button" className="boton--secundario" onClick={volverAContar}>
            Volver a contar
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Los tres estados de la caja
  // -------------------------------------------------------------------------

  if (!cargado) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <p className="pendiente">Consultando el estado de la caja…</p>
      </div>
    );
  }

  const hayCaja = turno !== null;
  const esAjena = turno?.esDeOtroUsuario === true;

  return (
    <div className="ingreso" data-prueba="pantalla-de-caja">
      <h1>{hayCaja ? 'Cerrar caja' : 'Abrir caja'}</h1>

      {/* Estado 1: no hay ninguna caja abierta en todo el sistema. */}
      {!hayCaja && (
        <p className="subtitulo" data-prueba="estado-sin-caja">
          No hay ninguna caja abierta. Contá el fondo con el que arranca el turno.
        </p>
      )}

      {/* Estados 2 y 3: hay una caja abierta. Se muestra siempre el resumen. */}
      {turno !== null && (
        <div
          className="autorizacion__resumen"
          data-prueba={esAjena ? 'estado-caja-ajena' : 'estado-caja-propia'}
        >
          <div className="dato">
            <span className="dato__etiqueta">La abrió</span>
            <span className="dato__valor" data-prueba="abierta-por">
              {esAjena ? turno.abiertaPorNombre : 'Vos'}
            </span>
          </div>
          <div className="dato">
            <span className="dato__etiqueta">Desde</span>
            <span className="dato__valor">{momentoLegible(turno.abiertaEn)}</span>
          </div>
          <div className="dato">
            <span className="dato__etiqueta">Monto inicial</span>
            <span className="dato__valor">{formatearQuetzales(turno.montoInicial)}</span>
          </div>
        </div>
      )}

      {turno !== null && esAjena && (
        <p className="advertencia" data-prueba="aviso-de-caja-ajena">
          Esta caja la abrió {turno.abiertaPorNombre}. Para cerrarla hace falta la
          autorización de un administrador.
        </p>
      )}

      {mensaje !== null && (
        <p className="alerta" data-prueba="mensaje-de-caja">
          {mensaje}
        </p>
      )}

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
            if (hayCaja) {
              cerrar();
            } else {
              abrir();
            }
          }}
        >
          {!hayCaja && 'Abrir turno'}
          {hayCaja && !esAjena && 'Cerrar turno'}
          {hayCaja && esAjena && 'Cerrar turno (requiere autorización)'}
        </button>
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}
