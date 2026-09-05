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
  type SolicitudDiagnostico,
} from '@shared/types/ipc';

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
};

contextBridge.exposeInMainWorld('pos', apiPos);

// ---------------------------------------------------------------------------
// Refuerzo del modo kiosko del lado del DOM
// ---------------------------------------------------------------------------
// El proceso principal ya bloquea zoom y menú contextual. Se repite aquí
// porque son dos rutas distintas (gestos del sistema vs. eventos del DOM) y en
// una caja registradora conviene que ninguna funcione.

/** Teclas que, con Ctrl o Cmd, cambiarían el zoom del navegador. */
const TECLAS_DE_ZOOM: readonly string[] = ['+', '-', '=', '0'];

window.addEventListener(
  'contextmenu',
  (evento: MouseEvent) => {
    evento.preventDefault();
  },
  { capture: true },
);

window.addEventListener(
  'wheel',
  (evento: WheelEvent) => {
    // Ctrl+rueda (o Cmd+rueda) es el gesto de zoom del navegador.
    if (evento.ctrlKey || evento.metaKey) {
      evento.preventDefault();
    }
  },
  { capture: true, passive: false },
);

window.addEventListener(
  'keydown',
  (evento: KeyboardEvent) => {
    if ((evento.ctrlKey || evento.metaKey) && TECLAS_DE_ZOOM.includes(evento.key)) {
      evento.preventDefault();
    }
  },
  { capture: true },
);

// Bloquea el zoom por pellizco en pantallas táctiles del mostrador.
window.addEventListener(
  'gesturestart',
  (evento: Event) => {
    evento.preventDefault();
  },
  { capture: true },
);
