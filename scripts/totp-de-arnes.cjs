/**
 * totp-de-arnes.cjs — El código TOTP (RFC 6238) calculado por los arneses.
 *
 * Escrito APARTE del de la aplicación (`src/main/domain/usuarios/totp.ts`) y sin
 * importarlo: si el arnés usara el mismo código que verifica, un error en él
 * pasaría en los dos lados sin verse. Lo que la app muestra en el QR tiene que
 * dar el mismo número que este cálculo independiente, que es lo que haría el
 * teléfono de Jimmy.
 */

const { createHmac } = require('node:crypto');

/** El código de 6 dígitos de ese secreto Base32 en ese instante. */
function codigoTotp(secretoBase32, instanteMs) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretoBase32.replace(/\s/g, '')) {
    bits += alfabeto.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(Math.floor(instanteMs / 30000)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(mensaje).digest();
  const d = hmac[19] & 15;
  const binario = ((hmac[d] & 127) << 24) | (hmac[d + 1] << 16) | (hmac[d + 2] << 8) | hmac[d + 3];
  return String(binario % 1000000).padStart(6, '0');
}


/** Espera, sin ocupar el proceso, a que empiece el siguiente paso de 30 s (más medio segundo). */
function esperarAlSiguientePaso() {
  const espera = 30000 - (Date.now() % 30000) + 500;
  return new Promise((resolver) => {
    setTimeout(() => {
      resolver(espera);
    }, espera);
  });
}

module.exports = { codigoTotp, esperarAlSiguientePaso };
