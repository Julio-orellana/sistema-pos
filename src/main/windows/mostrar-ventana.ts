/**
 * Mostrar la ventana del punto de venta, y saber CUÁNDO se mostró.
 *
 * ===========================================================================
 * POR QUÉ EXISTE (2026-09-17)
 * ===========================================================================
 *
 * En la tienda de Jimmy, con la red del local conectada, la aplicación no
 * llegó a mostrar ninguna pantalla, con CPU y disco en 0 %. Sin red, abría
 * normal. Nadie sabe todavía en qué paso se quedó: la bitácora técnica no
 * anotaba nada del arranque en sí.
 *
 * Este módulo cierra dos cosas a la vez:
 *
 * 1. **La ventana se muestra aunque nunca avise que está lista.** Se muestra al
 *    llegar `ready-to-show` (lo normal: sin destello de fondo) o, si ese aviso
 *    no llega en `limiteMs`, se muestra igual. Una ventana escondida para
 *    siempre es exactamente el síntoma de la tienda, y mostrar el fondo antes
 *    de que la interfaz pinte es mucho mejor que no mostrar nada.
 * 2. **Devuelve una promesa que se resuelve cuando la ventana ya se mostró.** El
 *    proceso principal espera esa promesa para arrancar TODO lo que habla con
 *    la red —la sesión con la nube, el trabajador de sincronización, el sondeo
 *    del enlace—. Así ninguna llamada de red, y nada que dependa del estado de
 *    la red, corre antes de que la ventana se vea. Lo exige la prueba
 *    `nada-de-red-antes-de-mostrar-la-ventana.test.ts`.
 *
 * Cada caso queda en la bitácora técnica con los milisegundos desde que
 * arrancó el proceso: si vuelve a pasar en la tienda, el archivo dice hasta
 * dónde llegó.
 *
 * No importa Electron: recibe lo mínimo de la ventana, para probarlo sin
 * abrir ninguna.
 */

/** Lo mínimo de `BrowserWindow` que se usa. */
export interface VentanaQueSeMuestra {
  once(evento: 'ready-to-show', escucha: () => void): unknown;
  show(): void;
  focus(): void;
  isDestroyed(): boolean;
}

/** Cómo terminó mostrándose la ventana. */
export type ComoSeMostro = 'aviso-que-estaba-lista' | 'por-limite-de-espera' | 'destruida-antes-de-mostrarse';

/**
 * Cuánto se espera el aviso `ready-to-show` antes de mostrar la ventana igual.
 *
 * En macOS, medido el 2026-09-17, la ventana estuvo visible a los 533 y 683 ms
 * del lanzamiento. La máquina de la tienda es un i3 y nadie midió ahí cuánto
 * tarda (riesgo 8.8): 10 s deja margen de sobra para una primera pintura lenta
 * y a la vez es un tiempo que una persona espera sin pensar que se colgó.
 */
export const ESPERA_MAXIMA_PARA_MOSTRAR_LA_VENTANA_MS = 10_000;

export interface OpcionesParaMostrar {
  readonly limiteMs: number;
  /** A la bitácora técnica. Recibe el texto ya armado. */
  readonly registrar: (mensaje: string) => void;
  /** Milisegundos desde que arrancó el proceso, para el renglón. */
  readonly msDesdeElInicio: () => number;
  /** Inyectables para las pruebas. */
  readonly programar?: (accion: () => void, ms: number) => unknown;
  readonly cancelar?: (identificador: unknown) => void;
}

export function mostrarCuandoEsteLista(
  ventana: VentanaQueSeMuestra,
  opciones: OpcionesParaMostrar,
): Promise<ComoSeMostro> {
  const programar =
    opciones.programar ??
    ((accion: () => void, ms: number): unknown => {
      const identificador = setTimeout(accion, ms);
      return identificador;
    });
  const cancelar =
    opciones.cancelar ??
    ((identificador: unknown): void => {
      clearTimeout(identificador as ReturnType<typeof setTimeout>);
    });

  return new Promise<ComoSeMostro>((resolver) => {
    let terminado = false;
    let reloj: unknown = null;

    const terminar = (como: 'aviso-que-estaba-lista' | 'por-limite-de-espera'): void => {
      if (terminado) {
        return;
      }
      terminado = true;
      if (reloj !== null) {
        cancelar(reloj);
      }
      if (ventana.isDestroyed()) {
        opciones.registrar(
          `la ventana se destruyó antes de mostrarse (a los ${String(opciones.msDesdeElInicio())} ms del inicio del proceso)`,
        );
        resolver('destruida-antes-de-mostrarse');
        return;
      }
      ventana.show();
      ventana.focus();
      opciones.registrar(
        como === 'aviso-que-estaba-lista'
          ? `ventana mostrada a los ${String(opciones.msDesdeElInicio())} ms del inicio del proceso: avisó que estaba lista`
          : `ventana mostrada a los ${String(opciones.msDesdeElInicio())} ms del inicio del proceso SIN que avisara ` +
              `que estaba lista: no llegó «ready-to-show» en ${String(opciones.limiteMs)} ms y se muestra igual`,
      );
      resolver(como);
    };

    ventana.once('ready-to-show', () => {
      terminar('aviso-que-estaba-lista');
    });
    reloj = programar(() => {
      terminar('por-limite-de-espera');
    }, opciones.limiteMs);
  });
}
