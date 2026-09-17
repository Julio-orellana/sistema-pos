/**
 * Qué función de la nube le corresponde a cada lote.
 *
 * Es **puro**: recibe las filas del lote y devuelve el nombre de una de las
 * funciones de escritura de la nube (`FUNCIONES_DE_ESCRITURA`), o explica por
 * qué no se puede decidir. Sin red, sin base, sin reloj. Se prueba con una
 * tabla de casos escritos.
 *
 * ===========================================================================
 * LA REGLA NO ES «MIRÁ LA PRIMERA TABLA», Y ESA ES TODA LA DIFICULTAD
 * ===========================================================================
 *
 * La forma evidente sería enrutar por `orden_en_lote = 0`, y **estaría mal**.
 * CLAUDE.md §4.20 ya lo dejó anotado para este día: *«un lote que empieza por
 * `productos` puede ser una venta o un lote simple; se distingue por si trae
 * una fila de `ventas`, no por la primera tabla»*.
 *
 *   venta        →  productos… → ventas → venta_detalle… → auditoria_log…
 *   lote simple  →  productos  → auditoria_log
 *
 * Los dos empiezan igual. Enrutar por la primera fila mandaría toda venta a
 * `sincronizar_lote_simple`, que la rechazaría por nombre —`ventas` no está en
 * su lista cerrada— y **detendría la cola con un error de forma**: un fallo
 * ruidoso, por suerte, pero por la razón equivocada.
 *
 * La anulación de una venta (0035) tiene el mismo problema del otro lado:
 *
 *   anulación    →  anulaciones_de_venta → productos… → auditoria_log
 *
 * Trae `productos` y `auditoria_log`, igual que un lote simple, y NO trae
 * `ventas`. Sin su tabla decisiva caería en `sincronizar_lote_simple`, que la
 * rechazaría por nombre y detendría la cola (§7.5 de ANULACION-DE-VENTA.md).
 *
 * Por eso se enruta por PRESENCIA de una tabla decisiva, en orden de
 * especificidad, y no por posición.
 *
 * ===========================================================================
 * ANTE LA DUDA, NO SE ADIVINA
 * ===========================================================================
 *
 * Un lote que trajera a la vez `ventas` y `usuarios` no es un caso raro que
 * haya que resolver con una preferencia: es un lote que **ninguna función de
 * la nube va a aceptar**, porque cada una tiene su lista cerrada. Elegir una
 * lo mandaría a que lo rechacen allá con un mensaje sobre la tabla equivocada.
 * Se rechaza acá, con el motivo verdadero, y el lote queda bloqueante.
 */

import type { CambioSincronizable } from '@shared/adapters';
import {
  TABLAS_ADMITIDAS_POR_FUNCION,
  type FuncionDeEscritura,
} from '@shared/contrato-de-sincronizacion';

/** La tabla que decide de qué clase es un lote de caja. */
const TABLA_DE_CAJA = 'caja_sesiones';

/** Los dos estados de una sesión de caja que la nube sabe sincronizar. */
const ESTADOS_DE_CAJA = {
  abierta: 'sincronizar_apertura_de_caja',
  cerrada: 'sincronizar_cierre_de_caja',
} as const satisfies Readonly<Record<string, FuncionDeEscritura>>;

/**
 * Las tablas decisivas, en orden de especificidad. La primera que aparezca en
 * el lote manda.
 *
 * `caja_sesiones` no está acá porque no basta con su presencia: hay que mirar
 * su `estado`. Se resuelve aparte, abajo.
 */
const TABLA_DECISIVA: readonly (readonly [string, FuncionDeEscritura])[] = [
  ['ventas', 'sincronizar_venta'],
  ['usuarios', 'sincronizar_usuario'],
  // Decide por PRESENCIA, como las otras: la fila de la anulación va primera,
  // pero lo que la distingue de un lote simple es que esté, no dónde.
  ['anulaciones_de_venta', 'sincronizar_anulacion_de_venta'],
];

/** Por qué un lote no se pudo enrutar. Lleva el motivo, no un código. */
export class LoteNoEnrutable extends Error {
  public constructor(motivo: string) {
    super(motivo);
    this.name = 'LoteNoEnrutable';
  }
}

/**
 * Decide qué función de la nube le toca a este lote.
 *
 * Lanza `LoteNoEnrutable` cuando el lote es incoherente. Quien llama tiene que
 * tratar eso como **determinístico**: reintentarlo no lo va a arreglar, y el
 * lote detiene la cola hasta que una persona lo mire.
 */
export function elegirFuncionDelLote(filas: readonly CambioSincronizable[]): FuncionDeEscritura {
  if (filas.length === 0) {
    throw new LoteNoEnrutable('El lote no tiene ninguna fila.');
  }

  const tablas = new Set(filas.map((fila) => fila.tabla));

  const decisivasPresentes = TABLA_DECISIVA.filter(([tabla]) => tablas.has(tabla));
  const hayCaja = tablas.has(TABLA_DE_CAJA);

  if (decisivasPresentes.length + (hayCaja ? 1 : 0) > 1) {
    const nombres = [...decisivasPresentes.map(([tabla]) => tabla), ...(hayCaja ? [TABLA_DE_CAJA] : [])];
    throw new LoteNoEnrutable(
      `El lote mezcla tablas que pertenecen a funciones distintas (${nombres.join(', ')}). ` +
        'Ninguna función de la nube lo aceptaría, así que no se manda.',
    );
  }

  const decisiva = decisivasPresentes[0];
  if (decisiva !== undefined) {
    return decisiva[1];
  }

  if (hayCaja) {
    return funcionDeCaja(filas);
  }

  /*
    UN LOTE DE PUROS ASIENTOS tiene su propia función desde la `0027`.
    Va antes que `funcionSimple` porque `sincronizar_lote_simple` **rechaza**
    `auditoria_log` como fila principal, y con razón: ese `CASE` es lo que
    obliga a que la fila de negocio vaya primera. Medido contra la nube antes
    de que existiera la `0027`: `FORMA: la tabla auditoria_log no se sincroniza
    como lote simple`, y la cola se detenía. Ver CLAUDE.md §4.29.
  */
  if (tablas.size === 1 && tablas.has('auditoria_log')) {
    return 'sincronizar_asiento';
  }

  return funcionSimple(tablas);
}

/**
 * Un lote de caja se parte en dos según el `estado` de su fila.
 *
 * Se lee del payload, que es la fila tal como quedó en SQLite. Si no dice
 * `abierta` ni `cerrada`, no se elige una por descarte: la migración 010 y su
 * CHECK son los que definen los estados válidos, y un valor fuera de esa lista
 * es un dato roto que hay que mirar, no un caso que enrutar.
 */
function funcionDeCaja(filas: readonly CambioSincronizable[]): FuncionDeEscritura {
  const deCaja = filas.filter((fila) => fila.tabla === TABLA_DE_CAJA);
  if (deCaja.length > 1) {
    throw new LoteNoEnrutable(
      `El lote trae ${String(deCaja.length)} filas de ${TABLA_DE_CAJA} y las funciones de caja esperan una sola.`,
    );
  }

  const estado = deCaja[0]?.datos.estado;
  if (typeof estado !== 'string') {
    throw new LoteNoEnrutable(
      `La fila de ${TABLA_DE_CAJA} no trae un estado legible, así que no se sabe si es una apertura o un cierre.`,
    );
  }
  const funcion = (ESTADOS_DE_CAJA as Readonly<Record<string, FuncionDeEscritura | undefined>>)[estado];
  if (funcion === undefined) {
    throw new LoteNoEnrutable(
      `La sesión de caja está en estado «${estado}», que no es ni abierta ni cerrada. No hay función que lo sincronice.`,
    );
  }
  return funcion;
}

/**
 * Todo lo demás va por `sincronizar_lote_simple`, pero **se comprueba acá que
 * sus tablas estén en la lista cerrada de esa función**.
 *
 * No es desconfianza de la nube: allá se vuelve a comprobar y ese es el
 * control que manda. Es que el mensaje de acá puede decir **qué tabla** sobra
 * y que el lote nunca salió de la máquina, mientras que el de allá llega
 * después de una petición de red y de una transacción abortada.
 */
function funcionSimple(tablas: ReadonlySet<string>): FuncionDeEscritura {
  const admitidas = new Set(TABLAS_ADMITIDAS_POR_FUNCION.sincronizar_lote_simple);
  const intrusas = [...tablas].filter((tabla) => !admitidas.has(tabla));
  if (intrusas.length > 0) {
    throw new LoteNoEnrutable(
      `Ninguna función de la nube admite ${intrusas.join(', ')} en un lote simple.`,
    );
  }
  return 'sincronizar_lote_simple';
}
