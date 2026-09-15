/**
 * Bitácora TÉCNICA, que NO es la de auditoría.
 *
 * LA DISTINCIÓN IMPORTA Y NO ES BUROCRÁTICA. `auditoria_log` guarda HECHOS DEL
 * NEGOCIO: quién vendió, quién autorizó un descuento, quién dio de baja a un
 * usuario. Es inmutable por trigger, se espeja en la nube y un auditor la lee
 * como evidencia. Que una impresora no respondiera no es un hecho del negocio:
 * es un problema del aparato, y meterlo ahí ensuciaría con ruido de hardware la
 * única tabla que tiene que poder leerse entera.
 *
 * Por eso esto es un ARCHIVO DE TEXTO en la carpeta de datos, no una tabla.
 * Se puede abrir con cualquier cosa, se puede borrar sin consecuencias y no
 * viaja a la nube.
 *
 * NUNCA FALLA HACIA AFUERA. Si no se puede escribir el archivo —disco lleno,
 * permisos— se cae al `console.error` y sigue. Un registro que tumbara la venta
 * que estaba registrando sería peor que no tener registro.
 */

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nombre del archivo dentro de la carpeta de datos de la aplicación. */
export const ARCHIVO_DE_LOG = 'log-tecnico.log';

/**
 * De dónde vino el evento, para poder filtrar el archivo con un `grep`.
 *
 * `venta`: el asiento de un conflicto de inventario que la base no pudo guardar
 * (CLAUDE.md §4.3). El hecho del negocio va a `auditoria_log`; acá solo queda
 * que ESE asiento faltó y por qué.
 */
export type OrigenTecnico = 'impresion' | 'recibo' | 'sincronizacion' | 'venta';

/** Escribe una línea en la bitácora técnica. */
export interface LogTecnico {
  registrar(origen: OrigenTecnico, mensaje: string): void;
}

/** Bitácora que escribe en un archivo de la carpeta de datos. */
export class LogTecnicoEnArchivo implements LogTecnico {
  private readonly ruta: string;

  public constructor(carpetaDeDatos: string) {
    this.ruta = join(carpetaDeDatos, ARCHIVO_DE_LOG);
  }

  public registrar(origen: OrigenTecnico, mensaje: string): void {
    const linea = `${new Date().toISOString()} [${origen}] ${mensaje}\n`;
    try {
      appendFileSync(this.ruta, linea, 'utf8');
    } catch (error) {
      // Ver la cabecera: registrar no puede ser lo que rompa la operación.
      const detalle = error instanceof Error ? error.message : String(error);
      console.error(`[log-tecnico] No se pudo escribir ${this.ruta}: ${detalle}`);
      console.error(linea.trimEnd());
    }
  }
}

/** Bitácora que no escribe nada. Para las pruebas y para el modo semilla. */
export class LogTecnicoSilencioso implements LogTecnico {
  public registrar(): void {
    // A propósito: no hay dónde escribir ni hace falta.
  }
}
