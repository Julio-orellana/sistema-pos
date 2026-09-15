/**
 * EL CIERRE AUTORIZADO TIENE DOS PASOS: el PIN revela, la confirmación cierra.
 *
 * Contra una base SQLite real, con `ServicioDeCaja` y `ServicioDeAutenticacion`
 * reales. Cada prueba mira la TABLA `caja_sesiones`, no solo lo que devuelve el
 * flujo: «no se cerró» se afirma leyendo el estado del turno.
 *
 * El turno lo abre la cajera con Q500.00 y vende Q10.00 en efectivo: el
 * esperado es Q510.00, distinto del inicial —que viaja siempre— para que
 * buscarlo en una respuesta signifique algo. Cuenta Q480.00 (faltante Q30.00).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import Decimal from 'decimal.js';

import { generarHashDePin } from '@shared/auth';
import type { EfectivoDeclaradoIpc } from '@shared/types/ipc';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import type { UsuarioEnSesion } from '@main/domain/usuarios/sesion';
import {
  CODIGO_AUTORIZACION_NO_VIGENTE,
  CODIGO_AUTORIZACION_VALIDADA,
  FlujoDeCierreDeCaja,
  VIDA_DE_LA_AUTORIZACION_PENDIENTE_MS,
  firmaDelEfectivo,
} from '../cierre-de-caja';

const PIN_DE_JIMMY = '2468';
const PIN_REMOTO_DE_JIMMY = '9753';
const PIN_DE_LA_CAJERA = '1357';
const PIN_EQUIVOCADO = '1111';

const CONTEO_DE_MENOS: EfectivoDeclaradoIpc = { modo: 'simple', monto: '480.00' };

let base: Database;
let repos: Repositorios;
let caja: ServicioDeCaja;
let flujo: FlujoDeCierreDeCaja;
let limpiar: () => void;
let reloj: number;
let jimmy: UsuarioEnSesion;
let cajera: UsuarioEnSesion;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  reloj = Date.parse('2026-09-15T12:00:00.000Z');

  caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  const autenticacion = new ServicioDeAutenticacion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
  });
  flujo = new FlujoDeCierreDeCaja({ caja, autenticacion, ahora: (): number => reloj });

  const idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin(PIN_DE_JIMMY),
  }).id;
  repos.usuarios.actualizarPinRemotoHash(idJimmy, generarHashDePin(PIN_REMOTO_DE_JIMMY));
  const idCajera = repos.usuarios.crear({
    nombre: 'Cajera',
    rol: 'venta',
    pinHash: generarHashDePin(PIN_DE_LA_CAJERA),
  }).id;

  jimmy = { id: idJimmy, nombre: 'Jimmy', rol: 'administrativo', desde: '2026-09-15T12:00:00.000Z' };
  cajera = { id: idCajera, nombre: 'Cajera', rol: 'venta', desde: '2026-09-15T12:00:00.000Z' };

  caja.abrir(idCajera, { modo: 'simple', monto: '500.00' });
  venderEnEfectivo('22222222-2222-4222-8222-222222222222');
});

/** Una venta en efectivo de Q10.00 en el turno abierto, directo en la tabla. */
function venderEnEfectivo(id: string): void {
  const turno = caja.sesionAbierta();
  const momento = new Date(reloj).toISOString();
  base
    .prepare(
      `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total, forma_pago,
                           estado, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, '10.00', '10.00', 'efectivo', 'completada', ?, ?)`,
    )
    .run(id, turno?.id, cajera.id, momento, momento, momento);
}

afterEach(() => {
  limpiar();
});

/** El estado del turno, leído de la tabla. */
function estadoDelTurno(): { estado: string; via: string | null; por: string | null } {
  const fila = base
    .prepare(
      'SELECT estado, diferencia_autorizada_via AS via, diferencia_autorizada_por AS por FROM caja_sesiones',
    )
    .get() as { estado: string; via: string | null; por: string | null };
  return fila;
}

// ===========================================================================
describe('UN PIN CORRECTO NO CIERRA LA CAJA: revela el monto y espera', () => {
  it('con el PIN normal: devuelve AUTORIZACION_VALIDADA con el esperado y la diferencia, y la caja SIGUE ABIERTA', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS }, cajera);
    const revelado = flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);

    expect(revelado.cerrada).toBe(false);
    expect(revelado.codigo).toBe(CODIGO_AUTORIZACION_VALIDADA);
    expect(revelado.montoEsperado).toBe('510.00');
    expect(revelado.diferencia).toBe('-30.00');
    expect(revelado.autorizadaVia).toBe('presencial');
    expect(revelado.mensaje).toContain('Jimmy');
    expect(estadoDelTurno().estado).toBe('abierta');
    expect(flujo.hayAutorizacionPendiente()).toBe(true);
  });

  it('con el PIN REMOTO: lo mismo, registrado como remoto, y la caja sigue abierta', () => {
    const revelado = flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_REMOTO_DE_JIMMY }, cajera);

    expect(revelado.codigo).toBe(CODIGO_AUTORIZACION_VALIDADA);
    expect(revelado.autorizadaVia).toBe('remoto');
    expect(revelado.montoEsperado).toBe('510.00');
    expect(revelado.mensaje).toContain('por teléfono');
    expect(estadoDelTurno().estado).toBe('abierta');
  });

  it('LA SEGUNDA CONFIRMACIÓN cierra, con el autorizante y la vía del PIN que se validó', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_REMOTO_DE_JIMMY }, cajera);
    const cerrado = flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera);

    expect(cerrado.cerrada).toBe(true);
    expect(estadoDelTurno()).toEqual({ estado: 'cerrada', via: 'remoto', por: jimmy.id });
    expect(flujo.hayAutorizacionPendiente()).toBe(false);
  });
});

describe('UN PIN INCORRECTO NUNCA LLEGA A MOSTRAR NINGÚN MONTO', () => {
  it('a la cajera: no revela el esperado ni la diferencia, no deja autorización pendiente y la caja sigue abierta', () => {
    const rechazado = flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_EQUIVOCADO }, cajera);
    const serializado = JSON.stringify(rechazado);

    expect(rechazado.codigo).not.toBe(CODIGO_AUTORIZACION_VALIDADA);
    expect(rechazado.montoEsperado).toBeNull();
    expect(rechazado.diferencia).toBeNull();
    // Control: lo contado sí viaja, así que el buscador funciona.
    expect(serializado).toContain('480.00');
    expect(serializado).not.toContain('510.00');
    expect(serializado).not.toContain('30.00');
    expect(flujo.hayAutorizacionPendiente()).toBe(false);
    expect(estadoDelTurno().estado).toBe('abierta');
  });

  it('y confirmar después de un PIN incorrecto no cierra: no hay nada que confirmar', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_EQUIVOCADO }, cajera);
    const confirmacion = flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera);

    expect(confirmacion.cerrada).toBe(false);
    expect(confirmacion.codigo).toBe(CODIGO_AUTORIZACION_NO_VIGENTE);
    expect(confirmacion.montoEsperado).toBeNull();
    expect(estadoDelTurno().estado).toBe('abierta');
  });

  it('el PIN de la CAJERA no es de administrador: tampoco revela nada', () => {
    const rechazado = flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_LA_CAJERA }, cajera);
    expect(rechazado.montoEsperado).toBeNull();
    expect(flujo.hayAutorizacionPendiente()).toBe(false);
  });
});

describe('CANCELAR retira la autorización EN EL PROCESO PRINCIPAL, no solo en la pantalla', () => {
  it('después de cancelar, confirmar desde la consola no cierra', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    flujo.cancelarAutorizacion();
    const confirmacion = flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera);

    expect(confirmacion.cerrada).toBe(false);
    expect(confirmacion.codigo).toBe(CODIGO_AUTORIZACION_NO_VIGENTE);
    expect(estadoDelTurno().estado).toBe('abierta');
  });
});

describe('La autorización pendiente vale para ESE cierre y nada más', () => {
  it('vence a los dos minutos', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    reloj += VIDA_DE_LA_AUTORIZACION_PENDIENTE_MS + 1;

    expect(flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera).codigo).toBe(
      CODIGO_AUTORIZACION_NO_VIGENTE,
    );
    expect(estadoDelTurno().estado).toBe('abierta');
  });

  it('justo al límite todavía vale', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    reloj += VIDA_DE_LA_AUTORIZACION_PENDIENTE_MS;
    expect(flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera).cerrada).toBe(true);
  });

  it('un conteo DISTINTO en la confirmación no cierra, y además consume la autorización', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    const otro = flujo.confirmarAutorizacion({ modo: 'simple', monto: '470.00' }, cajera);
    expect(otro.cerrada).toBe(false);
    expect(otro.codigo).toBe(CODIGO_AUTORIZACION_NO_VIGENTE);

    // Un solo uso: aunque ahora mande el conteo correcto, ya no hay autorización.
    expect(flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera).cerrada).toBe(false);
    expect(estadoDelTurno().estado).toBe('abierta');
  });

  it('otra persona en sesión no puede confirmar lo que se autorizó en la sesión de la cajera', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    expect(flujo.confirmarAutorizacion(CONTEO_DE_MENOS, jimmy).cerrada).toBe(false);
    expect(estadoDelTurno().estado).toBe('abierta');
  });

  it('volver a intentar (otro conteo) descarta la autorización anterior', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    flujo.intentar({ efectivo: { modo: 'simple', monto: '490.00' } }, cajera);

    expect(flujo.hayAutorizacionPendiente()).toBe(false);
    expect(flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera).cerrada).toBe(false);
  });

  it('si entra una venta en efectivo entre la revelación y la confirmación, lo autorizado ya no es lo que se cierra', () => {
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    venderEnEfectivo('11111111-1111-4111-8111-111111111111');

    const confirmacion = flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera);
    expect(confirmacion.cerrada).toBe(false);
    expect(confirmacion.mensaje).toContain('El monto cambió');
    expect(estadoDelTurno().estado).toBe('abierta');
  });
});

// ===========================================================================
/**
 * EL DEFECTO QUE BLOQUEÓ A JIMMY EL 2026-09-15, fijado para que no vuelva.
 *
 * En `v1.0.0-prueba.1`, cerrar la caja que abrió OTRA persona devolvía el
 * resultado del servicio con la `sesion` de dominio adentro, y sus montos son
 * objetos Decimal: decimal.js les pone `constructor` como propiedad PROPIA, una
 * función, y el puente IPC de Electron no clona funciones. El manejador lanzaba
 * «An object could not be cloned», la ventana nunca recibía respuesta y el
 * botón quedaba deshabilitado sin decir nada. Ninguna prueba lo veía porque
 * llamaban al flujo directo, sin cruzar el puente. Esta pasa cada respuesta por
 * `structuredClone`, que rechaza lo mismo.
 */
describe('TODA respuesta del cierre cruza el puente IPC (se puede clonar)', () => {
  const cruzaElPuente = (resultado: unknown): unknown => structuredClone(resultado);

  it('control del detector: un Decimal suelto NO se puede clonar, que es el caso que rompió', () => {
    expect(() => cruzaElPuente({ montoInicial: new Decimal('100') })).toThrow();
  });

  it('CAJA AJENA: el pedido de PIN, un PIN equivocado y el cierre con PIN, los tres se clonan', () => {
    const exacto: EfectivoDeclaradoIpc = { modo: 'simple', monto: '510.00' };
    const pedido = flujo.intentar({ efectivo: exacto }, jimmy);
    expect(pedido.codigo).toBe('REQUIERE_AUTORIZACION_DE_CAJA_AJENA');
    expect(cruzaElPuente(pedido)).toEqual(pedido);

    const equivocado = flujo.intentar({ efectivo: exacto, pinCajaAjena: PIN_EQUIVOCADO }, jimmy);
    expect(equivocado.cerrada).toBe(false);
    expect(cruzaElPuente(equivocado)).toEqual(equivocado);

    const cerrado = flujo.intentar({ efectivo: exacto, pinCajaAjena: PIN_DE_JIMMY }, jimmy);
    expect(cerrado.cerrada).toBe(true);
    expect(cruzaElPuente(cerrado)).toEqual(cerrado);
    expect(estadoDelTurno().estado).toBe('cerrada');
  });

  it('CIERRE PROPIO con diferencia: el pedido, la revelación, la confirmación y el «ya no vigente» se clonan', () => {
    const pedido = flujo.intentar({ efectivo: CONTEO_DE_MENOS }, cajera);
    const revelado = flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    flujo.cancelarAutorizacion();
    const noVigente = flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera);
    flujo.intentar({ efectivo: CONTEO_DE_MENOS, pin: PIN_DE_JIMMY }, cajera);
    const confirmado = flujo.confirmarAutorizacion(CONTEO_DE_MENOS, cajera);
    expect(confirmado.cerrada).toBe(true);
    expect(noVigente.codigo).toBe(CODIGO_AUTORIZACION_NO_VIGENTE);
    for (const resultado of [pedido, revelado, confirmado, noVigente]) {
      expect(cruzaElPuente(resultado)).toEqual(resultado);
    }
  });
});

describe('La firma del conteo', () => {
  it('el mismo desglose en otro orden es el mismo conteo; las piezas en cero no cuentan', () => {
    expect(
      firmaDelEfectivo({
        modo: 'detallado',
        lineas: [
          { denominacionId: 'b', cantidad: 2 },
          { denominacionId: 'a', cantidad: 1 },
          { denominacionId: 'c', cantidad: 0 },
        ],
      }),
    ).toBe(
      firmaDelEfectivo({
        modo: 'detallado',
        lineas: [
          { denominacionId: 'a', cantidad: 1 },
          { denominacionId: 'b', cantidad: 2 },
        ],
      }),
    );
  });

  it('un monto distinto da otra firma', () => {
    expect(firmaDelEfectivo({ modo: 'simple', monto: '480.00' })).not.toBe(
      firmaDelEfectivo({ modo: 'simple', monto: '480.01' }),
    );
  });
});
