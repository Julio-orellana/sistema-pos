/**
 * El orden de restauración contra el grafo REAL de llaves foráneas.
 *
 * Dos fuentes, y las dos tienen que dar lo mismo: las llaves que declara el
 * esquema local (`PRAGMA foreign_key_list` sobre una base migrada) y las que
 * se leyeron del catálogo de Postgres de `pos-pruebas-descartable` el
 * 2026-09-14 (`pg_constraint`, `contype = 'f'`), copiadas acá tal cual. Si
 * una migración futura agrega una llave que el orden no respeta, esta prueba
 * lo dice con nombre.
 *
 * Las tres de `anulaciones_de_venta` (0033) se leyeron el 2026-09-17 del
 * catálogo de un Postgres 17 LOCAL con las migraciones del repositorio
 * aplicadas, no de Supabase: la 0033 todavía no está en ningún proyecto.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import {
  comprobarOrdenContraLasLlaves,
  llavesForaneasLocales,
  ORDEN_DE_RESTAURACION,
  TABLAS_QUE_SOLO_SE_INSERTAN,
  violacionesDelOrden,
  type LlaveForaneaLocal,
} from '../orden-de-restauracion';

/** Las dieciocho llaves foráneas del catálogo de Postgres: quince leídas el 2026-09-14, y las tres de la 0033. */
const LLAVES_DEL_CATALOGO_DE_POSTGRES: readonly LlaveForaneaLocal[] = [
  { tabla: 'productos', columna: 'categoria_id', referencia: 'categorias' },
  { tabla: 'precios_especiales', columna: 'producto_id', referencia: 'productos' },
  { tabla: 'limites_descuento', columna: 'editado_por', referencia: 'usuarios' },
  { tabla: 'caja_sesiones', columna: 'cerrada_por', referencia: 'usuarios' },
  { tabla: 'caja_sesiones', columna: 'diferencia_autorizada_por', referencia: 'usuarios' },
  { tabla: 'caja_sesiones', columna: 'usuario_id', referencia: 'usuarios' },
  { tabla: 'ventas', columna: 'caja_sesion_id', referencia: 'caja_sesiones' },
  { tabla: 'ventas', columna: 'descuento_autorizado_por', referencia: 'usuarios' },
  { tabla: 'ventas', columna: 'usuario_id', referencia: 'usuarios' },
  { tabla: 'venta_detalle', columna: 'producto_id', referencia: 'productos' },
  { tabla: 'venta_detalle', columna: 'venta_id', referencia: 'ventas' },
  { tabla: 'recibos', columna: 'venta_id', referencia: 'ventas' },
  { tabla: 'auditoria_log', columna: 'usuario_id', referencia: 'usuarios' },
  { tabla: 'caja_sesion_denominaciones', columna: 'caja_sesion_id', referencia: 'caja_sesiones' },
  { tabla: 'caja_sesion_denominaciones', columna: 'denominacion_id', referencia: 'denominaciones' },
  { tabla: 'anulaciones_de_venta', columna: 'venta_id', referencia: 'ventas' },
  { tabla: 'anulaciones_de_venta', columna: 'solicitada_por', referencia: 'usuarios' },
  { tabla: 'anulaciones_de_venta', columna: 'autorizada_por', referencia: 'usuarios' },
];

const clave = (llave: LlaveForaneaLocal): string => `${llave.tabla}.${llave.columna} -> ${llave.referencia}`;

let limpiar: (() => void) | null = null;
afterEach(() => {
  limpiar?.();
  limpiar = null;
});

describe('El orden respeta las llaves foráneas', () => {
  it('contra las dieciocho llaves del catálogo de Postgres: sin violaciones', () => {
    expect(violacionesDelOrden(LLAVES_DEL_CATALOGO_DE_POSTGRES)).toEqual([]);
  });

  it('contra las llaves que declara la base LOCAL migrada: sin violaciones', () => {
    const prueba = crearBaseMigrada();
    limpiar = prueba.limpiar;
    expect(comprobarOrdenContraLasLlaves(prueba.base)).toEqual([]);
  });

  it('el esquema local declara EXACTAMENTE las mismas dieciocho llaves que Postgres: el espejo es fiel', () => {
    const prueba = crearBaseMigrada();
    limpiar = prueba.limpiar;
    const locales = llavesForaneasLocales(prueba.base).map(clave).sort();
    const remotas = LLAVES_DEL_CATALOGO_DE_POSTGRES.map(clave).sort();
    expect(locales).toEqual(remotas);
  });

  it('el orden es el de §6.3 del diseño: usuarios primero, auditoria_log al final', () => {
    expect(ORDEN_DE_RESTAURACION[0]).toBe('usuarios');
    expect(ORDEN_DE_RESTAURACION[ORDEN_DE_RESTAURACION.length - 1]).toBe('auditoria_log');
    expect(ORDEN_DE_RESTAURACION.indexOf('caja_sesiones')).toBeLessThan(ORDEN_DE_RESTAURACION.indexOf('ventas'));
    expect(ORDEN_DE_RESTAURACION.indexOf('ventas')).toBeLessThan(ORDEN_DE_RESTAURACION.indexOf('venta_detalle'));
    expect(ORDEN_DE_RESTAURACION.indexOf('ventas')).toBeLessThan(ORDEN_DE_RESTAURACION.indexOf('recibos'));
    expect(ORDEN_DE_RESTAURACION.indexOf('categorias')).toBeLessThan(ORDEN_DE_RESTAURACION.indexOf('productos'));
  });

  it('anulaciones_de_venta va después de ventas y antes de auditoria_log', () => {
    expect(ORDEN_DE_RESTAURACION.indexOf('ventas')).toBeLessThan(ORDEN_DE_RESTAURACION.indexOf('anulaciones_de_venta'));
    expect(ORDEN_DE_RESTAURACION.indexOf('usuarios')).toBeLessThan(ORDEN_DE_RESTAURACION.indexOf('anulaciones_de_venta'));
    expect(ORDEN_DE_RESTAURACION.indexOf('anulaciones_de_venta')).toBeLessThan(ORDEN_DE_RESTAURACION.indexOf('auditoria_log'));
  });
});

describe('La comprobación MUERDE', () => {
  it('una llave hacia una tabla que se restaura DESPUÉS se nombra', () => {
    const invertida: LlaveForaneaLocal = { tabla: 'caja_sesiones', columna: 'venta_inventada', referencia: 'ventas' };
    expect(violacionesDelOrden([invertida])).toEqual([
      'caja_sesiones.venta_inventada referencia a ventas, pero ventas se restaura después',
    ]);
  });

  it('una llave hacia una tabla que no está en el orden se nombra', () => {
    expect(violacionesDelOrden([{ tabla: 'ventas', columna: 'x', referencia: 'sucursales' }])).toEqual([
      'ventas.x referencia a sucursales, que no está en el orden de restauración',
    ]);
  });

  it('una tabla con llaves que no está en el orden se nombra', () => {
    expect(violacionesDelOrden([{ tabla: 'devoluciones', columna: 'venta_id', referencia: 'ventas' }])).toEqual([
      'devoluciones tiene llaves foráneas y no está en el orden de restauración',
    ]);
  });

  it('denominaciones cuenta como ya existente: referenciarla no es violación', () => {
    expect(violacionesDelOrden([{ tabla: 'caja_sesion_denominaciones', columna: 'denominacion_id', referencia: 'denominaciones' }])).toEqual([]);
  });
});

describe('Las tablas que se pueden EXCLUIR sin romper una llave de lo legítimo', () => {
  it('son seis, todas de solo inserción en la nube, y todas están en el orden', () => {
    expect([...TABLAS_QUE_SOLO_SE_INSERTAN].sort()).toEqual(
      ['anulaciones_de_venta', 'auditoria_log', 'caja_sesion_denominaciones', 'recibos', 'venta_detalle', 'ventas'].sort(),
    );
    for (const tabla of TABLAS_QUE_SOLO_SE_INSERTAN) {
      expect(ORDEN_DE_RESTAURACION).toContain(tabla);
    }
  });

  it('ninguna tabla que se restaura SIEMPRE referencia a una que se puede excluir: excluir nunca deja huérfana una fila restaurada', () => {
    const excluibles = new Set<string>(TABLAS_QUE_SOLO_SE_INSERTAN);
    const peligrosas = LLAVES_DEL_CATALOGO_DE_POSTGRES.filter(
      (llave) => excluibles.has(llave.referencia) && !excluibles.has(llave.tabla),
    );
    expect(peligrosas.map(clave)).toEqual([]);
  });
});
