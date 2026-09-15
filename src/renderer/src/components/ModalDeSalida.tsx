/**
 * Diálogo de salida controlada del modo kiosko.
 *
 * INVISIBLE PARA EL USUARIO DE VENTA. No hay botón, menú ni pista que lo
 * abra: solo aparece cuando el proceso principal avisa que se presionó el
 * atajo del administrador. Mientras eso no pase, este componente no dibuja
 * absolutamente nada.
 *
 * El PIN se envía al proceso principal y se verifica allá. El renderer nunca
 * conoce el PIN correcto ni decide si la salida procede.
 */

import { useEffect, useRef, useState } from 'react';

/** Largo máximo que acepta el campo, igual al del contrato IPC. */
const LARGO_MAXIMO_PIN = 12;

export function ModalDeSalida(): React.JSX.Element | null {
  const [visible, setVisible] = useState<boolean>(false);
  const [pin, setPin] = useState<string>('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<boolean>(false);
  const campoPin = useRef<HTMLInputElement>(null);

  // Suscripción al aviso del proceso principal.
  useEffect(() => {
    const darseDeBaja = window.pos.kiosko.alSolicitarSalida(() => {
      setVisible(true);
      setPin('');
      setMensaje(null);
    });
    return darseDeBaja;
  }, []);

  // El foco va al campo apenas aparece, para que el administrador pueda
  // teclear el PIN sin tocar el mouse.
  useEffect(() => {
    if (visible) {
      campoPin.current?.focus();
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  const cerrarDialogo = (): void => {
    setVisible(false);
    setPin('');
    setMensaje(null);
  };

  const confirmar = (): void => {
    setEnviando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.kiosko.confirmarSalida(pin);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        setEnviando(false);
        return;
      }

      // Si fue autorizado, el proceso principal ya está cerrando la
      // aplicación; no hace falta hacer nada más aquí.
      if (!respuesta.datos.autorizado) {
        setMensaje(respuesta.datos.mensaje);
        setPin('');
        setEnviando(false);
        campoPin.current?.focus();
      }
    })();
  };

  return (
    <div
      className="capa-modal"
      data-prueba="dialogo-salida"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-salida"
      onKeyDown={(evento) => {
        if (evento.key === 'Escape') {
          cerrarDialogo();
        }
      }}
    >
      <div className="modal">
        <h2 id="titulo-salida">Salida de administrador</h2>
        <p className="modal__texto">
          Ingresá el PIN de un administrador, en persona o dictado por teléfono, para cerrar el punto de venta de forma ordenada.
        </p>

        <input
          ref={campoPin}
          className="modal__pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={LARGO_MAXIMO_PIN}
          value={pin}
          disabled={enviando}
          onChange={(evento) => {
            // Solo dígitos: cualquier otra cosa se descarta al teclear.
            setPin(evento.target.value.replace(/[^0-9]/g, ''));
          }}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter' && !enviando) {
              confirmar();
            }
          }}
        />

        {mensaje !== null && <p className="modal__error">{mensaje}</p>}

        <div className="modal__acciones">
          <button type="button" className="boton--secundario" onClick={cerrarDialogo} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={enviando || pin.length === 0}>
            {enviando ? 'Verificando…' : 'Cerrar aplicación'}
          </button>
        </div>
      </div>
    </div>
  );
}
