/**
 * La precondición de deriva de la restauración (§6.2): el contrato que declara
 * la nube contra el esquema local, con nombre, antes de bajar una fila.
 *
 * Se falsifica con los mismos casos de §9.3 del diseño que ya muerden en la
 * mitad A y en `verify:nube`: quitar `ventas.total`, agregar `ventas.propina`,
 * subir el contrato, poner una función como INVOKER.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import {
  diferenciasEntreContratoYEsquemaLocal,
  esquemaDelContrato,
  type ColumnaLocal,
  type ContratoDeLaNube,
} from '../deriva-de-esquema';

const RUTA_DE_LA_FOTO = fileURLToPath(new URL('../../../../supabase/esquema-nube.json', import.meta.url));

/** La foto es exactamente lo que `contrato_de_sincronizacion()` devuelve. */
function contratoDeLaFoto(): ContratoDeLaNube {
  return esquemaDelContrato.parse(JSON.parse(readFileSync(RUTA_DE_LA_FOTO, 'utf8')));
}

let limpiar: (() => void) | null = null;
let columnasLocales: ((tabla: string) => ColumnaLocal[] | null) | null = null;

function conBaseMigrada(): (tabla: string) => ColumnaLocal[] | null {
  if (columnasLocales !== null) {
    return columnasLocales;
  }
  const prueba = crearBaseMigrada();
  limpiar = prueba.limpiar;
  columnasLocales = (tabla): ColumnaLocal[] | null => {
    const filas = prueba.base.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string; notnull: number }[];
    return filas.length === 0 ? null : filas.map((f) => ({ nombre: f.name, nulable: f.notnull === 0 }));
  };
  return columnasLocales;
}

afterEach(() => {
  limpiar?.();
  limpiar = null;
  columnasLocales = null;
});

describe('Con el contrato tal como lo declara la nube hoy', () => {
  it('no hay ninguna diferencia con el esquema local: se puede restaurar', () => {
    expect(diferenciasEntreContratoYEsquemaLocal(contratoDeLaFoto(), conBaseMigrada())).toEqual([]);
  });
});

describe('La precondición MUERDE, con los casos de §9.3', () => {
  it('quitar ventas.total de la nube se nombra', () => {
    const contrato = contratoDeLaFoto();
    contrato.tablas.ventas = (contrato.tablas.ventas ?? []).filter((c) => c.nombre !== 'total');
    expect(diferenciasEntreContratoYEsquemaLocal(contrato, conBaseMigrada())).toEqual([
      'ventas.total existe en SQLite y no en la nube',
    ]);
  });

  it('agregar ventas.propina en la nube se nombra', () => {
    const contrato = contratoDeLaFoto();
    contrato.tablas.ventas = [...(contrato.tablas.ventas ?? []), { nombre: 'propina', tipo: 'numeric(14,2)', nulable: true }];
    expect(diferenciasEntreContratoYEsquemaLocal(contrato, conBaseMigrada())).toEqual([
      'ventas.propina existe en la nube y no en SQLite',
    ]);
  });

  it('otra versión de contrato se nombra con los dos números', () => {
    const contrato = { ...contratoDeLaFoto(), version_del_contrato: 2 };
    expect(diferenciasEntreContratoYEsquemaLocal(contrato, conBaseMigrada())).toEqual([
      'la nube declara el contrato 2 y esta terminal usa el 1',
    ]);
  });

  it('una función de escritura que dejó de ser DEFINER se nombra', () => {
    const contrato = contratoDeLaFoto();
    const venta = contrato.funciones.sincronizar_venta;
    if (venta === undefined) {
      throw new Error('la foto no tiene sincronizar_venta');
    }
    contrato.funciones.sincronizar_venta = { ...venta, security_definer: false };
    expect(diferenciasEntreContratoYEsquemaLocal(contrato, conBaseMigrada())).toEqual([
      'la función sincronizar_venta cambió: tiene que ser SECURITY DEFINER con search_path vacío',
    ]);
  });

  it('una nulabilidad distinta se nombra en las dos direcciones', () => {
    const contrato = contratoDeLaFoto();
    contrato.tablas.ventas = (contrato.tablas.ventas ?? []).map((c) => (c.nombre === 'num_boleta' ? { ...c, nulable: false } : c));
    expect(diferenciasEntreContratoYEsquemaLocal(contrato, conBaseMigrada())).toEqual([
      'ventas.num_boleta es NOT NULL en la nube y nulable en SQLite',
    ]);
  });

  it('sin recibido_en en una tabla no hay detección de anomalías, y se dice', () => {
    const contrato = contratoDeLaFoto();
    contrato.tablas.recibos = (contrato.tablas.recibos ?? []).filter((c) => c.nombre !== 'recibido_en');
    expect(diferenciasEntreContratoYEsquemaLocal(contrato, conBaseMigrada())).toEqual([
      'recibos.recibido_en tiene que existir en la nube y ser NOT NULL: sin ella no hay detección de anomalías',
    ]);
  });

  it('sin la función de la suma por mes (migración 0029) se dice qué falta aplicar', () => {
    const contrato = contratoDeLaFoto();
    const { restauracion_ventas_por_mes: _sinLaFuncion, ...resto } = contrato.funciones;
    expect(diferenciasEntreContratoYEsquemaLocal({ ...contrato, funciones: resto }, conBaseMigrada())).toEqual([
      'la función restauracion_ventas_por_mes no existe en la nube: falta aplicar la migración que la crea',
    ]);
  });

  it('una tabla que falta de un lado se nombra', () => {
    const contrato = contratoDeLaFoto();
    const { recibos: _sinRecibos, ...tablas } = contrato.tablas;
    expect(diferenciasEntreContratoYEsquemaLocal({ ...contrato, tablas }, conBaseMigrada())).toEqual([
      'la tabla recibos no existe en la nube',
    ]);
  });

  it('las columnas que NO viajan (hashes de PIN, intentos, estado_sincronizacion) no cuentan como deriva', () => {
    // Están en SQLite y no en la nube A PROPÓSITO (decisión 17 y §4.4), y la
    // comparación las excluye por la misma lista que arma los payloads.
    expect(diferenciasEntreContratoYEsquemaLocal(contratoDeLaFoto(), conBaseMigrada())).toEqual([]);
  });
});
