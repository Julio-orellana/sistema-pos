/**
 * El cálculo del estado de sincronización, sin SQLite y sin reloj real.
 */

import { describe, expect, it } from 'vitest';

import {
  calcularEstadoDeSincronizacion,
  colorDeEstado,
  textoDeBarraDeEstado,
  UMBRAL_DE_PENDIENTES_VIEJOS_MS,
  type CredencialParaElResumen,
  type DatosCrudosDeSincronizacion,
} from '../resumen-de-sincronizacion';

const AHORA = '2026-09-15T12:00:00.000Z';

const CREDENCIAL_OK: CredencialParaElResumen = {
  hayCredencial: true,
  revocada: false,
  conectada: true,
};

/** Base neutra: credencial buena, sin pendientes, sin nada bloqueado. */
function base(cambios: Partial<DatosCrudosDeSincronizacion> = {}): DatosCrudosDeSincronizacion {
  return {
    credencial: CREDENCIAL_OK,
    pendientes: 0,
    pendienteMasViejaDesde: null,
    hayLoteBloqueante: false,
    ahoraIso: AHORA,
    ...cambios,
  };
}

/** Una fecha ISO a `horas` de distancia de AHORA, hacia el pasado. */
function hace(horas: number): string {
  const HORA_EN_MS = 60 * 60 * 1000;
  return new Date(Date.parse(AHORA) - horas * HORA_EN_MS).toISOString();
}

// ===========================================================================
describe('Los seis estados, cada uno en su condición exacta', () => {
  it('sin pendientes, con credencial buena: al día', () => {
    expect(calcularEstadoDeSincronizacion(base())).toBe('al_dia');
  });

  it('con pendientes recientes: pendientes, sin adjetivo', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ pendientes: 3, pendienteMasViejaDesde: hace(1) }),
    );
    expect(estado).toBe('pendientes');
  });

  it('pendientes de más de 24 h: pendientes_viejos', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ pendientes: 340, pendienteMasViejaDesde: hace(25) }),
    );
    expect(estado).toBe('pendientes_viejos');
  });

  it('exactamente en el umbral (24 h justas) YA cuenta como viejo', () => {
    // El umbral es >=, no >: a las 24 h exactas ya pasó "un día entero".
    const estado = calcularEstadoDeSincronizacion(
      base({ pendientes: 1, pendienteMasViejaDesde: hace(24) }),
    );
    expect(estado).toBe('pendientes_viejos');
  });

  it('un segundo ANTES del umbral todavía es "pendientes", no "viejos"', () => {
    const unSegundoAntes = new Date(
      Date.parse(AHORA) - (UMBRAL_DE_PENDIENTES_VIEJOS_MS - 1000),
    ).toISOString();
    const estado = calcularEstadoDeSincronizacion(
      base({ pendientes: 1, pendienteMasViejaDesde: unSegundoAntes }),
    );
    expect(estado).toBe('pendientes');
  });

  it('sin token vigente pero con credencial buena y pendientes: sin_conexion', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({
        credencial: { hayCredencial: true, revocada: false, conectada: false },
        pendientes: 5,
        pendienteMasViejaDesde: hace(1),
      }),
    );
    expect(estado).toBe('sin_conexion');
  });

  it('sin token vigente pero SIN pendientes: al día igual (no hay nada que avisar)', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ credencial: { hayCredencial: true, revocada: false, conectada: false } }),
    );
    expect(estado).toBe('al_dia');
  });

  it('sin credencial guardada: sin_credencial', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ credencial: { hayCredencial: false, revocada: false, conectada: false } }),
    );
    expect(estado).toBe('sin_credencial');
  });

  it('credencial revocada: sin_credencial, aunque hayCredencial siga en true', () => {
    // Revocada significa "el archivo sigue ahí pero la nube ya no lo acepta".
    const estado = calcularEstadoDeSincronizacion(
      base({ credencial: { hayCredencial: true, revocada: true, conectada: false } }),
    );
    expect(estado).toBe('sin_credencial');
  });

  it('un lote bloqueante: detenida', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ pendientes: 12, pendienteMasViejaDesde: hace(1), hayLoteBloqueante: true }),
    );
    expect(estado).toBe('detenida');
  });

  it('nube NO configurada (credencial null): nunca da sin_credencial ni sin_conexion', () => {
    // Un desarrollo sin POS_NUBE_URL no tiene a quién conectarse: no es un
    // problema, es el modo simulado de siempre (§4.17).
    expect(calcularEstadoDeSincronizacion(base({ credencial: null }))).toBe('al_dia');
    expect(
      calcularEstadoDeSincronizacion(
        base({ credencial: null, pendientes: 4, pendienteMasViejaDesde: hace(1) }),
      ),
    ).toBe('pendientes');
  });
});

// ===========================================================================
describe('Prioridad: qué gana cuando varias cosas son ciertas a la vez', () => {
  it('sin credencial gana sobre lote bloqueante: la causa de fondo, no el síntoma', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({
        credencial: { hayCredencial: false, revocada: false, conectada: false },
        hayLoteBloqueante: true,
        pendientes: 9,
        pendienteMasViejaDesde: hace(1),
      }),
    );
    expect(estado).toBe('sin_credencial');
  });

  it('lote bloqueante gana sobre pendientes viejos', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ hayLoteBloqueante: true, pendientes: 9, pendienteMasViejaDesde: hace(48) }),
    );
    expect(estado).toBe('detenida');
  });

  it('pendientes viejos gana sobre sin_conexion', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({
        credencial: { hayCredencial: true, revocada: false, conectada: false },
        pendientes: 9,
        pendienteMasViejaDesde: hace(30),
      }),
    );
    expect(estado).toBe('pendientes_viejos');
  });
});

// ===========================================================================
describe('El color: FALSIFICADO contra la frase literal de §3.3', () => {
  /*
    «Sin color cuando está al día; ámbar con pendientes viejos; rojo cuando
    está detenida o sin credencial.» Se prueban los SEIS estados, no solo los
    que el diseño nombra, para que un estado nuevo agregado sin decidir su
    color no pase en silencio con `undefined`.
  */
  it('al_dia y pendientes y sin_conexion: neutral', () => {
    expect(colorDeEstado('al_dia')).toBe('neutral');
    expect(colorDeEstado('pendientes')).toBe('neutral');
    expect(colorDeEstado('sin_conexion')).toBe('neutral');
  });

  it('pendientes_viejos: ambar', () => {
    expect(colorDeEstado('pendientes_viejos')).toBe('ambar');
  });

  it('detenida y sin_credencial: rojo', () => {
    expect(colorDeEstado('detenida')).toBe('rojo');
    expect(colorDeEstado('sin_credencial')).toBe('rojo');
  });
});

// ===========================================================================
describe('El texto de la barra nombra el número, y NO inventa una hora', () => {
  it('cada estado tiene su propio texto', () => {
    expect(textoDeBarraDeEstado('al_dia', 0)).toBe('Nube: al día');
    expect(textoDeBarraDeEstado('pendientes', 7)).toBe('Nube: 7 pendientes');
    expect(textoDeBarraDeEstado('pendientes_viejos', 340)).toContain('340');
    expect(textoDeBarraDeEstado('pendientes_viejos', 340)).toContain('24 h');
    expect(textoDeBarraDeEstado('sin_conexion', 2)).toContain('2 pendientes');
    expect(textoDeBarraDeEstado('detenida', 0)).toBe('Nube: DETENIDA');
    expect(textoDeBarraDeEstado('sin_credencial', 0)).toBe('Nube: sin conectar');
  });

  it('NINGÚN texto contiene una hora del reloj: no se mide "desde cuándo" con precisión de minutos', () => {
    for (const estado of [
      'al_dia',
      'pendientes',
      'pendientes_viejos',
      'sin_conexion',
      'detenida',
      'sin_credencial',
    ] as const) {
      expect(textoDeBarraDeEstado(estado, 5)).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});
