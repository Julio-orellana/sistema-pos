/**
 * Pantalla de ingreso.
 *
 * Dos pasos, pensados para una pantalla táctil de mostrador:
 *   1. Elegir el usuario, con botones grandes que se tocan sin apuntar.
 *   2. Teclear el PIN en el teclado en pantalla.
 *
 * El PIN se verifica SIEMPRE en el proceso principal. Esta pantalla no sabe
 * cuál es el PIN correcto ni tiene forma de averiguarlo.
 */

import { useCallback, useEffect, useState } from 'react';

import type { SesionIniciada, UsuarioParaIngreso } from '@shared/types/ipc';
import { LARGO_DEL_PIN } from '@shared/pin';
import { TecladoNumerico } from './TecladoNumerico';

export interface PantallaDeIngresoProps {
  /** Se llama cuando alguien ingresa correctamente. */
  readonly alIngresar: (sesion: SesionIniciada) => void;
}

export function PantallaDeIngreso({ alIngresar }: PantallaDeIngresoProps): React.JSX.Element {
  const [usuarios, setUsuarios] = useState<readonly UsuarioParaIngreso[]>([]);
  const [elegido, setElegido] = useState<UsuarioParaIngreso | null>(null);
  const [pin, setPin] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.sesion.listarUsuarios();
      if (control.signal.aborted) {
        return;
      }
      setUsuarios(respuesta.ok ? respuesta.datos : []);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const confirmar = useCallback((): void => {
    if (elegido === null || pin.length !== LARGO_DEL_PIN) {
      return;
    }
    setVerificando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.sesion.iniciar(elegido.id, pin);
      setPin('');
      setVerificando(false);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      if (respuesta.datos.autenticado && respuesta.datos.sesion !== null) {
        alIngresar(respuesta.datos.sesion);
        return;
      }

      setMensaje(respuesta.datos.mensaje);
      // Si quedó bloqueado, se vuelve a la lista y se refresca el estado.
      if (respuesta.datos.codigo === 'USUARIO_BLOQUEADO') {
        setElegido(null);
        setRecarga((anterior) => anterior + 1);
      }
    })();
  }, [alIngresar, elegido, pin]);

  if (elegido === null) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-ingreso">
        <h1>¿Quién está en la caja?</h1>
        {mensaje !== null && <p className="alerta">{mensaje}</p>}

        <div className="ingreso__usuarios">
          {usuarios.map((usuario) => (
            <button
              key={usuario.id}
              type="button"
              className="ingreso__usuario"
              data-prueba="usuario-para-ingreso"
              disabled={usuario.bloqueado}
              onClick={() => {
                setElegido(usuario);
                setPin('');
                setMensaje(null);
              }}
            >
              <span className="ingreso__nombre">{usuario.nombre}</span>
              <span className="ingreso__rol">{usuario.rol}</span>
              {usuario.bloqueado && (
                <span className="ingreso__bloqueado">
                  {/* Se informa el tiempo, nunca cuántos intentos le quedaban. */}
                  Bloqueado · {String(usuario.segundosParaReintentar ?? 0)} s
                </span>
              )}
            </button>
          ))}
          {usuarios.length === 0 && <p className="pendiente">No hay usuarios activos.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="ingreso" data-prueba="pantalla-de-pin">
      <h1>{elegido.nombre}</h1>
      <p className="subtitulo">Ingresá tu PIN de {String(LARGO_DEL_PIN)} dígitos</p>

      <TecladoNumerico
        valor={pin}
        alCambiar={setPin}
        alConfirmar={confirmar}
        deshabilitado={verificando}
      />

      {mensaje !== null && (
        <p className="alerta" data-prueba="mensaje-de-ingreso">
          {mensaje}
        </p>
      )}

      <button
        type="button"
        className="boton--secundario"
        onClick={() => {
          setElegido(null);
          setPin('');
          setMensaje(null);
        }}
      >
        Elegir otro usuario
      </button>
    </div>
  );
}
