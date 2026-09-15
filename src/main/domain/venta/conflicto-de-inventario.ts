/**
 * El asiento `conflicto_de_inventario`: UNA SOLA FORMA y UNA SOLA PUERTA.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE (2026-09-15)
 * ---------------------------------------------------------------------------
 * La venta y la anulación escriben la MISMA acción cuando un comparar-y-cambiar
 * de `productos` afecta cero filas (CLAUDE.md §4.3). Se escribieron a la vez,
 * sin verse, y quedaron con dos formas distintas del mismo asiento:
 *
 *   venta     { operacion, productoId, nombre, comparacion,
 *               saldoQueSeLeyo, cantidadVendidaQueSeLeyo, momento }
 *   anulación { operacion, ventaId, productoId, nombre, detalle,
 *               saldoLeido, cantidadVendidaLeida, causaTecnica }
 *
 * Cinco claves distintas para decir lo mismo: un auditor que filtrara por la
 * acción iba a encontrar las dos. Y además la anulación NO envolvía la
 * escritura: si el asiento fallaba, el cajero recibía ese error en lugar del
 * conflicto. Julio decidió la forma única; es la de abajo.
 *
 * Nadie más puede escribir esta acción: la prueba
 * `conflicto-de-inventario-una-sola-puerta.test.ts` falla nombrando archivo y
 * línea si el texto `conflicto_de_inventario` aparece en cualquier otro
 * archivo del proceso principal.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA
 * ---------------------------------------------------------------------------
 * `valor_nuevo` = { operacion, ventaId, productoId, nombre, comparacion,
 *                   saldoQueSeLeyo, cantidadVendidaQueSeLeyo, causaTecnica }
 *
 *   · Los nombres son los que ya usaba la venta (`saldoQueSeLeyo`,
 *     `comparacion`). `comparacion` es el NOMBRE DE LA COLUMNA cuyo
 *     comparar-y-cambiar falló, sin traducir: las dos operaciones comparan
 *     exactamente las mismas dos columnas.
 *   · `ventaId` va SIEMPRE, y es `null` en la venta: esa venta nunca existió, y
 *     un id de venta revertida apuntaría a la nada.
 *   · Van los dos valores leídos siempre: `comparacion` dice cuál no coincidió.
 *   · SIN `momento`: repetía la columna `fecha` del mismo asiento, y dos lugares
 *     con el mismo dato pueden llegar a discrepar.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE ESCRIBE
 * ---------------------------------------------------------------------------
 * DESPUÉS de revertir, en su PROPIA transacción y en su propio lote de la cola:
 * escrito adentro se habría revertido con la operación. Un lote de puros
 * asientos va a `sincronizar_asiento` (0027). `entidad_tipo` es `productos`.
 *
 * SI NO SE PUEDE ESCRIBIR, NO LANZA. Quien lo llama lanza después el conflicto
 * de siempre, y el cajero lo recibe igual. La falla va a la bitácora técnica,
 * que es donde queda lo que la base no pudo guardar.
 */

import type { Database } from 'better-sqlite3';

import { cantidadACadena } from '@shared/money';
import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import type { Producto } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { LogTecnico } from '@main/log-tecnico';

/** La acción. El ÚNICO lugar del proceso principal que la escribe. */
export const ACCION_CONFLICTO_DE_INVENTARIO = 'conflicto_de_inventario';

/** Qué operación se revirtió. Es un DATO del asiento, no otra acción (§4.1). */
export type OperacionEnConflicto = 'venta' | 'anulacion';

/** La columna de `productos` cuyo comparar-y-cambiar afectó cero filas. */
export type ComparacionEnConflicto = 'inventario_disponible' | 'cantidad_vendida';

/** Todo lo que hace falta saber de un conflicto para dejar su constancia. */
export interface ConflictoDeInventario {
  readonly operacion: OperacionEnConflicto;
  /** La venta que se intentaba anular; `null` en una venta, que nunca existió. */
  readonly ventaId: string | null;
  /** El producto tal como se leyó DENTRO de la transacción que se revirtió. */
  readonly producto: Producto;
  readonly comparacion: ComparacionEnConflicto;
  /** La misma causa técnica que lleva el error que recibe el cajero. */
  readonly causaTecnica: string;
}

/** El `valor_nuevo` del asiento. La única forma. */
export interface ValorDelConflictoDeInventario {
  readonly operacion: OperacionEnConflicto;
  readonly ventaId: string | null;
  readonly productoId: string;
  readonly nombre: string;
  readonly comparacion: ComparacionEnConflicto;
  readonly saldoQueSeLeyo: string;
  readonly cantidadVendidaQueSeLeyo: string;
  readonly causaTecnica: string;
}

/** Arma el `valor_nuevo`. Pura: se prueba sin base. */
export function valorDelConflictoDeInventario(conflicto: ConflictoDeInventario): ValorDelConflictoDeInventario {
  return {
    operacion: conflicto.operacion,
    ventaId: conflicto.ventaId,
    productoId: conflicto.producto.id,
    nombre: conflicto.producto.nombre,
    comparacion: conflicto.comparacion,
    saldoQueSeLeyo: cantidadACadena(conflicto.producto.inventarioDisponible),
    cantidadVendidaQueSeLeyo: cantidadACadena(conflicto.producto.cantidadVendida),
    causaTecnica: conflicto.causaTecnica,
  };
}

/** Lo que la puerta necesita para escribir. */
export interface DependenciasDelConflictoDeInventario {
  readonly base: Database;
  readonly auditoria: RepositorioDeAuditoria;
  readonly log: LogTecnico;
}

/** Lo que se sabe del intento que se revirtió. */
export interface ConstanciaDelConflicto {
  /** Quien vendía, o quien pidió la anulación. */
  readonly usuarioId: string;
  readonly conflicto: ConflictoDeInventario;
  /** El instante de la operación intentada: va en la columna `fecha`. */
  readonly fecha: string;
}

/**
 * LA PUERTA: escribe el asiento del conflicto, encolado solo, y NO LANZA nunca.
 *
 * Se llama con la transacción de la operación YA revertida.
 */
export function dejarConstanciaDelConflictoDeInventario(
  dependencias: DependenciasDelConflictoDeInventario,
  { usuarioId, conflicto, fecha }: ConstanciaDelConflicto,
): void {
  try {
    conBandejaDeSalida(dependencias.base, () => {
      const asiento = dependencias.auditoria.registrar({
        usuarioId,
        accion: ACCION_CONFLICTO_DE_INVENTARIO,
        entidadTipo: 'productos',
        entidadId: conflicto.producto.id,
        valorNuevo: valorDelConflictoDeInventario(conflicto),
        fecha,
      });
      return {
        resultado: undefined,
        entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
      };
    });
  } catch (falla) {
    const detalle = falla instanceof Error ? falla.message : String(falla);
    const queSeRevirtio =
      conflicto.operacion === 'venta'
        ? `venta de ${usuarioId}`
        : `anulación de la venta ${String(conflicto.ventaId)} pedida por ${usuarioId}`;
    dependencias.log.registrar(
      conflicto.operacion,
      `No se pudo escribir el asiento ${ACCION_CONFLICTO_DE_INVENTARIO} del producto ` +
        `${conflicto.producto.id} (${conflicto.producto.nombre}), comparación ${conflicto.comparacion}, ` +
        `${queSeRevirtio} del ${fecha}: ${detalle}. ` +
        'La operación no se registró y el cajero recibió el conflicto igual.',
    );
  }
}
