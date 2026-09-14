/**
 * Cuándo volver a intentar un lote que falló, y por qué motivo falló.
 *
 * Son dos funciones puras y viven juntas porque contestan las dos mitades de
 * la misma pregunta de `docs/SINCRONIZACION.md` §3.2: **qué clase de fallo fue
 * y, si se puede reintentar, cuándo**. Puras a propósito: se prueban con una
 * tabla de casos escritos, sin base de datos, sin red y sin reloj.
 */

import type { ResultadoEmpuje } from '@shared/adapters';

// ===========================================================================
// CLASIFICACIÓN DE FALLOS
// ===========================================================================

/**
 * Las tres clases de fallo de §3.2. No hay una cuarta, y la diferencia entre
 * ellas decide si la tienda queda respaldada o no.
 */
export type ClaseDeFallo =
  /** Sin red, tiempo agotado, DNS, 5xx, 429. Se reintenta sin límite. */
  | 'transitorio'
  /** 400, 403, 409, 422. DETIENE la cola: reintentar no lo va a arreglar. */
  | 'deterministico'
  /** 401. La cola no se toca hasta reprovisionar la credencial. */
  | 'credencial'
  /**
   * El archivo que había que subir ya no está en este disco (§2.5.4).
   *
   * NO es bloqueante y NO detiene la cola: el disco perdió una foto, no la
   * tienda. Se aparta un día y se vuelve a mirar, por si el archivo reaparece
   * —una carpeta restaurada a medias, un respaldo que terminó de copiarse—.
   * La fila de `productos` con su `foto_path` sube igual: la nube sabe que ese
   * producto TENÍA foto aunque no la tenga.
   */
  | 'archivo_ausente';

/**
 * Cuánto se espera antes de volver a buscar un archivo que no estaba.
 *
 * Un día, de §2.5.4. No usa la escalera de reintentos porque no es el mismo
 * problema: la escalera existe para una nube que ahora no puede y en un rato
 * sí, y acá lo que falta es un archivo en el disco. Nada de lo que pase en el
 * próximo minuto lo va a traer de vuelta, y preguntarlo cada minuto solo
 * llenaría la bitácora.
 */
const UN_DIA = { horas: 24, minutosPorHora: 60, segundosPorMinuto: 60, msPorSegundo: 1000 } as const;
export const ESPERA_POR_ARCHIVO_AUSENTE_MS =
  UN_DIA.horas * UN_DIA.minutosPorHora * UN_DIA.segundosPorMinuto * UN_DIA.msPorSegundo;

/**
 * Códigos que son transitorios aunque sean 4xx.
 *
 * `408` y `425` son del propio protocolo pidiendo que se reintente, y `429` es
 * el límite de tasa: reintentarlo más tarde es literalmente lo que el servidor
 * está pidiendo. Tratarlos como determinísticos detendría la cola por algo que
 * se arregla solo esperando.
 */
const CODIGOS = {
  credencialRechazada: 401,
  tiempoDeEsperaAgotado: 408,
  demasiadoPronto: 425,
  limiteDeTasa: 429,
  primerErrorDelServidor: 500,
} as const;

const CUATROCIENTOS_QUE_SE_REINTENTAN: readonly number[] = [
  CODIGOS.tiempoDeEsperaAgotado,
  CODIGOS.demasiadoPronto,
  CODIGOS.limiteDeTasa,
];

/**
 * De qué clase es este fallo.
 *
 * **La ausencia de código HTTP se lee como transitorio**, y es el caso más
 * común de todos: no hubo respuesta porque no hubo red. Clasificarlo como
 * determinístico detendría la cola cada vez que se cae el internet de la
 * tienda, que es justamente el escenario para el que la cola existe.
 *
 * **Un código por debajo de 400 con `ok: false` sí detiene la cola**, aunque
 * parezca contradictorio: significa que el adaptador devolvió algo incoherente
 * —una respuesta buena marcada como fallida— y eso es un defecto de
 * programación, no un problema de red. Reintentarlo en bucle lo escondería;
 * detener la cola lo pone a la vista, que es el criterio de §3.2.
 */
export function clasificarFallo(
  resultado: Pick<ResultadoEmpuje, 'estadoHttp' | 'archivoAusente'>,
): ClaseDeFallo {
  const estado = resultado.estadoHttp;

  /*
    VA PRIMERO, ANTES DE MIRAR NINGÚN CÓDIGO. Un archivo ausente no es una
    respuesta de la nube: la petición ni se hizo. §2.5.4 pide que NO sea
    bloqueante —el disco perdió una foto, la tienda no— y que se reintente una
    vez al día por si el archivo vuelve.
  */
  if (resultado.archivoAusente === true) {
    return 'archivo_ausente';
  }

  if (estado === undefined) {
    return 'transitorio';
  }
  if (estado === CODIGOS.credencialRechazada) {
    return 'credencial';
  }
  if (estado >= CODIGOS.primerErrorDelServidor) {
    return 'transitorio';
  }
  if (CUATROCIENTOS_QUE_SE_REINTENTAN.includes(estado)) {
    return 'transitorio';
  }
  return 'deterministico';
}

// ===========================================================================
// BACKOFF
// ===========================================================================

/**
 * Los peldaños de §3.2, en milisegundos, con su nombre.
 *
 * Van en un objeto y no sueltos para que cada número tenga un nombre al lado:
 * un `120_000` perdido en un arreglo no dice «dos minutos» a nadie.
 */
const ESPERAS_MS = {
  /** 5 segundos */
  primera: 5_000,
  /** 30 segundos */
  segunda: 30_000,
  /** 2 minutos */
  tercera: 120_000,
  /** 10 minutos */
  cuarta: 600_000,
  /** 30 minutos */
  quinta: 1_800_000,
  /** 1 hora, y de ahí en adelante siempre esta */
  techo: 3_600_000,
} as const;

/**
 * La escalera de esperas de §3.2: 5 s, 30 s, 2 min, 10 min, 30 min y después
 * **cada hora**.
 *
 * Es la que el diseño fijó, no una inventada acá. Crece de forma exponencial
 * —cada peldaño es entre 3 y 6 veces el anterior— pero con un techo: una
 * exponencial pura llegaría a días de espera, y una tienda que estuvo una
 * semana sin internet tiene que volver a subir dentro de la hora siguiente a
 * que vuelva la conexión, no dentro de tres días.
 */
export const ESCALERA_DE_ESPERA_MS: readonly number[] = [
  ESPERAS_MS.primera,
  ESPERAS_MS.segunda,
  ESPERAS_MS.tercera,
  ESPERAS_MS.cuarta,
  ESPERAS_MS.quinta,
  ESPERAS_MS.techo,
];

/**
 * Cuánta variación aleatoria se le aplica a la espera: ±20 %.
 *
 * **No es «full jitter»** —una espera al azar entre cero y el peldaño— y la
 * diferencia importa: con full jitter, el primer reintento podría caer a los
 * pocos milisegundos, o sea no esperar nada, que es lo contrario de lo que un
 * backoff existe para hacer. Con ±20 % la espera sigue siendo la del diseño y
 * lo único que se rompe es la sincronía exacta con la ventana de un límite de
 * tasa del servidor.
 */
export const VARIACION = 0.2;

/**
 * Cuántos milisegundos esperar después del intento número `intento`.
 *
 * `intento` es 1 para el primer fallo. Se le pasa el número del intento que
 * ACABA de fallar, no el siguiente: es el valor que `sync_cola.intentos` tiene
 * ya sumado, así que la espera y la columna no pueden desalinearse.
 *
 * `azar` se inyecta para que las pruebas puedan fijar la variación en vez de
 * medir un rango: una prueba que solo comprueba «cayó entre 4 y 6 segundos»
 * pasa igual si el cálculo está mal.
 */
export function esperaTrasIntento(intento: number, azar: () => number = Math.random): number {
  const indice = Math.min(Math.max(intento, 1), ESCALERA_DE_ESPERA_MS.length) - 1;
  const base = ESCALERA_DE_ESPERA_MS[indice] ?? ESCALERA_DE_ESPERA_MS[0] ?? ESPERAS_MS.primera;

  // azar() da [0, 1); llevarlo a [-1, 1) y multiplicarlo por VARIACION da ±20 %.
  const AMPLITUD = 2;
  const desvio = (azar() * AMPLITUD - 1) * VARIACION;
  return Math.round(base * (1 + desvio));
}

/**
 * El instante ISO en que toca el próximo intento.
 *
 * Se devuelve como cadena ISO-8601 en UTC porque así es como se guarda, y el
 * CHECK `sync_cola_proximo_intento_iso` de la migración 018 exige esa forma.
 */
export function proximoIntentoTras(
  intento: number,
  ahoraMs: number,
  azar: () => number = Math.random,
): string {
  return new Date(ahoraMs + esperaTrasIntento(intento, azar)).toISOString();
}
