/**
 * Bloqueos del modo kiosko aplicados sobre el DOM.
 *
 * El proceso principal ya bloquea el zoom y el menú contextual a nivel de
 * Chromium. Esto lo repite en el DOM a propósito: son dos rutas distintas
 * (gestos del sistema operativo contra eventos de la página) y en una caja
 * registradora conviene que ninguna de las dos funcione.
 *
 * Se aísla en su propio módulo, separado del preload, por una razón concreta:
 * así se puede probar de verdad con un navegador simulado y responder con una
 * prueba automatizada —y no con "revisé el código"— si Ctrl+rueda está
 * bloqueado y si el clic derecho está deshabilitado.
 */

import {
  desdeEventoDelNavegador,
  esAtajoDeZoomPorTeclado,
  esGestoDeZoomConRueda,
} from '@shared/kiosk-input';

/** Función que revierte los bloqueos. Se usa en las pruebas. */
export type QuitarBloqueos = () => void;

/**
 * Instala los bloqueos de kiosko sobre una ventana del navegador.
 *
 * @param ventana Ventana sobre la que se escuchan los eventos.
 * @returns Función que quita todos los escuchadores instalados.
 */
export function instalarBloqueosDeKioskoEnDom(ventana: Window): QuitarBloqueos {
  // Sin menú de clic derecho: no debe haber "Recargar", "Inspeccionar" ni
  // "Copiar imagen" al alcance del cajero.
  const alMenuContextual = (evento: Event): void => {
    evento.preventDefault();
  };

  // Ctrl+rueda (Cmd+rueda en macOS) es el gesto de zoom del navegador.
  const alGirarLaRueda = (evento: Event): void => {
    const gesto = evento as WheelEvent;
    if (esGestoDeZoomConRueda({ ctrlKey: gesto.ctrlKey, metaKey: gesto.metaKey })) {
      evento.preventDefault();
    }
  };

  // Ctrl con "+", "-" o "0" cambia el zoom desde el teclado.
  const alPresionarTecla = (evento: Event): void => {
    const teclado = evento as KeyboardEvent;
    if (esAtajoDeZoomPorTeclado(desdeEventoDelNavegador(teclado))) {
      evento.preventDefault();
    }
  };

  // Zoom por pellizco en pantallas táctiles y en el trackpad de macOS.
  const alIniciarGesto = (evento: Event): void => {
    evento.preventDefault();
  };

  // Todos en fase de captura, para llegar antes que cualquier componente de la
  // interfaz que quisiera manejar el mismo evento.
  const enCaptura = { capture: true } as const;
  const enCapturaActiva = { capture: true, passive: false } as const;

  ventana.addEventListener('contextmenu', alMenuContextual, enCaptura);
  ventana.addEventListener('wheel', alGirarLaRueda, enCapturaActiva);
  ventana.addEventListener('keydown', alPresionarTecla, enCaptura);
  ventana.addEventListener('gesturestart', alIniciarGesto, enCaptura);

  return (): void => {
    ventana.removeEventListener('contextmenu', alMenuContextual, enCaptura);
    ventana.removeEventListener('wheel', alGirarLaRueda, enCapturaActiva);
    ventana.removeEventListener('keydown', alPresionarTecla, enCaptura);
    ventana.removeEventListener('gesturestart', alIniciarGesto, enCaptura);
  };
}
