/**
 * Preload: el único puente entre el renderer y el proceso principal.
 *
 * Expone en `window.pos` una API tipada y cerrada. El renderer no recibe
 * `ipcRenderer`, ni `require`, ni acceso al sistema de archivos: si mañana un
 * componente de React quisiera leer la base de datos directamente, no tendría
 * con qué hacerlo. Eso es intencional.
 */

import { contextBridge, ipcRenderer } from 'electron';

import {
  CANALES_IPC,
  type ApiPos,
  type DiagnosticoAplicacion,
  type DiagnosticoBaseDeDatos,
  type RespuestaIpc,
  type ResultadoIntentoDeSalida,
  type SolicitudDiagnostico,
} from '@shared/types/ipc';
import { instalarBloqueosDeKioskoEnDom } from './kiosk-dom-guards';

/** Implementación concreta de la API que ve React. */
const apiPos: ApiPos = {
  diagnostico: {
    baseDeDatos: (
      solicitud: Partial<SolicitudDiagnostico> = {},
    ): Promise<RespuestaIpc<DiagnosticoBaseDeDatos>> =>
      ipcRenderer.invoke(CANALES_IPC.diagnosticoBaseDeDatos, solicitud) as Promise<
        RespuestaIpc<DiagnosticoBaseDeDatos>
      >,

    aplicacion: (): Promise<RespuestaIpc<DiagnosticoAplicacion>> =>
      ipcRenderer.invoke(CANALES_IPC.diagnosticoAplicacion) as Promise<
        RespuestaIpc<DiagnosticoAplicacion>
      >,
  },

  kiosko: {
    /**
     * El proceso principal avisa que se presionó el atajo del administrador.
     * Se entrega un callback sin datos a propósito: el renderer solo necesita
     * saber que hay que pedir el PIN, nada más.
     */
    alSolicitarSalida: (alRecibir: () => void): (() => void) => {
      const manejador = (): void => {
        alRecibir();
      };
      ipcRenderer.on(CANALES_IPC.solicitudDeSalidaControlada, manejador);
      return (): void => {
        ipcRenderer.removeListener(CANALES_IPC.solicitudDeSalidaControlada, manejador);
      };
    },

    solicitarSalida: (): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.solicitarSalidaControlada) as Promise<RespuestaIpc<boolean>>,

    confirmarSalida: (pin: string): Promise<RespuestaIpc<ResultadoIntentoDeSalida>> =>
      ipcRenderer.invoke(CANALES_IPC.confirmarSalidaControlada, { pin }) as Promise<
        RespuestaIpc<ResultadoIntentoDeSalida>
      >,
  },
};

contextBridge.exposeInMainWorld('pos', apiPos);

// Refuerzo del modo kiosko del lado del DOM. Las reglas y su prueba están en
// ./kiosk-dom-guards.ts, que se verifica con un navegador simulado.
instalarBloqueosDeKioskoEnDom(window);
