/**
 * @vitest-environment jsdom
 *
 * El teclado alfanumérico en pantalla, ligado a un campo real (§4.39).
 *
 * Existe porque Jimmy lo encontró en el equipo real: en la pantalla táctil de
 * la tienda, tocar el nombre de un producto no abría ningún teclado y no había
 * cómo escribirlo.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CampoDeTexto, ProveedorDeTeclado, type CampoDeTextoProps } from '../TecladoEnPantalla';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let contenedor: HTMLDivElement;
let raiz: Root;

function Formulario(): React.JSX.Element {
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  return createElement(
    'div',
    null,
    createElement(CampoDeTexto, {
      etiqueta: 'Nombre',
      valor: nombre,
      alCambiar: setNombre,
      maxLength: 10,
      'data-prueba': 'campo-nombre',
    } as CampoDeTextoProps),
    createElement(CampoDeTexto, {
      etiqueta: 'Precio',
      disposicion: 'decimal',
      valor: precio,
      alCambiar: setPrecio,
      'data-prueba': 'campo-precio',
    } as CampoDeTextoProps),
  );
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

/** Lo que el formulario tiene en sus dos campos, leído del DOM. */
const valores = {
  get nombre(): string {
    return (porPrueba('campo-nombre') as HTMLInputElement).value;
  },
  get precio(): string {
    return (porPrueba('campo-precio') as HTMLInputElement).value;
  },
};

function tocar(nombre: string): void {
  const elemento = porPrueba(nombre);
  if (elemento === null) {
    throw new Error(`No existe ${nombre}.`);
  }
  act(() => {
    elemento.click();
  });
}

function enfocar(nombre: string): void {
  const elemento = porPrueba(nombre);
  if (elemento === null) {
    throw new Error(`No existe ${nombre}.`);
  }
  act(() => {
    elemento.focus();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (): number => 0;
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz.render(createElement(ProveedorDeTeclado, null, createElement(Formulario)));
  });
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  contenedor.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('Tocar un campo abre el teclado, y escribir con él llena ESE campo', () => {
  it('sin tocar ningún campo no hay teclado a la vista', () => {
    expect(porPrueba('teclado-en-pantalla')).toBeNull();
  });

  it('al enfocar el nombre se abre el teclado de TEXTO', () => {
    enfocar('campo-nombre');
    expect(porPrueba('teclado-en-pantalla')?.getAttribute('data-disposicion')).toBe('texto');
  });

  it('las teclas escriben en el campo, y la primera letra sale en mayúscula', () => {
    enfocar('campo-nombre');
    for (const tecla of ['m', 'a', 'í', 'z']) {
      tocar(`tp-${tecla}`);
    }
    expect(valores.nombre).toBe('Maíz');
    expect((porPrueba('campo-nombre') as HTMLInputElement).value).toBe('Maíz');
    expect(porPrueba('tp-vista')?.textContent).toBe('Maíz');
  });

  it('el campo de precio abre el teclado DECIMAL, sin letras', () => {
    enfocar('campo-precio');
    expect(porPrueba('teclado-en-pantalla')?.getAttribute('data-disposicion')).toBe('decimal');
    expect(porPrueba('tp-a')).toBeNull();
    tocar('tp-4');
    tocar('tp-.');
    tocar('tp-5');
    tocar('tp-0');
    expect(valores.precio).toBe('4.50');
  });

  it('pasar a otro campo liga el teclado al nuevo, sin tocar el anterior', () => {
    enfocar('campo-nombre');
    tocar('tp-a');
    enfocar('campo-precio');
    tocar('tp-7');
    expect(valores.nombre).toBe('A');
    expect(valores.precio).toBe('7');
  });

  it('«Listo» cierra el teclado, y volver a tocar el campo lo abre otra vez', () => {
    enfocar('campo-nombre');
    tocar('tp-listo');
    expect(porPrueba('teclado-en-pantalla')).toBeNull();
    tocar('campo-nombre');
    expect(porPrueba('teclado-en-pantalla')).not.toBeNull();
  });

  it('tocar FUERA del teclado y de los campos lo cierra, para no tapar el botón de guardar', () => {
    enfocar('campo-nombre');
    act(() => {
      document.body.click();
    });
    expect(porPrueba('teclado-en-pantalla')).toBeNull();
  });

  it('tocar una TECLA no lo cierra', () => {
    enfocar('campo-nombre');
    tocar('tp-a');
    expect(porPrueba('teclado-en-pantalla')).not.toBeNull();
  });

  it('respeta el maxLength del campo', () => {
    enfocar('campo-nombre');
    for (let vez = 0; vez < 15; vez += 1) {
      tocar('tp-a');
    }
    expect(valores.nombre).toHaveLength(10);
  });

  it('el campo le pide a Windows que NO abra su propio teclado encima', () => {
    expect(porPrueba('campo-nombre')?.getAttribute('inputmode')).toBe('none');
  });
});
