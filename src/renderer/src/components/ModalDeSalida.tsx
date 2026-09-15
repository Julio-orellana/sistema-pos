/**
 * Diálogo de salida controlada del modo kiosko.
 *
 * INVISIBLE PARA EL USUARIO DE VENTA. No hay botón, menú ni pista que lo
 * abra: solo aparece cuando el proceso principal avisa que se presionó el
 * atajo del administrador. Mientras eso no pase, este componente no dibuja
 * absolutamente nada.
 *
 * El PIN se envía al proceso principal y se verifica allá. El renderer nunca
 * conoce el PIN correcto ni decide si la salida procede. El candado de
 * intentos, la ventana de dos minutos y las tres vías de entrada (atajo,
 * cierre del sistema y botón) viven en `controlled-exit.ts`: este archivo solo
 * junta los dígitos.
 *
 * ---------------------------------------------------------------------------
 * EL PIN SE TECLEA EN PANTALLA (2026-09-15)
 * ---------------------------------------------------------------------------
 * Hasta ese día el PIN era un `<input type="password">` nativo: el diálogo
 * nació el 2026-09-04, dos días antes de que existiera `TecladoNumerico`, y
 * nunca se migró. En la pantalla táctil de la tienda, sin teclado físico,
 * NO HABÍA CÓMO ESCRIBIRLO. Ahora usa el mismo teclado numérico que el ingreso
 * y que todas las autorizaciones con PIN.
 *
 * Un teclado físico, si hay uno conectado, sigue sirviendo igual que antes:
 * dígitos, borrar, Enter para confirmar y Escape para cancelar. No es un
 * detalle: es como un administrador sale desde la computadora de desarrollo.
 */

import { useEffect, useRef, useState } from 'react';

import { LARGO_DEL_CODIGO_REMOTO, LARGOS_DE_AUTORIZACION } from '@shared/pin';
import { useCerrarTecladoEnPantalla } from './TecladoEnPantalla';
import { TecladoNumerico } from './TecladoNumerico';

export function ModalDeSalida(): React.JSX.Element | null {
  const [visible, setVisible] = useState<boolean>(false);
  const [pin, setPin] = useState<string>('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<boolean>(false);
  const dialogo = useRef<HTMLDivElement>(null);
  const cerrarTecladoEnPantalla = useCerrarTecladoEnPantalla();

  // Suscripción al aviso del proceso principal.
  useEffect(() => {
    const darseDeBaja = window.pos.kiosko.alSolicitarSalida(() => {
      // Si había un formulario a medio escribir, su teclado alfanumérico va
      // por encima de todo modal y taparía las teclas del PIN.
      cerrarTecladoEnPantalla();
      setVisible(true);
      setPin('');
      setMensaje(null);
    });
    return darseDeBaja;
  }, [cerrarTecladoEnPantalla]);

  // El foco va al diálogo apenas aparece, para que un teclado físico escriba
  // el PIN sin tocar el mouse y Escape lo cancele.
  useEffect(() => {
    if (visible) {
      dialogo.current?.focus();
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

  const completo = LARGOS_DE_AUTORIZACION.includes(pin.length);

  const confirmar = (): void => {
    if (!completo || enviando) {
      return;
    }
    setEnviando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.kiosko.confirmarSalida(pin);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        setPin('');
        setEnviando(false);
        dialogo.current?.focus();
        return;
      }

      // Si fue autorizado, el proceso principal ya está cerrando la
      // aplicación; no hace falta hacer nada más aquí.
      if (!respuesta.datos.autorizado) {
        setMensaje(respuesta.datos.mensaje);
        setPin('');
        setEnviando(false);
        dialogo.current?.focus();
      }
    })();
  };

  return (
    <div
      ref={dialogo}
      className="capa-modal"
      data-prueba="dialogo-salida"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-salida"
      tabIndex={-1}
      onKeyDown={(evento) => {
        if (evento.key === 'Escape') {
          cerrarDialogo();
          return;
        }
        if (enviando) {
          return;
        }
        if (/^[0-9]$/.test(evento.key)) {
          evento.preventDefault();
          setPin((anterior) =>
            anterior.length < LARGO_DEL_CODIGO_REMOTO ? anterior + evento.key : anterior,
          );
          return;
        }
        if (evento.key === 'Backspace') {
          evento.preventDefault();
          setPin((anterior) => anterior.slice(0, -1));
          return;
        }
        if (evento.key === 'Enter') {
          evento.preventDefault();
          confirmar();
        }
      }}
    >
      <div className="modal">
        <h2 id="titulo-salida">Salida de administrador</h2>
        <p className="modal__texto">
          Ingresá el PIN de un administrador, o el código de seis dígitos de su aplicación dictado por teléfono, para cerrar el punto de venta de forma ordenada.
        </p>

        <TecladoNumerico
          valor={pin}
          alCambiar={setPin}
          alConfirmar={confirmar}
          deshabilitado={enviando}
          largos={LARGOS_DE_AUTORIZACION}
        />

        {mensaje !== null && (
          <p className="modal__error" data-prueba="mensaje-de-salida">
            {mensaje}
          </p>
        )}

        <div className="modal__acciones">
          <button type="button" className="boton--secundario" onClick={cerrarDialogo} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={enviando || !completo}>
            {enviando ? 'Verificando…' : 'Cerrar aplicación'}
          </button>
        </div>
      </div>
    </div>
  );
}
