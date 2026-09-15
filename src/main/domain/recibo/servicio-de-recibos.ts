/**
 * Emisión y reimpresión de recibos.
 *
 * ES EL ÚNICO LUGAR QUE JUNTA LAS TRES PIEZAS: el modelo armado desde lo
 * guardado, el PDF y el intento de impresión. El servicio de venta no lo
 * conoce; lo llama quien cierra el cobro, DESPUÉS de que la transacción ya
 * terminó (§4.13).
 *
 * POR QUÉ VA DESPUÉS DE LA TRANSACCIÓN Y NO ADENTRO. Generar un PDF abre una
 * ventana de Chromium e imprimir habla con un puerto: las dos cosas son lentas
 * y pueden fallar por motivos que no tienen nada que ver con la venta. Meterlas
 * en la transacción significaría mantener abierta una transacción de escritura
 * de SQLite mientras se espera a un aparato, y que una impresora sin papel
 * revirtiera una venta ya cobrada. **La venta se registra primero y se
 * consolida; el papel viene después.**
 *
 * LA CONSECUENCIA, DICHA EN VOZ ALTA: si la aplicación se cae justo entre la
 * venta y el recibo, queda una venta sin recibo. Es recuperable —el historial
 * muestra las ventas sin recibo y permite emitirlo— y es infinitamente
 * preferible a la alternativa, que es perder la venta por un problema de papel.
 *
 * EL PDF SIEMPRE SE GENERA, haya o no impresora. Es la regla del proyecto desde
 * el Prompt 1 y no se negocia: la impresión física es una capa opcional encima
 * del PDF, nunca un requisito para cerrar una venta.
 *
 * REIMPRIMIR VUELVE A ARMAR TODO desde las filas guardadas, nunca desde el PDF
 * que ya está en el disco. Así, si mañana Jimmy carga por fin el nombre y el
 * NIT de su tienda, un recibo reimpreso sale con los datos correctos en vez de
 * con los marcadores entre corchetes que tenía el original.
 */

import type { Database } from 'better-sqlite3';

import type { ComprobanteImprimible, ReceiptPrinterProvider } from '@shared/adapters';
import { ErrorDeNegocio } from '@main/database/errores';
import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import type { Recibo } from '@main/database/repositories/entidades';
import type { RepositorioDeRecibos } from '@main/database/repositories/recibos';
import type { LogTecnico } from '@main/log-tecnico';
import {
  armarModeloDeRecibo,
  type DependenciasDelModelo,
  type ModeloDeRecibo,
} from './modelo-de-recibo';
import { reciboComoHtml, reciboComoTexto } from './plantilla-de-recibo';
import { resolverRutaDePdf, rutaRelativaDePdf } from './ruta-de-pdf';

/** Convierte el HTML del recibo en un PDF guardado en `destino` (ruta absoluta). */
export type GeneradorDePdf = (html: string, destino: string) => Promise<void>;

/** Qué pasó al emitir o reimprimir un recibo. */
export interface ResultadoDeRecibo {
  readonly recibo: Recibo;
  readonly modelo: ModeloDeRecibo;
  /** Ruta ABSOLUTA del PDF en esta máquina, resuelta desde la relativa que guarda la fila. */
  readonly rutaPdf: string;
  /** `true` si el PDF quedó generado. Es la garantía del proyecto. */
  readonly pdfGenerado: boolean;
  /** `true` si además salió por la impresora térmica. */
  readonly impreso: boolean;
  /** Qué contarle al cajero sobre la impresión, en una frase. */
  readonly mensajeDeImpresion: string;
}

/** Dependencias del servicio. */
export interface DependenciasDeRecibos extends DependenciasDelModelo {
  /**
   * La conexión, para escribir la fila del recibo y su entrada de bandeja de
   * salida en UNA transacción.
   *
   * **Chiquita a propósito: NO envuelve la generación del PDF.** Abrir una
   * ventana de Chromium y hablar con una impresora dentro de una transacción
   * mantendría una escritura de SQLite esperando a un aparato, y una impresora
   * sin papel revertiría una venta ya cobrada (§4.14). La transacción cubre
   * exactamente dos `INSERT`, y el PDF ocurre después.
   */
  readonly base: Database;
  readonly impresora: ReceiptPrinterProvider;
  readonly generarPdf: GeneradorDePdf;
  /**
   * `app.getPath('userData')`. Los PDF viven en `<carpetaDeDatos>/recibos/` y
   * la fila guarda SOLO `recibos/<nombre>.pdf`, relativa, igual que
   * `productos.foto_path` (ver `ruta-de-pdf.ts`).
   */
  readonly carpetaDeDatos: string;
  readonly log: LogTecnico;
  readonly ahora?: () => number;
}

export class ServicioDeRecibos {
  private readonly dependencias: DependenciasDeRecibos;
  private readonly recibos: RepositorioDeRecibos;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeRecibos) {
    this.dependencias = dependencias;
    this.recibos = dependencias.recibos;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * Emite el recibo de una venta recién registrada.
   *
   * Si la venta YA tiene recibo, no crea otro: vuelve a emitir el que hay. La
   * tabla tiene un UNIQUE sobre `venta_id` que lo impediría igual, pero ese
   * error no le diría nada a quien lo provocó, y además reintentar después de
   * un corte de luz es un caso legítimo, no un error.
   */
  public async emitir(ventaId: string): Promise<ResultadoDeRecibo> {
    const existente = this.recibos.obtenerPorVenta(ventaId);
    if (existente !== null) {
      return this.producir(existente, { reimpresion: true });
    }

    /*
      El número y la fila se crean ANTES del PDF, y el nombre del archivo sale
      del número. Al revés —generar el PDF y después pedir el número— habría que
      renombrar el archivo o inventarle un nombre provisional, y un fallo a la
      mitad dejaría PDF huérfanos que nadie sabría a qué venta pertenecen.
    */
    /*
      LA TRANSACCIÓN CUBRE EL NÚMERO Y LA FILA, Y NADA MÁS. El PDF y la
      impresión quedan FUERA a propósito: son lentos y fallan por motivos
      ajenos a la venta, y meterlos adentro mantendría abierta una escritura de
      SQLite esperando a un aparato (§4.14). Lo que sí entra es la entrada de la
      bandeja de salida, porque tiene que compartir transacción con la fila que
      respalda.

      EL RECIBO SE ENCOLA UNA SOLA VEZ, al emitirse. Los cambios posteriores de
      `impreso` y `pdf_path` NO se encolan: son estado de ESTA terminal —si el
      papel salió acá y dónde quedó el archivo en ESTE disco— y no significan
      nada en la nube (`docs/SINCRONIZACION.md` §2.3). Una reimpresión tampoco
      encola: ni siquiera llega hasta acá.
    */
    const recibo = conBandejaDeSalida(this.dependencias.base, () => {
      const numero = this.recibos.siguienteNumero();
      const nombre = this.nombreDeArchivo(numero);
      /*
        RELATIVA A LA CARPETA DE DATOS, NUNCA ABSOLUTA. La fila viaja a la nube
        tal cual, y una ruta absoluta es la de ESTA máquina: no significa nada
        en la computadora que restaure la tienda. Es la misma regla de
        `foto_path` (§4.11), y corrige lo que este servicio hizo hasta la
        migración 030 (ver `ruta-de-pdf.ts`).
      */
      const creado = this.recibos.crear({ ventaId, numeroRecibo: numero, pdfPath: rutaRelativaDePdf(nombre) });

      return {
        resultado: creado,
        entradas: [{ tabla: 'recibos' as const, id: creado.id, operacion: 'insertar' as const }],
      };
    });

    return this.producir(recibo, { reimpresion: false });
  }

  /**
   * Vuelve a emitir un recibo ya existente.
   *
   * REGENERA EL PDF desde las filas guardadas; no reusa el archivo que estaba en
   * el disco. Es lo que permite que un recibo emitido antes de que Jimmy cargara
   * los datos de su tienda salga, al reimprimirse, con el nombre y el NIT
   * correctos en vez de con los marcadores entre corchetes.
   */
  public async reimprimir(reciboId: string): Promise<ResultadoDeRecibo> {
    const recibo = this.recibos.obtenerPorId(reciboId);
    if (recibo === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'No se encontró ese recibo.',
        `recibo_id inexistente: ${reciboId}`,
      );
    }
    return this.producir(recibo, { reimpresion: true });
  }

  /** El modelo de un recibo, sin generar nada. Para mostrarlo en pantalla. */
  public modeloDe(reciboId: string): ModeloDeRecibo {
    const recibo = this.recibos.obtenerPorId(reciboId);
    if (recibo === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'No se encontró ese recibo.',
        `recibo_id inexistente: ${reciboId}`,
      );
    }
    return armarModeloDeRecibo(this.dependencias, recibo);
  }

  /**
   * La ruta ABSOLUTA del PDF de un recibo en ESTA máquina. La fila guarda solo
   * la relativa; quien necesite el archivo —el generador, la impresora, la
   * pantalla del historial— pasa por acá, que además comprueba que la ruta
   * caiga dentro de la carpeta de recibos.
   */
  public rutaAbsolutaDelPdf(recibo: Recibo): string {
    return resolverRutaDePdf(this.dependencias.carpetaDeDatos, recibo.pdfPath);
  }

  // -------------------------------------------------------------------------

  /** Arma el modelo, escribe el PDF e intenta imprimir. En ese orden. */
  private async producir(
    recibo: Recibo,
    opciones: { readonly reimpresion: boolean },
  ): Promise<ResultadoDeRecibo> {
    const modelo = armarModeloDeRecibo(this.dependencias, recibo, opciones);
    const rutaPdf = this.rutaAbsolutaDelPdf(recibo);

    let pdfGenerado = false;
    try {
      await this.dependencias.generarPdf(reciboComoHtml(modelo), rutaPdf);
      pdfGenerado = true;
    } catch (error) {
      /*
        Que falle el PDF es grave —es el respaldo obligatorio— pero NO puede
        tumbar la venta, que a esta altura ya está cobrada y guardada. Se anota
        en la bitácora técnica y se sigue: el recibo existe en la base y se puede
        volver a emitir desde el historial.
      */
      const detalle = error instanceof Error ? error.message : String(error);
      this.dependencias.log.registrar(
        'recibo',
        `FALLÓ el PDF del recibo ${String(recibo.numeroRecibo)} en ${rutaPdf}: ${detalle}`,
      );
    }

    const impresion = await this.intentarImprimir(recibo, modelo, rutaPdf, pdfGenerado);

    return {
      recibo: this.recibos.obtenerPorId(recibo.id) ?? recibo,
      modelo,
      rutaPdf,
      pdfGenerado,
      impreso: impresion.impreso,
      mensajeDeImpresion: impresion.mensaje,
    };
  }

  /**
   * Intenta imprimir. NUNCA lanza.
   *
   * Un fallo de impresora es un evento TÉCNICO, no un hecho del negocio, así
   * que queda en la bitácora técnica y no en `auditoria_log`: esa tabla es
   * evidencia para un auditor y no debe llenarse de ruido de hardware.
   */
  private async intentarImprimir(
    recibo: Recibo,
    modelo: ModeloDeRecibo,
    rutaPdf: string,
    pdfGenerado: boolean,
  ): Promise<{ readonly impreso: boolean; readonly mensaje: string }> {
    const comprobante: ComprobanteImprimible = {
      idComprobante: recibo.id,
      tipo: 'recibo',
      rutaPdf,
      contenidoTexto: reciboComoTexto(modelo),
      copias: 1,
    };

    try {
      const resultado = await this.dependencias.impresora.imprimirComprobante(comprobante);

      if (resultado.ok && !resultado.omitidaPorDiseno) {
        this.recibos.marcarImpreso(recibo.id);
        return { impreso: true, mensaje: resultado.mensaje };
      }

      // `omitidaPorDiseno` es el caso normal sin impresora configurada: no es
      // un fallo, y por eso no se registra como tal.
      if (resultado.omitidaPorDiseno) {
        return {
          impreso: false,
          mensaje: pdfGenerado
            ? 'No hay impresora configurada. El recibo quedó en PDF.'
            : 'No hay impresora configurada, y además no se pudo generar el PDF.',
        };
      }

      return { impreso: false, mensaje: resultado.mensaje };
    } catch (error) {
      /*
        El contrato dice que un proveedor no debe lanzar, pero esta es la última
        frontera antes de una venta ya cobrada: si una implementación futura lo
        incumpliera, la excepción no puede llegar a la pantalla del cajero.
      */
      const detalle = error instanceof Error ? error.message : String(error);
      this.dependencias.log.registrar(
        'impresion',
        `El proveedor de impresión lanzó una excepción con el recibo ` +
          `${String(recibo.numeroRecibo)}: ${detalle}`,
      );
      return { impreso: false, mensaje: 'No se pudo imprimir. El recibo quedó guardado en PDF.' };
    }
  }

  /**
   * Nombre único del archivo: número de recibo y momento de emisión.
   *
   * El número va primero para que la carpeta se ordene como el talonario, y el
   * momento lo hace único aunque alguna vez se reiniciara la numeración.
   *
   * UNA REIMPRESIÓN ESCRIBE ENCIMA DEL MISMO ARCHIVO, a propósito: `pdf_path`
   * es una sola columna y tiene que apuntar siempre a un PDF vigente. Si cada
   * reimpresión dejara un archivo nuevo, o habría que ir agregando columnas o
   * quedarían PDF huérfanos que nadie sabría a qué emisión corresponden. La
   * contrapartida está aceptada: el PDF que queda en el disco refleja la
   * configuración del negocio de HOY, no la del día de la venta. Es justamente
   * lo que se pidió, para que un recibo emitido antes de cargar los datos de la
   * tienda deje de mostrar marcadores al reimprimirse.
   */
  private nombreDeArchivo(numero: number): string {
    const LARGO_DEL_NUMERO = 6;
    const momento = new Date(this.ahora()).toISOString().replace(/[:.]/g, '-');
    return `recibo-${String(numero).padStart(LARGO_DEL_NUMERO, '0')}-${momento}.pdf`;
  }
}
