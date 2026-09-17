/**
 * En qué orden se restauran las tablas, y por qué ese orden no se asume.
 *
 * ===========================================================================
 * EL ORDEN ES EL DEL GRAFO DE LLAVES FORÁNEAS, LEÍDO DEL CATÁLOGO
 * ===========================================================================
 *
 * Cada tabla va después de las que referencia. Se leyó del catálogo de
 * Postgres de `pos-pruebas-descartable` el 2026-09-14 (`pg_constraint` con
 * `contype = 'f'`): quince llaves foráneas, que son exactamente las mismas que
 * declara el esquema local (`PRAGMA foreign_key_list`), porque SQLite es el
 * espejo de Postgres tabla por tabla. La 0033 (2026-09-17) suma las tres de
 * `anulaciones_de_venta`, y son dieciocho.
 *
 *   productos                  → categorias
 *   precios_especiales         → productos
 *   limites_descuento          → usuarios (editado_por)
 *   caja_sesiones              → usuarios (usuario_id, cerrada_por,
 *                                          diferencia_autorizada_por)
 *   caja_sesion_denominaciones → caja_sesiones, denominaciones
 *   ventas                     → caja_sesiones, usuarios (usuario_id,
 *                                          descuento_autorizado_por)
 *   venta_detalle              → ventas, productos
 *   recibos                    → ventas
 *   anulaciones_de_venta       → ventas, usuarios (solicitada_por,
 *                                          autorizada_por)
 *   auditoria_log              → usuarios
 *
 * El orden de abajo lo respeta, y **no se da por bueno para siempre**: el
 * servicio lo comprueba contra las llaves foráneas de la base local en el
 * momento de restaurar (`comprobarOrdenContraLasLlaves`), y hay una prueba
 * que lo coteja además contra la lista de Postgres de arriba. El día que una
 * migración agregue una llave que este orden no respete, falla la prueba y
 * falla la restauración, antes de escribir una fila.
 *
 * `denominaciones` NO se restaura: las once del quetzal ya las sembró la
 * migración 004 con los mismos UUID que la nube (§6.3, paso 3). Se verifica
 * que coincidan y nada más. Por eso cuenta como «ya existente» para el orden.
 *
 * `auditoria_log` va al final por dos razones: referencia a `usuarios`, y
 * algunas de sus filas no tienen ninguna fila hermana de negocio —los
 * asientos sueltos de `sincronizar_asiento`: un ingreso fallido, un candado,
 * una salida controlada—. No se asume que cada asiento venga acompañado.
 */

import type { Database } from 'better-sqlite3';

/** Las tablas que se restauran, en el orden en que se restauran. */
export const ORDEN_DE_RESTAURACION = [
  'usuarios',
  'categorias',
  'configuracion_negocio',
  'productos',
  'precios_especiales',
  'limites_descuento',
  'caja_sesiones',
  'caja_sesion_denominaciones',
  'ventas',
  'venta_detalle',
  'recibos',
  // Después de `ventas` y de `usuarios`, que referencia. Una venta restaurada
  // con su fila acá queda ANULADA en la base restaurada: la regla es la misma en
  // las tres copias, y `ventas.estado` no se toca (ANULACION-DE-VENTA.md §8).
  'anulaciones_de_venta',
  'auditoria_log',
] as const;

export type TablaRestaurable = (typeof ORDEN_DE_RESTAURACION)[number];

/** La tabla que se verifica en vez de restaurarse. */
export const TABLA_QUE_SOLO_SE_VERIFICA = 'denominaciones';

/**
 * Las tablas que la nube SOLO permite insertar, nunca actualizar.
 *
 * Para ellas «`recibido_en` posterior a la fecha del robo» equivale a
 * «insertada después del robo»: no hay ninguna función de la 0023 que las
 * actualice (§2.1 del diseño), así que una fila anterior nunca puede tener una
 * marca posterior. Y ninguna fila anterior al robo las referencia, porque sus
 * hijas se insertan en la misma llamada que ellas. Son las únicas que la
 * restauración puede EXCLUIR sin romper una llave foránea de lo legítimo.
 */
export const TABLAS_QUE_SOLO_SE_INSERTAN: readonly TablaRestaurable[] = [
  'ventas',
  'venta_detalle',
  'recibos',
  'caja_sesion_denominaciones',
  // `sincronizar_anulacion_de_venta` la escribe con `ignorar` y su trigger
  // prohíbe UPDATE y DELETE (0033, 0035): una anulación posterior al robo es una
  // anulación INSERTADA después del robo, y ninguna fila la referencia.
  'anulaciones_de_venta',
  'auditoria_log',
];

/** Una llave foránea tal como la declara la base local. */
export interface LlaveForaneaLocal {
  readonly tabla: string;
  readonly columna: string;
  readonly referencia: string;
}

interface FilaDeForeignKeyList {
  readonly table: string;
  readonly from: string;
}

/** Lee las llaves foráneas de las tablas restaurables desde el catálogo de SQLite. */
export function llavesForaneasLocales(base: Database): LlaveForaneaLocal[] {
  const llaves: LlaveForaneaLocal[] = [];
  for (const tabla of ORDEN_DE_RESTAURACION) {
    // El nombre viene de una lista cerrada de literales, no de una entrada.
    const filas = base.prepare(`PRAGMA foreign_key_list(${tabla})`).all() as FilaDeForeignKeyList[];
    for (const fila of filas) {
      llaves.push({ tabla, columna: fila.from, referencia: fila.table });
    }
  }
  return llaves;
}

/**
 * Comprueba que el orden respete las llaves foráneas: para cada llave, la
 * tabla referenciada tiene que ir antes, o ser la que ya existe.
 *
 * Devuelve las violaciones con nombre. Vacío significa que el orden sirve.
 */
export function violacionesDelOrden(llaves: readonly LlaveForaneaLocal[]): string[] {
  const posicion = new Map<string, number>(ORDEN_DE_RESTAURACION.map((tabla, indice) => [tabla, indice]));
  const violaciones: string[] = [];
  for (const llave of llaves) {
    if (llave.referencia === TABLA_QUE_SOLO_SE_VERIFICA || llave.referencia === llave.tabla) {
      continue;
    }
    const de = posicion.get(llave.tabla);
    const a = posicion.get(llave.referencia);
    if (de === undefined) {
      violaciones.push(`${llave.tabla} tiene llaves foráneas y no está en el orden de restauración`);
      continue;
    }
    if (a === undefined) {
      violaciones.push(`${llave.tabla}.${llave.columna} referencia a ${llave.referencia}, que no está en el orden de restauración`);
      continue;
    }
    if (a > de) {
      violaciones.push(
        `${llave.tabla}.${llave.columna} referencia a ${llave.referencia}, pero ${llave.referencia} se restaura después`,
      );
    }
  }
  return violaciones;
}

/** El orden contra las llaves de ESTA base. Se llama antes de escribir una fila. */
export function comprobarOrdenContraLasLlaves(base: Database): string[] {
  return violacionesDelOrden(llavesForaneasLocales(base));
}
