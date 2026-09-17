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

import type { EstadoDeSincronizacion } from '@shared/estado-de-sincronizacion';

/*
  La lista de estados, su color y su texto viven en `src/shared`, en UNA sola
  copia que usan este módulo y la barra de estado (ver la cabecera de
  `estado-de-sincronizacion.ts`). Se reexportan para que nadie de este lado
  tenga que saber dónde están.
*/
export {
  colorDeEstado,
  ESTADOS_DE_SINCRONIZACION,
  textoDeBarraDeEstado,
  type ColorDeEstado,
  type EstadoDeSincronizacion,
} from '@shared/estado-de-sincronizacion';

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
  /** Hay un access token en memoria. NO prueba que se llegue a la nube: ver `ConexionTrasUnFallo`. */
  readonly conectada: boolean;
  /**
   * La sesión ya terminó su primer intento de conectarse en este arranque
   * (`SesionDeNube.primerIntentoTerminado`). Antes de eso, que no haya token
   * no dice nada de la red: todavía no se preguntó (§4.51).
   */
  readonly yaSeIntentoConectar: boolean;
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
  /**
   * Lo que el trabajador MIDIÓ justo después del último fallo transitorio de
   * una subida, o `null` si todavía no midió nada en este arranque. Vive en
   * memoria: un arranque nuevo no sabe nada hasta volver a fallar y medir.
   */
  readonly conexionTrasElUltimoFallo: ConexionTrasUnFallo | null;
  /**
   * Los `intentos` que HOY tiene en la cola el lote de esa medición, o `null`
   * si ese lote ya no está pendiente. Es lo que dice si la medición sigue
   * siendo de ESTE fallo: si el lote volvió a fallar, sus intentos subieron y
   * la medición es de un fallo anterior.
   */
  readonly intentosActualesDelLoteMedido: number | null;
  /**
   * El fallo que el trabajador está midiendo AHORA MISMO, o `null`. La
   * comprobación puede tardar hasta 8 s; mientras tanto, si es un fallo nuevo
   * del MISMO lote, sigue valiendo la medición anterior en vez de dejar la
   * barra un momento sin decir nada (medido el 2026-09-17 en el escenario E).
   */
  readonly medicionEnCurso: FalloQueSeEstaMidiendo | null;
}

/** Un fallo cuya comprobación de conexión todavía no terminó. */
export interface FalloQueSeEstaMidiendo {
  readonly loteId: string;
  readonly intentos: number;
}

/**
 * La comprobación de la capa 2 (§5.2 del diseño: `GET /auth/v1/health`, con
 * la cabecera del proyecto y el cuerpo de GoTrue) hecha JUSTO DESPUÉS de que
 * una subida fallara de forma transitoria.
 *
 * **Es la única forma honesta de separar «no hay conexión» de «hay conexión
 * pero la subida falla».** El fallo de la subida solo no alcanza: una subida
 * que no contesta en 30 s se ve igual con la red caída que con un servidor
 * trabado. Y `conectada` tampoco: dice que hay un access token en memoria, y
 * ese token NO se borra cuando una renovación falla por la red
 * (`sesion-de-nube.ts`), así que con la red caída a mitad del día sigue en
 * `true`. Lo que distingue los dos casos es preguntarle a la nube, después
 * del fallo, si contesta.
 */
export interface ConexionTrasUnFallo {
  /** El lote cuya subida falló. */
  readonly loteId: string;
  /** Su número de intento fallido, que es lo que la cola anota en `intentos`. */
  readonly intentos: number;
  /** Lo que dijo la capa 2 después de ese fallo. */
  readonly hayNube: boolean;
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
 *   4. **Sin conexión.** Hay credencial válida, no está revocada, la sesión
 *      YA INTENTÓ conectarse en este arranque, y no hay token vigente con algo
 *      esperando: probablemente un corte de red pasajero. Antes de ese primer
 *      intento no se afirma nada: no hay token porque todavía no se preguntó.
 *   5. **Después de un fallo MEDIDO: problema al sincronizar, o sin
 *      conexión.** Hay token, pero la última subida falló y la capa 2 se
 *      comprobó después. Si la nube de este proyecto contestó, hay conexión y
 *      lo que falla es la subida: `problema_al_sincronizar`. Si no contestó,
 *      es `sin_conexion`, aunque haya token (la red se cayó a mitad del día).
 *      Solo cuenta si la medición es del fallo de AHORA: si el lote volvió a
 *      fallar después, todavía no se sabe y no se afirma nada.
 *   6. **Pendientes.** Nada raro, solo lo normal de estar armando lotes; o un
 *      fallo que todavía no se midió.
 *   7. **Al día.**
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

  if (
    credencial !== null &&
    !credencial.conectada &&
    credencial.yaSeIntentoConectar &&
    datos.pendientes > 0
  ) {
    return 'sin_conexion';
  }

  const medicion = datos.conexionTrasElUltimoFallo;
  if (credencial !== null && datos.pendientes > 0 && medicion !== null && medicionVigente(datos, medicion)) {
    return medicion.hayNube ? 'problema_al_sincronizar' : 'sin_conexion';
  }

  if (datos.pendientes > 0) {
    return 'pendientes';
  }

  return 'al_dia';
}

/**
 * ¿La medición habla del fallo de AHORA?
 *
 * Sí cuando el lote medido sigue pendiente con el mismo número de intentos. Y
 * también mientras se mide un fallo NUEVO de ese mismo lote: la medición
 * anterior sigue siendo lo último que se sabe hasta que la nueva termine. Con
 * otro lote, o con un intento que ya no se está midiendo, no.
 */
function medicionVigente(datos: DatosCrudosDeSincronizacion, medicion: ConexionTrasUnFallo): boolean {
  const actuales = datos.intentosActualesDelLoteMedido;
  if (actuales === medicion.intentos) {
    return true;
  }
  const enCurso = datos.medicionEnCurso;
  return (
    enCurso !== null &&
    enCurso.loteId === medicion.loteId &&
    enCurso.intentos === actuales &&
    medicion.intentos < enCurso.intentos
  );
}
