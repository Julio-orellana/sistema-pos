/**
 * Punto de entrada del proceso principal de Electron.
 *
 * Orden de arranque, y el porqué de ese orden:
 *   1. abrir SQLite  — si la base no abre, no tiene sentido mostrar una caja;
 *   2. preparar la salida controlada — para que exista una forma ordenada de
 *      cerrar desde el primer segundo, y no haya que matar el proceso;
 *   3. registrar IPC — para que la ventana ya encuentre sus canales al cargar;
 *   4. crear ventana — en modo kiosko.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';

import {
  abrirBaseDeDatos,
  cerrarBaseDeDatos,
  cerrarBaseDeDatosOrdenadamente,
  ejecutarDiagnostico,
  type ResultadoCierreOrdenado,
} from '@main/database/connection';
import {
  obtenerRutaBaseDeDatos,
  obtenerRutaBaseDeDatosDeVerificacion,
} from '@main/database/db-path';
import { obtenerBaseDeDatos } from '@main/database/connection';
import { crearRepositorios } from '@main/database/repositories';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { SesionActual } from '@main/domain/usuarios/sesion';
import { generarHashDePin } from '@shared/auth';
import { quitarManejadoresIpc, registrarManejadoresIpc } from '@main/ipc/register-handlers';
import { ControladorDeSalidaControlada } from '@main/windows/controlled-exit';
import { cargarInterfaz, crearVentanaPrincipal, describirEstadoKiosko } from '@main/windows/main-window';
import { ATAJO_SALIDA_CONTROLADA, describirAtajo } from '@shared/kiosk-input';

/** Ruta al preload compilado, relativa a dist-electron/main. */
const RUTA_PRELOAD = join(__dirname, '../preload/index.js');

/** Carpeta del renderer compilado, relativa a dist-electron/main. */
const DIRECTORIO_RENDERER = join(__dirname, '../../dist/renderer');

/**
 * Modo de verificación de arranque (`npm run verify:arranque`).
 *
 * Arranca la aplicación de verdad —misma ventana, misma base de datos, mismos
 * adaptadores—, ejercita los bloqueos del kiosko dentro de la ventana real,
 * imprime un informe de lo que encontró y sale, sin tomarse la pantalla.
 * Existe para que el resultado esperado del sistema se pueda comparar contra
 * el resultado real sin depender de que alguien mire la pantalla y opine.
 */
const enVerificacionDeArranque = process.env.POS_VERIFICACION_ARRANQUE === '1';

/** Marca que la consola busca para extraer el informe de verificación. */
const MARCA_INFORME = 'INFORME_DE_VERIFICACION';

/** Evita que el cierre ordenado se ejecute dos veces. */
let cierreEnCurso = false;

/** Resultado del último cierre ordenado, que el informe de verificación lee. */
let ultimoCierre: ResultadoCierreOrdenado | null = null;

/**
 * Controlador de salida activo. Se guarda a nivel de módulo para que el cierre
 * ordenado pueda autorizarse a sí mismo y no quede atrapado por la
 * intercepción de cierres que él mismo instala.
 */
let controladorDeSalidaActivo: ControladorDeSalidaControlada | null = null;

/**
 * Cierra la aplicación de forma ordenada.
 *
 * "Ordenada" significa, en concreto: se quitan los canales IPC para que no
 * entre trabajo nuevo, se consolida el WAL de SQLite en el archivo principal y
 * recién entonces se cierra la conexión y la aplicación. Es exactamente lo que
 * NO ocurre cuando se mata el proceso desde el Administrador de tareas.
 */
function cerrarAplicacionOrdenadamente(): void {
  if (cierreEnCurso) {
    return;
  }
  cierreEnCurso = true;
  // El cierre ordenado se autoriza a sí mismo: si no, el `app.quit()` de abajo
  // volvería a caer en la intercepción y la aplicación no cerraría nunca.
  controladorDeSalidaActivo?.autorizarCierre();

  // TODO(caja): cuando exista el módulo de caja, avisarle aquí para que
  // persista el turno abierto antes de cerrar.
  // TODO(sincronizacion): vaciar la cola de cambios pendientes si hay red.

  quitarManejadoresIpc();
  ultimoCierre = cerrarBaseDeDatosOrdenadamente();
  console.info(`[cierre] ${ultimoCierre.mensaje}`);

  app.quit();
}

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
      // En verificación se usa una base descartable en la carpeta temporal: la
      // prueba necesita sembrar un administrador y no puede dejar usuarios de
      // mentira en los datos reales de la tienda.
      const ruta = enVerificacionDeArranque
        ? obtenerRutaBaseDeDatosDeVerificacion()
        : obtenerRutaBaseDeDatos();
      if (enVerificacionDeArranque) {
        rmSync(ruta, { force: true });
        rmSync(`${ruta}-wal`, { force: true });
        rmSync(`${ruta}-shm`, { force: true });
      }
      const migraciones = abrirBaseDeDatos(ruta);
      if (migraciones.aplicadasAhora.length > 0) {
        console.info(`[base-de-datos] Migraciones aplicadas: ${migraciones.aplicadasAhora.join(', ')}`);
      }
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        'No se pudo abrir la base de datos',
        `El punto de venta no puede iniciar sin su base de datos local ni sin sus migraciones aplicadas.\n\nDetalle: ${detalle}`,
      );
      app.quit();
      return;
    }

    const repositorios = crearRepositorios(obtenerBaseDeDatos());
    const autenticacion = new ServicioDeAutenticacion({
      usuarios: repositorios.usuarios,
      auditoria: repositorios.auditoria,
      bloqueosDeAutorizacion: repositorios.bloqueosDeAutorizacion,
    });
    const sesion = new SesionActual();

    const controladorDeSalida = new ControladorDeSalidaControlada({
      autenticacion,
      cerrarAplicacion: cerrarAplicacionOrdenadamente,
    });
    controladorDeSalidaActivo = controladorDeSalida;

    registrarManejadoresIpc({
      controladorDeSalida,
      autenticacion,
      sesion,
      usuarios: repositorios.usuarios,
    });

    const ventana = crearVentanaPrincipal(RUTA_PRELOAD, !enVerificacionDeArranque);
    controladorDeSalida.conectarVentana(ventana);
    interceptarCierresDelSistema(ventana, controladorDeSalida);
    cargarInterfaz(ventana, DIRECTORIO_RENDERER);

    if (enVerificacionDeArranque) {
      ventana.webContents.once('did-finish-load', () => {
        void ejecutarVerificacionDeArranque(ventana, controladorDeSalida, autenticacion);
      });
      return;
    }

    // En macOS es normal que la aplicación siga viva sin ventanas; se recrea
    // la ventana al reactivarla desde el Dock.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const nuevaVentana = crearVentanaPrincipal(RUTA_PRELOAD);
        controladorDeSalida.conectarVentana(nuevaVentana);
        interceptarCierresDelSistema(nuevaVentana, controladorDeSalida);
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

/** Resultado de ejercitar los bloqueos dentro de la ventana real. */
interface BloqueosMedidosEnLaVentana {
  readonly menuContextualBloqueado: boolean;
  readonly zoomConCtrlRuedaBloqueado: boolean;
  readonly zoomConCmdRuedaBloqueado: boolean;
  readonly ruedaSinCtrlPermitida: boolean;
  readonly zoomConTecladoBloqueado: boolean;
  readonly tecleoNormalPermitido: boolean;
}

/**
 * Ejercita los bloqueos DENTRO de la ventana real y devuelve qué pasó.
 *
 * Se despachan eventos verdaderos y se lee si quedaron cancelados. Es la
 * diferencia entre afirmar "el código llama a preventDefault" y comprobar que
 * el gesto efectivamente no ocurre en la aplicación que se va a entregar.
 */
async function medirBloqueosEnLaVentana(
  ventana: BrowserWindow,
): Promise<BloqueosMedidosEnLaVentana> {
  const guion = `(() => {
    const despachar = (evento) => { document.body.dispatchEvent(evento); return evento.defaultPrevented; };
    const rueda = (mods) => new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, ...mods });
    const tecla = (init) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    return {
      menuContextualBloqueado: despachar(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      zoomConCtrlRuedaBloqueado: despachar(rueda({ ctrlKey: true })),
      zoomConCmdRuedaBloqueado: despachar(rueda({ metaKey: true })),
      ruedaSinCtrlPermitida: !despachar(rueda({})),
      zoomConTecladoBloqueado: despachar(tecla({ ctrlKey: true, code: 'Equal', key: '+' })),
      tecleoNormalPermitido: !despachar(tecla({ code: 'Digit5', key: '5' })),
    };
  })()`;

  return (await ventana.webContents.executeJavaScript(guion)) as BloqueosMedidosEnLaVentana;
}

/**
 * Intercepta TODA vía de cierre que no sea el flujo con PIN.
 *
 * Cubre los atajos estándar del sistema operativo que macOS y Windows
 * reconocen como "salir": Cmd+Q, Alt+F4, el menú del Dock, el botón de cerrar
 * de la ventana y cualquier `app.quit()` de terceros. Todos terminan pidiendo
 * el PIN, igual que el atajo del administrador.
 *
 * Antes de esto, Cmd+Q cerraba el punto de venta de inmediato: sin PIN, sin
 * registro de auditoría y sin consolidar la base de datos.
 *
 * OJO: interceptar el cierre de la APLICACIÓN es legítimo. Lo que jamás se
 * hace es deshabilitar los mecanismos de escape del SISTEMA OPERATIVO —Forzar
 * Salida y Cmd+Tab—, que siguen funcionando siempre. Ver la sección 4.5 de
 * CLAUDE.md.
 */
function interceptarCierresDelSistema(
  ventana: BrowserWindow,
  controladorDeSalida: ControladorDeSalidaControlada,
): void {
  // Cmd+Q en macOS, el menú del Dock y cualquier app.quit() ajeno.
  app.on('before-quit', (evento) => {
    if (controladorDeSalida.evaluarIntentoDeCierre(ventana) === 'pedir-pin') {
      evento.preventDefault();
    }
  });

  // Alt+F4 en Windows y el cierre de la ventana por cualquier otra vía.
  ventana.on('close', (evento) => {
    if (controladorDeSalida.evaluarIntentoDeCierre(ventana) === 'pedir-pin') {
      evento.preventDefault();
    }
  });
}

/** Cantidad de PIN posibles con un dígito menos, para sortear uno de cuatro. */
const RANGO_DE_PIN = 9000;

/** Menor PIN de cuatro dígitos. */
const PIN_MINIMO = 1000;

/**
 * Sortea un PIN de cuatro dígitos para la verificación de arranque.
 * No hay ningún PIN por defecto en el código, tampoco para las pruebas.
 */
function generarPinAleatorioDePrueba(): string {
  return String(Math.floor(Math.random() * RANGO_DE_PIN) + PIN_MINIMO);
}

/** Milisegundos que se espera a que el atajo sintético llegue de vuelta. */
const ESPERA_MAXIMA_DEL_ATAJO_MS = 3000;

/** Intervalo entre comprobaciones mientras se espera el atajo. */
const INTERVALO_DE_ESPERA_MS = 50;

/**
 * Espera a que se cumpla una condición, sin bloquear el bucle de eventos.
 * `sendInputEvent` viaja hasta el renderer y vuelve, así que el atajo no se
 * puede leer en la misma vuelta en que se envía.
 */
async function esperarHasta(condicion: () => boolean, limiteMs: number): Promise<boolean> {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (condicion()) {
      return true;
    }
    await new Promise((continuar) => setTimeout(continuar, INTERVALO_DE_ESPERA_MS));
  }
  return condicion();
}

/** Espera a que el diálogo de PIN exista en el DOM de la ventana real. */
async function esperarDialogoDeSalida(ventana: BrowserWindow): Promise<boolean> {
  const limite = Date.now() + ESPERA_MAXIMA_DEL_ATAJO_MS;
  while (Date.now() < limite) {
    const visible = (await ventana.webContents.executeJavaScript(
      `document.querySelector('[data-prueba="dialogo-salida"]') !== null`,
    )) as boolean;
    if (visible) {
      return true;
    }
    await new Promise((continuar) => setTimeout(continuar, INTERVALO_DE_ESPERA_MS));
  }
  return false;
}

/** Arma e imprime el informe de verificación y cierra la aplicación. */
async function ejecutarVerificacionDeArranque(
  ventana: BrowserWindow,
  controladorDeSalida: ControladorDeSalidaControlada,
  autenticacion: ServicioDeAutenticacion,
): Promise<void> {
  // Se siembra un administrador con un PIN sorteado en el momento. No hay
  // ningún PIN por defecto en el código, tampoco para la verificación.
  const pinDePrueba = generarPinAleatorioDePrueba();
  const requeriaConfiguracionInicial = autenticacion.requiereConfiguracionInicial();
  autenticacion.crearPrimerAdministrador('Administrador de prueba', generarHashDePin(pinDePrueba));
  const yaNoRequiereConfiguracion = !autenticacion.requiereConfiguracionInicial();
  const bloqueos = await medirBloqueosEnLaVentana(ventana);

  // Se envía el atajo real a la ventana para comprobar que el proceso
  // principal lo reconoce en ESTA plataforma y pide el PIN.
  ventana.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'q',
    modifiers: ['control', 'shift', 'alt'],
  });

  const atajoReconocido = await esperarHasta(
    () => controladorDeSalida.solicitudesRecibidas() > 0,
    ESPERA_MAXIMA_DEL_ATAJO_MS,
  );

  // Un PIN equivocado NO debe cerrar nada. Se usa uno de CUATRO dígitos y
  // distinto del sembrado: con un largo inválido fallaría por formato y no se
  // estaría probando el caso que importa, que es un PIN bien formado y erróneo.
  const pinIncorrecto = pinDePrueba === '1000' ? '9999' : '1000';
  const conPinIncorrecto = controladorDeSalida.confirmarSalida(pinIncorrecto);

  // --- El BOTÓN de la barra de estado dispara el mismo flujo que el atajo ---
  const solicitudesAntesDelBoton = controladorDeSalida.solicitudesRecibidas();
  const botonEncontrado = (await ventana.webContents.executeJavaScript(`(() => {
    const boton = document.querySelector('[data-prueba="boton-salida"]');
    if (boton === null) { return false; }
    boton.click();
    return true;
  })()`)) as boolean;

  const botonPidioLaSalida = await esperarHasta(
    () => controladorDeSalida.solicitudesRecibidas() > solicitudesAntesDelBoton,
    ESPERA_MAXIMA_DEL_ATAJO_MS,
  );

  // Y el diálogo de PIN aparece de verdad en el DOM, no solo en el proceso
  // principal: se consulta el documento de la ventana real hasta que React lo
  // dibuja o se agota el tiempo.
  const dialogoVisible = await esperarDialogoDeSalida(ventana);

  // --- Un cierre directo (lo que hace Cmd+Q) queda interceptado ---
  const solicitudesAntesDelCierre = controladorDeSalida.solicitudesRecibidas();
  app.quit();
  const cierreDirectoInterceptado = await esperarHasta(
    () => controladorDeSalida.solicitudesRecibidas() > solicitudesAntesDelCierre,
    ESPERA_MAXIMA_DEL_ATAJO_MS,
  );
  // Si llegamos a esta línea, el app.quit() de arriba no cerró la aplicación.
  const siguiaViva = !controladorDeSalida.cierreEstaAutorizado();

  // El diagnóstico de la base se toma ANTES del cierre, mientras sigue abierta.
  const baseDeDatos = ejecutarDiagnostico({ incluirConteoDeRegistros: true });

  // Camino completo: el PIN correcto autoriza y dispara el cierre ordenado.
  // Es la misma ruta que recorrerá el administrador en la tienda.
  const conPinCorrecto = controladorDeSalida.confirmarSalida(pinDePrueba);

  const informe = {
    plataforma: process.platform,
    ventana: describirEstadoKiosko(ventana),
    bloqueos,
    salidaControlada: {
      atajo: describirAtajo(ATAJO_SALIDA_CONTROLADA, process.platform),
      atajoReconocidoEnEstaPlataforma: atajoReconocido,
      pinSolicitado: atajoReconocido,
      salidaConPinIncorrectoRechazada: !conPinIncorrecto.autorizado,
      motivoDelRechazo: conPinIncorrecto.codigo,
      salidaConPinCorrectoAutorizada: conPinCorrecto.autorizado,
    },
    botonDeSalidaEnLaInterfaz: {
      botonEncontrado,
      botonPidioLaSalida,
      dialogoDePinVisible: dialogoVisible,
    },
    cierreSinPin: {
      // Es la ruta por la que pasa Cmd+Q en macOS y Alt+F4 en Windows.
      cierreDirectoInterceptado,
      aplicacionSiguioViva: siguiaViva,
    },
    primerArranque: {
      requeriaConfiguracionInicial,
      administradorCreado: yaNoRequiereConfiguracion,
    },
    cierreOrdenado: ultimoCierre,
    baseDeDatos,
  };

  console.info(`${MARCA_INFORME}${JSON.stringify(informe)}`);

  // Red de seguridad: si por alguna razón el PIN correcto no cerró (por
  // ejemplo, porque esta instalación no tiene PIN configurado), se cierra igual
  // para que la verificación no deje un proceso colgado.
  cerrarAplicacionOrdenadamente();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Red de seguridad: si la aplicación se cierra por una vía que no pasó por
  // el cierre ordenado (por ejemplo Cmd+Q en macOS), igual se libera todo.
  quitarManejadoresIpc();
  cerrarBaseDeDatos();
});
