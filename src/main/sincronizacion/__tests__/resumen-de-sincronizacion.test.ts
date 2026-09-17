/**
 * El cálculo del estado de sincronización, sin SQLite y sin reloj real.
 */

import { describe, expect, it } from 'vitest';

import {
  calcularEstadoDeSincronizacion,
  colorDeEstado,
  ESTADOS_DE_SINCRONIZACION,
  textoDeBarraDeEstado,
  UMBRAL_DE_PENDIENTES_VIEJOS_MS,
  type ConexionTrasUnFallo,
  type CredencialParaElResumen,
  type DatosCrudosDeSincronizacion,
} from '../resumen-de-sincronizacion';

const AHORA = '2026-09-15T12:00:00.000Z';

const CREDENCIAL_OK: CredencialParaElResumen = {
  hayCredencial: true,
  revocada: false,
  conectada: true,
  yaSeIntentoConectar: true,
};

/** Base neutra: credencial buena, sin pendientes, sin nada bloqueado. */
function base(cambios: Partial<DatosCrudosDeSincronizacion> = {}): DatosCrudosDeSincronizacion {
  return {
    credencial: CREDENCIAL_OK,
    pendientes: 0,
    pendienteMasViejaDesde: null,
    hayLoteBloqueante: false,
    ahoraIso: AHORA,
    conexionTrasElUltimoFallo: null,
    intentosActualesDelLoteMedido: null,
    medicionEnCurso: null,
    ...cambios,
  };
}

/**
 * Una subida del lote `L1` falló por primera vez y el trabajador midió después
 * la capa 2; la cola sigue con ese lote en el mismo intento.
 */
function trasUnFalloMedido(
  hayNube: boolean,
  cambios: Partial<DatosCrudosDeSincronizacion> = {},
): DatosCrudosDeSincronizacion {
  const medicion: ConexionTrasUnFallo = { loteId: 'L1', intentos: 1, hayNube };
  return base({
    pendientes: 2,
    pendienteMasViejaDesde: hace(1),
    conexionTrasElUltimoFallo: medicion,
    intentosActualesDelLoteMedido: 1,
    ...cambios,
  });
}

/** Una fecha ISO a `horas` de distancia de AHORA, hacia el pasado. */
function hace(horas: number): string {
  const HORA_EN_MS = 60 * 60 * 1000;
  return new Date(Date.parse(AHORA) - horas * HORA_EN_MS).toISOString();
}

// ===========================================================================
describe('Los estados de siempre, cada uno en su condición exacta', () => {
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
        credencial: { hayCredencial: true, revocada: false, conectada: false, yaSeIntentoConectar: true },
        pendientes: 5,
        pendienteMasViejaDesde: hace(1),
      }),
    );
    expect(estado).toBe('sin_conexion');
  });

  it('ANTES del primer intento de conectarse, sin token no es «sin conexión»: todavía no se preguntó', () => {
    // Medido el 2026-09-17: al abrir, con Auth contestando bien, la barra decía
    // «sin conexión» a los 514 ms porque la sesión arranca después de la ventana.
    const estado = calcularEstadoDeSincronizacion(
      base({
        credencial: { hayCredencial: true, revocada: false, conectada: false, yaSeIntentoConectar: false },
        pendientes: 2,
        pendienteMasViejaDesde: hace(1),
      }),
    );
    expect(estado).toBe('pendientes');
  });

  it('sin token vigente pero SIN pendientes: al día igual (no hay nada que avisar)', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ credencial: { hayCredencial: true, revocada: false, conectada: false, yaSeIntentoConectar: true } }),
    );
    expect(estado).toBe('al_dia');
  });

  it('sin credencial guardada: sin_credencial', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({ credencial: { hayCredencial: false, revocada: false, conectada: false, yaSeIntentoConectar: true } }),
    );
    expect(estado).toBe('sin_credencial');
  });

  it('credencial revocada: sin_credencial, aunque hayCredencial siga en true', () => {
    // Revocada significa "el archivo sigue ahí pero la nube ya no lo acepta".
    const estado = calcularEstadoDeSincronizacion(
      base({ credencial: { hayCredencial: true, revocada: true, conectada: false, yaSeIntentoConectar: true } }),
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
describe('Después de un fallo MEDIDO: «problema al sincronizar» NO es «sin conexión» (§4.51)', () => {
  it('ESCENARIO C — hay token, la subida falló y la nube SÍ contestó después: problema_al_sincronizar', () => {
    expect(calcularEstadoDeSincronizacion(trasUnFalloMedido(true))).toBe('problema_al_sincronizar');
  });

  it('LA RED CAÍDA A MITAD DEL DÍA — hay token (no se borra), la subida falló y la nube NO contestó: sin_conexion', () => {
    // `conectada` sigue en true: el token no se borra cuando una renovación
    // falla por la red. Por eso no alcanza con mirar el token.
    expect(calcularEstadoDeSincronizacion(trasUnFalloMedido(false))).toBe('sin_conexion');
  });

  it('ESCENARIO B — sin token y sin medición: sin_conexion, igual que antes', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({
        credencial: { hayCredencial: true, revocada: false, conectada: false, yaSeIntentoConectar: true },
        pendientes: 2,
        pendienteMasViejaDesde: hace(1),
      }),
    );
    expect(estado).toBe('sin_conexion');
  });

  it('sin token, aunque haya una medición positiva vieja: sin_conexion (no hay token con qué subir)', () => {
    const estado = calcularEstadoDeSincronizacion(
      trasUnFalloMedido(true, { credencial: { hayCredencial: true, revocada: false, conectada: false, yaSeIntentoConectar: true } }),
    );
    expect(estado).toBe('sin_conexion');
  });

  it('si el lote VOLVIÓ a fallar después de medir, no se afirma nada: pendientes', () => {
    const estado = calcularEstadoDeSincronizacion(
      trasUnFalloMedido(true, { intentosActualesDelLoteMedido: 2 }),
    );
    expect(estado).toBe('pendientes');
  });

  it('si el lote medido ya no está pendiente, la medición no cuenta: pendientes', () => {
    const estado = calcularEstadoDeSincronizacion(
      trasUnFalloMedido(true, { intentosActualesDelLoteMedido: null }),
    );
    expect(estado).toBe('pendientes');
  });

  it('una medición sin pendientes no inventa un problema: al_dia', () => {
    const estado = calcularEstadoDeSincronizacion(
      trasUnFalloMedido(true, { pendientes: 0, pendienteMasViejaDesde: null }),
    );
    expect(estado).toBe('al_dia');
  });

  it('sin nube configurada (credencial null) nunca da problema_al_sincronizar', () => {
    const estado = calcularEstadoDeSincronizacion(trasUnFalloMedido(true, { credencial: null }));
    expect(estado).toBe('pendientes');
  });

  it('lote bloqueante, pendientes viejos y sin credencial siguen ganando sobre la medición', () => {
    expect(calcularEstadoDeSincronizacion(trasUnFalloMedido(true, { hayLoteBloqueante: true }))).toBe(
      'detenida',
    );
    expect(
      calcularEstadoDeSincronizacion(trasUnFalloMedido(true, { pendienteMasViejaDesde: hace(30) })),
    ).toBe('pendientes_viejos');
    expect(
      calcularEstadoDeSincronizacion(
        trasUnFalloMedido(true, { credencial: { hayCredencial: false, revocada: false, conectada: false, yaSeIntentoConectar: true } }),
      ),
    ).toBe('sin_credencial');
  });

  it('MIENTRAS SE MIDE un fallo nuevo del mismo lote, sigue valiendo la medición anterior (sin parpadeo)', () => {
    const estado = calcularEstadoDeSincronizacion(
      trasUnFalloMedido(false, {
        intentosActualesDelLoteMedido: 2,
        medicionEnCurso: { loteId: 'L1', intentos: 2 },
      }),
    );
    expect(estado).toBe('sin_conexion');
  });

  it('una medición en curso de OTRO lote no hace valer la medición vieja: pendientes', () => {
    const estado = calcularEstadoDeSincronizacion(
      trasUnFalloMedido(true, {
        intentosActualesDelLoteMedido: 2,
        medicionEnCurso: { loteId: 'L2', intentos: 2 },
      }),
    );
    expect(estado).toBe('pendientes');
  });

  it('una medición en curso de un intento que NO es el de la cola no cuenta: pendientes', () => {
    const estado = calcularEstadoDeSincronizacion(
      trasUnFalloMedido(true, {
        intentosActualesDelLoteMedido: 3,
        medicionEnCurso: { loteId: 'L1', intentos: 2 },
      }),
    );
    expect(estado).toBe('pendientes');
  });

  it('EL TEXTO de C y el de B son distintos, y cada uno dice lo suyo', () => {
    const textoC = textoDeBarraDeEstado('problema_al_sincronizar', 2);
    const textoB = textoDeBarraDeEstado('sin_conexion', 2);
    expect(textoC).toBe('Nube: problema al sincronizar — 2 pendientes');
    expect(textoB).toBe('Nube: sin conexión — 2 pendientes');
    expect(textoC).not.toContain('sin conexión');
    expect(textoB).not.toContain('problema');
  });
});

// ===========================================================================
describe('Prioridad: qué gana cuando varias cosas son ciertas a la vez', () => {
  it('sin credencial gana sobre lote bloqueante: la causa de fondo, no el síntoma', () => {
    const estado = calcularEstadoDeSincronizacion(
      base({
        credencial: { hayCredencial: false, revocada: false, conectada: false, yaSeIntentoConectar: true },
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
        credencial: { hayCredencial: true, revocada: false, conectada: false, yaSeIntentoConectar: true },
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
    está detenida o sin credencial.» Se prueban TODOS los estados, no solo los
    que el diseño nombra, para que un estado nuevo agregado sin decidir su
    color no pase en silencio con `undefined`.
  */
  it('al_dia, pendientes y sin_conexion: neutral (son pasivos: se resuelven solos)', () => {
    expect(colorDeEstado('al_dia')).toBe('neutral');
    expect(colorDeEstado('pendientes')).toBe('neutral');
    expect(colorDeEstado('sin_conexion')).toBe('neutral');
  });

  it('problema_al_sincronizar: ÁMBAR, el mismo de pendientes_viejos (decisión de Julio, 2026-09-17)', () => {
    expect(colorDeEstado('problema_al_sincronizar')).toBe('ambar');
    expect(colorDeEstado('problema_al_sincronizar')).toBe(colorDeEstado('pendientes_viejos'));
  });

  it('problema_al_sincronizar y sin_conexion NO se ven del mismo color', () => {
    expect(colorDeEstado('problema_al_sincronizar')).not.toBe(colorDeEstado('sin_conexion'));
  });

  it('la lista recorre los siete estados, y cada uno tiene color y texto', () => {
    expect(ESTADOS_DE_SINCRONIZACION).toHaveLength(7);
    for (const estado of ESTADOS_DE_SINCRONIZACION) {
      expect(['neutral', 'ambar', 'rojo']).toContain(colorDeEstado(estado));
      expect(textoDeBarraDeEstado(estado, 3).startsWith('Nube: ')).toBe(true);
    }
    // Siete textos distintos: ningún estado se ve igual que otro.
    const textos = ESTADOS_DE_SINCRONIZACION.map((estado) => textoDeBarraDeEstado(estado, 3));
    expect(new Set(textos).size).toBe(ESTADOS_DE_SINCRONIZACION.length);
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
    expect(textoDeBarraDeEstado('problema_al_sincronizar', 2)).toBe(
      'Nube: problema al sincronizar — 2 pendientes',
    );
    expect(textoDeBarraDeEstado('detenida', 0)).toBe('Nube: DETENIDA');
    expect(textoDeBarraDeEstado('sin_credencial', 0)).toBe('Nube: sin conectar');
  });

  it('NINGÚN texto contiene una hora del reloj: no se mide "desde cuándo" con precisión de minutos', () => {
    for (const estado of ESTADOS_DE_SINCRONIZACION) {
      expect(textoDeBarraDeEstado(estado, 5)).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});
