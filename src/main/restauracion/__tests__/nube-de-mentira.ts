/**
 * Una nube de MENTIRA para probar el servicio de restauración sin red.
 *
 * No es un doble que devuelve lo que se le pida: se construye SOBRE UNA BASE
 * SQLITE REAL —la «terminal de origen», llenada con los servicios de verdad—
 * y contesta cada lectura con la FORMA EXACTA en que PostgREST la
 * devolvería:
 *
 *   · los numéricos como TEXTO con los ceros de relleno de la escala de la
 *     columna (`4.165` sale como `4.165000`, como se midió en la fase 3.b);
 *   · las fechas con `+00:00` y con los decimales de segundo recortados, como
 *     hace Postgres (`.500` sale como `.5`, `.000` desaparece);
 *   · los booleanos como `true`/`false`, los `jsonb` ya parseados;
 *   · sin las columnas que NUNCA viajan (`COLUMNAS_EXCLUIDAS`), y CON
 *     `recibido_en`, que pone el servidor.
 *
 * Así la restauración se prueba contra lo que la nube devuelve de verdad y
 * el resultado se puede comparar, byte a byte, con la base de origen. Lo que
 * este doble NO puede probar —que PostgREST serialice exactamente así— lo
 * prueba `verify:restauracion` contra `pos-pruebas-descartable`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';

import { COLUMNAS_EXCLUIDAS } from '@main/database/bandeja-de-salida';
import { montoACadena, sumarLista } from '@shared/money';
import type { ClienteDeRestauracion, SesionDeRestauracionIniciada, VentasPorMesDeLaNube } from '../cliente-de-restauracion';
import { CLASES_DE_COLUMNA, type ClaseDeColumna, type FilaDeLaNube } from '../conversion-de-tipos';
import { esquemaDelContrato, type ContratoDeLaNube } from '../deriva-de-esquema';

const RUTA_DE_LA_FOTO = fileURLToPath(new URL('../../../../supabase/esquema-nube.json', import.meta.url));

/** La foto del catálogo real: es exactamente lo que devuelve `contrato_de_sincronizacion()`. */
export function contratoDeLaFoto(): ContratoDeLaNube {
  return esquemaDelContrato.parse(JSON.parse(readFileSync(RUTA_DE_LA_FOTO, 'utf8')));
}

/** `recibido_en` por omisión para toda fila: anterior a cualquier «fecha de robo» de las pruebas. */
export const RECIBIDO_EN_POR_OMISION = '2026-09-10T00:00:00+00:00';

/** Decimales de relleno con que Postgres devuelve cada clase numérica. */
const RELLENO_DE_POSTGRES: Readonly<Record<'monto' | 'cantidad' | 'exacto', number>> = {
  monto: 2,
  cantidad: 3,
  exacto: 6,
};

/** Como PostgREST devuelve un numérico pedido con `::text`: rellenado a la escala. */
export function numericoComoPostgres(texto: string, clase: 'monto' | 'cantidad' | 'exacto'): string {
  const [entera = '0', decimales = ''] = texto.split('.');
  return `${entera}.${decimales.padEnd(RELLENO_DE_POSTGRES[clase], '0')}`;
}

/** Como PostgREST devuelve un `timestamptz`: `+00:00`, y sin ceros de más en los decimales. */
export function fechaComoPostgres(iso: string): string {
  const sinZ = iso.replace(/Z$/, '');
  const [fechaYHora = sinZ, decimales = ''] = sinZ.split('.');
  const recortados = decimales.replace(/0+$/, '');
  return `${fechaYHora}${recortados === '' ? '' : `.${recortados}`}+00:00`;
}

/** Lo que SQLite guardó como TEXTO. Si no es texto, la base de origen está mal y hay que decirlo. */
function textoGuardado(valor: unknown): string {
  if (typeof valor !== 'string') {
    throw new Error(`la nube de mentira esperaba texto y la base de origen tiene ${typeof valor}`);
  }
  return valor;
}

function comoPostgres(clase: ClaseDeColumna, valor: unknown): unknown {
  if (valor === null) {
    return null;
  }
  switch (clase) {
    case 'monto':
    case 'cantidad':
    case 'exacto':
      return numericoComoPostgres(textoGuardado(valor), clase);
    case 'fecha':
      return fechaComoPostgres(textoGuardado(valor));
    case 'booleana':
      return valor === 1;
    case 'json':
      return JSON.parse(textoGuardado(valor)) as unknown;
    case 'entero':
    case 'texto':
      return valor;
  }
}

export interface OpcionesDeLaNubeDeMentira {
  /** La terminal de origen: de acá salen las filas. */
  readonly origen: Database;
  /** Objetos del bucket `fotos`, por nombre. */
  readonly fotos?: ReadonlyMap<string, Buffer>;
  /** `recibido_en` por fila (`tabla/id`); lo que no esté usa el valor por omisión. */
  readonly recibidoEn?: ReadonlyMap<string, string>;
  readonly contrato?: ContratoDeLaNube;
  /** Se llama en cada página leída, con el número de página. Sirve para cancelar a mitad. */
  readonly alLeerPagina?: (numero: number) => void;
  /** Con esto, iniciar sesión falla como lo haría GoTrue con una contraseña equivocada. */
  readonly rechazarSesion?: boolean;
  /** Cuántas denominaciones devolver. Para falsificar la comprobación de las once. */
  readonly denominacionesADevolver?: number;
}

export class NubeDeMentira implements ClienteDeRestauracion {
  public sesionesIniciadas: string[] = [];
  public sesionesCerradas = 0;
  public paginasLeidas = 0;
  public fotosPedidas: string[] = [];

  private readonly opciones: OpcionesDeLaNubeDeMentira;

  public constructor(opciones: OpcionesDeLaNubeDeMentira) {
    this.opciones = opciones;
  }

  public iniciarSesion(correo: string): Promise<SesionDeRestauracionIniciada> {
    if (this.opciones.rechazarSesion === true) {
      return Promise.reject(new Error('Supabase rechazó ese correo y esa contraseña.'));
    }
    this.sesionesIniciadas.push(correo);
    return Promise.resolve({ correo, rol: 'restauracion' });
  }

  public cerrarSesion(): Promise<void> {
    this.sesionesCerradas += 1;
    return Promise.resolve();
  }

  public contrato(): Promise<ContratoDeLaNube> {
    return Promise.resolve(this.opciones.contrato ?? contratoDeLaFoto());
  }

  public contar(tabla: string): Promise<number> {
    const fila = this.opciones.origen.prepare(`SELECT count(*) AS total FROM ${tabla}`).get() as { total: number };
    return Promise.resolve(fila.total);
  }

  private filasDe(tabla: string, filtro: string, parametros: readonly string[]): FilaDeLaNube[] {
    const clases = CLASES_DE_COLUMNA[tabla];
    if (clases === undefined) {
      throw new Error(`la nube de mentira no conoce la tabla ${tabla}`);
    }
    const excluidas = COLUMNAS_EXCLUIDAS[tabla] ?? [];
    const crudas = this.opciones.origen
      .prepare(`SELECT * FROM ${tabla} ${filtro} ORDER BY id ASC`)
      .all(...parametros) as Record<string, unknown>[];
    return crudas.map((cruda) => {
      const fila: Record<string, unknown> = {};
      for (const [columna, valor] of Object.entries(cruda)) {
        if (excluidas.includes(columna)) {
          continue;
        }
        const clase = clases[columna];
        if (clase === undefined) {
          throw new Error(`la nube de mentira no sabe qué es ${tabla}.${columna}`);
        }
        fila[columna] = comoPostgres(clase, valor);
      }
      if (tabla !== 'denominaciones') {
        fila.recibido_en = this.opciones.recibidoEn?.get(`${tabla}/${String(cruda.id)}`) ?? RECIBIDO_EN_POR_OMISION;
      }
      return fila;
    });
  }

  public leerPagina(tabla: string, desdeId: string | null, limite: number): Promise<FilaDeLaNube[]> {
    this.paginasLeidas += 1;
    this.opciones.alLeerPagina?.(this.paginasLeidas);
    let filas = this.filasDe(tabla, desdeId === null ? '' : 'WHERE id > ?', desdeId === null ? [] : [desdeId]);
    if (tabla === 'denominaciones' && this.opciones.denominacionesADevolver !== undefined) {
      filas = filas.slice(0, this.opciones.denominacionesADevolver);
    }
    return Promise.resolve(filas.slice(0, limite));
  }

  public leerFila(tabla: string, id: string): Promise<FilaDeLaNube | null> {
    return Promise.resolve(this.filasDe(tabla, 'WHERE id = ?', [id])[0] ?? null);
  }

  public leerHijas(tabla: string, columna: string, valor: string): Promise<FilaDeLaNube[]> {
    return Promise.resolve(this.filasDe(tabla, `WHERE ${columna} = ?`, [valor]));
  }

  /** Lo que haría `restauracion_ventas_por_mes()`: sumar en la nube, por mes UTC, y devolver texto. */
  public ventasPorMes(): Promise<VentasPorMesDeLaNube> {
    const filas = this.opciones.origen.prepare('SELECT fecha, total FROM ventas').all() as { fecha: string; total: string }[];
    const porMes = new Map<string, string[]>();
    const LARGO_DE_ANO_Y_MES = 7;
    for (const fila of filas) {
      const mes = fila.fecha.slice(0, LARGO_DE_ANO_Y_MES);
      porMes.set(mes, [...(porMes.get(mes) ?? []), fila.total]);
    }
    return Promise.resolve(
      [...porMes.entries()].sort().map(([mes, totales]) => ({ mes, ventas: totales.length, total: montoACadena(sumarLista(totales)) })),
    );
  }

  public bajarFoto(objeto: string): Promise<Buffer | null> {
    this.fotosPedidas.push(objeto);
    return Promise.resolve(this.opciones.fotos?.get(objeto) ?? null);
  }
}
