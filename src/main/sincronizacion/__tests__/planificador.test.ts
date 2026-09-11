/**
 * Cuándo corre el trabajador: los disparadores y las esperas de §2.4 y §5.3.
 *
 * Los temporizadores se inyectan, así que estas pruebas no esperan cinco
 * minutos: registran qué se agendó y con cuánta espera, que es exactamente lo
 * que hay que verificar. Un `setTimeout` real solo probaría que Node sabe
 * contar.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { ResumenDeCiclo, TrabajadorDeSincronizacion } from '../trabajador';
import { ESPERAS_DEL_PLANIFICADOR, PlanificadorDeSincronizacion } from '../planificador';

/** Un temporizador agendado, para poder afirmar sobre él y dispararlo a mano. */
interface Agendado {
  readonly id: number;
  readonly ms: number;
  readonly accion: () => void;
  cancelado: boolean;
}

let agendados: Agendado[] = [];
let siguienteId = 0;

function programar(accion: () => void, ms: number): unknown {
  siguienteId += 1;
  const entrada: Agendado = { id: siguienteId, ms, accion, cancelado: false };
  agendados.push(entrada);
  return entrada.id;
}

function cancelar(identificador: unknown): void {
  const entrada = agendados.find((candidato) => candidato.id === identificador);
  if (entrada !== undefined) {
    entrada.cancelado = true;
  }
}

/** Lo agendado que sigue vivo. */
function vivos(): Agendado[] {
  return agendados.filter((entrada) => !entrada.cancelado);
}

/** Un trabajador de mentira que devuelve el resumen que la prueba quiera. */
function trabajadorQueDevuelve(
  resumen: Partial<ResumenDeCiclo>,
  descansoTrasPresupuestoMs = 60_000,
): TrabajadorDeSincronizacion {
  const completo: ResumenDeCiclo = {
    motivo: 'sin_pendientes',
    lotesSubidos: 0,
    filasSubidas: 0,
    loteEnEspera: null,
    error: null,
    proximoIntentoEn: null,
    duracionMs: 0,
    ...resumen,
  };
  return {
    presupuesto: { descansoTrasPresupuestoMs },
    ejecutarCiclo: (): Promise<ResumenDeCiclo> => Promise.resolve(completo),
  } as unknown as TrabajadorDeSincronizacion;
}

const AHORA = Date.parse('2026-09-11T12:00:00.000Z');

function crearPlanificador(trabajador: TrabajadorDeSincronizacion): PlanificadorDeSincronizacion {
  return new PlanificadorDeSincronizacion({
    trabajador,
    ahora: (): number => AHORA,
    programar,
    cancelar,
  });
}

beforeEach(() => {
  agendados = [];
  siguienteId = 0;
});

describe('Las esperas son las del diseño, no números elegidos por gusto', () => {
  it('los cinco valores son los de las secciones 2.4 y 5.3', () => {
    expect(ESPERAS_DEL_PLANIFICADOR).toEqual({
      trasTransaccion: 2_000,
      trasArranque: 30_000,
      respaldo: 300_000,
      trasDespertar: 15_000,
      trasCeder: 2_000,
    });
  });
});

describe('Los disparadores agendan el ciclo con la espera que corresponde', () => {
  it('al arrancar, el primer ciclo va 30 segundos después', () => {
    crearPlanificador(trabajadorQueDevuelve({})).arrancar();

    expect(vivos()).toHaveLength(1);
    expect(vivos()[0]?.ms).toBe(30_000);
  });

  it('al confirmar una transacción, el ciclo va 2 segundos después', () => {
    crearPlanificador(trabajadorQueDevuelve({})).alConfirmarTransaccion();

    expect(vivos()).toHaveLength(1);
    expect(vivos()[0]?.ms).toBe(2_000);
  });

  it('TRES VENTAS SEGUIDAS DISPARAN UN SOLO CICLO, no tres', () => {
    const planificador = crearPlanificador(trabajadorQueDevuelve({}));

    planificador.alConfirmarTransaccion();
    planificador.alConfirmarTransaccion();
    planificador.alConfirmarTransaccion();

    // Se agendaron tres, pero los dos primeros quedaron cancelados: cada aviso
    // reinicia la cuenta, así que el ciclo corre 2 s después de la ÚLTIMA.
    expect(agendados).toHaveLength(3);
    expect(vivos()).toHaveLength(1);
    expect(vivos()[0]?.ms).toBe(2_000);
  });

  it('al despertar de suspensión espera los 15 segundos que Windows necesita', () => {
    crearPlanificador(trabajadorQueDevuelve({})).alDespertar();

    expect(vivos()[0]?.ms).toBe(15_000);
  });

  it('detener cancela lo agendado y ningún disparador vuelve a agendar', () => {
    const planificador = crearPlanificador(trabajadorQueDevuelve({}));
    planificador.arrancar();

    planificador.detener();
    planificador.alConfirmarTransaccion();
    planificador.alDespertar();

    expect(vivos()).toHaveLength(0);
  });
});

describe('Qué se agenda DESPUÉS de un ciclo, según cómo haya terminado', () => {
  it('sin pendientes no agenda NADA: una máquina al día no gasta ciclos', async () => {
    await crearPlanificador(trabajadorQueDevuelve({ motivo: 'sin_pendientes' })).ejecutarAhora();

    expect(vivos()).toHaveLength(0);
  });

  it('con la cola vaciada tampoco agenda nada: ya no queda trabajo', async () => {
    await crearPlanificador(
      trabajadorQueDevuelve({ motivo: 'cola_vaciada', lotesSubidos: 3 }),
    ).ejecutarAhora();

    expect(vivos()).toHaveLength(0);
  });

  it('UNA COLA DETENIDA NO SE REINTENTA SOLA: no agenda nada', async () => {
    await crearPlanificador(
      trabajadorQueDevuelve({ motivo: 'cola_detenida', loteEnEspera: 'lote-roto' }),
    ).ejecutarAhora();

    expect(vivos()).toHaveLength(0);
  });

  it('sin credencial tampoco: lo que falta se resuelve reprovisionando, no insistiendo', async () => {
    await crearPlanificador(trabajadorQueDevuelve({ motivo: 'sin_credencial' })).ejecutarAhora();

    expect(vivos()).toHaveLength(0);
  });

  it('tras agotar el presupuesto descansa los 60 segundos del diseño', async () => {
    await crearPlanificador(
      trabajadorQueDevuelve({ motivo: 'presupuesto_agotado', lotesSubidos: 20 }),
    ).ejecutarAhora();

    expect(vivos()).toHaveLength(1);
    expect(vivos()[0]?.ms).toBe(60_000);
  });

  it('tras ceder ante una venta vuelve a mirar enseguida, para no dejar la cola varada', async () => {
    await crearPlanificador(trabajadorQueDevuelve({ motivo: 'cedio_ante_venta' })).ejecutarAhora();

    expect(vivos()[0]?.ms).toBe(2_000);
  });

  it('tras un fallo transitorio despierta EXACTAMENTE cuando toca el reintento', async () => {
    await crearPlanificador(
      trabajadorQueDevuelve({
        motivo: 'fallo_transitorio',
        proximoIntentoEn: new Date(AHORA + 5_000).toISOString(),
      }),
    ).ejecutarAhora();

    expect(vivos()[0]?.ms).toBe(5_000);
  });

  it('si el reintento cae dentro de una hora, no duerme más de los 5 minutos de respaldo', async () => {
    await crearPlanificador(
      trabajadorQueDevuelve({
        motivo: 'esperando_backoff',
        proximoIntentoEn: new Date(AHORA + 3_600_000).toISOString(),
      }),
    ).ejecutarAhora();

    // El tope cubre además el riesgo 8.5: un reloj corregido hacia atrás
    // dejaría un `proximo_intento_en` en un futuro que no llega nunca.
    expect(vivos()[0]?.ms).toBe(300_000);
  });

  it('un reintento ya vencido se agenda para ya, no con espera negativa', async () => {
    await crearPlanificador(
      trabajadorQueDevuelve({
        motivo: 'esperando_backoff',
        proximoIntentoEn: new Date(AHORA - 90_000).toISOString(),
      }),
    ).ejecutarAhora();

    expect(vivos()[0]?.ms).toBe(0);
  });
});

describe('El planificador recuerda el último ciclo, para que la barra de estado tenga qué mostrar', () => {
  it('guarda el resumen del ciclo que acaba de correr', async () => {
    const planificador = crearPlanificador(
      trabajadorQueDevuelve({ motivo: 'cola_detenida', loteEnEspera: 'lote-roto', error: 'CHECK' }),
    );
    expect(planificador.ultimoResumen).toBeNull();

    await planificador.ejecutarAhora();

    expect(planificador.ultimoResumen?.motivo).toBe('cola_detenida');
    expect(planificador.ultimoResumen?.loteEnEspera).toBe('lote-roto');
  });
});
