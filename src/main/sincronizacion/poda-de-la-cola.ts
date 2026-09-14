/**
 * La poda de `sync_cola` — riesgo 8.6.
 *
 * ---------------------------------------------------------------------------
 * QUÉ PROBLEMA RESUELVE
 * ---------------------------------------------------------------------------
 * §8.6 del diseño: cada fila de negocio deja una fila en la cola, para
 * siempre, con su payload completo al lado. La estimación de ahí es de unas
 * **150 000 entradas al año**, «decenas de megabytes en un disco que además
 * guarda PDF». Nada las borra hoy, así que la cola de una tienda no para de
 * crecer aunque no quede nada por subir.
 *
 * ---------------------------------------------------------------------------
 * BORRAR ACÁ SÍ SE JUSTIFICA, Y ESTA ES LA RAZÓN COMPLETA
 * ---------------------------------------------------------------------------
 * La regla del proyecto es que **nada se borra**: ni un producto, ni una
 * categoría, ni un usuario (§4.11), porque todos tienen historial detrás. La
 * única excepción hasta hoy eran los datos de ejemplo, y se justificó así:
 * «estos registros no tienen historial que proteger».
 *
 * `sync_cola` es el segundo caso, y por el mismo motivo escrito con precisión:
 * **no es historial del negocio, es una lista de tareas.** El hecho de negocio
 * —la venta, el asiento, el recibo— vive en SU tabla y no se toca; la nube ya
 * tiene su copia, confirmada por la marca `sincronizado_en` que solo se
 * escribe cuando la función de Postgres respondió que sí (§4.18). Lo que se
 * borra es la anotación de que ESO faltaba subir. Su razón de existir se agotó
 * el día que se subió.
 *
 * Dicho al revés, que es como conviene comprobarlo: **si esta tabla se borrara
 * entera, no se perdería ni un dato del negocio.** Lo que se perdería es la
 * capacidad de contestar «¿esta venta llegó a la nube, y cuándo?» sin ir a
 * mirar la nube. Eso es lo que el período de gracia protege.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ TREINTA DÍAS
 * ---------------------------------------------------------------------------
 * El número tiene que cubrir la pregunta más tardía que alguien puede hacerle
 * a esta tabla, y nada más. Esa pregunta es de auditoría y llega con el cierre
 * del mes: «esta venta de fin de mes, ¿subió?». Treinta días cubren un ciclo
 * mensual entero más la revisión que viene justo después.
 *
 * Lo que el número NO tiene que cubrir, y conviene decirlo para que nadie lo
 * agrande «por las dudas»:
 *
 *   · **Una tienda sin internet mucho tiempo.** Eso no lo toca la poda: lo que
 *     no subió no tiene `sincronizado_en` y no se borra nunca, por más años
 *     que pasen.
 *   · **La escalera de reintentos**, que tiene techo de una hora (§3.2).
 *   · **Un lote detenido**, que es un pendiente y tampoco se toca.
 *
 * Con la estimación de §8.6 —150 000 filas al año— treinta días dejan la cola
 * en el orden de **12 000 filas** en vez de crecer sin fin, y el archivo deja
 * de crecer por esta vía después del primer mes.
 *
 * **Es un número elegido, no medido, y se puede cambiar**: está acá en una
 * constante y no hay ninguna otra regla que dependa de él. Si algún día la
 * tienda quiere conservar un trimestre, es cambiar el 30 por 90 y aceptar tres
 * veces el tamaño.
 *
 * ---------------------------------------------------------------------------
 * CUÁNDO CORRE
 * ---------------------------------------------------------------------------
 * En el trabajador, **al principio de un ciclo y como mucho una vez cada 24 h**
 * (§8.6 dejaba esto sin decidir: «si se hace en arranque o en un ciclo del
 * trabajador»). Las dos cosas a la vez, en realidad, y sale gratis: el
 * planificador agenda un ciclo 30 s después de abrir la ventana (§4.18), así
 * que la primera poda de cada arranque ocurre ahí, y el tope de 24 h cubre a
 * la terminal que queda encendida semanas.
 *
 * El contador vive **en memoria** a propósito. Persistirlo sería una columna o
 * un archivo nuevo para ahorrar un `DELETE` por arranque que ya es barato; y
 * en la tienda la aplicación se apaga todas las noches, así que en la práctica
 * es una poda por día de todos modos.
 *
 * **Cede ante una transacción de negocio**, como todo lo que el trabajador
 * hace (§4.18): la poda escribe, y con una sola conexión no tiene por qué
 * meterse en medio de una venta.
 */

import type { RepositorioDeSyncCola } from '@main/database/repositories/sync-cola';

const HORAS_POR_DIA = 24;
const MINUTOS_POR_HORA = 60;
const SEGUNDOS_POR_MINUTO = 60;
const MS_POR_SEGUNDO = 1000;
const MS_POR_DIA = HORAS_POR_DIA * MINUTOS_POR_HORA * SEGUNDOS_POR_MINUTO * MS_POR_SEGUNDO;

/** Cuántos días de cola ya subida se conservan. Ver el encabezado. */
export const DIAS_QUE_SE_CONSERVAN = 30;

/** Cada cuánto, como mucho, se repite la poda mientras la aplicación siga abierta. */
export const ESPERA_ENTRE_PODAS_MS = MS_POR_DIA;

export interface DependenciasDeLaPoda {
  readonly cola: RepositorioDeSyncCola;
  /** Reloj inyectable, para que las pruebas no dependan del real. */
  readonly ahora?: () => number;
  /** Va a la bitácora TÉCNICA, nunca a `auditoria_log`: es mantenimiento, no un hecho del negocio. */
  readonly registrar?: (mensaje: string) => void;
  readonly diasQueSeConservan?: number;
  readonly esperaEntrePodasMs?: number;
}

export class PodaDeLaCola {
  private readonly cola: RepositorioDeSyncCola;
  private readonly ahora: () => number;
  private readonly registrar: (mensaje: string) => void;
  private readonly dias: number;
  private readonly espera: number;
  private ultimaPodaEn: number | null = null;

  public constructor(dependencias: DependenciasDeLaPoda) {
    this.cola = dependencias.cola;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
    this.registrar = dependencias.registrar ?? ((): void => undefined);
    this.dias = dependencias.diasQueSeConservan ?? DIAS_QUE_SE_CONSERVAN;
    this.espera = dependencias.esperaEntrePodasMs ?? ESPERA_ENTRE_PODAS_MS;
  }

  /**
   * Poda si pasaron 24 h desde la última, o si nunca se hizo en este arranque.
   * Devuelve cuántas filas borró, o `null` si no le tocaba.
   */
  public podarSiTocaba(): number | null {
    const ahora = this.ahora();
    if (this.ultimaPodaEn !== null && ahora - this.ultimaPodaEn < this.espera) {
      return null;
    }
    this.ultimaPodaEn = ahora;
    return this.podar();
  }

  /**
   * Poda ahora, sin mirar cuándo fue la última.
   *
   * **No lanza nunca.** Es mantenimiento: que falle no puede impedir que la
   * cola suba, que es lo que de verdad importa. Si falla, queda dicho en la
   * bitácora y se vuelve a intentar mañana.
   */
  public podar(): number {
    const limite = new Date(this.ahora() - this.dias * MS_POR_DIA).toISOString();
    try {
      const borradas = this.cola.podarSincronizadasAntesDe(limite);
      if (borradas > 0) {
        this.registrar(
          `poda de sync_cola: ${String(borradas)} fila(s) ya subidas hace más de ${String(this.dias)} días ` +
            `(antes de ${limite}). Lo pendiente y lo saltado a mano no se tocan.`,
        );
      }
      return borradas;
    } catch (error) {
      this.registrar(
        `la poda de sync_cola falló y se reintenta en el próximo ciclo: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
