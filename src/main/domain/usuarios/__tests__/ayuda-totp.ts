/**
 * Ayudas de prueba para la autorización remota por TOTP.
 *
 * `CifradoDePrueba` NO es la identidad a propósito. Con un doble que devolviera
 * el texto tal cual, una prueba que busca el secreto en el archivo de la base
 * pasaría en falso: el «cifrado» sería el secreto. Este cifra de verdad con
 * AES-256-GCM y una llave que vive solo en memoria, así que el secreto nunca
 * aparece en los bytes guardados y un byte alterado no descifra.
 *
 * Lo que este doble NO prueba es que `safeStorage` cifre en la máquina real:
 * eso lo mide la aplicación real (§4.23).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { CifradoSeguro } from '@main/sincronizacion/credencial';

import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';

import type { ServicioDeAutenticacion } from '../autenticacion';
import { codigoTotp, pasoDeTiempo } from '../totp';

const BYTES_DE_IV = 12;
const BYTES_DE_ETIQUETA = 16;

export class CifradoDePrueba implements CifradoSeguro {
  /** Si es `false`, simula una máquina sin llavero ni DPAPI. */
  public disponible = true;
  /** Si es `true`, `decryptString` lanza: simula un secreto de otra identidad de aplicación. */
  public fallarAlDescifrar = false;
  public vecesQueCifro = 0;
  public vecesQueDescifro = 0;
  private readonly llave = randomBytes(32);

  public isEncryptionAvailable(): boolean {
    return this.disponible;
  }

  public encryptString(texto: string): Buffer {
    this.vecesQueCifro += 1;
    const iv = randomBytes(BYTES_DE_IV);
    const cifrador = createCipheriv('aes-256-gcm', this.llave, iv);
    const cuerpo = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
    return Buffer.concat([iv, cifrador.getAuthTag(), cuerpo]);
  }

  public decryptString(cifrado: Buffer): string {
    this.vecesQueDescifro += 1;
    if (this.fallarAlDescifrar) {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
    }
    const iv = cifrado.subarray(0, BYTES_DE_IV);
    const etiqueta = cifrado.subarray(BYTES_DE_IV, BYTES_DE_IV + BYTES_DE_ETIQUETA);
    const descifrador = createDecipheriv('aes-256-gcm', this.llave, iv);
    descifrador.setAuthTag(etiqueta);
    return Buffer.concat([descifrador.update(cifrado.subarray(BYTES_DE_IV + BYTES_DE_ETIQUETA)), descifrador.final()]).toString(
      'utf8',
    );
  }
}

/** El código de la app de autenticación para ese secreto, `desvio` pasos después del instante. */
export function codigoDeLaApp(secreto: string, instanteMs: number, desvio = 0): string {
  return codigoTotp(secreto, pasoDeTiempo(instanteMs) + desvio);
}

/**
 * Inscribe a un administrador como lo haría la pantalla: inicia, lee el secreto
 * que se mostraría, y confirma con el código del paso actual. Devuelve el
 * secreto, que en la aplicación solo tiene el teléfono.
 *
 * OJO: la confirmación CONSUME el paso actual. Para autorizar después hay que
 * usar el código del paso siguiente (`desvio = 1`) o avanzar el reloj.
 */
export function inscribir(servicio: ServicioDeAutenticacion, usuarioId: string, instanteMs: number): string {
  const inscripcion = servicio.iniciarInscripcionRemota(usuarioId, 'POS pruebas');
  servicio.confirmarInscripcionRemota(usuarioId, codigoDeLaApp(inscripcion.secreto, instanteMs));
  return inscripcion.secreto;
}

/** Un secreto fijo de 160 bits en Base32, para pruebas que no ejercitan la inscripción. */
export const SECRETO_DE_PRUEBA = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * Deja a un administrador inscrito sin pasar por la pantalla: guarda el secreto
 * cifrado con el MISMO cifrado que va a usar el servicio. Para pruebas cuyo
 * tema no es la inscripción (la caja, la venta, la salida).
 */
export function sembrarAutorizacionRemota(
  usuarios: RepositorioDeUsuarios,
  cifrado: CifradoDePrueba,
  usuarioId: string,
  secreto: string = SECRETO_DE_PRUEBA,
): void {
  usuarios.fijarTotpCifrado(usuarioId, cifrado.encryptString(secreto));
}
