/**
 * @vitest-environment jsdom
 *
 * La pantalla de la impresora, sin proceso principal (§4.43).
 *
 * Lo que se verifica es lo que ve la persona: el estado dicho con palabras,
 * que probar sin elegir impresora falla con un mensaje (no en silencio), que
 * las tres preguntas aparecen SOLO cuando Windows aceptó el ticket, y que un
 * error de conexión no las muestra.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  EstadoDeImpresoraIpc,
  ResultadoDePruebaDeImpresoraIpc,
  ResultadoDeConfirmacionIpc,
} from '@shared/types/ipc';
import { PantallaDeImpresora } from '../PantallaDeImpresora';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SIN_IMPRESORA: EstadoDeImpresoraIpc = {
  tipo: 'ninguna',
  nombre: null,
  descripcion: 'Sin impresora configurada — los recibos solo se generan en PDF',
  ultimaPrueba: null,
};

const ID = '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca';

let contenedor: HTMLDivElement;
let raiz: Root;
let pruebasPedidas: string[];
let confirmaciones: ResultadoDeConfirmacionIpc[];
let quitadas: number;

function instalarApi(resultadoDePrueba: ResultadoDePruebaDeImpresoraIpc, estado: EstadoDeImpresoraIpc = SIN_IMPRESORA): void {
  pruebasPedidas = [];
  confirmaciones = [];
  quitadas = 0;
  (window as unknown as { pos: unknown }).pos = {
    impresora: {
      estado: (): Promise<unknown> => Promise.resolve({ ok: true, datos: estado }),
      listar: (): Promise<unknown> =>
        Promise.resolve({
          ok: true,
          datos: [
            { nombre: 'POS-80', nombreVisible: 'Térmica POS-80', descripcion: '' },
            { nombre: 'EPSON', nombreVisible: 'EPSON L3560', descripcion: '' },
          ],
        }),
      guardar: (nombre: string): Promise<unknown> =>
        Promise.resolve({ ok: true, datos: { ...SIN_IMPRESORA, tipo: 'cola', nombre, descripcion: `Impresora configurada: ${nombre}` } }),
      quitar: (): Promise<unknown> => {
        quitadas += 1;
        return Promise.resolve({ ok: true, datos: SIN_IMPRESORA });
      },
      imprimirPrueba: (nombre: string): Promise<unknown> => {
        pruebasPedidas.push(nombre);
        return Promise.resolve({ ok: true, datos: resultadoDePrueba });
      },
      confirmarPrueba: (datos: { resultado: ResultadoDeConfirmacionIpc }): Promise<unknown> => {
        confirmaciones.push(datos.resultado);
        return Promise.resolve({ ok: true, datos: { estado: SIN_IMPRESORA, mensaje: `Anotado: ${datos.resultado}` } });
      },
    },
  };
}

const ENVIADO: ResultadoDePruebaDeImpresoraIpc = {
  clase: 'enviado',
  titulo: 'Ticket de prueba enviado',
  mensaje: 'Windows aceptó el ticket. Mirá la impresora.',
  detalle: 'etapa=ok',
  pruebaId: ID,
};

const NO_CONECTA: ResultadoDePruebaDeImpresoraIpc = {
  clase: 'no_se_pudo_enviar',
  titulo: 'No se pudo conectar con la impresora',
  mensaje: 'Revisá que esté encendida.',
  detalle: 'etapa=escribir; codigoWin32=1722',
  pruebaId: null,
};

async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(createElement(PantallaDeImpresora, { alVolver: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

async function tocar(elemento: HTMLElement | null): Promise<void> {
  if (elemento === null) {
    throw new Error('No está el elemento a tocar.');
  }
  await act(async () => {
    elemento.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function opcion(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="impresora-opcion"][data-nombre="${nombre}"]`);
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

describe('Lo que ve la persona al entrar', () => {
  it('el estado dicho con palabras, sin nombres de clases del código', async () => {
    instalarApi(ENVIADO);
    await montar();
    expect(porPrueba('impresora-descripcion')?.textContent).toBe('Sin impresora configurada — los recibos solo se generan en PDF');
    expect(contenedor.textContent).not.toContain('NullPrinterProvider');
    expect(contenedor.textContent).not.toContain('Adaptador');
  });

  it('lista las impresoras del sistema con su nombre visible', async () => {
    instalarApi(ENVIADO);
    await montar();
    expect(opcion('POS-80')?.textContent).toBe('Térmica POS-80');
    expect(opcion('EPSON')).not.toBeNull();
  });

  it('sin impresora configurada no ofrece «Quitar»', async () => {
    instalarApi(ENVIADO);
    await montar();
    expect(porPrueba('impresora-quitar')).toBeNull();
  });
});

describe('El botón de prueba', () => {
  it('SIN ninguna impresora elegida falla con un mensaje claro, y no le pide nada al proceso principal', async () => {
    instalarApi(ENVIADO);
    await montar();
    await tocar(porPrueba('impresora-probar'));
    expect(porPrueba('impresora-error')?.textContent).toContain('Primero elegí una impresora de la lista');
    expect(pruebasPedidas).toEqual([]);
    expect(porPrueba('impresora-confirmacion')).toBeNull();
  });

  it('con una elegida y el ticket aceptado, pregunta cómo salió con las TRES respuestas', async () => {
    instalarApi(ENVIADO);
    await montar();
    await tocar(opcion('POS-80'));
    await tocar(porPrueba('impresora-probar'));
    expect(pruebasPedidas).toEqual(['POS-80']);
    expect(porPrueba('impresora-confirmar-bien')?.textContent).toBe('Sí, salió bien');
    expect(porPrueba('impresora-confirmar-ilegible')?.textContent).toBe('Salió con símbolos raros o sin cortar');
    expect(porPrueba('impresora-confirmar-nada')?.textContent).toBe('No salió nada');
  });

  it('contestar manda la respuesta y muestra lo que devolvió el proceso principal', async () => {
    instalarApi(ENVIADO);
    await montar();
    await tocar(opcion('POS-80'));
    await tocar(porPrueba('impresora-probar'));
    await tocar(porPrueba('impresora-confirmar-ilegible'));
    expect(confirmaciones).toEqual(['ilegible']);
    expect(porPrueba('impresora-aviso')?.textContent).toBe('Anotado: ilegible');
    expect(porPrueba('impresora-confirmacion')).toBeNull();
  });

  it('un fallo de conexión se muestra con su título y su detalle, y NO pregunta cómo salió', async () => {
    instalarApi(NO_CONECTA);
    await montar();
    await tocar(opcion('EPSON'));
    await tocar(porPrueba('impresora-probar'));
    expect(porPrueba('impresora-resultado')?.getAttribute('data-clase')).toBe('no_se_pudo_enviar');
    expect(porPrueba('impresora-resultado-titulo')?.textContent).toBe('No se pudo conectar con la impresora');
    expect(porPrueba('impresora-resultado-detalle')?.textContent).toContain('1722');
    expect(porPrueba('impresora-confirmacion')).toBeNull();
  });
});

describe('Con una impresora configurada', () => {
  const CONFIGURADA: EstadoDeImpresoraIpc = {
    tipo: 'cola',
    nombre: 'POS-80',
    descripcion: 'Impresora configurada: POS-80',
    ultimaPrueba: { impresora: 'POS-80', fecha: '2026-09-15T12:00:00.000Z', envio: 'enviado', confirmacion: 'ilegible' },
  };

  it('la marca en la lista y el botón de guardar dice que ya es la configurada', async () => {
    instalarApi(ENVIADO, CONFIGURADA);
    await montar();
    expect(opcion('POS-80')?.getAttribute('aria-checked')).toBe('true');
    expect(porPrueba('impresora-guardar')?.textContent).toBe('Es la impresora configurada');
  });

  it('dice cómo salió la última prueba, con la respuesta de la persona', async () => {
    instalarApi(ENVIADO, CONFIGURADA);
    await montar();
    expect(porPrueba('impresora-ultima-prueba')?.textContent).toContain('símbolos raros o sin cortar');
  });

  it('«Quitar la impresora» vuelve al texto de solo PDF', async () => {
    instalarApi(ENVIADO, CONFIGURADA);
    await montar();
    await tocar(porPrueba('impresora-quitar'));
    expect(quitadas).toBe(1);
    expect(porPrueba('impresora-descripcion')?.textContent).toBe('Sin impresora configurada — los recibos solo se generan en PDF');
    expect(porPrueba('impresora-aviso')?.textContent).toContain('PDF');
  });
});
