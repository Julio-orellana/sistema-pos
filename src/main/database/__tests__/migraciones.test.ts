/**
 * Pruebas del sistema de migraciones.
 *
 * Responden con hechos a: ¿las migraciones corren limpias desde una base
 * vacía? ¿Correrlas dos veces rompe algo o duplica algo? ¿Se puede editar una
 * migración ya aplicada sin que nadie se entere?
 */

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRACIONES, ErrorDeMigracion, aplicarMigraciones, calcularChecksum, contarMigracionesAplicadas, obtenerUltimaMigracion } from '../migrator';
import { crearBaseVacia, migrar } from './ayuda-base-de-datos';

/** Las once tablas del esquema, más la de control del migrador. */
const TABLAS_ESPERADAS = [
  'auditoria_log',
  'bloqueos_de_autorizacion',
  'caja_sesiones',
  'categorias',
  'limites_descuento',
  'migraciones_aplicadas',
  'precios_especiales',
  'productos',
  'recibos',
  'sync_cola',
  'usuarios',
  'venta_detalle',
  'ventas',
] as const;

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

/** Nombres de las tablas que existen en una base. */
function tablasDe(base: Parameters<typeof migrar>[0]): string[] {
  const filas = base
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { readonly name: string }[];
  return filas.map((fila) => fila.name);
}

describe('Las migraciones corren limpias desde una base vacía', () => {
  it('una base vacía queda con las once tablas del esquema más la de control', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;

    const resultado = migrar(prueba.base);

    // Se comparan contra el registro de migraciones y no contra una lista fija,
    // para que agregar una migración nueva no rompa esta prueba por sí solo.
    expect(resultado.aplicadasAhora).toEqual(MIGRACIONES.map((m) => m.nombre));
    expect(resultado.yaAplicadas).toEqual([]);
    expect(tablasDe(prueba.base)).toEqual([...TABLAS_ESPERADAS]);
  });

  it('deja registrada la migración aplicada con su fecha y su checksum', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;
    migrar(prueba.base);

    const fila = prueba.base
      .prepare('SELECT orden, nombre, checksum, aplicada_en FROM migraciones_aplicadas ORDER BY orden LIMIT 1')
      .get() as { orden: number; nombre: string; checksum: string; aplicada_en: string };

    expect(fila.orden).toBe(1);
    expect(fila.nombre).toBe('001_esquema_inicial');
    expect(fila.checksum).toBe(calcularChecksum(MIGRACIONES[0]?.sql ?? ''));
    expect(fila.aplicada_en).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('crea los índices y no solo las tablas', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;
    migrar(prueba.base);

    const indices = prueba.base
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .all() as { readonly name: string }[];

    expect(indices.length).toBeGreaterThan(10);
    expect(indices.map((i) => i.name)).toContain('idx_productos_populares');
    expect(indices.map((i) => i.name)).toContain('idx_ventas_fecha');
  });

  it('crea los triggers que hacen inmutable la bitácora de auditoría', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;
    migrar(prueba.base);

    const triggers = prueba.base
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all() as { readonly name: string }[];

    expect(triggers.map((t) => t.name).sort()).toEqual([
      'auditoria_log_prohibir_delete',
      'auditoria_log_prohibir_update',
    ]);
  });
});

describe('Las migraciones son idempotentes', () => {
  it('correrlas dos veces no falla', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;

    migrar(prueba.base);
    expect(() => migrar(prueba.base)).not.toThrow();
  });

  it('la segunda corrida no aplica nada y reconoce lo que ya estaba', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;

    migrar(prueba.base);
    const segunda = migrar(prueba.base);

    expect(segunda.aplicadasAhora).toEqual([]);
    expect(segunda.yaAplicadas).toEqual(MIGRACIONES.map((m) => m.nombre));
  });

  it('correrlas tres veces deja un único registro en la tabla de control', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;

    migrar(prueba.base);
    migrar(prueba.base);
    migrar(prueba.base);

    expect(contarMigracionesAplicadas(prueba.base)).toBe(MIGRACIONES.length);
  });

  it('correrlas dos veces no duplica tablas ni índices', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;

    migrar(prueba.base);
    const despuesDeLaPrimera = tablasDe(prueba.base);
    migrar(prueba.base);

    expect(tablasDe(prueba.base)).toEqual(despuesDeLaPrimera);
  });
});

describe('Una migración ya aplicada no se puede editar en silencio', () => {
  it('si cambia el contenido de una migración aplicada, el migrador se niega a arrancar', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;
    migrar(prueba.base);

    const migracionEditada = [
      { orden: 1, nombre: '001_esquema_inicial', sql: '-- alguien le agregó una línea\nSELECT 1;' },
    ];

    expect(() => aplicarMigraciones(prueba.base, migracionEditada)).toThrow(ErrorDeMigracion);
    expect(() => aplicarMigraciones(prueba.base, migracionEditada)).toThrow(/su contenido cambió/);
  });
});

describe('Una migración que falla no deja el esquema a medias', () => {
  it('se revierte por completo y no queda registrada como aplicada', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;

    const migracionRota = [
      {
        orden: 1,
        nombre: '001_rota',
        sql: 'CREATE TABLE tabla_buena (id TEXT); ESTO NO ES SQL VÁLIDO;',
      },
    ];

    expect(() => aplicarMigraciones(prueba.base, migracionRota)).toThrow(ErrorDeMigracion);

    // Ni la tabla que alcanzó a crearse ni el registro de la migración quedan.
    expect(tablasDe(prueba.base)).toEqual(['migraciones_aplicadas']);
    expect(contarMigracionesAplicadas(prueba.base)).toBe(0);
    expect(obtenerUltimaMigracion(prueba.base)).toBeNull();
  });
});


// ===========================================================================
describe('La migración 002 agrega el bloqueo por intentos', () => {
  it('la tabla usuarios queda con intentos_fallidos y bloqueado_hasta', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;
    migrar(prueba.base);

    const columnas = (
      prueba.base.prepare("SELECT name FROM pragma_table_info('usuarios')").all() as {
        name: string;
      }[]
    ).map((fila) => fila.name);

    expect(columnas).toContain('intentos_fallidos');
    expect(columnas).toContain('bloqueado_hasta');
  });

  it('intentos_fallidos arranca en 0 y no admite negativos', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;
    migrar(prueba.base);

    const FECHA = '2026-09-06T12:00:00.000Z';
    prueba.base
      .prepare(
        `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, creado_en, actualizado_en)
         VALUES ('11111111-1111-4111-8111-111111111111', 'Jimmy', 'administrativo', 'h', 1, ?, ?)`,
      )
      .run(FECHA, FECHA);

    const fila = prueba.base
      .prepare('SELECT intentos_fallidos, bloqueado_hasta FROM usuarios')
      .get() as { intentos_fallidos: number; bloqueado_hasta: string | null };

    expect(fila.intentos_fallidos).toBe(0);
    expect(fila.bloqueado_hasta).toBeNull();

    expect(() => {
      prueba.base.prepare('UPDATE usuarios SET intentos_fallidos = -1').run();
    }).toThrow(/CHECK constraint failed/);
  });

  it('bloqueado_hasta rechaza una fecha que no sea ISO-8601 UTC', () => {
    const prueba = crearBaseVacia();
    limpiar = prueba.limpiar;
    migrar(prueba.base);

    const FECHA = '2026-09-06T12:00:00.000Z';
    prueba.base
      .prepare(
        `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, creado_en, actualizado_en)
         VALUES ('11111111-1111-4111-8111-111111111111', 'Jimmy', 'administrativo', 'h', 1, ?, ?)`,
      )
      .run(FECHA, FECHA);

    expect(() => {
      prueba.base.prepare("UPDATE usuarios SET bloqueado_hasta = 'mañana'").run();
    }).toThrow(/CHECK constraint failed/);
  });
});
