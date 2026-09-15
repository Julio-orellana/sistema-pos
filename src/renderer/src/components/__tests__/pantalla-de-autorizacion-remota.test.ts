/**
 * @vitest-environment jsdom
 *
 * La pantalla de inscripción en la autorización remota.
 *
 * La lógica que decide (generar, verificar, guardar) vive en el proceso
 * principal y tiene sus pruebas allá. Acá se comprueba lo que solo la pantalla
 * puede hacer mal: dibujar el QR con rectángulos y sin HTML crudo, pedir
 * exactamente seis dígitos, no guardar nada por su cuenta, esconder el secreto
 * al terminar y ofrecer empezar de nuevo cuando el código no coincide.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { InscripcionRemotaIpc } from '@shared/types/ipc';
import { PantallaDeAutorizacionRemota } from '../PantallaDeAutorizacionRemota';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SECRETO = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
/** Una matriz chica y reconocible: tres módulos oscuros en diagonal. */
const QR: boolean[][] = [
  [true, false, false],
  [false, true, false],
  [false, false, true],
];

let contenedor: HTMLDivElement;
let raiz: Root;
let inicios: number;
let codigosConfirmados: string[];
let cancelaciones: number;
let respuestaDeConfirmar: unknown;

function instalarApi(reemplaza = false): void {
  inicios = 0;
  codigosConfirmados = [];
  cancelaciones = 0;
  respuestaDeConfirmar = { ok: true, datos: true };
  (window as unknown as { pos: unknown }).pos = {
    sesion: {
      iniciarAutorizacionRemota: async (): Promise<unknown> => {
        inicios += 1;
        const datos: InscripcionRemotaIpc = {
          secreto: `${SECRETO.slice(0, -1)}${String(inicios)}`.replace(/[01]/g, 'A'),
          qr: QR,
          reemplazaUnaAnterior: reemplaza,
          venceEn: '2026-09-15T12:10:00.000Z',
        };
        return Promise.resolve({ ok: true, datos });
      },
      confirmarAutorizacionRemota: async (codigo: string): Promise<unknown> => {
        codigosConfirmados.push(codigo);
        return Promise.resolve(respuestaDeConfirmar);
      },
      cancelarAutorizacionRemota: async (): Promise<unknown> => {
        cancelaciones += 1;
        return Promise.resolve({ ok: true, datos: true });
      },
    },
  };
}

async function esperar(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function montar(): Promise<void> {
  await act(async () => {
    raiz.render(createElement(PantallaDeAutorizacionRemota, { alVolver: () => undefined }));
    await Promise.resolve();
  });
  await esperar();
}

function porPrueba(nombre: string): HTMLElement | null {
  return contenedor.querySelector<HTMLElement>(`[data-prueba="${nombre}"]`);
}

async function teclear(digitos: string): Promise<void> {
  for (const digito of digitos) {
    await act(async () => {
      porPrueba(`tecla-${digito}`)?.click();
      await Promise.resolve();
    });
  }
}

async function confirmar(): Promise<void> {
  await act(async () => {
    porPrueba('tecla-confirmar')?.click();
    await Promise.resolve();
  });
  await esperar();
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

describe('La inscripción remota, en pantalla', () => {
  it('al abrir pide UNA inscripción y dibuja el QR como SVG, un rectángulo por módulo oscuro', async () => {
    instalarApi();
    await montar();

    expect(inicios).toBe(1);
    const svg = porPrueba('qr-de-inscripcion');
    expect(svg?.tagName.toLowerCase()).toBe('svg');
    // El fondo blanco más los tres módulos oscuros.
    expect(svg?.querySelectorAll('rect')).toHaveLength(1 + 3);
    expect(contenedor.querySelector('img, iframe, object')).toBeNull();
  });

  it('muestra el secreto en grupos de cuatro, para copiarlo a mano', async () => {
    instalarApi();
    await montar();
    const texto = porPrueba('secreto-de-inscripcion')?.textContent ?? '';
    expect(texto.split(' ').every((grupo) => grupo.length === 4)).toBe(true);
    expect(texto.replace(/ /g, '')).toHaveLength(32);
  });

  it('pide SEIS dígitos: con cuatro no confirma', async () => {
    instalarApi();
    await montar();
    await teclear('1234');
    expect((porPrueba('tecla-confirmar') as HTMLButtonElement).disabled).toBe(true);
    await teclear('56');
    await confirmar();
    expect(codigosConfirmados).toEqual(['123456']);
  });

  it('al guardarse, el QR y el secreto DESAPARECEN de la pantalla', async () => {
    instalarApi();
    await montar();
    await teclear('123456');
    await confirmar();

    expect(porPrueba('autorizacion-remota-guardada')).not.toBeNull();
    expect(porPrueba('qr-de-inscripcion')).toBeNull();
    expect(porPrueba('secreto-de-inscripcion')).toBeNull();
    expect(contenedor.textContent).not.toContain('JBSW');
  });

  it('con un código que NO coincide, esconde el QR, muestra el mensaje y ofrece EMPEZAR DE NUEVO con otro secreto', async () => {
    instalarApi();
    await montar();
    const primero = porPrueba('secreto-de-inscripcion')?.textContent;
    respuestaDeConfirmar = {
      ok: false,
      error: { codigo: 'CODIGO_DE_INSCRIPCION_INCORRECTO', mensaje: 'El código no coincide, así que no se guardó nada.' },
    };
    await teclear('000000');
    await confirmar();

    expect(porPrueba('mensaje-autorizacion-remota')?.textContent).toContain('no se guardó nada');
    expect(porPrueba('qr-de-inscripcion')).toBeNull();
    expect(porPrueba('secreto-de-inscripcion')).toBeNull();

    await act(async () => {
      porPrueba('empezar-de-nuevo')?.click();
      await Promise.resolve();
    });
    await esperar();
    expect(inicios).toBe(2);
    expect(porPrueba('secreto-de-inscripcion')?.textContent).not.toBe(primero);
  });

  it('si ya había una, avisa que la anterior deja de servir', async () => {
    instalarApi(true);
    await montar();
    expect(porPrueba('reemplaza-inscripcion-anterior')).not.toBeNull();
  });

  it('salir de la pantalla CANCELA la inscripción en el proceso principal', async () => {
    instalarApi();
    await montar();
    act(() => {
      raiz.unmount();
    });
    expect(cancelaciones).toBe(1);
    raiz = createRoot(contenedor);
  });
});
