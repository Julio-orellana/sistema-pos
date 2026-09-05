/** Acceso a datos de los turnos de caja. */

import type { CajaSesion, CierreDeCaja, EstadoCaja, NuevaCajaSesion } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaMonto, desdeColumnaDecimal, desdeColumnaDecimalNulable } from '../decimal-columns';

/** Fila cruda de la tabla `caja_sesiones`. */
interface FilaCajaSesion {
  readonly id: string;
  readonly usuario_id: string;
  readonly monto_inicial: string;
  readonly abierta_en: string;
  readonly monto_esperado: string | null;
  readonly monto_real: string | null;
  readonly diferencia: string | null;
  readonly cerrada_en: string | null;
  readonly estado: EstadoCaja;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaCajaSesion): CajaSesion {
  return {
    id: fila.id,
    usuarioId: fila.usuario_id,
    montoInicial: desdeColumnaDecimal(fila.monto_inicial, 'caja_sesiones.monto_inicial'),
    abiertaEn: fila.abierta_en,
    montoEsperado: desdeColumnaDecimalNulable(fila.monto_esperado, 'caja_sesiones.monto_esperado'),
    montoReal: desdeColumnaDecimalNulable(fila.monto_real, 'caja_sesiones.monto_real'),
    diferencia: desdeColumnaDecimalNulable(fila.diferencia, 'caja_sesiones.diferencia'),
    cerradaEn: fila.cerrada_en,
    estado: fila.estado,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDeCajaSesiones extends RepositorioBase {
  /**
   * Abre un turno. Si el cajero ya tiene uno abierto, SQLite lo rechaza por el
   * índice único parcial `idx_caja_sesiones_una_abierta`.
   */
  public abrir(datos: NuevaCajaSesion): CajaSesion {
    const id = nuevoId();
    const momento = ahora();

    this.base
      .prepare(
        `INSERT INTO caja_sesiones (
           id, usuario_id, monto_inicial, abierta_en, estado, creado_en, actualizado_en
         ) VALUES (
           @id, @usuario_id, @monto_inicial, @abierta_en, 'abierta', @creado_en, @actualizado_en
         )`,
      )
      .run({
        id,
        usuario_id: datos.usuarioId,
        monto_inicial: aColumnaMonto(datos.montoInicial),
        abierta_en: datos.abiertaEn ?? momento,
        creado_en: momento,
        actualizado_en: momento,
      });

    const abierta = this.obtenerPorId(id);
    if (abierta === null) {
      throw new Error(`No se encontró el turno de caja recién abierto con id ${id}.`);
    }
    return abierta;
  }

  /**
   * Cierra un turno con su corte. El esquema exige que los tres montos vayan
   * juntos: una caja cerrada sin cuadre es un corte a medias.
   */
  public cerrar(id: string, corte: CierreDeCaja): CajaSesion {
    const momento = ahora();

    this.base
      .prepare(
        `UPDATE caja_sesiones
            SET estado = 'cerrada',
                monto_esperado = @monto_esperado,
                monto_real = @monto_real,
                diferencia = @diferencia,
                cerrada_en = @cerrada_en,
                actualizado_en = @actualizado_en
          WHERE id = @id AND estado = 'abierta'`,
      )
      .run({
        id,
        monto_esperado: aColumnaMonto(corte.montoEsperado),
        monto_real: aColumnaMonto(corte.montoReal),
        diferencia: aColumnaMonto(corte.diferencia),
        cerrada_en: corte.cerradaEn ?? momento,
        actualizado_en: momento,
      });

    const cerrada = this.obtenerPorId(id);
    if (cerrada === null) {
      throw new Error(`No se encontró el turno de caja con id ${id}.`);
    }
    return cerrada;
  }

  public obtenerPorId(id: string): CajaSesion | null {
    const fila = this.base.prepare('SELECT * FROM caja_sesiones WHERE id = ?').get(id) as
      | FilaCajaSesion
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /** El turno abierto de un cajero, si tiene alguno. */
  public obtenerAbiertaDeUsuario(usuarioId: string): CajaSesion | null {
    const fila = this.base
      .prepare("SELECT * FROM caja_sesiones WHERE usuario_id = ? AND estado = 'abierta'")
      .get(usuarioId) as FilaCajaSesion | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public listarPorEstado(estado: EstadoCaja): CajaSesion[] {
    const filas = this.base
      .prepare('SELECT * FROM caja_sesiones WHERE estado = ? ORDER BY abierta_en DESC')
      .all(estado) as FilaCajaSesion[];
    return filas.map(aEntidad);
  }
}
