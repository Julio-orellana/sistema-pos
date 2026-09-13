/**
 * ¿Se llega a la nube de ESTE proyecto? (§5 del diseño)
 *
 * ===========================================================================
 * NO ES «¿HAY INTERNET?», Y ESA DIFERENCIA ES TODO EL MÓDULO
 * ===========================================================================
 *
 * `net.isOnline()` de Electron y `navigator.onLine` contestan otra pregunta:
 * si hay un enlace de red activo. La propia documentación de Electron dice que
 * un `true` **es inconcluyente**. En la tienda eso importa de verdad: un cable
 * al router sin salida, o un portal cautivo de un wifi ajeno, dan `true` y
 * dejarían al trabajador intentando subir contra la nada.
 *
 * Por eso las tres capas de §5.2, de la más barata a la más cara:
 *
 *   1. El sistema operativo. **Solo se le cree el `false`.** Cuesta cero.
 *   2. Una petición real y liviana a Supabase. 107 bytes medidos.
 *   3. El propio intento de sincronizar, que ya se iba a hacer igual.
 *
 * ===========================================================================
 * DOS CORRECCIONES AL DISEÑO, LAS DOS MEDIDAS
 * ===========================================================================
 *
 * **1. §5.2 dice `HEAD /auth/v1/health`, y con HEAD esto no funcionaría.**
 * Medido contra `pos-pruebas-descartable`: `HEAD` devuelve **405 Method Not
 * Allowed** con `allow: GET`. Un detector que use HEAD reportaría «sin
 * internet» siempre, con la red perfecta. Se usa `GET`, que además es lo único
 * coherente con la otra mitad de esa misma fila del diseño —«solo un 200 con
 * el cuerpo esperado»—, porque **un HEAD no tiene cuerpo**.
 *
 * **2. Se comprueba algo mejor que el tipo de contenido: la cabecera
 * `sb-project-ref`.** Medido, la respuesta la trae con la referencia del
 * proyecto. Un portal cautivo puede devolver 200 con `application/json` si se
 * lo propone; lo que no puede es firmar la respuesta con la referencia de ESTE
 * proyecto. Se exigen las tres cosas: 200, la referencia correcta y el cuerpo
 * de GoTrue.
 *
 * La respuesta medida, entera:
 *
 *   HTTP/2 200   content-type: application/json   sb-project-ref: <ref>
 *   {"version":"v2.196.0","name":"GoTrue","description":"…"}   → 107 bytes
 */

/**
 * Lo que este módulo necesita de `fetch`, y nada más.
 *
 * **No se declara como `typeof fetch` a propósito**: `net.fetch` de Electron
 * —que es el que hay que usar en Windows, porque respeta el proxy del sistema
 * (§5.4)— acepta menos que el `fetch` estándar; no toma un `URL`, por ejemplo.
 * Pedir el tipo completo obligaría a un cast en el único lugar donde importa
 * usar el correcto. Se pide exactamente lo que se llama: una cadena y opciones.
 */
export type BuscarEnLaRed = (url: string, opciones?: RequestInit) => Promise<Response>;

/** Cuánto se espera al health antes de darlo por perdido (§5.4). */
export const TIEMPO_MAXIMO_DE_SALUD_MS = 8_000;

/**
 * 8 segundos, y no más, **por Windows**: el comportamiento por omisión de una
 * petición hacia un destino inalcanzable puede quedarse hasta 21 segundos en
 * los reintentos de TCP del sistema. Se corta antes con `AbortController`.
 */

/**
 * Las dos capas de §5.2 que pueden dar un veredicto, con nombre.
 *
 * La 3 —el propio intento de sincronizar— no está acá porque no la resuelve
 * este módulo: la paga el proveedor cuando manda el lote.
 */
export const CAPAS = { sistemaOperativo: 1, peticionALaNube: 2 } as const;

/** Lo que tiene que decir el cuerpo del health para que cuente. */
const FIRMA_DEL_CUERPO = 'GoTrue';

/** La cabecera con la que el gateway de Supabase firma de qué proyecto es. */
const CABECERA_DEL_PROYECTO = 'sb-project-ref';

/**
 * La escalera de recomprobación de §5.3: 30 s, 1 min, 2 min y 5 min de techo.
 *
 * **Un día entero sin internet son 288 comprobaciones de ~107 bytes: menos de
 * 31 KB.** Ese cálculo es la razón de que el techo sea 5 minutos y no una
 * hora: recuperarse rápido cuando vuelve la red cuesta muy poco.
 *
 * NO es la escalera de `reintentos.ts` (que llega a una hora, para la cola) ni
 * la de `vida-del-token.ts` (que llega a un minuto, atada a la vida del
 * token). Son tres cosas distintas con tres presupuestos distintos.
 */
const ESPERAS_DE_RECOMPROBACION_MS = {
  /** 30 segundos */
  primera: 30_000,
  /** 1 minuto */
  segunda: 60_000,
  /** 2 minutos */
  tercera: 120_000,
  /** 5 minutos, y de ahí en adelante siempre esta */
  techo: 300_000,
} as const;

export const ESCALERA_DE_RECOMPROBACION_MS: readonly number[] = [
  ESPERAS_DE_RECOMPROBACION_MS.primera,
  ESPERAS_DE_RECOMPROBACION_MS.segunda,
  ESPERAS_DE_RECOMPROBACION_MS.tercera,
  ESPERAS_DE_RECOMPROBACION_MS.techo,
];

/** Cuánto esperar tras la comprobación fallida número `intento` (1 es la primera). */
export function esperaTrasFalloDeConexion(intento: number): number {
  const indice = Math.min(Math.max(intento, 1), ESCALERA_DE_RECOMPROBACION_MS.length) - 1;
  return (
    ESCALERA_DE_RECOMPROBACION_MS[indice] ??
    ESPERAS_DE_RECOMPROBACION_MS.primera
  );
}

/** Cada cuánto corre el latido que evita que el proyecto gratuito se pause (§8.3). */
const HORAS_DE_UN_DIA = 24;
const MINUTOS_DE_UNA_HORA = 60;
const SEGUNDOS_DE_UN_MINUTO = 60;
const MS_POR_SEGUNDO = 1000;
export const PERIODO_DEL_LATIDO_MS =
  HORAS_DE_UN_DIA * MINUTOS_DE_UNA_HORA * SEGUNDOS_DE_UN_MINUTO * MS_POR_SEGUNDO;

/** En qué capa de §5.2 se resolvió el veredicto. */
export type CapaQueDecidio = (typeof CAPAS)[keyof typeof CAPAS];

/** Qué se averiguó al comprobar. */
export interface Veredicto {
  readonly hayNube: boolean;
  /** Por qué, en texto legible. Va a la bitácora técnica, nunca a auditoría. */
  readonly motivo: string;
  /** En qué capa se resolvió: sirve para saber cuánto costó la respuesta. */
  readonly capa: CapaQueDecidio;
}

export interface DependenciasDeDeteccion {
  /** `https://<ref>.supabase.co`. */
  readonly urlDelProyecto: string;
  /** La referencia del proyecto, para cotejar la cabecera del gateway. */
  readonly referenciaDelProyecto: string;
  readonly llavePublicable: string;
  /**
   * `net.isOnline()` de Electron. **Solo se le cree el `false`.**
   *
   * Se inyecta porque las pruebas corren sin Electron, y porque así se puede
   * comprobar el caso que en una máquina conectada no se puede provocar.
   */
  readonly sistemaDiceQueHayRed?: () => boolean;
  /**
   * `net.fetch` de Electron, NO el `fetch` de Node.
   *
   * La diferencia importa en Windows y está en §5.4: si la tienda tuviera un
   * proxy configurado en el sistema, `net.fetch` lo respeta y el de Node no.
   */
  readonly buscar?: BuscarEnLaRed;
  readonly ahora?: () => number;
  readonly registrar?: (mensaje: string) => void;
}

export class DetectorDeConexion {
  private readonly urlDelProyecto: string;
  private readonly referenciaDelProyecto: string;
  private readonly llavePublicable: string;
  private readonly sistemaDiceQueHayRed: () => boolean;
  private readonly buscar: BuscarEnLaRed;
  private readonly ahora: () => number;
  private readonly registrar: (mensaje: string) => void;

  /** Comprobaciones seguidas que dieron «sin nube». Alimenta la escalera. */
  private fallidas = 0;
  /** Cuándo se comprobó por última vez, para respetar la espera. */
  private ultimaComprobacion: number | null = null;
  private ultimoVeredicto: Veredicto | null = null;
  private ultimoLatido: number | null = null;

  public constructor(dependencias: DependenciasDeDeteccion) {
    this.urlDelProyecto = dependencias.urlDelProyecto.replace(/\/+$/, '');
    this.referenciaDelProyecto = dependencias.referenciaDelProyecto;
    this.llavePublicable = dependencias.llavePublicable;
    this.sistemaDiceQueHayRed = dependencias.sistemaDiceQueHayRed ?? ((): boolean => true);
    this.buscar = dependencias.buscar ?? fetch;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
    this.registrar = dependencias.registrar ?? ((): void => undefined);
  }

  public get veredicto(): Veredicto | null {
    return this.ultimoVeredicto;
  }

  /**
   * ¿Toca volver a comprobar?
   *
   * **Con la cola vacía la respuesta es siempre que no**, y ese es el punto
   * más importante de §5.3: una máquina que no tiene nada que subir no gasta
   * un byte en preguntar si podría subirlo. Después de una comprobación
   * fallida se respeta la escalera; después de una buena se puede volver a
   * intentar cuando quiera quien llama, porque el costo real ya lo paga la
   * capa 3.
   */
  public tocaComprobar(hayPendientes: boolean): boolean {
    if (!hayPendientes) {
      return false;
    }
    if (this.ultimaComprobacion === null || this.ultimoVeredicto?.hayNube === true) {
      return true;
    }
    return this.ahora() - this.ultimaComprobacion >= esperaTrasFalloDeConexion(this.fallidas);
  }

  /**
   * Fuerza que la próxima consulta comprueba de verdad, sin esperar la
   * escalera.
   *
   * Lo llaman los cambios de estado de §5.3: `net.isOnline()` que pasa a
   * `true`, `powerMonitor` con `resume` o `on-ac`, o el evento `online` de la
   * ventana. **La espera de 15 s tras despertar la pone quien llama**, no
   * este módulo: es una particularidad de Windows (§5.4), y meterla acá la
   * aplicaría también a los disparadores que no la necesitan.
   */
  public olvidarLaEspera(): void {
    this.ultimaComprobacion = null;
  }

  /** Las capas 1 y 2, en ese orden. */
  public async comprobar(): Promise<Veredicto> {
    this.ultimaComprobacion = this.ahora();

    // --- Capa 1: gratis, y solo se le cree el «no» -------------------------
    if (!this.sistemaDiceQueHayRed()) {
      return this.anotar({
        hayNube: false,
        motivo: 'El sistema operativo dice que no hay ninguna red activa.',
        capa: CAPAS.sistemaOperativo,
      });
    }

    // --- Capa 2: 107 bytes contra la nube de ESTE proyecto -----------------
    const cancelacion = new AbortController();
    const reloj = setTimeout(() => {
      cancelacion.abort();
    }, TIEMPO_MAXIMO_DE_SALUD_MS);
    try {
      const respuesta = await this.buscar(`${this.urlDelProyecto}/auth/v1/health`, {
        method: 'GET',
        headers: { apikey: this.llavePublicable },
        signal: cancelacion.signal,
      });
      return this.anotar(await this.juzgar(respuesta));
    } catch (error) {
      const agotado = error instanceof Error && error.name === 'AbortError';
      return this.anotar({
        hayNube: false,
        motivo: agotado
          ? `La nube no contestó en ${String(TIEMPO_MAXIMO_DE_SALUD_MS / MS_POR_SEGUNDO)} s.`
          : `No se pudo llegar a la nube: ${error instanceof Error ? error.message : String(error)}`,
        capa: CAPAS.peticionALaNube,
      });
    } finally {
      clearTimeout(reloj);
    }
  }

  /**
   * Las tres condiciones que tiene que cumplir una respuesta para contar.
   *
   * Un portal cautivo devuelve 200 con lo que quiera, así que el código de
   * estado solo no significa nada. Lo que no puede falsificar es la cabecera
   * con la que el gateway de Supabase firma de qué proyecto es la respuesta.
   */
  private async juzgar(respuesta: Response): Promise<Veredicto> {
    const OK = 200;
    if (respuesta.status !== OK) {
      return {
        hayNube: false,
        motivo: `La nube contestó ${String(respuesta.status)} al health, y solo un 200 cuenta.`,
        capa: CAPAS.peticionALaNube,
      };
    }
    const referencia = respuesta.headers.get(CABECERA_DEL_PROYECTO);
    if (referencia !== this.referenciaDelProyecto) {
      return {
        hayNube: false,
        motivo:
          `Contestó un 200 pero no es la nube de este proyecto (${CABECERA_DEL_PROYECTO}: ` +
          `${referencia ?? 'ausente'}). Suele ser un portal cautivo de la red del local.`,
        capa: CAPAS.peticionALaNube,
      };
    }
    const cuerpo = await respuesta.text();
    if (!cuerpo.includes(FIRMA_DEL_CUERPO)) {
      return {
        hayNube: false,
        motivo: 'Contestó un 200 del proyecto correcto pero el cuerpo no es el del servicio de Auth.',
        capa: CAPAS.peticionALaNube,
      };
    }
    return { hayNube: true, motivo: 'Se llega a la nube de este proyecto.', capa: 2 };
  }

  private anotar(veredicto: Veredicto): Veredicto {
    const cambio = this.ultimoVeredicto?.hayNube !== veredicto.hayNube;
    this.ultimoVeredicto = veredicto;
    this.fallidas = veredicto.hayNube ? 0 : this.fallidas + 1;
    // Solo se anota el CAMBIO de estado: si no, un día sin internet llenaría
    // la bitácora con 288 renglones que dicen lo mismo.
    if (cambio) {
      this.registrar(`conexión: ${veredicto.hayNube ? 'hay nube' : 'sin nube'} — ${veredicto.motivo}`);
    }
    return veredicto;
  }

  // -------------------------------------------------------------------------
  // El latido diario (§5.3, última fila)
  // -------------------------------------------------------------------------

  /**
   * Una consulta mínima a PostgREST, una vez al día.
   *
   * **NO ES PARA DETECTAR CONEXIÓN: es para que el proyecto gratuito no se
   * pause por inactividad** (riesgo 8.3). Y por eso **no puede ser un health
   * de Auth**: §5.3 dice que ese no cuenta como actividad de base. Tiene que
   * tocar Postgres de verdad.
   *
   * Se consulta `configuracion_negocio` con la credencial de la terminal.
   * Medido: devuelve **200 con `[]`**, porque la terminal no tiene política de
   * lectura sobre ninguna tabla (§4.21) —y aun así **la consulta llegó a
   * Postgres**, que es lo único que hace falta para que cuente como actividad.
   * Una lista vacía acá no es un fallo: es el resultado correcto.
   */
  public tocaLatido(): boolean {
    return this.ultimoLatido === null || this.ahora() - this.ultimoLatido >= PERIODO_DEL_LATIDO_MS;
  }

  public async latir(accessToken: string): Promise<boolean> {
    this.ultimoLatido = this.ahora();
    const cancelacion = new AbortController();
    const reloj = setTimeout(() => {
      cancelacion.abort();
    }, TIEMPO_MAXIMO_DE_SALUD_MS);
    try {
      const respuesta = await this.buscar(
        `${this.urlDelProyecto}/rest/v1/configuracion_negocio?select=id&limit=1`,
        {
          method: 'GET',
          headers: { apikey: this.llavePublicable, Authorization: `Bearer ${accessToken}` },
          signal: cancelacion.signal,
        },
      );
      const OK = 200;
      const bien = respuesta.status === OK;
      this.registrar(
        bien
          ? 'latido diario: la base contestó, el proyecto cuenta como activo'
          : `latido diario: la base contestó ${String(respuesta.status)}`,
      );
      return bien;
    } catch (error) {
      this.registrar(
        `latido diario: no se pudo, se reintenta mañana (${error instanceof Error ? error.message : String(error)})`,
      );
      return false;
    } finally {
      clearTimeout(reloj);
    }
  }
}
