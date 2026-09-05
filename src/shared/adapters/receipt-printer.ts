/**
 * Adaptador de impresión de comprobantes (patrón Adapter/Strategy).
 *
 * REGLA DEL PROYECTO: el PDF del recibo o proforma SIEMPRE se genera, exista o
 * no una impresora térmica. La impresión física es una capa opcional encima
 * del PDF y nunca puede impedir que se cierre una venta. Por eso la
 * implementación por defecto (`NullPrinterProvider`) no hace nada y aun así
 * responde "ok": la venta ya quedó respaldada por su PDF.
 *
 * El dominio nunca importa una librería ESC/POS ni habla con un puerto serial;
 * solo conoce esta interfaz. Cambiar de impresora es cambiar de implementación
 * en la fábrica de adaptadores, no tocar la lógica de ventas.
 */

/** Tipo de comprobante que se manda a imprimir. */
export type TipoComprobante = 'recibo' | 'proforma' | 'corte_de_caja';

/**
 * Datos mínimos que el dominio entrega al adaptador para imprimir.
 *
 * Se mantiene deliberadamente pequeño: el diseño completo del comprobante
 * (líneas de venta, descuentos, inventario descontado) pertenece al módulo de
 * comprobantes y se agregará cuando ese módulo exista. Lo que este contrato
 * garantiza hoy es que la ruta del PDF siempre viaja, porque el PDF es el
 * respaldo obligatorio.
 */
export interface ComprobanteImprimible {
  /** Identificador del comprobante en la base de datos local. */
  readonly idComprobante: string;
  /** Naturaleza del documento. */
  readonly tipo: TipoComprobante;
  /** Ruta absoluta del PDF ya generado. Es obligatoria: sin PDF no se imprime. */
  readonly rutaPdf: string;
  /** Representación en texto plano para impresoras de matriz o térmicas. */
  readonly contenidoTexto?: string;
  /** Cuántas copias físicas se piden. */
  readonly copias: number;
}

/** Resultado de un intento de impresión física. */
export interface ResultadoImpresion {
  /** `true` si el comprobante quedó atendido (impreso o deliberadamente omitido). */
  readonly ok: boolean;
  /** Nombre del adaptador que atendió la solicitud, para el log de auditoría. */
  readonly adaptador: string;
  /** `true` cuando no hubo impresión física pero el PDF cubre el requisito. */
  readonly omitidaPorDiseno: boolean;
  /** Mensaje legible para mostrar al cajero o guardar en la bitácora. */
  readonly mensaje: string;
}

/** Estado de disponibilidad de la impresora, para mostrarlo en la interfaz. */
export interface EstadoImpresora {
  readonly disponible: boolean;
  readonly adaptador: string;
  readonly descripcion: string;
}

/**
 * Contrato que debe cumplir cualquier mecanismo de impresión de comprobantes.
 * Implementaciones previstas: `NullPrinterProvider` (actual) y un adaptador
 * ESC/POS real, que se escribirá cuando Jimmy defina el modelo de impresora.
 */
export interface ReceiptPrinterProvider {
  /** Nombre corto del adaptador, usado en logs y en la pantalla de configuración. */
  readonly nombre: string;

  /** Envía un comprobante a la impresora física. Nunca debe lanzar: los fallos
   *  se reportan en el `ResultadoImpresion` para que la venta no se caiga. */
  imprimirComprobante(comprobante: ComprobanteImprimible): Promise<ResultadoImpresion>;

  /** Consulta si hay impresora lista, para avisar al cajero antes de cobrar. */
  consultarEstado(): Promise<EstadoImpresora>;
}

/**
 * Implementación por defecto: no imprime nada.
 *
 * No es un "stub incompleto", es el comportamiento correcto mientras no haya
 * impresora térmica configurada. Devuelve `ok: true` con
 * `omitidaPorDiseno: true` para que quede claro en la auditoría que la
 * ausencia de impresión fue una decisión de diseño y no una falla.
 */
export class NullPrinterProvider implements ReceiptPrinterProvider {
  public readonly nombre = 'NullPrinterProvider';

  public imprimirComprobante(comprobante: ComprobanteImprimible): Promise<ResultadoImpresion> {
    return Promise.resolve({
      ok: true,
      adaptador: this.nombre,
      omitidaPorDiseno: true,
      mensaje:
        `No hay impresora térmica configurada. El comprobante ${comprobante.idComprobante} ` +
        `quedó respaldado en su PDF: ${comprobante.rutaPdf}`,
    });
  }

  public consultarEstado(): Promise<EstadoImpresora> {
    return Promise.resolve({
      disponible: false,
      adaptador: this.nombre,
      descripcion: 'Sin impresora física. Los comprobantes se entregan únicamente como PDF.',
    });
  }
}
