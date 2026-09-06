/** Acceso a las denominaciones de efectivo y al desglose del arqueo. */

import type {
  Denominacion,
  DesgloseDeCaja,
  LineaDeDesglose,
  MomentoDeArqueo,
  TipoDeDenominacion,
} from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { desdeColumnaBooleana, desdeColumnaDecimal } from '../decimal-columns';

/** Fila cruda de `denominaciones`. */
interface FilaDenominacion {
  readonly id: string;
  readonly valor: string;
  readonly tipo: TipoDeDenominacion;
  readonly orden: number;
  readonly activo: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aDenominacion(fila: FilaDenominacion): Denominacion {
  return {
    id: fila.id,
    valor: desdeColumnaDecimal(fila.valor, 'denominaciones.valor'),
    tipo: fila.tipo,
    orden: fila.orden,
    activo: desdeColumnaBooleana(fila.activo, 'denominaciones.activo'),
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDeDenominaciones extends RepositorioBase {
  /** Denominaciones activas, en el orden en que se muestran al contar. */
  public listarActivas(): Denominacion[] {
    const filas = this.base
      .prepare('SELECT * FROM denominaciones WHERE activo = 1 ORDER BY orden')
      .all() as FilaDenominacion[];
    return filas.map(aDenominacion);
  }

  public obtenerPorId(id: string): Denominacion | null {
    const fila = this.base.prepare('SELECT * FROM denominaciones WHERE id = ?').get(id) as
      | FilaDenominacion
      | undefined;
    return fila === undefined ? null : aDenominacion(fila);
  }
}

/** Fila cruda de `caja_sesion_denominaciones`. */
interface FilaDesglose {
  readonly id: string;
  readonly caja_sesion_id: string;
  readonly denominacion_id: string;
  readonly momento: MomentoDeArqueo;
  readonly cantidad: number;
  readonly creado_en: string;
}

function aDesglose(fila: FilaDesglose): DesgloseDeCaja {
  return {
    id: fila.id,
    cajaSesionId: fila.caja_sesion_id,
    denominacionId: fila.denominacion_id,
    momento: fila.momento,
    cantidad: fila.cantidad,
    creadoEn: fila.creado_en,
  };
}

export class RepositorioDeDesgloseDeCaja extends RepositorioBase {
  /**
   * Guarda el conteo de un momento del turno.
   *
   * Quien llama debe hacerlo dentro de la misma transacción que abre o cierra
   * la sesión: un desglose guardado sin su sesión, o al revés, deja el arqueo
   * a medias. El UNIQUE de la tabla impide contar dos veces la misma
   * denominación en el mismo momento.
   */
  public guardar(
    cajaSesionId: string,
    momento: MomentoDeArqueo,
    lineas: readonly LineaDeDesglose[],
  ): void {
    const momentoActual = ahora();
    for (const linea of lineas) {
      this.ejecutar(() => {
        this.base
          .prepare(
            `INSERT INTO caja_sesion_denominaciones
               (id, caja_sesion_id, denominacion_id, momento, cantidad, creado_en)
             VALUES (@id, @caja_sesion_id, @denominacion_id, @momento, @cantidad, @creado_en)`,
          )
          .run({
            id: nuevoId(),
            caja_sesion_id: cajaSesionId,
            denominacion_id: linea.denominacionId,
            momento,
            cantidad: linea.cantidad,
            creado_en: momentoActual,
          });
      });
    }
  }

  /** Desglose guardado de un momento del turno. */
  public listarPorSesion(cajaSesionId: string, momento: MomentoDeArqueo): DesgloseDeCaja[] {
    const filas = this.base
      .prepare(
        `SELECT d.* FROM caja_sesion_denominaciones d
           JOIN denominaciones den ON den.id = d.denominacion_id
          WHERE d.caja_sesion_id = ? AND d.momento = ?
          ORDER BY den.orden`,
      )
      .all(cajaSesionId, momento) as FilaDesglose[];
    return filas.map(aDesglose);
  }
}
