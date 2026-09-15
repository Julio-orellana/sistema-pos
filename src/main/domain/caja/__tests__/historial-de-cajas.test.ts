/**
 * El historial de cajas, sobre SQLite real y con el servicio de caja real
 * (§4.44).
 *
 * Las sesiones NO se siembran a mano en la tabla: se abren y se cierran con
 * `ServicioDeCaja`, en días distintos de Guatemala, para que el historial lea
 * exactamente lo que un cierre de verdad deja escrito, bitácora incluida. Los
 * cuatro casos que pide la tarea son sesiones distintas:
 *
 *   A. 10/09 — Ana abre 500, cuenta 480 (se sella) y Jimmy autoriza la
 *      diferencia por teléfono. Cierra con diferencia autorizada.
 *   B. 11/09 — Ana abre y cierra contando por denominación, exacto. Sin diferencia.
 *   C. 12/09 a las 23:30 de Guatemala (ya es 13/09 en UTC) — Rosa abre, Jimmy
 *      la cierra con su PIN de caja ajena. Cerrada por otra persona.
 *   D. 13/09 — Ana abre 500, cuenta 480 (se sella), corrige a 500 y Jimmy
 *      autoriza la corrección en persona. Recuento sellado corregido.
 *   E. 14/09 — Rosa abre 200, cuenta 150 (se sella) y no cierra. Sigue abierta.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { montoACadena } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeCaja, type EfectivoDeclarado } from '../servicio-de-caja';
import type { SesionDeCajaEnHistorialIpc } from '@shared/types/ipc';
import { ServicioDeHistorialDeCajas } from '../historial-de-cajas';

let base: Database;
let repos: Repositorios;
let caja: ServicioDeCaja;
let historial: ServicioDeHistorialDeCajas;
let limpiar: () => void;
let jimmy: string;
let ana: string;
let rosa: string;
const ids = { a: '', b: '', c: '', d: '', e: '' };

const simple = (monto: string): EfectivoDeclarado => ({ modo: 'simple', monto });

function denominacion(valor: string): string {
  const encontrada = repos.denominaciones.listarActivas().find((d) => montoACadena(d.valor) === valor);
  if (encontrada === undefined) {
    throw new Error(`No existe la denominación Q${valor}`);
  }
  return encontrada.id;
}

/** Pone el reloj en un instante UTC. */
function relojEn(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

const TODO: { desde: null; hasta: null; abiertaPor: null } = { desde: null, hasta: null, abiertaPor: null };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  historial = new ServicioDeHistorialDeCajas({
    cajaSesiones: repos.cajaSesiones,
    auditoria: repos.auditoria,
    usuarios: repos.usuarios,
    desglose: repos.desgloseDeCaja,
    denominaciones: repos.denominaciones,
  });

  jimmy = repos.usuarios.crear({ nombre: 'Jimmy', rol: 'administrativo', pinHash: generarHashDePin('2468') }).id;
  ana = repos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pinHash: generarHashDePin('1357') }).id;
  rosa = repos.usuarios.crear({ nombre: 'Rosa', rol: 'venta', pinHash: generarHashDePin('8642') }).id;

  // A — 10/09, 10:00 de Guatemala.
  relojEn('2026-09-10T16:00:00.000Z');
  ids.a = caja.abrir(ana, simple('500')).id;
  relojEn('2026-09-10T23:00:00.000Z');
  expect(caja.intentarCerrar(ids.a, simple('480'), { usuarioQueCierra: ana }).codigo).toBe('REQUIERE_AUTORIZACION');
  expect(
    caja.intentarCerrar(ids.a, simple('480'), { usuarioQueCierra: ana, autorizacion: { autorizadaPor: jimmy, via: 'remoto' } })
      .cerrada,
  ).toBe(true);

  // B — 11/09, por denominación y exacto.
  relojEn('2026-09-11T16:00:00.000Z');
  const quinientos: EfectivoDeclarado = {
    modo: 'detallado',
    lineas: [
      { denominacionId: denominacion('200.00'), cantidad: 2 },
      { denominacionId: denominacion('100.00'), cantidad: 1 },
    ],
  };
  ids.b = caja.abrir(ana, quinientos).id;
  relojEn('2026-09-11T23:00:00.000Z');
  expect(caja.intentarCerrar(ids.b, quinientos, { usuarioQueCierra: ana }).cerrada).toBe(true);

  // C — 12/09 a las 23:30 de Guatemala = 13/09 05:30 UTC. Rosa abre, Jimmy cierra.
  relojEn('2026-09-13T05:30:00.000Z');
  ids.c = caja.abrir(rosa, simple('300')).id;
  relojEn('2026-09-13T05:45:00.000Z');
  expect(caja.intentarCerrar(ids.c, simple('300'), { usuarioQueCierra: jimmy }).codigo).toBe(
    'REQUIERE_AUTORIZACION_DE_CAJA_AJENA',
  );
  expect(
    caja.intentarCerrar(ids.c, simple('300'), { usuarioQueCierra: jimmy, autorizacionDeCajaAjena: { autorizadaPor: jimmy } })
      .cerrada,
  ).toBe(true);

  // D — 13/09, recuento sellado corregido.
  relojEn('2026-09-13T16:00:00.000Z');
  ids.d = caja.abrir(ana, simple('500')).id;
  relojEn('2026-09-13T23:00:00.000Z');
  expect(caja.intentarCerrar(ids.d, simple('480'), { usuarioQueCierra: ana }).codigo).toBe('REQUIERE_AUTORIZACION');
  relojEn('2026-09-13T23:02:00.000Z');
  expect(caja.intentarCerrar(ids.d, simple('500'), { usuarioQueCierra: ana }).codigo).toBe(
    'REQUIERE_AUTORIZACION_DE_RECONTEO',
  );
  expect(
    caja.intentarCerrar(ids.d, simple('500'), {
      usuarioQueCierra: ana,
      autorizacion: { autorizadaPor: jimmy, via: 'presencial' },
    }).cerrada,
  ).toBe(true);

  // E — 14/09, abierta con un conteo sellado pendiente.
  relojEn('2026-09-14T16:00:00.000Z');
  ids.e = caja.abrir(rosa, simple('200')).id;
  relojEn('2026-09-14T17:00:00.000Z');
  expect(caja.intentarCerrar(ids.e, simple('150'), { usuarioQueCierra: rosa }).codigo).toBe('REQUIERE_AUTORIZACION');

  relojEn('2026-09-15T12:00:00.000Z');
});

afterEach(() => {
  vi.useRealTimers();
  limpiar();
});

function fila(id: string): SesionDeCajaEnHistorialIpc {
  const encontrada = historial.listar(TODO).sesiones.find((s) => s.id === id);
  if (encontrada === undefined) {
    throw new Error(`La sesión ${id} no está en el historial.`);
  }
  return encontrada;
}

function codigoDe(accion: () => unknown): string | null {
  try {
    accion();
    return null;
  } catch (error) {
    return error instanceof ErrorDeNegocio ? error.codigo : `no es de negocio: ${String(error)}`;
  }
}

// ===========================================================================
describe('La lista trae TODAS las sesiones, de la apertura más reciente a la más vieja', () => {
  it('abiertas y cerradas, en orden descendente por apertura', () => {
    expect(historial.listar(TODO).sesiones.map((s) => s.id)).toEqual([ids.e, ids.d, ids.c, ids.b, ids.a]);
  });

  it('cada fila dice quién abrió, cuándo y con cuánto', () => {
    const c = fila(ids.c);
    expect(c.abiertaPor).toEqual({ id: rosa, nombre: 'Rosa' });
    expect(c.abiertaEn).toBe('2026-09-13T05:30:00.000Z');
    expect(c.montoInicial).toBe('300.00');
  });

  it('para el filtro, las personas que alguna vez abrieron caja, en orden alfabético (Jimmy nunca abrió)', () => {
    expect(historial.listar(TODO).personasQueAbrieron).toEqual([
      { id: ana, nombre: 'Ana' },
      { id: rosa, nombre: 'Rosa' },
    ]);
  });
});

// ===========================================================================
describe('Los cuatro casos de cierre se ven distintos', () => {
  it('A · CON DIFERENCIA AUTORIZADA: teórico, real, faltante, y quién autorizó por qué vía', () => {
    const a = fila(ids.a);
    expect(a.estado).toBe('cerrada');
    expect(a.cierre).toMatchObject({
      cerradaPor: { id: ana, nombre: 'Ana' },
      cerradaPorOtraPersona: false,
      cierreAjenoAutorizadoPor: null,
      montoTeorico: '500.00',
      montoReal: '480.00',
      diferencia: '-20.00',
      tipoDeDiferencia: 'faltante',
      diferenciaAutorizada: { por: { id: jimmy, nombre: 'Jimmy' }, via: 'remoto' },
    });
    // Se selló el conteo, pero se cerró con ESE número: no hubo corrección.
    expect(a.cantidadDeConteosSellados).toBe(1);
    expect(a.reconteo).toBeNull();
  });

  it('B · SIN DIFERENCIA: cuadra y no hay autorizante', () => {
    const b = fila(ids.b);
    expect(b.cierre).toMatchObject({
      cerradaPorOtraPersona: false,
      montoTeorico: '500.00',
      montoReal: '500.00',
      diferencia: '0.00',
      tipoDeDiferencia: 'cuadra',
      diferenciaAutorizada: null,
    });
    expect(b.cantidadDeConteosSellados).toBe(0);
    expect(b.reconteo).toBeNull();
  });

  it('C · CERRADA POR OTRA PERSONA: abrió Rosa, cerró Jimmy, y quién autorizó el cierre ajeno', () => {
    const c = fila(ids.c);
    expect(c.abiertaPor.nombre).toBe('Rosa');
    expect(c.cierre).toMatchObject({
      cerradaPor: { id: jimmy, nombre: 'Jimmy' },
      cerradaPorOtraPersona: true,
      cierreAjenoAutorizadoPor: { id: jimmy, nombre: 'Jimmy' },
      tipoDeDiferencia: 'cuadra',
    });
  });

  it('D · RECUENTO SELLADO CORREGIDO: el primer conteo, el final, y quién autorizó la corrección', () => {
    const d = fila(ids.d);
    expect(d.cierre).toMatchObject({ montoReal: '500.00', diferencia: '0.00', tipoDeDiferencia: 'cuadra' });
    // Cuadra al final, así que caja_sesiones NO guarda autorizante (CHECK de la 008)…
    expect(d.cierre?.diferenciaAutorizada).toBeNull();
    // …y la corrección se lee del asiento, con los dos lados.
    expect(d.cantidadDeConteosSellados).toBe(1);
    expect(d.reconteo).toEqual({
      fecha: '2026-09-13T23:02:00.000Z',
      conteosSellados: [
        { fecha: '2026-09-13T23:00:00.000Z', montoEsperado: '500.00', montoReal: '480.00', diferencia: '-20.00' },
      ],
      conteoFinal: { montoEsperado: '500.00', montoReal: '500.00', diferencia: '0.00' },
      autorizadoPor: { id: jimmy, nombre: 'Jimmy' },
      via: 'presencial',
    });
  });

  it('E · ABIERTA: sin cierre, y con su conteo sellado pendiente a la vista', () => {
    const e = fila(ids.e);
    expect(e.estado).toBe('abierta');
    expect(e.cierre).toBeNull();
    expect(e.cantidadDeConteosSellados).toBe(1);
    expect(e.reconteo).toBeNull();
  });

  it('ningún caso trae avisos: toda la bitácora se leyó', () => {
    expect(historial.listar(TODO).sesiones.flatMap((s) => s.avisos)).toEqual([]);
  });

  it('el historial NO recalcula el corte: el teórico es el que quedó guardado aunque cambie después', () => {
    base.prepare("UPDATE caja_sesiones SET monto_esperado = '999.00', diferencia = '-519.00' WHERE id = ?").run(ids.a);
    expect(fila(ids.a).cierre).toMatchObject({ montoTeorico: '999.00', diferencia: '-519.00' });
  });
});

// ===========================================================================
describe('Filtros sobre los datos reales', () => {
  it('por rango de días de APERTURA, inclusive en los dos extremos', () => {
    const resultado = historial.listar({ desde: '2026-09-11', hasta: '2026-09-12', abiertaPor: null });
    expect(resultado.sesiones.map((s) => s.id)).toEqual([ids.c, ids.b]);
    expect(resultado.periodo).toMatchObject({ desdeDia: '2026-09-11', hastaDia: '2026-09-12' });
  });

  it('el día es el de GUATEMALA: C abrió el 13/09 en UTC pero el 12/09 a las 23:30 de la tienda', () => {
    expect(historial.listar({ desde: '2026-09-12', hasta: '2026-09-12', abiertaPor: null }).sesiones.map((s) => s.id)).toEqual([
      ids.c,
    ]);
    expect(historial.listar({ desde: '2026-09-13', hasta: '2026-09-13', abiertaPor: null }).sesiones.map((s) => s.id)).toEqual([
      ids.d,
    ]);
  });

  it('por quién abrió', () => {
    expect(historial.listar({ desde: null, hasta: null, abiertaPor: rosa }).sesiones.map((s) => s.id)).toEqual([ids.e, ids.c]);
    expect(historial.listar({ desde: null, hasta: null, abiertaPor: ana }).sesiones.map((s) => s.id)).toEqual([
      ids.d,
      ids.b,
      ids.a,
    ]);
  });

  it('los dos filtros juntos', () => {
    expect(historial.listar({ desde: '2026-09-10', hasta: '2026-09-12', abiertaPor: rosa }).sesiones.map((s) => s.id)).toEqual([
      ids.c,
    ]);
  });

  it('filtrar por quien cerró NO cuenta: Jimmy cerró C pero no abrió ninguna', () => {
    expect(historial.listar({ desde: null, hasta: null, abiertaPor: jimmy }).sesiones).toEqual([]);
  });

  it('un rango sin sesiones devuelve una lista vacía, no un error', () => {
    expect(historial.listar({ desde: '2026-01-01', hasta: '2026-01-31', abiertaPor: null }).sesiones).toEqual([]);
  });

  it('sin fechas no hay período: se ven todas', () => {
    expect(historial.listar(TODO).periodo).toBeNull();
  });

  it('una sola fecha, una fecha inexistente o un rango al revés se rechazan con DATO_INVALIDO', () => {
    expect(codigoDe(() => historial.listar({ desde: '2026-09-11', hasta: null, abiertaPor: null }))).toBe('DATO_INVALIDO');
    expect(codigoDe(() => historial.listar({ desde: '2026-02-31', hasta: '2026-03-01', abiertaPor: null }))).toBe(
      'DATO_INVALIDO',
    );
    expect(codigoDe(() => historial.listar({ desde: '2026-09-12', hasta: '2026-09-11', abiertaPor: null }))).toBe(
      'DATO_INVALIDO',
    );
  });
});

// ===========================================================================
describe('El detalle de una sesión', () => {
  it('B · con el desglose de apertura y de cierre, subtotales y total', () => {
    const detalle = historial.detalle(ids.b);
    const esperado = {
      lineas: [
        { valor: '100.00', tipo: 'billete', cantidad: 1, subtotal: '100.00' },
        { valor: '200.00', tipo: 'billete', cantidad: 2, subtotal: '400.00' },
      ],
      total: '500.00',
    };
    expect(detalle.desgloseDeApertura).toEqual(esperado);
    expect(detalle.desgloseDeCierre).toEqual(esperado);
  });

  it('A · contada en modo simple: sin desglose, y con su conteo sellado', () => {
    const detalle = historial.detalle(ids.a);
    expect(detalle.desgloseDeApertura).toBeNull();
    expect(detalle.desgloseDeCierre).toBeNull();
    expect(detalle.conteosSellados).toEqual([
      { fecha: '2026-09-10T23:00:00.000Z', montoEsperado: '500.00', montoReal: '480.00', diferencia: '-20.00' },
    ]);
  });

  it('E · abierta: el conteo sellado pendiente se ve aunque todavía no haya cierre', () => {
    const detalle = historial.detalle(ids.e);
    expect(detalle.sesion.cierre).toBeNull();
    expect(detalle.conteosSellados.map((c) => c.montoReal)).toEqual(['150.00']);
  });

  it('una sesión que no existe se rechaza con REFERENCIA_INEXISTENTE', () => {
    expect(codigoDe(() => historial.detalle('00000000-0000-4000-8000-000000000000'))).toBe('REFERENCIA_INEXISTENTE');
  });
});

// ===========================================================================
describe('Lo que no se puede leer se AVISA, no se esconde', () => {
  it('un asiento de reconteo ilegible deja un aviso en la fila en vez de desaparecer', () => {
    repos.auditoria.registrar({
      usuarioId: jimmy,
      accion: 'reconteo_de_cierre_autorizado',
      entidadTipo: 'caja_sesiones',
      entidadId: ids.b,
      valorNuevo: { algo: 'que no es un reconteo' },
    });
    const b = fila(ids.b);
    expect(b.reconteo).toBeNull();
    expect(b.avisos).toEqual(['Hay una corrección de conteo autorizada en la bitácora que no se pudo leer.']);
  });

  it('un usuario que ya no existe se muestra como desconocido, no rompe la lista', () => {
    base.pragma('foreign_keys = OFF');
    base.prepare("UPDATE caja_sesiones SET usuario_id = '00000000-0000-4000-8000-00000000abcd' WHERE id = ?").run(ids.b);
    base.pragma('foreign_keys = ON');
    expect(fila(ids.b).abiertaPor.nombre).toBe('(usuario desconocido)');
  });
});

// ===========================================================================
describe('Todo lo que devuelve cruza el puente IPC', () => {
  it('la lista y los cinco detalles pasan structuredClone sin perder nada', () => {
    const respuestas: unknown[] = [historial.listar(TODO), ...Object.values(ids).map((id) => historial.detalle(id))];
    for (const respuesta of respuestas) {
      expect(structuredClone(respuesta)).toEqual(respuesta);
    }
  });
});
