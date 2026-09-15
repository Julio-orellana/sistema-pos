/**
 * Una llamada al proceso principal que no puede dejar la pantalla congelada.
 *
 * Vive aparte de `PantallaDeCaja` para que ese archivo exporte solo el
 * componente, y para que otra pantalla la pueda usar sin copiarla.
 */

import type { RespuestaIpc } from '@shared/types/ipc';

/** Código de la respuesta que arma la PANTALLA cuando el canal no contesta. */
export const CODIGO_SIN_RESPUESTA = 'SIN_RESPUESTA_DEL_PROCESO_PRINCIPAL';

export const MENSAJE_SIN_RESPUESTA =
  'El sistema no respondió y no se sabe si la operación se completó. Volvé al menú y entrá de nuevo a Caja para ver cómo quedó antes de reintentar.';

/**
 * Cuánto se espera una respuesta del proceso principal antes de darla por
 * perdida. Ninguna operación de caja se acerca a esto: la más lenta verifica
 * un PIN con scrypt contra cada administrador, del orden de 100 ms por persona.
 */
export const LIMITE_DE_RESPUESTA_MS = 15_000;

/**
 * Llama a un canal de caja y convierte en respuesta fallida tanto un RECHAZO
 * como una llamada que NUNCA contesta.
 *
 * Existe por lo que bloqueó a Jimmy el 2026-09-15 en `v1.0.0-prueba.1`: al
 * cerrar la caja de otra persona, el proceso principal armaba una respuesta que
 * no se podía clonar («An object could not be cloned»). Medido en la app real
 * con Electron 44: la llamada NO se rechaza, queda pendiente para siempre. El
 * botón se quedaba deshabilitado sin ningún mensaje. Por eso no alcanza con un
 * `catch`: hace falta el límite de tiempo. Un fallo así tiene que VERSE.
 *
 * El mensaje no afirma que no pasó nada: si el proceso principal llegó a
 * escribir y lo que falló fue la respuesta, la caja pudo cambiar.
 */
export async function llamarAlProcesoPrincipal<T>(
  llamada: () => Promise<RespuestaIpc<T>>,
  limiteMs: number = LIMITE_DE_RESPUESTA_MS,
): Promise<RespuestaIpc<T>> {
  const sinRespuesta: RespuestaIpc<T> = {
    ok: false,
    error: { codigo: CODIGO_SIN_RESPUESTA, mensaje: MENSAJE_SIN_RESPUESTA },
  };
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencida = new Promise<RespuestaIpc<T>>((resolver) => {
    temporizador = setTimeout(() => {
      resolver(sinRespuesta);
    }, limiteMs);
  });
  try {
    return await Promise.race([llamada(), vencida]);
  } catch {
    return sinRespuesta;
  } finally {
    clearTimeout(temporizador);
  }
}
