/**
 * El guard de rol sobre la gestión de usuarios.
 *
 * POR QUÉ TIENE SU PROPIA PRUEBA. La pantalla de usuarios solo aparece con rol
 * administrativo, pero eso es comodidad, no control: el botón escondido no
 * impide nada, porque un renderer comprometido invoca el canal igual. Quien de
 * verdad rechaza es `requiereRol` en el proceso principal, y esto comprueba las
 * dos mitades de esa afirmación: que el guard rechaza, y que está puesto en
 * TODOS los canales de este módulo.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ErrorDeNegocio } from '@main/database/errores';
import { SesionActual, requiereRol } from '@main/domain/usuarios/sesion';
import type { Usuario } from '@main/database/repositories/entidades';

/** Un usuario mínimo con el rol indicado, para iniciar sesión de mentira. */
function usuarioCon(rol: Usuario['rol']): Usuario {
  return {
    id: `u-${rol}`,
    nombre: rol === 'venta' ? 'Ana' : 'Jimmy',
    rol,
    pinHash: 'scrypt$1$16384$8$1$c2Fs$Y2xhdmU=',
    pinRemotoHash: null,
    activo: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    creadoEn: '2026-09-11T12:00:00.000Z',
    actualizadoEn: '2026-09-11T12:00:00.000Z',
  };
}

// ===========================================================================
describe('Un usuario de rol VENTA no puede gestionar usuarios', () => {
  it('el guard lo rechaza con PERMISO_DENEGADO', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuarioCon('venta'));

    try {
      requiereRol(sesion, 'administrativo', () => 'no debería llegar acá');
      throw new Error('Se esperaba que el guard rechazara.');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      expect((error as ErrorDeNegocio).codigo).toBe('PERMISO_DENEGADO');
    }
  });

  it('y la operación protegida NO llega a ejecutarse', () => {
    // Es la mitad que importa: no alcanza con que devuelva un error, tiene que
    // no haber tocado nada. Si el guard corriera la operación y después
    // fallara, un usuario de venta ya habría creado el usuario.
    const sesion = new SesionActual();
    sesion.iniciar(usuarioCon('venta'));
    let veces = 0;

    expect(() =>
      requiereRol(sesion, 'administrativo', () => {
        veces += 1;
        return veces;
      }),
    ).toThrow(ErrorDeNegocio);

    expect(veces).toBe(0);
  });

  it('SIN ninguna sesión tampoco pasa', () => {
    const sesion = new SesionActual();
    expect(() => requiereRol(sesion, 'administrativo', () => 'nada')).toThrow(ErrorDeNegocio);
  });

  it('con rol ADMINISTRATIVO sí pasa, y la operación se ejecuta', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuarioCon('administrativo'));

    expect(requiereRol(sesion, 'administrativo', () => 'listo')).toBe('listo');
  });
});

// ===========================================================================
/**
 * El guard puesto en TODOS los canales, no solo en el primero.
 *
 * Se lee el archivo y se cuenta, porque el riesgo real no es que el guard esté
 * mal escrito: es que alguien agregue un sexto canal el año que viene y se
 * olvide de envolverlo. Vitest no puede registrar manejadores de `ipcMain` —no
 * hay Electron dentro de las pruebas—, así que esta es la forma de verificarlo
 * sin abrir la aplicación.
 */
describe('Ningún canal de gestión de usuarios queda sin guard', () => {
  const fuente = readFileSync(
    join(__dirname, '..', 'usuarios.ts'),
    'utf8',
  );

  it('hay tantos guards como canales registrados', () => {
    const canales = fuente.match(/ipcMain\.handle\(/g) ?? [];
    const guards = fuente.match(/requiereRol\(sesion, 'administrativo'/g) ?? [];

    expect(canales.length).toBeGreaterThan(0);
    expect(guards.length).toBe(canales.length);
  });

  it('son los cinco canales del módulo', () => {
    // Si este número cambia sin que cambie el de arriba, alguien agregó un
    // canal sin guard o quitó uno sin querer.
    expect((fuente.match(/ipcMain\.handle\(/g) ?? []).length).toBe(5);
  });

  it('ningún canal exige solo sesión en vez de rol', () => {
    // `requiereSesion` deja pasar a cualquiera con la sesión iniciada, incluido
    // un rol de venta. En este módulo no debe aparecer.
    expect(fuente).not.toContain('requiereSesion');
  });

  it('el hash del PIN no se copia al DTO que va a la ventana', () => {
    expect(fuente).not.toContain('pinHash:');
    expect(fuente).not.toContain('pinRemotoHash:');
  });
});
