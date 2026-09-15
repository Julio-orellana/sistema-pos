/**
 * El historial de cajas solo lo ve un rol administrativo (§4.44).
 *
 * Dos pruebas distintas, porque protegen cosas distintas. La primera LLAMA a
 * los dos canales, como la ventana, con una sesión de venta, y exige el
 * rechazo sin que el servicio llegue a ejecutarse. La segunda CUENTA los
 * canales del archivo, para que un tercero no pueda agregarse sin guard.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generarHashDePin } from '@shared/auth';
import { CANALES_IPC, type RespuestaIpc } from '@shared/types/ipc';
import type { Usuario } from '@main/database/repositories/entidades';
import { SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeHistorialDeCajas } from '@main/domain/caja/historial-de-cajas';

const electron = vi.hoisted(() => ({
  manejadores: new Map<string, (evento: unknown, payload?: unknown) => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, manejador: (evento: unknown, payload?: unknown) => Promise<unknown>): void => {
      electron.manejadores.set(canal, manejador);
    },
  },
}));

const { registrarManejadoresDeHistorialDeCajas } = await import('../historial-de-cajas');

function usuario(rol: Usuario['rol']): Usuario {
  return {
    id: rol === 'venta' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
    nombre: rol === 'venta' ? 'Ana' : 'Jimmy',
    rol,
    pinHash: generarHashDePin('1357'),
    totpSecretoCifrado: null,
    totpUltimoPaso: null,
    activo: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    creadoEn: '2026-09-15T00:00:00.000Z',
    actualizadoEn: '2026-09-15T00:00:00.000Z',
  };
}

let sesion: SesionActual;
let llamadasAlServicio: string[];

beforeEach(() => {
  electron.manejadores.clear();
  sesion = new SesionActual();
  llamadasAlServicio = [];
  const servicio = {
    listar: () => {
      llamadasAlServicio.push('listar');
      return { sesiones: [], periodo: null, personasQueAbrieron: [] };
    },
    detalle: () => {
      llamadasAlServicio.push('detalle');
      return { sesion: null, conteosSellados: [], desgloseDeApertura: null, desgloseDeCierre: null };
    },
  } as unknown as ServicioDeHistorialDeCajas;
  registrarManejadoresDeHistorialDeCajas({ sesion, historial: servicio });
});

async function llamar(canal: string, payload: unknown): Promise<RespuestaIpc<unknown>> {
  const manejador = electron.manejadores.get(canal);
  if (manejador === undefined) {
    throw new Error(`No se registró ${canal}.`);
  }
  return (await manejador({}, payload)) as RespuestaIpc<unknown>;
}

const FILTRO = { desde: null, hasta: null, abiertaPor: null };
const DETALLE = { id: '33333333-3333-4333-8333-333333333333' };

describe('Un usuario de rol VENTA no puede usar el historial de cajas', () => {
  it('la lista lo rechaza con PERMISO_DENEGADO y el servicio no se ejecuta', async () => {
    sesion.iniciar(usuario('venta'));
    const respuesta = await llamar(CANALES_IPC.cajasHistorial, FILTRO);
    expect(respuesta.ok).toBe(false);
    expect(respuesta.ok ? null : respuesta.error.codigo).toBe('PERMISO_DENEGADO');
    expect(llamadasAlServicio).toEqual([]);
  });

  it('el detalle lo rechaza igual', async () => {
    sesion.iniciar(usuario('venta'));
    const respuesta = await llamar(CANALES_IPC.cajasDetalle, DETALLE);
    expect(respuesta.ok ? null : respuesta.error.codigo).toBe('PERMISO_DENEGADO');
    expect(llamadasAlServicio).toEqual([]);
  });

  it('sin sesión tampoco', async () => {
    const respuesta = await llamar(CANALES_IPC.cajasHistorial, FILTRO);
    expect(respuesta.ok).toBe(false);
    expect(llamadasAlServicio).toEqual([]);
  });

  it('control: con rol ADMINISTRATIVO los dos canales llegan al servicio', async () => {
    sesion.iniciar(usuario('administrativo'));
    expect((await llamar(CANALES_IPC.cajasHistorial, FILTRO)).ok).toBe(true);
    expect((await llamar(CANALES_IPC.cajasDetalle, DETALLE)).ok).toBe(true);
    expect(llamadasAlServicio).toEqual(['listar', 'detalle']);
  });

  it('un filtro mal formado se rechaza antes de llegar al servicio', async () => {
    sesion.iniciar(usuario('administrativo'));
    expect((await llamar(CANALES_IPC.cajasHistorial, { desde: 5, hasta: null, abiertaPor: 'no-es-uuid' })).ok).toBe(false);
    expect((await llamar(CANALES_IPC.cajasDetalle, { id: 'no-es-uuid' })).ok).toBe(false);
    expect(llamadasAlServicio).toEqual([]);
  });
});

describe('Ningún canal del historial queda sin guard', () => {
  const FUENTE = readFileSync(join(__dirname, '..', 'historial-de-cajas.ts'), 'utf8');

  it('dos canales, dos guards de rol administrativo, y ninguno de solo sesión', () => {
    expect((FUENTE.match(/ipcMain\.handle\(/g) ?? []).length).toBe(2);
    expect((FUENTE.match(/requiereRol\(sesion, 'administrativo'/g) ?? []).length).toBe(2);
    expect(FUENTE).not.toContain('requiereSesion');
  });
});
