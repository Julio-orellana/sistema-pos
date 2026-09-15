/**
 * Envoltorio común de todo manejador IPC.
 *
 * Vive aparte de register-handlers.ts para que los módulos de negocio que
 * tienen su propio archivo de manejadores usen EXACTAMENTE el mismo envoltorio
 * y no una copia con matices. Un módulo que devolviera sus errores en otro
 * formato obligaría a la interfaz a tratar cada canal distinto.
 */

import { z } from 'zod';

import { respuestaExitosa, respuestaFallida, type RespuestaIpc } from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';

/** Convierte cualquier error capturado en un mensaje legible para la bitácora. */
export function describirError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Código de la respuesta cuyo resultado no puede cruzar el puente IPC. */
export const CODIGO_RESPUESTA_NO_SERIALIZABLE = 'RESPUESTA_NO_SERIALIZABLE';

/**
 * Qué ve la persona cuando pasa. No afirma que no pasó nada: la operación
 * corrió y lo que falló fue mandar el resultado, así que pudo haber escrito.
 */
export const MENSAJE_RESPUESTA_NO_SERIALIZABLE =
  'La operación se ejecutó, pero su resultado no se pudo mostrar. Volvé a abrir esta pantalla para ver cómo quedó antes de repetirla.';

/**
 * La ruta del primer valor que el puente IPC no puede clonar, o `null`.
 *
 * El puente no clona funciones ni symbols. El caso que ya pasó (§4.42): un
 * objeto Decimal, porque decimal.js le pone `constructor` como propiedad
 * PROPIA. La ruta sale como `datos.sesion.montoInicial.constructor`, que es lo
 * que hace falta para encontrar qué manejador mandó un objeto de dominio.
 */
export function rutaDelPrimerValorNoClonable(
  valor: unknown,
  ruta = 'datos',
  vistos: Set<unknown> = new Set<unknown>(),
): string | null {
  if (typeof valor === 'function') {
    return `${ruta} es una función (${valor.name === '' ? 'anónima' : valor.name})`;
  }
  if (typeof valor === 'symbol') {
    return `${ruta} es un symbol`;
  }
  if (valor === null || typeof valor !== 'object' || vistos.has(valor)) {
    return null;
  }
  vistos.add(valor);
  for (const [clave, hijo] of Object.entries(valor)) {
    const encontrada = rutaDelPrimerValorNoClonable(hijo, `${ruta}.${clave}`, vistos);
    if (encontrada !== null) {
      return encontrada;
    }
  }
  return null;
}

/**
 * Ejecuta un manejador y devuelve siempre un sobre, nunca una excepción.
 *
 * Un `ErrorDeNegocio` viaja con SU código y SU mensaje: son textos escritos
 * para que los lea una persona frente a la pantalla ("El precio no puede ser
 * negativo"), y perderlos detrás de un genérico "La operación no pudo
 * completarse" dejaría a quien carga el catálogo sin saber qué corregir.
 * Cualquier otro error sí se generaliza: un fallo inesperado no debe filtrar
 * detalles internos a la ventana, aunque el detalle técnico igual viaja para
 * que quede en la bitácora.
 */
export async function ejecutarConRespuesta<T>(
  codigoDeError: string,
  operacion: () => T | Promise<T>,
): Promise<RespuestaIpc<T>> {
  try {
    const datos = await operacion();
    // El resultado tiene que poder cruzar el puente. Si no puede, Electron 44
    // no rechaza la llamada: la deja pendiente para siempre y la pantalla se
    // congela sin decir nada (§4.42). Se comprueba acá, en el único envoltorio
    // de los 56 canales, y se convierte en un error que la ventana sí recibe.
    try {
      structuredClone(datos);
    } catch (errorDeClonado) {
      const causa = rutaDelPrimerValorNoClonable(datos) ?? describirError(errorDeClonado);
      console.error(`[ipc] ${codigoDeError}: la respuesta no se puede mandar a la ventana: ${causa}`);
      return respuestaFallida<T>(CODIGO_RESPUESTA_NO_SERIALIZABLE, MENSAJE_RESPUESTA_NO_SERIALIZABLE, causa);
    }
    return respuestaExitosa(datos);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return respuestaFallida<T>(
        'PAYLOAD_INVALIDO',
        'Los datos enviados desde la interfaz no cumplen el contrato esperado.',
        JSON.stringify(error.issues),
      );
    }
    if (error instanceof ErrorDeNegocio) {
      return respuestaFallida<T>(
        error.codigo,
        error.mensajeParaElUsuario,
        error.causaTecnica,
      );
    }
    return respuestaFallida<T>(
      codigoDeError,
      'La operación no pudo completarse.',
      describirError(error),
    );
  }
}
