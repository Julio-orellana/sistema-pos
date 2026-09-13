import { describe, expect, it } from 'vitest';

import {
  desfaseDeRelojEnSegundos,
  elDesfaseMerecePreocupar,
  ESCALERA_DE_RENOVACION_MS,
  esperaHastaRenovar,
  esperaTrasFalloDeRenovacion,
  ESPERA_MINIMA_MS,
  FRACCION_DE_VIDA_PARA_RENOVAR,
  leerClaimsSinVerificar,
  TOLERANCIA_DE_RELOJ_MEDIDA_S,
  vidaDelTokenEnSegundos,
} from '../vida-del-token';

const SEGUNDO = 1000;
const UNA_HORA_EN_SEGUNDOS = 3600;
const VIDA_MEDIDA = 900;

/** Arma un JWT de mentira con la carga que se le pida. La firma es basura a propósito. */
function armarJwt(carga: Readonly<Record<string, unknown>>): string {
  const cabecera = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify(carga)).toString('base64url');
  return `${cabecera}.${cuerpo}.esta-firma-no-se-verifica-y-esta-bien`;
}

/** Un token como el que emite el proyecto real: 900 s, rol terminal, no anónimo. */
function tokenDeTerminal(emitidoEn: number, vida = VIDA_MEDIDA): string {
  return armarJwt({
    iat: emitidoEn,
    exp: emitidoEn + vida,
    email: 'terminal-1@pos.jimmycano.invalid',
    app_metadata: { provider: 'email', providers: ['email'], rol: 'terminal' },
  });
}

describe('Leer los claims del access token', () => {
  it('lee iat, exp, rol, correo y que no es anónimo de un token de terminal', () => {
    const claims = leerClaimsSinVerificar(tokenDeTerminal(1_000_000));

    expect(claims.iat).toBe(1_000_000);
    expect(claims.exp).toBe(1_000_000 + VIDA_MEDIDA);
    expect(claims.rol).toBe('terminal');
    expect(claims.correo).toBe('terminal-1@pos.jimmycano.invalid');
    expect(claims.esAnonimo).toBe(false);
  });

  it('lee el rol restauracion, para poder rechazarlo con nombre', () => {
    const token = armarJwt({ iat: 1, exp: 2, app_metadata: { rol: 'restauracion' } });

    expect(leerClaimsSinVerificar(token).rol).toBe('restauracion');
  });

  it('un token SIN rol en app_metadata devuelve rol nulo, no revienta', () => {
    const token = armarJwt({ iat: 1, exp: 2, app_metadata: { provider: 'email' } });

    expect(leerClaimsSinVerificar(token).rol).toBeNull();
  });

  it('un token sin app_metadata devuelve rol nulo', () => {
    expect(leerClaimsSinVerificar(armarJwt({ iat: 1, exp: 2 })).rol).toBeNull();
  });

  it('reconoce una sesión anónima por is_anonymous', () => {
    const token = armarJwt({ iat: 1, exp: 2, is_anonymous: true, app_metadata: { rol: 'terminal' } });

    expect(leerClaimsSinVerificar(token).esAnonimo).toBe(true);
  });

  it('la AUSENCIA de is_anonymous se lee como NO anónima, que es lo que hace GoTrue', () => {
    expect(leerClaimsSinVerificar(armarJwt({ iat: 1, exp: 2 })).esAnonimo).toBe(false);
  });

  it('rechaza un texto que no tiene forma de JWT', () => {
    expect(() => leerClaimsSinVerificar('esto-no-es-un-jwt')).toThrow(/forma de un JWT/);
  });

  it('rechaza un JWT cuya carga útil no es JSON', () => {
    const roto = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('no soy json').toString('base64url')}.x`;

    expect(() => leerClaimsSinVerificar(roto)).toThrow(/no es JSON válido/);
  });

  it('rechaza un token SIN iat o SIN exp, porque sin ellos no se sabe cuándo renovar', () => {
    expect(() => leerClaimsSinVerificar(armarJwt({ exp: 2 }))).toThrow(/`iat` y `exp`/);
    expect(() => leerClaimsSinVerificar(armarJwt({ iat: 1 }))).toThrow(/`iat` y `exp`/);
  });
});

describe('La vida del token se mide con el reloj del SERVIDOR', () => {
  it('la vida es exp - iat: 900 segundos en el proyecto real', () => {
    const claims = leerClaimsSinVerificar(tokenDeTerminal(1_700_000_000));

    expect(vidaDelTokenEnSegundos(claims)).toBe(VIDA_MEDIDA);
  });

  it('con un token de 900 s se renueva a los 675 s, dejando 225 s de colchón', () => {
    const claims = leerClaimsSinVerificar(tokenDeTerminal(1_700_000_000));

    expect(esperaHastaRenovar(claims)).toBe(675 * SEGUNDO);
    expect(VIDA_MEDIDA * SEGUNDO - esperaHastaRenovar(claims)).toBe(225 * SEGUNDO);
  });

  it('con el token de 300 s del proyecto de pruebas se renueva a los 225 s', () => {
    const claims = leerClaimsSinVerificar(tokenDeTerminal(1_700_000_000, 300));

    expect(esperaHastaRenovar(claims)).toBe(225 * SEGUNDO);
  });

  it('con los 3600 s de antes se renovaría a los 2700 s: la fracción no está atada a 900', () => {
    const claims = leerClaimsSinVerificar(tokenDeTerminal(1_700_000_000, UNA_HORA_EN_SEGUNDOS));

    expect(esperaHastaRenovar(claims)).toBe(2700 * SEGUNDO);
  });

  it('renovar siempre queda ANTES del vencimiento, para cualquier vida de 10 s a 2 horas', () => {
    const DOS_HORAS = 7200;
    for (let vida = 10; vida <= DOS_HORAS; vida += 7) {
      const claims = leerClaimsSinVerificar(tokenDeTerminal(1_700_000_000, vida));
      expect(esperaHastaRenovar(claims)).toBeLessThan(vida * SEGUNDO);
    }
  });

  it('un token de vida absurda (cero o negativa) NO produce un bucle: hay piso de 5 s', () => {
    const cero = leerClaimsSinVerificar(armarJwt({ iat: 100, exp: 100 }));
    const negativa = leerClaimsSinVerificar(armarJwt({ iat: 100, exp: 40 }));

    expect(esperaHastaRenovar(cero)).toBe(ESPERA_MINIMA_MS);
    expect(esperaHastaRenovar(negativa)).toBe(ESPERA_MINIMA_MS);
  });

  it('la fracción declarada es la que se usa de verdad', () => {
    const claims = leerClaimsSinVerificar(tokenDeTerminal(0, 1000));

    expect(esperaHastaRenovar(claims)).toBe(FRACCION_DE_VIDA_PARA_RENOVAR * 1000 * SEGUNDO);
  });
});

describe('EL RELOJ LOCAL NO ENTRA EN EL CÁLCULO: el desfase no mueve la renovación', () => {
  /*
    Esta es la prueba central del archivo. Si alguien "simplifica" el cálculo a
    `exp - Date.now()`, este bloque se cae entero, que es exactamente para lo
    que está.
  */
  const EMITIDO = 1_700_000_000;
  const claims = leerClaimsSinVerificar(tokenDeTerminal(EMITIDO));

  it('con el reloj en hora, la espera es 675 s', () => {
    expect(esperaHastaRenovar(claims)).toBe(675 * SEGUNDO);
  });

  it('con el reloj UNA HORA ADELANTADO, la espera sigue siendo 675 s y NO es negativa', () => {
    const desfase = desfaseDeRelojEnSegundos(claims, (EMITIDO + UNA_HORA_EN_SEGUNDOS) * SEGUNDO);

    expect(desfase).toBe(UNA_HORA_EN_SEGUNDOS);
    expect(esperaHastaRenovar(claims)).toBe(675 * SEGUNDO);
    expect(esperaHastaRenovar(claims)).toBeGreaterThan(0);
  });

  it('con el reloj UNA HORA ATRASADO, la espera sigue siendo 675 s y no se pasa del exp', () => {
    const desfase = desfaseDeRelojEnSegundos(claims, (EMITIDO - UNA_HORA_EN_SEGUNDOS) * SEGUNDO);

    expect(desfase).toBe(-UNA_HORA_EN_SEGUNDOS);
    expect(esperaHastaRenovar(claims)).toBe(675 * SEGUNDO);
    expect(esperaHastaRenovar(claims)).toBeLessThan(VIDA_MEDIDA * SEGUNDO);
  });

  it('con el reloj en 1998, la espera sigue siendo 675 s', () => {
    const mil998 = Date.UTC(1998, 0, 1);

    expect(esperaHastaRenovar(claims)).toBe(675 * SEGUNDO);
    expect(desfaseDeRelojEnSegundos(claims, mil998)).toBeLessThan(0);
  });
});

describe('El desfase de reloj se anota, y solo cuando pasa la tolerancia medida', () => {
  it('la tolerancia declarada es la que se midió contra PostgREST: 30 s', () => {
    expect(TOLERANCIA_DE_RELOJ_MEDIDA_S).toBe(30);
  });

  it('los 1.9 s medidos en la máquina de desarrollo NO merecen preocupar', () => {
    expect(elDesfaseMerecePreocupar(-2)).toBe(false);
  });

  it('30 s exactos todavía no preocupa; 31 s sí', () => {
    expect(elDesfaseMerecePreocupar(30)).toBe(false);
    expect(elDesfaseMerecePreocupar(31)).toBe(true);
  });

  it('preocupa en las DOS direcciones, adelantado y atrasado', () => {
    expect(elDesfaseMerecePreocupar(600)).toBe(true);
    expect(elDesfaseMerecePreocupar(-600)).toBe(true);
  });

  it('el desfase se redondea a segundos y respeta el signo', () => {
    const claims = { iat: 1_000_000 };

    expect(desfaseDeRelojEnSegundos(claims, 1_000_045_000)).toBe(45);
    expect(desfaseDeRelojEnSegundos(claims, 999_955_000)).toBe(-45);
  });
});

describe('La escalera de reintentos de la renovación NO es la de la cola', () => {
  const sinAzar = (): number => 0.5;

  it('sus peldaños son 5 s, 15 s, 45 s y un techo de 1 minuto', () => {
    expect(ESCALERA_DE_RENOVACION_MS).toEqual([5_000, 15_000, 45_000, 60_000]);
  });

  it('el techo es de UN minuto, no de una hora como el de la cola de subida', () => {
    const UNA_HORA_MS = 3_600_000;
    const techo = ESCALERA_DE_RENOVACION_MS[ESCALERA_DE_RENOVACION_MS.length - 1];

    expect(techo).toBe(60_000);
    expect(techo).toBeLessThan(UNA_HORA_MS);
  });

  it('sin variación, cada intento espera su peldaño', () => {
    expect(esperaTrasFalloDeRenovacion(1, sinAzar)).toBe(5_000);
    expect(esperaTrasFalloDeRenovacion(2, sinAzar)).toBe(15_000);
    expect(esperaTrasFalloDeRenovacion(3, sinAzar)).toBe(45_000);
    expect(esperaTrasFalloDeRenovacion(4, sinAzar)).toBe(60_000);
  });

  it('a partir del cuarto fallo se queda en el techo, no crece más', () => {
    expect(esperaTrasFalloDeRenovacion(9, sinAzar)).toBe(60_000);
    expect(esperaTrasFalloDeRenovacion(500, sinAzar)).toBe(60_000);
  });

  it('la variación es de ±20 %, y nunca deja la espera en cero', () => {
    expect(esperaTrasFalloDeRenovacion(1, () => 0)).toBe(4_000);
    expect(esperaTrasFalloDeRenovacion(1, () => 0.999_999)).toBeCloseTo(6_000, -1);
    expect(esperaTrasFalloDeRenovacion(1, () => 0)).toBeGreaterThan(0);
  });

  it('CABEN SEIS INTENTOS dentro del colchón de 225 s que deja un token de 900 s', () => {
    const colchonMs = (VIDA_MEDIDA - FRACCION_DE_VIDA_PARA_RENOVAR * VIDA_MEDIDA) * SEGUNDO;
    let transcurrido = 0;
    let intentos = 1; // el primero es el que falla en el momento de renovar

    while (transcurrido + esperaTrasFalloDeRenovacion(intentos, sinAzar) < colchonMs) {
      transcurrido += esperaTrasFalloDeRenovacion(intentos, sinAzar);
      intentos += 1;
    }

    expect(colchonMs).toBe(225 * SEGUNDO);
    expect(intentos).toBe(6);
  });
});
