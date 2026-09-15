/**
 * La migración 031: `productos.precio_compra`, el costo que usa el margen del
 * reporte de ventas por producto (CLAUDE.md §4.39).
 *
 * Lo que tiene que sostener:
 *
 *   · Los productos que ya existían quedan SIN costo (`NULL`), no en cero.
 *   · La base rechaza un costo negativo o con forma no canónica.
 *   · Lo que esperaba en `sync_cola` gana la clave `precio_compra` con `null`:
 *     sin eso, la nube lo rechazaría por «columna de menos» y ningún reintento
 *     lo arreglaría, porque el payload se guardó al encolar.
 */

import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { encolarLote } from '../bandeja-de-salida';
import { aplicarMigraciones, MIGRACIONES } from '../migrator';
import { crearBaseMigrada, crearBaseVacia } from './ayuda-base-de-datos';

const ID_CATEGORIA = '11111111-1111-4111-8111-111111111111';
const ID_PENDIENTE = '22222222-2222-4222-8222-222222222222';
const ID_SUBIDO = '33333333-3333-4333-8333-333333333333';
const INSTANTE = '2026-09-14T15:00:00.000Z';

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

/** Una base con todas las migraciones MENOS la 031, como la de Jimmy hoy. */
function baseSinLa031(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(nueva.base, MIGRACIONES.filter((m) => m.orden < 31));
  return nueva.base;
}

/**
 * Siembra por SQL y no por el repositorio: el repositorio de HOY ya escribe
 * `precio_compra`, y en una base sin la 031 esa columna no existe.
 */
function sembrarProducto(base: Database, id: string, nombre: string): void {
  base
    .prepare(
      `INSERT OR IGNORE INTO categorias (id, nombre, orden, activo, creado_en, actualizado_en)
       VALUES (?, 'Granos', 1, 1, ?, ?)`,
    )
    .run(ID_CATEGORIA, INSTANTE, INSTANTE);
  base
    .prepare(
      `INSERT INTO productos (id, nombre, categoria_id, tipo_medida, unidad_peso,
         cantidad_predefinida_icono, precio_base, inventario_disponible, activo, creado_en, actualizado_en)
       VALUES (?, ?, ?, 'peso', 'lb', '1.000', '6.00', '100.000', 1, ?, ?)`,
    )
    .run(id, nombre, ID_CATEGORIA, INSTANTE, INSTANTE);
}

function payloadDe(base: Database, id: string): Record<string, unknown> {
  const fila = base.prepare('SELECT payload FROM sync_cola WHERE entidad_id = ?').get(id) as {
    payload: string;
  };
  return JSON.parse(fila.payload) as Record<string, unknown>;
}

describe('LA MIGRACIÓN 031 agrega el costo sin inventar ninguno', () => {
  it('un producto que ya existía queda SIN costo (NULL), no con costo cero', () => {
    const base = baseSinLa031();
    sembrarProducto(base, ID_PENDIENTE, 'Maíz blanco');

    aplicarMigraciones(base, MIGRACIONES);

    const fila = base.prepare('SELECT precio_compra FROM productos WHERE id = ?').get(ID_PENDIENTE) as {
      precio_compra: string | null;
    };
    expect(fila.precio_compra).toBeNull();
  });

  it('LO QUE ESPERABA EN LA COLA gana la clave precio_compra con null; lo ya subido no se toca', () => {
    const base = baseSinLa031();
    sembrarProducto(base, ID_PENDIENTE, 'Maíz blanco');
    sembrarProducto(base, ID_SUBIDO, 'Frijol negro');
    encolarLote(base, [{ tabla: 'productos', id: ID_PENDIENTE, operacion: 'insertar' }]);
    encolarLote(base, [{ tabla: 'productos', id: ID_SUBIDO, operacion: 'insertar' }]);
    base
      .prepare("UPDATE sync_cola SET sincronizado_en = '2026-09-14T16:00:00.000Z' WHERE entidad_id = ?")
      .run(ID_SUBIDO);
    // El control: antes de migrar, el payload NO tiene la clave.
    expect(Object.keys(payloadDe(base, ID_PENDIENTE))).not.toContain('precio_compra');

    aplicarMigraciones(base, MIGRACIONES);

    const pendiente = payloadDe(base, ID_PENDIENTE);
    expect(Object.keys(pendiente)).toContain('precio_compra');
    expect(pendiente.precio_compra).toBeNull();
    // El payload vuelve a ser la fila, clave por clave, como manda §4.17.
    const fila = base.prepare('SELECT * FROM productos WHERE id = ?').get(ID_PENDIENTE) as Record<
      string,
      unknown
    >;
    expect(Object.keys(pendiente).sort()).toEqual(Object.keys(fila).sort());
    // El ya subido es la constancia de lo que se ENVIÓ.
    expect(Object.keys(payloadDe(base, ID_SUBIDO))).not.toContain('precio_compra');
  });
});

describe('La base hace cumplir la forma del costo', () => {
  function baseCompleta(): Database {
    const nueva = crearBaseMigrada();
    limpiar = nueva.limpiar;
    sembrarProducto(nueva.base, ID_PENDIENTE, 'Maíz blanco');
    return nueva.base;
  }

  const fijar = (base: Database, valor: unknown): void => {
    base.prepare('UPDATE productos SET precio_compra = ? WHERE id = ?').run(valor, ID_PENDIENTE);
  };

  it('ACEPTA NULL, que es «sin costo cargado»', () => {
    const base = baseCompleta();
    expect(() => {
      fijar(base, null);
    }).not.toThrow();
  });

  it('ACEPTA un monto canónico, incluido 0.00 (costo cero es un dato, distinto de no saberlo)', () => {
    const base = baseCompleta();
    expect(() => {
      fijar(base, '4.50');
    }).not.toThrow();
    expect(() => {
      fijar(base, '0.00');
    }).not.toThrow();
  });

  it('RECHAZA un costo negativo', () => {
    const base = baseCompleta();
    expect(() => {
      fijar(base, '-1.00');
    }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA la forma no canónica y el número de punto flotante', () => {
    const base = baseCompleta();
    for (const malo of ['4.5', '4', '4.500', 4.5, '']) {
      expect(() => {
        fijar(base, malo);
      }, `debería rechazar ${JSON.stringify(malo)}`).toThrow(/CHECK constraint failed/);
    }
  });
});
