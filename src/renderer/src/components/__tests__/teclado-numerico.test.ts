/**
 * @vitest-environment jsdom
 *
 * El teclado táctil en sus dos modos.
 *
 * Importa que el modo PIN no haya cambiado: cuatro pantallas ya lo usaban y
 * ninguna pasa el modo nuevo. Y importa que el modo cantidad respete el límite
 * de decimales de cada producto, porque de ahí sale el número que multiplica
 * el precio.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TecladoNumerico, type TecladoNumericoProps } from '../TecladoNumerico';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let contenedor: HTMLDivElement;
let raiz: Root;
/** Lo que el teclado fue reportando a su padre. */
let valorActual: string;
/** Cuántas veces se confirmó. */
let confirmaciones: number;

/** Monta el teclado con un valor controlado, como lo haría una pantalla. */
function montar(propiedades: Partial<TecladoNumericoProps> = {}): void {
  const dibujar = (): void => {
    act(() => {
      raiz.render(
        createElement(TecladoNumerico, {
          valor: valorActual,
          alCambiar: (nuevo: string) => {
            valorActual = nuevo;
            dibujar();
          },
          alConfirmar: () => {
            confirmaciones += 1;
          },
          ...propiedades,
        }),
      );
    });
  };
  dibujar();
}

function tecla(nombre: string): HTMLButtonElement | null {
  return contenedor.querySelector<HTMLButtonElement>(`[data-prueba="tecla-${nombre}"]`);
}

/** Pulsa una secuencia de teclas por su nombre. */
function pulsar(...nombres: readonly string[]): void {
  for (const nombre of nombres) {
    const boton = tecla(nombre);
    if (boton === null) {
      throw new Error(`No existe la tecla ${nombre}.`);
    }
    act(() => {
      boton.click();
    });
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  valorActual = '';
  confirmaciones = 0;
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  contenedor.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

// ===========================================================================
describe('Modo PIN: sigue funcionando exactamente como antes', () => {
  it('enmascara con puntos y no muestra el número', () => {
    montar();
    pulsar('1', '2');

    // Se mira el visor, no todo el teclado: las etiquetas de las teclas
    // contienen los dígitos siempre, y confundirlas con el PIN haría que esta
    // prueba pasara o fallara por el motivo equivocado.
    const visor = contenedor.querySelector('[data-prueba="puntos-del-pin"]');
    expect(visor).not.toBeNull();
    expect(visor?.textContent).toBe('');
    expect(visor?.querySelectorAll('.teclado__punto--lleno')).toHaveLength(2);

    // Y no existe el visor del modo cantidad, que sí muestra el número.
    expect(contenedor.querySelector('[data-prueba="cantidad-ingresada"]')).toBeNull();
  });

  it('no admite más de cuatro dígitos', () => {
    montar();
    pulsar('1', '2', '3', '4');
    expect(valorActual).toBe('1234');

    // La quinta tecla ya está deshabilitada.
    expect(tecla('5')?.disabled).toBe(true);
  });

  it('NO tiene tecla de punto decimal', () => {
    montar();
    expect(tecla('punto')).toBeNull();
  });

  it('solo confirma con el PIN completo', () => {
    montar();
    pulsar('1', '2', '3');
    expect(tecla('confirmar')?.disabled).toBe(true);

    pulsar('4');
    expect(tecla('confirmar')?.disabled).toBe(false);
  });
});

// ===========================================================================
describe('Modo cantidad para un producto POR PESO: hasta tres decimales', () => {
  const porPeso = { modo: 'cantidad' as const, decimales: 3 };

  it('muestra el número, no puntos: la cantidad no es un secreto', () => {
    montar(porPeso);
    pulsar('1', '2');

    expect(contenedor.querySelector('[data-prueba="cantidad-ingresada"]')).not.toBeNull();
    expect(contenedor.textContent).toContain('12');
  });

  it('tiene tecla de punto decimal', () => {
    montar(porPeso);
    expect(tecla('punto')).not.toBeNull();
  });

  it('acepta exactamente tres decimales', () => {
    montar(porPeso);
    pulsar('1', 'punto', '2', '5', '6');
    expect(valorActual).toBe('1.256');
  });

  it('RECHAZA el cuarto decimal', () => {
    montar(porPeso);
    pulsar('1', 'punto', '2', '5', '6');

    // Las teclas de dígito quedan deshabilitadas: no es que el toque se pierda
    // en silencio, es que ya no se puede tocar.
    expect(tecla('7')?.disabled).toBe(true);
    pulsar('7');
    expect(valorActual).toBe('1.256');
  });

  it('un solo punto: el segundo no se puede tocar', () => {
    montar(porPeso);
    pulsar('1', 'punto');
    expect(tecla('punto')?.disabled).toBe(true);
  });

  it('tocar el punto sin nada escrito da "0."', () => {
    montar(porPeso);
    pulsar('punto', '5');
    expect(valorActual).toBe('0.5');
  });

  it('no deja un cero a la izquierda inútil', () => {
    montar(porPeso);
    pulsar('0', '5');
    expect(valorActual).toBe('5');
  });

  it('no confirma con el campo vacío ni con cero', () => {
    montar(porPeso);
    expect(tecla('confirmar')?.disabled).toBe(true);

    pulsar('0');
    expect(tecla('confirmar')?.disabled).toBe(true);

    pulsar('punto', '5');
    expect(tecla('confirmar')?.disabled).toBe(false);
  });

  it('borrar quita el último carácter, incluido el punto', () => {
    montar(porPeso);
    pulsar('1', 'punto', '5', 'borrar', 'borrar');
    expect(valorActual).toBe('1');
  });
});

// ===========================================================================
describe('Modo cantidad para un producto POR UNIDAD: solo enteros', () => {
  const porUnidad = { modo: 'cantidad' as const, decimales: 0 };

  it('NO tiene tecla de punto decimal', () => {
    // Media docena se pide como seis huevos, no como 0.5 docenas.
    montar(porUnidad);
    expect(tecla('punto')).toBeNull();
  });

  it('deja escribir enteros de varios dígitos', () => {
    montar(porUnidad);
    pulsar('2', '4');
    expect(valorActual).toBe('24');
  });

  it('confirma con un entero mayor que cero', () => {
    montar(porUnidad);
    pulsar('3');
    expect(tecla('confirmar')?.disabled).toBe(false);

    act(() => {
      tecla('confirmar')?.click();
    });
    expect(confirmaciones).toBe(1);
  });
});

// ===========================================================================
describe('Freno a los errores de tecleo', () => {
  it('no admite un número absurdamente largo', () => {
    montar({ modo: 'cantidad', decimales: 0 });
    pulsar('9', '9', '9', '9', '9', '9', '9', '9', '9');

    expect(valorActual).toHaveLength(9);
    expect(tecla('9')?.disabled).toBe(true);
  });
});

describe('Modo cantidad que ADMITE CERO: contar efectivo', () => {
  it('sin admiteCero, un 0 no se puede confirmar (el ticket no vende cero libras)', () => {
    montar({ modo: 'cantidad', decimales: 2 });
    pulsar('0');
    expect(tecla('confirmar')?.disabled).toBe(true);
  });

  it('con admiteCero, un 0 sí se confirma: un cajón sin billetes de Q200 es un conteo válido', () => {
    montar({ modo: 'cantidad', decimales: 0, admiteCero: true });
    pulsar('0');
    expect(tecla('confirmar')?.disabled).toBe(false);
  });

  it('con dos decimales escribe un monto en quetzales y centavos, y no deja un tercero', () => {
    montar({ modo: 'cantidad', decimales: 2, admiteCero: true });
    pulsar('4', '8', '0', 'punto', '5', '0');
    expect(valorActual).toBe('480.50');
    expect(tecla('5')?.disabled).toBe(true);
  });
});
