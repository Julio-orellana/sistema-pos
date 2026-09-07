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
    return respuestaExitosa(await operacion());
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
