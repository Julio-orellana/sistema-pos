/** Acceso a datos de precios especiales por producto. */

import type { NuevoPrecioEspecial, PrecioEspecial, TipoValor } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaBooleana, aColumnaMonto, desdeColumnaBooleana, desdeColumnaDecimal } from '../decimal-columns';

/** Fila cruda de la tabla `precios_especiales`. */
interface FilaPrecioEspecial {
  readonly id: string;
  readonly producto_id: string;
  readonly tipo: TipoValor;
  readonly valor: string;
  readonly vigente_desde: string;
  readonly vigente_hasta: string | null;
  readonly activo: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaPrecioEspecial): PrecioEspecial {
  return {
    id: fila.id,
    productoId: fila.producto_id,
    tipo: fila.tipo,
    valor: desdeColumnaDecimal(fila.valor, 'precios_especiales.valor'),
    vigenteDesde: fila.vigente_desde,
    vigenteHasta: fila.vigente_hasta,
    activo: desdeColumnaBooleana(fila.activo, 'precios_especiales.activo'),
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDePreciosEspeciales extends RepositorioBase {
  public crear(datos: NuevoPrecioEspecial): PrecioEspecial {
    const id = nuevoId();
    const momento = ahora();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO precios_especiales (
             id, producto_id, tipo, valor, vigente_desde, vigente_hasta, activo, creado_en, actualizado_en
           ) VALUES (
             @id, @producto_id, @tipo, @valor, @vigente_desde, @vigente_hasta, @activo, @creado_en, @actualizado_en
           )`,
        )
        .run({
          id,
          producto_id: datos.productoId,
          tipo: datos.tipo,
          valor: aColumnaMonto(datos.valor),
          vigente_desde: datos.vigenteDesde,
          vigente_hasta: datos.vigenteHasta ?? null,
          activo: aColumnaBooleana(datos.activo ?? true),
          creado_en: momento,
          actualizado_en: momento,
        });
    });

    const creado = this.obtenerPorId(id);
    if (creado === null) {
      throw new Error(`No se encontró el precio especial recién creado con id ${id}.`);
    }
    return creado;
  }

  public obtenerPorId(id: string): PrecioEspecial | null {
    const fila = this.base.prepare('SELECT * FROM precios_especiales WHERE id = ?').get(id) as
      | FilaPrecioEspecial
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public listarPorProducto(productoId: string): PrecioEspecial[] {
    const filas = this.base
      .prepare('SELECT * FROM precios_especiales WHERE producto_id = ? ORDER BY vigente_desde DESC')
      .all(productoId) as FilaPrecioEspecial[];
    return filas.map(aEntidad);
  }

  /**
   * Precios activos de un producto vigentes en un momento dado.
   * Devuelve la lista; decidir cuál se aplica es del módulo de precios.
   */
  public listarVigentes(productoId: string, momento: string): PrecioEspecial[] {
    const filas = this.base
      .prepare(
        `SELECT * FROM precios_especiales
          WHERE producto_id = ?
            AND activo = 1
            AND vigente_desde <= ?
            AND (vigente_hasta IS NULL OR vigente_hasta > ?)
          ORDER BY vigente_desde DESC`,
      )
      .all(productoId, momento, momento) as FilaPrecioEspecial[];
    return filas.map(aEntidad);
  }

  /**
   * Los precios especiales vigentes HOY, de todos los productos a la vez.
   *
   * COMPARA POR DÍA, no por instante, y la diferencia importa: un precio
   * configurado «hasta el 10 de septiembre» tiene que valer todo el 10. La
   * comparación por instante que usa `listarVigentes` lo daría por vencido a
   * las 00:00 de ese día, o sea que el último día no existiría.
   *
   * Se trae todo junto porque la pantalla de venta necesita el precio efectivo
   * de cada producto de la cuadrícula: preguntar uno por uno serían tantas
   * consultas como productos, cada vez que se abre la caja.
   *
   * SOBRE LA ZONA HORARIA: `date()` de SQLite interpreta el instante en UTC, y
   * la tienda está en UTC−6. Un precio que vence «el 10» deja de aplicar a las
   * 18:00 hora de Guatemala si se guardó a medianoche UTC. Hoy no hay pantalla
   * para configurar precios especiales, así que no hay dato real que se vea
   * afectado; queda anotado como pendiente en CLAUDE.md §6.2.
   */
  public vigentesPorProductoEn(momento: string): Map<string, PrecioEspecial[]> {
    const filas = this.base
      .prepare(
        `SELECT * FROM precios_especiales
          WHERE activo = 1
            AND date(vigente_desde) <= date(?)
            AND (vigente_hasta IS NULL OR date(vigente_hasta) >= date(?))
          ORDER BY producto_id, vigente_desde DESC`,
      )
      .all(momento, momento) as FilaPrecioEspecial[];

    const porProducto = new Map<string, PrecioEspecial[]>();
    for (const fila of filas) {
      const entidad = aEntidad(fila);
      const existentes = porProducto.get(entidad.productoId);
      if (existentes === undefined) {
        porProducto.set(entidad.productoId, [entidad]);
      } else {
        existentes.push(entidad);
      }
    }
    return porProducto;
  }

  public desactivar(id: string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE precios_especiales SET activo = 0, actualizado_en = ? WHERE id = ?')
        .run(ahora(), id);
    });
  }
}
