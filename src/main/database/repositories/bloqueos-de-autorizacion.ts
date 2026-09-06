/**
 * Acceso al candado de las superficies de autorización.
 *
 * Es un candado POR SUPERFICIE, no por usuario: cuando aparece el diálogo de
 * autorización nadie eligió un usuario todavía, así que no hay a quién
 * imputarle el intento. Ver la cabecera de la migración 003.
 */

import { RepositorioBase, ahora } from './base';

/**
 * Superficies de autorización que tienen candado propio.
 *
 * Debe coincidir con el CHECK de la columna `superficie`. Agregar una exige
 * una migración que amplíe ese CHECK (ver la 006), a propósito: así el
 * conjunto de superficies protegidas queda siempre a la vista.
 */
export type SuperficieDeAutorizacion = 'salida_controlada' | 'cierre_con_diferencia';

/** Estado del candado de una superficie. */
export interface BloqueoDeAutorizacion {
  readonly superficie: SuperficieDeAutorizacion;
  readonly intentosFallidos: number;
  readonly bloqueadoHasta: string | null;
}

/** Fila cruda de la tabla. */
interface FilaBloqueo {
  readonly superficie: SuperficieDeAutorizacion;
  readonly intentos_fallidos: number;
  readonly bloqueado_hasta: string | null;
}

export class RepositorioDeBloqueosDeAutorizacion extends RepositorioBase {
  /**
   * Estado del candado. Si nunca hubo un fallo no hay fila, y eso equivale a
   * "cero intentos, sin bloqueo": se devuelve ese estado en vez de `null` para
   * que quien llama no tenga que distinguir los dos casos.
   */
  public obtener(superficie: SuperficieDeAutorizacion): BloqueoDeAutorizacion {
    const fila = this.base
      .prepare('SELECT * FROM bloqueos_de_autorizacion WHERE superficie = ?')
      .get(superficie) as FilaBloqueo | undefined;

    if (fila === undefined) {
      return { superficie, intentosFallidos: 0, bloqueadoHasta: null };
    }
    return {
      superficie: fila.superficie,
      intentosFallidos: fila.intentos_fallidos,
      bloqueadoHasta: fila.bloqueado_hasta,
    };
  }

  /** Guarda el estado del candado de una superficie. */
  public fijar(
    superficie: SuperficieDeAutorizacion,
    intentosFallidos: number,
    bloqueadoHasta: string | null,
  ): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO bloqueos_de_autorizacion
             (superficie, intentos_fallidos, bloqueado_hasta, actualizado_en)
           VALUES (@superficie, @intentos, @bloqueado_hasta, @actualizado_en)
           ON CONFLICT (superficie) DO UPDATE SET
             intentos_fallidos = @intentos,
             bloqueado_hasta   = @bloqueado_hasta,
             actualizado_en    = @actualizado_en`,
        )
        .run({
          superficie,
          intentos: intentosFallidos,
          bloqueado_hasta: bloqueadoHasta,
          actualizado_en: ahora(),
        });
    });
  }
}
