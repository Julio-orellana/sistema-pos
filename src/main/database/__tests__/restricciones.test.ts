/**
 * Pruebas de las restricciones del esquema.
 *
 * Estas pruebas no verifican código nuestro: verifican que LA BASE DE DATOS
 * rechaza por su cuenta los datos que no debe aceptar. Es la última línea de
 * defensa, la que sigue en pie aunque un repositorio tenga un error.
 *
 * Se corren contra bases SQLite reales en archivos temporales, con las mismas
 * PRAGMA que corren en la tienda.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import {
  FECHA_DE_PRUEBA,
  IDS_DE_PRUEBA,
  crearBaseMigrada,
  sembrarCajaSesion,
  sembrarCategoria,
  sembrarProducto,
  sembrarUsuario,
} from './ayuda-base-de-datos';

let base: Database;
let limpiar: () => void;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
});

afterEach(() => {
  limpiar();
});

/**
 * Intenta insertar un producto con el valor dado en `precio_base`.
 * La categoría se siembra aparte, una sola vez por prueba: si se sembrara aquí,
 * una segunda llamada chocaría con el UNIQUE de categorías antes de llegar al
 * CHECK que se quiere probar.
 */
function insertarPrecioBase(valor: unknown): void {
  base
    .prepare(
      `INSERT INTO productos (
         id, nombre, categoria_id, tipo_medida, unidad_peso,
         cantidad_predefinida_icono, precio_base, inventario_disponible,
         contador_ventas, activo, creado_en, actualizado_en
       ) VALUES (?, 'Prueba', ?, 'peso', 'lb', '1.000', ?, '10.000', 0, 1, ?, ?)`,
    )
    .run(IDS_DE_PRUEBA.producto, IDS_DE_PRUEBA.categoria, valor, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
}

// ===========================================================================
describe('Ningún campo de dinero acepta algo que no sea el TEXT esperado', () => {
  beforeEach(() => {
    sembrarCategoria(base);
  });

  it('acepta el formato canónico de dos decimales', () => {
    expect(() => { insertarPrecioBase('2.50'); }).not.toThrow();
  });

  it('acepta un monto negativo en forma canónica', () => {
    expect(() => { insertarPrecioBase('-2.50'); }).not.toThrow();
  });

  it('RECHAZA un float de JavaScript ligado directamente', () => {
    // Este es el caso que motiva toda la regla: 0.1 + 0.2 en JavaScript da
    // 0.30000000000000004. SQLite, por afinidad TEXT, lo convertiría a la
    // cadena '0.30000000000000004' sin quejarse; el CHECK lo detiene.
    expect(() => { insertarPrecioBase(0.1 + 0.2); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA un número de JavaScript aunque sea "redondo"', () => {
    expect(() => { insertarPrecioBase(2.5); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertarPrecioBase(2); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA un monto con un solo decimal: la forma canónica lleva dos', () => {
    expect(() => { insertarPrecioBase('2.5'); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA un monto sin decimales', () => {
    expect(() => { insertarPrecioBase('2'); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA texto que no es un número', () => {
    expect(() => { insertarPrecioBase('dos con cincuenta'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertarPrecioBase(''); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA notación científica', () => {
    expect(() => { insertarPrecioBase('2.5e2'); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA dos puntos decimales y un signo menos fuera del inicio', () => {
    expect(() => { insertarPrecioBase('1.2.34'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertarPrecioBase('1-6.80'); }).toThrow(/CHECK constraint failed/);
  });

  it('las cantidades y pesos exigen exactamente TRES decimales', () => {
    const insertarInventario = (valor: string): void => {
      base
        .prepare(
          `INSERT INTO productos (
             id, nombre, categoria_id, tipo_medida, unidad_peso,
             cantidad_predefinida_icono, precio_base, inventario_disponible,
             contador_ventas, activo, creado_en, actualizado_en
           ) VALUES (?, ?, ?, 'peso', 'lb', '1.000', '2.50', ?, 0, 1, ?, ?)`,
        )
        .run(
          `${IDS_DE_PRUEBA.producto.slice(0, 35)}${String(valor.length % 10)}`,
          `Producto ${valor}`,
          IDS_DE_PRUEBA.categoria,
          valor,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    };

    expect(() => { insertarInventario('60.000'); }).not.toThrow();
    expect(() => { insertarInventario('60.00'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertarInventario('60'); }).toThrow(/CHECK constraint failed/);
  });

  it('subtotal_exacto admite más decimales, pero no los 17 que delatan un float', () => {
    sembrarUsuario(base);
    sembrarProducto(base);
    sembrarCajaSesion(base);
    base
      .prepare(
        `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total,
                             forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, '10.00', '10.00', 'efectivo', 'completada', 'pendiente', ?, ?)`,
      )
      .run(
        IDS_DE_PRUEBA.venta,
        IDS_DE_PRUEBA.cajaSesion,
        IDS_DE_PRUEBA.usuario,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
      );

    const insertarLinea = (subtotalExacto: string, orden: number): void => {
      base
        .prepare(
          `INSERT INTO venta_detalle (
             id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad,
             precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en
           ) VALUES (?, ?, ?, 'Maíz', 'lb', '1.500', '2.23', ?, '3.35', ?, ?)`,
        )
        .run(
          `${IDS_DE_PRUEBA.detalle.slice(0, 35)}${String(orden)}`,
          IDS_DE_PRUEBA.venta,
          IDS_DE_PRUEBA.producto,
          subtotalExacto,
          orden,
          FECHA_DE_PRUEBA,
        );
    };

    // 3.345 es un subtotal exacto legítimo (1.5 lb x Q2.23).
    expect(() => { insertarLinea('3.345', 0); }).not.toThrow();
    // 0.30000000000000004 solo puede venir de un float.
    expect(() => { insertarLinea('0.30000000000000004', 1); }).toThrow(/CHECK constraint failed/);
  });
});

// ===========================================================================
describe('Las restricciones CHECK de valores enumerados', () => {
  it('RECHAZA un rol que no existe', () => {
    expect(() => {
      base
        .prepare(
          `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, creado_en, actualizado_en)
           VALUES (?, 'Fulano', 'gerente', 'hash', 1, ?, ?)`,
        )
        .run(IDS_DE_PRUEBA.usuario, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });

  it('acepta los dos roles válidos', () => {
    expect(() => { sembrarUsuario(base, IDS_DE_PRUEBA.usuario, 'venta'); }).not.toThrow();
    expect(() => { sembrarUsuario(base, IDS_DE_PRUEBA.usuarioAdmin, 'administrativo'); }).not.toThrow();
  });

  it('RECHAZA una forma de pago que no existe', () => {
    sembrarUsuario(base);
    sembrarCajaSesion(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total,
                               forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '10.00', '10.00', 'criptomoneda', 'completada', 'pendiente', ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.venta,
          IDS_DE_PRUEBA.cajaSesion,
          IDS_DE_PRUEBA.usuario,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA un estado de venta que no existe', () => {
    sembrarUsuario(base);
    sembrarCajaSesion(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total,
                               forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '10.00', '10.00', 'efectivo', 'pendiente_de_pago', 'pendiente', ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.venta,
          IDS_DE_PRUEBA.cajaSesion,
          IDS_DE_PRUEBA.usuario,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA un tipo de medida y una unidad de peso inválidos', () => {
    sembrarCategoria(base);
    const insertar = (tipoMedida: string, unidad: string | null): void => {
      base
        .prepare(
          `INSERT INTO productos (
             id, nombre, categoria_id, tipo_medida, unidad_peso,
             cantidad_predefinida_icono, precio_base, inventario_disponible,
             contador_ventas, activo, creado_en, actualizado_en
           ) VALUES (?, ?, ?, ?, ?, '1.000', '2.50', '10.000', 0, 1, ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.producto,
          `P-${tipoMedida}-${unidad ?? 'sin'}`,
          IDS_DE_PRUEBA.categoria,
          tipoMedida,
          unidad,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    };

    expect(() => { insertar('volumen', 'lt'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertar('peso', 'quintal'); }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA una operación de sincronización que no existe', () => {
    expect(() => {
      base
        .prepare(
          `INSERT INTO sync_cola (id, entidad_tipo, entidad_id, operacion, payload, creado_en)
           VALUES (?, 'ventas', ?, 'fusionar', '{}', ?)`,
        )
        .run(IDS_DE_PRUEBA.generico, IDS_DE_PRUEBA.venta, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });
});

// ===========================================================================
describe('Las restricciones CHECK que cruzan varias columnas', () => {
  beforeEach(() => {
    sembrarCategoria(base);
  });

  const insertarProducto = (tipoMedida: string, unidad: string | null): void => {
    base
      .prepare(
        `INSERT INTO productos (
           id, nombre, categoria_id, tipo_medida, unidad_peso,
           cantidad_predefinida_icono, precio_base, inventario_disponible,
           contador_ventas, activo, creado_en, actualizado_en
         ) VALUES (?, 'Producto', ?, ?, ?, '1.000', '2.50', '10.000', 0, 1, ?, ?)`,
      )
      .run(
        IDS_DE_PRUEBA.producto,
        IDS_DE_PRUEBA.categoria,
        tipoMedida,
        unidad,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
      );
  };

  it('un producto vendido por peso DEBE tener unidad de peso', () => {
    expect(() => { insertarProducto('peso', null); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertarProducto('peso', 'lb'); }).not.toThrow();
  });

  it('un producto vendido por unidad NO puede tener unidad de peso', () => {
    expect(() => { insertarProducto('unidad', 'lb'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertarProducto('unidad', null); }).not.toThrow();
  });

  it('una caja cerrada sin cuadre completo se rechaza', () => {
    sembrarUsuario(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO caja_sesiones (
             id, usuario_id, monto_inicial, abierta_en, monto_esperado, cerrada_en,
             estado, creado_en, actualizado_en
           ) VALUES (?, ?, '500.00', ?, '900.00', ?, 'cerrada', ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.cajaSesion,
          IDS_DE_PRUEBA.usuario,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/CHECK constraint failed/);
  });

  it('una caja abierta no puede traer montos de cierre', () => {
    sembrarUsuario(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO caja_sesiones (
             id, usuario_id, monto_inicial, abierta_en, monto_real, estado, creado_en, actualizado_en
           ) VALUES (?, ?, '500.00', ?, '900.00', 'abierta', ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.cajaSesion,
          IDS_DE_PRUEBA.usuario,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/CHECK constraint failed/);
  });

  it('un descuento con tipo pero sin valor se rechaza', () => {
    sembrarUsuario(base);
    sembrarCajaSesion(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, descuento_tipo,
                               total, forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '10.00', 'porcentaje', '10.00', 'efectivo', 'completada', 'pendiente', ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.venta,
          IDS_DE_PRUEBA.cajaSesion,
          IDS_DE_PRUEBA.usuario,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/CHECK constraint failed/);
  });

  it('no puede haber autorización de descuento si no hay descuento', () => {
    sembrarUsuario(base);
    sembrarUsuario(base, IDS_DE_PRUEBA.usuarioAdmin, 'administrativo');
    sembrarCajaSesion(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal,
                               descuento_autorizado_por, total, forma_pago, estado,
                               estado_sincronizacion, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '10.00', ?, '10.00', 'efectivo', 'completada', 'pendiente', ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.venta,
          IDS_DE_PRUEBA.cajaSesion,
          IDS_DE_PRUEBA.usuario,
          FECHA_DE_PRUEBA,
          IDS_DE_PRUEBA.usuarioAdmin,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/CHECK constraint failed/);
  });

  it('un precio especial no puede terminar antes de empezar', () => {
    sembrarProducto(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO precios_especiales (
             id, producto_id, tipo, valor, vigente_desde, vigente_hasta, activo, creado_en, actualizado_en
           ) VALUES (?, ?, 'porcentaje', '10.00', '2026-09-05T12:00:00.000Z', '2026-01-01T12:00:00.000Z', 1, ?, ?)`,
        )
        .run(IDS_DE_PRUEBA.generico, IDS_DE_PRUEBA.producto, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });

  it('un id que no tiene forma de UUID se rechaza', () => {
    expect(() => {
      base
        .prepare(
          `INSERT INTO categorias (id, nombre, orden, creado_en, actualizado_en)
           VALUES ('7', 'Granos', 0, ?, ?)`,
        )
        .run(FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });

  it('una fecha que no es ISO-8601 UTC se rechaza', () => {
    expect(() => {
      base
        .prepare(
          `INSERT INTO categorias (id, nombre, orden, creado_en, actualizado_en)
           VALUES (?, 'Granos', 0, '05/09/2026', ?)`,
        )
        .run(IDS_DE_PRUEBA.categoria, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });
});

// ===========================================================================
describe('Las llaves foráneas se respetan', () => {
  it('las llaves foráneas están ACTIVAS (en SQLite vienen apagadas por defecto)', () => {
    expect(Number(base.pragma('foreign_keys', { simple: true }))).toBe(1);
  });

  it('un producto no puede apuntar a una categoría que no existe', () => {
    expect(() => { sembrarProducto(base, IDS_DE_PRUEBA.producto, IDS_DE_PRUEBA.generico); })
      .toThrow(/FOREIGN KEY constraint failed/);
  });

  it('una venta no puede apuntar a un usuario que no existe', () => {
    sembrarUsuario(base);
    sembrarCajaSesion(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total,
                               forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '10.00', '10.00', 'efectivo', 'completada', 'pendiente', ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.venta,
          IDS_DE_PRUEBA.cajaSesion,
          IDS_DE_PRUEBA.generico,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('no se puede borrar una categoría que tiene productos (RESTRICT)', () => {
    sembrarCategoria(base);
    sembrarProducto(base);
    expect(() => {
      base.prepare('DELETE FROM categorias WHERE id = ?').run(IDS_DE_PRUEBA.categoria);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('borrar una venta se lleva su detalle (CASCADE)', () => {
    sembrarUsuario(base);
    sembrarCategoria(base);
    sembrarProducto(base);
    sembrarCajaSesion(base);
    base
      .prepare(
        `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total,
                             forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, '10.00', '10.00', 'efectivo', 'completada', 'pendiente', ?, ?)`,
      )
      .run(
        IDS_DE_PRUEBA.venta,
        IDS_DE_PRUEBA.cajaSesion,
        IDS_DE_PRUEBA.usuario,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
      );
    base
      .prepare(
        `INSERT INTO venta_detalle (
           id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad,
           precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en
         ) VALUES (?, ?, ?, 'Maíz', 'lb', '1.500', '2.23', '3.345', '3.35', 0, ?)`,
      )
      .run(IDS_DE_PRUEBA.detalle, IDS_DE_PRUEBA.venta, IDS_DE_PRUEBA.producto, FECHA_DE_PRUEBA);

    base.prepare('DELETE FROM ventas WHERE id = ?').run(IDS_DE_PRUEBA.venta);

    const restantes = base
      .prepare('SELECT COUNT(*) AS total FROM venta_detalle')
      .get() as { total: number };
    expect(restantes.total).toBe(0);
  });
});

// ===========================================================================
describe('Las restricciones de unicidad', () => {
  it('no se repite el nombre de un usuario', () => {
    sembrarUsuario(base, IDS_DE_PRUEBA.usuario);
    expect(() => {
      base
        .prepare(
          `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, creado_en, actualizado_en)
           VALUES (?, ?, 'venta', 'hash', 1, ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.usuarioAdmin,
          `Usuario ${IDS_DE_PRUEBA.usuario.slice(0, 8)}`,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('un cajero no puede tener dos turnos de caja abiertos a la vez', () => {
    sembrarUsuario(base);
    sembrarCajaSesion(base, IDS_DE_PRUEBA.cajaSesion);
    expect(() => { sembrarCajaSesion(base, IDS_DE_PRUEBA.generico); })
      .toThrow(/UNIQUE constraint failed/);
  });

  it('no se repite el orden de línea dentro de una misma venta', () => {
    sembrarUsuario(base);
    sembrarCategoria(base);
    sembrarProducto(base);
    sembrarCajaSesion(base);
    base
      .prepare(
        `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total,
                             forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, '10.00', '10.00', 'efectivo', 'completada', 'pendiente', ?, ?)`,
      )
      .run(
        IDS_DE_PRUEBA.venta,
        IDS_DE_PRUEBA.cajaSesion,
        IDS_DE_PRUEBA.usuario,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
      );

    const insertarLinea = (id: string, orden: number): void => {
      base
        .prepare(
          `INSERT INTO venta_detalle (
             id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad,
             precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en
           ) VALUES (?, ?, ?, 'Maíz', 'lb', '1.500', '2.23', '3.345', '3.35', ?, ?)`,
        )
        .run(id, IDS_DE_PRUEBA.venta, IDS_DE_PRUEBA.producto, orden, FECHA_DE_PRUEBA);
    };

    insertarLinea(IDS_DE_PRUEBA.detalle, 0);
    expect(() => { insertarLinea(IDS_DE_PRUEBA.generico, 0); }).toThrow(/UNIQUE constraint failed/);
  });
});

// ===========================================================================
describe('La bitácora de auditoría es inmutable', () => {
  beforeEach(() => {
    sembrarUsuario(base);
    base
      .prepare(
        `INSERT INTO auditoria_log (id, usuario_id, accion, entidad_tipo, entidad_id, valor_nuevo, fecha)
         VALUES (?, ?, 'descuento_autorizado', 'ventas', ?, '{"porcentaje":"25.00"}', ?)`,
      )
      .run(IDS_DE_PRUEBA.generico, IDS_DE_PRUEBA.usuario, IDS_DE_PRUEBA.venta, FECHA_DE_PRUEBA);
  });

  it('no se puede modificar un asiento ya escrito', () => {
    expect(() => {
      base.prepare("UPDATE auditoria_log SET accion = 'otra_cosa' WHERE id = ?").run(IDS_DE_PRUEBA.generico);
    }).toThrow(/inmutable/);
  });

  it('no se puede borrar un asiento', () => {
    expect(() => {
      base.prepare('DELETE FROM auditoria_log WHERE id = ?').run(IDS_DE_PRUEBA.generico);
    }).toThrow(/inmutable/);
  });

  it('el asiento sigue ahí después de los dos intentos', () => {
    const fila = base
      .prepare('SELECT accion FROM auditoria_log WHERE id = ?')
      .get(IDS_DE_PRUEBA.generico) as { accion: string };
    expect(fila.accion).toBe('descuento_autorizado');
  });

  it('rechaza un valor que no es JSON válido', () => {
    expect(() => {
      base
        .prepare(
          `INSERT INTO auditoria_log (id, accion, entidad_tipo, valor_nuevo, fecha)
           VALUES (?, 'prueba', 'ventas', 'esto no es json', ?)`,
        )
        .run(IDS_DE_PRUEBA.usuario, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });
});

// ===========================================================================
describe('La cola de sincronización', () => {
  it('exige que el payload sea JSON válido', () => {
    expect(() => {
      base
        .prepare(
          `INSERT INTO sync_cola (id, entidad_tipo, entidad_id, operacion, payload, creado_en)
           VALUES (?, 'ventas', ?, 'insertar', 'no soy json', ?)`,
        )
        .run(IDS_DE_PRUEBA.generico, IDS_DE_PRUEBA.venta, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });

  it('acepta un payload JSON válido', () => {
    expect(() => {
      base
        .prepare(
          `INSERT INTO sync_cola (id, entidad_tipo, entidad_id, operacion, payload, creado_en)
           VALUES (?, 'ventas', ?, 'insertar', '{"total":"16.80"}', ?)`,
        )
        .run(IDS_DE_PRUEBA.generico, IDS_DE_PRUEBA.venta, FECHA_DE_PRUEBA);
    }).not.toThrow();
  });
});
