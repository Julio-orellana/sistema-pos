/**
 * Los estados de la sincronización, su color y su texto: UNA sola fuente.
 *
 * ===========================================================================
 * POR QUÉ VIVE EN `src/shared` Y NO EN EL PROCESO PRINCIPAL
 * ===========================================================================
 *
 * Hasta el 2026-09-17 el texto de la barra estaba escrito DOS veces: en
 * `src/main/sincronizacion/resumen-de-sincronizacion.ts`, que es el que
 * probaban las pruebas de Vitest, y en `BarraDeEstado.tsx`, que es el que se
 * ve en la pantalla. La unión de estados, tres veces (más `ipc.ts`). Una
 * prueba que fija el texto de la copia que nadie muestra no fija nada: las
 * dos copias podían separarse sin que ningún `npm test` se enterara.
 *
 * Acá vive la única copia. El proceso principal la reexporta y la barra la
 * importa. Es puro —sin Node, sin React y sin reloj—, así que el renderer
 * puede usarlo. `estado-de-sincronizacion-una-sola-fuente.test.ts` falla si
 * un archivo del renderer vuelve a escribir un texto «Nube: …» por su cuenta.
 *
 * QUÉ estado corresponde lo sigue decidiendo SOLO el proceso principal
 * (`calcularEstadoDeSincronizacion`): la pantalla recibe el estado ya
 * calculado y únicamente lo muestra.
 */

/**
 * Los ocho estados posibles. Es una lista en tiempo de ejecución, no solo un
 * tipo, para que las pruebas recorran TODOS: un estado nuevo agregado sin
 * texto o sin color no puede pasar en silencio.
 */
export const ESTADOS_DE_SINCRONIZACION = [
  /** Un lote quedó detenido con un error determinístico. */
  'detenida',
  /**
   * Hay un archivo de credencial y esta aplicación no lo puede usar: no se
   * descifró o estaba vacío (§4.52). No es la red ni una revocación: hay que
   * reconectar la terminal.
   */
  'credencial_danada',
  /** No hay credencial guardada, o la nube la rechazó. */
  'sin_credencial',
  /** Hay pendientes y el más viejo pasa el umbral de 24 h. */
  'pendientes_viejos',
  /**
   * Hay pendientes y no se llega a la nube: o no hay token vigente ahora
   * mismo, o una subida falló y la comprobación que se hizo JUSTO DESPUÉS no
   * llegó a la nube de este proyecto.
   */
  'sin_conexion',
  /**
   * Hay pendientes, una subida falló, y la comprobación que se hizo JUSTO
   * DESPUÉS sí llegó a la nube de este proyecto: hay conexión, lo que falla es
   * otra cosa (el servidor, o esa subida puntual).
   */
  'problema_al_sincronizar',
  /** Hay pendientes, recientes, y nada más raro. */
  'pendientes',
  /** Sin pendientes. */
  'al_dia',
] as const;

export type EstadoDeSincronizacion = (typeof ESTADOS_DE_SINCRONIZACION)[number];

/** El color con el que la barra de estado pinta cada estado (§3.3). */
export type ColorDeEstado = 'neutral' | 'ambar' | 'rojo';

/**
 * «Sin color cuando está al día; ámbar con pendientes viejos; rojo cuando
 * está detenida o sin credencial.» — §3.3 del diseño, literal.
 *
 * Lo que el diseño no nombra, decidido después:
 *
 * - **`problema_al_sincronizar`: ámbar** (decisión de Julio, 2026-09-17,
 *   §4.52). Hay conexión y algo puntual está fallando activamente —por
 *   ejemplo, el proyecto de Supabase pausado—, así que es el estado más útil
 *   de ver de reojo. Merece atención sin ser crítico.
 * - **`sin_conexion` y `pendientes`: neutral.** Son pasivos: se resuelven
 *   solos cuando vuelve la red, y escalan a ámbar recién cuando los pendientes
 *   se vuelven viejos.
 * - **`credencial_danada`: rojo**, como `sin_credencial`: nada va a subir
 *   hasta que una persona reconecte la terminal.
 */
export function colorDeEstado(estado: EstadoDeSincronizacion): ColorDeEstado {
  if (estado === 'detenida' || estado === 'sin_credencial' || estado === 'credencial_danada') {
    return 'rojo';
  }
  if (estado === 'pendientes_viejos' || estado === 'problema_al_sincronizar') {
    return 'ambar';
  }
  return 'neutral';
}

/**
 * El texto corto de la barra de estado, con los ejemplos de §3.3 como guía.
 *
 * **NO dice «sin conexión desde HH:MM»**, aunque esa es la redacción literal
 * del diseño: esta aplicación no tiene ningún reloj que registre el instante
 * exacto en que se perdió la conexión, y escribir una hora ahí sería inventar
 * una precisión que no se midió. En su lugar se dice cuántos pendientes hay,
 * que sí es un dato real.
 */
export function textoDeBarraDeEstado(estado: EstadoDeSincronizacion, pendientes: number): string {
  switch (estado) {
    case 'detenida':
      return 'Nube: DETENIDA';
    case 'credencial_danada':
      return 'Nube: credencial dañada — hay que reconectar';
    case 'sin_credencial':
      return 'Nube: sin conectar';
    case 'pendientes_viejos':
      return `Nube: ${String(pendientes)} pendientes (más de 24 h)`;
    case 'sin_conexion':
      return `Nube: sin conexión — ${String(pendientes)} pendientes`;
    case 'problema_al_sincronizar':
      return `Nube: problema al sincronizar — ${String(pendientes)} pendientes`;
    case 'pendientes':
      return `Nube: ${String(pendientes)} pendientes`;
    case 'al_dia':
      return 'Nube: al día';
  }
}
