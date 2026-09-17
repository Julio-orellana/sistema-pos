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
 * Los seis estados posibles. Es una lista en tiempo de ejecución, no solo un
 * tipo, para que las pruebas recorran TODOS: un estado nuevo agregado sin
 * texto o sin color no puede pasar en silencio.
 */
export const ESTADOS_DE_SINCRONIZACION = [
  /** Un lote quedó detenido con un error determinístico. */
  'detenida',
  /** No hay credencial guardada, o la nube la rechazó. */
  'sin_credencial',
  /** Hay pendientes y el más viejo pasa el umbral de 24 h. */
  'pendientes_viejos',
  /** Hay credencial pero no hay token vigente ahora mismo, y hay pendientes. */
  'sin_conexion',
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
 * Los estados que el diseño no menciona explícitamente (`pendientes`,
 * `sin_conexion`) quedan neutrales por omisión: son normales y transitorios,
 * y solo escalan a ámbar el día que los pendientes se vuelven viejos.
 */
export function colorDeEstado(estado: EstadoDeSincronizacion): ColorDeEstado {
  if (estado === 'detenida' || estado === 'sin_credencial') {
    return 'rojo';
  }
  if (estado === 'pendientes_viejos') {
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
    case 'sin_credencial':
      return 'Nube: sin conectar';
    case 'pendientes_viejos':
      return `Nube: ${String(pendientes)} pendientes (más de 24 h)`;
    case 'sin_conexion':
      return `Nube: sin conexión — ${String(pendientes)} pendientes`;
    case 'pendientes':
      return `Nube: ${String(pendientes)} pendientes`;
    case 'al_dia':
      return 'Nube: al día';
  }
}
