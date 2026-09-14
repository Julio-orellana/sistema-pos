/**
 * Qué impresora usa ESTA terminal, y por qué no está en la base.
 *
 * LA CONFIGURACIÓN DE LA IMPRESORA NO ES DATO DE NEGOCIO. Es estado operativo
 * de una máquina: dos cajas podrían tener la térmica en puertos distintos, y el
 * puerto de la caja A no significa nada en la caja B. Ponerla en
 * `configuracion_negocio` —que se espeja en Postgres— repetiría el error que el
 * proyecto ya evitó con `bloqueos_de_autorizacion` (§4.4): sincronizar algo que
 * solo tiene sentido localmente. Por eso vive en un archivo, al lado de la base.
 *
 * SIN ARCHIVO NO HAY IMPRESORA, y eso NO es un error: es el estado normal hoy,
 * y el que corresponde mientras no se confirme el modelo de Jimmy. Se devuelve
 * `NullPrinterProvider`, que responde «ok, omitida por diseño», y la venta
 * sigue su curso con el PDF como respaldo.
 *
 * POR QUÉ NO HAY PANTALLA PARA ESTO TODAVÍA. Configurar una impresora que
 * nadie vio sería adivinar qué opciones ofrecerle a Jimmy. Cuando llegue el
 * modelo real y se sepa cómo se presenta en Windows, se decide si hace falta
 * una pantalla o si alcanza con dejar el archivo puesto en la instalación.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NullPrinterProvider, type ReceiptPrinterProvider } from '@shared/adapters';
import type { LogTecnico } from '@main/log-tecnico';
import { EscPosPrinterProvider } from './escpos-printer';

/** Archivo que dice dónde está la impresora, dentro de `userData`. */
export const ARCHIVO_DE_IMPRESORA = 'impresora.json';

/**
 * El contenido esperado del archivo:
 *
 * ```json
 * { "dispositivo": "\\\\.\\USB001" }
 * ```
 */
interface ArchivoDeImpresora {
  readonly dispositivo?: unknown;
}

/**
 * Devuelve el proveedor de impresión que corresponde a esta terminal.
 *
 * NUNCA LANZA. Un archivo mal escrito, ilegible o con JSON roto se anota en la
 * bitácora técnica y se cae al proveedor nulo: el punto de venta tiene que
 * arrancar aunque la configuración de la impresora esté mal.
 */
export function crearImpresoraConfigurada(
  carpetaDeDatos: string,
  log: LogTecnico,
): ReceiptPrinterProvider {
  const ruta = join(carpetaDeDatos, ARCHIVO_DE_IMPRESORA);

  let crudo: string;
  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch {
    // Sin archivo. Es el caso normal y no se registra como problema: llenar la
    // bitácora en cada arranque de una tienda sin impresora sería ruido.
    return new NullPrinterProvider();
  }

  try {
    const contenido = JSON.parse(crudo) as ArchivoDeImpresora;
    const dispositivo = typeof contenido.dispositivo === 'string' ? contenido.dispositivo.trim() : '';

    if (dispositivo === '') {
      log.registrar('impresion', `${ruta} no declara ningún "dispositivo". Se imprime solo en PDF.`);
      return new NullPrinterProvider();
    }

    log.registrar('impresion', `Impresora configurada en ${dispositivo}.`);
    return new EscPosPrinterProvider({ dispositivo }, log);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    log.registrar('impresion', `No se pudo leer ${ruta}: ${detalle}. Se imprime solo en PDF.`);
    return new NullPrinterProvider();
  }
}
