/**
 * Impresión térmica real, por ESC/POS.
 *
 * CÓMO LLEGA EL RECIBO A LA IMPRESORA. Se escriben los bytes ESC/POS
 * directamente en el dispositivo, como quien copia un archivo a un puerto. Es
 * la vía que funciona con las térmicas genéricas económicas, que exponen un
 * dispositivo de impresora sin necesitar un controlador propio:
 *
 *   · Windows —la plataforma de producción—: un puerto (`\\.\USB001`) o el
 *     recurso compartido de una impresora instalada (`\\equipo\TERMICA`).
 *
 *     CORREGIDO EL 2026-09-15: el ejemplo `\\.\USB001` es PROBABLEMENTE
 *     INCORRECTO y NUNCA SE MIDIÓ EN HARDWARE REAL. Lo encontró la
 *     investigación previa a construir la pantalla de impresora, y lo
 *     confirmaron fuentes externas independientes: `USB001` es un puerto de
 *     la cola de impresión, no un dispositivo que se abra como archivo. Este
 *     proveedor queda SOLO para leer el formato viejo de `impresora.json`; lo
 *     actual es imprimir por la cola de Windows en RAW (`cola-de-windows.ts`,
 *     CLAUDE.md §4.43).
 *   · Linux: `/dev/usb/lp0`.
 *   · macOS, que es solo el entorno de desarrollo, no expone un dispositivo
 *     equivalente; acá se apunta a un archivo para poder inspeccionar los bytes.
 *
 * NO SE AGREGÓ NINGUNA DEPENDENCIA NATIVA. Una librería USB obligaría a
 * recompilar un módulo nativo más para Electron y para Windows, y todo lo que
 * haría es lo que hace `node:fs`: escribir bytes en un descriptor. La parte con
 * sustancia —construir esos bytes— es `escpos.ts`, y es pura y está probada.
 *
 * > **EL MODELO REAL DE JIMMY NO ESTÁ CONFIRMADO.** Llega el jueves. Esto está
 * > escrito contra el estándar más común y **no se probó contra hardware
 * > real**. Ver CLAUDE.md.
 *
 * NUNCA LANZA. El contrato lo exige y la regla del proyecto también: el PDF es
 * el respaldo obligatorio y la impresión es una capa opcional encima, así que
 * ningún fallo de impresora puede tumbar una venta ya cobrada. Todo error sale
 * como un `ResultadoImpresion` con `ok: false` y queda en la bitácora técnica.
 */

import { existsSync, writeFileSync } from 'node:fs';

import type {
  ComprobanteImprimible,
  EstadoImpresora,
  ReceiptPrinterProvider,
  ResultadoImpresion,
} from '@shared/adapters';
import { copiasComoEscPos } from '@main/domain/recibo/escpos';
import type { LogTecnico } from '@main/log-tecnico';

/** Cómo está configurada la impresora de esta terminal. */
export interface ConfiguracionDeImpresora {
  /**
   * Ruta del dispositivo o del recurso compartido donde se escriben los bytes.
   *
   * Es configuración de ESTA TERMINAL, no del negocio: dos cajas podrían tener
   * la impresora en puertos distintos. Por eso NO vive en
   * `configuracion_negocio` —que se espeja en la nube— sino en un archivo local.
   */
  readonly dispositivo: string;
}

export class EscPosPrinterProvider implements ReceiptPrinterProvider {
  public readonly nombre = 'EscPosPrinterProvider';

  private readonly dispositivo: string;
  private readonly log: LogTecnico;

  public constructor(configuracion: ConfiguracionDeImpresora, log: LogTecnico) {
    this.dispositivo = configuracion.dispositivo;
    this.log = log;
  }

  public imprimirComprobante(comprobante: ComprobanteImprimible): Promise<ResultadoImpresion> {
    const copias = comprobante.copiasEnTexto;

    if (copias.length === 0 || copias.some((texto) => texto.trim() === '')) {
      return Promise.resolve(
        this.fallo(comprobante, 'El comprobante llegó sin texto para imprimir.'),
      );
    }

    try {
      // Todas las copias en una sola escritura, cada una con su corte: es lo
      // mismo que manda la cola de Windows (ver `copiasComoEscPos`).
      const bytes = copiasComoEscPos(copias);
      // `writeFileSync` sobre un dispositivo escribe el flujo completo de una
      // vez, que es justo lo que una térmica espera: no hay «archivo» que
      // truncar del otro lado, hay un puerto que recibe bytes.
      writeFileSync(this.dispositivo, bytes);

      this.log.registrar(
        'impresion',
        `Comprobante ${comprobante.idComprobante} enviado a ${this.dispositivo} ` +
          `(${String(bytes.length)} bytes, ${String(copias.length)} copia(s) en una sola escritura).`,
      );

      return Promise.resolve({
        ok: true,
        adaptador: this.nombre,
        omitidaPorDiseno: false,
        mensaje: 'Recibo enviado a la impresora.',
      });
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      return Promise.resolve(this.fallo(comprobante, detalle));
    }
  }

  public consultarEstado(): Promise<EstadoImpresora> {
    const disponible = existsSync(this.dispositivo);
    return Promise.resolve({
      disponible,
      adaptador: this.nombre,
      descripcion: disponible
        ? `Impresora térmica en ${this.dispositivo}.`
        : `No se encuentra el dispositivo ${this.dispositivo}. El recibo queda solo en PDF.`,
    });
  }

  /** Un fallo, anotado en la bitácora TÉCNICA y nunca en la de auditoría. */
  private fallo(comprobante: ComprobanteImprimible, detalle: string): ResultadoImpresion {
    this.log.registrar(
      'impresion',
      `FALLÓ el comprobante ${comprobante.idComprobante} hacia ${this.dispositivo}: ${detalle}`,
    );
    return {
      ok: false,
      adaptador: this.nombre,
      omitidaPorDiseno: false,
      mensaje: 'No se pudo imprimir. El recibo quedó guardado en PDF.',
    };
  }
}
