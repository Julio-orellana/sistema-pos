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

import { BrowserWindow, app, ipcMain } from 'electron';
import { z } from 'zod';

import {
  CANALES_IPC,
  esquemaConfirmacionDeSalida,
  esquemaSolicitudDiagnostico,
  respuestaExitosa,
  respuestaFallida,
  type DiagnosticoAplicacion,
  type DiagnosticoBaseDeDatos,
  type RespuestaIpc,
  type ResultadoIntentoDeSalida,
} from '@shared/types/ipc';
import {
  crearReceiptPrinterProvider,
  crearSyncProvider,
  leerConfiguracionAdaptadoresDelEntorno,
} from '@shared/adapters';
import { ejecutarDiagnostico } from '@main/database/connection';
import type { ControladorDeSalidaControlada } from '@main/windows/controlled-exit';

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

/** Dependencias que los manejadores necesitan del resto del proceso principal. */
export interface DependenciasDeIpc {
  /** Coordina la salida controlada del modo kiosko. */
  readonly controladorDeSalida: ControladorDeSalidaControlada;
}

/** Registra todos los manejadores IPC de la aplicación. */
export function registrarManejadoresIpc(dependencias: DependenciasDeIpc): void {
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

  ipcMain.handle(
    CANALES_IPC.solicitarSalidaControlada,
    async (evento): Promise<RespuestaIpc<boolean>> =>
      ejecutarConRespuesta('SOLICITUD_DE_SALIDA_FALLIDA', () => {
        // Se resuelve la ventana desde el propio evento: así el botón no puede
        // pedir la salida de una ventana que no es la suya.
        const ventana = BrowserWindow.fromWebContents(evento.sender);
        if (ventana === null) {
          throw new Error('No se pudo identificar la ventana que pidió la salida.');
        }
        dependencias.controladorDeSalida.solicitarPin(ventana);
        return true;
      }),
  );

  ipcMain.handle(
    CANALES_IPC.confirmarSalidaControlada,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResultadoIntentoDeSalida>> =>
      ejecutarConRespuesta('SALIDA_CONTROLADA_FALLIDA', () => {
        // El PIN se valida en la frontera antes de llegar a la comparación
        // criptográfica: un payload deforme no debe consumir un intento.
        const confirmacion = esquemaConfirmacionDeSalida.parse(payload);
        return dependencias.controladorDeSalida.confirmarSalida(confirmacion.pin);
      }),
  );
}

/** Quita los manejadores al cerrar, para no dejar canales colgados. */
export function quitarManejadoresIpc(): void {
  for (const canal of Object.values(CANALES_IPC)) {
    ipcMain.removeHandler(canal);
  }
}
