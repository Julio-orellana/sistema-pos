/**
 * @vitest-environment jsdom
 *
 * La pantalla de gestión de usuarios.
 *
 * Lo que se verifica es lo que un administrador hace frente a ella: que vea a
 * los dados de baja además de a los activos, que el alta mande el PIN elegido,
 * que cambiar el PIN sea un diálogo aparte y no un campo del formulario, y que
 * no se le ofrezca darse de baja a sí mismo ni al único administrador.
 *
 * Que un usuario de VENTA no llegue acá no se prueba en este archivo: eso lo
 * decide el proceso principal y está en `src/main/ipc/__tests__/usuarios-guard`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { UsuarioEditadoIpc, UsuarioIpc, UsuarioNuevoIpc } from '@shared/types/ipc';
import { PantallaDeUsuarios } from '../PantallaDeUsuarios';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Jimmy, el administrador que está usando la pantalla. */
const JIMMY: UsuarioIpc = {
  id: 'u-jimmy',
  nombre: 'Jimmy',
  rol: 'administrativo',
  activo: true,
  tieneAutorizacionRemota: true,
  sinPin: false,
  bloqueado: false,
  esUnoMismo: true,
  esElUnicoAdministrador: true,
  creadoEn: '2026-09-04T12:00:00.000Z',
};

/** Ana, cajera activa. */
const ANA: UsuarioIpc = {
  id: 'u-ana',
  nombre: 'Ana',
  rol: 'venta',
  activo: true,
  tieneAutorizacionRemota: false,
  sinPin: false,
  bloqueado: false,
  esUnoMismo: false,
  esElUnicoAdministrador: false,
  creadoEn: '2026-09-05T12:00:00.000Z',
};

/** Rosa, dada de baja. */
const ROSA: UsuarioIpc = {
  ...ANA,
  id: 'u-rosa',
  nombre: 'Rosa',
  activo: false,
};

let contenedor: HTMLDivElement;
let raiz: Root;
let altas: UsuarioNuevoIpc[];
let ediciones: UsuarioEditadoIpc[];
let cambiosDePin: { id: string; pin: string }[];
let estados: { id: string; activo: boolean }[];

function instalarApi(lista: readonly UsuarioIpc[]): void {
  altas = [];
  ediciones = [];
  cambiosDePin = [];
  estados = [];
  (window as unknown as { pos: unknown }).pos = {
    usuarios: {
      listar: async (): Promise<unknown> => Promise.resolve({ ok: true as const, datos: lista }),
      crear: async (datos: UsuarioNuevoIpc): Promise<unknown> => {
        altas.push(datos);
        return Promise.resolve({ ok: true as const, datos: { ...ANA, nombre: datos.nombre } });
      },
      editar: async (datos: UsuarioEditadoIpc): Promise<unknown> => {
        ediciones.push(datos);
        return Promise.resolve({ ok: true as const, datos: { ...ANA, nombre: datos.nombre } });
      },
      cambiarPin: async (id: string, pin: string): Promise<unknown> => {
        cambiosDePin.push({ id, pin });
        return Promise.resolve({ ok: true as const, datos: ANA });
      },
      fijarActivo: async (id: string, activo: boolean): Promise<unknown> => {
        estados.push({ id, activo });
        return Promise.resolve({ ok: true as const, datos: { ...ANA, activo } });
      },
    },
  };
}

async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(createElement(PantallaDeUsuarios, { alVolver: () => undefined }));
    await Promise.resolve();
  });
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

function todos(nombre: string): HTMLElement[] {
  return [...contenedor.querySelectorAll<HTMLElement>(`[data-prueba="${nombre}"]`)];
}

function exigir(nombre: string): HTMLElement {
  const elemento = porPrueba(nombre);
  if (elemento === null) {
    throw new Error(`No se encontró [data-prueba="${nombre}"].`);
  }
  return elemento;
}

/** El botón con ese nombre de prueba dentro de la fila de un usuario. */
function enLaFilaDe(usuarioId: string, nombre: string): HTMLButtonElement {
  const fila = contenedor.querySelector(`[data-prueba="fila-de-usuario"][data-usuario="${usuarioId}"]`);
  const boton = fila?.querySelector<HTMLButtonElement>(`[data-prueba="${nombre}"]`);
  if (boton === null || boton === undefined) {
    throw new Error(`No hay ${nombre} en la fila de ${usuarioId}.`);
  }
  return boton;
}

async function clic(elemento: HTMLElement): Promise<void> {
  await act(async () => {
    elemento.click();
    await Promise.resolve();
  });
}

/** Escribe en un campo como lo haría una persona. */
async function escribir(elemento: HTMLElement, texto: string): Promise<void> {
  const campo = elemento as HTMLInputElement;
  const prototipo =
    campo.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const escribirValor = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set?.bind(campo);
  await act(async () => {
    escribirValor?.(texto);
    campo.dispatchEvent(new Event(campo.tagName === 'SELECT' ? 'change' : 'input', {
      bubbles: true,
    }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
describe('Mientras se consulta, la pantalla lo dice', () => {
  it('muestra que está consultando, y no una lista vacía', async () => {
    // La lista NUNCA puede estar vacía de verdad: para verla hay que tener
    // sesión, así que como mínimo estás vos. Una tarjeta sin filas solo
    // podría significar «todavía no llegó la respuesta», y eso se lee como
    // que no hay usuarios. Se vio manejando la aplicación real.
    let resolver: ((valor: unknown) => void) | null = null;
    (window as unknown as { pos: unknown }).pos = {
      usuarios: {
        listar: async (): Promise<unknown> =>
          new Promise((cumplir) => {
            resolver = cumplir;
          }),
      },
    };

    await montar();
    expect(porPrueba('usuarios-cargando')).not.toBeNull();
    expect(porPrueba('lista-de-usuarios')).toBeNull();

    await act(async () => {
      resolver?.({ ok: true as const, datos: [JIMMY] });
      await Promise.resolve();
    });

    expect(porPrueba('usuarios-cargando')).toBeNull();
    expect(todos('fila-de-usuario')).toHaveLength(1);
  });
});

// ===========================================================================
describe('La lista muestra activos e inactivos, distinguibles', () => {
  it('lista a los tres, incluida la dada de baja', async () => {
    instalarApi([JIMMY, ANA, ROSA]);
    await montar();

    expect(todos('fila-de-usuario')).toHaveLength(3);
  });

  it('la fila de quien está de baja se marca, no se esconde', async () => {
    instalarApi([JIMMY, ANA, ROSA]);
    await montar();

    const fila = contenedor.querySelector('[data-usuario="u-rosa"]');
    expect(fila?.className).toContain('inactiva');
    expect(fila?.textContent).toContain('Dado de baja');
    // Y ofrece reactivarla, que es para lo que hace falta verla.
    expect(enLaFilaDe('u-rosa', 'usuario-cambiar-estado').textContent).toContain('Reactivar');
  });

  it('se ve el rol de cada uno', async () => {
    instalarApi([JIMMY, ANA, ROSA]);
    await montar();

    expect(contenedor.querySelector('[data-usuario="u-jimmy"]')?.textContent).toContain(
      'Administrativo',
    );
    expect(contenedor.querySelector('[data-usuario="u-ana"]')?.textContent).toContain('Venta');
  });
});

// ===========================================================================
describe('Dar de alta', () => {
  it('manda el nombre, el rol y el PIN elegido', async () => {
    instalarApi([JIMMY]);
    await montar();

    await escribir(exigir('usuario-nombre'), 'Ana');
    await escribir(exigir('usuario-rol'), 'venta');
    await escribir(exigir('usuario-pin'), '1357');
    await clic(exigir('usuario-guardar'));

    expect(altas).toEqual([{ nombre: 'Ana', rol: 'venta', pin: '1357' }]);
  });

  it('se puede crear un ADMINISTRATIVO, no solo alguien de venta', async () => {
    instalarApi([JIMMY]);
    await montar();

    await escribir(exigir('usuario-nombre'), 'Rosa');
    await escribir(exigir('usuario-rol'), 'administrativo');
    await escribir(exigir('usuario-pin'), '4321');
    await clic(exigir('usuario-guardar'));

    expect(altas[0]?.rol).toBe('administrativo');
  });

  it('el campo del PIN solo admite dígitos', async () => {
    instalarApi([JIMMY]);
    await montar();

    await escribir(exigir('usuario-pin'), '12ab34');
    expect((exigir('usuario-pin') as HTMLInputElement).value).toBe('1234');
  });

  it('con un PIN incompleto NO se manda nada y se avisa', async () => {
    instalarApi([JIMMY]);
    await montar();

    await escribir(exigir('usuario-nombre'), 'Ana');
    await escribir(exigir('usuario-pin'), '13');
    await clic(exigir('usuario-guardar'));

    expect(altas).toHaveLength(0);
    expect(porPrueba('usuarios-error')?.textContent).toContain('dígitos');
  });

  it('sin nombre el botón está deshabilitado', async () => {
    instalarApi([JIMMY]);
    await montar();

    expect((exigir('usuario-guardar') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ===========================================================================
describe('Editar no toca el PIN', () => {
  it('al editar DESAPARECE el campo de PIN del formulario', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();
    expect(porPrueba('usuario-pin')).not.toBeNull();

    await clic(enLaFilaDe('u-ana', 'usuario-editar'));

    // Es la diferencia que pidió el diseño: el PIN es información sensible y
    // tiene su propio flujo, no es un campo más del formulario de edición.
    expect(porPrueba('usuario-pin')).toBeNull();
  });

  it('el formulario se llena con los datos de esa persona', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();
    await clic(enLaFilaDe('u-ana', 'usuario-editar'));

    expect((exigir('usuario-nombre') as HTMLInputElement).value).toBe('Ana');
    expect((exigir('usuario-rol') as HTMLSelectElement).value).toBe('venta');
  });

  it('guarda el nombre y el rol, sin PIN en el payload', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();
    await clic(enLaFilaDe('u-ana', 'usuario-editar'));
    await escribir(exigir('usuario-nombre'), 'Ana María');
    await clic(exigir('usuario-guardar'));

    expect(ediciones).toEqual([{ id: 'u-ana', nombre: 'Ana María', rol: 'venta' }]);
    expect(JSON.stringify(ediciones)).not.toContain('pin');
  });
});

// ===========================================================================
describe('Cambiar el PIN es su propio diálogo', () => {
  it('el botón abre un diálogo aparte', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();
    expect(porPrueba('dialogo-de-pin')).toBeNull();

    await clic(enLaFilaDe('u-ana', 'usuario-cambiar-pin'));
    expect(porPrueba('dialogo-de-pin')).not.toBeNull();
  });

  it('manda el PIN tecleado, para esa persona', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();
    await clic(enLaFilaDe('u-ana', 'usuario-cambiar-pin'));

    for (const digito of '8080') {
      await clic(exigir(`tecla-${digito}`));
    }
    await clic(exigir('tecla-confirmar'));

    expect(cambiosDePin).toEqual([{ id: 'u-ana', pin: '8080' }]);
  });

  it('cancelar no manda nada', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();
    await clic(enLaFilaDe('u-ana', 'usuario-cambiar-pin'));
    await clic(exigir('cancelar-cambio-de-pin'));

    expect(porPrueba('dialogo-de-pin')).toBeNull();
    expect(cambiosDePin).toHaveLength(0);
  });
});

// ===========================================================================
describe('Dar de baja: lo que la pantalla NO ofrece', () => {
  it('no se puede dar de baja a uno mismo', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();

    expect(enLaFilaDe('u-jimmy', 'usuario-cambiar-estado').disabled).toBe(true);
  });

  it('no se puede dar de baja al único administrador, y se explica por qué', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();

    const boton = enLaFilaDe('u-jimmy', 'usuario-cambiar-estado');
    expect(boton.disabled).toBe(true);
    expect(boton.title).toContain('único administrador');
  });

  it('a los demás sí, y manda el cambio', async () => {
    instalarApi([JIMMY, ANA]);
    await montar();

    await clic(enLaFilaDe('u-ana', 'usuario-cambiar-estado'));
    expect(estados).toEqual([{ id: 'u-ana', activo: false }]);
  });

  it('reactivar a quien está de baja sí se ofrece, aunque sea uno mismo', async () => {
    // Reactivar nunca deja al sistema sin administradores, así que no hay nada
    // que impedir.
    instalarApi([JIMMY, ROSA]);
    await montar();

    expect(enLaFilaDe('u-rosa', 'usuario-cambiar-estado').disabled).toBe(false);
    await clic(enLaFilaDe('u-rosa', 'usuario-cambiar-estado'));
    expect(estados).toEqual([{ id: 'u-rosa', activo: true }]);
  });
});
