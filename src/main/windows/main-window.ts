/**
 * Ventana principal en modo kiosko.
 *
 * REQUISITO DEL CLIENTE: la aplicación corre en la computadora del mostrador y
 * el cajero no debe poder salirse de ella, minimizarla, cambiar el zoom ni
 * abrir menús del navegador. Por eso: pantalla completa, sin marco, sin menú,
 * sin zoom y sin menú contextual.
 */

import { join } from 'node:path';
import { BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions } from 'electron';

import {
  esAtajoDeHerramientasDeDesarrollo,
  esAtajoDeRecarga,
  esAtajoDeZoomPorTeclado,
} from '@shared/kiosk-input';

/** Ancho mínimo pensado para la pantalla del mostrador. */
const ANCHO_MINIMO = 1024;

/** Alto mínimo pensado para la pantalla del mostrador. */
const ALTO_MINIMO = 720;

/** Nivel de zoom fijo: 1 significa "sin acercar ni alejar". */
const NIVEL_ZOOM_FIJO = 1;

/** Color de fondo mientras carga, para que no destelle en blanco. */
const COLOR_FONDO = '#0f172a';

/**
 * Ajustes de kiosko en un solo lugar, para que la ventana y la verificación
 * automatizada lean exactamente los mismos valores. Si alguien afloja uno de
 * estos, la verificación de arranque lo reporta.
 */
const AJUSTES_KIOSKO = {
  /** Pantalla completa bloqueada, sin poder salir con gestos del sistema. */
  kiosk: true,
  fullscreen: true,
  /** Sin marco de ventana: no hay barra de título ni botones de cerrar. */
  frame: false,
  /** Sin barra de menú del sistema operativo. */
  autoHideMenuBar: true,
  /** El renderer no ve Node ni Electron: solo la API del preload. */
  contextIsolation: true,
  nodeIntegration: false,
} as const;

/** ¿Estamos en desarrollo? En desarrollo se permiten las herramientas. */
const enDesarrollo = process.env.ELECTRON_RENDERER_URL !== undefined;

/**
 * Crea la ventana del punto de venta.
 * @param rutaPreload Ruta absoluta al script de preload compilado.
 * @param mostrarAlEstarLista `false` solo en la verificación automatizada de
 *        arranque, donde interesa comprobar la configuración de la ventana sin
 *        tomarse la pantalla del usuario.
 */
export function crearVentanaPrincipal(rutaPreload: string, mostrarAlEstarLista = true): BrowserWindow {
  // Sin menú de aplicación: elimina Archivo/Editar/Ver y todos sus atajos.
  Menu.setApplicationMenu(null);

  const opciones: BrowserWindowConstructorOptions = {
    width: ANCHO_MINIMO,
    height: ALTO_MINIMO,
    minWidth: ANCHO_MINIMO,
    minHeight: ALTO_MINIMO,
    show: false,
    backgroundColor: COLOR_FONDO,
    // Kiosko: pantalla completa real, sin barra de título ni marco.
    kiosk: AJUSTES_KIOSKO.kiosk,
    fullscreen: AJUSTES_KIOSKO.fullscreen,
    frame: AJUSTES_KIOSKO.frame,
    titleBarStyle: 'hidden',
    autoHideMenuBar: AJUSTES_KIOSKO.autoHideMenuBar,
    webPreferences: {
      preload: rutaPreload,
      // Aislamiento de contexto: el renderer no ve Node ni Electron; solo la
      // API que el preload expone explícitamente en window.pos.
      contextIsolation: AJUSTES_KIOSKO.contextIsolation,
      nodeIntegration: AJUSTES_KIOSKO.nodeIntegration,
      // sandbox en false porque el preload se compila como CommonJS con
      // dependencias del bundle; el aislamiento de contexto sigue activo.
      sandbox: false,
      spellcheck: false,
      devTools: enDesarrollo,
      zoomFactor: NIVEL_ZOOM_FIJO,
    },
  };

  const ventana = new BrowserWindow(opciones);

  ventana.once('ready-to-show', () => {
    if (!mostrarAlEstarLista) {
      return;
    }
    ventana.show();
    ventana.focus();
  });

  aplicarBloqueosDeKiosko(ventana);
  aplicarPoliticaDeNavegacion(ventana);

  return ventana;
}

/**
 * Desactiva zoom y menú contextual desde el proceso principal.
 * El preload refuerza lo mismo del lado del DOM: dos capas, porque un cajero
 * apurado con un mouse de rueda no debería poder descuadrar la pantalla.
 */
function aplicarBloqueosDeKiosko(ventana: BrowserWindow): void {
  const { webContents } = ventana;

  webContents.on('did-finish-load', () => {
    // Bloquea el zoom por pellizco y por Ctrl+rueda.
    void webContents.setVisualZoomLevelLimits(NIVEL_ZOOM_FIJO, NIVEL_ZOOM_FIJO);
    webContents.setZoomFactor(NIVEL_ZOOM_FIJO);
  });

  // Si algo logra cambiar el zoom, se revierte de inmediato.
  webContents.on('zoom-changed', () => {
    webContents.setZoomFactor(NIVEL_ZOOM_FIJO);
  });

  // Sin menú de clic derecho.
  webContents.on('context-menu', (evento) => {
    evento.preventDefault();
  });

  // Bloqueo de atajos de zoom y, en producción, de recarga y herramientas.
  // Las reglas viven en src/shared/kiosk-input.ts, que se prueba con Vitest;
  // aquí solo queda la parte mecánica de cancelar el evento.
  webContents.on('before-input-event', (evento, entrada) => {
    if (esAtajoDeZoomPorTeclado(entrada)) {
      evento.preventDefault();
      return;
    }

    if (!enDesarrollo && (esAtajoDeRecarga(entrada) || esAtajoDeHerramientasDeDesarrollo(entrada))) {
      evento.preventDefault();
    }
  });
}

/**
 * Impide que la aplicación navegue fuera de sí misma o abra ventanas nuevas.
 * Cualquier enlace externo (por ejemplo, soporte) se abre en el navegador del
 * sistema, nunca dentro del kiosko.
 */
function aplicarPoliticaDeNavegacion(ventana: BrowserWindow): void {
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  ventana.webContents.on('will-navigate', (evento, url) => {
    const urlDesarrollo = process.env.ELECTRON_RENDERER_URL;
    const esNavegacionInterna = urlDesarrollo !== undefined && url.startsWith(urlDesarrollo);
    if (!esNavegacionInterna) {
      evento.preventDefault();
    }
  });
}

/** Carga la interfaz: servidor de Vite en desarrollo, archivo estático en producción. */
export function cargarInterfaz(ventana: BrowserWindow, directorioRenderer: string): void {
  const urlDesarrollo = process.env.ELECTRON_RENDERER_URL;

  if (urlDesarrollo !== undefined) {
    void ventana.loadURL(urlDesarrollo);
    return;
  }

  void ventana.loadFile(join(directorioRenderer, 'index.html'));
}

/**
 * Estado de la ventana para la verificación de arranque.
 *
 * Se distingue a propósito entre lo que se LEE de la ventana viva y lo que se
 * DECLARA al construirla, porque Electron no ofrece getters para todo. Los
 * campos declarados se leen de `AJUSTES_KIOSKO`, que es el mismo objeto que se
 * usa al crear la ventana: si alguien afloja un ajuste, el informe lo refleja.
 */
export interface EstadoVentanaKiosko {
  /** Leído de la ventana viva. */
  readonly medido: {
    readonly modoKiosko: boolean;
    readonly pantallaCompleta: boolean;
    /**
     * Ojo al auditar: en macOS este valor SIEMPRE es `true`, porque el menú no
     * pertenece a la ventana sino a la barra del sistema. En macOS el dato que
     * importa es `menuDeAplicacionEliminado`; en Windows y Linux sí refleja la
     * barra de menú de la ventana.
     */
    readonly barraDeMenuVisible: boolean;
    readonly menuDeAplicacionEliminado: boolean;
    readonly factorDeZoom: number;
  };
  /** Declarado al construir la ventana (Electron no expone getters de esto). */
  readonly declarado: {
    readonly sinMarcoNiBarraDeTitulo: boolean;
    readonly aislamientoDeContexto: boolean;
    readonly integracionDeNodeEnRenderer: boolean;
  };
}

/** Arma el informe de estado de la ventana, sin necesidad de mirar la pantalla. */
export function describirEstadoKiosko(ventana: BrowserWindow): EstadoVentanaKiosko {
  return {
    medido: {
      modoKiosko: ventana.isKiosk(),
      pantallaCompleta: ventana.isFullScreen(),
      barraDeMenuVisible: ventana.isMenuBarVisible(),
      menuDeAplicacionEliminado: Menu.getApplicationMenu() === null,
      factorDeZoom: ventana.webContents.getZoomFactor(),
    },
    declarado: {
      sinMarcoNiBarraDeTitulo: !AJUSTES_KIOSKO.frame,
      aislamientoDeContexto: AJUSTES_KIOSKO.contextIsolation,
      integracionDeNodeEnRenderer: AJUSTES_KIOSKO.nodeIntegration,
    },
  };
}
