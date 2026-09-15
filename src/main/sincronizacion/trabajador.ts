/**
 * El trabajador de sincronización: lo único que lee la bandeja de salida.
 *
 * ===========================================================================
 * QUÉ HACE, EN UNA FRASE
 * ===========================================================================
 *
 * Toma el lote pendiente más viejo de `sync_cola`, lo sube entero en UNA
 * llamada al `SyncProvider`, y según lo que la nube conteste lo marca como
 * sincronizado, lo agenda para reintentar, o detiene la cola.
 *
 * ===========================================================================
 * LAS CUATRO REGLAS QUE NO SE NEGOCIAN
 * ===========================================================================
 *
 * **1. NO SALTEA NINGÚN LOTE.** El orden es estrictamente de llegada
 * (`docs/SINCRONIZACION.md` §2.4) y no se rompe ni para «adelantar» una venta.
 * Romperlo rompe las llaves foráneas de Postgres: una venta referencia a un
 * producto que pudo haberse creado esa misma mañana sin conexión, y si la
 * venta sube primero la nube la rechaza. El orden de llegada es exactamente el
 * orden en que las referencias existen.
 *
 * **2. UN LOTE BLOQUEANTE DETIENE LA COLA ENTERA.** No se lo saltea ni se lo
 * reintenta solo. Saltarlo dejaría un hueco **silencioso** en el respaldo:
 * parecería completo y no lo estaría. Una cola detenida y visible es un
 * problema que alguien va a ver; un hueco silencioso es un problema que nadie
 * va a ver hasta el día del robo (§3.2). Se desbloquea a pedido de una
 * persona, nunca solo.
 *
 * **3. CEDE ANTE CUALQUIER TRANSACCIÓN DE NEGOCIO.** No solo ante la venta: si
 * hay una transacción abierta —la venta, la caja, un usuario, el catálogo— el
 * trabajador no toca la base y espera al siguiente ciclo. Con una sola
 * conexión síncrona, una escritura suya entraría en esa transacción ajena
 * y se revertiría con ella. Ver `transaccion-en-curso.ts`, que lo explica.
 *
 * **4. NUNCA BLOQUEA EL PROCESO.** Un lote por iteración, con una pausa real
 * entre lotes, y un presupuesto por ciclo. El proceso principal de Electron es
 * el mismo que atiende el IPC de la ventana: un ciclo que lo ocupara sin soltar
 * dejaría la caja congelada mientras se sube una semana de ventas.
 *
 * ===========================================================================
 * TODO EL ESTADO VIVE EN `sync_cola`, NINGUNO EN MEMORIA
 * ===========================================================================
 *
 * Es lo que hace que un cierre forzado —una vía de escape que este proyecto
 * permite a propósito (CLAUDE.md §4.5)— no pierda ni duplique nada: al
 * arrancar, el trabajador lee la cola y retoma exactamente donde estaba. No
 * hay contador de intentos en memoria, ni lote «en vuelo» recordado, ni
 * temporizador cuyo vencimiento se pierda. `intentos` y `proximo_intento_en`
 * están en SQLite con `synchronous = FULL`, que sobrevive hasta un corte de
 * energía.
 */

import type { SyncProvider, CambioSincronizable } from '@shared/adapters';
import type { ElementoSyncCola } from '@main/database/repositories/entidades';
import type { RepositorioDeSyncCola } from '@main/database/repositories/sync-cola';
import { hayTransaccionDeNegocioEnCurso } from '@main/database/transaccion-en-curso';
import type { PodaDeLaCola } from './poda-de-la-cola';
import {
  clasificarFallo,
  ESPERA_POR_ARCHIVO_AUSENTE_MS,
  proximoIntentoTras,
} from './reintentos';

/**
 * El presupuesto de un ciclo, con los valores de §2.4 del diseño.
 *
 * **No son números redondos elegidos por gusto**: salen de que la máquina de la
 * tienda es un i3 de 2011 con 4 GB. Tras una semana sin conexión puede haber
 * miles de filas; se suben en varios ciclos, no en uno que congele la caja.
 */
export interface PresupuestoDeCiclo {
  /** Cuántos lotes como mucho por ciclo. */
  readonly lotesMaximos: number;
  /** Cuánto puede durar un ciclo antes de cortarse, aunque quede trabajo. */
  readonly duracionMaximaMs: number;
  /** Pausa entre lote y lote, para devolverle el turno al bucle de eventos. */
  readonly pausaEntreLotesMs: number;
  /** Cuánto descansa el trabajador después de agotar el presupuesto. */
  readonly descansoTrasPresupuestoMs: number;
  /**
   * Tamaño de lote que el diseño toma como referencia.
   *
   * **NO PARTE UN LOTE DE NEGOCIO QUE LO SUPERE, y es deliberado.** Un lote es
   * una unidad de trabajo completa —una venta con su detalle y su auditoría— y
   * la opción B de §4.3 la sube en una sola llamada justamente para que entre
   * entera o no entre nada. Partir una venta de 60 líneas en dos llamadas
   * reintroduciría la ventana que esa decisión eliminó: la nube podría quedar
   * con una venta sin la mitad de sus líneas, indefinidamente, si la segunda
   * llamada falla. El número queda como referencia para el día que existan
   * lotes de agrupación —los archivos de la fase 3.c— que sí se pueden partir.
   */
  readonly filasPorLoteDeReferencia: number;
}

/** Los valores de `docs/SINCRONIZACION.md` §2.4, tal como están escritos allí. */
export const PRESUPUESTO_POR_DEFECTO: PresupuestoDeCiclo = {
  lotesMaximos: 20,
  duracionMaximaMs: 30_000,
  pausaEntreLotesMs: 250,
  descansoTrasPresupuestoMs: 60_000,
  filasPorLoteDeReferencia: 50,
};

/** Por qué terminó un ciclo. Es lo que la barra de estado va a mostrar. */
export type MotivoDeCiclo =
  /** No había nada que subir. */
  | 'sin_pendientes'
  /** Había una transacción de negocio abierta; el trabajador se apartó. */
  | 'cedio_ante_transaccion'
  /** Se subió todo lo que estaba disponible. */
  | 'cola_vaciada'
  /** Un lote determinístico detuvo la cola. Necesita que una persona lo mire. */
  | 'cola_detenida'
  /** El lote más viejo todavía está esperando su backoff. */
  | 'esperando_backoff'
  /** Un fallo transitorio: se agendó el reintento y el ciclo terminó. */
  | 'fallo_transitorio'
  /** La credencial no sirve. La cola no se tocó. */
  | 'sin_credencial'
  /** Se acabaron los 20 lotes o los 30 segundos. Queda trabajo para el próximo. */
  | 'presupuesto_agotado';

/** Qué pasó en un ciclo. Todo lo que hace falta para informar sin volver a consultar. */
export interface ResumenDeCiclo {
  readonly motivo: MotivoDeCiclo;
  readonly lotesSubidos: number;
  readonly filasSubidas: number;
  /** El lote que detuvo la cola o que está esperando, si lo hay. */
  readonly loteEnEspera: string | null;
  /** El error de ese lote, tal como lo devolvió la nube. */
  readonly error: string | null;
  /**
   * Cuándo toca el próximo intento del lote en espera, si hay uno agendado.
   *
   * Existe para que el planificador pueda despertar EXACTAMENTE a esa hora en
   * vez de sondear: con la escalera de §3.2, un lote puede estar esperando
   * cinco segundos o una hora, y un intervalo fijo serviría mal para los dos.
   */
  readonly proximoIntentoEn: string | null;
  readonly duracionMs: number;
}

/** Lo que el trabajador necesita para existir. */
export interface DependenciasDelTrabajador {
  readonly cola: RepositorioDeSyncCola;
  readonly proveedor: SyncProvider;
  /** Reloj inyectable, para que las pruebas del backoff no dependan del real. */
  readonly ahora?: () => number;
  /** Fuente de la variación aleatoria del backoff. Inyectable por lo mismo. */
  readonly azar?: () => number;
  readonly presupuesto?: Partial<PresupuestoDeCiclo>;
  /**
   * Dónde anotar lo que pasó. Va al log TÉCNICO, nunca a `auditoria_log`:
   * que la nube no respondiera es un problema de infraestructura, y ensuciar
   * con eso la única tabla que un auditor lee entera es el mismo error que
   * CLAUDE.md §4.14 ya rechazó para los fallos de impresión.
   */
  readonly registrar?: (mensaje: string) => void;
  /**
   * La poda de la cola (riesgo 8.6). Opcional: sin ella el trabajador se
   * comporta exactamente como antes, y las pruebas que no la miran no tienen
   * que construirla.
   */
  readonly poda?: PodaDeLaCola;
}

/** Una fila de la cola, lista para viajar. */
function aCambio(fila: ElementoSyncCola): CambioSincronizable {
  return {
    tabla: fila.entidadTipo,
    idRegistro: fila.entidadId,
    operacion: fila.operacion,
    /*
      El payload se guardó como la fila completa en JSON, con los decimales
      como cadena canónica. Se reenvía TAL CUAL: no se reconstruye, no se
      normaliza y no se vuelve a convertir. Cualquier retoque acá sería la
      conversión que `bandeja-de-salida.ts` existe para no tener que hacer.
    */
    datos: JSON.parse(fila.payload) as Record<string, unknown>,
    actualizadoEn: fila.creadoEn,
  };
}

/** Espera real, que devuelve el turno al bucle de eventos. */
function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => {
    setTimeout(resolver, ms);
  });
}

export class TrabajadorDeSincronizacion {
  private readonly cola: RepositorioDeSyncCola;
  private readonly proveedor: SyncProvider;
  private readonly ahora: () => number;
  private readonly azar: () => number;
  private readonly registrar: (mensaje: string) => void;
  private readonly poda: PodaDeLaCola | null;
  public readonly presupuesto: PresupuestoDeCiclo;

  /** `true` mientras hay un ciclo corriendo. Impide que se encimen dos. */
  private corriendo = false;

  public constructor(dependencias: DependenciasDelTrabajador) {
    this.cola = dependencias.cola;
    this.proveedor = dependencias.proveedor;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
    this.azar = dependencias.azar ?? Math.random;
    this.registrar = dependencias.registrar ?? ((): void => undefined);
    this.poda = dependencias.poda ?? null;
    this.presupuesto = { ...PRESUPUESTO_POR_DEFECTO, ...dependencias.presupuesto };
  }

  /** `true` si hay un ciclo en marcha ahora mismo. */
  public get estaCorriendo(): boolean {
    return this.corriendo;
  }

  /**
   * Un ciclo completo: sube lotes hasta agotar la cola o el presupuesto.
   *
   * La comprobación de si hay una transacción de negocio abierta vive **al
   * principio de cada vuelta del bucle**, no acá, y hay una razón por la que
   * está en un solo lugar: ver el comentario de `subirLotes`.
   */
  public async ejecutarCiclo(): Promise<ResumenDeCiclo> {
    const inicio = this.ahora();

    if (this.corriendo) {
      /*
        Dos ciclos encimados sobre la misma cola se pisarían: los dos leerían
        el mismo «lote más viejo» y lo subirían dos veces. La nube lo
        soportaría —todo es idempotente por clave primaria— pero sería tráfico
        y trabajo al pedo en la máquina que menos lo tiene.
      */
      return this.resumen('cedio_ante_transaccion', 0, 0, null, null, inicio);
    }

    this.corriendo = true;
    try {
      /*
        LA PODA VA ACÁ, antes de subir nada (riesgo 8.6). Es mantenimiento, no
        parte de la subida: no cuenta como lote, no entra en el presupuesto del
        ciclo y no puede hacerlo fallar. Cede ante una transacción de negocio
        por la misma razón que todo lo demás —una sola conexión (§4.18)—, y en
        ese caso sencillamente le toca en el próximo ciclo.
      */
      if (this.poda !== null && !hayTransaccionDeNegocioEnCurso()) {
        this.poda.podarSiTocaba();
      }
      return await this.subirLotes(inicio);
    } finally {
      this.corriendo = false;
    }
  }

  private async subirLotes(inicio: number): Promise<ResumenDeCiclo> {
    let lotesSubidos = 0;
    /** Archivos que no estaban en el disco y se dejaron para mañana (§2.5.4). */
    let archivosApartados = 0;
    let filasSubidas = 0;

    for (;;) {
      if (lotesSubidos >= this.presupuesto.lotesMaximos) {
        return this.resumen('presupuesto_agotado', lotesSubidos, filasSubidas, null, null, inicio);
      }
      if (this.ahora() - inicio >= this.presupuesto.duracionMaximaMs) {
        return this.resumen('presupuesto_agotado', lotesSubidos, filasSubidas, null, null, inicio);
      }
      /*
        ===================================================================
        LA ÚNICA COMPROBACIÓN DE «HAY UNA TRANSACCIÓN ABIERTA», Y ESTÁ ACÁ
        ===================================================================

        **Es SÍNCRONA y va antes de leer la cola.** El cuerpo de una función
        `async` corre de forma síncrona hasta su primer `await`, así que en la
        primera vuelta esta pregunta se contesta en el mismo turno del bucle de
        eventos en que quien llamó invocó el ciclo: si el ciclo se lanzó desde
        dentro de una transacción —lo hace el observador de la bandeja de
        salida—, acá se entera y se aparta sin tocar la base.

        **HUBO UNA SEGUNDA COMPROBACIÓN IGUAL AL PRINCIPIO DE `ejecutarCiclo` Y
        SE QUITÓ.** No era defensa en profundidad: era duplicación. Se midió
        quitando cada una por separado y las 74 pruebas pasaban en los dos
        casos, porque esta —que corre antes de CADA lote, incluido el primero—
        cubre por completo lo que cubría aquella. Dos comprobaciones que nadie
        puede distinguir son dos lugares donde tocar cuando esto cambie, y una
        sola prueba que se cree que protege dos cosas.

        **Lo que esta posición agrega sobre la otra hoy es CERO, y se dice en
        voz alta**: con un solo hilo y una sola conexión síncrona, una
        transacción de negocio empieza y termina dentro de un bloque síncrono,
        y la continuación de un `await` no puede colarse ahí. Es decir: hoy la
        señal solo puede estar levantada si el ciclo se lanzó desde adentro, que
        es la primera vuelta. La comprobación se deja en el bucle y no antes
        porque cuesta leer un booleano y porque el día que la premisa cambie
        —un observador asíncrono, una segunda conexión, un hilo aparte— este es
        el lugar donde hay que preguntar.
      */
      if (hayTransaccionDeNegocioEnCurso()) {
        return this.resumen('cedio_ante_transaccion', lotesSubidos, filasSubidas, null, null, inicio);
      }

      const loteId = this.cola.siguienteLotePendiente(new Date(this.ahora()).toISOString());
      if (loteId === null) {
        const motivo: MotivoDeCiclo = lotesSubidos > 0 ? 'cola_vaciada' : 'sin_pendientes';
        if (archivosApartados > 0) {
          // Se dice, porque si no el renglón de la bitácora contaría un ciclo
          // tranquilo donde hubo fotos que no se pudieron respaldar.
          this.registrar(
            `${String(archivosApartados)} archivo(s) sin subir: no están en el disco. ` +
              'Se vuelven a buscar mañana.',
          );
        }
        return this.resumen(motivo, lotesSubidos, filasSubidas, null, null, inicio);
      }

      const filas = this.cola.leerLote(loteId);
      const primera = filas[0];
      if (primera === undefined) {
        // No puede pasar: `siguienteLotePendiente` solo devuelve lotes con
        // filas pendientes. Si pasara, seguir daría un bucle infinito.
        return this.resumen('cola_vaciada', lotesSubidos, filasSubidas, null, null, inicio);
      }

      if (primera.bloqueante) {
        return this.resumen(
          'cola_detenida',
          lotesSubidos,
          filasSubidas,
          loteId,
          primera.error,
          inicio,
        );
      }

      if (primera.proximoIntentoEn !== null) {
        const ahoraIso = new Date(this.ahora()).toISOString();
        if (primera.proximoIntentoEn > ahoraIso) {
          return this.resumen(
            'esperando_backoff',
            lotesSubidos,
            filasSubidas,
            loteId,
            primera.error,
            inicio,
            primera.proximoIntentoEn,
          );
        }
      }

      const desenlace = await this.subirUnLote(loteId, filas);
      if (desenlace.motivo !== null) {
        return this.resumen(
          desenlace.motivo,
          lotesSubidos,
          filasSubidas,
          loteId,
          desenlace.error,
          inicio,
          desenlace.proximoIntentoEn,
        );
      }

      if (desenlace.apartado === true) {
        archivosApartados += 1;
      } else {
        lotesSubidos += 1;
        filasSubidas += filas.length;
      }

      // La pausa va DESPUÉS de un lote exitoso y antes del siguiente: es lo
      // que le devuelve el turno al bucle de eventos para que el IPC de la
      // ventana se atienda entre lote y lote.
      await dormir(this.presupuesto.pausaEntreLotesMs);
    }
  }

  /**
   * Sube un lote y decide qué hacer con la respuesta.
   *
   * Devuelve `motivo: null` cuando el lote subió y el ciclo puede seguir. Con
   * cualquier otro motivo el ciclo TERMINA, y eso es lo correcto: el lote que
   * falló es el más viejo, así que seguir con el siguiente sería saltearlo.
   */
  private async subirUnLote(
    loteId: string,
    filas: readonly ElementoSyncCola[],
  ): Promise<{
    motivo: MotivoDeCiclo | null;
    error: string | null;
    proximoIntentoEn: string | null;
    /** El lote no subió pero tampoco falló: se apartó y el ciclo sigue. */
    apartado?: boolean;
  }> {
    const intentoNumero = (filas[0]?.intentos ?? 0) + 1;

    let estadoHttp: number | undefined;
    let errores: readonly string[];
    let ok: boolean;
    let archivoAusente = false;

    try {
      const respuesta = await this.proveedor.empujarCambios(filas.map(aCambio));
      ok = respuesta.ok;
      estadoHttp = respuesta.estadoHttp;
      errores = respuesta.errores;
      archivoAusente = respuesta.archivoAusente === true;
    } catch (causa) {
      /*
        Una excepción es un fallo de red o del propio adaptador: no hubo
        respuesta, así que no hay código, y sin código se clasifica como
        transitorio. Es el caso más común de todos —se cayó el internet de la
        tienda— y detener la cola por él sería absurdo.
      */
      ok = false;
      errores = [causa instanceof Error ? causa.message : String(causa)];
    }

    if (ok) {
      this.cola.marcarLoteSincronizado(loteId);
      return { motivo: null, error: null, proximoIntentoEn: null };
    }

    const detalle = errores.join(' | ') || 'La nube rechazó el lote sin explicar por qué.';
    const clase = clasificarFallo({
      ...(estadoHttp === undefined ? {} : { estadoHttp }),
      archivoAusente,
    });

    if (clase === 'credencial') {
      // La cola NO se toca: no se suma intento, no se agenda reintento y no se
      // bloquea. El lote es válido; lo que falta es una credencial, y eso se
      // resuelve reprovisionando, no reintentando (§1.6).
      this.registrar(`credencial rechazada al subir el lote ${loteId}`);
      return { motivo: 'sin_credencial', error: detalle, proximoIntentoEn: null };
    }

    if (clase === 'archivo_ausente') {
      /*
        NO se bloquea y NO se detiene la cola (§2.5.4): se aparta un día y el
        ciclo SIGUE con el lote que viene. Devolver un motivo acá pararía toda
        la sincronización porque a una terminal le falta una foto, que es
        exactamente lo que el diseño quiere evitar: «la fila de la base sigue
        subiendo normalmente, con su foto_path tal cual».

        Que el ciclo pueda seguir sin caer en un bucle infinito depende de que
        `siguienteLotePendiente` SALTEE los lotes de archivo que están
        esperando: sin eso, el mismo lote volvería a salir elegido para
        siempre. Las dos mitades van juntas.
      */
      const vuelveA = new Date(this.ahora() + ESPERA_POR_ARCHIVO_AUSENTE_MS).toISOString();
      this.cola.registrarIntentoFallido(loteId, detalle, vuelveA);
      this.registrar(`lote ${loteId}: ${detalle}; se vuelve a buscar el ${vuelveA}`);
      /*
        `apartado` y no un lote más en la cuenta de subidos: la bitácora diría
        «cola_vaciada; 2 lotes» de dos fotos que NO se subieron, y un renglón
        que miente sobre lo que pasó es peor que no tenerlo.
      */
      return { motivo: null, error: null, proximoIntentoEn: null, apartado: true };
    }

    if (clase === 'deterministico') {
      this.cola.marcarLoteBloqueante(loteId, detalle);
      this.registrar(`COLA DETENIDA en el lote ${loteId}: ${detalle}`);
      return { motivo: 'cola_detenida', error: detalle, proximoIntentoEn: null };
    }

    const proximo = proximoIntentoTras(intentoNumero, this.ahora(), this.azar);
    this.cola.registrarIntentoFallido(loteId, detalle, proximo);
    this.registrar(
      `lote ${loteId}: intento ${String(intentoNumero)} falló; ` +
        `se reintenta a partir de ${proximo}`,
    );
    return { motivo: 'fallo_transitorio', error: detalle, proximoIntentoEn: proximo };
  }

  private resumen(
    motivo: MotivoDeCiclo,
    lotesSubidos: number,
    filasSubidas: number,
    loteEnEspera: string | null,
    error: string | null,
    inicio: number,
    proximoIntentoEn: string | null = null,
  ): ResumenDeCiclo {
    return {
      motivo,
      lotesSubidos,
      filasSubidas,
      loteEnEspera,
      error,
      proximoIntentoEn,
      duracionMs: this.ahora() - inicio,
    };
  }
}
