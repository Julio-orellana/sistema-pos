/**
 * terminar-aplicacion.cjs — LA ÚNICA forma en que un arnés termina la
 * aplicación de Electron que lanzó (§6.2, punto 49).
 *
 * ===========================================================================
 * POR QUÉ EXISTE
 * ===========================================================================
 * `npm run verify:pantallas:caja` terminaba a veces con código 1 DESPUÉS de
 * pasar sus 57 comprobaciones, con «Cannot read properties of undefined
 * (reading '_object')». La causa se midió forzando el orden:
 *
 *   · `app.process()` de Playwright NO devuelve un proceso guardado: le pide
 *     el objeto al registro de la conexión (`_dispatcherByGuid.get(guid)._object`
 *     en playwright-core 1.63.0). Cuando la aplicación termina, Playwright
 *     recibe el evento `close` y BORRA ese registro.
 *   · Si el arnés llama `app.process()` ANTES de que llegue ese `close`,
 *     responde; si la llama DESPUÉS, lanza exactamente ese error.
 *   · El arnés de caja cierra la aplicación a propósito al final (salida
 *     controlada con el código remoto) y después, en su `finally`, llamaba a
 *     `app.process().kill('SIGKILL')`: ganaba uno u otro según los tiempos.
 *
 * `kill()` sobre el proceso GUARDADO no lanza nunca, ni con la aplicación ya
 * terminada (medido). Por eso la regla es: el proceso se guarda JUSTO después
 * de `electron.launch()`, mientras la aplicación vive, y se termina con esta
 * función. Hay una prueba que recorre `scripts/` y falla si algún arnés mata
 * un proceso por su cuenta o encadena `.process().` (§6.2, punto 49).
 *
 * NO se usa `app.close()`: llama a `app.quit()`, que el kiosko intercepta para
 * pedir el PIN de salida controlada (§4.5), y la aplicación no cerraría nunca.
 */

'use strict';

/**
 * Termina el proceso de la aplicación SOLO si sigue vivo. No lanza nunca.
 *
 * @param {import('node:child_process').ChildProcess} proceso
 *   El que devolvió `app.process()` justo después de `electron.launch()`.
 * @returns {{ pid: number | undefined, yaHabiaTerminado: boolean }}
 */
function terminarAplicacion(proceso) {
  const yaHabiaTerminado = proceso.exitCode !== null || proceso.signalCode !== null;
  if (!yaHabiaTerminado) {
    try {
      proceso.kill('SIGKILL');
    } catch {
      // Si terminó entre la pregunta y la señal, no hay nada que terminar.
    }
  }
  return { pid: proceso.pid, yaHabiaTerminado };
}

module.exports = { terminarAplicacion };
