/**
 * Pruebas de la sesión en memoria y del guard de permisos por rol.
 *
 * El guard es lo que van a usar todos los módulos futuros para proteger sus
 * acciones, así que un fallo aquí se propaga a caja, ventas y descuentos.
 */

import { describe, expect, it, vi } from 'vitest';

import { ErrorDeNegocio } from '@main/database/errores';
import type { Usuario } from '@main/database/repositories/entidades';
import { SesionActual, requiereRol, requiereSesion } from '../sesion';

/** Usuario mínimo para las pruebas. */
function usuario(rol: 'venta' | 'administrativo', nombre = 'Alguien'): Usuario {
  return {
    id: `11111111-1111-4111-8111-11111111111${rol === 'venta' ? '1' : '2'}`,
    nombre,
    rol,
    pinHash: 'hash',
    totpSecretoCifrado: null,
    totpUltimoPaso: null,
    activo: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    creadoEn: '2026-09-06T12:00:00.000Z',
    actualizadoEn: '2026-09-06T12:00:00.000Z',
  };
}

// ===========================================================================
describe('Sesión en memoria', () => {
  it('arranca sin nadie autenticado', () => {
    const sesion = new SesionActual();
    expect(sesion.obtener()).toBeNull();
    expect(sesion.haySesion()).toBe(false);
  });

  it('guarda quién ingresó y desde cuándo', () => {
    const sesion = new SesionActual(() => Date.UTC(2026, 8, 6, 12, 0, 0));
    const abierta = sesion.iniciar(usuario('administrativo', 'Jimmy'));

    expect(abierta.nombre).toBe('Jimmy');
    expect(abierta.rol).toBe('administrativo');
    expect(abierta.desde).toBe('2026-09-06T12:00:00.000Z');
    expect(sesion.obtener()?.id).toBe(abierta.id);
  });

  it('NO guarda el hash del PIN en la sesión', () => {
    const sesion = new SesionActual();
    const abierta = sesion.iniciar(usuario('venta'));
    expect(JSON.stringify(abierta)).not.toContain('hash');
  });

  it('cerrar deja la sesión vacía', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuario('venta'));
    sesion.cerrar();
    expect(sesion.haySesion()).toBe(false);
  });

  it('iniciar de nuevo reemplaza al usuario anterior', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuario('venta', 'Cajera'));
    sesion.iniciar(usuario('administrativo', 'Jimmy'));
    expect(sesion.obtener()?.nombre).toBe('Jimmy');
  });
});

// ===========================================================================
describe('Guard de permisos por rol', () => {
  it('deja pasar la acción cuando el rol coincide', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuario('administrativo'));
    const operacion = vi.fn((): string => 'hecho');

    expect(requiereRol(sesion, 'administrativo', operacion)).toBe('hecho');
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it('RECHAZA y NO ejecuta la operación cuando el rol no alcanza', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuario('venta'));
    const operacion = vi.fn((): string => 'no debería ejecutarse');

    expect(() => requiereRol(sesion, 'administrativo', operacion)).toThrow(ErrorDeNegocio);
    // Lo importante: la acción no se ejecutó. No falla en silencio ni pasa.
    expect(operacion).not.toHaveBeenCalled();
  });

  it('el rechazo lleva el código PERMISO_DENEGADO y un mensaje legible', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuario('venta'));

    try {
      requiereRol(sesion, 'administrativo', () => 'no debería');
      expect.unreachable('Se esperaba que el guard rechazara.');
    } catch (error) {
      const negocio = error as ErrorDeNegocio;
      expect(negocio.codigo).toBe('PERMISO_DENEGADO');
      expect(negocio.mensajeParaElUsuario).toContain('administrativo');
      expect(negocio.mensajeParaElUsuario).toContain('venta');
    }
  });

  it('RECHAZA cuando no hay ninguna sesión iniciada', () => {
    const sesion = new SesionActual();
    const operacion = vi.fn((): string => 'no debería ejecutarse');

    expect(() => requiereRol(sesion, 'venta', operacion)).toThrow(/No hay ninguna sesión/);
    expect(operacion).not.toHaveBeenCalled();
  });

  it('cerrar la sesión vuelve a cerrar la puerta', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuario('administrativo'));
    expect(requiereRol(sesion, 'administrativo', () => 'hecho')).toBe('hecho');

    sesion.cerrar();
    expect(() => requiereRol(sesion, 'administrativo', () => 'hecho')).toThrow(ErrorDeNegocio);
  });

  it('requiereSesion deja pasar a cualquier rol, pero no a un anónimo', () => {
    const sesion = new SesionActual();
    expect(() => requiereSesion(sesion, () => 'hecho')).toThrow(ErrorDeNegocio);

    sesion.iniciar(usuario('venta'));
    expect(requiereSesion(sesion, () => 'hecho')).toBe('hecho');
  });

  it('el guard devuelve el valor de la operación sin tocarlo', () => {
    const sesion = new SesionActual();
    sesion.iniciar(usuario('administrativo'));
    expect(requiereRol(sesion, 'administrativo', () => ({ total: '16.80' }))).toEqual({
      total: '16.80',
    });
  });
});
