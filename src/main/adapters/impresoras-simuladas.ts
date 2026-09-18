/**
 * Impresoras SIMULADAS, solo para el arnés de verificación en esta Mac (§4.43).
 *
 * POR QUÉ EXISTEN EN EL CÓDIGO DE LA APLICACIÓN. La pantalla de impresora se
 * verifica manejando la aplicación real, y en la máquina de desarrollo no hay
 * ni Windows ni una térmica. Con `POS_IMPRESORAS_SIMULADAS=<carpeta>` el proceso
 * principal lista estas dos impresoras en vez de las del sistema, y el ticket de
 * prueba se escribe como archivo en esa carpeta, para leer los bytes ESC/POS.
 *
 * NUNCA EN EL INSTALADOR: `index.ts` solo mira la variable cuando la aplicación
 * NO está empaquetada (`app.isPackaged === false`). En el `.exe` se ignora.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EnviadorRaw, ResultadoDelEnvioRaw } from './cola-de-windows';
import { ERROR_WIN32_NOMBRE_DE_IMPRESORA_INVALIDO } from './cola-de-windows';
import type { ImpresoraListada } from '@main/impresora/servicio-de-impresora';

/** Recibe los bytes y los escribe en la carpeta del arnés. */
export const IMPRESORA_SIMULADA_QUE_RECIBE = 'Termica-simulada';
/** Existe, pero Windows la reporta desconectada después de aceptar el trabajo. */
export const IMPRESORA_SIMULADA_DESCONECTADA = 'Termica-simulada-desconectada';

export function impresorasSimuladas(): readonly ImpresoraListada[] {
  return [
    { name: IMPRESORA_SIMULADA_QUE_RECIBE, displayName: 'Térmica simulada (arnés)', description: 'Escribe el ticket en un archivo' },
    { name: IMPRESORA_SIMULADA_DESCONECTADA, displayName: 'Térmica simulada desconectada (arnés)', description: 'Reporta Offline' },
  ];
}

export class EnviadorSimulado implements EnviadorRaw {
  /**
   * `demoraMs` imita lo que tarda el envío real en la tienda —arrancar
   * `powershell.exe`, compilar su puente a `winspool` y los 1,5 s fijos de
   * espera del script— para comprobar en la aplicación real que el cobro NO
   * lo espera (§4.64). Con 0 contesta en el acto, como siempre.
   */
  public constructor(
    private readonly carpeta: string,
    private readonly demoraMs = 0,
  ) {}

  public async enviar(nombreDeImpresora: string, bytes: Uint8Array): Promise<ResultadoDelEnvioRaw> {
    if (this.demoraMs > 0) {
      await new Promise((resolver) => {
        setTimeout(resolver, this.demoraMs);
      });
    }
    return this.enviarYa(nombreDeImpresora, bytes);
  }

  private enviarYa(nombreDeImpresora: string, bytes: Uint8Array): Promise<ResultadoDelEnvioRaw> {
    const base = {
      codigoWin32: null,
      trabajo: null,
      estadoDelTrabajo: null,
      estadoDeLaImpresora: null,
      lenguaje: 'FullLanguage',
      mensaje: null,
    };
    if (nombreDeImpresora === IMPRESORA_SIMULADA_QUE_RECIBE) {
      writeFileSync(join(this.carpeta, `${nombreDeImpresora}.bin`), bytes);
      return Promise.resolve({ ...base, etapa: 'ok', bytesEscritos: bytes.length, trabajo: 1, estadoDeLaImpresora: 'Normal' });
    }
    if (nombreDeImpresora === IMPRESORA_SIMULADA_DESCONECTADA) {
      return Promise.resolve({ ...base, etapa: 'ok', bytesEscritos: bytes.length, trabajo: 2, estadoDeLaImpresora: 'Offline' });
    }
    return Promise.resolve({ ...base, etapa: 'abrir', bytesEscritos: 0, codigoWin32: ERROR_WIN32_NOMBRE_DE_IMPRESORA_INVALIDO });
  }
}
