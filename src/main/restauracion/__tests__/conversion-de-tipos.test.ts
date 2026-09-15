/**
 * De Postgres a SQLite sin perder un centavo (§6.4).
 *
 * El caso que da nombre a este archivo es REAL: `subtotal_exacto` es
 * `numeric(18,6)` en la nube y volvió como `4.165000` donde SQLite había
 * guardado `4.165` (CLAUDE.md §4.25). Acá se comprueba que la normalización
 * lo devuelve a la forma canónica local, y que lo normalizado pasa el CHECK
 * de la base de verdad, no solo una expresión regular.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { COLUMNAS_EXCLUIDAS } from '@main/database/bandeja-de-salida';
import {
  crearBaseMigrada,
  FECHA_DE_PRUEBA,
  IDS_DE_PRUEBA,
  sembrarCajaSesion,
  sembrarCategoria,
  sembrarProducto,
  sembrarUsuario,
} from '@main/database/__tests__/ayuda-base-de-datos';
import {
  CLASES_DE_COLUMNA,
  columnasNumericasDe,
  convertirFila,
  convertirValor,
  ErrorDeConversion,
  nombreDeArchivoDe,
  normalizarFecha,
  normalizarNumerico,
  type ClaseDeColumna,
} from '../conversion-de-tipos';

let limpiar: (() => void) | null = null;
afterEach(() => {
  limpiar?.();
  limpiar = null;
});

// ===========================================================================
describe('NUMERIC de Postgres a TEXT canónico: se normaliza, nunca se redondea', () => {
  it('EL CASO MEDIDO EN LA FASE 3.b: subtotal_exacto vuelve con ceros de relleno y se normaliza', () => {
    expect(normalizarNumerico('venta_detalle', 'subtotal_exacto', '4.165000', 'exacto')).toBe('4.165');
    expect(normalizarNumerico('venta_detalle', 'subtotal_exacto', '17.500000', 'exacto')).toBe('17.5');
    expect(normalizarNumerico('venta_detalle', 'subtotal_exacto', '4.000000', 'exacto')).toBe('4');
  });

  it('y lo normalizado PASA EL CHECK DE LA BASE: se inserta una línea con 4.165 en un SQLite migrado', () => {
    const prueba = crearBaseMigrada();
    limpiar = prueba.limpiar;
    sembrarUsuario(prueba.base);
    sembrarCategoria(prueba.base);
    sembrarProducto(prueba.base);
    sembrarCajaSesion(prueba.base);
    prueba.base
      .prepare(
        `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total, forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, '4.17', '3.12', 'efectivo', 'completada', 'sincronizado', ?, ?)`,
      )
      .run(IDS_DE_PRUEBA.venta, IDS_DE_PRUEBA.cajaSesion, IDS_DE_PRUEBA.usuario, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);

    const exacto = normalizarNumerico('venta_detalle', 'subtotal_exacto', '4.165000', 'exacto');
    const cantidad = normalizarNumerico('venta_detalle', 'cantidad', '3.500', 'cantidad');
    const precio = normalizarNumerico('venta_detalle', 'precio_unitario_snap', '1.19', 'monto');
    expect(() =>
      prueba.base
        .prepare(
          `INSERT INTO venta_detalle (id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad, precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en)
           VALUES (?, ?, ?, 'Maíz', 'lb', ?, ?, ?, '3.12', 0, ?)`,
        )
        .run(IDS_DE_PRUEBA.detalle, IDS_DE_PRUEBA.venta, IDS_DE_PRUEBA.producto, cantidad, precio, exacto, FECHA_DE_PRUEBA),
    ).not.toThrow();

    // Y el texto de relleno SIN normalizar lo rechaza el CHECK: es lo que pasaría copiando tal cual.
    expect(() =>
      prueba.base
        .prepare(
          `INSERT INTO venta_detalle (id, venta_id, producto_id, producto_nombre_snap, unidad_snap, cantidad, precio_unitario_snap, subtotal_exacto, subtotal_impreso, orden_linea, creado_en)
           VALUES (?, ?, ?, 'Maíz', 'lb', '3.500', '1.19', '17.500000', '3.12', 1, ?)`,
        )
        .run(IDS_DE_PRUEBA.generico, IDS_DE_PRUEBA.venta, IDS_DE_PRUEBA.producto, FECHA_DE_PRUEBA),
    ).not.toThrow();
    // (Diez decimales caben en el CHECK de subtotal_exacto, así que el relleno
    // de seis pasa; lo que NO pasaría es un monto de dos decimales con relleno.)
    expect(() =>
      prueba.base
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total, forma_pago, estado, estado_sincronizacion, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '4.170', '3.12', 'efectivo', 'completada', 'sincronizado', ?, ?)`,
        )
        .run(IDS_DE_PRUEBA.generico, IDS_DE_PRUEBA.cajaSesion, IDS_DE_PRUEBA.usuario, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA),
    ).toThrow(/CHECK/);
  });

  it('un monto de dos decimales queda igual; una cantidad de tres, también', () => {
    expect(normalizarNumerico('ventas', 'total', '3.12', 'monto')).toBe('3.12');
    expect(normalizarNumerico('ventas', 'total', '0.00', 'monto')).toBe('0.00');
    expect(normalizarNumerico('productos', 'inventario_disponible', '96.500', 'cantidad')).toBe('96.500');
    expect(normalizarNumerico('ventas', 'total', '-10.00', 'monto')).toBe('-10.00');
  });

  it('MÁS decimales de los que la columna admite se RECHAZAN: normalizar no es redondear', () => {
    expect(() => normalizarNumerico('ventas', 'total', '3.125', 'monto')).toThrow(/normalizar sería redondear/);
    expect(() => normalizarNumerico('venta_detalle', 'cantidad', '3.5001', 'cantidad')).toThrow(ErrorDeConversion);
    expect(() => normalizarNumerico('venta_detalle', 'subtotal_exacto', '0.00000000001', 'exacto')).toThrow(/11 decimales/);
  });

  it('diez decimales en un exacto sí caben', () => {
    expect(normalizarNumerico('venta_detalle', 'subtotal_exacto', '0.0000000001', 'exacto')).toBe('0.0000000001');
  });

  it('un NÚMERO en vez de texto se rechaza con el motivo: el cliente tiene que pedir ::text', () => {
    expect(() => normalizarNumerico('ventas', 'total', 3.12, 'monto')).toThrow(/::text/);
  });

  it('un texto que no es un número se rechaza', () => {
    expect(() => normalizarNumerico('ventas', 'total', '3,12', 'monto')).toThrow(/no tiene forma de número/);
    expect(() => normalizarNumerico('ventas', 'total', '1e5', 'monto')).toThrow(ErrorDeConversion);
  });

  it('el error dice tabla, columna y valor, para poder localizar el dato', () => {
    try {
      normalizarNumerico('ventas', 'total', '3.125', 'monto');
      expect.fail('tenía que lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeConversion);
      const conversion = error as ErrorDeConversion;
      expect(conversion.tabla).toBe('ventas');
      expect(conversion.columna).toBe('total');
      expect(conversion.valorRecibido).toBe('3.125');
      expect(conversion.message).toMatch(/^ventas\.total: /);
    }
  });
});

// ===========================================================================
describe('timestamptz de PostgREST a ISO con Z, sin perder precisión', () => {
  it('«+00:00» pasa a «Z» con los milisegundos, byte a byte como lo escribió la terminal', () => {
    expect(normalizarFecha('ventas', 'fecha', '2026-09-11T19:09:34.701+00:00')).toBe('2026-09-11T19:09:34.701Z');
  });

  it('sin decimales se agregan los tres ceros, que es lo que toISOString siempre escribe', () => {
    expect(normalizarFecha('ventas', 'fecha', '2026-09-11T14:00:00+00:00')).toBe('2026-09-11T14:00:00.000Z');
  });

  it('decimales recortados por Postgres (.98) vuelven a tres (.980)', () => {
    expect(normalizarFecha('ventas', 'fecha', '2026-09-13T23:33:59.98+00:00')).toBe('2026-09-13T23:33:59.980Z');
  });

  it('otra zona horaria se convierte a UTC', () => {
    expect(normalizarFecha('ventas', 'fecha', '2026-09-13T17:00:00-06:00')).toBe('2026-09-13T23:00:00.000Z');
  });

  it('una Z ya puesta se acepta tal cual', () => {
    expect(normalizarFecha('ventas', 'fecha', '2026-09-13T23:33:59.986Z')).toBe('2026-09-13T23:33:59.986Z');
  });

  it('MÁS de tres decimales de segundo se CONSERVAN enteros: los escribe now() de Postgres por SQL (la fila de configuracion_negocio que siembra la 0016), y truncar sería perder', () => {
    // El valor con que la 0016 dejó la fila del proyecto REAL, leído el 2026-09-14: cinco decimales.
    expect(normalizarFecha('configuracion_negocio', 'actualizado_en', '2026-09-11T14:58:55.89473+00:00')).toBe('2026-09-11T14:58:55.89473Z');
    // Y el de seis con que la restauración por la ventana se detuvo ese día, antes de esta corrección.
    expect(normalizarFecha('configuracion_negocio', 'actualizado_en', '2026-09-14T12:05:15.313623+00:00')).toBe('2026-09-14T12:05:15.313623Z');
    // Con otra zona, la hora pasa a UTC y los decimales se conservan igual.
    expect(normalizarFecha('configuracion_negocio', 'actualizado_en', '2026-09-14T06:05:15.313623-06:00')).toBe('2026-09-14T12:05:15.313623Z');
  });

  it('y esos microsegundos PASAN el CHECK de fecha de la base: la fila única de configuracion_negocio los guarda tal cual', () => {
    const prueba = crearBaseMigrada();
    limpiar = prueba.limpiar;
    const fecha = normalizarFecha('configuracion_negocio', 'actualizado_en', '2026-09-14T12:05:15.313623+00:00');
    expect(() => prueba.base.prepare(`UPDATE configuracion_negocio SET actualizado_en = ? WHERE id = 'unica'`).run(fecha)).not.toThrow();
    const guardada = prueba.base.prepare(`SELECT actualizado_en FROM configuracion_negocio WHERE id = 'unica'`).get() as { actualizado_en: string };
    expect(guardada.actualizado_en).toBe('2026-09-14T12:05:15.313623Z');
  });

  it('lo que no es una fecha ISO con zona se rechaza', () => {
    expect(() => normalizarFecha('ventas', 'fecha', '2026-09-13 23:33:59+00')).toThrow(/no es una fecha ISO-8601/);
    expect(() => normalizarFecha('ventas', 'fecha', 'ayer')).toThrow(ErrorDeConversion);
    expect(() => normalizarFecha('ventas', 'fecha', 1_757_800_000_000)).toThrow(/tiene que ser texto/);
  });

  it('y lo normalizado PASA el CHECK de fecha de la base', () => {
    const prueba = crearBaseMigrada();
    limpiar = prueba.limpiar;
    const fecha = normalizarFecha('usuarios', 'creado_en', '2026-09-11T19:09:34.701+00:00');
    expect(() =>
      prueba.base
        .prepare(`INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, creado_en, actualizado_en) VALUES (?, 'Ana', 'venta', 'sin-pin', 1, ?, ?)`)
        .run(IDS_DE_PRUEBA.usuario, fecha, fecha),
    ).not.toThrow();
  });
});

// ===========================================================================
describe('Booleanos, enteros, JSON y texto', () => {
  it('true y false pasan a 1 y 0; cualquier otra cosa se rechaza', () => {
    expect(convertirValor('usuarios', 'activo', true, 'booleana')).toBe(1);
    expect(convertirValor('usuarios', 'activo', false, 'booleana')).toBe(0);
    expect(() => convertirValor('usuarios', 'activo', 'true', 'booleana')).toThrow(/no es un booleano/);
    expect(() => convertirValor('usuarios', 'activo', 1, 'booleana')).toThrow(ErrorDeConversion);
  });

  it('un entero pasa tal cual; un decimal o un texto en una columna entera se rechaza', () => {
    expect(convertirValor('recibos', 'numero_recibo', 7, 'entero')).toBe(7);
    expect(() => convertirValor('recibos', 'numero_recibo', 7.5, 'entero')).toThrow(/no es un entero/);
    expect(() => convertirValor('recibos', 'numero_recibo', '7', 'entero')).toThrow(ErrorDeConversion);
  });

  it('jsonb vuelve parseado y se guarda como TEXTO JSON, que es lo que exige json_valid', () => {
    expect(convertirValor('auditoria_log', 'valor_nuevo', { rol: 'venta', activo: true }, 'json')).toBe('{"rol":"venta","activo":true}');
    expect(convertirValor('auditoria_log', 'valor_nuevo', 'un texto', 'json')).toBe('"un texto"');
  });

  it('null se conserva como null en cualquier clase', () => {
    for (const clase of ['texto', 'entero', 'booleana', 'fecha', 'json', 'monto', 'cantidad', 'exacto'] as const) {
      expect(convertirValor('x', 'y', null, clase)).toBeNull();
    }
  });

  it('un texto tiene que ser texto', () => {
    expect(convertirValor('usuarios', 'nombre', 'Jimmy', 'texto')).toBe('Jimmy');
    expect(() => convertirValor('usuarios', 'nombre', 5, 'texto')).toThrow(/tiene que ser texto/);
  });
});

// ===========================================================================
describe('convertirFila: la fila entera, y nada más que la fila', () => {
  const filaDeUsuario = {
    id: '11111111-1111-4111-8111-111111111111',
    nombre: 'Jimmy',
    rol: 'administrativo',
    activo: true,
    creado_en: '2026-09-11T14:00:00+00:00',
    actualizado_en: '2026-09-11T14:00:00.5+00:00',
    recibido_en: '2026-09-13T23:33:59.986686+00:00',
  };

  it('convierte cada columna según su clase y deja recibido_en afuera', () => {
    expect(convertirFila('usuarios', filaDeUsuario)).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      nombre: 'Jimmy',
      rol: 'administrativo',
      activo: 1,
      creado_en: '2026-09-11T14:00:00.000Z',
      actualizado_en: '2026-09-11T14:00:00.500Z',
    });
  });

  it('una columna que la nube NO trajo se rechaza: undefined no es null', () => {
    const { nombre: _nombre, ...sinNombre } = filaDeUsuario;
    expect(() => convertirFila('usuarios', sinNombre)).toThrow(/usuarios\.nombre: la nube no trajo esta columna/);
  });

  it('una columna que este módulo NO conoce se rechaza: es deriva que la precondición debió atrapar', () => {
    expect(() => convertirFila('usuarios', { ...filaDeUsuario, propina: 1 })).toThrow(/usuarios\.propina: la nube trajo una columna que este módulo no conoce/);
  });

  it('una tabla desconocida se rechaza', () => {
    expect(() => convertirFila('sync_cola', {})).toThrow(/no está en la lista de tablas restaurables/);
  });
});

// ===========================================================================
describe('El nombre de archivo de una ruta, venga de Windows o de Unix', () => {
  it('parte una ruta de Windows aunque se corra en macOS', () => {
    expect(nombreDeArchivoDe('C:\\Users\\Jimmy\\AppData\\Roaming\\pos-agricola\\recibos\\recibo-000001-2026-09-11T19-09-34-701Z.pdf')).toBe(
      'recibo-000001-2026-09-11T19-09-34-701Z.pdf',
    );
  });

  it('parte una ruta de Unix y una relativa', () => {
    expect(nombreDeArchivoDe('/Users/julio/Library/Application Support/pos-agricola/recibos/recibo-000002-x.pdf')).toBe('recibo-000002-x.pdf');
    expect(nombreDeArchivoDe('fotos-de-productos/5ea12297-1234.jpg')).toBe('5ea12297-1234.jpg');
  });

  it('un nombre pelado queda igual', () => {
    expect(nombreDeArchivoDe('foto.png')).toBe('foto.png');
  });
});

// ===========================================================================
// La tabla CLASES_DE_COLUMNA contra la FOTO de la nube: completa y sin
// inventos. Es lo que hace que la tabla explícita no pueda derivar del
// esquema real sin que una prueba lo diga con nombre.
// ===========================================================================
const esquemaDeFoto = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../supabase/esquema-nube.json', import.meta.url)), 'utf8'),
) as { tablas: Record<string, { nombre: string; tipo: string }[]> };

/** Qué clase le corresponde a cada tipo de Postgres del contrato. */
function claseEsperadaPara(tipo: string): ClaseDeColumna {
  switch (tipo) {
    case 'uuid':
    case 'text':
      return 'texto';
    case 'integer':
    case 'bigint':
      return 'entero';
    case 'boolean':
      return 'booleana';
    case 'timestamp with time zone':
      return 'fecha';
    case 'jsonb':
      return 'json';
    case 'numeric(14,2)':
      return 'monto';
    case 'numeric(14,3)':
      return 'cantidad';
    case 'numeric(18,6)':
      return 'exacto';
    default:
      throw new Error(`tipo de la nube sin clase asignada: ${tipo}`);
  }
}

describe('CLASES_DE_COLUMNA coincide, columna por columna, con los tipos que declara la nube', () => {
  for (const [tabla, columnas] of Object.entries(esquemaDeFoto.tablas)) {
    it(`${tabla}: cada columna de la nube (menos recibido_en) tiene su clase, y la clase corresponde al tipo`, () => {
      const clases = CLASES_DE_COLUMNA[tabla];
      expect(clases, `${tabla} no está en CLASES_DE_COLUMNA`).toBeDefined();
      for (const columna of columnas) {
        if (columna.nombre === 'recibido_en') {
          continue;
        }
        expect(clases?.[columna.nombre], `${tabla}.${columna.nombre} no tiene clase`).toBe(claseEsperadaPara(columna.tipo));
      }
    });

    it(`${tabla}: la tabla no inventa columnas que la nube no tiene`, () => {
      const enLaNube = new Set(columnas.map((c) => c.nombre));
      for (const columna of Object.keys(CLASES_DE_COLUMNA[tabla] ?? {})) {
        expect(enLaNube.has(columna), `${tabla}.${columna} está en CLASES_DE_COLUMNA y no en la nube`).toBe(true);
      }
    });
  }

  it('no hay ninguna tabla de más en CLASES_DE_COLUMNA', () => {
    expect(Object.keys(CLASES_DE_COLUMNA).sort()).toEqual(Object.keys(esquemaDeFoto.tablas).sort());
  });

  it('las columnas que NO viajan (hashes, intentos, estado_sincronizacion) tampoco están en la tabla', () => {
    for (const [tabla, columnas] of Object.entries(COLUMNAS_EXCLUIDAS)) {
      for (const columna of columnas) {
        expect(CLASES_DE_COLUMNA[tabla]?.[columna]).toBeUndefined();
      }
    }
  });

  it('las columnas numéricas de venta_detalle son las cinco que hay que pedir con ::text (la quinta, la foto del costo de la 032)', () => {
    expect(columnasNumericasDe('venta_detalle')).toEqual([
      'cantidad',
      'precio_unitario_snap',
      'costo_unitario_snap',
      'subtotal_exacto',
      'subtotal_impreso',
    ]);
    expect(columnasNumericasDe('usuarios')).toEqual([]);
  });
});
