/**
 * Punto de entrada del proceso principal de Electron.
 *
 * Orden de arranque, y el porqué de ese orden:
 *   1. abrir SQLite  — si la base no abre, no tiene sentido mostrar una caja;
 *   2. registrar IPC — para que la ventana ya encuentre sus canales al cargar;
 *   3. crear ventana — en modo kiosko.
 */

import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';

import { abrirBaseDeDatos, cerrarBaseDeDatos, ejecutarDiagnostico } from '@main/database/connection';
import { quitarManejadoresIpc, registrarManejadoresIpc } from '@main/ipc/register-handlers';
import { cargarInterfaz, crearVentanaPrincipal, describirEstadoKiosko } from '@main/windows/main-window';

/** Ruta al preload compilado, relativa a dist-electron/main. */
const RUTA_PRELOAD = join(__dirname, '../preload/index.js');

/** Carpeta del renderer compilado, relativa a dist-electron/main. */
const DIRECTORIO_RENDERER = join(__dirname, '../../dist/renderer');

/**
 * Modo de verificación de arranque (`npm run verificar`).
 *
 * Arranca la aplicación de verdad —misma ventana, misma base de datos, mismos
 * adaptadores—, imprime en la consola un informe de lo que encontró y sale,
 * sin tomarse la pantalla. Existe para que el resultado esperado del sistema
 * se pueda comparar contra el resultado real sin depender de que alguien mire
 * la pantalla y opine.
 */
const enVerificacionDeArranque = process.env.POS_VERIFICACION_ARRANQUE === '1';

/** Marca que la consola busca para extraer el informe de verificación. */
const MARCA_INFORME = 'INFORME_DE_VERIFICACION';

/**
 * Instancia única: dos copias del POS abiertas sobre la misma base de datos
 * serían una fuente segura de descuadres en el corte de caja.
 */
const obtuvoElCandado = app.requestSingleInstanceLock();
if (!obtuvoElCandado) {
  app.quit();
}

app.on('second-instance', () => {
  const [ventanaExistente] = BrowserWindow.getAllWindows();
  if (ventanaExistente !== undefined) {
    ventanaExistente.focus();
  }
});

app.whenReady().then(
  () => {
    try {
      abrirBaseDeDatos();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        'No se pudo abrir la base de datos',
        `El punto de venta no puede iniciar sin su base de datos local.\n\nDetalle: ${detalle}`,
      );
      app.quit();
      return;
    }

    registrarManejadoresIpc();

    const ventana = crearVentanaPrincipal(RUTA_PRELOAD, !enVerificacionDeArranque);
    cargarInterfaz(ventana, DIRECTORIO_RENDERER);

    if (enVerificacionDeArranque) {
      ventana.webContents.once('did-finish-load', () => {
        const informe = {
          ventana: describirEstadoKiosko(ventana),
          baseDeDatos: ejecutarDiagnostico({
            incluirConteoDeRegistros: true,
            descripcionDePrueba: 'Verificación automatizada de arranque',
          }),
        };
        console.info(`${MARCA_INFORME}${JSON.stringify(informe)}`);
        app.quit();
      });
      return;
    }

    // En macOS es normal que la aplicación siga viva sin ventanas; se recrea
    // la ventana al reactivarla desde el Dock.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const nuevaVentana = crearVentanaPrincipal(RUTA_PRELOAD);
        cargarInterfaz(nuevaVentana, DIRECTORIO_RENDERER);
      }
    });
  },
  (error: unknown) => {
    const detalle = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Error al iniciar', detalle);
    app.quit();
  },
);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  quitarManejadoresIpc();
  cerrarBaseDeDatos();
});
