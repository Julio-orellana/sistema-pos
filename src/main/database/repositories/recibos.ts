/** Acceso a datos de los comprobantes emitidos. */

import type { NuevoRecibo, Recibo } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaBooleana, desdeColumnaBooleana } from '../decimal-columns';

/** Fila cruda de la tabla `recibos`. */
interface FilaRecibo {
  readonly id: string;
  readonly venta_id: string;
  readonly numero_recibo: number;
  readonly pdf_path: string;
  readonly impreso: number;
  readonly creado_en: string;
}

function aEntidad(fila: FilaRecibo): Recibo {
  return {
    id: fila.id,
    ventaId: fila.venta_id,
    numeroRecibo: fila.numero_recibo,
    pdfPath: fila.pdf_path,
    impreso: desdeColumnaBooleana(fila.impreso, 'recibos.impreso'),
    creadoEn: fila.creado_en,
  };
}

export class RepositorioDeRecibos extends RepositorioBase {
  public crear(datos: NuevoRecibo): Recibo {
    const id = nuevoId();

    this.base
      .prepare(
        `INSERT INTO recibos (id, venta_id, numero_recibo, pdf_path, impreso, creado_en)
         VALUES (@id, @venta_id, @numero_recibo, @pdf_path, @impreso, @creado_en)`,
      )
      .run({
        id,
        venta_id: datos.ventaId,
        numero_recibo: datos.numeroRecibo,
        pdf_path: datos.pdfPath,
        impreso: aColumnaBooleana(datos.impreso ?? false),
        creado_en: ahora(),
      });

    const creado = this.obtenerPorId(id);
    if (creado === null) {
      throw new Error(`No se encontró el recibo recién creado con id ${id}.`);
    }
    return creado;
  }

  public obtenerPorId(id: string): Recibo | null {
    const fila = this.base.prepare('SELECT * FROM recibos WHERE id = ?').get(id) as
      | FilaRecibo
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public obtenerPorVenta(ventaId: string): Recibo | null {
    const fila = this.base.prepare('SELECT * FROM recibos WHERE venta_id = ?').get(ventaId) as
      | FilaRecibo
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  /**
   * Siguiente número de recibo disponible.
   *
   * Es un entero, no un decimal, así que sí se puede calcular en SQL. Quien lo
   * use debe hacerlo dentro de la misma transacción que inserta el recibo, o
   * dos ventas simultáneas podrían pedir el mismo número; el UNIQUE de la
   * columna es la última línea de defensa contra eso.
   */
  public siguienteNumero(): number {
    const fila = this.base
      .prepare('SELECT COALESCE(MAX(numero_recibo), 0) AS ultimo FROM recibos')
      .get() as { readonly ultimo: number };
    return fila.ultimo + 1;
  }

  public marcarImpreso(id: string): void {
    this.base.prepare('UPDATE recibos SET impreso = 1 WHERE id = ?').run(id);
  }
}
