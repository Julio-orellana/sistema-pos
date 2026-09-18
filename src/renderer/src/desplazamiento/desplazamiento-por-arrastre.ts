/**
 * Desplazar arrastrando, también cuando el «dedo» llega como MOUSE (§4.62).
 *
 * POR QUÉ EXISTE. En el equipo de la tienda no se podía bajar con el dedo en
 * las pantallas más altas que 768 px. Medido en Chromium a 1024×768: un
 * arrastre TÁCTIL sí desplaza la pantalla, y ningún bloqueo del kiosko lo
 * impide; un arrastre de MOUSE no la desplaza. Las pantallas táctiles de esa
 * época (un i3 de 2011 con pantalla de 1024×768) suelen presentarse ante
 * Windows como un mouse, y entonces cada toque es un clic y cada arrastre es
 * un arrastre de mouse. Eso último es INFERENCIA: qué recibe el equipo real lo
 * dice el panel de diagnóstico, en «Pantalla y entrada».
 *
 * QUÉ HACE. Con un puntero que NO es táctil —mouse o lápiz— un arrastre
 * vertical de más de `UMBRAL_DE_ARRASTRE_PX` desplaza el contenedor que tenga
 * debajo, o la ventana. El clic que llega al soltar se anula: si no, el botón
 * donde empezó el arrastre se activaría, y en la venta eso agrega un producto
 * al ticket.
 *
 * QUÉ NO HACE:
 *   - Nada con un puntero táctil de verdad: ese lo desplaza el navegador, y
 *     hacerlo también acá lo movería el doble.
 *   - Nada si el arrastre empieza en un campo donde se escribe.
 *   - Nada si empieza sobre una barra de desplazamiento: esa se arrastra sola.
 *   - Nada con un toque que no se mueve: ahí sigue siendo un clic normal.
 */

/** Cuánto hay que mover el puntero para que deje de ser un clic. */
export const UMBRAL_DE_ARRASTRE_PX = 10;

/** Donde empieza un arrastre que no desplaza: se escribe, se elige o se marca. */
const NO_ARRASTRAR = 'input, textarea, select, [data-sin-arrastre]';

interface Gesto {
  readonly punteroId: number;
  readonly contenedor: Element;
  readonly yInicial: number;
  readonly scrollInicial: number;
  arrastrando: boolean;
}

/** ¿Este elemento puede desplazarse verticalmente por sí mismo? */
function sePuedeDesplazar(elemento: Element, documento: Document): boolean {
  if (elemento === documento.scrollingElement) {
    return elemento.scrollHeight > elemento.clientHeight + 1;
  }
  const vista = documento.defaultView;
  if (vista === null) {
    return false;
  }
  const { overflowY } = vista.getComputedStyle(elemento);
  return (overflowY === 'auto' || overflowY === 'scroll') && elemento.scrollHeight > elemento.clientHeight + 1;
}

/**
 * El contenedor que desplaza un arrastre que empieza en `destino`: el
 * ancestro más cercano que se desplaza, o la ventana si ninguno lo hace.
 */
export function contenedorDesplazable(destino: Element, documento: Document): Element | null {
  for (let actual: Element | null = destino; actual !== null; actual = actual.parentElement) {
    if (actual === documento.documentElement || actual === documento.body) {
      break;
    }
    if (sePuedeDesplazar(actual, documento)) {
      return actual;
    }
  }
  // Chromium siempre lo da; jsdom devuelve `undefined`, y un arrastre no puede
  // romper la página por eso.
  const raiz = documento.scrollingElement ?? null;
  if (raiz === null) {
    return null;
  }
  return sePuedeDesplazar(raiz, documento) ? raiz : null;
}

/** ¿El puntero está sobre la barra de desplazamiento de ese contenedor? */
function estaSobreLaBarra(contenedor: Element, x: number, documento: Document): boolean {
  if (contenedor === documento.scrollingElement) {
    return x >= documento.documentElement.clientWidth;
  }
  const rect = contenedor.getBoundingClientRect();
  return x >= rect.left + contenedor.clientWidth;
}

/**
 * Instala el arrastre sobre un documento. Devuelve la función que lo quita.
 *
 * Los escuchadores van en fase de captura sobre la VENTANA, para que el clic
 * que hay que anular se anule antes de que lo vea cualquier otro escuchador,
 * incluido el del teclado en pantalla, que escucha en el documento.
 */
export function instalarDesplazamientoPorArrastre(documento: Document): () => void {
  const vista = documento.defaultView;
  if (vista === null) {
    return () => undefined;
  }

  let gesto: Gesto | null = null;
  let anularProximoClic = false;

  const alBajar = (evento: PointerEvent): void => {
    anularProximoClic = false;
    gesto = null;
    if (evento.pointerType === 'touch' || evento.button !== 0) {
      return;
    }
    const destino = evento.target instanceof vista.Element ? evento.target : null;
    if (destino === null) {
      return;
    }
    if (destino.closest(NO_ARRASTRAR) !== null) {
      return;
    }
    const contenedor = contenedorDesplazable(destino, documento);
    if (contenedor === null || estaSobreLaBarra(contenedor, evento.clientX, documento)) {
      return;
    }
    gesto = {
      punteroId: evento.pointerId,
      contenedor,
      yInicial: evento.clientY,
      scrollInicial: contenedor.scrollTop,
      arrastrando: false,
    };
  };

  const alMover = (evento: PointerEvent): void => {
    if (gesto?.punteroId !== evento.pointerId) {
      return;
    }
    const desplazamiento = evento.clientY - gesto.yInicial;
    if (!gesto.arrastrando && Math.abs(desplazamiento) < UMBRAL_DE_ARRASTRE_PX) {
      return;
    }
    gesto.arrastrando = true;
    gesto.contenedor.scrollTop = gesto.scrollInicial - desplazamiento;
    evento.preventDefault();
  };

  const alSoltar = (evento: PointerEvent): void => {
    if (gesto?.punteroId !== evento.pointerId) {
      return;
    }
    anularProximoClic = gesto.arrastrando;
    gesto = null;
  };

  const alHacerClic = (evento: MouseEvent): void => {
    if (!anularProximoClic) {
      return;
    }
    anularProximoClic = false;
    evento.preventDefault();
    evento.stopImmediatePropagation();
  };

  const enCaptura = { capture: true } as const;
  const enCapturaActiva = { capture: true, passive: false } as const;
  vista.addEventListener('pointerdown', alBajar, enCaptura);
  vista.addEventListener('pointermove', alMover, enCapturaActiva);
  vista.addEventListener('pointerup', alSoltar, enCaptura);
  vista.addEventListener('pointercancel', alSoltar, enCaptura);
  vista.addEventListener('click', alHacerClic, enCaptura);

  return () => {
    vista.removeEventListener('pointerdown', alBajar, enCaptura);
    vista.removeEventListener('pointermove', alMover, enCapturaActiva);
    vista.removeEventListener('pointerup', alSoltar, enCaptura);
    vista.removeEventListener('pointercancel', alSoltar, enCaptura);
    vista.removeEventListener('click', alHacerClic, enCaptura);
  };
}
