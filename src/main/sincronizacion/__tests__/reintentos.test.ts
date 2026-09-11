/**
 * Clasificación de fallos y escalera de reintentos.
 *
 * Son las dos decisiones que separan «la tienda se queda sin respaldo en
 * silencio» de «la tienda avisa»: qué fallo se reintenta y cuánto se espera.
 * Se prueban con casos escritos, sin base de datos y sin reloj, porque son
 * funciones puras y porque un rango («entre 4 y 6 segundos») deja pasar un
 * cálculo equivocado.
 */

import { describe, expect, it } from 'vitest';

import {
  ESCALERA_DE_ESPERA_MS,
  VARIACION,
  clasificarFallo,
  esperaTrasIntento,
  proximoIntentoTras,
} from '../reintentos';

/** Sin variación: devuelve el peldaño exacto. */
const SIN_VARIACION = (): number => 0.5;

describe('Clasificación de fallos: qué se reintenta y qué detiene la cola', () => {
  const CASOS: readonly { codigo: number | undefined; clase: string; porque: string }[] = [
    { codigo: undefined, clase: 'transitorio', porque: 'no hubo respuesta: se cayó la red' },
    { codigo: 500, clase: 'transitorio', porque: 'el servidor falló, no la fila' },
    { codigo: 502, clase: 'transitorio', porque: 'una pasarela intermedia' },
    { codigo: 503, clase: 'transitorio', porque: 'el servicio no está disponible ahora' },
    { codigo: 504, clase: 'transitorio', porque: 'tiempo de espera de la pasarela' },
    { codigo: 429, clase: 'transitorio', porque: 'límite de tasa: esperar es lo que se pide' },
    { codigo: 408, clase: 'transitorio', porque: 'tiempo de espera de la petición' },
    { codigo: 401, clase: 'credencial', porque: 'la credencial no sirve; la cola no se toca' },
    { codigo: 400, clase: 'deterministico', porque: 'un CHECK de Postgres rechazó la fila' },
    { codigo: 403, clase: 'deterministico', porque: 'RLS negó la operación' },
    { codigo: 409, clase: 'deterministico', porque: 'una llave foránea que no existe' },
    { codigo: 422, clase: 'deterministico', porque: 'la fila no es procesable' },
    { codigo: 404, clase: 'deterministico', porque: 'el destino no existe: reintentar no lo crea' },
  ];

  for (const caso of CASOS) {
    const nombre = caso.codigo === undefined ? 'sin código HTTP' : `HTTP ${String(caso.codigo)}`;
    it(`${nombre} es ${caso.clase}: ${caso.porque}`, () => {
      const entrada = caso.codigo === undefined ? {} : { estadoHttp: caso.codigo };
      expect(clasificarFallo(entrada)).toBe(caso.clase);
    });
  }

  it('un código menor que 400 con fallo detiene la cola: es un defecto del adaptador, no de la red', () => {
    expect(clasificarFallo({ estadoHttp: 200 })).toBe('deterministico');
  });
});

describe('La escalera de espera es la del diseño: 5 s, 30 s, 2 min, 10 min, 30 min y después cada hora', () => {
  const ESPERADAS_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000];

  it('los seis peldaños son exactamente esos', () => {
    expect([...ESCALERA_DE_ESPERA_MS]).toEqual(ESPERADAS_MS);
  });

  for (const [indice, esperada] of ESPERADAS_MS.entries()) {
    it(`el intento ${String(indice + 1)} espera ${String(esperada / 1_000)} segundos`, () => {
      expect(esperaTrasIntento(indice + 1, SIN_VARIACION)).toBe(esperada);
    });
  }

  it('del séptimo intento en adelante se queda en una hora, no sigue creciendo', () => {
    for (const intento of [7, 12, 100, 5_000]) {
      expect(esperaTrasIntento(intento, SIN_VARIACION)).toBe(3_600_000);
    }
  });

  it('un intento 0 o negativo cae al primer peldaño en vez de romperse', () => {
    expect(esperaTrasIntento(0, SIN_VARIACION)).toBe(5_000);
    expect(esperaTrasIntento(-3, SIN_VARIACION)).toBe(5_000);
  });
});

describe('La variación aleatoria es de ±20 %, ni más ni menos', () => {
  it('con el azar en su mínimo, la espera baja exactamente un 20 %', () => {
    expect(esperaTrasIntento(1, () => 0)).toBe(4_000);
  });

  it('con el azar en su máximo, la espera sube casi un 20 %', () => {
    // Math.random() nunca devuelve 1, así que el techo es un límite y no un
    // valor alcanzable: se comprueba con el valor más alto posible en la
    // práctica.
    expect(esperaTrasIntento(1, () => 0.999999)).toBe(6_000);
  });

  it('NUNCA llega a cero, que es lo que la descartaría como backoff', () => {
    for (let i = 0; i < 500; i += 1) {
      const espera = esperaTrasIntento(1, Math.random);
      expect(espera).toBeGreaterThanOrEqual(5_000 * (1 - VARIACION));
      expect(espera).toBeLessThanOrEqual(5_000 * (1 + VARIACION));
    }
  });
});

describe('El próximo intento se calcula como un instante ISO que la base acepta', () => {
  it('suma la espera al momento actual', () => {
    const AHORA = Date.parse('2026-09-11T12:00:00.000Z');
    expect(proximoIntentoTras(1, AHORA, SIN_VARIACION)).toBe('2026-09-11T12:00:05.000Z');
    expect(proximoIntentoTras(3, AHORA, SIN_VARIACION)).toBe('2026-09-11T12:02:00.000Z');
  });

  it('tiene la forma exacta que exige el CHECK sync_cola_proximo_intento_iso', () => {
    const instante = proximoIntentoTras(2, Date.now(), SIN_VARIACION);
    expect(instante).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
