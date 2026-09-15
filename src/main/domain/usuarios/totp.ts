/**
 * TOTP (RFC 6238): el código de autorización remota que cambia cada 30
 * segundos, el mismo mecanismo de Google Authenticator o de Authy.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ REEMPLAZA AL PIN REMOTO FIJO
 * ---------------------------------------------------------------------------
 * El PIN remoto era un secreto de larga vida: el mismo código hoy que dentro de
 * un año, hasta que alguien se acordara de cambiarlo. Quien lo escuchaba una vez
 * por teléfono podía autorizar para siempre. Con TOTP lo que se dicta sirve
 * como mucho 90 segundos (el paso actual y uno a cada lado), y una sola vez.
 * Funciona sin internet en los dos lados: la terminal y el teléfono solo
 * necesitan la hora.
 *
 * ---------------------------------------------------------------------------
 * EL SECRETO NUNCA SALE DE ESTA TERMINAL
 * ---------------------------------------------------------------------------
 * Un hash de PIN es de una sola vía. El secreto de TOTP NO: quien lo tenga
 * calcula todos los códigos futuros de esa persona. Por eso se guarda cifrado
 * con `safeStorage` (el mismo mecanismo que la credencial de sincronización,
 * §4.23), nunca sube a la nube (migración 036, `COLUMNAS_EXCLUIDAS`) y nunca se
 * escribe en ningún log.
 *
 * ---------------------------------------------------------------------------
 * SIN DEPENDENCIAS
 * ---------------------------------------------------------------------------
 * HMAC-SHA1 de `node:crypto`, Base32 de RFC 4648 y la truncación dinámica de
 * RFC 4226. Son cuarenta líneas que se prueban contra los vectores de los dos
 * RFC; una librería agregaría superficie para lo mismo. Este módulo usa
 * `node:crypto` y vive en el proceso principal: no llega a la ventana.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Segundos que dura un código. El valor por omisión de RFC 6238 y de toda app de autenticación. */
export const SEGUNDOS_POR_PASO = 30;

/** Dígitos del código. Google Authenticator muestra 6 por omisión. */
export const DIGITOS_DEL_CODIGO = 6;

/** Bytes del secreto: 160 bits, lo que recomienda RFC 4226 para HMAC-SHA1. */
export const BYTES_DEL_SECRETO = 20;

/**
 * Pasos de tolerancia a cada lado del actual: ±30 segundos de desfase entre el
 * reloj de la terminal y el del teléfono. Es la ventana que recomienda RFC 6238
 * §5.2. Más ancha haría que un código dictado sirviera más tiempo.
 */
export const PASOS_DE_TOLERANCIA = 1;

/**
 * El emisor que muestra la app de autenticación encima del código: la marca
 * comercial del software, «Vixo POS».
 *
 * Es una CONSTANTE y no `app.getName()`: el nombre de la aplicación es
 * «pos-agricola» en desarrollo y el del producto en el instalador, y ninguno de
 * los dos es lo que tiene que leer Jimmy en su teléfono. Cambiarla no rompe
 * nada guardado (el emisor no entra en el cálculo del código), pero las cuentas
 * ya agregadas en los teléfonos conservan el nombre con que se escanearon.
 */
export const EMISOR_DEL_CODIGO_REMOTO = 'Vixo POS';

/** Un código de autorización remota bien formado: seis dígitos. */
const FORMATO_DEL_CODIGO = /^[0-9]{6}$/;

/** El alfabeto de Base32 de RFC 4648. */
const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** ¿La entrada tiene forma de código TOTP? No dice si es correcto. */
export function tieneFormatoDeCodigoTotp(codigo: string): boolean {
  return FORMATO_DEL_CODIGO.test(codigo);
}

/** Base32 de RFC 4648, en mayúsculas y SIN relleno, que es como lo leen las apps de autenticación. */
export function codificarBase32(bytes: Buffer): string {
  let bits = 0;
  let acumulado = 0;
  let salida = '';
  for (const byte of bytes) {
    acumulado = (acumulado << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32.charAt((acumulado >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    salida += ALFABETO_BASE32.charAt((acumulado << (5 - bits)) & 31);
  }
  return salida;
}

/**
 * Decodifica Base32. Acepta minúsculas, espacios y relleno, porque quien lo
 * copia a mano los puede agregar; rechaza cualquier otro carácter en vez de
 * ignorarlo, que daría un secreto distinto sin avisar.
 */
export function decodificarBase32(texto: string): Buffer {
  const limpio = texto.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let acumulado = 0;
  const bytes: number[] = [];
  for (const caracter of limpio) {
    const valor = ALFABETO_BASE32.indexOf(caracter);
    if (valor === -1) {
      throw new Error('El texto no es Base32 válido.');
    }
    acumulado = ((acumulado << 5) | valor) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acumulado >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Un secreto nuevo: 160 bits aleatorios del generador criptográfico, en Base32. */
export function generarSecretoTotp(): string {
  return codificarBase32(randomBytes(BYTES_DEL_SECRETO));
}

/**
 * HOTP (RFC 4226): HMAC-SHA1 del contador y truncación dinámica.
 *
 * `digitos` es parámetro porque los vectores de prueba de RFC 6238 son de 8
 * dígitos; el sistema siempre usa 6.
 */
export function codigoHotp(clave: Buffer, contador: number, digitos: number = DIGITOS_DEL_CODIGO): string {
  const mensaje = Buffer.alloc(8);
  // El contador va en 8 bytes big-endian. `BigInt` porque un contador de TOTP
  // de fechas lejanas no cabe en 32 bits.
  mensaje.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac('sha1', clave).update(mensaje).digest();
  const desplazamiento = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binario =
    (((hmac[desplazamiento] ?? 0) & 0x7f) << 24) |
    (((hmac[desplazamiento + 1] ?? 0) & 0xff) << 16) |
    (((hmac[desplazamiento + 2] ?? 0) & 0xff) << 8) |
    ((hmac[desplazamiento + 3] ?? 0) & 0xff);
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** El paso de tiempo de RFC 6238 para un instante en milisegundos. */
export function pasoDeTiempo(instanteMs: number): number {
  return Math.floor(instanteMs / 1000 / SEGUNDOS_POR_PASO);
}

/** El código TOTP de un secreto Base32 en un paso de tiempo. */
export function codigoTotp(secretoBase32: string, paso: number): string {
  return codigoHotp(decodificarBase32(secretoBase32), paso);
}

/**
 * ¿Este código corresponde a este secreto en el paso actual o en uno vecino?
 *
 * Devuelve EL PASO que coincidió, o `null`. Devolver el paso y no un booleano es
 * lo que permite impedir que el mismo código se use dos veces (RFC 6238 §5.2).
 *
 * Compara en tiempo constante, como `verificarPin`: una comparación que corta
 * en el primer dígito distinto filtraría, midiendo tiempos, cuántos acertó.
 */
export function pasoQueCoincide(secretoBase32: string, codigo: string, instanteMs: number): number | null {
  if (!tieneFormatoDeCodigoTotp(codigo)) {
    return null;
  }
  const clave = decodificarBase32(secretoBase32);
  const tecleado = Buffer.from(codigo, 'utf8');
  const actual = pasoDeTiempo(instanteMs);
  let coincidio: number | null = null;
  // Se recorren los tres pasos siempre, sin cortar: el tiempo no depende de cuál coincidió.
  for (let desvio = -PASOS_DE_TOLERANCIA; desvio <= PASOS_DE_TOLERANCIA; desvio += 1) {
    const paso = actual + desvio;
    // Un reloj en los primeros 30 segundos de 1970 (una pila de BIOS agotada)
    // daría un paso negativo, que no cabe en el contador sin signo del RFC.
    if (paso < 0) {
      continue;
    }
    const esperado = Buffer.from(codigoHotp(clave, paso), 'utf8');
    if (timingSafeEqual(esperado, tecleado) && coincidio === null) {
      coincidio = paso;
    }
  }
  return coincidio;
}

/**
 * La URI `otpauth://` que codifica el QR, en el formato de Google Authenticator
 * (Key Uri Format): `otpauth://totp/EMISOR:CUENTA?secret=…&issuer=EMISOR…`.
 *
 * El emisor y la cuenta van codificados para URI: así el QR lleva solo ASCII,
 * aunque el nombre tenga tildes, y la librería de QR no tiene que adivinar la
 * codificación.
 */
export function uriOtpauth(emisor: string, cuenta: string, secretoBase32: string): string {
  const etiqueta = `${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}`;
  const parametros = [
    `secret=${secretoBase32}`,
    `issuer=${encodeURIComponent(emisor)}`,
    'algorithm=SHA1',
    `digits=${String(DIGITOS_DEL_CODIGO)}`,
    `period=${String(SEGUNDOS_POR_PASO)}`,
  ].join('&');
  return `otpauth://totp/${etiqueta}?${parametros}`;
}
