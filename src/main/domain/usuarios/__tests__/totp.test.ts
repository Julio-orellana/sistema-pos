/**
 * El algoritmo TOTP, contra los vectores de prueba publicados en los RFC.
 *
 * Que el código coincida con estos vectores es lo que garantiza que Google
 * Authenticator, Authy o cualquier app estándar muestren el mismo número que la
 * terminal espera: esas apps implementan exactamente RFC 4226 y RFC 6238.
 */

import { describe, expect, it } from 'vitest';

import {
  BYTES_DEL_SECRETO,
  codificarBase32,
  codigoHotp,
  codigoTotp,
  decodificarBase32,
  generarSecretoTotp,
  pasoDeTiempo,
  pasoQueCoincide,
  EMISOR_DEL_CODIGO_REMOTO,
  tieneFormatoDeCodigoTotp,
  uriOtpauth,
} from '../totp';

/** El secreto de los apéndices de RFC 4226 y RFC 6238 (HMAC-SHA1): los veinte bytes ASCII «12345678901234567890». */
const SECRETO_DEL_RFC = Buffer.from('12345678901234567890', 'ascii');
const SECRETO_DEL_RFC_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('Base32 de RFC 4648', () => {
  // RFC 4648 §10, sin el relleno «=», que las apps de autenticación no usan.
  const VECTORES: readonly (readonly [string, string])[] = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];

  for (const [texto, base32] of VECTORES) {
    it(`«${texto}» se codifica «${base32}» y vuelve`, () => {
      expect(codificarBase32(Buffer.from(texto, 'ascii'))).toBe(base32);
      expect(decodificarBase32(base32).toString('ascii')).toBe(texto);
    });
  }

  it('el secreto del RFC en Base32 es el que publican los ejemplos de Google Authenticator', () => {
    expect(codificarBase32(SECRETO_DEL_RFC)).toBe(SECRETO_DEL_RFC_BASE32);
  });

  it('al decodificar acepta minúsculas, espacios y relleno, porque se puede copiar a mano así', () => {
    expect(decodificarBase32('mzxw 6ytb oi======').toString('ascii')).toBe('foobar');
  });

  it('rechaza un carácter que no es Base32 en vez de ignorarlo', () => {
    expect(() => decodificarBase32('MZXW1')).toThrow('Base32');
  });
});

describe('HOTP de RFC 4226, Apéndice D', () => {
  const ESPERADOS = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  for (const [contador, esperado] of ESPERADOS.entries()) {
    it(`contador ${String(contador)} → ${esperado}`, () => {
      expect(codigoHotp(SECRETO_DEL_RFC, contador)).toBe(esperado);
    });
  }
});

describe('TOTP de RFC 6238, Apéndice B (HMAC-SHA1, pasos de 30 s)', () => {
  // Los vectores del RFC son de 8 dígitos. El de 6 dígitos que muestra Google
  // Authenticator es el mismo número binario módulo 10^6: los últimos 6.
  const VECTORES: readonly (readonly [number, string])[] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  for (const [segundos, ocho] of VECTORES) {
    it(`T = ${String(segundos)} s → ${ocho} (8 dígitos) y ${ocho.slice(2)} (6 dígitos)`, () => {
      const paso = pasoDeTiempo(segundos * 1000);
      expect(codigoHotp(SECRETO_DEL_RFC, paso, 8)).toBe(ocho);
      expect(codigoTotp(SECRETO_DEL_RFC_BASE32, paso)).toBe(ocho.slice(2));
    });
  }
});

describe('La verificación acepta el paso actual y uno a cada lado, nada más', () => {
  const instante = 1234567890 * 1000;
  const paso = pasoDeTiempo(instante);
  const codigoDe = (desvio: number): string => codigoTotp(SECRETO_DEL_RFC_BASE32, paso + desvio);

  it('el código del paso ACTUAL se acepta, y devuelve ese paso', () => {
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, codigoDe(0), instante)).toBe(paso);
  });

  it('el del paso ANTERIOR (−30 s) se acepta', () => {
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, codigoDe(-1), instante)).toBe(paso - 1);
  });

  it('el del paso SIGUIENTE (+30 s) se acepta', () => {
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, codigoDe(1), instante)).toBe(paso + 1);
  });

  it('el de DOS pasos atrás (−60 s) se rechaza', () => {
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, codigoDe(-2), instante)).toBeNull();
  });

  it('el de DOS pasos adelante (+60 s) se rechaza', () => {
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, codigoDe(2), instante)).toBeNull();
  });

  it('control: los códigos de los cinco pasos son distintos entre sí, así que los rechazos no son una casualidad', () => {
    expect(new Set([-2, -1, 0, 1, 2].map(codigoDe)).size).toBe(5);
  });

  it('con el reloj en los primeros 30 s de 1970 no revienta: el paso −1 no existe y se salta', () => {
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, codigoTotp(SECRETO_DEL_RFC_BASE32, 0), 1000)).toBe(0);
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, '000000', 1000)).toBeNull();
  });

  it('un código de otro formato no se acepta ni se compara', () => {
    expect(pasoQueCoincide(SECRETO_DEL_RFC_BASE32, codigoDe(0).slice(0, 4), instante)).toBeNull();
    expect(tieneFormatoDeCodigoTotp('12345')).toBe(false);
    expect(tieneFormatoDeCodigoTotp('12a456')).toBe(false);
    expect(tieneFormatoDeCodigoTotp('123456')).toBe(true);
  });
});

describe('El secreto y la URI del QR', () => {
  it('un secreto nuevo tiene 160 bits (32 caracteres Base32) y no se repite', () => {
    const uno = generarSecretoTotp();
    const otro = generarSecretoTotp();
    expect(decodificarBase32(uno)).toHaveLength(BYTES_DEL_SECRETO);
    expect(uno).toMatch(/^[A-Z2-7]{32}$/);
    expect(uno).not.toBe(otro);
  });

  it('el emisor es la marca comercial «Vixo POS», y así sale en la URI', () => {
    expect(EMISOR_DEL_CODIGO_REMOTO).toBe('Vixo POS');
    expect(uriOtpauth(EMISOR_DEL_CODIGO_REMOTO, 'Jimmy', SECRETO_DEL_RFC_BASE32)).toBe(
      'otpauth://totp/Vixo%20POS:Jimmy?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Vixo%20POS&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('la URI tiene el formato de Google Authenticator, con el nombre codificado', () => {
    expect(uriOtpauth('POS Jimmy Cano', 'José', SECRETO_DEL_RFC_BASE32)).toBe(
      'otpauth://totp/POS%20Jimmy%20Cano:Jos%C3%A9?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=POS%20Jimmy%20Cano&algorithm=SHA1&digits=6&period=30',
    );
  });
});
