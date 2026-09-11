/**
 * La señal con la que el trabajador de sincronización sabe que hay una venta
 * en curso y tiene que apartarse.
 *
 * ===========================================================================
 * POR QUÉ UNA BANDERA EN MEMORIA Y NO OTRA COSA
 * ===========================================================================
 *
 * `docs/SINCRONIZACION.md` §2.4 lo especifica así, y la razón está en el
 * motor: **better-sqlite3 es SÍNCRONO y la aplicación tiene una sola
 * conexión**. Eso tiene dos consecuencias que mandan sobre el diseño:
 *
 *   1. **No hay forma de preguntarle a SQLite «¿hay una transacción abierta de
 *      otro?»**, porque no hay otro. `base.inTransaction` existe y dice si
 *      ESTA conexión está dentro de una transacción, que es justamente lo que
 *      hace falta saber, pero solo es verdad mientras el hilo está adentro de
 *      la transacción: para cuando el trabajador pudiera leerlo desde un
 *      `setTimeout`, la transacción ya terminó. La bandera responde la misma
 *      pregunta y la responde donde importa.
 *   2. **El peligro real no es la contención de bloqueos, es la CONFUSIÓN DE
 *      TRANSACCIONES.** Si el trabajador escribiera `sincronizado_en` mientras
 *      la transacción de la venta está abierta, esa escritura entraría en la
 *      transacción de la venta —misma conexión— y se revertiría con ella si la
 *      venta fallara, marcando como pendiente un lote que la nube ya aceptó. Y
 *      al revés: el trabajador tendría en sus manos el poder de dejar a medias
 *      una venta que ya se cobró. Ceder no es una cortesía de rendimiento: es
 *      lo que mantiene separadas dos unidades de trabajo que nunca deben
 *      mezclarse.
 *
 * ===========================================================================
 * CÓMO SE USA
 * ===========================================================================
 *
 * `ServicioDeVenta` envuelve su transacción con `durante(...)`. El trabajador
 * pregunta con `hayVentaEnCurso()` **antes de tocar la base**, de forma
 * SÍNCRONA y antes de su primer `await`: si esperara a después de un `await`,
 * la pregunta se contestaría en otro turno del bucle de eventos y la respuesta
 * ya no valdría para el momento en que va a escribir.
 *
 * El contador —y no un booleano— es por prudencia, no porque hoy pueda haber
 * dos ventas encimadas: con una sola conexión síncrona no puede. Pero un
 * booleano que se baja en el `finally` de la venta interna apagaría la señal
 * de la externa, y ese es exactamente el defecto silencioso que esta pieza
 * existe para evitar.
 */

/** Cuántas transacciones de venta hay abiertas ahora mismo. */
let ventasEnCurso = 0;

/**
 * Ejecuta `operacion` con la señal levantada, y la baja pase lo que pase.
 *
 * El `finally` no es decorativo: si la venta lanza —un conflicto de
 * inventario, un CHECK de la base— la transacción se revierte y la señal tiene
 * que bajar igual. Sin él, un solo error dejaría al trabajador cediendo para
 * siempre y la cola no volvería a subir nada, en silencio.
 */
export function durante<T>(operacion: () => T): T {
  ventasEnCurso += 1;
  try {
    return operacion();
  } finally {
    ventasEnCurso -= 1;
  }
}

/** `true` si hay al menos una transacción de venta abierta en este instante. */
export function hayVentaEnCurso(): boolean {
  return ventasEnCurso > 0;
}

/**
 * Solo para pruebas: deja el contador en cero.
 *
 * No lo usa el código de producción y no debería: en producción el contador
 * solo se mueve por `durante`, que garantiza el par subir/bajar.
 */
export function reiniciarSenalDeVenta(): void {
  ventasEnCurso = 0;
}
