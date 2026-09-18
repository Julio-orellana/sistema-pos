/**
 * La migración 032: `venta_detalle.costo_unitario_snap`, la foto del costo del
 * producto al momento de cada venta (CLAUDE.md §4.40).
 *
 * Lo que tiene que sostener:
 *
 *   · Las líneas de ventas que ya existían quedan SIN foto (`NULL`): no se
 *     completan con el costo de hoy, que sería inventar un dato retroactivo.
 *   · La base rechaza un costo negativo o con forma no canónica.
 *   · Las líneas que esperaban en `sync_cola` ganan la clave con `null`, para
 *     que la nube no las rechace por «columna de menos».
 */

import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { encolarLote } from '../bandeja-de-salida';
import { aplicarMigraciones, MIGRACIONES } from '../migrator';
import { crearRepositorios } from '../repositories';
import { crearBaseVacia } from './ayuda-base-de-datos';

const INSTANTE = '2026-09-14T15:00:00.000Z';

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

/** Una base con todas las migraciones MENOS la 032. */
function baseSinLa032(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(nueva.base, MIGRACIONES.filter((m) => m.orden < 32));
  return nueva.base;
}

/**
 * Siembra una venta con una línea. La línea va por SQL: el repositorio de HOY
 * ya escribe `costo_unitario_snap`, que en una base sin la 032 no existe.
 */
function sembrarLinea(base: Database, idLinea: string, nombre: string): void {
  const repos = crearRepositorios(base);
  const usuario = repos.usuarios.crear({ nombre: `Jimmy ${nombre}`, rol: 'administrativo', pinHash: 'hash-de-prueba' });
  const categoria = repos.categorias.crear({ nombre: `Granos ${nombre}` });
  const producto = repos.productos.crear({
    nombre,
    categoriaId: categoria.id,
    tipoMedida: 'unidad',
    cantidadPredefinidaIcono: '1',
    precioBase: '6.00',
    // HOY tiene costo: la migración igual NO debe copiarlo a la venta vieja.
    precioCompra: '4.00',
    inventarioDisponible: '10',
  });
  // Una sola caja abierta en todo el sistema (§4.9): la segunda venta usa la misma.
  const caja =
    repos.cajaSesiones.obtenerAbierta() ??
    repos.cajaSesiones.abrir({ usuarioId: usuario.id, montoInicial: '500' });
  const venta = repos.ventas.crear({
    cajaSesionId: caja.id,
    usuarioId: usuario.id,
    subtotal: '6.00',
    total: '6.00',
    formaPago: 'efectivo',
  });
  base
    .prepare(
      `INSERT INTO venta_detalle (id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad,
         precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en)
       VALUES (?, ?, ?, ?, 'u', '1.000', '6.00', '6', '6.00', 0, ?)`,
    )
    .run(idLinea, venta.id, producto.id, nombre, INSTANTE);
}

const ID_PENDIENTE = '44444444-4444-4444-8444-444444444444';
const ID_SUBIDA = '55555555-5555-4555-8555-555555555555';

function payloadDe(base: Database, id: string): Record<string, unknown> {
  const fila = base.prepare('SELECT payload FROM sync_cola WHERE entidad_id = ?').get(id) as { payload: string };
  return JSON.parse(fila.payload) as Record<string, unknown>;
}

describe('LA MIGRACIÓN 032 agrega la foto del costo sin inventar ninguna', () => {
  it('una línea de una venta que ya existía queda SIN foto (NULL), aunque el producto tenga costo hoy', () => {
    const base = baseSinLa032();
    sembrarLinea(base, ID_PENDIENTE, 'Maíz');

    aplicarMigraciones(base, MIGRACIONES);

    const fila = base.prepare('SELECT costo_unitario_snap FROM venta_detalle WHERE id = ?').get(ID_PENDIENTE) as {
      costo_unitario_snap: string | null;
    };
    expect(fila.costo_unitario_snap).toBeNull();
  });

  it('LO QUE ESPERABA EN LA COLA gana la clave con null; lo ya subido no se toca', () => {
    const base = baseSinLa032();
    sembrarLinea(base, ID_PENDIENTE, 'Maíz');
    sembrarLinea(base, ID_SUBIDA, 'Frijol');
    encolarLote(base, [{ tabla: 'venta_detalle', id: ID_PENDIENTE, operacion: 'insertar' }]);
    encolarLote(base, [{ tabla: 'venta_detalle', id: ID_SUBIDA, operacion: 'insertar' }]);
    base
      .prepare("UPDATE sync_cola SET sincronizado_en = '2026-09-14T16:00:00.000Z' WHERE entidad_id = ?")
      .run(ID_SUBIDA);
    expect(Object.keys(payloadDe(base, ID_PENDIENTE))).not.toContain('costo_unitario_snap');

    aplicarMigraciones(base, MIGRACIONES);

    const pendiente = payloadDe(base, ID_PENDIENTE);
    expect(pendiente.costo_unitario_snap).toBeNull();
    const fila = base.prepare('SELECT * FROM venta_detalle WHERE id = ?').get(ID_PENDIENTE) as Record<string, unknown>;
    expect(Object.keys(pendiente).sort()).toEqual(Object.keys(fila).sort());
    expect(Object.keys(payloadDe(base, ID_SUBIDA))).not.toContain('costo_unitario_snap');
  });
});

describe('La base hace cumplir la forma de la foto del costo', () => {
  function baseCompleta(): Database {
    const base = baseSinLa032();
    sembrarLinea(base, ID_PENDIENTE, 'Maíz');
    aplicarMigraciones(base, MIGRACIONES);
    return base;
  }
  const fijar = (base: Database, valor: unknown): void => {
    base.prepare('UPDATE venta_detalle SET costo_unitario_snap = ? WHERE id = ?').run(valor, ID_PENDIENTE);
  };

  it('ACEPTA NULL y un monto canónico, incluido 0.00', () => {
    const base = baseCompleta();
    for (const bueno of [null, '4.50', '0.00']) {
      expect(() => {
        fijar(base, bueno);
      }).not.toThrow();
    }
  });

  it('RECHAZA un costo negativo, la forma no canónica y el número de punto flotante', () => {
    const base = baseCompleta();
    for (const malo of ['-1.00', '4.5', '4', 4.5, '']) {
      expect(() => {
        fijar(base, malo);
      }, `debería rechazar ${JSON.stringify(malo)}`).toThrow(/CHECK constraint failed/);
    }
  });
});
