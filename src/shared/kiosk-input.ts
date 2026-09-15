/**
 * kiosk-input.ts — Reglas de entrada del modo kiosko.
 *
 * Contiene las decisiones puras sobre QUÉ combinación de teclas o gesto hay
 * que bloquear o reconocer. No toca Electron ni el DOM a propósito: al ser
 * funciones puras se pueden probar con Vitest en milisegundos, sin abrir la
 * aplicación. El proceso principal y el preload las consumen y solo se encargan
 * de la parte mecánica (llamar a preventDefault, mostrar el diálogo).
 *
 * REGLA CLAVE — SE COMPARA LA TECLA FÍSICA, NO EL CARÁCTER PRODUCIDO:
 * todas las combinaciones se identifican por `code` ("KeyQ"), que es la
 * posición física de la tecla, y nunca por `key` ("q", "@", "œ"), que depende
 * de la distribución del teclado. En un teclado latinoamericano de Windows,
 * AltGr equivale a Ctrl+Alt y produce caracteres distintos; comparando por
 * `key` el atajo del administrador simplemente no funcionaría en la máquina de
 * la tienda. Comparando por `code` funciona igual en macOS y en Windows y con
 * cualquier distribución.
 */

/**
 * Forma de un evento de teclado, compatible tanto con el objeto `Input` que
 * entrega Electron en `before-input-event` como con un `KeyboardEvent` del DOM.
 * Se declara aquí para no importar tipos de Electron en código compartido.
 */
export interface EntradaDeTeclado {
  /** "keyDown" | "keyUp" en Electron; "keydown" | "keyup" en el DOM. */
  readonly type?: string;
  /** Carácter producido. NO se usa para identificar atajos (ver encabezado). */
  readonly key?: string;
  /** Tecla física, independiente de la distribución. Ej.: "KeyQ", "Digit0". */
  readonly code?: string;
  readonly control?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
}

/** Gesto de rueda del mouse, tal como llega en un `WheelEvent`. */
export interface GestoDeRueda {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** Combinación de teclas identificada por su tecla física y sus modificadores. */
export interface CombinacionDeTeclas {
  readonly code: string;
  readonly control: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

// ---------------------------------------------------------------------------
// Atajo de salida controlada del administrador
// ---------------------------------------------------------------------------

/**
 * Combinación que abre la salida controlada de la aplicación.
 *
 * Ctrl + Shift + Alt + Q (en macOS, Alt es la tecla Option).
 *
 * Por qué esta y no otra:
 *   - No es un atajo reservado del sistema en macOS ni en Windows. En macOS los
 *     atajos de salida reservados usan Cmd (Cmd+Q, Cmd+Shift+Q para cerrar
 *     sesión, Ctrl+Cmd+Q para bloquear pantalla) y esta combinación no incluye
 *     Cmd. En Windows los atajos reservados del sistema usan la tecla Windows,
 *     Ctrl+Alt+Supr o Ctrl+Shift+Esc.
 *   - Requiere tres modificadores: es prácticamente imposible de presionar por
 *     accidente mientras se cobra.
 *   - Se identifica por tecla física, así que funciona con el teclado
 *     latinoamericano de la tienda igual que con el teclado del desarrollador.
 *
 * Si algún día hay que cambiarla, se cambia SOLO aquí.
 */
export const ATAJO_SALIDA_CONTROLADA: CombinacionDeTeclas = {
  code: 'KeyQ',
  control: true,
  shift: true,
  alt: true,
  meta: false,
};

/** Teclas físicas que, con Ctrl o Cmd, cambian el zoom del navegador. */
export const CODIGOS_DE_ZOOM: readonly string[] = [
  'Equal', // Ctrl + "+" y Ctrl + "="
  'Minus', // Ctrl + "-"
  'Digit0', // Ctrl + "0" (restablecer zoom)
  'NumpadAdd',
  'NumpadSubtract',
  'Numpad0',
];

/** Caracteres de zoom, usados solo como respaldo cuando no llega `code`. */
const TECLAS_DE_ZOOM_POR_CARACTER: readonly string[] = ['+', '-', '=', '0'];

// ---------------------------------------------------------------------------
// Predicados
// ---------------------------------------------------------------------------

/** ¿La entrada es una pulsación de tecla (y no una liberación)? */
function esPulsacion(entrada: EntradaDeTeclado): boolean {
  if (entrada.type === undefined) {
    return true;
  }
  return entrada.type.toLowerCase() === 'keydown';
}

/** ¿La entrada coincide exactamente con la combinación indicada? */
export function coincideCombinacion(
  entrada: EntradaDeTeclado,
  combinacion: CombinacionDeTeclas,
): boolean {
  if (!esPulsacion(entrada)) {
    return false;
  }
  return (
    entrada.code === combinacion.code &&
    (entrada.control ?? false) === combinacion.control &&
    (entrada.shift ?? false) === combinacion.shift &&
    (entrada.alt ?? false) === combinacion.alt &&
    (entrada.meta ?? false) === combinacion.meta
  );
}

/**
 * ¿Es el atajo de salida controlada del administrador?
 * No autoriza nada por sí solo: después hay que validar el PIN.
 */
export function esAtajoDeSalidaControlada(entrada: EntradaDeTeclado): boolean {
  return coincideCombinacion(entrada, ATAJO_SALIDA_CONTROLADA);
}

/**
 * ¿Es un intento de cambiar el zoom con el teclado (Ctrl/Cmd con +, -, = o 0)?
 * Se comprueba por tecla física y, si no viene `code`, por el carácter.
 */
export function esAtajoDeZoomPorTeclado(entrada: EntradaDeTeclado): boolean {
  if (!esPulsacion(entrada)) {
    return false;
  }
  const conModificador = (entrada.control ?? false) || (entrada.meta ?? false);
  if (!conModificador) {
    return false;
  }
  if (entrada.code !== undefined && CODIGOS_DE_ZOOM.includes(entrada.code)) {
    return true;
  }
  return entrada.key !== undefined && TECLAS_DE_ZOOM_POR_CARACTER.includes(entrada.key);
}

/**
 * ¿Es un gesto de zoom con la rueda del mouse?
 *
 * Ctrl+rueda (Cmd+rueda en macOS) es el gesto de acercar y alejar del
 * navegador. En una caja registradora debe estar bloqueado: un cajero que roza
 * la rueda con Ctrl presionado dejaría la pantalla ilegible en plena venta.
 */
export function esGestoDeZoomConRueda(gesto: GestoDeRueda): boolean {
  return gesto.ctrlKey || gesto.metaKey;
}

/** ¿Es un intento de abrir las herramientas de desarrollo? */
export function esAtajoDeHerramientasDeDesarrollo(entrada: EntradaDeTeclado): boolean {
  if (!esPulsacion(entrada)) {
    return false;
  }
  if (entrada.code === 'F12') {
    return true;
  }
  const conModificador = (entrada.control ?? false) || (entrada.meta ?? false);
  return conModificador && (entrada.shift ?? false) && entrada.code === 'KeyI';
}

/** ¿Es un intento de recargar la ventana? */
export function esAtajoDeRecarga(entrada: EntradaDeTeclado): boolean {
  if (!esPulsacion(entrada)) {
    return false;
  }
  if (entrada.code === 'F5') {
    return true;
  }
  const conModificador = (entrada.control ?? false) || (entrada.meta ?? false);
  return conModificador && entrada.code === 'KeyR';
}

/**
 * Traduce un evento de teclado del navegador al formato de este módulo.
 *
 * El DOM usa `ctrlKey`/`shiftKey`/`altKey`/`metaKey`; Electron usa
 * `control`/`shift`/`alt`/`meta`. Esta función normaliza ambos mundos para que
 * los predicados de arriba sirvan igual en el proceso principal y en el DOM.
 */
export function desdeEventoDelNavegador(evento: {
  readonly type?: string;
  readonly key?: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}): EntradaDeTeclado {
  return {
    type: evento.type ?? 'keydown',
    key: evento.key ?? '',
    code: evento.code ?? '',
    control: evento.ctrlKey ?? false,
    shift: evento.shiftKey ?? false,
    alt: evento.altKey ?? false,
    meta: evento.metaKey ?? false,
  };
}

// ---------------------------------------------------------------------------
// Descripción legible
// ---------------------------------------------------------------------------

/** Nombre de la tecla física para mostrarle a una persona. */
function nombreDeTecla(code: string): string {
  return code.startsWith('Key') ? code.slice('Key'.length) : code;
}

/**
 * Describe una combinación en el vocabulario de cada sistema operativo.
 * En macOS la tecla Alt se llama Option; en Windows y Linux, Alt.
 *
 * `plataforma` se tipa como `string` y no como `NodeJS.Platform` porque este
 * módulo también se compila dentro del renderer, donde los tipos de Node no
 * existen. Los valores esperados son los de `process.platform`.
 */
export function describirAtajo(combinacion: CombinacionDeTeclas, plataforma: string): string {
  const esMac = plataforma === 'darwin';
  const partes: string[] = [];

  if (combinacion.control) {
    partes.push('Ctrl');
  }
  if (combinacion.shift) {
    partes.push('Shift');
  }
  if (combinacion.alt) {
    partes.push(esMac ? 'Option' : 'Alt');
  }
  if (combinacion.meta) {
    partes.push(esMac ? 'Cmd' : 'Win');
  }
  partes.push(nombreDeTecla(combinacion.code));

  return partes.join(' + ');
}
