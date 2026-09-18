/**
 * @vitest-environment jsdom
 *
 * Arrastrar para desplazar cuando el dedo llega como MOUSE (§4.62).
 *
 * Existe por el hallazgo de la tienda: en el equipo real no se podía bajar con
 * el dedo. Medido en Chromium: un arrastre táctil desplaza la pantalla y uno de
 * mouse no. Estas pruebas fijan las dos mitades: con mouse, arrastrar desplaza
 * y no activa el botón donde empezó; con toque de verdad, este módulo no hace
 * nada, porque ese lo desplaza el navegador.
 *
 * jsdom no calcula tamaños: el alto del contenido, el de la vista y la
 * posición de desplazamiento se fijan a mano en cada elemento.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  UMBRAL_DE_ARRASTRE_PX,
  contenedorDesplazable,
  instalarDesplazamientoPorArrastre,
} from '../desplazamiento-por-arrastre';

let quitar: () => void;

/** Le da a un elemento un contenido más alto que su vista, como haría el navegador. */
function volverDesplazable(elemento: HTMLElement, alto = 1000, vista = 300): void {
  elemento.style.overflowY = 'auto';
  Object.defineProperty(elemento, 'scrollHeight', { configurable: true, get: () => alto });
  Object.defineProperty(elemento, 'clientHeight', { configurable: true, get: () => vista });
  Object.defineProperty(elemento, 'clientWidth', { configurable: true, get: () => 300 });
  Object.defineProperty(elemento, 'scrollTop', { configurable: true, writable: true, value: 0 });
}

/** Un evento de puntero con lo que el módulo lee. jsdom no trae PointerEvent. */
function puntero(
  tipo: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  pointerType: 'mouse' | 'touch' | 'pen' = 'mouse',
): MouseEvent {
  const evento = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(evento, 'pointerType', { value: pointerType });
  Object.defineProperty(evento, 'pointerId', { value: 1 });
  return evento;
}

/**
 * Lo que hace un dedo que Windows entrega como mouse: bajar, moverse en pasos,
 * soltar y el clic que el navegador manda al soltar.
 */
function arrastrar(
  destino: Element,
  deY: number,
  aY: number,
  opciones: { readonly x?: number; readonly pointerType?: 'mouse' | 'touch' | 'pen' } = {},
): void {
  const x = opciones.x ?? 100;
  const tipo = opciones.pointerType ?? 'mouse';
  destino.dispatchEvent(puntero('pointerdown', x, deY, tipo));
  const pasos = 5;
  for (let paso = 1; paso <= pasos; paso++) {
    destino.dispatchEvent(puntero('pointermove', x, deY + ((aY - deY) * paso) / pasos, tipo));
  }
  destino.dispatchEvent(puntero('pointerup', x, aY, tipo));
  destino.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: aY }));
}

/** Una lista que se desplaza, con un botón adentro que cuenta sus clics. */
function listaConBoton(): { lista: HTMLDivElement; boton: HTMLButtonElement; clics: () => number } {
  const lista = document.createElement('div');
  volverDesplazable(lista);
  const boton = document.createElement('button');
  boton.textContent = 'Maíz blanco';
  let cuenta = 0;
  boton.addEventListener('click', () => {
    cuenta++;
  });
  lista.appendChild(boton);
  document.body.appendChild(lista);
  return { lista, boton, clics: () => cuenta };
}

beforeEach(() => {
  quitar = instalarDesplazamientoPorArrastre(document);
});

afterEach(() => {
  quitar();
  document.body.innerHTML = '';
});

describe('Con un dedo que llega como MOUSE, arrastrar desplaza', () => {
  it('arrastrar 200 px hacia arriba baja la lista 200 px', () => {
    const { lista, boton } = listaConBoton();
    arrastrar(boton, 400, 200);
    expect(lista.scrollTop).toBe(200);
  });

  it('y NO activa el botón donde empezó el arrastre (en la venta, eso agregaría un producto)', () => {
    const { boton, clics } = listaConBoton();
    arrastrar(boton, 400, 200);
    expect(clics()).toBe(0);
  });

  it('el clic anulado no llega ni a los escuchadores del DOCUMENTO: el teclado en pantalla no se cierra por desplazar', () => {
    const { boton } = listaConBoton();
    let clicsEnElDocumento = 0;
    const contar = (): void => {
      clicsEnElDocumento++;
    };
    // Así escucha el teclado en pantalla (TecladoEnPantalla.tsx): en captura, sobre el documento.
    document.addEventListener('click', contar, true);
    arrastrar(boton, 400, 200);
    document.removeEventListener('click', contar, true);
    expect(clicsEnElDocumento).toBe(0);
  });

  it('solo se anula el clic de ESE arrastre: el toque siguiente funciona', () => {
    const { boton, clics } = listaConBoton();
    arrastrar(boton, 400, 200);
    arrastrar(boton, 300, 300);
    expect(clics()).toBe(1);
  });

  it('con un lápiz pasa lo mismo que con el mouse', () => {
    const { lista, boton } = listaConBoton();
    arrastrar(boton, 400, 250, { pointerType: 'pen' });
    expect(lista.scrollTop).toBe(150);
  });
});

describe('Un toque sigue siendo un toque', () => {
  it(`moverse menos de ${String(UMBRAL_DE_ARRASTRE_PX)} px no desplaza y el botón SÍ se activa`, () => {
    const { lista, boton, clics } = listaConBoton();
    arrastrar(boton, 400, 400 - (UMBRAL_DE_ARRASTRE_PX - 1));
    expect(lista.scrollTop).toBe(0);
    expect(clics()).toBe(1);
  });

  it('con un toque de pantalla táctil de VERDAD no hace nada: ese lo desplaza el navegador, y hacerlo acá lo movería el doble', () => {
    const { lista, boton, clics } = listaConBoton();
    arrastrar(boton, 400, 200, { pointerType: 'touch' });
    expect(lista.scrollTop).toBe(0);
    expect(clics()).toBe(1);
  });
});

describe('Donde un arrastre NO desplaza', () => {
  it('si empieza en un campo donde se escribe', () => {
    const { lista } = listaConBoton();
    const campo = document.createElement('input');
    lista.appendChild(campo);
    arrastrar(campo, 400, 200);
    expect(lista.scrollTop).toBe(0);
  });

  it('si empieza sobre la barra de desplazamiento de la lista, que se arrastra sola', () => {
    const { lista, boton } = listaConBoton();
    // La vista de la lista mide 300 de ancho: de ahí en adelante está su barra.
    arrastrar(boton, 400, 200, { x: 305 });
    expect(lista.scrollTop).toBe(0);
  });

  it('si nada debajo se puede desplazar, no pasa nada y el botón funciona', () => {
    const boton = document.createElement('button');
    let clics = 0;
    boton.addEventListener('click', () => {
      clics++;
    });
    document.body.appendChild(boton);
    arrastrar(boton, 400, 200);
    expect(clics).toBe(1);
  });

  it('después de quitarlo, arrastrar ya no desplaza', () => {
    quitar();
    const { lista, boton } = listaConBoton();
    arrastrar(boton, 400, 200);
    expect(lista.scrollTop).toBe(0);
    quitar = instalarDesplazamientoPorArrastre(document);
  });
});

describe('Qué se desplaza', () => {
  it('el contenedor más cercano que se desplaza, no la ventana', () => {
    const { lista, boton } = listaConBoton();
    expect(contenedorDesplazable(boton, document)).toBe(lista);
  });

  it('la ventana entera cuando ningún contenedor se desplaza y la página es más alta que la pantalla', () => {
    const raiz = document.documentElement;
    Object.defineProperty(document, 'scrollingElement', { configurable: true, get: () => raiz });
    Object.defineProperty(raiz, 'scrollHeight', { configurable: true, get: () => 1064 });
    Object.defineProperty(raiz, 'clientHeight', { configurable: true, get: () => 768 });
    Object.defineProperty(raiz, 'clientWidth', { configurable: true, get: () => 980 });
    Object.defineProperty(raiz, 'scrollTop', { configurable: true, writable: true, value: 0 });
    const boton = document.createElement('button');
    document.body.appendChild(boton);

    expect(contenedorDesplazable(boton, document)).toBe(raiz);
    arrastrar(boton, 600, 300);
    expect(raiz.scrollTop).toBe(300);

    // Sobre la barra de 44 px de la ventana (de 980 a 1024) no se arrastra: se arrastra su pulgar.
    raiz.scrollTop = 0;
    arrastrar(boton, 600, 300, { x: 1000 });
    expect(raiz.scrollTop).toBe(0);
  });
});
