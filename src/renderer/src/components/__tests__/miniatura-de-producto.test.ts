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

import {
  MiniaturaDeProducto,
  PALETA_DE_MARCADORES,
  colorDe,
  inicialesDe,
} from '../MiniaturaDeProducto';

/**
 * Contraste WCAG 2.1 entre dos colores, tal como lo define la norma.
 *
 * Vive en la prueba y no en el componente a propósito: la aplicación no
 * necesita calcular contraste en tiempo de ejecución, lo que necesita es que
 * alguien lo compruebe antes de que un color llegue a la paleta. Eso es lo que
 * hace este archivo.
 */
function canalLineal(valor: number): number {
  const normalizado = valor / 255;
  return normalizado <= 0.03928
    ? normalizado / 12.92
    : Math.pow((normalizado + 0.055) / 1.055, 2.4);
}

function luminancia(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b);
}

function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const mayor = Math.max(la, lb);
  const menor = Math.min(la, lb);
  return (mayor + 0.05) / (menor + 0.05);
}

/**
 * Umbral exigido: 4,5:1, el de WCAG para texto NORMAL.
 *
 * Las iniciales son de 20 px en negrita, que la norma clasifica como texto
 * grande y solo pediría 3:1. Se exige el umbral estricto igualmente: da margen
 * si mañana la tipografía se achica, y la pantalla del mostrador se mira con
 * la luz que haya.
 */
const CONTRASTE_MINIMO = 4.5;

/** Color del texto de las iniciales, el mismo que fija global.css. */
const TEXTO = '#ffffff';

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

// ===========================================================================
describe('La paleta es cerrada y legible, no una apuesta del hash', () => {
  it('cada color de la paleta es legible con texto blanco (>= 4,5:1)', () => {
    // Esta es LA prueba que convierte "los elegí con cuidado" en una garantía.
    // Si alguien agrega mañana un amarillo claro a la paleta, esto se cae.
    for (const color of PALETA_DE_MARCADORES) {
      expect(
        contraste(TEXTO, color),
        `El color ${color} da ${contraste(TEXTO, color).toFixed(2)}:1 con el texto blanco.`,
      ).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
    }
  });

  it('la paleta no tiene colores repetidos', () => {
    expect(new Set(PALETA_DE_MARCADORES).size).toBe(PALETA_DE_MARCADORES.length);
  });

  it('todos los colores están escritos en el mismo formato', () => {
    for (const color of PALETA_DE_MARCADORES) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('el hash SOLO elige de la paleta: nunca compone un color propio', () => {
    // Se prueban nombres adversarios además de los normales: emoji, acentos,
    // cadenas larguísimas y caracteres de control. Ninguno debe producir un
    // color fuera de la lista aprobada.
    const permitidos = new Set<string>(PALETA_DE_MARCADORES);
    const nombres = [
      '',
      ' ',
      'Maíz',
      'ñandú',
      '🌽🌽🌽',
      'a'.repeat(5000),
      '\u0000\u0001\u0002',
      '中文产品名称',
      '[Ejemplo] Maíz blanco',
    ];
    for (let i = 0; i < 500; i += 1) {
      nombres.push(Math.random().toString(36).slice(2));
    }

    for (const nombre of nombres) {
      expect(permitidos.has(colorDe(nombre))).toBe(true);
    }
  });

  it('reparte: los productos de una misma familia NO caen todos igual', () => {
    // Fue un defecto real: con el resto tomado contra 8 en cada vuelta, el
    // multiplicador 31 degeneraba en una suma alternada y los tres primeros
    // «Maíz» compartían color.
    const familia = ['Maíz blanco', 'Maíz amarillo', 'Maíz quebrado', 'Maíz para pollo'];
    expect(new Set(familia.map(colorDe)).size).toBeGreaterThan(1);
  });

  it('usa toda la paleta sobre un catálogo realista, no dos colores', () => {
    const catalogo = [
      'Maíz blanco', 'Frijol negro', 'Azúcar', 'Arroz', 'Café molido', 'Sal',
      'Aceite', 'Harina', 'Huevos, docena', 'Huevos, cartón de 30', 'Avena',
      'Lenteja', 'Garbanzo', 'Panela', 'Manteca', 'Fideos', 'Consomé',
      'Chile seco', 'Canela', 'Achiote', 'Maíz amarillo', 'Frijol rojo',
      'Azúcar morena', 'Arroz precocido',
    ];
    expect(new Set(catalogo.map(colorDe)).size).toBe(PALETA_DE_MARCADORES.length);
  });
});
