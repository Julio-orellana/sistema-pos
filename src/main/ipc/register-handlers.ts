/**
 * Registro de manejadores IPC.
 *
 * Cada manejador sigue el mismo patrón, y es deliberado:
 *   1. valida el payload con zod (el renderer se trata como no confiable),
 *   2. ejecuta la operación,
 *   3. devuelve siempre un `RespuestaIpc`, nunca lanza a través del puente.
 *
 * Cuando se agregue un módulo de negocio, sus manejadores viven en su propio
 * archivo dentro de src/main/ipc/ y se registran desde aquí.
 */

import { app, ipcMain } from 'electron';
import { z } from 'zod';

import {
  CANALES_IPC,
  esquemaSolicitudDiagnostico,
  respuestaExitosa,
  respuestaFallida,
  type DiagnosticoAplicacion,
  type DiagnosticoBaseDeDatos,
  type RespuestaIpc,
} from '@shared/types/ipc';
import {
  crearReceiptPrinterProvider,
  crearSyncProvider,
  leerConfiguracionAdaptadoresDelEntorno,
} from '@shared/adapters';
import { ejecutarDiagnostico } from '@main/database/connection';

/** Convierte cualquier error capturado en un mensaje legible para la bitácora. */
function describirError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Envuelve un manejador para que ningún error escape al renderer sin formato.
 * Un fallo inesperado se convierte en una respuesta con código, no en una
 * excepción silenciosa que deje la pantalla congelada frente al cliente.
 */
async function ejecutarConRespuesta<T>(
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
    return respuestaFallida<T>(codigoDeError, 'La operación no pudo completarse.', describirError(error));
  }
}

/** Registra todos los manejadores IPC de la aplicación. */
export function registrarManejadoresIpc(): void {
  ipcMain.handle(
    CANALES_IPC.diagnosticoBaseDeDatos,
    async (_evento, payload: unknown): Promise<RespuestaIpc<DiagnosticoBaseDeDatos>> =>
      ejecutarConRespuesta('DIAGNOSTICO_BASE_DE_DATOS_FALLIDO', () => {
        const solicitud = esquemaSolicitudDiagnostico.parse(payload ?? {});
        return ejecutarDiagnostico(solicitud);
      }),
  );

  ipcMain.handle(
    CANALES_IPC.diagnosticoAplicacion,
    async (): Promise<RespuestaIpc<DiagnosticoAplicacion>> =>
      ejecutarConRespuesta('DIAGNOSTICO_APLICACION_FALLIDO', async () => {
        const configuracion = leerConfiguracionAdaptadoresDelEntorno(process.env);
        const impresora = crearReceiptPrinterProvider(configuracion);
        const sincronizador = crearSyncProvider(configuracion);
        const estadoSincronizacion = await sincronizador.consultarEstado();

        const diagnostico: DiagnosticoAplicacion = {
          nombreAplicacion: app.getName(),
          version: app.getVersion(),
          entorno: app.isPackaged ? 'produccion' : 'desarrollo',
          versionElectron: process.versions.electron,
          versionNode: process.versions.node,
          versionChrome: process.versions.chrome,
          plataforma: process.platform,
          adaptadorImpresion: impresora.nombre,
          adaptadorSincronizacion: sincronizador.nombre,
          sincronizacionSimulada: estadoSincronizacion.simulado,
        };
        return diagnostico;
      }),
  );
}

/** Quita los manejadores al cerrar, para no dejar canales colgados. */
export function quitarManejadoresIpc(): void {
  for (const canal of Object.values(CANALES_IPC)) {
    ipcMain.removeHandler(canal);
  }
}
