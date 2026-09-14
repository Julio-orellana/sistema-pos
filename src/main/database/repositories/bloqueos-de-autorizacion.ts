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
export type SuperficieDeAutorizacion =
  | 'salida_controlada'
  | 'cierre_con_diferencia'
  /**
   * Cerrar un turno de caja que abrió OTRA persona. Existe desde que la caja
   * es una sola en todo el sistema (migración 010): al turno de la mañana
   * puede cerrárselo el de la tarde, y eso exige el PIN de un administrador.
   */
  | 'cierre_de_caja_ajena'
  /**
   * Aplicar un descuento que excede el tope del rol de quien vende.
   *
   * **Acepta el PIN normal Y el remoto** desde el 2026-09-11. No siempre fue
   * así: nació aceptando solo el normal, por el principio de alcance mínimo, y
   * Julio decidió explícitamente ampliarlo para los casos en que Jimmy no está
   * en la tienda y hay un cliente esperando. Qué superficie acepta qué está en
   * una sola tabla, `ACEPTA_PIN_REMOTO` de `autenticacion.ts`; no se decide en
   * quien llama.
   */
  | 'descuento_excedente'
  /**
   * Saltar a mano un lote de sincronización detenido con un error
   * determinístico (pantalla de sincronización, Fase 4.a).
   *
   * **Es la única forma legítima de dejar un hueco deliberado en el respaldo
   * de la nube**, y por eso exige el PIN de un administrador con su propio
   * candado: un error de tecleo acá no debe bloquear el ingreso de nadie ni
   * ninguna otra autorización. No acepta el PIN remoto, por alcance mínimo —es
   * incluso más sensible que autorizar una diferencia de caja, porque el hueco
   * que deja es permanente—.
   */
  | 'saltar_lote_de_sincronizacion';

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
