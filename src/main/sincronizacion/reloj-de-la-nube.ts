/**
 * El reloj de esta máquina, medido contra el de Supabase — riesgo 8.5.
 *
 * ---------------------------------------------------------------------------
 * QUÉ PROBLEMA RESUELVE
 * ---------------------------------------------------------------------------
 * §8.5 del diseño: «todo depende de que Windows tenga la hora bien». La fecha
 * de una venta y el `creado_en` de cada fila salen del reloj local, el orden de
 * la cola es por `creado_en`, y el reporte del día corta en hora de Guatemala
 * sobre esas fechas (§4.15 de CLAUDE.md). Un reloj atrasado unas horas hace que
 * las ventas de hoy aparezcan en el reporte de ayer, **sin que nada falle**: la
 * peor forma de estar mal. El riesgo lo dejó propuesto y sin diseñar: «podría
 * compararlo contra la cabecera `Date` de las respuestas de Supabase y avisar
 * si el desfase pasa de un minuto».
 *
 * Esto es esa comparación. **No corrige el reloj y no lo toca**: cambiar la
 * hora del sistema es una acción administrativa que esta aplicación tiene
 * prohibido hacer, por la misma regla de §4.6 que prohíbe tocar los mecanismos
 * del sistema operativo. Lo único que hace es avisar.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO ALCANZA CON RESTAR, Y QUÉ SE HACE EN CAMBIO
 * ---------------------------------------------------------------------------
 * La resta ingenua —`Date.now() - Date.parse(cabecera)`— mide DOS cosas
 * mezcladas y no se puede saber cuál es cuál:
 *
 *   1. El desfase real del reloj, que es lo que se quiere.
 *   2. El viaje de ida y vuelta de la petición, que en una conexión de tienda
 *      puede ser medio segundo o tres.
 *
 * Y la cabecera `Date` de HTTP tiene resolución de UN SEGUNDO
 * (`Thu, 14 Sep 2026 17:07:35 GMT`), así que la hora real del servidor está en
 * algún punto de ese segundo, no en su borde.
 *
 * Por eso se mide como se mide la hora contra un servidor de tiempo, en chico:
 * se anota el reloj local ANTES de enviar y DESPUÉS de recibir, se compara el
 * PUNTO MEDIO de los dos contra el CENTRO del segundo que declara el servidor,
 * y se calcula una **incertidumbre** explícita —la mitad del viaje más medio
 * segundo de resolución—. El aviso se dispara solo cuando el desfase supera el
 * umbral **descontada esa incertidumbre**, o sea cuando no hay duda posible.
 *
 * Con eso, una conexión lenta no puede producir un aviso falso: lo único que
 * hace es agrandar la incertidumbre, y un desfase que no la supera no avisa.
 *
 * ---------------------------------------------------------------------------
 * ESTE UMBRAL NO ES EL DE `vida-del-token.ts`, Y NO SE MEZCLAN
 * ---------------------------------------------------------------------------
 * `DESFASE_QUE_MERECE_AVISO_S` (30 s) de `vida-del-token.ts` mide otra cosa por
 * otro camino: el `iat` del JWT contra el reloj local, una sola vez por sesión,
 * y su número sale de la cota medida de tolerancia de PostgREST (§4.22). El de
 * acá sale del texto de §8.5 —un minuto— y se mide en CADA respuesta de
 * cualquiera de los cuatro caminos que hablan con Supabase. Son dos
 * diagnósticos del mismo hecho con dos fuentes distintas; que los dos existan
 * es redundancia barata, y confundir sus números sería afirmar que uno está
 * medido cuando lo que está medido es el otro.
 */

/**
 * A partir de cuántos segundos de desfase se avisa. Sale del texto de §8.5:
 * «avisar si el desfase pasa de un minuto».
 *
 * **Un minuto no es el punto en que algo se rompe**, y conviene decirlo: el
 * JWT aguanta unos 30 s de desfase (§4.22) y el corte del día del reporte
 * aguanta horas. Es el punto en que un reloj deja de estar «bien puesto» y
 * empieza a merecer que alguien lo mire, que es justo lo que un aviso hace.
 */
export const DESFASE_DE_RELOJ_QUE_MERECE_AVISO_S = 60;

/** Milisegundos de un segundo, para no dejar el número suelto. */
const MS_POR_SEGUNDO = 1000;
const SEGUNDOS_POR_MINUTO = 60;
const MINUTOS_POR_HORA = 60;

/** La resolución de la cabecera `Date` de HTTP: un segundo entero. */
const RESOLUCION_DE_LA_CABECERA_MS = MS_POR_SEGUNDO;

/** Dos, porque se toma el PUNTO MEDIO entre dos instantes y la MITAD del viaje. */
const MITAD = 2;

/**
 * Cada cuánto, como mucho, se repite el aviso en la bitácora técnica.
 *
 * Sin esto, un reloj mal puesto escribiría una línea por cada petición —cientos
 * por día— y taparía todo lo demás. Una hora deja el aviso visible en cualquier
 * revisión de la bitácora sin convertirla en ruido.
 */
export const ESPERA_ENTRE_AVISOS_DE_RELOJ_MS = MINUTOS_POR_HORA * SEGUNDOS_POR_MINUTO * MS_POR_SEGUNDO;

/** Una medición del reloj local contra el del servidor. */
export interface LecturaDelReloj {
  /**
   * Segundos de desfase. **Positivo = esta máquina va ADELANTADA** respecto
   * del servidor; negativo = va atrasada.
   */
  readonly desfaseSegundos: number;
  /**
   * Cuánto de ese número puede ser ruido, en segundos: la mitad del viaje de
   * ida y vuelta más la resolución de la cabecera. Un desfase menor que esto
   * no significa nada.
   */
  readonly incertidumbreSegundos: number;
  /** Si el desfase supera el umbral incluso descontando la incertidumbre. */
  readonly mereceAviso: boolean;
}

/** Los tres datos de una respuesta que hacen falta para medir. */
export interface RespuestaObservada {
  /** La cabecera `Date` tal cual vino, o `null` si la respuesta no la trae. */
  readonly cabeceraDate: string | null;
  /** Reloj local justo ANTES de enviar la petición, en ms. */
  readonly enviadoEn: number;
  /** Reloj local justo DESPUÉS de recibir la respuesta, en ms. */
  readonly recibidoEn: number;
}

/**
 * Mide el desfase de una respuesta, o `null` si esa respuesta no sirve para
 * medir: sin cabecera, con una cabecera que no es una fecha, o con un par de
 * instantes locales incoherentes (el reloj saltó durante la petición).
 */
export function leerDesfaseDelReloj(respuesta: RespuestaObservada): LecturaDelReloj | null {
  const { cabeceraDate, enviadoEn, recibidoEn } = respuesta;
  if (cabeceraDate === null || cabeceraDate === '') {
    return null;
  }
  const delServidor = Date.parse(cabeceraDate);
  if (Number.isNaN(delServidor)) {
    return null;
  }
  if (!Number.isFinite(enviadoEn) || !Number.isFinite(recibidoEn) || recibidoEn < enviadoEn) {
    return null;
  }

  const puntoMedioLocal = (enviadoEn + recibidoEn) / MITAD;
  // El servidor declara un segundo entero; su hora real está en cualquier
  // punto de ese segundo, así que se compara contra el centro.
  const centroDelSegundoDelServidor = delServidor + RESOLUCION_DE_LA_CABECERA_MS / MITAD;
  const desfaseMs = puntoMedioLocal - centroDelSegundoDelServidor;
  const incertidumbreMs = (recibidoEn - enviadoEn) / MITAD + RESOLUCION_DE_LA_CABECERA_MS / MITAD;

  const desfaseSegundos = Math.round(desfaseMs / MS_POR_SEGUNDO);
  const incertidumbreSegundos = Math.ceil(incertidumbreMs / MS_POR_SEGUNDO);

  return {
    desfaseSegundos,
    incertidumbreSegundos,
    // Se descuenta la incertidumbre: solo avisa lo que no puede ser ruido.
    mereceAviso: Math.abs(desfaseMs) - incertidumbreMs > DESFASE_DE_RELOJ_QUE_MERECE_AVISO_S * MS_POR_SEGUNDO,
  };
}

/** Cómo se lee un desfase en la bitácora, sin que nadie tenga que pensar el signo. */
export function describirDesfase(lectura: LecturaDelReloj): string {
  const sentido = lectura.desfaseSegundos >= 0 ? 'ADELANTADO' : 'ATRASADO';
  const magnitud = Math.abs(lectura.desfaseSegundos);
  return `${String(magnitud)} s ${sentido} (±${String(lectura.incertidumbreSegundos)} s)`;
}

/**
 * El observador que se comparte entre todos los caminos que hablan con
 * Supabase: el proveedor de sincronización, el cliente de restauración, Auth y
 * el detector de conexión.
 *
 * Guarda la última lectura —para que una pantalla pueda mostrarla— y escribe
 * el aviso en la bitácora técnica como mucho una vez por hora.
 */
export class ObservadorDelRelojDeLaNube {
  private ultima: LecturaDelReloj | null = null;
  private ultimoAvisoEn: number | null = null;

  public constructor(
    private readonly registrar: (mensaje: string) => void,
    private readonly esperaEntreAvisosMs: number = ESPERA_ENTRE_AVISOS_DE_RELOJ_MS,
  ) {}

  /**
   * Mide una respuesta. Devuelve la lectura, o `null` si esa respuesta no
   * servía para medir. **Nunca lanza**: un reloj mal medido no puede hacer
   * fallar una subida ni una restauración.
   */
  public observar(respuesta: RespuestaObservada): LecturaDelReloj | null {
    /*
      EL TRY ENVUELVE TODO, INCLUIDO EL REGISTRADOR, y no es exceso de
      precaución: `observar` se llama en el camino de cada petición del
      proveedor, de Auth, del detector y de la restauración. La bitácora
      escribe en un archivo y puede fallar —disco lleno, permisos—, y un
      diagnóstico que tira abajo la subida que estaba observando sería peor que
      no tener diagnóstico. Lo encontró su propia prueba.
    */
    try {
      const lectura = leerDesfaseDelReloj(respuesta);
      if (lectura === null) {
        return null;
      }
      this.ultima = lectura;
      if (lectura.mereceAviso && this.tocaAvisar(respuesta.recibidoEn)) {
        this.ultimoAvisoEn = respuesta.recibidoEn;
        this.registrar(
          `AVISO: el reloj de esta máquina va ${describirDesfase(lectura)} respecto del servidor de Supabase. ` +
            'Con más de un minuto de diferencia, la fecha de las ventas y el corte del día del reporte dejan de ser ' +
            'confiables. Revisá la hora del sistema; la aplicación no la cambia.',
        );
      }
      return lectura;
    } catch {
      return null;
    }
  }

  /** La última medición, para mostrarla. `null` mientras no haya ninguna. */
  public ultimaLectura(): LecturaDelReloj | null {
    return this.ultima;
  }

  private tocaAvisar(ahora: number): boolean {
    return this.ultimoAvisoEn === null || ahora - this.ultimoAvisoEn >= this.esperaEntreAvisosMs;
  }
}
