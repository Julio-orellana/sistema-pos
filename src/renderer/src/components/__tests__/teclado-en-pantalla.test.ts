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

import {
  CampoDeFecha,
  CampoDeTexto,
  ProveedorDeTeclado,
  type CampoDeFechaProps,
  type CampoDeTextoProps,
} from '../TecladoEnPantalla';

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
  // Se compara el atributo y no se arma un selector: el motor de selectores
  // de jsdom no encuentra `[data-prueba="tp-&"]`, y las teclas de símbolos
  // tienen justamente esos caracteres.
  return (
    Array.from(contenedor.querySelectorAll<HTMLElement>('[data-prueba]')).find(
      (elemento) => elemento.getAttribute('data-prueba') === nombre,
    ) ?? null
  );
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

  it('EL TOQUE QUE LO ABRE NO LO CIERRA aunque el teclado aparezca debajo del dedo (click al ancestro común)', () => {
    // La secuencia medida en la app real a 720 px (2026-09-15):
    // mousedown→campo · focus→campo · mouseup→teclado · click→<main>.
    const campo = porPrueba('campo-nombre') as HTMLInputElement;
    act(() => {
      campo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      campo.focus();
    });
    expect(porPrueba('teclado-en-pantalla')).not.toBeNull();
    act(() => {
      porPrueba('teclado-en-pantalla')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      contenedor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(porPrueba('teclado-en-pantalla')).not.toBeNull();
  });

  it('un gesto que EMPIEZA fuera sigue cerrándolo', () => {
    enfocar('campo-nombre');
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

// ===========================================================================
// 2026-09-15: lo que hizo falta para migrar los 22 campos que no tenían
// teclado (el correo y la contraseña de la nube, el PIN del alta de usuario,
// las fechas de los reportes y del historial).
// ===========================================================================

/** Un formulario con un correo, una contraseña y una fecha, como el de la nube. */
function FormularioDeCuenta(): React.JSX.Element {
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [fecha, setFecha] = useState('');
  return createElement(
    'div',
    null,
    createElement(CampoDeTexto, {
      etiqueta: 'Correo',
      valor: correo,
      alCambiar: setCorreo,
      mayusculaInicial: false,
      'data-prueba': 'campo-correo',
    } as CampoDeTextoProps),
    createElement(CampoDeTexto, {
      etiqueta: 'Contraseña',
      valor: contrasena,
      alCambiar: setContrasena,
      oculto: true,
      mayusculaInicial: false,
      'data-prueba': 'campo-contrasena',
    } as CampoDeTextoProps),
    createElement(CampoDeFecha, {
      valor: fecha,
      alCambiar: setFecha,
      'data-prueba': 'campo-fecha',
    } as CampoDeFechaProps),
    createElement(CampoDeFecha, {
      valor: '',
      alCambiar: () => undefined,
      conHora: true,
      'data-prueba': 'campo-fecha-y-hora',
    } as CampoDeFechaProps),
  );
}

function montarCuenta(): void {
  act(() => {
    raiz.render(createElement(ProveedorDeTeclado, null, createElement(FormularioDeCuenta)));
  });
}

describe('Correo y contraseña: lo que la capa de letras no alcanzaba', () => {
  beforeEach(montarCuenta);

  it('un correo se escribe entero con la capa de SÍMBOLOS, y sin mayúscula inicial', () => {
    enfocar('campo-correo');
    for (const tecla of ['c', 'a', 'j', 'a', '1']) {
      tocar(`tp-${tecla}`);
    }
    tocar('tp-simbolos');
    tocar('tp-@');
    tocar('tp-simbolos');
    for (const tecla of ['t', 'i', 'e', 'n', 'd', 'a', '.', 'g', 't']) {
      tocar(`tp-${tecla}`);
    }
    expect((porPrueba('campo-correo') as HTMLInputElement).value).toBe('caja1@tienda.gt');
  });

  it('la capa de símbolos trae los signos que una contraseña puede llevar, y «abc» vuelve a las letras', () => {
    enfocar('campo-correo');
    tocar('tp-simbolos');
    for (const signo of ['@', '_', '#', '$', '&', '*', '!', '?', '+', '=']) {
      expect(porPrueba(`tp-${signo}`), signo).not.toBeNull();
    }
    expect(porPrueba('tp-q')).toBeNull();
    expect(porPrueba('tp-simbolos')?.textContent).toBe('abc');
    tocar('tp-simbolos');
    expect(porPrueba('tp-q')).not.toBeNull();
  });

  it('la contraseña es un campo de tipo password, y la vista del teclado muestra PUNTOS, nunca el texto', () => {
    expect(porPrueba('campo-contrasena')?.getAttribute('type')).toBe('password');
    enfocar('campo-contrasena');
    for (const tecla of ['c', 'l', 'a', 'v', 'e']) {
      tocar(`tp-${tecla}`);
    }
    expect((porPrueba('campo-contrasena') as HTMLInputElement).value).toBe('clave');
    expect(porPrueba('tp-vista')?.textContent).toBe('•••••');
    expect(porPrueba('teclado-en-pantalla')?.textContent).not.toContain('clave');
  });

  it('al pasar de la contraseña a un campo visible, la vista vuelve a mostrar el texto', () => {
    enfocar('campo-contrasena');
    tocar('tp-x');
    enfocar('campo-correo');
    tocar('tp-y');
    expect(porPrueba('tp-vista')?.textContent).toBe('y');
  });

  it('abrir otro campo vuelve a la capa de LETRAS', () => {
    enfocar('campo-correo');
    tocar('tp-simbolos');
    enfocar('campo-contrasena');
    expect(porPrueba('tp-q')).not.toBeNull();
  });
});

describe('CampoDeFecha: tocarlo abre el calendario', () => {
  beforeEach(montarCuenta);

  it('es un campo de fecha, o de fecha y hora, que le pide a Windows no abrir su teclado', () => {
    expect(porPrueba('campo-fecha')?.getAttribute('type')).toBe('date');
    expect(porPrueba('campo-fecha-y-hora')?.getAttribute('type')).toBe('datetime-local');
    expect(porPrueba('campo-fecha')?.getAttribute('inputmode')).toBe('none');
  });

  it('un toque en CUALQUIER parte del campo llama a showPicker, no solo el iconito', () => {
    const campo = porPrueba('campo-fecha') as HTMLInputElement;
    let llamadas = 0;
    Object.defineProperty(campo, 'showPicker', {
      configurable: true,
      value: (): void => {
        llamadas += 1;
      },
    });
    tocar('campo-fecha');
    expect(llamadas).toBe(1);
  });

  it('si el calendario no se puede abrir (ya abierto, o sin gesto), el toque no rompe nada', () => {
    const campo = porPrueba('campo-fecha') as HTMLInputElement;
    Object.defineProperty(campo, 'showPicker', {
      configurable: true,
      value: (): void => {
        throw new DOMException('ya está abierto', 'InvalidStateError');
      },
    });
    expect(() => {
      tocar('campo-fecha');
    }).not.toThrow();
  });

  it('elegir una fecha llega al formulario tal cual la da el control nativo', () => {
    const campo = porPrueba('campo-fecha') as HTMLInputElement;
    act(() => {
      // El setter del prototipo, como lo hace el control nativo: asignar
      // `campo.value` directo lo esconde de React y no dispara onChange.
      Reflect.set(HTMLInputElement.prototype, 'value', '2026-09-15', campo);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(campo.value).toBe('2026-09-15');
  });

  it('tocar una fecha cierra el teclado alfanumérico que estuviera abierto', () => {
    enfocar('campo-correo');
    expect(porPrueba('teclado-en-pantalla')).not.toBeNull();
    tocar('campo-fecha');
    expect(porPrueba('teclado-en-pantalla')).toBeNull();
  });
});
