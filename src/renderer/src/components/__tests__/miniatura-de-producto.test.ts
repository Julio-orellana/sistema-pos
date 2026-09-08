/**
 * @vitest-environment jsdom
 *
 * Pruebas del marcador de "producto todavía sin foto".
 *
 * Importa porque NO es un caso raro: es lo que se ve en cada producto recién
 * dado de alta, y es lo que Jimmy va a ver en toda la lista la primera vez que
 * cargue su catálogo. Un hueco vacío ahí se lee como un error de carga.
 */

import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MiniaturaDeProducto, colorDe, inicialesDe } from '../MiniaturaDeProducto';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Monta el componente y devuelve el nodo que dibujó. */
function dibujar(nombre: string, fotoUrl: string | null): HTMLElement {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  const raiz: Root = createRoot(contenedor);
  act(() => {
    raiz.render(createElement(MiniaturaDeProducto, { nombre, fotoUrl }));
  });
  const nodo = contenedor.firstElementChild;
  if (nodo === null) {
    throw new Error('El componente no dibujó nada.');
  }
  return nodo as HTMLElement;
}

// ===========================================================================
describe('Las iniciales que se muestran', () => {
  it('toma la primera letra de las dos primeras palabras', () => {
    expect(inicialesDe('Maíz blanco')).toBe('MB');
  });

  it('con una sola palabra muestra una sola letra', () => {
    expect(inicialesDe('Azúcar')).toBe('A');
  });

  it('IGNORA el prefijo de los datos de ejemplo', () => {
    // Si no lo ignorara, todos los productos de ejemplo mostrarían la misma
    // inicial y el marcador dejaría de distinguir una fila de otra.
    expect(inicialesDe('[Ejemplo] Maíz blanco')).toBe('MB');
    expect(inicialesDe('[Ejemplo] Azúcar')).toBe('A');
  });

  it('no se marea con comas ni con números', () => {
    expect(inicialesDe('Huevos, cartón de 30')).toBe('HC');
    expect(inicialesDe('30 libras de arroz')).toBe('3L');
  });

  it('nunca pasa de dos letras, por largo que sea el nombre', () => {
    expect(inicialesDe('Maíz blanco de primera calidad para tortilla')).toHaveLength(2);
  });

  it('con un nombre imposible devuelve algo, no una cadena vacía', () => {
    expect(inicialesDe('')).toBe('?');
    expect(inicialesDe('   ')).toBe('?');
    expect(inicialesDe('[]()')).toBe('?');
  });

  it('rescata la letra aunque venga pegada a un símbolo', () => {
    expect(inicialesDe('#azúcar')).toBe('A');
  });
});

// ===========================================================================
describe('El color del marcador', () => {
  it('es SIEMPRE el mismo para el mismo producto', () => {
    // Si fuera al azar, el marcador cambiaría en cada recarga y dejaría de
    // servir para reconocer un producto de un vistazo.
    expect(colorDe('Maíz blanco')).toBe(colorDe('Maíz blanco'));
  });

  it('sale de la paleta, nunca un color inventado', () => {
    const nombres = ['Maíz', 'Azúcar', 'Frijol', 'Huevos', 'Arroz', 'Café', 'Sal', 'Aceite'];
    for (const nombre of nombres) {
      expect(colorDe(nombre)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('reparte: ocho productos distintos no caen todos en el mismo color', () => {
    const nombres = ['Maíz', 'Azúcar', 'Frijol', 'Huevos', 'Arroz', 'Café', 'Sal', 'Aceite'];
    const distintos = new Set(nombres.map(colorDe));
    expect(distintos.size).toBeGreaterThan(1);
  });

  it('devuelve un color incluso con el nombre vacío', () => {
    expect(colorDe('')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ===========================================================================
describe('Qué se dibuja cuando el producto NO tiene foto', () => {
  it('NO es un hueco vacío: lleva las iniciales adentro', () => {
    const nodo = dibujar('[Ejemplo] Maíz blanco', null);
    expect(nodo.textContent).toBe('MB');
  });

  it('lleva un color de fondo puesto, no el del recuadro vacío de antes', () => {
    const nodo = dibujar('Maíz blanco', null);
    expect(nodo.style.backgroundColor).not.toBe('');
  });

  it('lo anuncia a un lector de pantalla en vez de esconderlo', () => {
    // Antes era aria-hidden: quien no ve la pantalla no se enteraba de que al
    // producto le falta la foto.
    const nodo = dibujar('Maíz blanco', null);
    expect(nodo.getAttribute('role')).toBe('img');
    expect(nodo.getAttribute('aria-label')).toBe('Maíz blanco: todavía sin foto');
    expect(nodo.getAttribute('aria-hidden')).toBeNull();
  });

  it('dos productos distintos se distinguen entre sí', () => {
    const maiz = dibujar('Maíz blanco', null);
    const azucar = dibujar('Azúcar', null);

    expect(maiz.textContent).not.toBe(azucar.textContent);
  });
});

// ===========================================================================
describe('Qué se dibuja cuando el producto SÍ tiene foto', () => {
  it('dibuja la imagen, no el marcador', () => {
    const nodo = dibujar('Frijol', 'pos-foto://catalogo/fotos-de-productos/abc.jpg');

    expect(nodo.tagName.toLowerCase()).toBe('img');
    expect(nodo.getAttribute('src')).toBe('pos-foto://catalogo/fotos-de-productos/abc.jpg');
    expect(nodo.getAttribute('alt')).toBe('Foto de Frijol');
  });

  it('no queda ningún rastro del marcador de sin foto', () => {
    const nodo = dibujar('Frijol', 'pos-foto://catalogo/fotos-de-productos/abc.jpg');
    expect(nodo.className).not.toContain('sin-foto');
  });
});
