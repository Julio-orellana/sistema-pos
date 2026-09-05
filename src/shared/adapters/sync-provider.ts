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

/** Resultado de subir un grupo de cambios. */
export interface ResultadoEmpuje {
  readonly ok: boolean;
  readonly adaptador: string;
  readonly cambiosAceptados: number;
  readonly cambiosRechazados: number;
  /** Descripción de cada rechazo, para que el administrador sepa qué revisar. */
  readonly errores: readonly string[];
  /** `true` si no hubo llamada de red porque el adaptador es simulado. */
  readonly simulado: boolean;
}

/** Resultado de bajar cambios desde la nube. */
export interface ResultadoTraida {
  readonly ok: boolean;
  readonly adaptador: string;
  readonly cambios: readonly CambioSincronizable[];
  /** Marca de tiempo hasta la cual se trajeron cambios; sirve de punto de partida
   *  para la siguiente sincronización incremental. */
  readonly sincronizadoHasta: string;
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

  /** Sube al servidor un grupo de cambios locales. */
  empujarCambios(cambios: readonly CambioSincronizable[]): Promise<ResultadoEmpuje>;

  /** Baja del servidor los cambios ocurridos después de `desde` (ISO-8601 UTC). */
  traerCambios(desde: string): Promise<ResultadoTraida>;

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

  public traerCambios(desde: string): Promise<ResultadoTraida> {
    // Un adaptador simulado no inventa datos remotos: devolver cambios falsos
    // haría que el resto del sistema pareciera funcionar por razones equivocadas.
    return Promise.resolve({
      ok: true,
      adaptador: this.nombre,
      cambios: [],
      sincronizadoHasta: desde,
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
