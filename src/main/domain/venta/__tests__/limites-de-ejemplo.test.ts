/**
 * Pruebas del guion que siembra los topes de descuento.
 *
 * Lo que importa verificar es que se puedan poner y quitar tantas veces como
 * haga falta, que ponerlos dos veces no duplique nada, y sobre todo que
 * quitarlos devuelva cada rol a su estado seguro: sin fila, o sea tope CERO. Un
 * guion de desarrollo que dejara un permiso puesto sin que nadie lo note sería
 * peor que no tenerlo.
 *
 * Y se verifica el efecto que le da sentido a todo: que con los topes puestos
 * un descuento normal deje de pedir PIN, sin que eso desarme el control para
 * los descuentos grandes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { montoACadena } from '@shared/money';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import type { Rol } from '@main/database/repositories/entidades';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeVenta } from '../servicio-de-venta';
import {
  TOPES_SEMBRADOS,
  limpiarLimitesDeDescuento,
  sembrarLimitesDeDescuento,
  topesActuales,
} from '../limites-de-ejemplo';

let base: Database;
let repos: Repositorios;
let limpiar: () => void;

/** El tope de un rol tal como quedó en la base, o `null` si no tiene fila. */
function topeDe(rol: Rol): { porcentaje: string; montoFijo: string } | null {
  const limite = repos.limitesDescuento.obtenerPorRol(rol);
  if (limite === null) {
    return null;
  }
  return {
    porcentaje: montoACadena(limite.descuentoMaxPorcentaje),
    montoFijo: montoACadena(limite.descuentoMaxMontoFijo),
  };
}

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
});

afterEach(() => {
  limpiar();
});

// ===========================================================================
describe('Los topes se pueden poner y quitar cuantas veces haga falta', () => {
  it('la base arranca SIN ningún tope: ese es el estado de fábrica', () => {
    expect(topesActuales(repos)).toHaveLength(0);
  });

  it('sembrar deja los DOS roles con sus topes', () => {
    const informe = sembrarLimitesDeDescuento(repos);

    expect(informe.aplicados.map((aplicado) => aplicado.rol)).toEqual([
      'venta',
      'administrativo',
    ]);
    expect(informe.aplicados.every((aplicado) => !aplicado.reemplazo)).toBe(true);
    expect(topesActuales(repos)).toHaveLength(2);
  });

  it('el rol de VENTA queda en 10 % o Q20', () => {
    sembrarLimitesDeDescuento(repos);
    expect(topeDe('venta')).toEqual({ porcentaje: '10.00', montoFijo: '20.00' });
  });

  it('el rol ADMINISTRATIVO queda en 100 % o Q1000', () => {
    sembrarLimitesDeDescuento(repos);
    expect(topeDe('administrativo')).toEqual({
      porcentaje: '100.00',
      montoFijo: '1000.00',
    });
  });

  it('sembrar dos veces NO duplica filas: las reemplaza', () => {
    sembrarLimitesDeDescuento(repos);
    const segunda = sembrarLimitesDeDescuento(repos);

    expect(segunda.aplicados.every((aplicado) => aplicado.reemplazo)).toBe(true);
    expect(topesActuales(repos)).toHaveLength(2);
  });

  it('limpiar devuelve los dos roles a SIN FILA, que es tope cero', () => {
    sembrarLimitesDeDescuento(repos);
    const informe = limpiarLimitesDeDescuento(repos);

    expect(informe.borrados).toEqual(['venta', 'administrativo']);
    expect(topesActuales(repos)).toHaveLength(0);
    expect(topeDe('venta')).toBeNull();
    expect(topeDe('administrativo')).toBeNull();
  });

  it('limpiar cuando no hay nada que limpiar lo dice, no falla', () => {
    expect(limpiarLimitesDeDescuento(repos).borrados).toEqual([]);
  });

  it('no anota a ningún administrador como autor del cambio', () => {
    // Los puso un guion de desarrollo. Anotar el id de una persona diría en la
    // base que ella tomó esta decisión.
    const informe = sembrarLimitesDeDescuento(repos);
    expect(informe.aplicados.every((aplicado) => aplicado.limite.editadoPor === null)).toBe(
      true,
    );
  });

  it('el administrativo tiene un tope MÁS ALTO que el de venta, no una excepción', () => {
    // La diferencia entre los dos roles es un NÚMERO en una tabla, no una rama
    // en el código: no hay ningún «salvo que sea administrador».
    sembrarLimitesDeDescuento(repos);
    const venta = topeDe('venta');
    const administrativo = topeDe('administrativo');

    expect(Number(administrativo?.porcentaje)).toBeGreaterThan(Number(venta?.porcentaje));
    expect(Number(administrativo?.montoFijo)).toBeGreaterThan(Number(venta?.montoFijo));
  });

  it('el tope del administrativo llega al 100 %, que es la venta entera', () => {
    // 100 % es un techo honesto y no un número mágico: el total ya tiene piso
    // en cero, así que descontar el 100 % es regalar la venta y nada más.
    const administrativo = TOPES_SEMBRADOS.find((tope) => tope.rol === 'administrativo');
    expect(administrativo?.porcentaje).toBe('100.00');
  });
});

// ===========================================================================
/**
 * Lo que el guion existe para desbloquear: probar un descuento SIN PIN.
 *
 * Es la comprobación que le da sentido a todo lo demás. Si sembrar los topes no
 * cambiara el comportamiento de una venta real, el guion no serviría de nada.
 */
describe('Con los topes sembrados, un descuento dentro del límite deja de pedir PIN', () => {
  /** Registra una venta de Q100 con el descuento y el rol indicados. */
  function venderConDescuento(rol: Rol, porcentaje: string): string {
    const caja = new ServicioDeCaja({
      base,
      cajaSesiones: repos.cajaSesiones,
      denominaciones: repos.denominaciones,
      desglose: repos.desgloseDeCaja,
      ventas: repos.ventas,
      auditoria: repos.auditoria,
    });
    const venta = new ServicioDeVenta({
      base,
      ventas: repos.ventas,
      ventaDetalle: repos.ventaDetalle,
      productos: repos.productos,
      preciosEspeciales: repos.preciosEspeciales,
      limitesDescuento: repos.limitesDescuento,
      cajaSesiones: repos.cajaSesiones,
      auditoria: repos.auditoria,
    });

    const idQuienVende = repos.usuarios.crear({
      nombre: rol === 'venta' ? 'Ana' : 'Jimmy',
      rol,
      pinHash: generarHashDePin('1357'),
    }).id;
    const categoriaId = repos.categorias.crear({ nombre: 'Granos', orden: 1 }).id;
    const maiz = repos.productos.crear({
      nombre: 'Maíz',
      categoriaId,
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '1',
      precioBase: '10.00',
      inventarioDisponible: '100',
    }).id;
    caja.abrir(idQuienVende, { modo: 'simple', monto: '500' });

    return venta.registrar(idQuienVende, rol, {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: { tipo: 'porcentaje', valor: porcentaje },
      formaPago: 'efectivo',
      numBoleta: null,
    }).total;
  }

  it('SIN sembrar, hasta un descuento de 1 % se bloquea, y para los dos roles', () => {
    expect(() => venderConDescuento('venta', '1')).toThrow(/pasa el límite de tu rol/);
  });

  it('SIN sembrar, un administrador también tiene que autorizarse a sí mismo', () => {
    expect(() => venderConDescuento('administrativo', '1')).toThrow(
      /pasa el límite de tu rol/,
    );
  });

  it('CON los topes, el rol de venta pasa un 10 % sin autorización', () => {
    sembrarLimitesDeDescuento(repos);
    expect(venderConDescuento('venta', '10')).toBe('90.00');
  });

  it('CON los topes, el rol de venta sigue bloqueado en un 25 %', () => {
    // El guion desbloquea el camino normal; no desarma el control.
    sembrarLimitesDeDescuento(repos);
    expect(() => venderConDescuento('venta', '25')).toThrow(/pasa el límite de tu rol/);
  });

  it('CON los topes, un administrador pasa un 25 % sin autorizarse a sí mismo', () => {
    sembrarLimitesDeDescuento(repos);
    expect(venderConDescuento('administrativo', '25')).toBe('75.00');
  });

  it('CON los topes, un administrador llega hasta el 100 %: regala la venta', () => {
    // Es el efecto buscado: por la vía del porcentaje nunca necesita PIN.
    sembrarLimitesDeDescuento(repos);
    expect(venderConDescuento('administrativo', '100')).toBe('0.00');
  });

  it('el mecanismo sigue existiendo para el administrativo: 101 % se bloquea', () => {
    // No es una excepción por rol, es un número más alto. La comprobación se
    // hace igual para los dos, y por eso todavía hay algo que exceder.
    sembrarLimitesDeDescuento(repos);
    expect(() => venderConDescuento('administrativo', '101')).toThrow(
      /pasa el límite de tu rol/,
    );
  });
});
