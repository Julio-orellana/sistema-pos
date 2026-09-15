/**
 * Los tres canales de la autorización remota por TOTP, leídos del código.
 *
 * Lo que no puede faltar: rol administrativo en los tres, el usuario tomado de
 * la SESIÓN y nunca del payload (solo sobre la propia cuenta), y el código
 * validado en la frontera.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CANALES_IPC, esquemaCierreDeCaja, esquemaCodigoDeInscripcion } from '@shared/types/ipc';

const fuente = readFileSync(join(__dirname, '..', 'register-handlers.ts'), 'utf8');

/** El bloque de un `ipcMain.handle` de ese canal, hasta el siguiente. */
function bloqueDe(canal: string): string {
  const inicio = fuente.indexOf(`CANALES_IPC.${canal},`);
  expect(inicio, `no se encontró el manejador de ${canal}`).toBeGreaterThan(-1);
  const fin = fuente.indexOf('ipcMain.handle(', inicio);
  return fuente.slice(inicio, fin === -1 ? undefined : fin);
}

describe('Los canales de la autorización remota', () => {
  const CANALES = ['iniciarAutorizacionRemota', 'confirmarAutorizacionRemota', 'cancelarAutorizacionRemota'] as const;

  it('existen los tres y el viejo `configurarPinRemoto` ya no', () => {
    expect(CANALES_IPC.iniciarAutorizacionRemota).toBe('sesion:autorizacion-remota-iniciar');
    expect(CANALES_IPC.confirmarAutorizacionRemota).toBe('sesion:autorizacion-remota-confirmar');
    expect(CANALES_IPC.cancelarAutorizacionRemota).toBe('sesion:autorizacion-remota-cancelar');
    expect(Object.keys(CANALES_IPC)).not.toContain('configurarPinRemoto');
    expect(fuente).not.toContain('configurarPinRemoto');
  });

  for (const canal of CANALES) {
    it(`${canal}: exige rol ADMINISTRATIVO y toma el usuario de la SESIÓN`, () => {
      const bloque = bloqueDe(canal);
      expect(bloque).toContain("requiereRol(dependencias.sesion, 'administrativo'");
      expect(bloque).toContain('enSesionOFallar().id');
      expect(bloque).not.toMatch(/usuarioId/);
    });
  }

  it('confirmar valida el código en la frontera', () => {
    expect(bloqueDe('confirmarAutorizacionRemota')).toContain('esquemaCodigoDeInscripcion.parse(payload)');
    expect(esquemaCodigoDeInscripcion.safeParse({ codigo: '123456' }).success).toBe(true);
    expect(esquemaCodigoDeInscripcion.safeParse({ codigo: '1234' }).success).toBe(false);
    expect(esquemaCodigoDeInscripcion.safeParse({ codigo: '1234567' }).success).toBe(false);
  });

  it('iniciar manda la matriz del QR y NO la URI: la ventana no arma nada con ella', () => {
    const bloque = bloqueDe('iniciarAutorizacionRemota');
    expect(bloque).toContain('qr: matrizDeQr(inscripcion.uri)');
    expect(bloque).not.toMatch(/uri: /);
  });

  it('el cierre de caja deja pasar un PIN de 4 o un código de 6, y nada más largo', () => {
    const conPin = (pin: string): boolean => esquemaCierreDeCaja.shape.pin.safeParse(pin).success;
    expect(conPin('1234')).toBe(true);
    expect(conPin('123456')).toBe(true);
    expect(conPin('123')).toBe(false);
    expect(conPin('1234567')).toBe(false);
  });
});
