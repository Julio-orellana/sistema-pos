/**
 * Anulación de una venta ya registrada. Diseño aprobado:
 * `docs/ANULACION-DE-VENTA.md`.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA ÚNICA
 * ---------------------------------------------------------------------------
 * Una venta está anulada si y solo si existe su fila en `anulaciones_de_venta`.
 * La fila de `ventas` no se toca nunca, ni `venta_detalle`, ni `recibos`
 * (§1.1). El efectivo esperado y los reportes excluyen la venta anulada con el
 * fragmento `VENTA_SIN_ANULACION`, nunca con `ventas.estado`.
 *
 * ---------------------------------------------------------------------------
 * DOS MOMENTOS, Y EL PIN EN EL MEDIO
 * ---------------------------------------------------------------------------
 *   1. `prepararAnulacion`: valida TODO lo que se puede validar sin PIN y arma
 *      la vista previa. No escribe nada. Si algo lo impide —la caja se cerró,
 *      ya estaba anulada, el voucher no coincide, cambió la unidad, falta el
 *      motivo— lo dice y NO SE LLEGA A PEDIR EL PIN (§4.3, §2.3, §3.3).
 *   2. `anular`: con la autorización ya concedida por
 *      `autorizarComoAdministrador`, corre los ocho pasos de §2.2 en una sola
 *      transacción, que vuelve a validar todo adentro.
 *
 * Quién pide el PIN y registra el rechazo es `FlujoDeAnulacionDeVenta`
 * (`src/main/ipc/anulacion-de-venta.ts`), igual que el cierre de caja: el PIN
 * se verifica ANTES de abrir la transacción.
 *
 * ---------------------------------------------------------------------------
 * LA REPOSICIÓN SUMA SOBRE EL SALDO DE HOY (§2.1)
 * ---------------------------------------------------------------------------
 * Nunca vuelve al saldo que guardó el asiento de la venta: eso borraría los
 * ajustes y las otras ventas que pasaron en el medio. Lee el saldo actual
 * dentro de la transacción y le suma lo vendido, con Decimal.js, y escribe con
 * comparar-y-cambiar (§4.3). Ante un conflicto: CERO REINTENTOS, se revierte
 * todo, y queda un asiento aparte (§2.5).
 *
 * ---------------------------------------------------------------------------
 * ESTE SERVICIO NO LEE LA BITÁCORA (§6.3)
 * ---------------------------------------------------------------------------
 * Los asientos que escribe son fotografías para una persona. Nada decide ni
 * calcula con ellos: si una anulación existe se sabe por su tabla, la
 * reposición lee `productos` y el esperado lee `ventas`. Hay una prueba
 * estructural que lo exige.
 */

import type { Database } from 'better-sqlite3';
import type Decimal from 'decimal.js';

import {
  cantidadACadena,
  esNegativo,
  montoACadena,
  redondearCantidad,
  restar,
  sumar,
} from '@shared/money';
import { ErrorDeNegocio, errorDeConflictoDeInventarioAlAnular } from '@main/database/errores';
import {
  conBandejaDeSalida,
  encolarLote,
  entradasDe,
  type EntradaDelLote,
} from '@main/database/bandeja-de-salida';
import { enTransaccionDeNegocio } from '@main/database/transaccion-en-curso';
import type {
  AnulacionDeVenta,
  CajaSesion,
  FormaPago,
  Producto,
  Venta,
  VentaDetalle,
  ViaDeAutorizacion,
} from '@main/database/repositories/entidades';
import type { RepositorioDeAnulacionesDeVenta } from '@main/database/repositories/anulaciones-de-venta';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeCajaSesiones } from '@main/database/repositories/caja-sesiones';
import type { RepositorioDeProductos } from '@main/database/repositories/productos';
import type { RepositorioDeRecibos } from '@main/database/repositories/recibos';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import type { RepositorioDeVentaDetalle } from '@main/database/repositories/venta-detalle';
import type { RepositorioDeVentas } from '@main/database/repositories/ventas';
import type { LogTecnico } from '@main/log-tecnico';
import {
  dejarConstanciaDelConflictoDeInventario,
  type ComparacionEnConflicto,
} from './conflicto-de-inventario';
import { unidadDe } from './servicio-de-venta';

/** Acciones de la anulación que quedan en la bitácora (§6.1). */
export const ACCIONES_DE_ANULACION = {
  /** La venta se anuló. Va en el lote de la anulación, dentro de su transacción. */
  ventaAnulada: 'venta_anulada',
  /** Un intento de autorizar la anulación que no se aceptó. Suelto. */
  anulacionRechazada: 'anulacion_de_venta_rechazada',
  // El conflicto de inventario NO está acá desde el 2026-09-15: su acción y su
  // única forma viven en `conflicto-de-inventario.ts`, compartidas con la venta.
} as const;

/** Largo máximo del motivo: el mismo tope del ajuste de inventario (§12, decisión 7). */
export const LARGO_MAXIMO_DEL_MOTIVO = 200;

/** Lo que pide quien quiere anular. Sin PIN: el PIN lo maneja el flujo. */
export interface PedidoDeAnulacion {
  readonly ventaId: string;
  readonly motivo: string;
  /**
   * El número de voucher de la venta ORIGINAL. Obligatorio si la venta fue con
   * tarjeta y debe faltar si fue en efectivo (§3.3).
   */
  readonly voucher: string | null;
}

/** La autorización que ya concedió `autorizarComoAdministrador`. Van juntas. */
export interface AutorizacionDeAnulacion {
  readonly autorizadaPor: string;
  readonly via: ViaDeAutorizacion;
}

/** Una persona, con el nombre de hoy. */
export interface PersonaDeLaAnulacion {
  readonly id: string;
  readonly nombre: string;
}

/** Una línea de la venta, tal como se vendió. */
export interface LineaDeLaVistaPrevia {
  readonly productoId: string;
  readonly nombreSnap: string;
  readonly unidadSnap: string;
  readonly cantidad: string;
  /** Si el producto está desactivado hoy: se repone igual y no se reactiva. */
  readonly productoActivo: boolean;
}

/** Lo que se muestra ANTES de pedir el PIN (§4.3). Nunca lleva el teórico de la caja. */
export interface VistaPreviaDeAnulacion {
  readonly ventaId: string;
  /** `null` si la venta no llegó a tener recibo: la aplicación se cayó entre las dos cosas (§4.14). */
  readonly numeroRecibo: number | null;
  readonly fecha: string;
  readonly vendidaPor: PersonaDeLaAnulacion;
  readonly cajaAbiertaPor: PersonaDeLaAnulacion;
  readonly formaPago: FormaPago;
  /** El voucher, solo si fue con tarjeta. Ya lo tecleó quien pide: no revela nada. */
  readonly numBoleta: string | null;
  readonly total: string;
  readonly lineas: readonly LineaDeLaVistaPrevia[];
  /** Los nombres de los productos que hoy están desactivados, para avisarlos. */
  readonly productosDesactivados: readonly string[];
  /** «Hay que devolverle Q27.50 al cliente» o «La devolución se hace en la terminal del banco». */
  readonly avisoDeDevolucion: string;
}

/** Cómo quedó un producto después de reponer. */
export interface ProductoRepuesto {
  readonly productoId: string;
  readonly nombreSnap: string;
  readonly unidadSnap: string;
  readonly cantidad: string;
  readonly productoActivo: boolean;
  readonly saldoAnterior: string;
  readonly saldoNuevo: string;
}

/** El resultado de una anulación hecha. */
export interface ResultadoDeAnulacion {
  readonly anulacion: AnulacionDeVenta;
  readonly numeroRecibo: number | null;
  readonly formaPago: FormaPago;
  readonly total: string;
  /** El total si fue en efectivo; `0.00` si fue con tarjeta (§6.2). */
  readonly efectivoQueDejaDeContar: string;
  readonly productos: readonly ProductoRepuesto[];
}

/** Dependencias del servicio. */
export interface DependenciasDeAnulacion {
  readonly base: Database;
  readonly ventas: RepositorioDeVentas;
  readonly ventaDetalle: RepositorioDeVentaDetalle;
  readonly productos: RepositorioDeProductos;
  readonly cajaSesiones: RepositorioDeCajaSesiones;
  readonly recibos: RepositorioDeRecibos;
  readonly usuarios: RepositorioDeUsuarios;
  readonly anulaciones: RepositorioDeAnulacionesDeVenta;
  readonly auditoria: RepositorioDeAuditoria;
  /**
   * Bitácora técnica: donde queda el asiento de un conflicto que la base no
   * pudo guardar. OBLIGATORIA, como en la venta: opcional, un sitio que se
   * olvidara de pasarla dejaría esa falla sin rastro.
   */
  readonly log: LogTecnico;
  /** Reloj inyectable. */
  readonly ahora?: () => number;
}

/**
 * Un producto de la venta, con todo lo que la reposición va a escribir.
 *
 * Se agrupa POR PRODUCTO (§2.2, paso 2): un producto, una lectura y una
 * escritura. Hoy la venta rechaza el mismo producto dos veces, pero el esquema
 * no lo impide, y `veces` guarda cuántas líneas tenía.
 */
interface ProductoAReponer {
  readonly producto: Producto;
  readonly nombreSnap: string;
  readonly unidadSnap: string;
  readonly veces: number;
  readonly cantidad: Decimal;
  readonly saldoNuevo: Decimal;
  readonly cantidadVendidaNueva: Decimal;
}

/** Todo lo leído y validado para una anulación. */
interface PlanDeAnulacion {
  readonly venta: Venta;
  readonly caja: CajaSesion;
  readonly productos: readonly ProductoAReponer[];
  readonly motivo: string;
}

/**
 * Señal interna de que un comparar-y-cambiar afectó cero filas.
 *
 * Se lanza DENTRO de la transacción para que la revierta entera, y se atrapa
 * AFUERA, ya revertida, para escribir el asiento del conflicto y lanzar el
 * error de negocio. Adentro no hay ningún `catch`.
 */
class ConflictoAlAnular extends Error {
  public constructor(
    public readonly producto: ProductoAReponer,
    /**
     * La columna cuyo comparar-y-cambiar falló. Hasta el 2026-09-15 se llamaba
     * `detalle` y valía `'inventario'` o `'contadores'`: son las mismas dos
     * columnas que compara la venta, y ahora se nombran igual.
     */
    public readonly comparacion: ComparacionEnConflicto,
    public readonly causaTecnica: string,
  ) {
    super(causaTecnica);
    this.name = 'ConflictoAlAnular';
  }
}

/** Nombre que se muestra cuando un usuario no se encuentra, en vez de un id suelto. */
const NOMBRE_DESCONOCIDO = '(usuario desconocido)';

export class ServicioDeAnulacionDeVenta {
  private readonly base: Database;
  private readonly ventas: RepositorioDeVentas;
  private readonly ventaDetalle: RepositorioDeVentaDetalle;
  private readonly productos: RepositorioDeProductos;
  private readonly cajaSesiones: RepositorioDeCajaSesiones;
  private readonly recibos: RepositorioDeRecibos;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly anulaciones: RepositorioDeAnulacionesDeVenta;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly log: LogTecnico;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeAnulacion) {
    this.base = dependencias.base;
    this.ventas = dependencias.ventas;
    this.ventaDetalle = dependencias.ventaDetalle;
    this.productos = dependencias.productos;
    this.cajaSesiones = dependencias.cajaSesiones;
    this.recibos = dependencias.recibos;
    this.usuarios = dependencias.usuarios;
    this.anulaciones = dependencias.anulaciones;
    this.auditoria = dependencias.auditoria;
    this.log = dependencias.log;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * Valida sin PIN y arma la vista previa. No escribe nada.
   *
   * Lanza `ErrorDeNegocio` con el motivo si la anulación no se puede hacer: en
   * ese caso quien llama no pide el PIN.
   */
  public prepararAnulacion(pedido: PedidoDeAnulacion): VistaPreviaDeAnulacion {
    const plan = this.leerYValidar(pedido);
    const lineas = this.ventaDetalle.listarPorVenta(plan.venta.id);
    const activoPorProducto = new Map(plan.productos.map((p) => [p.producto.id, p.producto.activo]));

    return {
      ventaId: plan.venta.id,
      numeroRecibo: this.recibos.obtenerPorVenta(plan.venta.id)?.numeroRecibo ?? null,
      fecha: plan.venta.fecha,
      vendidaPor: this.persona(plan.venta.usuarioId),
      cajaAbiertaPor: this.persona(plan.caja.usuarioId),
      formaPago: plan.venta.formaPago,
      numBoleta: plan.venta.formaPago === 'tarjeta' ? plan.venta.numBoleta : null,
      total: montoACadena(plan.venta.total),
      lineas: lineas.map((linea) => ({
        productoId: linea.productoId,
        nombreSnap: linea.productoNombreSnap,
        unidadSnap: linea.unidadSnap,
        cantidad: cantidadACadena(linea.cantidad),
        productoActivo: activoPorProducto.get(linea.productoId) ?? true,
      })),
      productosDesactivados: plan.productos
        .filter((p) => !p.producto.activo)
        .map((p) => p.producto.nombre),
      avisoDeDevolucion:
        plan.venta.formaPago === 'efectivo'
          ? `Hay que devolverle Q${montoACadena(plan.venta.total)} al cliente.`
          : 'La devolución se hace en la terminal del banco.',
    };
  }

  /**
   * Anula la venta. Todo o nada.
   *
   * `solicitadaPor` sale de la sesión del proceso principal, nunca del payload,
   * y `autorizacion` de un PIN ya aceptado en la superficie `anulacion_de_venta`.
   */
  public anular(
    pedido: PedidoDeAnulacion,
    solicitadaPor: string,
    autorizacion: AutorizacionDeAnulacion,
  ): ResultadoDeAnulacion {
    const momento = new Date(this.ahora()).toISOString();

    try {
      return enTransaccionDeNegocio(this.base, (): ResultadoDeAnulacion => {
        // ---- 1 a 3. Reverificar la venta, la caja y cada producto ----------
        // Entre la vista previa y el PIN alguien pudo cerrar la caja o anular la
        // venta. Se relee TODO dentro de la transacción, con las mismas
        // validaciones, antes de la primera escritura.
        const plan = this.leerYValidar(pedido);

        // ---- 4. Comparar-y-cambiar del inventario, producto por producto ---
        for (const aReponer of plan.productos) {
          const repuso = this.productos.reponerSiSigueIgual(
            aReponer.producto.id,
            aReponer.producto.inventarioDisponible,
            aReponer.saldoNuevo,
          );
          if (!repuso) {
            throw new ConflictoAlAnular(
              aReponer,
              'inventario_disponible',
              'El comparar-y-cambiar de la reposición del producto ' +
                `${aReponer.producto.id} afectó 0 filas: el saldo cambió desde que se leyó ` +
                `(${cantidadACadena(aReponer.producto.inventarioDisponible)}).`,
            );
          }
        }

        // ---- 5. Comparar-y-cambiar de los contadores, en un solo UPDATE -----
        for (const aReponer of plan.productos) {
          const bajaron = this.productos.anularVentaDeProducto(
            aReponer.producto.id,
            aReponer.veces,
            aReponer.producto.cantidadVendida,
            aReponer.cantidadVendidaNueva,
          );
          if (!bajaron) {
            throw new ConflictoAlAnular(
              aReponer,
              // El UPDATE de los contadores compara `cantidad_vendida` con lo leído.
              'cantidad_vendida',
              'El comparar-y-cambiar de los contadores del producto ' +
                `${aReponer.producto.id} afectó 0 filas: la cantidad vendida cambió desde que se leyó ` +
                `(${cantidadACadena(aReponer.producto.cantidadVendida)}).`,
            );
          }
        }

        // ---- 6. La fila de la anulación ------------------------------------
        const anulacion = this.anulaciones.crear({
          ventaId: plan.venta.id,
          solicitadaPor,
          autorizadaPor: autorizacion.autorizadaPor,
          autorizadaVia: autorizacion.via,
          motivo: plan.motivo,
          fecha: momento,
        });

        // ---- 7. El asiento venta_anulada, con el contenido de §6.2 ---------
        const numeroRecibo = this.recibos.obtenerPorVenta(plan.venta.id)?.numeroRecibo ?? null;
        const efectivoQueDejaDeContar =
          plan.venta.formaPago === 'efectivo' ? montoACadena(plan.venta.total) : '0.00';
        const asiento = this.auditoria.registrar({
          // `usuario_id` es quien operó; quien autorizó va dentro del asiento,
          // con la misma convención de `caja_cerrada` (§6.1).
          usuarioId: solicitadaPor,
          accion: ACCIONES_DE_ANULACION.ventaAnulada,
          entidadTipo: 'ventas',
          entidadId: plan.venta.id,
          valorAnterior: {
            ventaId: plan.venta.id,
            numeroRecibo,
            fecha: plan.venta.fecha,
            vendidaPor: plan.venta.usuarioId,
            cajaSesionId: plan.caja.id,
            cajaAbiertaPor: plan.caja.usuarioId,
            formaPago: plan.venta.formaPago,
            numBoleta: plan.venta.numBoleta,
            total: montoACadena(plan.venta.total),
          },
          valorNuevo: {
            anulacionId: anulacion.id,
            solicitadaPor,
            autorizadaPor: autorizacion.autorizadaPor,
            autorizadaVia: autorizacion.via,
            motivo: plan.motivo,
            fecha: momento,
            efectivoQueDejaDeContar,
            lineas: plan.productos.map((aReponer) => ({
              productoId: aReponer.producto.id,
              nombreSnap: aReponer.nombreSnap,
              unidadSnap: aReponer.unidadSnap,
              cantidad: cantidadACadena(aReponer.cantidad),
              productoActivo: aReponer.producto.activo,
              saldoAnterior: cantidadACadena(aReponer.producto.inventarioDisponible),
              saldoNuevo: cantidadACadena(aReponer.saldoNuevo),
              cantidadVendidaAnterior: cantidadACadena(aReponer.producto.cantidadVendida),
              cantidadVendidaNueva: cantidadACadena(aReponer.cantidadVendidaNueva),
            })),
          },
          fecha: momento,
        });

        // ---- 8. El lote, dentro de esta misma transacción (§7.1) -----------
        // NUNCA incluye la fila de `ventas`: en la nube `ventas` solo se inserta,
        // y volver a encolarla se perdería en silencio como `ya_existia` (§0.2).
        const entradas: EntradaDelLote[] = [
          { tabla: 'anulaciones_de_venta', id: anulacion.id, operacion: 'insertar' },
          ...entradasDe(
            'productos',
            plan.productos.map((aReponer) => aReponer.producto.id),
            'actualizar',
          ),
          { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
        ];
        encolarLote(this.base, entradas);

        return {
          anulacion,
          numeroRecibo,
          formaPago: plan.venta.formaPago,
          total: montoACadena(plan.venta.total),
          efectivoQueDejaDeContar,
          productos: plan.productos.map((aReponer) => ({
            productoId: aReponer.producto.id,
            nombreSnap: aReponer.nombreSnap,
            unidadSnap: aReponer.unidadSnap,
            cantidad: cantidadACadena(aReponer.cantidad),
            productoActivo: aReponer.producto.activo,
            saldoAnterior: cantidadACadena(aReponer.producto.inventarioDisponible),
            saldoNuevo: cantidadACadena(aReponer.saldoNuevo),
          })),
        };
      });
    } catch (error) {
      if (!(error instanceof ConflictoAlAnular)) {
        throw error;
      }
      // La transacción ya se revirtió entera. RECIÉN AHORA, en una aparte, queda
      // el asiento: en esta arquitectura un conflicto no debería poder pasar, y
      // cada vez que pasa es evidencia de un segundo escritor (§4.3, §2.5).
      // Si el asiento no se puede escribir, la puerta NO lanza: el error que
      // sigue es el conflicto, igual que en la venta.
      this.registrarConflicto(pedido.ventaId, solicitadaPor, error, momento);
      throw errorDeConflictoDeInventarioAlAnular(error.producto.producto.nombre, error.causaTecnica);
    }
  }

  /**
   * Deja el asiento de un intento de autorizar que no se aceptó (§6.1).
   *
   * Lo llama el flujo con el código que devolvió `autorizarComoAdministrador`.
   * Probar PIN para anular una venta es evidencia del fraude que el control
   * existe para frenar, así que cada rechazo queda escrito, como en la salida
   * controlada. Sube suelto, por `sincronizar_asiento`.
   */
  public registrarRechazoDeAutorizacion(ventaId: string, solicitadaPor: string, codigo: string): void {
    conBandejaDeSalida(this.base, () => {
      const asiento = this.auditoria.registrar({
        usuarioId: solicitadaPor,
        accion: ACCIONES_DE_ANULACION.anulacionRechazada,
        entidadTipo: 'ventas',
        entidadId: ventaId,
        // Nunca el PIN, ni en claro ni con hash.
        valorNuevo: { ventaId, codigo },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
      };
    });
  }

  // -------------------------------------------------------------------------
  // Piezas
  // -------------------------------------------------------------------------

  /**
   * Lee y valida todo, en el orden de §4.3: la venta existe, su caja está
   * abierta, no tiene anulación, el voucher coincide (con tarjeta), ninguna
   * unidad cambió, los contadores alcanzan y el motivo es válido.
   *
   * La usan los dos momentos: fuera de la transacción para la vista previa, y
   * dentro de ella antes de escribir.
   */
  private leerYValidar(pedido: PedidoDeAnulacion): PlanDeAnulacion {
    const venta = this.ventas.obtenerPorId(pedido.ventaId);
    if (venta === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'Esa venta no existe.',
        `venta_id inexistente: ${pedido.ventaId}`,
      );
    }

    const caja = this.cajaSesiones.obtenerPorId(venta.cajaSesionId);
    if (caja === null) {
      // No puede pasar: la llave foránea de `ventas.caja_sesion_id` lo impide.
      throw new Error(`La venta ${venta.id} apunta a una caja inexistente: ${venta.cajaSesionId}.`);
    }
    if (caja.estado !== 'abierta') {
      throw new ErrorDeNegocio(
        'CAJA_DE_LA_VENTA_CERRADA',
        'La caja donde se registró esa venta ya se cerró. Una venta solo se anula mientras su caja sigue abierta.',
        `La caja ${caja.id} de la venta ${venta.id} está ${caja.estado}.`,
      );
    }

    if (this.anulaciones.obtenerPorVenta(venta.id) !== null) {
      throw new ErrorDeNegocio(
        'VENTA_YA_ANULADA',
        'Esa venta ya estaba anulada.',
        `La venta ${venta.id} ya tiene una anulación.`,
      );
    }

    this.verificarVoucher(venta, pedido.voucher);

    const lineas = this.ventaDetalle.listarPorVenta(venta.id);
    if (lineas.length === 0) {
      // No puede pasar: la venta rechaza un ticket vacío. Si pasara, anular
      // «nada» escondería un dato roto detrás de una anulación correcta.
      throw new Error(`La venta ${venta.id} no tiene líneas.`);
    }
    const productos = this.agruparPorProducto(lineas);

    const motivo = this.verificarMotivo(pedido.motivo);

    return { venta, caja, productos, motivo };
  }

  /**
   * El voucher de la venta ORIGINAL (§3.3, decisión 9).
   *
   * Se compara contra `num_boleta` de ESTA venta, recortando los espacios de
   * los dos extremos DE LOS DOS LADOS y nada más: distingue mayúsculas y no
   * quita ceros a la izquierda. Se recorta también lo guardado porque
   * `ServicioDeVenta` guarda la boleta tal como llega, y una venta cobrada
   * llamando al canal a mano podría tener espacios guardados.
   *
   * El mensaje no dice cuál era el voucher correcto.
   */
  private verificarVoucher(venta: Venta, voucher: string | null): void {
    const tecleado = (voucher ?? '').trim();

    if (venta.formaPago === 'efectivo') {
      if (tecleado !== '') {
        throw new ErrorDeNegocio(
          'DATO_INVALIDO',
          'Una venta en efectivo no lleva voucher.',
          `Se mandó un voucher para anular la venta en efectivo ${venta.id}.`,
        );
      }
      return;
    }

    if (tecleado === '') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Esta venta fue con tarjeta: escribí el número de voucher.',
        `Falta el voucher para anular la venta con tarjeta ${venta.id}.`,
      );
    }
    const guardado = (venta.numBoleta ?? '').trim();
    if (tecleado !== guardado) {
      throw new ErrorDeNegocio(
        'VOUCHER_NO_COINCIDE',
        'El voucher no coincide con el de la venta original.',
        `El voucher tecleado no coincide con num_boleta de la venta ${venta.id}.`,
      );
    }
  }

  /**
   * Agrupa las líneas por producto y calcula, para cada uno, lo que se va a
   * escribir: saldo nuevo y contadores nuevos, con todas las validaciones de
   * §2.3 antes de la primera escritura.
   */
  private agruparPorProducto(lineas: readonly VentaDetalle[]): ProductoAReponer[] {
    const grupos = new Map<string, { primera: VentaDetalle; lineas: VentaDetalle[] }>();
    for (const linea of lineas) {
      const grupo = grupos.get(linea.productoId);
      if (grupo === undefined) {
        grupos.set(linea.productoId, { primera: linea, lineas: [linea] });
      } else {
        grupo.lineas.push(linea);
      }
    }

    const planes: ProductoAReponer[] = [];
    for (const { primera, lineas: delProducto } of grupos.values()) {
      const producto = this.productos.obtenerPorId(primera.productoId);
      if (producto === null) {
        // No puede pasar: `venta_detalle.producto_id` tiene ON DELETE RESTRICT.
        throw new Error(`El producto ${primera.productoId} de la venta ${primera.ventaId} no existe.`);
      }

      // La unidad CAMBIADA se rechaza entera, sin convertir (§2.3, decisión 4):
      // no hay factores de conversión, y sumar libras a un producto que hoy se
      // cuenta por unidad dejaría un saldo falso sin ningún error.
      const unidadDeHoy = unidadDe(producto);
      for (const linea of delProducto) {
        if (linea.unidadSnap !== unidadDeHoy) {
          throw new ErrorDeNegocio(
            'UNIDAD_CAMBIADA',
            `La unidad de ${linea.productoNombreSnap} cambió desde la venta ` +
              `(se vendió ${comoSeCuenta(linea.unidadSnap)} y hoy se cuenta ${comoSeCuenta(unidadDeHoy)}). ` +
              'El sistema no tiene cómo convertir la cantidad, así que la venta no se anuló.',
            `unidad_snap '${linea.unidadSnap}' contra unidad actual '${unidadDeHoy}' en ${producto.id}.`,
          );
        }
      }

      const cantidad = redondearCantidad(sumar(...delProducto.map((linea) => linea.cantidad)));
      const cantidadVendidaNueva = redondearCantidad(restar(producto.cantidadVendida, cantidad));
      const veces = delProducto.length;

      // Contadores que quedarían negativos: datos inconsistentes. Se rechaza, sin
      // corregir en silencio (§2.3). Los CHECK de la 015 y la 001 son la última red.
      if (esNegativo(cantidadVendidaNueva) || producto.contadorVentas < veces) {
        throw new ErrorDeNegocio(
          'CONTADORES_INCONSISTENTES',
          `Los acumulados de ${producto.nombre} no alcanzan para descontar esta venta ` +
            `(vendido: ${cantidadACadena(producto.cantidadVendida)} en ${String(producto.contadorVentas)} ventas; ` +
            `a descontar: ${cantidadACadena(cantidad)} en ${String(veces)}). ` +
            'Son datos inconsistentes: la venta no se anuló y hay que revisarlo.',
          `cantidad_vendida ${cantidadACadena(producto.cantidadVendida)} / contador_ventas ${String(producto.contadorVentas)} ` +
            `contra ${cantidadACadena(cantidad)} / ${String(veces)} en ${producto.id}.`,
        );
      }

      planes.push({
        producto,
        nombreSnap: primera.productoNombreSnap,
        unidadSnap: primera.unidadSnap,
        veces,
        cantidad,
        // SUMA sobre el saldo de HOY, leído recién (§2.1). Un producto
        // desactivado se repone igual y no se reactiva (§2.3).
        saldoNuevo: redondearCantidad(sumar(producto.inventarioDisponible, cantidad)),
        cantidadVendidaNueva,
      });
    }
    return planes;
  }

  /** Motivo obligatorio, de hasta 200 caracteres (§12, decisión 7). Se guarda recortado. */
  private verificarMotivo(motivo: string): string {
    const recortado = motivo.trim();
    if (recortado === '') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Escribí el motivo de la anulación.',
        'Anulación sin motivo.',
      );
    }
    // `length` de JavaScript cuenta unidades UTF-16, nunca menos que `length()`
    // de SQLite, que cuenta caracteres: si pasa acá, pasa el CHECK de la 033.
    if (recortado.length > LARGO_MAXIMO_DEL_MOTIVO) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El motivo puede tener hasta ${String(LARGO_MAXIMO_DEL_MOTIVO)} caracteres.`,
        `Motivo de ${String(recortado.length)} caracteres.`,
      );
    }
    return recortado;
  }

  /**
   * Asiento del conflicto, después de revertir (§2.5), por la ÚNICA puerta
   * (`conflicto-de-inventario.ts`), la misma que usa la venta.
   *
   * Hasta el 2026-09-15 este método escribía el asiento por su cuenta, con otra
   * forma (`detalle`, `saldoLeido`, `cantidadVendidaLeida`) y SIN envolverlo: si
   * la base fallaba acá, el cajero recibía ese error en lugar del conflicto.
   */
  private registrarConflicto(
    ventaId: string,
    solicitadaPor: string,
    conflicto: ConflictoAlAnular,
    fecha: string,
  ): void {
    dejarConstanciaDelConflictoDeInventario(
      { base: this.base, auditoria: this.auditoria, log: this.log },
      {
        usuarioId: solicitadaPor,
        conflicto: {
          operacion: 'anulacion',
          ventaId,
          producto: conflicto.producto.producto,
          comparacion: conflicto.comparacion,
          causaTecnica: conflicto.causaTecnica,
        },
        fecha,
      },
    );
  }

  /** Una persona con el nombre de hoy, o un nombre que dice que no se encontró. */
  private persona(id: string): PersonaDeLaAnulacion {
    return { id, nombre: this.usuarios.obtenerPorId(id)?.nombre ?? NOMBRE_DESCONOCIDO };
  }
}

/** «en lb», «en kg» o «por unidad», para que el mensaje se lea bien. */
function comoSeCuenta(unidad: string): string {
  return unidad === 'unidad' ? 'por unidad' : `en ${unidad}`;
}
