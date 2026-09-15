/**
 * Adaptador de sincronización con la nube (patrón Adapter/Strategy).
 *
 * REGLA DEL PROYECTO: Supabase se usa en su PLAN GRATUITO durante todo el
 * desarrollo, y el upgrade a plan pagado ocurre solo antes de la entrega. Por
 * eso la implementación por defecto es `SimulatedSyncProvider`: permite
 * desarrollar y probar todo el flujo de sincronización (encolado, reintentos,
 * conflictos) sin hacer una sola llamada de red ni consumir cuota.
 *
 * El dominio nunca importa `@supabase/supabase-js`; solo conoce esta interfaz.
 * Activar la sincronización real será cambiar la variable POS_SYNC_PROVIDER,
 * no modificar la lógica de ventas.
 */

/*
  ===========================================================================
  POR QUÉ ESTA INTERFAZ YA NO TIENE `traerCambios(desde)` — decisión 10
  ===========================================================================

  La tuvo desde el Prompt 1 y **nunca la llamó nadie**: era un método de bajada
  incremental previsto cuando todavía no se había decidido la dirección de la
  sincronización. El diseño la decidió: `docs/SINCRONIZACION.md` §2.2 establece
  que la sincronización continua es **solo de subida**, porque bajar cambios
  contra una base que la terminal también escribe sería tener dos escritores, y
  resolver esos conflictos es un problema que este sistema no necesita tener.

  Dejarla en la interfaz no era gratis: un método que existe invita a usarse, y
  el día que alguien lo llamara estaría reintroduciendo la bajada que el diseño
  descartó, sin que nada fallara.

  **La restauración desde la nube NO se pierde por esto.** Es otra cosa y va a
  tener su propia interfaz en la fase 4.b: no es incremental sino completa, no
  corre en segundo plano sino a pedido de un administrador, y tiene
  precondiciones propias (§6.2). Meterla acá habría sido confundir dos
  operaciones distintas por parecerse en la dirección.
*/

/** Operación que se replica hacia la nube. */
export type OperacionSincronizacion = 'insertar' | 'actualizar' | 'eliminar';

/**
 * Un cambio local pendiente de subir.
 *
 * `actualizadoEn` es una marca de tiempo ISO-8601 en UTC. Se usa cadena y no
 * `Date` porque el cambio viaja por IPC y se guarda en SQLite, y una cadena
 * ISO sobrevive ambos viajes sin ambigüedad de zona horaria.
 */
export interface CambioSincronizable {
  readonly tabla: string;
  readonly idRegistro: string;
  readonly operacion: OperacionSincronizacion;
  readonly datos: Readonly<Record<string, unknown>>;
  readonly actualizadoEn: string;
}

/** Resultado de subir un LOTE de cambios. Una llamada, un lote (§4.3, opción B). */
export interface ResultadoEmpuje {
  readonly ok: boolean;
  readonly adaptador: string;
  readonly cambiosAceptados: number;
  readonly cambiosRechazados: number;
  /** Descripción de cada rechazo, para que el administrador sepa qué revisar. */
  readonly errores: readonly string[];
  /**
   * El archivo que este lote iba a subir ya no está en el disco (§2.5.4).
   *
   * **Es un campo aparte y no un código HTTP inventado, a propósito.** La
   * clasificación de fallos de este proyecto va por código HTTP y nunca por el
   * texto del error, justamente para no adivinar; pero acá **no hubo petición**
   * —el archivo faltaba antes de salir a la red— así que no hay código que
   * mirar. Meterle un 404 de mentira haría que se leyera como una respuesta de
   * la nube, que es lo contrario de lo que pasó.
   */
  readonly archivoAusente?: boolean;
  /**
   * Código HTTP de la respuesta, cuando lo hubo.
   *
   * **ES LO QUE DECIDE SI UN FALLO SE REINTENTA O DETIENE LA COLA.** La
   * sección 3.2 del diseño clasifica por código —429 y 5xx son transitorios,
   * 400/403/409/422 son determinísticos, 401 es de credencial— y esa
   * distinción no se puede adivinar leyendo un texto de error. Va opcional
   * porque un fallo de red no tiene código: ahí no hubo respuesta, y la
   * ausencia se lee como transitorio, que es lo correcto.
   */
  readonly estadoHttp?: number;
  /** `true` si no hubo llamada de red porque el adaptador es simulado. */
  readonly simulado: boolean;
}

/** Estado de la conexión con la nube, para el indicador de la interfaz. */
export interface EstadoSincronizacion {
  readonly disponible: boolean;
  readonly adaptador: string;
  readonly descripcion: string;
  readonly simulado: boolean;
}

/**
 * Contrato que debe cumplir cualquier mecanismo de sincronización.
 * Implementaciones previstas: `SimulatedSyncProvider` (actual) y un adaptador
 * real contra Supabase, que llegará con el módulo de sincronización.
 */
export interface SyncProvider {
  readonly nombre: string;

  /**
   * Sube UN LOTE de cambios, en el orden recibido.
   *
   * El orden no es una sugerencia: son padres antes que hijos, y subirlos al
   * revés lo rechazaría la llave foránea de Postgres (§2.4).
   */
  empujarCambios(cambios: readonly CambioSincronizable[]): Promise<ResultadoEmpuje>;

  /** Informa si la nube está alcanzable, sin intentar sincronizar. */
  consultarEstado(): Promise<EstadoSincronizacion>;
}

/**
 * Implementación por defecto para desarrollo: registra los cambios en memoria
 * y no toca la red.
 *
 * Guarda lo empujado para que las pruebas puedan verificar QUÉ se habría
 * enviado a Supabase sin haberlo enviado realmente. Esa es la diferencia entre
 * un adaptador simulado útil y un stub vacío.
 */
export class SimulatedSyncProvider implements SyncProvider {
  public readonly nombre = 'SimulatedSyncProvider';

  /** Bitácora de todo lo que se habría subido, en orden. */
  private readonly cambiosEmpujados: CambioSincronizable[] = [];

  public empujarCambios(cambios: readonly CambioSincronizable[]): Promise<ResultadoEmpuje> {
    this.cambiosEmpujados.push(...cambios);
    return Promise.resolve({
      ok: true,
      adaptador: this.nombre,
      cambiosAceptados: cambios.length,
      cambiosRechazados: 0,
      errores: [],
      simulado: true,
    });
  }

  public consultarEstado(): Promise<EstadoSincronizacion> {
    return Promise.resolve({
      disponible: true,
      adaptador: this.nombre,
      descripcion:
        'Sincronización simulada: los cambios se registran en memoria y no se envían a Supabase.',
      simulado: true,
    });
  }

  /** Solo para pruebas y diagnóstico: qué se habría enviado a la nube. */
  public obtenerCambiosEmpujados(): readonly CambioSincronizable[] {
    return [...this.cambiosEmpujados];
  }

  /** Solo para pruebas: vacía la bitácora entre casos. */
  public limpiar(): void {
    this.cambiosEmpujados.length = 0;
  }
}
