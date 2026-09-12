/**
 * Mitad A de la prueba de deriva (docs/SINCRONIZACION.md §9.2): sin red, en
 * cada `npm test`.
 *
 * Compara el esquema local —el que sale de aplicar todas las migraciones de
 * SQLite— con la FOTO del catálogo de la nube que vive en
 * `supabase/esquema-nube.json`, y que se toma con
 * `npm run verify:nube -- --tomar-foto` (esa es la mitad B, con red). Lo que
 * atrapa es «cambié el esquema local y no el espejo», o al revés, y lo atrapa
 * con el NOMBRE de la columna, antes de que la primera venta real intente
 * subir y falle en el mostrador.
 *
 * Cubre además las funciones de la migración 0023, todas: que existan, que las
 * cinco de escritura sean SECURITY DEFINER, que ninguna tenga el search_path
 * sin fijar, y que la versión de contrato que esta terminal manda sea la que
 * la nube declara.
 *
 * Las exclusiones son EXPLÍCITAS y salen de una sola fuente: las columnas que
 * no viajan las dice `COLUMNAS_EXCLUIDAS` de la bandeja de salida —la misma
 * lista que arma los payloads—, y la que solo existe en la nube es
 * `recibido_en`. No hay una segunda lista de exclusiones que pueda derivar de
 * la primera.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AYUDANTES_INTERNOS,
  COLUMNA_DEL_SERVIDOR,
  FUNCIONES_DE_ESCRITURA,
  FUNCION_DEL_CONTRATO,
  TABLAS_ADMITIDAS_POR_FUNCION,
  VERSION_DEL_CONTRATO_DE_SINCRONIZACION,
} from '@shared/contrato-de-sincronizacion';

import { COLUMNAS_EXCLUIDAS, type TablaSincronizable } from '../bandeja-de-salida';
import { crearBaseVacia, migrar } from './ayuda-base-de-datos';

// ---------------------------------------------------------------------------
// La foto
// ---------------------------------------------------------------------------

const esquemaDeColumna = z.object({ nombre: z.string(), tipo: z.string(), nulable: z.boolean() });
const esquemaDeFuncion = z.object({
  security_definer: z.boolean(),
  search_path: z.array(z.string()).nullable(),
  argumentos: z.string(),
  devuelve: z.string(),
});
const esquemaDeFoto = z.object({
  version_del_contrato: z.number().int(),
  tablas: z.record(z.string(), z.array(esquemaDeColumna)),
  funciones: z.record(z.string(), esquemaDeFuncion),
});

const RUTA_DE_LA_FOTO = fileURLToPath(new URL('../../../../supabase/esquema-nube.json', import.meta.url));
const foto = esquemaDeFoto.parse(JSON.parse(readFileSync(RUTA_DE_LA_FOTO, 'utf8')));

/** Lo que `proconfig` guarda cuando una función lleva `SET search_path = ''`. */
const SEARCH_PATH_VACIO = 'search_path=""';

// ---------------------------------------------------------------------------
// El esquema local
// ---------------------------------------------------------------------------

/** Las doce tablas que viajan. Es el tipo de la bandeja de salida, hecho lista. */
const TABLAS_QUE_VIAJAN: readonly TablaSincronizable[] = [
  'usuarios',
  'categorias',
  'productos',
  'precios_especiales',
  'limites_descuento',
  'configuracion_negocio',
  'caja_sesiones',
  'caja_sesion_denominaciones',
  'ventas',
  'venta_detalle',
  'recibos',
  'auditoria_log',
];

/** Las que tienen que estar en la nube: las doce más `denominaciones`, sembrada allá desde la 0004. */
const TABLAS_DE_LA_NUBE = [...TABLAS_QUE_VIAJAN, 'denominaciones'].sort();

/** Tablas locales SIN espejo, a propósito (supabase/migrations/README.md, dirección 1). */
const TABLAS_SOLO_LOCALES = ['sync_cola', 'bloqueos_de_autorizacion', 'migraciones_aplicadas'];

interface ColumnaLocal {
  readonly nombre: string;
  readonly nulable: boolean;
}

type Base = Parameters<typeof migrar>[0];

let limpiar: (() => void) | null = null;

function abrirBaseMigrada(): Base {
  const prueba = crearBaseVacia();
  limpiar = prueba.limpiar;
  migrar(prueba.base);
  return prueba.base;
}

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

function columnasLocales(base: Base, tabla: string): ColumnaLocal[] {
  const filas = base.prepare(`PRAGMA table_info(${tabla})`).all() as { readonly name: string; readonly notnull: number }[];
  return filas.map((fila) => ({ nombre: fila.name, nulable: fila.notnull === 0 }));
}

/** Las columnas locales que VIAJAN: todas menos las que la bandeja excluye. */
function columnasQueViajan(base: Base, tabla: string): ColumnaLocal[] {
  const excluidas = COLUMNAS_EXCLUIDAS[tabla] ?? [];
  return columnasLocales(base, tabla).filter((columna) => !excluidas.includes(columna.nombre));
}

/** Las columnas de la nube que la terminal MANDA: todas menos la del servidor. */
function columnasQueLaNubeEspera(tabla: string): { readonly nombre: string; readonly nulable: boolean }[] {
  return (foto.tablas[tabla] ?? []).filter((columna) => columna.nombre !== COLUMNA_DEL_SERVIDOR);
}

const nombresDe = (columnas: readonly { readonly nombre: string }[]): string[] => columnas.map((c) => c.nombre).sort();

// ---------------------------------------------------------------------------
// Tablas y columnas
// ---------------------------------------------------------------------------

describe('La foto de la nube tiene las tablas correctas', () => {
  it('exactamente las trece: las doce que viajan más denominaciones', () => {
    expect(Object.keys(foto.tablas).sort()).toEqual(TABLAS_DE_LA_NUBE);
  });

  it('ninguna tabla que es solo local está en la nube', () => {
    for (const tabla of TABLAS_SOLO_LOCALES) {
      expect(foto.tablas).not.toHaveProperty(tabla);
    }
  });
});

describe('Cada tabla que viaja tiene, columna por columna, lo mismo en SQLite y en la nube', () => {
  for (const tabla of TABLAS_QUE_VIAJAN) {
    it(`${tabla}: las columnas que salen de SQLite son exactamente las que la nube espera`, () => {
      const base = abrirBaseMigrada();
      const enSqlite = nombresDe(columnasQueViajan(base, tabla));
      const enLaNube = nombresDe(columnasQueLaNubeEspera(tabla));

      // Se informan las dos direcciones con nombre, que es lo que §9.3 exige
      // que diga la prueba: «X existe en SQLite y no en la foto de la nube».
      const deriva = {
        existenEnSqliteYNoEnLaFotoDeLaNube: enSqlite.filter((c) => !enLaNube.includes(c)),
        existenEnLaFotoDeLaNubeYNoEnSqlite: enLaNube.filter((c) => !enSqlite.includes(c)),
      };
      expect(deriva).toEqual({ existenEnSqliteYNoEnLaFotoDeLaNube: [], existenEnLaFotoDeLaNubeYNoEnSqlite: [] });
    });

    it(`${tabla}: la nulabilidad coincide en cada columna compartida`, () => {
      const base = abrirBaseMigrada();
      const enSqlite = new Map(columnasQueViajan(base, tabla).map((c) => [c.nombre, c.nulable]));
      const discrepan = columnasQueLaNubeEspera(tabla)
        .filter((c) => enSqlite.has(c.nombre) && enSqlite.get(c.nombre) !== c.nulable)
        .map((c) => `${tabla}.${c.nombre}: en la nube ${c.nulable ? 'nulable' : 'NOT NULL'}, en SQLite ${enSqlite.get(c.nombre) === true ? 'nulable' : 'NOT NULL'}`);
      expect(discrepan).toEqual([]);
    });

    it(`${tabla}: la nube tiene recibido_en, NOT NULL, y SQLite no lo tiene`, () => {
      const base = abrirBaseMigrada();
      const enLaNube = foto.tablas[tabla]?.find((c) => c.nombre === COLUMNA_DEL_SERVIDOR);
      expect(enLaNube).toEqual({ nombre: COLUMNA_DEL_SERVIDOR, tipo: 'timestamp with time zone', nulable: false });
      expect(nombresDe(columnasLocales(base, tabla))).not.toContain(COLUMNA_DEL_SERVIDOR);
    });
  }

  it('denominaciones: mismas columnas en los dos lados, y SIN recibido_en en la nube (la terminal nunca la escribe)', () => {
    const base = abrirBaseMigrada();
    expect(nombresDe(foto.tablas.denominaciones ?? [])).toEqual(nombresDe(columnasLocales(base, 'denominaciones')));
    expect(nombresDe(foto.tablas.denominaciones ?? [])).not.toContain(COLUMNA_DEL_SERVIDOR);
  });

  it('las columnas excluidas de la bandeja existen de verdad en SQLite: una exclusión de una columna que no existe es una lista vieja', () => {
    const base = abrirBaseMigrada();
    for (const [tabla, columnas] of Object.entries(COLUMNAS_EXCLUIDAS)) {
      const locales = nombresDe(columnasLocales(base, tabla));
      for (const columna of columnas) {
        expect(locales, `${tabla}.${columna} está en COLUMNAS_EXCLUIDAS pero no en SQLite`).toContain(columna);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Funciones y contrato
// ---------------------------------------------------------------------------

describe('Las funciones de sincronización de la nube, según la foto', () => {
  it('la versión de contrato que manda esta terminal es la que la nube declara', () => {
    expect(foto.version_del_contrato).toBe(VERSION_DEL_CONTRATO_DE_SINCRONIZACION);
  });

  for (const funcion of FUNCIONES_DE_ESCRITURA) {
    it(`${funcion}: existe, es SECURITY DEFINER, con search_path vacío, recibe (lote, versión) y devuelve jsonb`, () => {
      expect(foto.funciones[funcion]).toEqual({
        security_definer: true,
        search_path: [SEARCH_PATH_VACIO],
        argumentos: 'lote jsonb, version_de_contrato integer',
        devuelve: 'jsonb',
      });
    });
  }

  it(`${FUNCION_DEL_CONTRATO}: existe, NO es DEFINER, con search_path vacío y sin argumentos`, () => {
    expect(foto.funciones[FUNCION_DEL_CONTRATO]).toEqual({
      security_definer: false,
      search_path: [SEARCH_PATH_VACIO],
      argumentos: '',
      devuelve: 'jsonb',
    });
  });

  for (const ayudante of AYUDANTES_INTERNOS) {
    it(`${ayudante}: el ayudante existe, no es DEFINER y tiene search_path vacío`, () => {
      const definicion = foto.funciones[ayudante];
      expect(definicion).toBeDefined();
      expect(definicion?.security_definer).toBe(false);
      expect(definicion?.search_path).toEqual([SEARCH_PATH_VACIO]);
    });
  }

  it('NINGUNA función de la foto tiene el search_path sin fijar', () => {
    const sinFijar = Object.entries(foto.funciones)
      .filter(([, definicion]) => !(definicion.search_path ?? []).includes(SEARCH_PATH_VACIO))
      .map(([nombre]) => nombre);
    expect(sinFijar).toEqual([]);
  });

  it('las listas cerradas de tablas de las cinco funciones cubren las doce que viajan, y solo nombran tablas que existen en la nube', () => {
    const admitidas = new Set(Object.values(TABLAS_ADMITIDAS_POR_FUNCION).flat());
    for (const tabla of TABLAS_QUE_VIAJAN) {
      expect(admitidas, `${tabla} no tiene ninguna función por la que subir`).toContain(tabla);
    }
    for (const tabla of admitidas) {
      expect(foto.tablas, `${tabla} está en una lista cerrada pero no existe en la nube`).toHaveProperty(tabla);
    }
  });

  it('auditoria_log está en la lista de las cinco funciones: toda operación deja su asiento', () => {
    for (const funcion of FUNCIONES_DE_ESCRITURA) {
      expect(TABLAS_ADMITIDAS_POR_FUNCION[funcion]).toContain('auditoria_log');
    }
  });
});
