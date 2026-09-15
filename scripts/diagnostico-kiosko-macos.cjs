/**
 * Diagnóstico: ¿qué le hace al SISTEMA cada configuración de ventana?
 *
 * Abre una ventana de Electron con la configuración indicada, la pone en
 * primer plano y ejecuta la sonda de Swift, que lee las Presentation Options
 * que esa ventana le impuso a macOS. Sirve para comprobar —y no solo afirmar—
 * si el modo kiosko está apagando Force Quit o Cmd+Tab.
 *
 * Uso:
 *   npx electron scripts/diagnostico-kiosko-macos.cjs <kiosk|corregido> <ruta-sonda>
 *
 * ADVERTENCIA: con "kiosk", durante los ~2 segundos que dura la prueba macOS
 * deshabilita Forzar Salida y Cmd+Tab. El proceso se cierra solo, y además
 * tiene una red de seguridad que lo mata a los 8 segundos pase lo que pase.
 */

const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');

const MODO = process.argv[2] ?? 'kiosk';
const RUTA_SONDA = process.argv[3];
const MS_ANTES_DE_MEDIR = 1200;
const MS_RED_DE_SEGURIDAD = 8000;

// Red de seguridad: pase lo que pase, este proceso no sobrevive 8 segundos.
setTimeout(() => process.exit(0), MS_RED_DE_SEGURIDAD).unref?.();

/** Las dos configuraciones que se comparan. */
const CONFIGURACIONES = {
  // La que tenía el proyecto: kiosk de Electron.
  kiosk: { kiosk: true, fullscreen: true, frame: false },
  // La corregida: pantalla completa sin marco, SIN kiosk de Electron.
  corregido: { fullscreen: true, frame: false },
};

app.whenReady().then(() => {
  const ventana = new BrowserWindow({
    ...CONFIGURACIONES[MODO],
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  ventana.loadURL('data:text/html,<body style="background:%23222"></body>');

  ventana.once('ready-to-show', () => {
    ventana.show();
    ventana.focus();

    setTimeout(() => {
      let salida = '{"error":"no se pudo ejecutar la sonda"}';
      try {
        salida = execFileSync(RUTA_SONDA).toString().trim();
      } catch (error) {
        salida = JSON.stringify({ error: String(error) });
      }
      console.log(`SONDA[${MODO}]=${salida}`);
      console.log(`ventana.isKiosk()=${String(ventana.isKiosk())}`);
      console.log(`ventana.isFullScreen()=${String(ventana.isFullScreen())}`);
      ventana.destroy();
      app.exit(0);
    }, MS_ANTES_DE_MEDIR);
  });
});
