/**
 * El recibo, armado a partir de lo que YA QUEDÓ GUARDADO.
 *
 * REGLA CENTRAL DE ESTE MÓDULO: **el recibo no calcula nada de negocio.** Lee
 * `ventas`, `venta_detalle`, `recibos` y `configuracion_negocio`, y los muestra.
 * Todo el cálculo —el precio efectivo, el redondeo único, el reparto de
 * centavos— ocurrió una sola vez, dentro de la transacción que registró la
 * venta (§4.13), y su resultado está en la base. Si el recibo volviera a
 * calcular, bastaría que una regla cambiara el año que viene para que
 * reimprimir un comprobante viejo diera otro número, y un documento histórico
 * que cambia retroactivamente es exactamente lo que una auditoría no tolera.
 *
 * LA ÚNICA CIFRA QUE SE DERIVA es cuánto rebajó el descuento, y se deriva de
 * dos valores guardados: `subtotal − total`. NO se vuelve a aplicar el
 * porcentaje sobre el subtotal, aunque `descuento_valor` esté ahí: eso sería
 * recalcular, y con otro modo de redondeo daría un centavo distinto del que el
 * cliente pagó. La resta, en cambio, no puede discrepar con lo cobrado.
 *
 * QUÉ SE RESUELVE EN VIVO Y POR QUÉ. El nombre del cajero, el del administrador
 * que autorizó un descuento y los datos del negocio se leen al imprimir, no se
 * congelan. Es deliberado y es lo que se pidió: reimprimir tiene que reflejar
 * la configuración ACTUAL del negocio, no una copia vieja. La contrapartida es
 * que si alguien se cambia el nombre, un recibo reimpreso sale con el nombre
 * nuevo. Los datos que sí son del documento —el nombre del producto, su unidad
 * y su precio al momento de vender— están congelados en `venta_detalle` y no se
 * tocan.
 */

import type Decimal from 'decimal.js';

import { cantidadLegible, dividir, montoACadena, redondearMonto, restar } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import type {
  ConfiguracionNegocio,
  FormaPago,
  Recibo,
  TipoValor,
} from '@main/database/repositories/entidades';
import type { RepositorioDeAnulacionesDeVenta } from '@main/database/repositories/anulaciones-de-venta';
import type { RepositorioDeConfiguracionDeNegocio } from '@main/database/repositories/configuracion-negocio';
import type { RepositorioDeRecibos } from '@main/database/repositories/recibos';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import type { RepositorioDeVentaDetalle } from '@main/database/repositories/venta-detalle';
import type { RepositorioDeVentas } from '@main/database/repositories/ventas';

/**
 * Marcadores de posición para lo que todavía no configuró nadie.
 *
 * VAN ENTRE CORCHETES Y SE VEN. La alternativa —dejar el renglón en blanco, o
 * peor, poner un nombre de ejemplo— haría que un recibo sin configurar pasara
 * por uno configurado. Entre corchetes, quien lo mire sabe de inmediato que
 * falta cargar el dato, y nadie puede confundirlo con el nombre real de la
 * tienda.
 */
export const MARCADORES = {
  nombreComercial: '[Nombre del negocio]',
  direccion: '[Dirección]',
  telefono: '[Teléfono]',
  nit: '[NIT]',
  /** Cuando el usuario que vendió ya no existe en la base. */
  usuarioDesconocido: '[Usuario eliminado]',
} as const;

/** El texto que encabeza todo comprobante. No es una factura fiscal. */
export const TITULO_DEL_RECIBO = 'RECIBO DE VENTA';

/** La advertencia legal, obligatoria mientras no haya facturación electrónica. */
export const LEYENDA_NO_FISCAL = 'Proforma, no válido como factura fiscal';

/**
 * La marca que lleva el recibo de una venta anulada.
 *
 * Vive acá, con los demás textos del papel, y no en la plantilla: la escriben
 * las DOS salidas —el texto de la térmica y el HTML del PDF— y tienen que decir
 * exactamente lo mismo. Sin acentos a propósito: así sale igual en CP850 y en
 * el PDF, sin depender de la página de códigos de la impresora.
 */
export const MARCA_DE_VENTA_ANULADA = '** VENTA ANULADA **';

/** El pie de todo recibo. */
export const AGRADECIMIENTO = '¡Gracias por su compra!';

/** Una línea del recibo, ya lista para mostrar. */
export interface LineaDeRecibo {
  readonly orden: number;
  readonly producto: string;
  /** Cantidad legible, sin ceros decorativos: «2» y no «2.000». */
  readonly cantidad: string;
  readonly unidad: string;
  /**
   * El precio unitario que SE IMPRIME.
   *
   * Sin descuento es `precio_unitario_snap` tal cual. Con descuento es el
   * precio EFECTIVO —`subtotal_impreso ÷ cantidad`, redondeado a dos
   * decimales—, para que la línea multiplique de verdad. Es un valor de
   * PRESENTACIÓN y no se guarda en ningún lado. Ver `precioParaImprimir`.
   */
  readonly precioUnitario: string;
  /** El importe que sale impreso. Su suma es EXACTAMENTE el total. */
  readonly subtotal: string;
}

/** El descuento de la venta, si lo hubo. */
export interface DescuentoDelRecibo {
  readonly tipo: TipoValor;
  /** El valor configurado: «25.00» significa 25 % o Q25 según el tipo. */
  readonly valor: string;
  /** Cómo se lee: «25 %» o «Q25.00». */
  readonly descripcion: string;
  /** Cuánto rebajó en quetzales. Derivado de `subtotal − total`, no recalculado. */
  readonly rebaja: string;
  /** Quién lo autorizó, o `null` si cupo en el tope del rol. */
  readonly autorizadoPor: string | null;
}

/**
 * La marca de una venta anulada (docs/ANULACION-DE-VENTA.md §5).
 *
 * NO HAY DOCUMENTO NUEVO: no se emite una nota de crédito ni un papel con
 * numeración propia. El recibo conserva su número y TODAS sus cifras —líneas,
 * precios, descuento y total—, y arriba lleva esta marca. Es honesto con lo que
 * pasó: hubo una venta, se entregó ese papel, y después se anuló, con fecha,
 * responsable y motivo.
 *
 * Se lee de `anulaciones_de_venta`, que es la única fuente de «esta venta está
 * anulada» (§1.1). Nunca de `ventas.estado`, que sigue diciendo `completada`
 * también en las anuladas.
 */
export interface AnulacionDelRecibo {
  /** Fecha de la anulación, como «15/09/2026». */
  readonly fecha: string;
  /** Hora de la anulación, como «12:04». */
  readonly hora: string;
  /** Quién la autorizó, con el nombre que tiene HOY, igual que el cajero. */
  readonly autorizadaPor: string;
  readonly motivo: string;
}

/** Todo lo que hace falta para dibujar un recibo, y nada más. */
export interface ModeloDeRecibo {
  readonly negocio: {
    readonly nombreComercial: string;
    readonly direccion: string;
    readonly telefono: string;
    readonly nit: string;
    /** `true` si los cuatro campos siguen sin configurar. */
    readonly sinConfigurar: boolean;
  };
  readonly numeroRecibo: number;
  readonly ventaId: string;
  /** Fecha de la venta, como «11/09/2026». */
  readonly fecha: string;
  /** Hora de la venta, como «15:42». */
  readonly hora: string;
  readonly cajero: string;
  readonly lineas: readonly LineaDeRecibo[];
  readonly subtotal: string;
  readonly descuento: DescuentoDelRecibo | null;
  readonly total: string;
  readonly formaPago: FormaPago;
  readonly numBoleta: string | null;
  /** `true` si es una reimpresión de un recibo ya emitido. */
  readonly reimpresion: boolean;
  /** La marca de anulación, o `null` si la venta sigue en pie. */
  readonly anulacion: AnulacionDelRecibo | null;
}

/** Dependencias del armador. */
export interface DependenciasDelModelo {
  readonly ventas: RepositorioDeVentas;
  readonly ventaDetalle: RepositorioDeVentaDetalle;
  readonly recibos: RepositorioDeRecibos;
  readonly usuarios: RepositorioDeUsuarios;
  readonly configuracion: RepositorioDeConfiguracionDeNegocio;
  readonly anulaciones: RepositorioDeAnulacionesDeVenta;
}

/** Un campo configurado, o su marcador entre corchetes. */
function oMarcador(valor: string | null, marcador: string): string {
  const limpio = (valor ?? '').trim();
  return limpio === '' ? marcador : limpio;
}

/** Decimales de un monto en quetzales. */
const DECIMALES_DE_MONTO = 2;

/** Cómo se lee un descuento: «25 %» o «Q25.00». */
export function describirDescuento(tipo: TipoValor, valor: Decimal): string {
  if (tipo === 'porcentaje') {
    const legible = valor.toFixed(DECIMALES_DE_MONTO).replace(/\.?0+$/, '');
    return `${legible} %`;
  }
  return `Q${montoACadena(valor)}`;
}

/**
 * El precio unitario que sale impreso. **Es presentación, no dato.**
 *
 * SIN DESCUENTO se imprime `precio_unitario_snap` tal cual, porque ahí
 * `cantidad × precio` ya da el importe de la línea y no hace falta calcular
 * nada.
 *
 * CON DESCUENTO no se puede: `subtotal_impreso` es la parte que le toca a la
 * línea del total YA DESCONTADO, así que imprimir el precio de lista daría un
 * renglón que no multiplica —«2 lb × 8.00» al lado de «14.80»— y un recibo que
 * el cliente no puede verificar de cabeza. Se imprime entonces el precio
 * EFECTIVO: `subtotal_impreso ÷ cantidad`.
 *
 * NO SE GUARDA EN NINGÚN LADO. `venta_detalle.precio_unitario_snap` sigue
 * siendo la foto del precio al momento de vender, que es el dato del negocio:
 * lo que el producto costaba. Este número solo existe mientras se dibuja el
 * papel.
 *
 * > **EL MARGEN, DICHO EN VOZ ALTA.** El precio impreso lleva dos decimales,
 * > así que `cantidad × precio_impreso` puede diferir del importe hasta en
 * > **medio centavo por unidad**. Con 2 lb es medio centavo y no se nota; con
 * > **100 lb de maíz puede llegar a Q0.50**, y ahí sí se ve en el papel. Es el
 * > precio inevitable de imprimir un unitario de dos decimales, y aun así es
 * > mucho menos que la diferencia que había antes —Q1.20 en una venta de Q20—.
 * > La prueba «el renglón multiplica» fija esa cota y la deja medida.
 */
export function precioParaImprimir(
  precioSnap: Decimal,
  cantidad: Decimal,
  subtotalImpreso: Decimal,
  hayDescuento: boolean,
): Decimal {
  if (!hayDescuento || cantidad.isZero()) {
    return redondearMonto(precioSnap);
  }
  return redondearMonto(dividir(subtotalImpreso, cantidad));
}

/** Fecha y hora de Guatemala, para el papel que se entrega en el mostrador. */
function fechaYHora(iso: string): { readonly fecha: string; readonly hora: string } {
  const momento = new Date(iso);
  if (Number.isNaN(momento.getTime())) {
    return { fecha: iso, hora: '' };
  }
  /*
    Se formatea en la zona de Guatemala y no en UTC: el papel lo lee alguien
    parado en la tienda, y un recibo emitido a las 15:42 no puede decir 21:42.
    Las cadenas ISO de la base siguen siendo UTC, que es lo correcto para
    guardar; la conversión es solo de presentación.
  */
  const opciones = { timeZone: 'America/Guatemala' } as const;
  return {
    fecha: momento.toLocaleDateString('es-GT', {
      ...opciones,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    hora: momento.toLocaleTimeString('es-GT', {
      ...opciones,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  };
}

/**
 * Arma el recibo de una venta ya registrada.
 *
 * `reimpresion` solo cambia lo que se muestra, nunca las cifras: un recibo
 * reimpreso tiene que decir exactamente los mismos montos que el original,
 * porque salen de las mismas filas.
 */
export function armarModeloDeRecibo(
  dependencias: DependenciasDelModelo,
  recibo: Recibo,
  opciones: { readonly reimpresion?: boolean } = {},
): ModeloDeRecibo {
  const venta = dependencias.ventas.obtenerPorId(recibo.ventaId);
  if (venta === null) {
    throw new ErrorDeNegocio(
      'REFERENCIA_INEXISTENTE',
      'No se encontró la venta de este recibo.',
      `venta_id inexistente: ${recibo.ventaId}`,
    );
  }

  const configuracion: ConfiguracionNegocio = dependencias.configuracion.obtener();
  const { fecha, hora } = fechaYHora(venta.fecha);

  /*
    La marca de anulación sale de `anulaciones_de_venta` y NO CAMBIA NINGUNA
    CIFRA del recibo: el papel sigue diciendo exactamente lo que se le entregó
    al cliente (§5.1). Quien autorizó se resuelve en vivo, como el cajero.
  */
  const anulada = dependencias.anulaciones.obtenerPorVenta(venta.id);
  const anulacion: AnulacionDelRecibo | null =
    anulada === null
      ? null
      : {
          ...fechaYHora(anulada.fecha),
          autorizadaPor:
            dependencias.usuarios.obtenerPorId(anulada.autorizadaPor)?.nombre ??
            MARCADORES.usuarioDesconocido,
          motivo: anulada.motivo,
        };

  const hayDescuento = venta.descuentoTipo !== null && venta.descuentoValor !== null;

  const lineas: LineaDeRecibo[] = dependencias.ventaDetalle
    .listarPorVenta(venta.id)
    .map((linea) => ({
      orden: linea.ordenLinea,
      producto: linea.productoNombreSnap,
      cantidad: cantidadLegible(linea.cantidad),
      unidad: linea.unidadSnap,
      precioUnitario: montoACadena(
        precioParaImprimir(linea.precioUnitarioSnap, linea.cantidad, linea.subtotalImpreso, hayDescuento),
      ),
      // El valor CONCILIADO, no el exacto: es el que suma exactamente el total.
      subtotal: montoACadena(linea.subtotalImpreso),
    }));

  const descuento: DescuentoDelRecibo | null =
    venta.descuentoTipo === null || venta.descuentoValor === null
      ? null
      : {
          tipo: venta.descuentoTipo,
          valor: montoACadena(venta.descuentoValor),
          descripcion: describirDescuento(venta.descuentoTipo, venta.descuentoValor),
          // DERIVADO de dos valores guardados, no recalculado. Ver la cabecera.
          rebaja: montoACadena(restar(venta.subtotal, venta.total)),
          autorizadoPor:
            venta.descuentoAutorizadoPor === null
              ? null
              : (dependencias.usuarios.obtenerPorId(venta.descuentoAutorizadoPor)?.nombre ??
                MARCADORES.usuarioDesconocido),
        };

  return {
    negocio: {
      nombreComercial: oMarcador(configuracion.nombreComercial, MARCADORES.nombreComercial),
      direccion: oMarcador(configuracion.direccion, MARCADORES.direccion),
      telefono: oMarcador(configuracion.telefono, MARCADORES.telefono),
      nit: oMarcador(configuracion.nit, MARCADORES.nit),
      sinConfigurar:
        configuracion.nombreComercial === null &&
        configuracion.direccion === null &&
        configuracion.telefono === null &&
        configuracion.nit === null,
    },
    numeroRecibo: recibo.numeroRecibo,
    ventaId: venta.id,
    fecha,
    hora,
    cajero:
      dependencias.usuarios.obtenerPorId(venta.usuarioId)?.nombre ??
      MARCADORES.usuarioDesconocido,
    lineas,
    subtotal: montoACadena(venta.subtotal),
    descuento,
    total: montoACadena(venta.total),
    formaPago: venta.formaPago,
    numBoleta: venta.numBoleta,
    reimpresion: opciones.reimpresion ?? false,
    anulacion,
  };
}
