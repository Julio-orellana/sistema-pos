/**
 * Cuándo corre el trabajador. No qué hace: cuándo.
 *
 * ===========================================================================
 * NO HAY UN INTERVALO FIJO, Y ESO ES LA DECISIÓN
 * ===========================================================================
 *
 * `docs/SINCRONIZACION.md` §5.3 lo dice con todas las letras: la
 * sincronización **corre cuando tiene sentido**, no cada N minutos. Una
 * máquina al día no gasta un ciclo —ni un byte, cuando haya red— en preguntar
 * si podría subir algo que no tiene. Un intervalo fijo haría exactamente eso
 * todo el día, en la máquina que menos lo puede pagar.
 *
 * ===========================================================================
 * QUÉ DISPARA UN CICLO
 * ===========================================================================
 *
 * | Disparador | Cuándo | Estado |
 * |---|---|---|
 * | Al confirmar una transacción local | 2 s después, agrupando si hay varias seguidas | **implementado** |
 * | Al arrancar la aplicación | 30 s después de que la ventana esté lista | **implementado** |
 * | Intervalo de respaldo | cada 5 min mientras haya pendientes | **implementado** |
 * | Descanso tras agotar el presupuesto | 60 s | **implementado** |
 * | Al despertar de suspensión | 15 s después del `resume` de `powerMonitor` | **el método existe; nadie lo llama todavía** |
 * | Al detectar conexión | cuando §5 pasa de «sin internet» a «con internet» | **fase con red** |
 *
 * Los dos últimos dependen de piezas que esta fase no construye —`powerMonitor`
 * y la detección de conexión— y se dicen así en vez de simularlos: un
 * disparador falso que parece funcionar es peor que uno que falta y se ve que
 * falta.
 *
 * ===========================================================================
 * LOS DOS SEGUNDOS DESPUÉS DEL COMMIT NO SON UN NÚMERO AL AZAR
 * ===========================================================================
 *
 * El diseño los pide para **no competir con el recibo**, que se está generando
 * justo en ese momento: el PDF abre una ventana de Chromium y la impresora
 * habla con un puerto (CLAUDE.md §4.14). Arrancar a sincronizar en el mismo
 * instante en que el cajero espera su papel es pelearse por la máquina
 * exactamente cuando más se nota.
 *
 * Y **agrupan**: tres ventas seguidas no disparan tres ciclos, disparan uno.
 * Cada aviso reinicia la cuenta, así que el ciclo corre 2 s después de la
 * última, cuando la racha terminó.
 */

import type { TrabajadorDeSincronizacion, ResumenDeCiclo } from './trabajador';

/** Las esperas de §2.4 y §5.3, en milisegundos. */
export const ESPERAS_DEL_PLANIFICADOR = {
  /** Tras confirmar una transacción local. Agrupa las ráfagas. */
  trasTransaccion: 2_000,
  /** Tras arrancar la aplicación, para no competir con el arranque en un i3. */
  trasArranque: 30_000,
  /** Respaldo mientras queden pendientes: cubre cualquier disparador perdido. */
  respaldo: 300_000,
  /** Tras despertar de suspensión: Windows levanta la red unos segundos después. */
  trasDespertar: 15_000,
  /** Tras ceder ante una transacción: se vuelve a mirar enseguida. */
  trasCeder: 2_000,
} as const;

/** Lo que el planificador necesita. Los temporizadores se inyectan para poder probarlo. */
export interface DependenciasDelPlanificador {
  readonly trabajador: TrabajadorDeSincronizacion;
  /** Reloj, para calcular cuánto falta para un reintento agendado. */
  readonly ahora?: () => number;
  /** `setTimeout`, inyectable: las pruebas no pueden esperar cinco minutos. */
  readonly programar?: (accion: () => void, ms: number) => unknown;
  readonly cancelar?: (identificador: unknown) => void;
  readonly registrar?: (mensaje: string) => void;
}

export class PlanificadorDeSincronizacion {
  private readonly trabajador: TrabajadorDeSincronizacion;
  private readonly ahora: () => number;
  private readonly programar: (accion: () => void, ms: number) => unknown;
  private readonly cancelar: (identificador: unknown) => void;
  private readonly registrar: (mensaje: string) => void;

  /** El único temporizador vivo. Uno solo, siempre. */
  private pendiente: unknown = null;
  private detenido = false;

  /** El último ciclo que terminó, para que la barra de estado tenga qué mostrar. */
  private ultimo: ResumenDeCiclo | null = null;

  public constructor(dependencias: DependenciasDelPlanificador) {
    this.trabajador = dependencias.trabajador;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
    this.programar =
      dependencias.programar ??
      ((accion, ms): unknown => {
        const identificador = setTimeout(accion, ms);
        /*
          `unref` le dice a Node que este temporizador no tiene que mantener
          vivo el proceso. Sin él, un temporizador de cinco minutos dejaría el
          proceso principal esperando después de que la aplicación pidió
          cerrarse, y la salida controlada —que consolida el WAL y cierra la
          base— se quedaría colgada por la sincronización.
        */
        identificador.unref();
        return identificador;
      });
    this.cancelar =
      dependencias.cancelar ??
      ((identificador): void => {
        clearTimeout(identificador as ReturnType<typeof setTimeout>);
      });
    this.registrar = dependencias.registrar ?? ((): void => undefined);
  }

  /** El resumen del último ciclo, o `null` si todavía no corrió ninguno. */
  public get ultimoResumen(): ResumenDeCiclo | null {
    return this.ultimo;
  }

  /** Arranca: agenda el primer ciclo 30 segundos después. */
  public arrancar(): void {
    this.detenido = false;
    this.agendar(ESPERAS_DEL_PLANIFICADOR.trasArranque);
  }

  /**
   * Aviso de que una transacción local dejó algo en la cola.
   *
   * **Reinicia la cuenta de los 2 segundos**: es lo que hace que una ráfaga de
   * ventas seguidas dispare un ciclo y no cinco.
   */
  public alConfirmarTransaccion(): void {
    if (this.detenido) {
      return;
    }
    this.agendar(ESPERAS_DEL_PLANIFICADOR.trasTransaccion);
  }

  /**
   * Aviso de que la máquina despertó de suspensión.
   *
   * **HOY NO LO LLAMA NADIE.** Lo va a llamar el `resume` de `powerMonitor` de
   * Electron en la fase que agregue la detección de conexión; existe ahora
   * para que ese día sea una línea y no un rediseño, y para que los 15
   * segundos de §5.4 —el tiempo que Windows tarda en levantar el adaptador de
   * red— queden escritos donde se van a usar.
   */
  public alDespertar(): void {
    if (this.detenido) {
      return;
    }
    this.agendar(ESPERAS_DEL_PLANIFICADOR.trasDespertar);
  }

  /** Cancela lo agendado y no vuelve a agendar. Se llama al cerrar la aplicación. */
  public detener(): void {
    this.detenido = true;
    if (this.pendiente !== null) {
      this.cancelar(this.pendiente);
      this.pendiente = null;
    }
  }

  /**
   * Corre un ciclo ahora y agenda el siguiente según lo que haya pasado.
   *
   * Es público para que las pruebas puedan avanzar el reloj a mano en vez de
   * esperar, y para que la pantalla de sincronización tenga a qué llamar
   * cuando exista su botón de «reintentar ahora».
   */
  public async ejecutarAhora(): Promise<ResumenDeCiclo> {
    const resumen = await this.trabajador.ejecutarCiclo();
    this.ultimo = resumen;

    /*
      SE ANOTA TODO CICLO, no solo los que fallan. Va a la bitácora TÉCNICA,
      nunca a `auditoria_log`: que la nube esté al día o no es infraestructura,
      y ensuciar con eso la única tabla que un auditor lee entera es el error
      que §4.14 ya rechazó para los fallos de impresión. El volumen es bajo
      porque los ciclos corren cuando tiene sentido, no cada N minutos.
    */
    this.registrar(
      `ciclo: ${resumen.motivo}; ${String(resumen.lotesSubidos)} lotes, ` +
        `${String(resumen.filasSubidas)} filas, ${String(resumen.duracionMs)} ms` +
        (resumen.loteEnEspera === null ? '' : `; lote en espera ${resumen.loteEnEspera}`) +
        (resumen.error === null ? '' : `; error: ${resumen.error}`),
    );

    if (!this.detenido) {
      const espera = this.esperaTras(resumen);
      if (espera !== null) {
        this.agendar(espera);
      }
    }
    return resumen;
  }

  /**
   * Cuánto esperar antes del próximo ciclo, o `null` para no agendar ninguno.
   *
   * **Los dos `null` son la parte importante.** Una cola detenida NO se
   * reintenta sola: el diseño lo prohíbe explícitamente (§3.2) porque
   * reintentar en bucle algo que la nube ya dijo que es inválido es ruido que
   * tapa el problema en vez de mostrarlo. Y sin credencial tampoco: lo que
   * falta se resuelve reprovisionando, no insistiendo. Los dos casos vuelven a
   * moverse cuando una persona actúa, o cuando una venta nueva dispara un
   * ciclo que —al costo de una consulta— confirma que siguen detenidos.
   */
  private esperaTras(resumen: ResumenDeCiclo): number | null {
    switch (resumen.motivo) {
      case 'sin_pendientes':
      case 'cola_vaciada':
        // No hay nada que subir: no se agenda nada. El próximo movimiento lo
        // trae la próxima transacción local (§5.3).
        return null;

      case 'cola_detenida':
      case 'sin_credencial':
        return null;

      case 'cedio_ante_transaccion':
        return ESPERAS_DEL_PLANIFICADOR.trasCeder;

      case 'presupuesto_agotado':
        return this.trabajador.presupuesto.descansoTrasPresupuestoMs;

      case 'fallo_transitorio':
      case 'esperando_backoff':
        return this.esperaHastaElReintento(resumen.proximoIntentoEn);

      default:
        return ESPERAS_DEL_PLANIFICADOR.respaldo;
    }
  }

  /**
   * Cuánto falta para el reintento agendado, acotado por el intervalo de respaldo.
   *
   * El tope de 5 minutos no es desconfianza del backoff: la escalera puede
   * llegar a una hora, y despertar cada cinco minutos mientras tanto cuesta una
   * consulta que devuelve «todavía no» y **cubre el caso en que el reloj de la
   * máquina se corrija hacia atrás** —el riesgo 8.5 del diseño—, que dejaría un
   * `proximo_intento_en` en un futuro que no llega nunca.
   */
  private esperaHastaElReintento(proximoIntentoEn: string | null): number {
    if (proximoIntentoEn === null) {
      return ESPERAS_DEL_PLANIFICADOR.respaldo;
    }
    const falta = Date.parse(proximoIntentoEn) - this.ahora();
    if (Number.isNaN(falta)) {
      return ESPERAS_DEL_PLANIFICADOR.respaldo;
    }
    return Math.min(Math.max(falta, 0), ESPERAS_DEL_PLANIFICADOR.respaldo);
  }

  /** Deja UN solo temporizador vivo: agendar de nuevo cancela el anterior. */
  private agendar(ms: number): void {
    if (this.pendiente !== null) {
      this.cancelar(this.pendiente);
      this.pendiente = null;
    }
    this.pendiente = this.programar(() => {
      this.pendiente = null;
      void this.ejecutarAhora().catch((causa: unknown) => {
        /*
          Un ciclo nunca debería lanzar —el trabajador atrapa los fallos del
          proveedor— pero si lo hiciera, tragarlo dejaría la sincronización
          muerta en silencio para siempre. Se anota y se reagenda el respaldo.
        */
        this.registrar(
          `el ciclo lanzó: ${causa instanceof Error ? causa.message : String(causa)}`,
        );
        if (!this.detenido) {
          this.agendar(ESPERAS_DEL_PLANIFICADOR.respaldo);
        }
      });
    }, ms);
  }
}
