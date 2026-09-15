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
import type { ResultadoDeCierreIpc } from '@shared/types/ipc';
import {
  MENSAJE_DE_CIERRE_SIN_TEORICO,
  puedeVerElTeorico,
  resultadoDeCierreParaLaVentana,
  turnoParaLaVentana,
  type ContextoDelTurno,
} from '../turno-para-la-ventana';

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
const FLUJO = readFileSync(join(IPC, 'cierre-de-caja.ts'), 'utf8');

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
    expect(FLUJO).toMatch(
      /resultado\.codigo === 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA' \? null : resultado\.montoEsperado/,
    );
  });
});

// ===========================================================================
// El RESULTADO de intentar cerrar, después de confirmar un conteo (§4.40).
// Esperado Q527.50; la cajera contó Q500.00 (faltante Q27.50).
// ===========================================================================

const PIDE_AUTORIZACION: ResultadoDeCierreIpc = {
  cerrada: false,
  codigo: 'REQUIERE_AUTORIZACION',
  mensaje: 'La caja no cuadra: hay un FALTANTE de Q27.50.',
  diferencia: '-27.50',
  montoEsperado: '527.50',
  montoReal: '500.00',
  autorizadaVia: null,
  segundosParaReintentar: null,
  montoInicial: '500.00',
  primerConteo: null,
};

/** Recontó Q527.50, que cuadra, después de haber sellado Q500.00. */
const PIDE_RECONTEO: ResultadoDeCierreIpc = {
  ...PIDE_AUTORIZACION,
  codigo: 'REQUIERE_AUTORIZACION_DE_RECONTEO',
  mensaje:
    'Antes se confirmó un conteo de Q500.00 con un FALTANTE de Q27.50. Corregir un conteo que mostraba una diferencia exige la autorización de un administrador, aunque ahora cuadre.',
  diferencia: '0.00',
  montoReal: '527.50',
  primerConteo: {
    fecha: '2026-09-14T20:00:00.000Z',
    montoEsperado: '527.50',
    montoReal: '500.00',
    diferencia: '-27.50',
  },
};

describe('A una CAJERA, el diálogo de autorización no le trae nada que revele el esperado', () => {
  it('diferencia: esperado y diferencia en null, y el mensaje con monto se reemplaza por uno sin monto', () => {
    const visto = resultadoDeCierreParaLaVentana(PIDE_AUTORIZACION, CAJERA);

    expect(visto.montoEsperado).toBeNull();
    expect(visto.diferencia).toBeNull();
    expect(visto.mensaje).toBe(MENSAJE_DE_CIERRE_SIN_TEORICO);
    expect(visto.codigo).toBe('REQUIERE_AUTORIZACION');
  });

  it('en NINGÚN campo aparece el esperado ni la diferencia, ni con signo ni sin él', () => {
    const serializado = JSON.stringify(resultadoDeCierreParaLaVentana(PIDE_AUTORIZACION, CAJERA));

    // Control: lo que ella contó SÍ viaja, así que el buscador funciona.
    expect(serializado).toContain('500.00');
    expect(serializado).not.toContain('527.50');
    expect(serializado).not.toContain('27.50');
    expect(serializado.toLowerCase()).not.toContain('faltante');
  });

  it('reconteo: se presenta como un pedido de autorización COMÚN, porque el código propio diría que ahora cuadra', () => {
    const visto = resultadoDeCierreParaLaVentana(PIDE_RECONTEO, CAJERA);
    const serializado = JSON.stringify(visto);

    expect(visto.codigo).toBe('REQUIERE_AUTORIZACION');
    expect(visto.mensaje).toBe(MENSAJE_DE_CIERRE_SIN_TEORICO);
    expect(visto.primerConteo).toEqual({
      fecha: '2026-09-14T20:00:00.000Z',
      montoEsperado: null,
      montoReal: '500.00',
      diferencia: null,
    });
    expect(serializado.toLowerCase()).not.toContain('cuadra');
    // Lo contado AHORA es 527.50 y lo tecleó ella, así que «27.50» aparece
    // adentro de su propio número: lo que no puede aparecer es la diferencia.
    expect(serializado).not.toContain('"-27.50"');
    expect(serializado).not.toContain('"0.00"');
    expect(visto.montoEsperado).toBeNull();
    expect(visto.diferencia).toBeNull();
  });

  it('un PIN equivocado en el diálogo sigue sin traer el esperado, y conserva su propio mensaje', () => {
    const pinMalo: ResultadoDeCierreIpc = {
      ...PIDE_AUTORIZACION,
      codigo: 'PIN_INCORRECTO',
      mensaje: 'PIN incorrecto.',
    };
    const visto = resultadoDeCierreParaLaVentana(pinMalo, CAJERA);

    expect(visto.montoEsperado).toBeNull();
    expect(visto.diferencia).toBeNull();
    expect(visto.mensaje).toBe('PIN incorrecto.');
  });

  it('sin sesión, igual que una cajera', () => {
    expect(resultadoDeCierreParaLaVentana(PIDE_AUTORIZACION, null).montoEsperado).toBeNull();
  });
});

describe('A un ADMINISTRATIVO le llega entero: es quien autoriza y tiene que ver qué aprueba', () => {
  it.each([
    ['diferencia', PIDE_AUTORIZACION],
    ['reconteo', PIDE_RECONTEO],
  ])('%s: el resultado no cambia', (_caso, resultado) => {
    expect(resultadoDeCierreParaLaVentana(resultado, ADMINISTRADOR)).toEqual(resultado);
  });
});

describe('Una autorización VALIDADA por PIN de administrador viaja entera, aunque la sesión sea de la cajera', () => {
  it('AUTORIZACION_VALIDADA conserva esperado y diferencia para la cajera', () => {
    const validada: ResultadoDeCierreIpc = {
      ...PIDE_AUTORIZACION,
      codigo: 'AUTORIZACION_VALIDADA',
      mensaje: 'Jimmy autorizó en persona. Revisá el monto y confirmá el cierre.',
      autorizadaVia: 'presencial',
    };
    expect(resultadoDeCierreParaLaVentana(validada, CAJERA)).toEqual(validada);
  });
});

describe('Una caja YA CERRADA viaja entera a cualquier rol: la confirmación muestra el teórico', () => {
  it('la cajera recibe esperado y diferencia en la confirmación', () => {
    const cerrada: ResultadoDeCierreIpc = {
      ...PIDE_AUTORIZACION,
      cerrada: true,
      codigo: 'CIERRE_CORRECTO',
      mensaje: 'Caja cerrada.',
    };
    expect(resultadoDeCierreParaLaVentana(cerrada, CAJERA)).toEqual(cerrada);
  });
});

describe('El canal de cierre no devuelve nada sin pasar por el filtro', () => {
  const inicio = REGISTRO.indexOf('CANALES_IPC.cerrarCaja,');
  const bloque = REGISTRO.slice(inicio, REGISTRO.indexOf('CANALES_IPC.cancelarAutorizacionDeCierre,'));

  it('el manejador IPC solo delega en el flujo: no arma ningún resultado por su cuenta', () => {
    expect(inicio).toBeGreaterThan(0);
    expect(bloque).toContain('flujoDeCierre.confirmarAutorizacion(datos.efectivo, enSesion)');
    expect(bloque).toContain('flujoDeCierre.intentar(datos, enSesion)');
    expect(bloque).not.toContain('intentarCerrar');
    expect(bloque).not.toContain('montoEsperado');
  });

  it('en el flujo, cada `return` de los dos métodos públicos pasa por `resultadoDeCierreParaLaVentana`', () => {
    const publico = FLUJO.slice(
      FLUJO.indexOf('  public intentar('),
      FLUJO.indexOf('  public cancelarAutorizacion('),
    );
    const returns = publico.match(/\breturn\b[^;]*/g) ?? [];
    expect(returns.length).toBeGreaterThan(2);
    for (const sentencia of returns) {
      expect(sentencia).toMatch(/^return resultadoDeCierreParaLaVentana\(/);
    }
  });
});
