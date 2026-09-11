/**
 * La señal con la que el trabajador de sincronización sabe que hay una
 * transacción de negocio abierta y tiene que apartarse.
 *
 * ===========================================================================
 * ES DE TODA TRANSACCIÓN DE NEGOCIO, NO SOLO DE LA VENTA
 * ===========================================================================
 *
 * **Nació específica de la venta en la fase 1.b, y estaba mal.** El peligro que
 * describe la sección siguiente no tiene nada que ver con vender: es una
 * consecuencia de que la aplicación tenga **una sola conexión** a SQLite, así
 * que aplica igual a abrir la caja, cerrarla, crear un usuario, editar una
 * categoría, ajustar inventario, fijar un tope de descuento o guardar los datos
 * del negocio. Proteger solo la venta dejaba las otras siete operaciones con el
 * mismo agujero y la falsa sensación de que estaba cubierto.
 *
 * **Por eso la señal no se levanta a mano en cada servicio, sino que va DENTRO
 * de `enTransaccionDeNegocio`**, que es la única forma en que el proyecto abre
 * una transacción de negocio. No se puede abrir una sin levantar la señal
 * porque no hay dos caminos: el que se olvide de usar este envoltorio no
 * «olvida la señal», directamente no abre transacción.
 *
 * ===========================================================================
 * EL PELIGRO REAL NO ES LA CONTENCIÓN DE BLOQUEOS
 * ===========================================================================
 *
 * Con una sola conexión síncrona, un ciclo del trabajador lanzado desde dentro
 * de una transacción abierta **lee las filas que esa transacción todavía no
 * confirmó** —una conexión ve siempre sus propias escrituras pendientes—. Si la
 * transacción después se revierte, la nube se queda con un cambio que en la
 * tienda nunca ocurrió. Y en el otro sentido: una escritura del trabajador
 * hecha en ese momento entraría en la transacción ajena y se revertiría con
 * ella, marcando como pendiente un lote que la nube ya aceptó.
 *
 * Las dos cosas están probadas por falsificación, no razonadas: hay pruebas que
 * apagan la señal a propósito, lanzan el ciclo desde dentro de una transacción
 * que después falla, y comprueban que la fila no quedó en la base y que la nube
 * la recibió igual.
 *
 * ===========================================================================
 * POR QUÉ UNA BANDERA Y NO `base.inTransaction`
 * ===========================================================================
 *
 * `better-sqlite3` expone `base.inTransaction`, que dice exactamente lo que
 * hace falta saber. No sirve: **solo es verdad mientras el hilo está dentro de
 * la transacción**, y para cuando el trabajador pudiera leerlo desde un
 * temporizador la transacción ya terminó. La bandera contesta la misma pregunta
 * y la contesta donde importa, que es en el instante en que el trabajador está
 * a punto de leer la cola.
 *
 * El contador —y no un booleano— es por prudencia: un booleano que se baja en
 * el `finally` de una transacción interna apagaría la señal de la externa, y
 * ese es exactamente el defecto silencioso que esta pieza existe para evitar.
 */

import type { Database } from 'better-sqlite3';

/** Cuántas transacciones de negocio hay abiertas ahora mismo. */
let transaccionesAbiertas = 0;

/**
 * Ejecuta `operacion` con la señal levantada, y la baja pase lo que pase.
 *
 * El `finally` no es decorativo: si la operación lanza —un conflicto de
 * inventario, un CHECK de la base— la transacción se revierte y la señal tiene
 * que bajar igual. Sin él, un solo error dejaría al trabajador cediendo para
 * siempre y la cola no volvería a subir nada, en silencio.
 *
 * Se exporta aparte de `enTransaccionDeNegocio` para las pruebas y para el caso
 * en que haya que señalizar un bloque que ya está dentro de una transacción
 * abierta por otro. **El código de negocio normal usa `enTransaccionDeNegocio`.**
 */
export function durante<T>(operacion: () => T): T {
  transaccionesAbiertas += 1;
  try {
    return operacion();
  } finally {
    transaccionesAbiertas -= 1;
  }
}

/**
 * LA ÚNICA FORMA DE ABRIR UNA TRANSACCIÓN DE NEGOCIO en este proyecto.
 *
 * Abre la transacción de better-sqlite3 y la corre con la señal levantada. Que
 * las dos cosas ocurran juntas y en un solo lugar es lo que hace imposible
 * abrir una transacción sin señalizarla.
 *
 * **No lo usan el migrador ni los guiones de datos de ejemplo**, y es correcto:
 * el migrador corre antes de que exista el trabajador, y los guiones corren en
 * un proceso que no abre ventana ni arranca la sincronización. Señalizarlos no
 * haría daño, pero fingiría proteger algo que no está expuesto.
 */
export function enTransaccionDeNegocio<T>(base: Database, operacion: () => T): T {
  const transaccion = base.transaction(operacion);
  return durante(() => transaccion());
}

/** `true` si hay al menos una transacción de negocio abierta en este instante. */
export function hayTransaccionDeNegocioEnCurso(): boolean {
  return transaccionesAbiertas > 0;
}

/**
 * Solo para pruebas: deja el contador en cero.
 *
 * No lo usa el código de producción y no debería: en producción el contador
 * solo se mueve por `durante`, que garantiza el par subir/bajar.
 */
export function reiniciarSenalDeTransaccion(): void {
  transaccionesAbiertas = 0;
}
