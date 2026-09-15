/**
 * Autoservicio: configurar el PIN de autorización remota.
 *
 * Solo para un administrador ya autenticado, y solo sobre su propio PIN: el
 * proceso principal toma el usuario de la sesión y nunca del formulario.
 *
 * El proceso principal rechaza que este PIN sea igual al PIN normal. La razón
 * está a la vista en la pantalla, porque quien lo configura tiene que
 * entenderla: este código se dicta por teléfono, y si fuera el mismo que usa
 * para entrar, dictarlo entregaría también su sesión.
 */

import { useState } from 'react';

import { LARGO_DEL_PIN } from '@shared/pin';
import { TecladoNumerico } from './TecladoNumerico';

export function PantallaDePinRemoto({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [pin, setPin] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [paso, setPaso] = useState<'elegir' | 'confirmar' | 'listo'>('elegir');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = (repetido: string): void => {
    if (repetido !== pin) {
      setMensaje('Los dos códigos no coinciden. Empezá de nuevo.');
      setPin('');
      setConfirmacion('');
      setPaso('elegir');
      return;
    }

    setGuardando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.sesion.configurarPinRemoto(pin);
      setGuardando(false);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        setPin('');
        setConfirmacion('');
        setPaso('elegir');
        return;
      }
      setMensaje(null);
      setPaso('listo');
    })();
  };

  return (
    <div className="ingreso" data-prueba="pantalla-de-pin-remoto">
      <h1>PIN de autorización remota</h1>

      <div className="advertencia" data-prueba="advertencia-pin-remoto">
        <strong>Este código está pensado para dictarse por teléfono.</strong>
        <p>
          Sirve para autorizar a distancia, sin estar en la tienda. Por eso{' '}
          <strong>no debe ser el mismo que usás para entrar al sistema</strong> ni el que
          usás para cualquier otra cosa: quien lo escuche va a poder autorizar, y nada
          más que eso.
        </p>
      </div>

      {mensaje !== null && (
        <p className="alerta" data-prueba="mensaje-pin-remoto">
          {mensaje}
        </p>
      )}

      {paso === 'elegir' && (
        <div className="configuracion__paso">
          <p>Elegí un código de {String(LARGO_DEL_PIN)} dígitos.</p>
          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => {
              setMensaje(null);
              setConfirmacion('');
              setPaso('confirmar');
            }}
          />
        </div>
      )}

      {paso === 'confirmar' && (
        <div className="configuracion__paso">
          <p>Repetilo para confirmarlo.</p>
          <TecladoNumerico
            valor={confirmacion}
            alCambiar={setConfirmacion}
            alConfirmar={() => { guardar(confirmacion); }}
            deshabilitado={guardando}
          />
        </div>
      )}

      {paso === 'listo' && (
        <p className="configuracion__paso" data-prueba="pin-remoto-guardado">
          Código de autorización remota guardado.
        </p>
      )}

      <button type="button" className="boton--secundario" onClick={alVolver}>
        Volver
      </button>
    </div>
  );
}
