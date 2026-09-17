/**
 * La anulación de una venta tal como la pide la ventana: la coreografía del PIN
 * (docs/ANULACION-DE-VENTA.md §4.3).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO NO VIVE DENTRO DEL MANEJADOR IPC
 * ---------------------------------------------------------------------------
 * Por la misma razón que `FlujoDeCierreDeCaja`: lo que importa —que una
 * validación que falla no pida el PIN, que un PIN rechazado deje su asiento y
 * no anule nada, que el PIN remoto no sirva— tiene que poder probarse contra
 * una base SQLite real, con los servicios reales. El manejador solo valida el
 * payload, exige sesión y delega.
 *
 * ---------------------------------------------------------------------------
 * EL MISMO PATRÓN DEL DESCUENTO EXCEDENTE
 * ---------------------------------------------------------------------------
 * Primero se muestra qué se va a autorizar, después se pide el PIN. Acá no hay
 * ningún monto oculto que revelar después, así que no hace falta el paso extra
 * del cierre de caja (§4.40.5):
 *
 *   1. SIN PIN: se valida todo y se devuelve `REQUIERE_AUTORIZACION` con la
 *      vista previa. Si algo lo impide, sale como error con su motivo y no se
 *      pide el PIN.
 *   2. CON PIN: se VUELVE a validar antes de tocar el PIN —así una venta que se
 *      anuló o una caja que se cerró mientras tanto no consume un intento del
 *      candado—, después `autorizarComoAdministrador` con la superficie
 *      `anulacion_de_venta`, y con el PIN aceptado corre la transacción, que
 *      vuelve a validar todo adentro.
 *   3. YA ANULADA: se regenera el PDF del recibo, para que el archivo del disco
 *      quede marcado en el mismo momento (§5.2). Va DESPUÉS de la transacción,
 *      nunca adentro: escribir un PDF abre una ventana de Chromium, y eso no
 *      puede mantener abierta una escritura de SQLite (§4.14).
 */

import type {
  AnulacionRegistradaIpc,
  PedidoDeAnulacionIpc,
  ResultadoDeAnulacionIpc,
  VistaPreviaDeAnulacionIpc,
} from '@shared/types/ipc';
import type {
  ResultadoDeAnulacion,
  ServicioDeAnulacionDeVenta,
  VistaPreviaDeAnulacion,
} from '@main/domain/venta/servicio-de-anulacion';
import type { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import type { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import type { UsuarioEnSesion } from '@main/domain/usuarios/sesion';

/** Código del primer pedido: todo validado, falta el PIN. */
export const CODIGO_REQUIERE_AUTORIZACION = 'REQUIERE_AUTORIZACION';

/** Código de la anulación hecha. */
export const CODIGO_ANULACION_CORRECTA = 'ANULACION_CORRECTA';

/** Dependencias del flujo. */
export interface DependenciasDeLaAnulacion {
  readonly anulacion: ServicioDeAnulacionDeVenta;
  readonly autenticacion: ServicioDeAutenticacion;
  /**
   * Los recibos, para dejar el PDF del disco marcado en cuanto la anulación se
   * confirma (§5.2).
   *
   * OBLIGATORIA, como `base` en la venta y en la autenticación: opcional, un
   * sitio que se olvidara de pasarla dejaría PDF desactualizados en el disco
   * SIN QUE NADA FALLARA, que es la clase de defecto que este proyecto ya pagó
   * dos veces.
   */
  readonly recibos: ServicioDeRecibos;
}

export class FlujoDeAnulacionDeVenta {
  public constructor(private readonly dependencias: DependenciasDeLaAnulacion) {}

  /**
   * Un pedido de anulación, con o sin PIN.
   *
   * `quienPide` sale de la sesión del proceso principal, nunca del payload. Si
   * la anulación no se puede hacer, lanza el `ErrorDeNegocio` del servicio.
   */
  public async pedir(
    pedido: PedidoDeAnulacionIpc,
    quienPide: UsuarioEnSesion,
  ): Promise<ResultadoDeAnulacionIpc> {
    const datos = { ventaId: pedido.ventaId, motivo: pedido.motivo, voucher: pedido.voucher };
    const vistaPrevia = vistaPreviaParaLaVentana(this.dependencias.anulacion.prepararAnulacion(datos));

    if (pedido.pin === null) {
      return {
        anulada: false,
        codigo: CODIGO_REQUIERE_AUTORIZACION,
        mensaje: 'Anular una venta exige el PIN de un administrador.',
        vistaPrevia,
        segundosParaReintentar: null,
        anulacion: null,
      };
    }

    // Qué PIN acepta la superficie no se decide acá: sale de `ACEPTA_PIN_REMOTO`,
    // y `anulacion_de_venta` NO acepta el remoto (§4.2).
    const permiso = this.dependencias.autenticacion.autorizarComoAdministrador(
      pedido.pin,
      'anulacion_de_venta',
    );

    if (!permiso.autenticado || permiso.usuario === null) {
      // Cada rechazo queda escrito, con su código, como en la salida controlada
      // (§6.1). El candado y `autorizacion_bloqueada` ya los maneja la
      // autenticación.
      this.dependencias.anulacion.registrarRechazoDeAutorizacion(pedido.ventaId, quienPide.id, permiso.codigo);
      return {
        anulada: false,
        codigo: permiso.codigo,
        mensaje: permiso.mensaje,
        vistaPrevia,
        segundosParaReintentar: permiso.segundosParaReintentar,
        anulacion: null,
      };
    }

    const resultado = this.dependencias.anulacion.anular(datos, quienPide.id, {
      autorizadaPor: permiso.usuario.id,
      // La vía la determinó la verificación, nunca quien pide.
      via: permiso.viaDeAutorizacion ?? 'presencial',
    });

    /*
      LA ANULACIÓN YA ESTÁ CONFIRMADA Y LA TRANSACCIÓN CERRADA. Recién ahora se
      regenera el PDF del recibo, para que el archivo del disco no quede ni un
      momento diciendo que esta venta sigue en pie.

      Se espera a que termine ANTES de contestarle a la ventana: si se disparara
      sin esperar, quien mirara el archivo justo después de ver la confirmación
      podría encontrarlo todavía sin marcar. Y no lanza nunca —lo garantiza
      `regenerarPdfDeLaVenta`—, así que un disco lleno no puede convertir una
      anulación hecha en un error en la pantalla.
    */
    await this.dependencias.recibos.regenerarPdfDeLaVenta(resultado.anulacion.ventaId);

    return {
      anulada: true,
      codigo: CODIGO_ANULACION_CORRECTA,
      mensaje:
        resultado.formaPago === 'efectivo'
          ? `Venta anulada. Hay que devolverle Q${resultado.total} al cliente.`
          : 'Venta anulada. La devolución se hace en la terminal del banco.',
      vistaPrevia,
      segundosParaReintentar: null,
      anulacion: anulacionParaLaVentana(resultado),
    };
  }
}

/**
 * La vista previa, campo por campo y con copias nuevas: nada de un objeto de
 * dominio cruza el puente tal cual (§4.42).
 */
function vistaPreviaParaLaVentana(vista: VistaPreviaDeAnulacion): VistaPreviaDeAnulacionIpc {
  return {
    ventaId: vista.ventaId,
    numeroRecibo: vista.numeroRecibo,
    fecha: vista.fecha,
    vendidaPor: { id: vista.vendidaPor.id, nombre: vista.vendidaPor.nombre },
    cajaAbiertaPor: { id: vista.cajaAbiertaPor.id, nombre: vista.cajaAbiertaPor.nombre },
    formaPago: vista.formaPago,
    numBoleta: vista.numBoleta,
    total: vista.total,
    lineas: vista.lineas.map((linea) => ({
      productoId: linea.productoId,
      nombreSnap: linea.nombreSnap,
      unidadSnap: linea.unidadSnap,
      cantidad: linea.cantidad,
      productoActivo: linea.productoActivo,
    })),
    productosDesactivados: [...vista.productosDesactivados],
    avisoDeDevolucion: vista.avisoDeDevolucion,
  };
}

/** La anulación hecha, campo por campo. */
function anulacionParaLaVentana(resultado: ResultadoDeAnulacion): AnulacionRegistradaIpc {
  return {
    id: resultado.anulacion.id,
    ventaId: resultado.anulacion.ventaId,
    fecha: resultado.anulacion.fecha,
    solicitadaPor: resultado.anulacion.solicitadaPor,
    autorizadaPor: resultado.anulacion.autorizadaPor,
    autorizadaVia: resultado.anulacion.autorizadaVia,
    motivo: resultado.anulacion.motivo,
    numeroRecibo: resultado.numeroRecibo,
    formaPago: resultado.formaPago,
    total: resultado.total,
    efectivoQueDejaDeContar: resultado.efectivoQueDejaDeContar,
    productos: resultado.productos.map((producto) => ({
      productoId: producto.productoId,
      nombreSnap: producto.nombreSnap,
      unidadSnap: producto.unidadSnap,
      cantidad: producto.cantidad,
      productoActivo: producto.productoActivo,
      saldoAnterior: producto.saldoAnterior,
      saldoNuevo: producto.saldoNuevo,
    })),
  };
}
