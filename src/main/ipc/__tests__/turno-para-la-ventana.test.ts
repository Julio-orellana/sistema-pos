/**
 * QUIÉN PUEDE VER EL EFECTIVO TEÓRICO, decidido en el proceso principal (§4.40).
 *
 * La pantalla de caja dibuja el teórico solo si le llega. Eso es comodidad: un
 * usuario de venta puede llamar `window.pos.caja.estado()` desde la consola.
 * Lo que de verdad protege es que el dato NO CRUCE el puente para ese rol, y
 * eso lo decide `turnoParaLaVentana`. Estas pruebas lo fijan en dos niveles:
 *
 *   1. La función, con los dos roles y sin sesión.
 *   2. Los TRES lugares que arman un turno para la ventana —el estado de caja,
 *      la apertura y el estado de la venta—, leídos del código fuente: el
 *      riesgo no es la función de hoy, es el cuarto canal que alguien agregue
 *      armando el turno a mano.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Decimal from 'decimal.js';

import type { CajaSesion } from '@main/database/repositories/entidades';
import type { ConteoSellado } from '@main/domain/caja/servicio-de-caja';
import type { UsuarioEnSesion } from '@main/domain/usuarios/sesion';
import { puedeVerElTeorico, turnoParaLaVentana, type ContextoDelTurno } from '../turno-para-la-ventana';

const TURNO: CajaSesion = {
  id: 'turno-1',
  usuarioId: 'usuario-rosa',
  montoInicial: new Decimal('500.00'),
  abiertaEn: '2026-09-14T13:00:00.000Z',
  montoEsperado: null,
  montoReal: null,
  diferencia: null,
  cerradaEn: null,
  cerradaPor: null,
  estado: 'abierta',
  diferenciaAutorizadaPor: null,
  diferenciaAutorizadaVia: null,
  creadoEn: '2026-09-14T13:00:00.000Z',
  actualizadoEn: '2026-09-14T13:00:00.000Z',
};

const ADMINISTRADOR: UsuarioEnSesion = {
  id: 'usuario-jimmy',
  nombre: 'Jimmy',
  rol: 'administrativo',
  desde: '2026-09-14T13:00:00.000Z',
};

const CAJERA: UsuarioEnSesion = {
  id: 'usuario-rosa',
  nombre: 'Rosa',
  rol: 'venta',
  desde: '2026-09-14T13:00:00.000Z',
};

const SELLO: ConteoSellado = {
  asientoId: 'asiento-1',
  fecha: '2026-09-14T20:00:00.000Z',
  montoEsperado: '630.50',
  montoReal: '610.50',
  diferencia: '-20.00',
  modo: 'simple',
};

/** Una caja de mentira que cuenta cuántas veces se le pidió el resumen. */
function cajaDePrueba(sellos: readonly ConteoSellado[] = []): ContextoDelTurno['caja'] & {
  readonly vecesQueSePidioElResumen: () => number;
} {
  let veces = 0;
  return {
    resumenDelTurno: (): ReturnType<ContextoDelTurno['caja']['resumenDelTurno']> => {
      veces += 1;
      return {
        ventasEnEfectivo: new Decimal('130.50'),
        cantidadDeVentasEnEfectivo: 4,
        montoTeorico: new Decimal('630.50'),
      };
    },
    conteosSelladosDe: (): readonly ConteoSellado[] => sellos,
    vecesQueSePidioElResumen: (): number => veces,
  };
}

// ===========================================================================
describe('Solo el rol ADMINISTRATIVO recibe el teórico', () => {
  it('un administrativo recibe el teórico, las ventas en efectivo y su cantidad', () => {
    const turno = turnoParaLaVentana(TURNO, {
      quienMira: ADMINISTRADOR,
      nombreDeQuienAbrio: 'Rosa',
      caja: cajaDePrueba(),
    });

    expect(turno.montoTeorico).toBe('630.50');
    expect(turno.ventasEnEfectivo).toBe('130.50');
    expect(turno.cantidadDeVentasEnEfectivo).toBe(4);
  });

  it('un usuario de VENTA recibe los tres en null', () => {
    const turno = turnoParaLaVentana(TURNO, {
      quienMira: CAJERA,
      nombreDeQuienAbrio: 'Rosa',
      caja: cajaDePrueba(),
    });

    expect(turno.montoTeorico).toBeNull();
    expect(turno.ventasEnEfectivo).toBeNull();
    expect(turno.cantidadDeVentasEnEfectivo).toBeNull();
  });

  it('para un usuario de venta el teórico NI SE CALCULA: lo que no se calcula no se puede filtrar', () => {
    const caja = cajaDePrueba();
    turnoParaLaVentana(TURNO, { quienMira: CAJERA, nombreDeQuienAbrio: 'Rosa', caja });

    expect(caja.vecesQueSePidioElResumen()).toBe(0);
  });

  it('en ningún campo del turno de un usuario de venta aparece el teórico ni las ventas, ni como texto', () => {
    const turno = turnoParaLaVentana(TURNO, {
      quienMira: CAJERA,
      nombreDeQuienAbrio: 'Rosa',
      caja: cajaDePrueba([SELLO]),
    });
    const serializado = JSON.stringify(turno);

    // Control: el monto inicial SÍ viaja, así que el buscador funciona.
    expect(serializado).toContain('500.00');
    expect(serializado).not.toContain('630.50');
    expect(serializado).not.toContain('130.50');
  });

  it('sin sesión, nadie recibe el teórico', () => {
    expect(puedeVerElTeorico(null)).toBe(false);
    const turno = turnoParaLaVentana(TURNO, {
      quienMira: null,
      nombreDeQuienAbrio: 'Rosa',
      caja: cajaDePrueba(),
    });
    expect(turno.montoTeorico).toBeNull();
  });
});

describe('El conteo sellado viaja SIN el esperado y SIN la diferencia, para todos los roles', () => {
  it.each([
    ['administrativo', ADMINISTRADOR],
    ['venta', CAJERA],
  ])('rol %s: solo la fecha y lo contado', (_rol, quienMira) => {
    const turno = turnoParaLaVentana(TURNO, {
      quienMira,
      nombreDeQuienAbrio: 'Rosa',
      caja: cajaDePrueba([SELLO]),
    });

    expect(turno.primerConteoSellado).toEqual({
      fecha: '2026-09-14T20:00:00.000Z',
      montoReal: '610.50',
    });
    expect(JSON.stringify(turno.primerConteoSellado)).not.toContain('-20.00');
  });
});

// ===========================================================================
const IPC = join(__dirname, '..');
const REGISTRO = readFileSync(join(IPC, 'register-handlers.ts'), 'utf8');
const VENTA = readFileSync(join(IPC, 'venta.ts'), 'utf8');

describe('Ningún canal arma el turno a mano con el teórico', () => {
  it('el estado de caja y la apertura lo arman con `turnoParaLaVentana`', () => {
    expect((REGISTRO.match(/turnoParaLaVentana\(/g) ?? []).length).toBe(2);
  });

  it('`register-handlers.ts` no llama a `resumenDelTurno` por su cuenta', () => {
    expect(REGISTRO).not.toContain('resumenDelTurno');
  });

  it('el estado de la VENTA no manda el teórico a ningún rol: ni calcula el resumen, ni asigna el teórico con otro valor que null', () => {
    expect(VENTA).not.toContain('resumenDelTurno');
    const asignaciones = VENTA.match(/montoTeorico:\s*[^,\n]+/g) ?? [];
    expect(asignaciones.length).toBeGreaterThan(0);
    for (const asignacion of asignaciones) {
      expect(asignacion).toMatch(/montoTeorico:\s*null/);
    }
  });

  it('antes de contar —el pedido de PIN de una caja ajena— el esperado viaja en null', () => {
    expect(REGISTRO).toMatch(
      /resultado\.codigo === 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA' \? null : resultado\.montoEsperado/,
    );
  });
});
