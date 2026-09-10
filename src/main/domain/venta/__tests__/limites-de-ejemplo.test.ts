/**
 * Pruebas del guion que siembra el tope de descuento.
 *
 * Lo que importa verificar es que se pueda poner y quitar tantas veces como
 * haga falta, que ponerlo dos veces no duplique nada, y sobre todo que quitarlo
 * devuelva el rol a su estado seguro: sin fila, o sea tope CERO. Un guion de
 * desarrollo que dejara un permiso puesto sin que nadie lo note sería peor que
 * no tenerlo.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { montoACadena } from '@shared/money';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeVenta } from '../servicio-de-venta';
import {
  MONTO_FIJO_POR_DEFECTO,
  PORCENTAJE_POR_DEFECTO,
  ROL_SEMBRADO,
  limpiarLimiteDeDescuento,
  sembrarLimiteDeDescuento,
  topesActuales,
} from '../limites-de-ejemplo';

let base: Database;
let repos: Repositorios;
let limpiar: () => void;

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
describe('El tope se puede poner y quitar cuantas veces haga falta', () => {
  it('la base arranca SIN ningún tope: ese es el estado de fábrica', () => {
    expect(topesActuales(repos)).toHaveLength(0);
  });

  it('sembrar deja el tope del rol de venta con los valores documentados', () => {
    const informe = sembrarLimiteDeDescuento(repos);

    expect(informe.reemplazo).toBe(false);
    expect(informe.limite.rol).toBe(ROL_SEMBRADO);
    expect(montoACadena(informe.limite.descuentoMaxPorcentaje)).toBe(PORCENTAJE_POR_DEFECTO);
    expect(montoACadena(informe.limite.descuentoMaxMontoFijo)).toBe(MONTO_FIJO_POR_DEFECTO);
  });

  it('sembrar dos veces NO duplica la fila: la reemplaza', () => {
    sembrarLimiteDeDescuento(repos);
    const segunda = sembrarLimiteDeDescuento(repos);

    expect(segunda.reemplazo).toBe(true);
    expect(topesActuales(repos)).toHaveLength(1);
  });

  it('limpiar devuelve el rol a SIN FILA, que es tope cero', () => {
    sembrarLimiteDeDescuento(repos);
    const informe = limpiarLimiteDeDescuento(repos);

    expect(informe.borro).toBe(true);
    expect(topesActuales(repos)).toHaveLength(0);
    expect(repos.limitesDescuento.obtenerPorRol(ROL_SEMBRADO)).toBeNull();
  });

  it('limpiar cuando no hay nada que limpiar lo dice, no falla', () => {
    expect(limpiarLimiteDeDescuento(repos).borro).toBe(false);
  });

  it('NO toca el rol administrativo: cuánto puede descontar es una definición de negocio', () => {
    sembrarLimiteDeDescuento(repos);

    // Sin fila, su tope es cero. Ponerle un número acá se lo atribuiría a
    // Jimmy, que no lo confirmó.
    expect(repos.limitesDescuento.obtenerPorRol('administrativo')).toBeNull();
  });

  it('no anota a ningún administrador como autor del cambio', () => {
    // Lo puso un guion de desarrollo. Anotar el id de una persona diría en la
    // base que ella tomó esta decisión.
    expect(sembrarLimiteDeDescuento(repos).limite.editadoPor).toBeNull();
  });
});

// ===========================================================================
/**
 * Lo que el guion existe para desbloquear: probar un descuento SIN PIN.
 *
 * Es la comprobación que le da sentido a todo lo demás. Si sembrar el tope no
 * cambiara el comportamiento de una venta real, el guion no serviría de nada.
 */
describe('Con el tope sembrado, un descuento dentro del límite deja de pedir PIN', () => {
  /** Registra una venta de Q100 con el descuento indicado, como rol de venta. */
  function venderConDescuento(porcentaje: string): string {
    const caja = new ServicioDeCaja({
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

    const idCajera = repos.usuarios.crear({
      nombre: 'Ana',
      rol: 'venta',
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
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });

    return venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: { tipo: 'porcentaje', valor: porcentaje },
      formaPago: 'efectivo',
      numBoleta: null,
    }).total;
  }

  it('SIN sembrar, hasta un descuento de 1 % se bloquea', () => {
    expect(() => venderConDescuento('1')).toThrow(/pasa el límite de tu rol/);
  });

  it('CON el tope sembrado, un 10 % pasa sin autorización', () => {
    sembrarLimiteDeDescuento(repos);
    expect(venderConDescuento('10')).toBe('90.00');
  });

  it('CON el tope sembrado, un 25 % sigue pidiendo autorización', () => {
    // El guion desbloquea el camino normal; no desarma el control.
    sembrarLimiteDeDescuento(repos);
    expect(() => venderConDescuento('25')).toThrow(/pasa el límite de tu rol/);
  });
});
