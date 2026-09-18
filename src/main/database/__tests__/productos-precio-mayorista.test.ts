/**
 * La migración 039: el precio mayorista por cantidad mínima (spec 002, §4).
 *
 * Lo que tiene que sostener, con SQLite real:
 *
 *   · CA-17: las cuatro reglas en la base, cada una con su NOMBRE.
 *       R1 productos_mayorista_completo               los dos o ninguno
 *       R2 productos_precio_mayorista_canonico        monto canónico y > 0
 *       R3 productos_mayorista_menor_que_lista        estrictamente menor que la lista
 *       R4 productos_cantidad_minima_mayorista_canonica  cantidad canónica y > 0
 *   · CA-24: bajar la lista por debajo del mayorista se rechaza (decisión 1).
 *   · CA-18: los productos que ya existían quedan sin mayorista; lo que esperaba
 *     en la cola gana las dos claves en `null`; lo ya subido no se toca.
 *   · CA-19: el espejo 0039 agrega las mismas reglas de tabla con los mismos
 *     nombres.
 */

import type { Database } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { encolarLote } from '../bandeja-de-salida';
import { aplicarMigraciones, MIGRACIONES } from '../migrator';
import { crearBaseMigrada, crearBaseVacia } from './ayuda-base-de-datos';

const RAIZ = join(__dirname, '..', '..', '..', '..');
const ID_CATEGORIA = '11111111-1111-4111-8111-111111111111';
const ID_MAIZ = '22222222-2222-4222-8222-222222222222';
const ID_SUBIDO = '33333333-3333-4333-8333-333333333333';
const INSTANTE = '2026-09-18T15:00:00.000Z';

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

/** Una base con todas las migraciones MENOS la 039, como la de la tienda hoy. */
function baseSinLa039(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(nueva.base, MIGRACIONES.filter((m) => m.orden < 39));
  return nueva.base;
}

/** Una base con todas las migraciones y el maíz a Q6.00 la libra. */
function baseCompleta(): Database {
  const nueva = crearBaseMigrada();
  limpiar = nueva.limpiar;
  sembrarProducto(nueva.base, ID_MAIZ, 'Maíz blanco', '6.00');
  return nueva.base;
}

/**
 * Siembra por SQL y no por el repositorio: el repositorio de hoy ya escribe las
 * columnas nuevas, y en una base sin la 039 no existen.
 */
function sembrarProducto(base: Database, id: string, nombre: string, precioBase: string): void {
  base
    .prepare(
      `INSERT OR IGNORE INTO categorias (id, nombre, orden, activo, creado_en, actualizado_en)
       VALUES (?, 'Granos', 0, 1, ?, ?)`,
    )
    .run(ID_CATEGORIA, INSTANTE, INSTANTE);
  base
    .prepare(
      `INSERT INTO productos (id, nombre, categoria_id, tipo_medida, unidad_peso,
         cantidad_predefinida_icono, precio_base, inventario_disponible, activo, creado_en, actualizado_en)
       VALUES (?, ?, ?, 'peso', 'lb', '1.000', ?, '100.000', 1, ?, ?)`,
    )
    .run(id, nombre, ID_CATEGORIA, precioBase, INSTANTE, INSTANTE);
}

function payloadDe(base: Database, id: string): Record<string, unknown> {
  const fila = base.prepare('SELECT payload FROM sync_cola WHERE entidad_id = ?').get(id) as { payload: string };
  return JSON.parse(fila.payload) as Record<string, unknown>;
}

/** Fija el mayorista del maíz; devuelve el mensaje del rechazo o «acepta». */
function fijarMayorista(base: Database, precio: unknown, cantidad: unknown): string {
  try {
    base
      .prepare('UPDATE productos SET precio_mayorista = ?, cantidad_minima_mayorista = ? WHERE id = ?')
      .run(precio, cantidad, ID_MAIZ);
    return 'acepta';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Cambia el precio de lista del maíz; devuelve el mensaje del rechazo o «acepta». */
function fijarLista(base: Database, precio: string): string {
  try {
    base.prepare('UPDATE productos SET precio_base = ? WHERE id = ?').run(precio, ID_MAIZ);
    return 'acepta';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('CA-18 — La 039 sobre una base que ya tiene datos', () => {
  it('un producto que ya existía queda SIN precio mayorista: las dos columnas en NULL', () => {
    const base = baseSinLa039();
    sembrarProducto(base, ID_MAIZ, 'Maíz blanco', '6.00');

    const resultado = aplicarMigraciones(base, MIGRACIONES);

    expect(resultado.aplicadasAhora).toEqual(['039_productos_precio_mayorista']);
    expect(base.prepare('SELECT precio_base, precio_mayorista, cantidad_minima_mayorista FROM productos').get()).toEqual({
      precio_base: '6.00',
      precio_mayorista: null,
      cantidad_minima_mayorista: null,
    });
    expect(base.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });

  it('LO QUE ESPERABA EN LA COLA gana las dos claves en null; lo ya subido no se toca', () => {
    const base = baseSinLa039();
    sembrarProducto(base, ID_MAIZ, 'Maíz blanco', '6.00');
    sembrarProducto(base, ID_SUBIDO, 'Frijol negro', '9.00');
    encolarLote(base, [{ tabla: 'productos', id: ID_MAIZ, operacion: 'insertar' }]);
    encolarLote(base, [{ tabla: 'productos', id: ID_SUBIDO, operacion: 'insertar' }]);
    base
      .prepare("UPDATE sync_cola SET sincronizado_en = '2026-09-18T16:00:00.000Z' WHERE entidad_id = ?")
      .run(ID_SUBIDO);
    // El control: antes de migrar, el payload NO tiene las claves.
    expect(Object.keys(payloadDe(base, ID_MAIZ))).not.toContain('precio_mayorista');

    aplicarMigraciones(base, MIGRACIONES);

    const pendiente = payloadDe(base, ID_MAIZ);
    expect(pendiente.precio_mayorista).toBeNull();
    expect(pendiente.cantidad_minima_mayorista).toBeNull();
    // El payload vuelve a ser la fila, clave por clave, como manda §4.17.
    const fila = base.prepare('SELECT * FROM productos WHERE id = ?').get(ID_MAIZ) as Record<string, unknown>;
    expect(Object.keys(pendiente).sort()).toEqual(Object.keys(fila).sort());
    // El ya subido es la constancia de lo que se ENVIÓ.
    const subido = Object.keys(payloadDe(base, ID_SUBIDO));
    expect(subido).not.toContain('precio_mayorista');
    expect(subido).not.toContain('cantidad_minima_mayorista');
  });

  it('las cuatro restricciones quedan en el esquema con su nombre', () => {
    const base = baseCompleta();
    const sql = (base.prepare("SELECT sql FROM sqlite_master WHERE name = 'productos'").get() as { sql: string }).sql;
    for (const nombre of [
      'productos_precio_mayorista_canonico',
      'productos_cantidad_minima_mayorista_canonica',
      'productos_mayorista_completo',
      'productos_mayorista_menor_que_lista',
    ]) {
      expect(sql, nombre).toContain(`CONSTRAINT ${nombre}`);
    }
  });
});

describe('CA-17 — R1: el precio y la cantidad mínima van juntos', () => {
  it('ACEPTA los dos vacíos (sin mayorista) y los dos llenos', () => {
    const base = baseCompleta();
    expect(fijarMayorista(base, null, null)).toBe('acepta');
    expect(fijarMayorista(base, '5.50', '50.000')).toBe('acepta');
  });

  it('RECHAZA el precio solo y la cantidad sola, nombrando la regla', () => {
    const base = baseCompleta();
    expect(fijarMayorista(base, '5.50', null)).toBe('CHECK constraint failed: productos_mayorista_completo');
    expect(fijarMayorista(base, null, '50.000')).toBe('CHECK constraint failed: productos_mayorista_completo');
  });
});

describe('CA-17 — R2: el precio mayorista es un monto canónico y MAYOR QUE CERO', () => {
  // ESTA PRUEBA CAMBIÓ EL 2026-09-18: aceptaba 0.00. Julio decidió que un
  // precio mayorista de cero no se permite (punto 55 de CLAUDE.md §6.2).
  it('ACEPTA dos decimales exactos, desde el centavo más chico', () => {
    const base = baseCompleta();
    expect(fijarMayorista(base, '0.01', '50.000')).toBe('acepta');
    expect(fijarMayorista(base, '0.10', '50.000')).toBe('acepta');
    expect(fijarMayorista(base, '5.99', '50.000')).toBe('acepta');
  });

  it('RECHAZA el cero, un negativo, la forma no canónica y el número de punto flotante', () => {
    const base = baseCompleta();
    for (const malo of ['0.00', '00.00', '-0.00', '-1.00', '5.5', '5', '5.500', 5.5, '']) {
      expect(fijarMayorista(base, malo, '50.000'), `debería rechazar ${JSON.stringify(malo)}`).toBe(
        'CHECK constraint failed: productos_precio_mayorista_canonico',
      );
    }
  });
});

describe('CA-17 — R3: el precio mayorista es ESTRICTAMENTE menor que la lista', () => {
  it('ACEPTA un centavo menos que la lista', () => {
    expect(fijarMayorista(baseCompleta(), '5.99', '50.000')).toBe('acepta');
  });

  it('RECHAZA uno IGUAL a la lista y uno mayor, nombrando la regla', () => {
    const base = baseCompleta();
    expect(fijarMayorista(base, '6.00', '50.000')).toBe('CHECK constraint failed: productos_mayorista_menor_que_lista');
    expect(fijarMayorista(base, '6.01', '50.000')).toBe('CHECK constraint failed: productos_mayorista_menor_que_lista');
  });

  it('compara CENTAVOS, no texto: con lista Q10.00 acepta Q9.00, y con lista Q9.00 rechaza Q10.00', () => {
    // Como texto, '10.00' < '9.00' es VERDADERO: una regla escrita con `<` sobre
    // las columnas TEXT haría exactamente lo contrario en estos dos casos.
    const base = baseCompleta();
    expect(fijarLista(base, '10.00')).toBe('acepta');
    expect(fijarMayorista(base, '9.00', '5.000')).toBe('acepta');
    expect(fijarMayorista(base, null, null)).toBe('acepta');
    expect(fijarLista(base, '9.00')).toBe('acepta');
    expect(fijarMayorista(base, '10.00', '5.000')).toBe('CHECK constraint failed: productos_mayorista_menor_que_lista');
    expect(fijarMayorista(base, '100.00', '5.000')).toBe('CHECK constraint failed: productos_mayorista_menor_que_lista');
  });

  it('CA-24: con mayorista Q5.50, BAJAR LA LISTA a Q5.50 o menos se rechaza; subirla, no', () => {
    const base = baseCompleta();
    expect(fijarMayorista(base, '5.50', '50.000')).toBe('acepta');
    expect(fijarLista(base, '5.50')).toBe('CHECK constraint failed: productos_mayorista_menor_que_lista');
    expect(fijarLista(base, '5.00')).toBe('CHECK constraint failed: productos_mayorista_menor_que_lista');
    expect(fijarLista(base, '7.00')).toBe('acepta');
    expect(base.prepare('SELECT precio_base FROM productos WHERE id = ?').get(ID_MAIZ)).toEqual({ precio_base: '7.00' });
  });
});

describe('CA-17 — R4: la cantidad mínima es canónica y ESTRICTAMENTE mayor que cero', () => {
  it('ACEPTA tres decimales exactos y positivos, incluido 0.001', () => {
    const base = baseCompleta();
    expect(fijarMayorista(base, '5.50', '0.001')).toBe('acepta');
    expect(fijarMayorista(base, '5.50', '25.500')).toBe('acepta');
  });

  it('RECHAZA cero, un negativo, la forma no canónica y el número de punto flotante', () => {
    const base = baseCompleta();
    for (const malo of ['0.000', '-5.000', '50', '50.00', '50.0000', 50, '']) {
      expect(fijarMayorista(base, '5.50', malo), `debería rechazar ${JSON.stringify(malo)}`).toBe(
        'CHECK constraint failed: productos_cantidad_minima_mayorista_canonica',
      );
    }
  });
});

describe('CA-19 — El espejo 0039 en la nube', () => {
  /** El texto sin comentarios de línea y con los espacios normalizados. */
  function sentencias(ruta: string): string {
    return readFileSync(join(RAIZ, ruta), 'utf8')
      .replace(/--[^\n]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const LOCAL = sentencias('src/main/database/migrations/039_productos_precio_mayorista.sql');
  const NUBE = sentencias('supabase/migrations/0039_productos_precio_mayorista.sql');

  /** Nombre y expresión de cada `ADD CONSTRAINT … CHECK (…);`. */
  function reglasDeTabla(texto: string): Map<string, string> {
    const reglas = new Map<string, string>();
    for (const coincidencia of texto.matchAll(/ADD CONSTRAINT (\w+) CHECK \((.*?)\);/g)) {
      reglas.set(coincidencia[1] ?? '', coincidencia[2] ?? '');
    }
    return reglas;
  }

  it('control: el lector quita los comentarios', () => {
    expect(LOCAL).not.toContain('Spec 002');
    expect(NUBE).not.toContain('ORDEN DE APLICACIÓN');
  });

  it('las dos agregan las MISMAS reglas de tabla, con los mismos nombres', () => {
    expect([...reglasDeTabla(LOCAL).keys()]).toEqual([
      'productos_mayorista_completo',
      'productos_mayorista_menor_que_lista',
    ]);
    expect([...reglasDeTabla(NUBE).keys()]).toEqual([...reglasDeTabla(LOCAL).keys()]);
  });

  it('R1 dice lo mismo en los dos lados, letra por letra', () => {
    expect(reglasDeTabla(NUBE).get('productos_mayorista_completo')).toBe(
      reglasDeTabla(LOCAL).get('productos_mayorista_completo'),
    );
  });

  it('R3 compara la columna mayorista contra precio_base en los dos lados (en la nube, NUMERIC)', () => {
    expect(reglasDeTabla(NUBE).get('productos_mayorista_menor_que_lista')).toBe(
      'precio_mayorista IS NULL OR precio_mayorista < precio_base',
    );
    expect(reglasDeTabla(LOCAL).get('productos_mayorista_menor_que_lista')).toBe(
      "precio_mayorista IS NULL OR CAST(replace(precio_mayorista, '.', '') AS INTEGER) " +
        "< CAST(replace(precio_base, '.', '') AS INTEGER)",
    );
  });

  it('la nube agrega las dos columnas con los tipos de sus hermanas: NUMERIC(14, 2) y NUMERIC(14, 3)', () => {
    expect(NUBE).toContain('ADD COLUMN IF NOT EXISTS precio_mayorista NUMERIC(14, 2)');
    expect(NUBE).toContain('ADD COLUMN IF NOT EXISTS cantidad_minima_mayorista NUMERIC(14, 3)');
    // Desde el 2026-09-18 el precio es ESTRICTAMENTE mayor que cero, como en la
    // 039 local (punto 55). Antes decía `>= 0`, con la restricción `_no_negativo`.
    expect(NUBE).toContain(
      'CONSTRAINT productos_precio_mayorista_positivo CHECK (precio_mayorista IS NULL OR precio_mayorista > 0)',
    );
    expect(NUBE).not.toMatch(/precio_mayorista >= 0/);
    expect(NUBE).toContain('CHECK (cantidad_minima_mayorista IS NULL OR cantidad_minima_mayorista > 0)');
  });

  it('la 0039 no toca ninguna función: no sube la versión de contrato', () => {
    expect(NUBE).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
  });
});
