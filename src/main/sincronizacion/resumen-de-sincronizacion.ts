/**
 * Qué ESTADO muestra la sincronización, y con qué color.
 *
 * ===========================================================================
 * POR QUÉ ES UN MÓDULO PURO, SEPARADO DEL SERVICIO
 * ===========================================================================
 *
 * Es la misma separación que ya tienen `vida-del-token.ts` y `reintentos.ts`:
 * la lógica que decide algo se prueba sin SQLite y sin reloj real, y el
 * servicio (`servicio-de-sincronizacion.ts`) se limita a leer la base y a
 * llamar a estas funciones con lo que leyó.
 *
 * ===========================================================================
 * LOS TRES NIVELES DE VISIBILIDAD DE §3.3 DEL DISEÑO, EN UN SOLO CÁLCULO
 * ===========================================================================
 *
 * `docs/SINCRONIZACION.md` §3.3 describe tres lugares que muestran esto —la
 * barra de estado (siempre), un aviso al iniciar sesión (solo administrativo,
 * con pendientes de más de 24 h, cola detenida o sin credencial) y la
 * pantalla de sincronización (solo administrativo)— pero los TRES leen el
 * mismo estado subyacente. Por eso hay un solo cálculo acá, y cada superficie
 * decide cuánto de él mostrar.
 */

/** Los seis estados posibles, del más al menos grave para el color. */
export type EstadoDeSincronizacion =
  /** Un lote quedó detenido con un error determinístico. */
  | 'detenida'
  /** No hay credencial guardada, o la nube la rechazó. */
  | 'sin_credencial'
  /** Hay pendientes y el más viejo pasa el umbral de 24 h. */
  | 'pendientes_viejos'
  /** Hay credencial pero no hay token vigente ahora mismo, y hay pendientes. */
  | 'sin_conexion'
  /** Hay pendientes, recientes, y nada más raro. */
  | 'pendientes'
  /** Sin pendientes. */
  | 'al_dia';

/**
 * El umbral de 24 horas de la decisión 8 del diseño.
 *
 * **ES UN NÚMERO PROVISIONAL, tal como el propio diseño lo marca**: «separa
 * "se cortó internet un rato" de "algo está mal"». Julio puede revisarlo.
 */
const HORAS_DEL_UMBRAL = 24;
const MINUTOS_POR_HORA = 60;
const SEGUNDOS_POR_MINUTO = 60;
const MS_POR_SEGUNDO = 1000;
export const UMBRAL_DE_PENDIENTES_VIEJOS_MS =
  HORAS_DEL_UMBRAL * MINUTOS_POR_HORA * SEGUNDOS_POR_MINUTO * MS_POR_SEGUNDO;

/** Estado de la credencial, o `null` cuando esta copia no tiene nube configurada. */
export interface CredencialParaElResumen {
  readonly hayCredencial: boolean;
  readonly revocada: boolean;
  readonly conectada: boolean;
}

/** Lo que hace falta para decidir el estado, ya leído de la base. */
export interface DatosCrudosDeSincronizacion {
  /** `null` cuando esta copia de la aplicación no tiene ningún proyecto de nube. */
  readonly credencial: CredencialParaElResumen | null;
  readonly pendientes: number;
  /** `creado_en` de la fila pendiente más vieja, ISO-8601, o `null` si no hay ninguna. */
  readonly pendienteMasViejaDesde: string | null;
  readonly hayLoteBloqueante: boolean;
  /** Reloj de pared, en ISO-8601. Se inyecta para que el cálculo sea puro y testeable. */
  readonly ahoraIso: string;
}

/**
 * Calcula el estado, en el orden de prioridad que decide QUÉ SE MUESTRA
 * cuando varias cosas son ciertas a la vez.
 *
 * El orden importa y está pensado así:
 *
 *   1. **Sin credencial primero, antes que «detenida».** Sin credencial nada
 *      va a subir pase lo que pase con ningún lote puntual: es la causa más
 *      de fondo, y mostrar «DETENIDA» insinuaría que reintentar alcanzaría.
 *   2. **Detenida.** Un lote con error determinístico no se destraba solo.
 *   3. **Pendientes viejos.** Ya hay algo mal, aunque no haya ni credencial
 *      caída ni lote bloqueante: lleva más de 24 h sin subir.
 *   4. **Sin conexión.** Hay credencial válida, no está revocada, pero ahora
 *      mismo no hay token vigente y hay algo esperando: probablemente un
 *      corte de red pasajero.
 *   5. **Pendientes.** Nada raro, solo lo normal de estar armando lotes.
 *   6. **Al día.**
 */
export function calcularEstadoDeSincronizacion(
  datos: DatosCrudosDeSincronizacion,
): EstadoDeSincronizacion {
  const { credencial } = datos;

  if (credencial !== null && (!credencial.hayCredencial || credencial.revocada)) {
    return 'sin_credencial';
  }

  if (datos.hayLoteBloqueante) {
    return 'detenida';
  }

  if (datos.pendienteMasViejaDesde !== null) {
    const edadMs = Date.parse(datos.ahoraIso) - Date.parse(datos.pendienteMasViejaDesde);
    if (edadMs >= UMBRAL_DE_PENDIENTES_VIEJOS_MS) {
      return 'pendientes_viejos';
    }
  }

  if (credencial !== null && !credencial.conectada && datos.pendientes > 0) {
    return 'sin_conexion';
  }

  if (datos.pendientes > 0) {
    return 'pendientes';
  }

  return 'al_dia';
}

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
 * exacto en que se perdió la conexión (el detector solo guarda el ÚLTIMO
 * veredicto, no cuándo cambió), y escribir una hora ahí sería inventar una
 * precisión que no se midió. En su lugar se dice cuántos pendientes hay, que
 * sí es un dato real.
 */
export function textoDeBarraDeEstado(
  estado: EstadoDeSincronizacion,
  pendientes: number,
): string {
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
