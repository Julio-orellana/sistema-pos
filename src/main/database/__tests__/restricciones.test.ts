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

  // NOTA: aquí ya no se prueba que un monto negativo sea aceptado, porque
  // precio_base pasó a tener piso 0. Que el FORMATO admite el signo negativo se
  // prueba en el bloque "Campos que SÍ admiten negativos, a propósito, para
  // devoluciones", sobre los campos donde el negocio sí lo permite.

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
describe('Pisos de no negatividad: qué NO puede ser negativo', () => {
  beforeEach(() => {
    sembrarCategoria(base);
  });

  /** Inserta un producto variando una sola columna decimal. */
  function insertarProductoCon(columna: string, valor: string): void {
    const valores: Record<string, string> = {
      cantidad_predefinida_icono: '1.000',
      precio_base: '2.50',
      inventario_disponible: '10.000',
    };
    valores[columna] = valor;
    base
      .prepare(
        `INSERT INTO productos (
           id, nombre, categoria_id, tipo_medida, unidad_peso,
           cantidad_predefinida_icono, precio_base, inventario_disponible,
           contador_ventas, activo, creado_en, actualizado_en
         ) VALUES (?, ?, ?, 'peso', 'lb', ?, ?, ?, 0, 1, ?, ?)`,
      )
      .run(
        IDS_DE_PRUEBA.producto,
        `Producto ${columna} ${valor}`,
        IDS_DE_PRUEBA.categoria,
        valores.cantidad_predefinida_icono,
        valores.precio_base,
        valores.inventario_disponible,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
      );
  }

  it('EL INVENTARIO NUNCA PUEDE SER NEGATIVO: su piso explícito es 0', () => {
    expect(() => { insertarProductoCon('inventario_disponible', '-0.001'); })
      .toThrow(/productos_inventario_no_negativo/);
    expect(() => { insertarProductoCon('inventario_disponible', '-50.000'); })
      .toThrow(/productos_inventario_no_negativo/);
  });

  it('el inventario SÍ puede ser exactamente 0: es el piso, no un valor prohibido', () => {
    expect(() => { insertarProductoCon('inventario_disponible', '0.000'); }).not.toThrow();
  });

  it('la restricción del inventario tiene NOMBRE, para poder traducir el error', () => {
    // Sin nombre, SQLite diría apenas "CHECK constraint failed: productos" y
    // sería imposible distinguir un stock agotado de un precio mal formateado.
    try {
      insertarProductoCon('inventario_disponible', '-1.000');
      expect.unreachable('Se esperaba que el inventario negativo fuera rechazado.');
    } catch (error) {
      expect((error as Error).message).toBe(
        'CHECK constraint failed: productos_inventario_no_negativo',
      );
    }
  });

  it('DEJA CONSTANCIA de por qué el piso NO se escribe como ">= 0" en SQLite', () => {
    // En SQLite el orden entre tipos es NULL < numéricos < TEXT, así que
    // cualquier texto resulta mayor que cualquier número. Un CHECK escrito como
    // `inventario_disponible >= 0` habría aceptado '-5.000' sin chistar.
    const comparacion = base.prepare("SELECT ('-5.000' >= 0) AS resultado").get() as {
      resultado: number;
    };
    expect(comparacion.resultado).toBe(1);

    // La forma que sí funciona, y que es la que usa el esquema:
    const conGlob = base.prepare("SELECT (NOT '-5.000' GLOB '-*') AS resultado").get() as {
      resultado: number;
    };
    expect(conGlob.resultado).toBe(0);
  });

  it('un precio no puede ser negativo, pero sí puede ser 0', () => {
    expect(() => { insertarProductoCon('precio_base', '-2.50'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertarProductoCon('precio_base', '0.00'); }).not.toThrow();
  });

  it('la cantidad predefinida del ícono debe ser ESTRICTAMENTE mayor que 0', () => {
    // Un ícono que agrega cero unidades al carrito es un botón que no hace nada.
    expect(() => { insertarProductoCon('cantidad_predefinida_icono', '0.000'); })
      .toThrow(/CHECK constraint failed/);
    expect(() => { insertarProductoCon('cantidad_predefinida_icono', '-1.000'); })
      .toThrow(/CHECK constraint failed/);
    expect(() => { insertarProductoCon('cantidad_predefinida_icono', '0.500'); }).not.toThrow();
  });

  it('el valor de un precio especial no puede ser negativo', () => {
    sembrarProducto(base);
    const insertar = (valor: string): void => {
      base
        .prepare(
          `INSERT INTO precios_especiales (
             id, producto_id, tipo, valor, vigente_desde, activo, creado_en, actualizado_en
           ) VALUES (?, ?, 'porcentaje', ?, ?, 1, ?, ?)`,
        )
        .run(
          IDS_DE_PRUEBA.generico,
          IDS_DE_PRUEBA.producto,
          valor,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
          FECHA_DE_PRUEBA,
        );
    };

    // Un descuento negativo sería un recargo encubierto.
    expect(() => { insertar('-10.00'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertar('10.00'); }).not.toThrow();
  });

  it('los topes de descuento no pueden ser negativos, y 0 es significativo', () => {
    const insertar = (porcentaje: string, monto: string): void => {
      base
        .prepare(
          `INSERT INTO limites_descuento (
             id, rol, descuento_max_porcentaje, descuento_max_monto_fijo, creado_en, actualizado_en
           ) VALUES (?, 'venta', ?, ?, ?, ?)`,
        )
        .run(IDS_DE_PRUEBA.generico, porcentaje, monto, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
    };

    expect(() => { insertar('-10.00', '50.00'); }).toThrow(/CHECK constraint failed/);
    expect(() => { insertar('10.00', '-50.00'); }).toThrow(/CHECK constraint failed/);
    // 0 quiere decir "este rol no puede dar ningún descuento".
    expect(() => { insertar('0.00', '0.00'); }).not.toThrow();
  });

  it('el fondo inicial y el efectivo contado de la caja no pueden ser negativos', () => {
    sembrarUsuario(base);
    expect(() => {
      base
        .prepare(
          `INSERT INTO caja_sesiones (id, usuario_id, monto_inicial, abierta_en, estado, creado_en, actualizado_en)
           VALUES (?, ?, '-500.00', ?, 'abierta', ?, ?)`,
        )
        .run(IDS_DE_PRUEBA.cajaSesion, IDS_DE_PRUEBA.usuario, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
    }).toThrow(/CHECK constraint failed/);
  });
});

// ===========================================================================
describe('Campos que SÍ admiten negativos, a propósito, para devoluciones', () => {
  // Estas pruebas existen para que ninguna sesión futura "corrija" por error
  // estos campos agregándoles un piso de 0. El módulo de devoluciones los va a
  // necesitar en negativo.

  beforeEach(() => {
    sembrarUsuario(base);
    sembrarCategoria(base);
    sembrarProducto(base);
    sembrarCajaSesion(base);
  });

  /** Inserta una venta variando los importes. */
  function insertarVenta(subtotal: string, total: string, descuentoValor: string | null): void {
    base
      .prepare(
        `INSERT INTO ventas (
           id, caja_sesion_id, usuario_id, fecha, subtotal, descuento_tipo, descuento_valor,
           total, forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'efectivo', 'completada', 'pendiente', ?, ?)`,
      )
      .run(
        IDS_DE_PRUEBA.venta,
        IDS_DE_PRUEBA.cajaSesion,
        IDS_DE_PRUEBA.usuario,
        FECHA_DE_PRUEBA,
        subtotal,
        descuentoValor === null ? null : 'monto_fijo',
        descuentoValor,
        total,
        FECHA_DE_PRUEBA,
        FECHA_DE_PRUEBA,
      );
  }

  it('ventas.subtotal y ventas.total aceptan negativos', () => {
    expect(() => { insertarVenta('-16.80', '-16.80', null); }).not.toThrow();
  });

  it('ventas.descuento_valor acepta negativos', () => {
    expect(() => { insertarVenta('-16.80', '-15.00', '-1.80'); }).not.toThrow();
  });

  it('venta_detalle acepta cantidad, subtotal exacto e impreso negativos', () => {
    insertarVenta('-3.35', '-3.35', null);
    expect(() => {
      base
        .prepare(
          `INSERT INTO venta_detalle (
             id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad,
             precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en
           ) VALUES (?, ?, ?, 'Maíz', 'lb', '-1.500', '2.23', '-3.345', '-3.35', 0, ?)`,
        )
        .run(IDS_DE_PRUEBA.detalle, IDS_DE_PRUEBA.venta, IDS_DE_PRUEBA.producto, FECHA_DE_PRUEBA);
    }).not.toThrow();
  });

  it('caja_sesiones.diferencia acepta negativos: un faltante de caja ES negativo', () => {
    // Va con autorizante y vía porque desde la migración 008 un cierre
    // descuadrado sin autorizar lo rechaza la base. Lo que se prueba aquí es
    // el SIGNO, no el permiso: sin la autorización, esta prueba se caería por
    // la restricción equivocada y dejaría de decir lo que dice su nombre.
    expect(() => {
      base
        .prepare(
          `UPDATE caja_sesiones
              SET estado = 'cerrada', monto_esperado = '1000.00', monto_real = '950.00',
                  diferencia = '-50.00', cerrada_en = ?,
                  diferencia_autorizada_por = ?, diferencia_autorizada_via = 'presencial'
            WHERE id = ?`,
        )
        .run(FECHA_DE_PRUEBA, IDS_DE_PRUEBA.usuario, IDS_DE_PRUEBA.cajaSesion);
    }).not.toThrow();

    const fila = base
      .prepare('SELECT diferencia FROM caja_sesiones WHERE id = ?')
      .get(IDS_DE_PRUEBA.cajaSesion) as { diferencia: string };
    expect(fila.diferencia).toBe('-50.00');
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

// ===========================================================================
/**
 * El permiso para cerrar descuadrado tiene que seguir al descuadre.
 *
 * La migración 007 amarró las dos columnas de autorización entre sí; la 008
 * las amarra al valor de `diferencia`, que es lo que las justifica. Hasta la
 * 008 esta regla vivía SOLO en el servicio de caja: una consulta SQL a mano o
 * un respaldo restaurado a medias podían dejar un cierre descuadrado sin
 * autorizante, que es justo el agujero que el flujo de PIN existe para tapar.
 *
 * Estas pruebas también son el seguro de la vía que usa la migración 008.
 * `ALTER TABLE ... ADD CONSTRAINT` no está en la gramática documentada de
 * SQLite, aunque la versión que empaqueta better-sqlite3 lo acepta y lo
 * aplica. Si una versión futura dejara de hacerlo, estas pruebas se caen en
 * desarrollo —la base se reconstruye desde cero en cada una— en vez de fallar
 * al primer arranque en la máquina de Jimmy.
 */
describe('La autorización de un descuadre solo existe si hay descuadre', () => {
  /** Cierra la sesión sembrada con la diferencia y la autorización dadas. */
  function cerrarCon(
    diferencia: string,
    autorizadaPor: string | null,
    autorizadaVia: string | null,
  ): void {
    base
      .prepare(
        `UPDATE caja_sesiones
            SET estado = 'cerrada', cerrada_en = ?, monto_esperado = '500.00',
                monto_real = ?, diferencia = ?,
                diferencia_autorizada_por = ?, diferencia_autorizada_via = ?
          WHERE id = ?`,
      )
      .run(
        FECHA_DE_PRUEBA,
        diferencia === '0.00' ? '500.00' : '480.00',
        diferencia,
        autorizadaPor,
        autorizadaVia,
        IDS_DE_PRUEBA.cajaSesion,
      );
  }

  beforeEach(() => {
    sembrarUsuario(base);
    sembrarUsuario(base, IDS_DE_PRUEBA.usuarioAdmin, 'administrativo');
    sembrarCajaSesion(base);
  });

  it('la restricción existe en el esquema y no creó ninguna columna fantasma', () => {
    const esquema = base
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'caja_sesiones'")
      .get() as { sql: string };
    expect(esquema.sql).toContain('caja_sesiones_autorizacion_solo_con_diferencia');

    const columnas = base
      .prepare("SELECT name FROM pragma_table_info('caja_sesiones')")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(columnas).not.toContain('CONSTRAINT');
    expect(columnas).toContain('diferencia_autorizada_por');
    expect(columnas).toContain('diferencia_autorizada_via');
  });

  it('acepta un cierre que cuadra, sin autorizante', () => {
    expect(() => {
      cerrarCon('0.00', null, null);
    }).not.toThrow();
  });

  it('acepta un cierre descuadrado con autorizante y vía', () => {
    expect(() => {
      cerrarCon('-20.00', IDS_DE_PRUEBA.usuarioAdmin, 'presencial');
    }).not.toThrow();
  });

  it('RECHAZA un cierre descuadrado sin autorizante', () => {
    expect(() => {
      cerrarCon('-20.00', null, null);
    }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA un sobrante sin autorizante, igual que un faltante', () => {
    expect(() => {
      cerrarCon('35.50', null, null);
    }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA una autorización anotada en un cierre que cuadra', () => {
    expect(() => {
      cerrarCon('0.00', IDS_DE_PRUEBA.usuarioAdmin, 'remoto');
    }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA quitarle después la autorización a un cierre descuadrado', () => {
    cerrarCon('-20.00', IDS_DE_PRUEBA.usuarioAdmin, 'presencial');
    expect(() => {
      base
        .prepare(
          `UPDATE caja_sesiones
              SET diferencia_autorizada_por = NULL, diferencia_autorizada_via = NULL
            WHERE id = ?`,
        )
        .run(IDS_DE_PRUEBA.cajaSesion);
    }).toThrow(/CHECK constraint failed/);
  });

  it('RECHAZA volver descuadrado un cierre ya autorizado como cuadrado', () => {
    cerrarCon('0.00', null, null);
    expect(() => {
      base
        .prepare("UPDATE caja_sesiones SET diferencia = '-20.00' WHERE id = ?")
        .run(IDS_DE_PRUEBA.cajaSesion);
    }).toThrow(/CHECK constraint failed/);
  });

  it('un turno abierto, sin diferencia todavía, no puede llevar autorizante', () => {
    expect(() => {
      base
        .prepare(
          `UPDATE caja_sesiones SET diferencia_autorizada_por = ?, diferencia_autorizada_via = 'remoto'
            WHERE id = ?`,
        )
        .run(IDS_DE_PRUEBA.usuarioAdmin, IDS_DE_PRUEBA.cajaSesion);
    }).toThrow(/CHECK constraint failed/);
  });

  it('trata el cero con signo ("-0.00") como caja cuadrada, no como descuadre', () => {
    expect(() => {
      cerrarCon('-0.00', null, null);
    }).not.toThrow();
  });
});
