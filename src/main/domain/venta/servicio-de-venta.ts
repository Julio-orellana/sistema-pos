/**
 * Registro de una venta. La transacción del proyecto.
 *
 * TODO OCURRE DENTRO DE UNA SOLA TRANSACCIÓN: la reverificación de la caja, el
 * descuento de inventario de cada línea, la cabecera, el detalle, los
 * contadores del producto y los asientos de auditoría. Si CUALQUIER paso
 * falla, no queda nada escrito: ni media venta, ni una línea descontada de
 * más.
 *
 * El servicio recibe la conexión —y no solo los repositorios— porque es quien
 * sabe qué va adentro de la transacción. Los repositorios no la abren nunca:
 * cada uno hace su escritura y confía en que quien los llama delimitó el
 * alcance.
 *
 * CERO REINTENTOS AUTOMÁTICOS ante un conflicto de inventario. La política
 * está en CLAUDE.md §4.3 y no se improvisa acá: se revierte todo, se le dice
 * al cajero QUÉ producto falló, y decide él. Reintentar en silencio podría
 * cobrar contra un inventario que nadie revisó, con el cliente enfrente.
 *
 * Y QUEDA CONSTANCIA: después de revertir, en una transacción aparte, se
 * escribe el asiento del conflicto de inventario y se encola solo. §4.3 lo
 * prometía desde el Prompt 7 y hasta el 2026-09-15 no se escribía: el error se
 * lanzaba dentro de la transacción y nadie escribía nada después. El asiento
 * lo escribe `conflicto-de-inventario.ts`, la misma puerta que usa la
 * anulación: una sola forma para las dos operaciones.
 */

import type { Database } from 'better-sqlite3';
import type Decimal from 'decimal.js';

import {
  cantidadACadena,
  esCero,
  esNegativo,
  esPositivo,
  montoACadena,
  multiplicar,
  redondearCantidad,
  redondearMonto,
  repartirMonto,
  restar,
  sumar,
  sumarLista,
} from '@shared/money';
import { precioDeLinea, type OrigenDelPrecio } from '@shared/precio-de-linea';
import { ErrorDeNegocio, errorDeConflictoDeInventario } from '@main/database/errores';
import {
  encolarLote,
  entradasDe,
  type EntradaDelLote,
} from '@main/database/bandeja-de-salida';
import { enTransaccionDeNegocio } from '@main/database/transaccion-en-curso';
import type { LogTecnico } from '@main/log-tecnico';
import {
  dejarConstanciaDelConflictoDeInventario,
  type ComparacionEnConflicto,
} from './conflicto-de-inventario';
import type {
  FormaPago,
  PrecioEspecial,
  Producto,
  Rol,
  TipoValor,
  Venta,
  ViaDeAutorizacion,
} from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeCajaSesiones } from '@main/database/repositories/caja-sesiones';
import type { RepositorioDeLimitesDescuento } from '@main/database/repositories/limites-descuento';
import type { RepositorioDePreciosEspeciales } from '@main/database/repositories/precios-especiales';
import type { RepositorioDeProductos } from '@main/database/repositories/productos';
import type { RepositorioDeVentaDetalle } from '@main/database/repositories/venta-detalle';
import type { RepositorioDeVentas } from '@main/database/repositories/ventas';
import {
  evaluarDescuento,
  montoDelDescuento,
  precioEfectivoDe,
  topeDelRol,
  totalConDescuento,
  type VeredictoDeDescuento,
} from './precios';

/** Acciones de venta que quedan en la bitácora de auditoría. */
export const ACCIONES_DE_VENTA = {
  ventaRegistrada: 'venta_registrada',
  /** Un administrador autorizó un descuento que excedía el tope del rol. */
  descuentoAutorizado: 'descuento_autorizado',
  // El conflicto de inventario NO está acá desde el 2026-09-15: su acción y su
  // forma viven en `conflicto-de-inventario.ts`, compartidas con la anulación.
} as const;

/** Lo que hace falta saber de un conflicto para escribir su asiento. */
interface ConflictoDetectado {
  /** El producto tal como se leyó DENTRO de la transacción que se revirtió. */
  readonly producto: Producto;
  readonly comparacion: ComparacionEnConflicto;
}

/**
 * Un conflicto de inventario, tal como sale de la transacción revertida.
 *
 * NUNCA LLEGA A LA VENTANA. Lleva adentro el `ErrorDeNegocio` que sí llega —el
 * de siempre, armado en el mismo lugar y con el mismo texto— y los datos del
 * asiento que `registrar` escribe DESPUÉS de revertir. Viaja como una clase
 * propia para que `registrar` lo reconozca por su tipo, sin comparar códigos
 * ni textos, y sin una variable que la transacción tenga que ir llenando.
 */
class ConflictoAlVender extends Error {
  public readonly conflicto: ConflictoDetectado;
  public readonly paraElCajero: ErrorDeNegocio;

  public constructor(conflicto: ConflictoDetectado, paraElCajero: ErrorDeNegocio) {
    super(paraElCajero.causaTecnica);
    this.name = 'ConflictoAlVender';
    this.conflicto = conflicto;
    this.paraElCajero = paraElCajero;
  }
}

/** Una línea del ticket, tal como llega desde la pantalla. */
export interface LineaParaRegistrar {
  readonly productoId: string;
  /** Cantidad pedida, en cadena decimal. */
  readonly cantidad: string;
}

/**
 * La autorización de un descuento que excede el tope del rol.
 *
 * **LOS DOS DATOS VIAJAN JUNTOS EN UN SOLO OBJETO, y es deliberado.** La base
 * exige desde la migración 017 que `descuento_autorizado_por` y
 * `descuento_autorizado_via` estén los dos llenos o los dos vacíos; con dos
 * campos sueltos, olvidarse de uno sería un error posible que solo aparecería
 * al insertar. Con un objeto, «autorizante sin vía» **no se puede construir**.
 * Es el mismo criterio que hace imposible declarar efectivo en los dos modos a
 * la vez (§4.9).
 */
export interface AutorizacionDeDescuento {
  /** Administrador cuyo PIN coincidió. */
  readonly autorizadoPor: string;
  /**
   * Presencial si coincidió su PIN normal, remoto si el de autorización a
   * distancia. Lo determina `autorizarComoAdministrador`, nunca quien vende.
   */
  readonly via: ViaDeAutorizacion;
}

/** El descuento discrecional que quien vende decidió aplicar. */
export interface DescuentoDeLaVenta {
  readonly tipo: TipoValor;
  readonly valor: string;
  /**
   * La autorización, si hizo falta. Su PIN lo verifica quien llama, con la
   * superficie `descuento_excedente`, que **acepta el PIN normal y el remoto**
   * desde el 2026-09-11.
   */
  readonly autorizacion?: AutorizacionDeDescuento | null;
}

/** Todo lo que hace falta para registrar una venta. */
export interface DatosDeLaVenta {
  readonly lineas: readonly LineaParaRegistrar[];
  readonly descuento: DescuentoDeLaVenta | null;
  readonly formaPago: FormaPago;
  /** Obligatorio con tarjeta; debe faltar con efectivo. */
  readonly numBoleta: string | null;
}

/** Lo que se le devuelve a la pantalla al terminar. */
export interface ResultadoDeVenta {
  readonly venta: Venta;
  readonly subtotal: string;
  readonly descuentoAplicado: string;
  readonly total: string;
  readonly lineas: number;
  /** Cuántas líneas se cobraron a un precio especial vigente. */
  readonly lineasConPrecioEspecial: number;
  /** Cuántas líneas se cobraron a precio mayorista (spec 002). */
  readonly lineasConPrecioMayorista: number;
}

/** Dependencias del servicio. */
export interface DependenciasDeVenta {
  readonly base: Database;
  readonly ventas: RepositorioDeVentas;
  readonly ventaDetalle: RepositorioDeVentaDetalle;
  readonly productos: RepositorioDeProductos;
  readonly preciosEspeciales: RepositorioDePreciosEspeciales;
  readonly limitesDescuento: RepositorioDeLimitesDescuento;
  readonly cajaSesiones: RepositorioDeCajaSesiones;
  readonly auditoria: RepositorioDeAuditoria;
  /**
   * Bitácora TÉCNICA. Solo se usa si el asiento de un conflicto de inventario
   * no se puede escribir: el cajero recibe el conflicto igual y la falla queda
   * acá, no en silencio. OBLIGATORIA a propósito: opcional, un sitio que se
   * olvidara de pasarla dejaría esa falla sin rastro y nada lo avisaría.
   */
  readonly log: LogTecnico;
  /** Reloj inyectable, para que las pruebas fijen la fecha de vigencia. */
  readonly ahora?: () => number;
}

/** Una línea ya resuelta: con su producto, su precio efectivo y su subtotal. */
interface LineaResuelta {
  readonly producto: Producto;
  readonly cantidad: Decimal;
  readonly precioUnitario: Decimal;
  readonly subtotalExacto: Decimal;
  readonly saldoNuevo: Decimal;
  readonly cantidadVendidaNueva: Decimal;
  readonly ordenLinea: number;
  /**
   * El precio especial que FIJÓ el precio de la línea, o `null`. Desde la spec
   * 002 puede haber un especial vigente que no lo fijó: si el mayorista era
   * más barato, ganó el mayorista y este campo queda en `null`.
   */
  readonly especialAplicado: PrecioEspecial | null;
  /** De dónde salió el precio: lista, especial o mayorista (spec 002). */
  readonly origen: OrigenDelPrecio;
}

/** El descuento ya validado contra el tope del rol. */
interface DescuentoResuelto {
  readonly tipo: TipoValor;
  readonly valor: Decimal;
  readonly veredicto: VeredictoDeDescuento;
  /** Quién autorizó el exceso y cómo. `null` cuando el descuento cupo en el tope. */
  readonly autorizacion: AutorizacionDeDescuento | null;
}

export class ServicioDeVenta {
  private readonly base: Database;
  private readonly ventas: RepositorioDeVentas;
  private readonly ventaDetalle: RepositorioDeVentaDetalle;
  private readonly productos: RepositorioDeProductos;
  private readonly preciosEspeciales: RepositorioDePreciosEspeciales;
  private readonly limitesDescuento: RepositorioDeLimitesDescuento;
  private readonly cajaSesiones: RepositorioDeCajaSesiones;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly log: LogTecnico;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeVenta) {
    this.base = dependencias.base;
    this.ventas = dependencias.ventas;
    this.ventaDetalle = dependencias.ventaDetalle;
    this.productos = dependencias.productos;
    this.preciosEspeciales = dependencias.preciosEspeciales;
    this.limitesDescuento = dependencias.limitesDescuento;
    this.cajaSesiones = dependencias.cajaSesiones;
    this.auditoria = dependencias.auditoria;
    this.log = dependencias.log;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * Registra la venta. Todo o nada.
   *
   * `usuarioId` y `rol` salen de la sesión del proceso principal, NUNCA del
   * payload: si vinieran de la ventana, cualquiera podría declararse
   * administrativo para saltarse el tope de descuento.
   */
  public registrar(usuarioId: string, rol: Rol, datos: DatosDeLaVenta): ResultadoDeVenta {
    this.verificarTicket(datos);
    this.verificarFormaDePago(datos);

    const momento = new Date(this.ahora()).toISOString();

    /*
      `transaction()` de better-sqlite3 revierte con cualquier excepción y
      vuelve a lanzarla. Ese es todo el mecanismo de "todo o nada": adentro no
      hay un solo try/catch que pudiera tragarse un fallo a medio camino y
      dejar la venta escrita a medias.
    */
    const transaccion = (): ResultadoDeVenta =>
      enTransaccionDeNegocio(this.base, (): ResultadoDeVenta => {
        // ---- 1. ¿Sigue habiendo caja abierta de esta persona? ---------------
        // Se reverifica DENTRO de la transacción: entre que se abrió la pantalla
        // y este momento alguien pudo haber cerrado el turno. Y se comprueba
        // ANTES de tocar inventario, para no descontar mercadería de una venta
        // que igual va a rechazarse.
        const caja = this.cajaSesionDe(usuarioId);

        // ---- 2. Cada línea con su precio efectivo ---------------------------
        const vigentes = this.preciosEspeciales.vigentesPorProductoEn(momento);
        const resueltas = datos.lineas.map((linea, indice) =>
          this.resolverLinea(linea, indice, vigentes),
        );

        // ---- 3. Subtotal exacto, descuento y total --------------------------
        const subtotalExacto = sumarLista(resueltas.map((linea) => linea.subtotalExacto));
        const descuento = this.resolverDescuento(rol, datos.descuento);
        const descuentoAplicado =
          descuento === null ? null : montoDelDescuento(subtotalExacto, descuento);
        // REDONDEO ÚNICO AL FINAL: todo lo anterior se mantuvo exacto.
        const total = totalConDescuento(subtotalExacto, descuento);

        // ---- 4. Descontar inventario, línea por línea -----------------------
        // Va DESPUÉS de todas las validaciones y ANTES de insertar nada: si una
        // línea falla, la transacción se revierte y ninguna otra queda tocada.
        // El conflicto sale envuelto para que su asiento se escriba DESPUÉS de
        // revertir (ver el `catch` de abajo); el cajero recibe el error de adentro.
        for (const linea of resueltas) {
          const bajo = this.productos.descontarSiSigueIgual(
            linea.producto.id,
            linea.producto.inventarioDisponible,
            linea.saldoNuevo,
          );
          if (!bajo) {
            throw new ConflictoAlVender(
              { producto: linea.producto, comparacion: 'inventario_disponible' },
              errorDeConflictoDeInventario(
                linea.producto.nombre,
                'El comparar-y-cambiar de inventario del producto ' +
                  `${linea.producto.id} afectó 0 filas: el saldo cambió desde que se leyó ` +
                  `(${cantidadACadena(linea.producto.inventarioDisponible)}).`,
              ),
            );
          }
        }

        // ---- 5. Cabecera y detalle ------------------------------------------
        // Los ids se guardan para la bandeja de salida del paso 8: encolar una
        // fila exige saber cuál es, y el reparto de centavos ya fijó su orden.
        const idsDeDetalle: string[] = [];
        const venta = this.ventas.crear({
          cajaSesionId: caja.id,
          usuarioId,
          fecha: momento,
          subtotal: redondearMonto(subtotalExacto),
          descuentoTipo: descuento?.tipo ?? null,
          descuentoValor: descuento?.valor ?? null,
          descuentoAutorizadoPor: descuento?.autorizacion?.autorizadoPor ?? null,
          descuentoAutorizadoVia: descuento?.autorizacion?.via ?? null,
          total,
          formaPago: datos.formaPago,
          numBoleta: datos.numBoleta,
          estado: 'completada',
        });

        /*
          EL TOTAL MANDA. Los importes que se imprimen se derivan del total ya
          redondeado y se reparten por residuo mayor, así que su suma es
          EXACTAMENTE el total. Redondear cada línea por su cuenta dejaría
          centavos sueltos y un recibo que no cuadra consigo mismo.

          Se usa `repartirMonto` tal como está, sin variante propia: su regla de
          desempate —gana la línea que aparece primero— ya está documentada y
          probada, y una segunda implementación sería un segundo criterio.

          El orden del arreglo es el orden de captura, así que la parte i-ésima
          le toca a la línea de `orden_linea` i. Cambiar ese orden movería el
          centavo de lugar.
        */
        const impresos = repartirMonto(
          total,
          resueltas.map((linea) => linea.subtotalExacto),
        );

        for (const [indice, linea] of resueltas.entries()) {
          const impreso = impresos[indice];
          if (impreso === undefined) {
            // No puede pasar: `repartirMonto` devuelve una parte por ponderación.
            // Se comprueba igual porque un `undefined` colado acá escribiría un
            // importe equivocado en el recibo de un cliente.
            throw new Error(
              `repartirMonto devolvió ${String(impresos.length)} partes para ` +
                `${String(resueltas.length)} líneas.`,
            );
          }
          const linea_ = this.ventaDetalle.crear({
            ventaId: venta.id,
            productoId: linea.producto.id,
            // FOTO del producto al momento de vender: si mañana cambia de nombre
            // o de precio, este recibo se reimprime igual que se entregó.
            productoNombreSnap: linea.producto.nombre,
            unidadSnap: unidadDe(linea.producto),
            cantidad: linea.cantidad,
            precioUnitarioSnap: linea.precioUnitario,
            // Y la FOTO DEL COSTO (migración 032), por la misma razón: si
            // mañana se corrige el costo del producto, el margen de esta venta
            // no cambia. Se lee del MISMO producto que se leyó dentro de esta
            // transacción, así que es el costo vigente en el instante de vender.
            // Sin costo cargado queda en null, nunca en cero.
            costoUnitarioSnap: linea.producto.precioCompra,
            subtotalExacto: linea.subtotalExacto,
            subtotalImpreso: impreso,
            // El orden en que el cajero capturó las líneas: es el orden del
            // recibo y el que hace determinista el reparto de centavos.
            ordenLinea: linea.ordenLinea,
          });
          idsDeDetalle.push(linea_.id);
        }

        // ---- 6. Contadores del producto, en la MISMA transacción ------------
        for (const linea of resueltas) {
          const anotado = this.productos.registrarVentaDeProducto(
            linea.producto.id,
            linea.producto.cantidadVendida,
            linea.cantidadVendidaNueva,
          );
          if (!anotado) {
            throw new ConflictoAlVender(
              { producto: linea.producto, comparacion: 'cantidad_vendida' },
              errorDeConflictoDeInventario(
                linea.producto.nombre,
                'El comparar-y-cambiar de la cantidad vendida del producto ' +
                  `${linea.producto.id} afectó 0 filas: el acumulado cambió desde que se leyó ` +
                  `(${cantidadACadena(linea.producto.cantidadVendida)}).`,
              ),
            );
          }
        }

        // ---- 7. Auditoría ---------------------------------------------------
        const idsDeAuditoria: string[] = [];
        idsDeAuditoria.push(
          this.auditoria.registrar({
          usuarioId,
          accion: ACCIONES_DE_VENTA.ventaRegistrada,
          entidadTipo: 'ventas',
          entidadId: venta.id,
          valorNuevo: {
            cajaSesionId: caja.id,
            // Sin redondear: es el número del que sale el total, y un auditor que
            // quiera rehacer la cuenta necesita el que se usó, no el que se
            // imprimió.
            subtotalExacto: subtotalExacto.toFixed(),
            subtotal: montoACadena(subtotalExacto),
            descuentoTipo: descuento?.tipo ?? null,
            descuentoValor: descuento === null ? null : montoACadena(descuento.valor),
            descuentoAplicado:
              descuentoAplicado === null ? null : montoACadena(descuentoAplicado),
            total: montoACadena(total),
            formaPago: datos.formaPago,
            numBoleta: datos.numBoleta,
            lineas: resueltas.map((linea) => ({
              productoId: linea.producto.id,
              nombre: linea.producto.nombre,
              cantidad: cantidadACadena(linea.cantidad),
              precioBase: montoACadena(linea.producto.precioBase),
              precioUnitario: montoACadena(linea.precioUnitario),
              // Por qué se cobró ESE precio (spec 002, §7): lista, especial o
              // mayorista. Un auditor que vea un precio distinto del de lista
              // no tiene que reconstruirlo.
              origenDelPrecio: linea.origen,
              precioEspecialId: linea.especialAplicado?.id ?? null,
              // La configuración mayorista del producto en ese momento, se haya
              // usado o no: con ella se ve si la cantidad calificaba.
              mayorista:
                linea.producto.mayorista === null
                  ? null
                  : {
                      precio: montoACadena(linea.producto.mayorista.precio),
                      cantidadMinima: cantidadACadena(linea.producto.mayorista.cantidadMinima),
                    },
              saldoAnterior: cantidadACadena(linea.producto.inventarioDisponible),
              saldoNuevo: cantidadACadena(linea.saldoNuevo),
            })),
          },
          fecha: momento,
          }).id,
        );

        if (descuento !== null && descuento.autorizacion !== null) {
          /*
            Asiento PROPIO para la autorización: es un hecho distinto de la
            venta, con otro responsable, y un auditor va a querer listar las
            autorizaciones solas, sin abrir el contenido de cada venta.

            LLEVA LA VÍA, no solo el autorizante. Desde que `descuento_excedente`
            acepta el PIN remoto, «Jimmy autorizó Q40» dejó de ser una sola cosa:
            autorizarlo frente al mostrador viendo el ticket y autorizarlo por
            teléfono sin verlo son dos hechos distintos, y la columna de la venta
            guarda el estado final mientras el asiento guarda el hecho.
          */
          idsDeAuditoria.push(
            this.auditoria.registrar({
            usuarioId: descuento.autorizacion.autorizadoPor,
            accion: ACCIONES_DE_VENTA.descuentoAutorizado,
            entidadTipo: 'ventas',
            entidadId: venta.id,
            valorNuevo: {
              autorizadoPor: descuento.autorizacion.autorizadoPor,
              via: descuento.autorizacion.via,
              solicitadoPor: usuarioId,
              rolDeQuienVende: rol,
              tipo: descuento.tipo,
              valor: montoACadena(descuento.valor),
              topeDelRol: montoACadena(descuento.veredicto.tope),
              exceso: montoACadena(descuento.veredicto.exceso),
            },
            fecha: momento,
            }).id,
          );
        }

        // ---- 8. Bandeja de salida, DENTRO de esta misma transacción ---------
        /*
          El paso que convierte esta transacción en un respaldo confiable. Si se
          escribiera después del COMMIT, un cierre forzado entre los dos dejaría
          una venta cobrada que nunca se va a subir, y este proyecto permite a
          propósito matar el proceso desde el sistema operativo (§4.5).

          EL ORDEN ES EL DE LAS LLAVES FORÁNEAS, padres antes que hijos: los
          productos no dependen de nada, la venta depende de la caja y del
          usuario —que ya subieron en sus propios lotes—, el detalle depende de
          la venta, y los asientos dependen de todo lo anterior. Subirlo al revés
          lo rechazaría Postgres.

          Los productos van como `actualizar` y no como `insertar`: la venta no
          los creó, les bajó el inventario y les movió los contadores.
        */
        const entradas: EntradaDelLote[] = [
          ...entradasDe('productos', resueltas.map((linea) => linea.producto.id), 'actualizar'),
          { tabla: 'ventas', id: venta.id, operacion: 'insertar' },
          ...entradasDe('venta_detalle', idsDeDetalle, 'insertar'),
          ...entradasDe('auditoria_log', idsDeAuditoria, 'insertar'),
        ];
        encolarLote(this.base, entradas);

        return {
          venta,
          subtotal: montoACadena(subtotalExacto),
          descuentoAplicado: montoACadena(descuentoAplicado ?? 0),
          total: montoACadena(total),
          lineas: resueltas.length,
          lineasConPrecioEspecial: resueltas.filter((linea) => linea.origen === 'especial').length,
          lineasConPrecioMayorista: resueltas.filter((linea) => linea.origen === 'mayorista').length,
        };
      });

    try {
      return transaccion();
    } catch (error) {
      if (!(error instanceof ConflictoAlVender)) {
        throw error;
      }
      /*
        LA TRANSACCIÓN YA SE REVIRTIÓ: better-sqlite3 hace el ROLLBACK antes de
        volver a lanzar, y `enTransaccionDeNegocio` ya bajó la señal. Recién
        ahora se puede escribir algo que quede. Escrito adentro, el asiento se
        habría revertido con la venta.

        Después se lanza el MISMO error de negocio que se armó al detectar el
        conflicto: el cajero ve lo de siempre, con el producto nombrado.
      */
      this.dejarConstanciaDelConflicto(usuarioId, error, momento);
      throw error.paraElCajero;
    }
  }

  /**
   * El asiento del conflicto, por la ÚNICA puerta (`conflicto-de-inventario.ts`).
   *
   * Allá está todo lo que antes vivía acá: su propia transacción y su propio
   * lote, `entidad_tipo` = `productos` (la venta nunca existió), y que SI NO SE
   * PUEDE ESCRIBIR NO LANZA: el cajero tiene que recibir el conflicto igual, no
   * un «La operación no pudo completarse» que tape el motivo verdadero, y la
   * falla va a la bitácora técnica. Acá solo se dice qué se leyó y qué falló.
   *
   * La causa técnica del asiento es la MISMA del error que recibe el cajero.
   */
  private dejarConstanciaDelConflicto(
    usuarioId: string,
    error: ConflictoAlVender,
    momento: string,
  ): void {
    dejarConstanciaDelConflictoDeInventario(
      { base: this.base, auditoria: this.auditoria, log: this.log },
      {
        usuarioId,
        conflicto: {
          operacion: 'venta',
          ventaId: null,
          producto: error.conflicto.producto,
          comparacion: error.conflicto.comparacion,
          causaTecnica: error.paraElCajero.causaTecnica,
        },
        fecha: momento,
      },
    );
  }

  /**
   * ¿Este descuento cabe en el tope del rol, y si no, por cuánto se pasa?
   *
   * Existe como método público para que la pantalla pueda MOSTRAR el exceso
   * antes de pedir el PIN, sin tener que intentar cobrar primero. No escribe
   * nada y no reemplaza la validación de `registrar`: esa se hace igual, del
   * lado del proceso principal, porque una comprobación que solo viviera acá
   * se saltaría llamando al canal con el PIN de otra cosa.
   */
  public veredictoDeDescuento(rol: Rol, tipo: TipoValor, valor: string): VeredictoDeDescuento {
    return evaluarDescuento(
      { tipo, valor: redondearMonto(valor) },
      topeDelRol(this.limitesDescuento.obtenerPorRol(rol), rol),
    );
  }

  // -------------------------------------------------------------------------
  // Piezas
  // -------------------------------------------------------------------------

  /** Un ticket vacío, o con el mismo producto dos veces, no se cobra. */
  private verificarTicket(datos: DatosDeLaVenta): void {
    if (datos.lineas.length === 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'No se puede cobrar un ticket vacío.',
        'Se intentó registrar una venta sin líneas.',
      );
    }

    /*
      La pantalla junta las cantidades del mismo producto en una sola línea,
      pero el canal IPC se trata como entrada no confiable. Dos líneas del
      mismo producto leerían las dos el MISMO saldo y la segunda fallaría con
      un conflicto de inventario, que le diría al cajero algo falso: que el
      saldo cambió mientras cobraba. Se rechaza acá, con el motivo verdadero.
    */
    const vistos = new Set<string>();
    for (const linea of datos.lineas) {
      if (vistos.has(linea.productoId)) {
        throw new ErrorDeNegocio(
          'DATO_INVALIDO',
          'El ticket trae el mismo producto en dos líneas. Juntalas en una sola.',
          `producto_id repetido en el ticket: ${linea.productoId}`,
        );
      }
      vistos.add(linea.productoId);
    }
  }

  /**
   * La boleta va con tarjeta y solo con tarjeta.
   *
   * La misma regla la aplica la base (migración 014). Acá está para poder
   * nombrarla en un mensaje que el cajero entienda, en vez de reventar con un
   * error de restricción.
   */
  private verificarFormaDePago(datos: DatosDeLaVenta): void {
    const boleta = (datos.numBoleta ?? '').trim();

    if (datos.formaPago === 'tarjeta' && boleta === '') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Una venta con tarjeta necesita el número de boleta del voucher.',
        "forma_pago='tarjeta' sin num_boleta.",
      );
    }
    if (datos.formaPago === 'efectivo' && boleta !== '') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Una venta en efectivo no lleva número de boleta.',
        "forma_pago='efectivo' con num_boleta.",
      );
    }
  }

  /** La caja abierta que puede usar esta persona, o un error que lo explica. */
  private cajaSesionDe(usuarioId: string): { readonly id: string } {
    const caja = this.cajaSesiones.obtenerAbierta();

    if (caja === null) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'No hay ninguna caja abierta. La venta no se registró.',
        'Se intentó registrar una venta sin sesión de caja abierta.',
      );
    }
    if (caja.usuarioId !== usuarioId) {
      /*
        Vender contra la caja de otra persona le cargaría el efectivo a SU
        corte, y al cerrar aparecería un sobrante que no cometió. Cerrar una
        caja ajena sí se puede, con autorización (§4.9); vender en ella no se
        pidió, así que no se inventa acá una regla de autorización nueva.
      */
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        'La caja abierta es de otra persona. La venta no se registró.',
        `La caja ${caja.id} pertenece a ${caja.usuarioId} y vende ${usuarioId}.`,
      );
    }
    return caja;
  }

  /**
   * Valida el descuento contra el tope del rol y resuelve quién lo autorizó.
   *
   * La regla se hace cumplir ACÁ y no en la pantalla: una validación que
   * viviera solo en la interfaz se saltaría llamando al canal directamente.
   */
  private resolverDescuento(
    rol: Rol,
    descuento: DescuentoDeLaVenta | null,
  ): DescuentoResuelto | null {
    if (descuento === null) {
      return null;
    }

    // Dos decimales, como la columna `ventas.descuento_valor`: un valor con más
    // decimales que los que se van a guardar haría que el total no se pudiera
    // recalcular después a partir de lo almacenado.
    const valor = redondearMonto(descuento.valor);
    if (esCero(valor)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Un descuento de cero no cambia nada. Quitalo o poné un valor.',
        'Descuento con valor 0.',
      );
    }
    if (esNegativo(valor)) {
      // Un descuento negativo sería un recargo encubierto, y encima uno que se
      // saltaría todo el control de topes por rol.
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El descuento no puede ser negativo.',
        `Descuento negativo: ${montoACadena(valor)}`,
      );
    }

    const veredicto = evaluarDescuento(
      { tipo: descuento.tipo, valor },
      topeDelRol(this.limitesDescuento.obtenerPorRol(rol), rol),
    );
    const autorizacion = descuento.autorizacion ?? null;

    if (veredicto.excede && autorizacion === null) {
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        'Ese descuento pasa el límite de tu rol. Un administrador tiene que autorizarlo con su PIN.',
        `Descuento ${montoACadena(valor)} sobre un tope de ${montoACadena(veredicto.tope)}.`,
      );
    }

    return {
      tipo: descuento.tipo,
      valor,
      veredicto,
      /*
        Si NO excede, no se guarda autorizante aunque venga. Registrar una
        autorización que no hizo falta ensuciaría la auditoría con permisos que
        nadie usó, y `WHERE descuento_autorizado_por IS NOT NULL` dejaría de ser
        la lista de las excepciones reales. Se descartan LAS DOS mitades a la
        vez, porque van juntas en el mismo objeto: dejar la vía suelta habría
        hecho que la base rechazara la venta entera.
      */
      autorizacion: veredicto.excede ? autorizacion : null,
    };
  }

  /** Resuelve una línea: producto, precio efectivo, subtotal y saldos nuevos. */
  private resolverLinea(
    linea: LineaParaRegistrar,
    indice: number,
    vigentes: ReadonlyMap<string, readonly PrecioEspecial[]>,
  ): LineaResuelta {
    const producto = this.productos.obtenerPorId(linea.productoId);
    if (producto === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'Uno de los productos del ticket ya no existe. La venta no se registró.',
        `producto_id inexistente: ${linea.productoId}`,
      );
    }
    if (!producto.activo) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `${producto.nombre} se desactivó mientras se armaba el ticket. Quitalo y volvé a cobrar.`,
        `Se intentó vender el producto desactivado ${producto.id}.`,
      );
    }

    const cantidad = redondearCantidad(linea.cantidad);
    if (!esPositivo(cantidad)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `La cantidad de ${producto.nombre} tiene que ser mayor que cero.`,
        `Cantidad no positiva: ${cantidadACadena(cantidad)}`,
      );
    }

    /*
      EL PRECIO DE LA LÍNEA (spec 002): el menor entre lista, especial vigente
      y mayorista si la cantidad llega al umbral. La regla del precio especial
      no cambia —la sigue calculando `precioEfectivoDe`— y su resultado entra
      como un candidato más. La elección la hace `precioDeLinea`, la MISMA
      función que usa la pantalla para mostrar el precio mientras se arma el
      ticket: dos copias de la regla terminarían cobrando un precio distinto
      del que el cliente vio.
    */
    const efectivo = precioEfectivoDe(producto.precioBase, vigentes.get(producto.id) ?? []);
    const elegido = precioDeLinea(
      {
        lista: producto.precioBase,
        especial: efectivo.especialAplicado === null ? null : efectivo.precio,
        mayorista: producto.mayorista,
      },
      cantidad,
    );
    const saldoNuevo = redondearCantidad(restar(producto.inventarioDisponible, cantidad));

    /*
      El piso `>= 0` de la base es la última red, pero llegar hasta allá sería
      abortar con un error de restricción en vez de un mensaje que nombre el
      producto y diga cuánto queda. Se comprueba antes para poder decirlo.
    */
    if (esNegativo(saldoNuevo)) {
      throw new ErrorDeNegocio(
        'STOCK_INSUFICIENTE',
        `No hay suficiente ${producto.nombre}: quedan ` +
          `${cantidadACadena(producto.inventarioDisponible)} y se piden ` +
          `${cantidadACadena(cantidad)}.`,
        `Inventario insuficiente en ${producto.id}.`,
      );
    }

    return {
      producto,
      cantidad,
      precioUnitario: elegido.precio,
      subtotalExacto: multiplicar(cantidad, elegido.precio),
      saldoNuevo,
      cantidadVendidaNueva: redondearCantidad(sumar(producto.cantidadVendida, cantidad)),
      ordenLinea: indice,
      especialAplicado: elegido.origen === 'especial' ? efectivo.especialAplicado : null,
      origen: elegido.origen,
    };
  }
}

/**
 * La unidad que se congela en el detalle de la venta.
 *
 * Un producto por peso siempre tiene `unidad_peso` —lo exige un CHECK del
 * esquema—, así que el respaldo de la derecha no debería usarse nunca; está
 * para no imprimir `null` en un recibo si alguna vez lo hiciera.
 *
 * La usa también la anulación, para comparar la foto `unidad_snap` con la
 * unidad de hoy (docs/ANULACION-DE-VENTA.md §2.3): tiene que ser EXACTAMENTE el
 * mismo cálculo, o una unidad que no cambió parecería cambiada.
 */
export function unidadDe(producto: Producto): string {
  return producto.tipoMedida === 'peso' ? (producto.unidadPeso ?? 'lb') : 'unidad';
}
