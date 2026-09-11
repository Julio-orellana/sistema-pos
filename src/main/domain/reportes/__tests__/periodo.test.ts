/**
 * Qué día es «hoy» para una tienda en Guatemala.
 *
 * Todo se prueba con un instante FIJO, nunca con el reloj: un reporte que se
 * probara contra `Date.now()` pasaría o fallaría según la hora a la que alguien
 * corriera las pruebas, y el defecto que este módulo evita aparece justamente
 * de noche.
 */

import { describe, expect, it } from 'vitest';

import {
  DESFASE_DE_GUATEMALA_EN_HORAS,
  ErrorDePeriodo,
  diaDeGuatemala,
  comoDia,
  resolverPeriodo,
} from '../periodo';

/** Las 14:00 de Guatemala del viernes 11 de septiembre de 2026 (20:00 UTC). */
const TARDE_DEL_11 = Date.parse('2026-09-11T20:00:00.000Z');

/** Las 20:30 de Guatemala del 11 de septiembre. En UTC ya es el 12. */
const NOCHE_DEL_11 = Date.parse('2026-09-12T02:30:00.000Z');

// ===========================================================================
describe('El día de la tienda es el de Guatemala, no el de UTC', () => {
  it('Guatemala está seis horas detrás de UTC, todo el año', () => {
    expect(DESFASE_DE_GUATEMALA_EN_HORAS).toBe(-6);
  });

  it('a las 14:00 de Guatemala el día es el 11, igual que en UTC', () => {
    expect(comoDia(diaDeGuatemala(TARDE_DEL_11))).toBe('2026-09-11');
  });

  it('A LAS 20:30 DE GUATEMALA SIGUE SIENDO EL 11, aunque en UTC ya sea el 12', () => {
    /*
      ES EL DEFECTO QUE ESTE MÓDULO EXISTE PARA EVITAR. Sin convertir, todas las
      ventas de después de las 18:00 se le atribuirían al día siguiente: el
      reporte de «hoy» estaría bien a media tarde y mentiría de noche, que es la
      peor forma de estar mal.
    */
    expect(new Date(NOCHE_DEL_11).toISOString()).toContain('2026-09-12');
    expect(comoDia(diaDeGuatemala(NOCHE_DEL_11))).toBe('2026-09-11');
  });

  it('a las 18:00 en punto de Guatemala todavía es el mismo día', () => {
    const justoALas18 = Date.parse('2026-09-12T00:00:00.000Z');
    expect(comoDia(diaDeGuatemala(justoALas18))).toBe('2026-09-11');
  });

  it('a las 00:00 de Guatemala ya es el día siguiente', () => {
    const medianocheLocal = Date.parse('2026-09-12T06:00:00.000Z');
    expect(comoDia(diaDeGuatemala(medianocheLocal))).toBe('2026-09-12');
  });
});

// ===========================================================================
describe('Las fronteras de cada período', () => {
  it('HOY empieza a las 06:00 UTC y termina a las 05:59:59.999 del día siguiente', () => {
    const periodo = resolverPeriodo({ clase: 'hoy' }, TARDE_DEL_11);

    expect(periodo.desdeIso).toBe('2026-09-11T06:00:00.000Z');
    expect(periodo.hastaIso).toBe('2026-09-12T05:59:59.999Z');
    expect(periodo.desdeDia).toBe('2026-09-11');
    expect(periodo.hastaDia).toBe('2026-09-11');
  });

  it('UNA VENTA DE LAS 23:59 DE GUATEMALA ENTRA EN EL REPORTE DE HOY', () => {
    // El límite es inclusivo hasta el último milisegundo. Con un límite
    // exclusivo habría que acordarse de sumar un día en cada consulta.
    const periodo = resolverPeriodo({ clase: 'hoy' }, TARDE_DEL_11);
    const ventaDeLas2359 = '2026-09-12T05:59:30.000Z';

    expect(ventaDeLas2359 >= periodo.desdeIso).toBe(true);
    expect(ventaDeLas2359 <= periodo.hastaIso).toBe(true);
  });

  it('una venta de las 00:01 del día siguiente NO entra', () => {
    const periodo = resolverPeriodo({ clase: 'hoy' }, TARDE_DEL_11);
    expect('2026-09-12T06:01:00.000Z' <= periodo.hastaIso).toBe(false);
  });

  it('pedido de noche, HOY sigue siendo el 11 y no el 12', () => {
    const periodo = resolverPeriodo({ clase: 'hoy' }, NOCHE_DEL_11);
    expect(periodo.desdeDia).toBe('2026-09-11');
    expect(periodo.hastaDia).toBe('2026-09-11');
  });

  it('AYER es un solo día completo, el anterior', () => {
    const periodo = resolverPeriodo({ clase: 'ayer' }, TARDE_DEL_11);
    expect(periodo.desdeDia).toBe('2026-09-10');
    expect(periodo.hastaDia).toBe('2026-09-10');
    expect(periodo.desdeIso).toBe('2026-09-10T06:00:00.000Z');
    expect(periodo.hastaIso).toBe('2026-09-11T05:59:59.999Z');
  });

  it('ÚLTIMOS 7 DÍAS incluye el de hoy: son 7 días, no 8', () => {
    const periodo = resolverPeriodo({ clase: 'ultimos-7-dias' }, TARDE_DEL_11);
    expect(periodo.desdeDia).toBe('2026-09-05');
    expect(periodo.hastaDia).toBe('2026-09-11');
  });

  it('ESTE MES arranca el día 1 y llega hasta hoy, no hasta fin de mes', () => {
    const periodo = resolverPeriodo({ clase: 'este-mes' }, TARDE_DEL_11);
    expect(periodo.desdeDia).toBe('2026-09-01');
    expect(periodo.hastaDia).toBe('2026-09-11');
  });

  it('el primer día del mes, ESTE MES es un solo día', () => {
    const primeroDeOctubre = Date.parse('2026-10-01T18:00:00.000Z');
    const periodo = resolverPeriodo({ clase: 'este-mes' }, primeroDeOctubre);
    expect(periodo.desdeDia).toBe('2026-10-01');
    expect(periodo.hastaDia).toBe('2026-10-01');
  });

  it('los últimos 7 días cruzan el cambio de mes sin trabajo especial', () => {
    const tresDeOctubre = Date.parse('2026-10-03T18:00:00.000Z');
    const periodo = resolverPeriodo({ clase: 'ultimos-7-dias' }, tresDeOctubre);
    expect(periodo.desdeDia).toBe('2026-09-27');
    expect(periodo.hastaDia).toBe('2026-10-03');
  });

  it('y cruzan el cambio de AÑO igual', () => {
    const tresDeEnero = Date.parse('2027-01-03T18:00:00.000Z');
    const periodo = resolverPeriodo({ clase: 'ultimos-7-dias' }, tresDeEnero);
    expect(periodo.desdeDia).toBe('2026-12-28');
    expect(periodo.hastaDia).toBe('2027-01-03');
  });
});

// ===========================================================================
describe('El rango personalizado', () => {
  it('toma los dos días completos que se le pidan', () => {
    const periodo = resolverPeriodo(
      { clase: 'personalizado', desde: '2026-09-01', hasta: '2026-09-05' },
      TARDE_DEL_11,
    );
    expect(periodo.desdeIso).toBe('2026-09-01T06:00:00.000Z');
    expect(periodo.hastaIso).toBe('2026-09-06T05:59:59.999Z');
  });

  it('un solo día es un rango válido', () => {
    const periodo = resolverPeriodo(
      { clase: 'personalizado', desde: '2026-09-03', hasta: '2026-09-03' },
      TARDE_DEL_11,
    );
    expect(periodo.desdeDia).toBe('2026-09-03');
    expect(periodo.hastaDia).toBe('2026-09-03');
  });

  it('sin fecha de inicio se rechaza con un mensaje que dice qué falta', () => {
    expect(() =>
      resolverPeriodo({ clase: 'personalizado', hasta: '2026-09-05' }, TARDE_DEL_11),
    ).toThrow(ErrorDePeriodo);
    try {
      resolverPeriodo({ clase: 'personalizado', hasta: '2026-09-05' }, TARDE_DEL_11);
    } catch (error) {
      expect((error as Error).message).toContain('inicio');
    }
  });

  it('sin fecha de fin también', () => {
    expect(() =>
      resolverPeriodo({ clase: 'personalizado', desde: '2026-09-05' }, TARDE_DEL_11),
    ).toThrow(ErrorDePeriodo);
  });

  it('con el inicio DESPUÉS del fin se rechaza en vez de devolver una lista vacía', () => {
    // Devolver cero ventas sería peor: quien lo pida concluiría que no se vendió
    // nada en esos días, cuando lo que pasó es que tecleó el rango al revés.
    expect(() =>
      resolverPeriodo(
        { clase: 'personalizado', desde: '2026-09-10', hasta: '2026-09-01' },
        TARDE_DEL_11,
      ),
    ).toThrow(ErrorDePeriodo);
  });

  it('UNA FECHA QUE NO EXISTE SE RECHAZA, no se corre en silencio al mes siguiente', () => {
    /*
      `2026-02-31` pasa cualquier comprobación de forma y `Date.UTC` la convierte
      en el 3 de marzo sin avisar. Un reporte que corriera sobre un rango
      distinto del pedido, en silencio, es peor que uno que se niega a correr.
    */
    expect(() =>
      resolverPeriodo(
        { clase: 'personalizado', desde: '2026-02-31', hasta: '2026-03-05' },
        TARDE_DEL_11,
      ),
    ).toThrow(ErrorDePeriodo);
  });

  it('el 29 de febrero de un año bisiesto SÍ existe y se acepta', () => {
    const periodo = resolverPeriodo(
      { clase: 'personalizado', desde: '2028-02-29', hasta: '2028-02-29' },
      TARDE_DEL_11,
    );
    expect(periodo.desdeDia).toBe('2028-02-29');
  });

  it('un texto que no es una fecha se rechaza con un mensaje legible', () => {
    expect(() =>
      resolverPeriodo({ clase: 'personalizado', desde: 'ayer', hasta: '2026-09-05' }, TARDE_DEL_11),
    ).toThrow(ErrorDePeriodo);
  });
});

// ===========================================================================
describe('La etiqueta dice exactamente qué se está mirando', () => {
  it('HOY nombra el día concreto, no solo la palabra', () => {
    expect(resolverPeriodo({ clase: 'hoy' }, TARDE_DEL_11).etiqueta).toBe('Hoy · 11/09/2026');
  });

  it('los últimos 7 días nombran los dos extremos', () => {
    expect(resolverPeriodo({ clase: 'ultimos-7-dias' }, TARDE_DEL_11).etiqueta).toBe(
      'Últimos 7 días · 05/09/2026 a 11/09/2026',
    );
  });

  it('el rango personalizado nombra solo las dos fechas', () => {
    expect(
      resolverPeriodo(
        { clase: 'personalizado', desde: '2026-08-01', hasta: '2026-08-31' },
        TARDE_DEL_11,
      ).etiqueta,
    ).toBe('01/08/2026 a 31/08/2026');
  });
});
