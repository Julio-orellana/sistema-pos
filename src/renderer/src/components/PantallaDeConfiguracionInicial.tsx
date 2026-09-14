/**
 * Pantalla de primer arranque.
 *
 * Se muestra solo cuando la instalación no tiene NINGÚN usuario. Mientras eso
 * sea así, es la única pantalla accesible: no hay forma de llegar a la caja sin
 * que exista un administrador.
 *
 * NO HAY NINGÚN PIN POR DEFECTO EN EL CÓDIGO. El primer administrador elige su
 * PIN en este momento, y hasta entonces nadie puede entrar. Un PIN por defecto
 * conocido —aunque fuera "temporal"— quedaría en producción para siempre.
 */

import { useState } from 'react';

import type { SesionIniciada } from '@shared/types/ipc';
import { LARGO_DEL_PIN } from '@shared/pin';
import { TecladoNumerico } from './TecladoNumerico';

export interface PantallaDeConfiguracionInicialProps {
  readonly alCrear: (sesion: SesionIniciada) => void;
  /**
   * La otra forma de empezar: RESTAURAR desde la nube una terminal que se
   * perdió (fase 4.b). Solo tiene sentido con la base vacía, que es
   * exactamente el único momento en que se ve esta pantalla.
   */
  readonly alRestaurar: () => void;
}

export function PantallaDeConfiguracionInicial({
  alCrear,
  alRestaurar,
}: PantallaDeConfiguracionInicialProps): React.JSX.Element {
  const [nombre, setNombre] = useState('');
  const [pin, setPin] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [paso, setPaso] = useState<'nombre' | 'pin' | 'confirmar'>('nombre');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const crear = (pinConfirmado: string): void => {
    if (pinConfirmado !== pin) {
      setMensaje('Los dos PIN no coinciden. Empezá de nuevo.');
      setPin('');
      setConfirmacion('');
      setPaso('pin');
      return;
    }

    setCreando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.sesion.crearPrimerAdministrador(nombre.trim(), pin);
      setCreando(false);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        setPin('');
        setConfirmacion('');
        setPaso('pin');
        return;
      }
      alCrear(respuesta.datos);
    })();
  };

  return (
    <div className="ingreso" data-prueba="pantalla-de-configuracion-inicial">
      <h1>Configuración inicial</h1>
      <p className="subtitulo">
        Esta instalación todavía no tiene usuarios. Creá el primer administrador para empezar.
      </p>

      {mensaje !== null && <p className="alerta">{mensaje}</p>}

      {paso === 'nombre' && (
        <p className="nota">
          ¿Esta computadora reemplaza a una que ya tenía la tienda cargada?{' '}
          <button type="button" className="boton--secundario" data-prueba="ir-a-restauracion" onClick={alRestaurar}>
            Restaurar desde la nube
          </button>
        </p>
      )}

      {paso === 'nombre' && (
        <div className="configuracion__paso">
          <label className="configuracion__etiqueta" htmlFor="nombre-del-administrador">
            Nombre del administrador
          </label>
          <input
            id="nombre-del-administrador"
            className="configuracion__campo"
            data-prueba="campo-nombre"
            type="text"
            maxLength={80}
            value={nombre}
            onChange={(evento) => { setNombre(evento.target.value); }}
          />
          <button
            type="button"
            data-prueba="continuar-al-pin"
            disabled={nombre.trim().length === 0}
            onClick={() => {
              setMensaje(null);
              setPaso('pin');
            }}
          >
            Continuar
          </button>
        </div>
      )}

      {paso === 'pin' && (
        <div className="configuracion__paso">
          <p>Elegí un PIN de {String(LARGO_DEL_PIN)} dígitos para {nombre.trim()}.</p>
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
          <p>Repetí el PIN para confirmarlo.</p>
          <TecladoNumerico
            valor={confirmacion}
            alCambiar={setConfirmacion}
            alConfirmar={() => { crear(confirmacion); }}
            deshabilitado={creando}
          />
        </div>
      )}
    </div>
  );
}
