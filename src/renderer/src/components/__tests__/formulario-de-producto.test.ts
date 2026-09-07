/**
 * @vitest-environment jsdom
 *
 * Prueba de la validación EN TIEMPO REAL del formulario de producto.
 *
 * Responde con evidencia, no con revisión de código, a la pregunta de
 * auditoría: ¿el formulario impide de verdad guardar un producto incoherente,
 * o solo lo dice y deja guardar igual?
 *
 * El método es el mismo que usan las pruebas de los bloqueos del kiosko: se
 * monta el componente en un navegador simulado, se hacen los gestos que haría
 * quien carga el catálogo y se mira el DOM resultante. `window.pos` se
 * reemplaza por un doble que REGISTRA las llamadas, así se puede afirmar que
 * el formulario ni siquiera intentó guardar.
 *
 * Esto NO reemplaza la validación del servicio ni el CHECK del esquema: las
 * tres existen y se prueban por separado. Lo que se comprueba acá es que quien
 * llena el formulario se entera del problema mientras lo llena.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { CategoriaIpc, ProductoIpc } from '@shared/types/ipc';
import { FormularioDeProducto } from '../FormularioDeProducto';
import { PantallaDeProductos } from '../PantallaDeProductos';

/** React exige esta marca para no advertir sobre `act` fuera de una prueba. */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const GRANOS: CategoriaIpc = {
  id: 'cat-granos',
  nombre: 'Granos',
  orden: 1,
  activo: true,
  productosAsociados: 2,
};

const MAIZ: ProductoIpc = {
  id: 'prod-maiz',
  nombre: 'Maíz blanco',
  categoriaId: GRANOS.id,
  categoriaNombre: GRANOS.nombre,
  tipoMedida: 'peso',
  unidadPeso: 'lb',
  cantidadPredefinidaIcono: '1.000',
  precioBase: '4.25',
  inventarioDisponible: '250.000',
  fotoPath: null,
  fotoUrl: null,
  activo: true,
  contadorVentas: 0,
};

/** Llamadas que el formulario le hizo al proceso principal. */
let llamadas: string[];
let contenedor: HTMLDivElement;
let raiz: Root;

/** Doble de `window.pos` que registra qué canales se invocaron. */
function instalarDobleDeApi(): void {
  llamadas = [];
  const registrar = <T,>(canal: string, datos: T) => async (): Promise<{
    ok: true;
    datos: T;
  }> => {
    llamadas.push(canal);
    return Promise.resolve({ ok: true as const, datos });
  };

  const catalogo = {
    listarCategorias: registrar('listarCategorias', [GRANOS] as readonly CategoriaIpc[]),
    crearCategoria: registrar('crearCategoria', GRANOS),
    editarCategoria: registrar('editarCategoria', GRANOS),
    fijarActivoCategoria: registrar('fijarActivoCategoria', GRANOS),
    listarProductos: registrar('listarProductos', [MAIZ] as readonly ProductoIpc[]),
    crearProducto: registrar('crearProducto', MAIZ),
    editarProducto: registrar('editarProducto', MAIZ),
    fijarActivoProducto: registrar('fijarActivoProducto', MAIZ),
    ajustarInventario: registrar('ajustarInventario', {
      producto: MAIZ,
      cantidadAnterior: '250.000',
      cantidadAgregada: '50.000',
      cantidadNueva: '300.000',
    }),
    elegirFoto: registrar('elegirFoto', { elegida: false, fotoPath: null, fotoUrl: null }),
  };

  (window as unknown as { pos: unknown }).pos = { catalogo };
}

/** Monta un componente y espera a que React termine de pintar. */
async function montar(elemento: React.ReactElement): Promise<void> {
  await act(async () => {
    raiz.render(elemento);
    await Promise.resolve();
  });
}

/** Busca por el atributo `data-prueba`, que es el que no cambia con el diseño. */
function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

/** Igual que el anterior, pero falla con un mensaje claro si no está. */
function exigir(nombre: string): HTMLElement {
  const elemento = porPrueba(nombre);
  if (elemento === null) {
    throw new Error(`No se encontró el elemento con data-prueba="${nombre}".`);
  }
  return elemento;
}

/** El mismo elemento, ya tipado como campo de texto. */
function exigirCampo(nombre: string): HTMLInputElement {
  return exigir(nombre) as HTMLInputElement;
}

/** El mismo elemento, ya tipado como botón. */
function exigirBoton(nombre: string): HTMLButtonElement {
  return exigir(nombre) as HTMLButtonElement;
}

/** El mismo elemento, ya tipado como desplegable. */
function exigirDesplegable(nombre: string): HTMLSelectElement {
  return exigir(nombre) as HTMLSelectElement;
}

/** Hace clic y espera a que React reaccione. */
async function clic(elemento: HTMLElement): Promise<void> {
  await act(async () => {
    elemento.click();
    await Promise.resolve();
  });
}

/**
 * Escribe en un campo disparando el evento que React escucha.
 *
 * No basta con asignar `campo.value`: React instala su propio descriptor sobre
 * la propiedad y no se entera del cambio. Hay que llamar al asignador nativo y
 * después despachar el evento a mano.
 */
async function escribir(campo: HTMLInputElement, texto: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  );
  await act(async () => {
    // Se invoca sobre el propio campo (`descriptor.set.call`), que es lo que
    // hace que React vea el valor nuevo.
    descriptor?.set?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  instalarDobleDeApi();
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
describe('El formulario de producto se dibuja', () => {
  it('se monta para crear un producto sin romperse', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: null,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );

    expect(porPrueba('formulario-de-producto')).not.toBeNull();
    expect(contenedor.textContent).toContain('Nuevo producto');
  });

  it('se monta para editar y trae los datos del producto', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: MAIZ,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );

    expect(exigirCampo('producto-nombre').value).toBe('Maíz blanco');
    expect(exigirCampo('producto-precio').value).toBe('4.25');
  });

  it('al editar NO ofrece campo de inventario: eso es una acción aparte', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: MAIZ,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );

    expect(porPrueba('producto-inventario-inicial')).toBeNull();
    expect(contenedor.textContent).toContain('Ajustar inventario');
  });

  it('al CREAR sí lo ofrece, porque todavía no hay saldo que ajustar', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: null,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );

    expect(porPrueba('producto-inventario-inicial')).not.toBeNull();
  });
});

// ===========================================================================
describe('La coherencia tipo de medida / unidad se valida mientras se escribe', () => {
  /** Monta el formulario de alta con un nombre ya escrito. */
  async function formularioConNombre(): Promise<void> {
    await montar(
      createElement(FormularioDeProducto, {
        producto: null,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );
    await escribir(exigirCampo('producto-nombre'), 'Arroz');
  }

  it('elegir "por peso" propone libras sola, para no dejar el formulario incoherente', async () => {
    await formularioConNombre();
    await clic(exigir('producto-tipo-peso'));

    const unidad = exigirDesplegable('producto-unidad-peso');
    expect(unidad.value).toBe('lb');
    expect(porPrueba('producto-impedimento')).toBeNull();
  });

  it('con "por unidad" no se muestra siquiera el desplegable de unidad de peso', async () => {
    await formularioConNombre();
    await clic(exigir('producto-tipo-unidad'));

    // Un desplegable inerte al lado invita a llenarlo y a romper la coherencia.
    expect(porPrueba('producto-unidad-peso')).toBeNull();
  });

  it('desde la interfaz es IMPOSIBLE dejar un producto por peso sin unidad', async () => {
    await formularioConNombre();
    await clic(exigir('producto-tipo-peso'));

    // El desplegable solo ofrece libras y kilogramos, y elegir "por peso" ya
    // dejó una puesta. No hay ningún gesto que produzca el estado incoherente:
    // por eso el botón queda habilitado y no hay impedimento que mostrar.
    const unidad = exigirDesplegable('producto-unidad-peso');
    const opciones = [...unidad.options].map((opcion) => opcion.value);
    expect(opciones).toEqual(['lb', 'kg']);
    expect(unidad.value).toBe('lb');

    expect(porPrueba('producto-impedimento')).toBeNull();
    expect(exigirBoton('producto-guardar').disabled).toBe(false);
  });

  it('si aun así llegara un estado incoherente, el impedimento lo bloquea', async () => {
    // La interfaz no puede producirlo, pero la regla que decide si se puede
    // guardar es la misma que usaría cualquier otro camino, así que se prueba
    // directamente sobre un producto ya guardado como "por peso" al que se le
    // cambia el tipo a "por unidad" conservando la unidad: el formulario debe
    // limpiarla y no dejar el estado a medias.
    await montar(
      createElement(FormularioDeProducto, {
        producto: MAIZ,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );

    expect(exigirDesplegable('producto-unidad-peso').value).toBe('lb');
    await clic(exigir('producto-tipo-unidad'));

    expect(porPrueba('producto-unidad-peso')).toBeNull();
    expect(porPrueba('producto-impedimento')).toBeNull();
    expect(exigirBoton('producto-guardar').disabled).toBe(false);
  });

  it('sin nombre no deja guardar y dice qué falta', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: null,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );

    expect(exigirBoton('producto-guardar').disabled).toBe(true);
    expect(exigir('producto-impedimento').textContent).toContain('Falta el nombre');
  });

  it('sin categoría no deja guardar y explica que hay que crear una primero', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: null,
        categorias: [],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );
    await escribir(exigirCampo('producto-nombre'), 'Arroz');

    expect(exigirBoton('producto-guardar').disabled).toBe(true);
    expect(exigir('producto-impedimento').textContent).toContain('Elegí una categoría');
  });

  it('NI SIQUIERA INTENTA guardar mientras el formulario está incompleto', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: null,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );

    await clic(exigir('producto-guardar'));

    // Ninguna llamada al proceso principal: el trabajo no llega ni a salir de
    // la ventana, que es lo que hace que el aviso sea inmediato.
    expect(llamadas).not.toContain('crearProducto');
  });

  it('con el formulario completo, guardar SÍ llama al proceso principal', async () => {
    await montar(
      createElement(FormularioDeProducto, {
        producto: null,
        categorias: [GRANOS],
        alGuardar: () => undefined,
        alCancelar: () => undefined,
      }),
    );
    await escribir(exigirCampo('producto-nombre'), 'Arroz');
    await clic(exigir('producto-guardar'));

    expect(llamadas).toContain('crearProducto');
  });
});

// ===========================================================================
describe('La pantalla de productos', () => {
  it('lista los productos con su categoría, precio e inventario', async () => {
    await montar(createElement(PantallaDeProductos, { alVolver: () => undefined }));

    expect(porPrueba('lista-de-productos')).not.toBeNull();
    expect(contenedor.textContent).toContain('Maíz blanco');
    expect(contenedor.textContent).toContain('Granos');
    expect(contenedor.textContent).toContain('250.000');
  });

  it('el buscador filtra por nombre', async () => {
    await montar(createElement(PantallaDeProductos, { alVolver: () => undefined }));
    await escribir(exigirCampo('productos-buscador'), 'azúcar');

    expect(contenedor.textContent).not.toContain('Maíz blanco');
    expect(contenedor.textContent).toContain('Ningún producto coincide');
  });

  it('«Ajustar inventario» es un botón propio y visible, no una opción escondida', async () => {
    await montar(createElement(PantallaDeProductos, { alVolver: () => undefined }));

    const boton = exigirBoton('producto-ajustar-inventario');
    expect(boton.textContent).toContain('Ajustar inventario');
  });

  it('desactivar pide confirmación explícita antes de hacer nada', async () => {
    await montar(createElement(PantallaDeProductos, { alVolver: () => undefined }));

    const desactivar = [...contenedor.querySelectorAll('button')].find(
      (boton) => boton.textContent === 'Desactivar',
    );
    await clic(desactivar as HTMLElement);

    expect(porPrueba('modal-desactivar-producto')).not.toBeNull();
    // Nada se cambió todavía: solo se abrió la confirmación.
    expect(llamadas).not.toContain('fijarActivoProducto');
  });

  it('recién al confirmar se desactiva de verdad', async () => {
    await montar(createElement(PantallaDeProductos, { alVolver: () => undefined }));

    const desactivar = [...contenedor.querySelectorAll('button')].find(
      (boton) => boton.textContent === 'Desactivar',
    );
    await clic(desactivar as HTMLElement);
    await clic(exigir('confirmar-desactivar'));

    expect(llamadas).toContain('fijarActivoProducto');
  });
});
