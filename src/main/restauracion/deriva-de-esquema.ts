/**
 * La precondición de deriva de §6.2: el esquema local y el de la nube tienen
 * que coincidir ANTES de bajar una sola fila.
 *
 * ===========================================================================
 * ES LA MITAD A DE LA PRUEBA DE DERIVA, CORRIENDO EN LA TERMINAL Y EN VIVO
 * ===========================================================================
 *
 * `deriva-de-esquema.test.ts` compara, en cada `npm test`, el esquema local
 * contra la FOTO de la nube. Acá se compara el esquema local contra **lo que
 * la nube declara en este momento** —`contrato_de_sincronizacion()`, leído
 * con el rol de restauración—, con las MISMAS reglas y las MISMAS exclusiones:
 * las columnas que no viajan las dice `COLUMNAS_EXCLUIDAS` de la bandeja de
 * salida, y la que solo existe en la nube es `recibido_en`. No hay una segunda
 * lista que pueda derivar de la primera.
 *
 * Restaurar con esquemas distintos es cómo se restaura mal en silencio: una
 * columna de más se ignoraría, una de menos quedaría vacía, y la base
 * reconstruida se vería completa. Por eso cualquier diferencia detiene la
 * restauración con el NOMBRE de la columna, antes de escribir nada.
 *
 * Todo lo de este archivo es puro: recibe el contrato ya parseado y una
 * función que describe el esquema local, y devuelve una lista de diferencias.
 */

import { z } from 'zod';

import { COLUMNAS_EXCLUIDAS } from '@main/database/bandeja-de-salida';
import {
  COLUMNA_DEL_SERVIDOR,
  FUNCIONES_DE_ESCRITURA,
  FUNCIONES_DE_RESTAURACION,
  FUNCION_DEL_CONTRATO,
  VERSION_DEL_CONTRATO_DE_SINCRONIZACION,
} from '@shared/contrato-de-sincronizacion';
import { ORDEN_DE_RESTAURACION, TABLA_QUE_SOLO_SE_VERIFICA } from './orden-de-restauracion';

const esquemaDeColumna = z.object({ nombre: z.string(), tipo: z.string(), nulable: z.boolean() });
const esquemaDeFuncion = z.object({
  security_definer: z.boolean(),
  search_path: z.array(z.string()).nullable(),
  argumentos: z.string(),
  devuelve: z.string(),
});

/** Lo que `contrato_de_sincronizacion()` devuelve. Es la misma forma que la foto. */
export const esquemaDelContrato = z.object({
  version_del_contrato: z.number().int(),
  tablas: z.record(z.string(), z.array(esquemaDeColumna)),
  funciones: z.record(z.string(), esquemaDeFuncion),
});

export type ContratoDeLaNube = z.infer<typeof esquemaDelContrato>;

/** Una columna del esquema local, tal como la describe `PRAGMA table_info`. */
export interface ColumnaLocal {
  readonly nombre: string;
  readonly nulable: boolean;
}

/** Lo que `proconfig` guarda cuando una función lleva `SET search_path = ''`. */
const SEARCH_PATH_VACIO = 'search_path=""';

/**
 * Compara el contrato con el esquema local y devuelve las diferencias, cada
 * una con nombre. Una lista vacía significa que se puede restaurar.
 *
 * `columnasLocales(tabla)` devuelve las columnas de esa tabla en SQLite, o
 * `null` si la tabla no existe localmente.
 */
export function diferenciasEntreContratoYEsquemaLocal(
  contrato: ContratoDeLaNube,
  columnasLocales: (tabla: string) => readonly ColumnaLocal[] | null,
): string[] {
  const diferencias: string[] = [];

  if (contrato.version_del_contrato !== VERSION_DEL_CONTRATO_DE_SINCRONIZACION) {
    diferencias.push(
      `la nube declara el contrato ${String(contrato.version_del_contrato)} y esta terminal usa el ${String(VERSION_DEL_CONTRATO_DE_SINCRONIZACION)}`,
    );
  }

  for (const tabla of ORDEN_DE_RESTAURACION) {
    const enLaNube = contrato.tablas[tabla];
    const enSqlite = columnasLocales(tabla);
    if (enLaNube === undefined) {
      diferencias.push(`la tabla ${tabla} no existe en la nube`);
      continue;
    }
    if (enSqlite === null) {
      diferencias.push(`la tabla ${tabla} no existe en SQLite`);
      continue;
    }

    const excluidas = COLUMNAS_EXCLUIDAS[tabla] ?? [];
    const locales = enSqlite.filter((columna) => !excluidas.includes(columna.nombre));
    const remotas = enLaNube.filter((columna) => columna.nombre !== COLUMNA_DEL_SERVIDOR);

    for (const columna of locales) {
      if (!remotas.some((remota) => remota.nombre === columna.nombre)) {
        diferencias.push(`${tabla}.${columna.nombre} existe en SQLite y no en la nube`);
      }
    }
    for (const columna of remotas) {
      const local = locales.find((candidata) => candidata.nombre === columna.nombre);
      if (local === undefined) {
        diferencias.push(`${tabla}.${columna.nombre} existe en la nube y no en SQLite`);
      } else if (local.nulable !== columna.nulable) {
        diferencias.push(
          `${tabla}.${columna.nombre} es ${columna.nulable ? 'nulable' : 'NOT NULL'} en la nube y ${local.nulable ? 'nulable' : 'NOT NULL'} en SQLite`,
        );
      }
    }

    const recibidoEn = enLaNube.find((columna) => columna.nombre === COLUMNA_DEL_SERVIDOR);
    if (recibidoEn === undefined || recibidoEn.nulable) {
      diferencias.push(`${tabla}.${COLUMNA_DEL_SERVIDOR} tiene que existir en la nube y ser NOT NULL: sin ella no hay detección de anomalías`);
    }
  }

  // `denominaciones`: las mismas columnas de los dos lados y SIN recibido_en.
  const denominacionesEnLaNube = contrato.tablas[TABLA_QUE_SOLO_SE_VERIFICA];
  const denominacionesLocales = columnasLocales(TABLA_QUE_SOLO_SE_VERIFICA);
  if (denominacionesEnLaNube === undefined || denominacionesLocales === null) {
    diferencias.push(`la tabla ${TABLA_QUE_SOLO_SE_VERIFICA} falta de un lado`);
  } else {
    const nombresNube = denominacionesEnLaNube.map((c) => c.nombre).sort();
    const nombresLocal = denominacionesLocales.map((c) => c.nombre).sort();
    if (nombresNube.join(',') !== nombresLocal.join(',')) {
      diferencias.push(
        `${TABLA_QUE_SOLO_SE_VERIFICA} tiene columnas distintas: nube [${nombresNube.join(', ')}] y SQLite [${nombresLocal.join(', ')}]`,
      );
    }
  }

  for (const funcion of FUNCIONES_DE_ESCRITURA) {
    const definicion = contrato.funciones[funcion];
    if (definicion === undefined) {
      diferencias.push(`la función ${funcion} no existe en la nube`);
    } else if (!definicion.security_definer || !(definicion.search_path ?? []).includes(SEARCH_PATH_VACIO)) {
      diferencias.push(`la función ${funcion} cambió: tiene que ser SECURITY DEFINER con search_path vacío`);
    }
  }
  const contratoFn = contrato.funciones[FUNCION_DEL_CONTRATO];
  if (contratoFn === undefined || contratoFn.security_definer) {
    diferencias.push(`la función ${FUNCION_DEL_CONTRATO} falta o cambió: tiene que existir y NO ser DEFINER`);
  }
  for (const funcion of FUNCIONES_DE_RESTAURACION) {
    const definicion = contrato.funciones[funcion];
    if (definicion === undefined) {
      diferencias.push(`la función ${funcion} no existe en la nube: falta aplicar la migración que la crea`);
    } else if (definicion.security_definer || !(definicion.search_path ?? []).includes(SEARCH_PATH_VACIO)) {
      diferencias.push(`la función ${funcion} cambió: tiene que ser SECURITY INVOKER con search_path vacío`);
    }
  }

  return diferencias;
}
