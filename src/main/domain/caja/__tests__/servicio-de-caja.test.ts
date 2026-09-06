/**
 * Pruebas del módulo de caja.
 *
 * El corte de caja es lo que Jimmy revisa todos los días: si estas cuentas
 * fallan, el descuadre aparece en su bolsillo. Se prueban contra bases SQLite
 * reales, con las denominaciones sembradas por la migración 004.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { aCadena, montoACadena } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { ServicioDeCaja, type EfectivoDeclarado } from '../servicio-de-caja';

const PIN_DE_JIMMY = '2468';
const PIN_REMOTO_DE_JIMMY = '9753';
const PIN_DE_LA_CAJERA = '1357';

let base: Database;
let repos: Repositorios;
let caja: ServicioDeCaja;
let autenticacion: ServicioDeAutenticacion;
let limpiar: () => void;
let idJimmy: string;
let idCajera: string;

/** Denominación por su valor facial, para escribir pruebas legibles. */
function denominacion(valor: string): string {
  const encontrada = repos.denominaciones
    .listarActivas()
    .find((d) => montoACadena(d.valor) === valor);
  if (encontrada === undefined) {
    throw new Error(`No existe la denominación Q${valor}`);
  }
  return encontrada.id;
}

/** Arma un desglose a partir de pares "valor: cantidad". */
function desglose(conteo: Record<string, number>): EfectivoDeclarado {
  return {
    modo: 'detallado',
    lineas: Object.entries(conteo).map(([valor, cantidad]) => ({
      denominacionId: denominacion(valor),
      cantidad,
    })),
  };
}

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  caja = new ServicioDeCaja({
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    auditoria: repos.auditoria,
  });
  autenticacion = new ServicioDeAutenticacion({
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin(PIN_DE_JIMMY),
  }).id;
  repos.usuarios.actualizarPinRemotoHash(idJimmy, generarHashDePin(PIN_REMOTO_DE_JIMMY));

  idCajera = repos.usuarios.crear({
    nombre: 'Cajera',
    rol: 'venta',
    pinHash: generarHashDePin(PIN_DE_LA_CAJERA),
  }).id;
});

afterEach(() => {
  limpiar();
});

/** Acciones registradas en la bitácora. */
function accionesDeAuditoria(): string[] {
  return (
    base.prepare('SELECT accion FROM auditoria_log ORDER BY fecha, rowid').all() as {
      accion: string;
    }[]
  ).map((f) => f.accion);
}

// ===========================================================================
describe('Denominaciones del quetzal', () => {
  it('la migración siembra las once denominaciones reales de Guatemala', () => {
    const activas = repos.denominaciones.listarActivas();
    expect(activas.map((d) => montoACadena(d.valor))).toEqual([
      '0.05', '0.10', '0.25', '0.50', '1.00',
      '5.00', '10.00', '20.00', '50.00', '100.00', '200.00',
    ]);
  });

  it('las cinco primeras son monedas y las seis siguientes billetes', () => {
    const activas = repos.denominaciones.listarActivas();
    expect(activas.slice(0, 5).every((d) => d.tipo === 'moneda')).toBe(true);
    expect(activas.slice(5).every((d) => d.tipo === 'billete')).toBe(true);
  });
});

// ===========================================================================
describe('Modo detallado: el sistema suma, el cajero solo cuenta', () => {
  it('suma un fondo típico de apertura', () => {
    // 2 de Q100, 3 de Q20, 5 de Q5, 10 de Q1 = 200 + 60 + 25 + 10 = 295.00
    const total = caja.montoDeclarado(desglose({ '100.00': 2, '20.00': 3, '5.00': 5, '1.00': 10 }));
    expect(montoACadena(total)).toBe('295.00');
  });

  it('suma correctamente con TODAS las denominaciones a la vez', () => {
    // 1 de cada una: 0.05+0.10+0.25+0.50+1+5+10+20+50+100+200 = 386.90
    const total = caja.montoDeclarado(
      desglose({
        '0.05': 1, '0.10': 1, '0.25': 1, '0.50': 1, '1.00': 1,
        '5.00': 1, '10.00': 1, '20.00': 1, '50.00': 1, '100.00': 1, '200.00': 1,
      }),
    );
    expect(montoACadena(total)).toBe('386.90');
  });

  it('las monedas de cinco centavos suman exacto: 20 x Q0.05 = Q1.00, no Q0.99', () => {
    // Con punto flotante, 0.05 sumado 20 veces da 1.0000000000000002.
    expect(montoACadena(caja.montoDeclarado(desglose({ '0.05': 20 })))).toBe('1.00');
    expect(montoACadena(caja.montoDeclarado(desglose({ '0.05': 3 })))).toBe('0.15');
  });

  it('un conteo grande y feo cuadra al centavo', () => {
    // 137 de Q0.05, 89 de Q0.10, 41 de Q0.25, 17 de Q0.50
    // = 6.85 + 8.90 + 10.25 + 8.50 = 34.50
    const total = caja.montoDeclarado(desglose({ '0.05': 137, '0.10': 89, '0.25': 41, '0.50': 17 }));
    expect(montoACadena(total)).toBe('34.50');
  });

  it('contar cero piezas de una denominación es válido y no altera el total', () => {
    const total = caja.montoDeclarado(desglose({ '100.00': 1, '200.00': 0, '0.05': 0 }));
    expect(montoACadena(total)).toBe('100.00');
  });

  it('un desglose vacío da cero', () => {
    expect(aCadena(caja.montoDeclarado({ modo: 'detallado', lineas: [] }))).toBe('0');
  });

  it('rechaza una denominación que no existe', () => {
    expect(() =>
      caja.montoDeclarado({
        modo: 'detallado',
        lineas: [{ denominacionId: '00000000-0000-4000-8000-000000000000', cantidad: 1 }],
      }),
    ).toThrow(ErrorDeNegocio);
  });

  it('rechaza una cantidad negativa o fraccionaria', () => {
    expect(() => caja.montoDeclarado(desglose({ '100.00': -1 }))).toThrow(/entero y no negativa/);
    expect(() => caja.montoDeclarado(desglose({ '100.00': 1.5 }))).toThrow(/entero y no negativa/);
  });
});

// ===========================================================================
describe('Apertura de caja', () => {
  it('modo simple: se guarda el monto que escribió el cajero', () => {
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    expect(montoACadena(sesion.montoInicial)).toBe('500.00');
    expect(sesion.estado).toBe('abierta');
  });

  it('modo detallado: el monto inicial sale de la suma, y el desglose queda guardado', () => {
    const sesion = caja.abrir(idCajera, desglose({ '100.00': 2, '50.00': 1, '10.00': 5 }));

    expect(montoACadena(sesion.montoInicial)).toBe('300.00');
    const guardado = caja.desgloseDe(sesion.id, 'apertura');
    expect(guardado).toHaveLength(3);
    expect(guardado.reduce((suma, l) => suma + l.cantidad, 0)).toBe(8);
  });

  it('en modo simple NO se guarda desglose', () => {
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    expect(caja.desgloseDe(sesion.id, 'apertura')).toHaveLength(0);
  });

  it('UN CAJERO NO PUEDE ABRIR DOS SESIONES A LA VEZ', () => {
    caja.abrir(idCajera, { modo: 'simple', monto: '500' });

    try {
      caja.abrir(idCajera, { modo: 'simple', monto: '300' });
      expect.unreachable('Se esperaba que la segunda apertura fuera rechazada.');
    } catch (error) {
      // Se valida desde la aplicación, no solo con el índice único de la base,
      // para poder dar un mensaje que el cajero entienda.
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      expect((error as ErrorDeNegocio).codigo).toBe('CAJA_YA_ABIERTA');
      expect((error as ErrorDeNegocio).mensajeParaElUsuario).toContain('Cerralo antes de abrir otro');
    }
  });

  it('dos cajeros distintos SÍ pueden tener su propio turno abierto', () => {
    expect(() => caja.abrir(idCajera, { modo: 'simple', monto: '500' })).not.toThrow();
    expect(() => caja.abrir(idJimmy, { modo: 'simple', monto: '800' })).not.toThrow();
  });

  it('la apertura queda en auditoría con el monto y el modo usado', () => {
    caja.abrir(idCajera, desglose({ '100.00': 3 }));

    const asiento = base
      .prepare("SELECT usuario_id, valor_nuevo FROM auditoria_log WHERE accion = 'caja_abierta'")
      .get() as { usuario_id: string; valor_nuevo: string };

    expect(asiento.usuario_id).toBe(idCajera);
    expect(JSON.parse(asiento.valor_nuevo)).toEqual({ montoInicial: '300.00', modo: 'detallado' });
  });
});

// ===========================================================================
describe('Cierre de caja sin diferencia', () => {
  it('si la caja cuadra, cierra directo sin pedir nada', () => {
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    const resultado = caja.intentarCerrar(sesion.id, { modo: 'simple', monto: '500' });

    expect(resultado.cerrada).toBe(true);
    expect(resultado.codigo).toBe('CIERRE_CORRECTO');
    expect(resultado.diferencia).toBe('0.00');
    expect(resultado.sesion?.estado).toBe('cerrada');
    expect(resultado.sesion?.diferenciaAutorizadaPor).toBeNull();
    expect(resultado.sesion?.diferenciaAutorizadaVia).toBeNull();
  });

  it('cuadra también contando por denominaciones', () => {
    const sesion = caja.abrir(idCajera, desglose({ '100.00': 2, '50.00': 2 }));
    const resultado = caja.intentarCerrar(sesion.id, desglose({ '200.00': 1, '100.00': 1 }));

    expect(resultado.cerrada).toBe(true);
    expect(resultado.diferencia).toBe('0.00');
    expect(caja.desgloseDe(sesion.id, 'cierre')).toHaveLength(2);
  });
});

// ===========================================================================
describe('Cierre de caja CON diferencia: exige autorización', () => {
  /** Abre un turno de Q500 y devuelve su id. */
  function turnoDeQuinientos(): string {
    return caja.abrir(idCajera, { modo: 'simple', monto: '500' }).id;
  }

  it('con faltante NO cierra y explica qué falta autorizar', () => {
    const sesionId = turnoDeQuinientos();
    const resultado = caja.intentarCerrar(sesionId, { modo: 'simple', monto: '480' });

    expect(resultado.cerrada).toBe(false);
    expect(resultado.codigo).toBe('REQUIERE_AUTORIZACION');
    expect(resultado.diferencia).toBe('-20.00');
    expect(resultado.mensaje).toContain('FALTANTE');
    expect(resultado.mensaje).toContain('20.00');
    // Y la sesión sigue abierta.
    expect(repos.cajaSesiones.obtenerPorId(sesionId)?.estado).toBe('abierta');
  });

  it('con sobrante tampoco cierra, y lo dice como sobrante', () => {
    const resultado = caja.intentarCerrar(turnoDeQuinientos(), { modo: 'simple', monto: '515.50' });

    expect(resultado.cerrada).toBe(false);
    expect(resultado.diferencia).toBe('15.50');
    expect(resultado.mensaje).toContain('SOBRANTE');
  });

  it('con el PIN NORMAL de un administrador, cierra y registra vía PRESENCIAL', () => {
    const sesionId = turnoDeQuinientos();
    const autorizacion = autenticacion.autorizarComoAdministrador(
      PIN_DE_JIMMY,
      'cierre_con_diferencia',
      { aceptaPinRemoto: true },
    );

    expect(autorizacion.autenticado).toBe(true);
    expect(autorizacion.viaDeAutorizacion).toBe('presencial');

    const resultado = caja.intentarCerrar(
      sesionId,
      { modo: 'simple', monto: '480' },
      { autorizadaPor: idJimmy, via: 'presencial' },
    );

    expect(resultado.cerrada).toBe(true);
    expect(resultado.sesion?.diferenciaAutorizadaPor).toBe(idJimmy);
    expect(resultado.sesion?.diferenciaAutorizadaVia).toBe('presencial');
  });

  it('con el PIN REMOTO del mismo administrador, cierra y registra vía REMOTO', () => {
    const sesionId = turnoDeQuinientos();
    const autorizacion = autenticacion.autorizarComoAdministrador(
      PIN_REMOTO_DE_JIMMY,
      'cierre_con_diferencia',
      { aceptaPinRemoto: true },
    );

    expect(autorizacion.autenticado).toBe(true);
    expect(autorizacion.viaDeAutorizacion).toBe('remoto');
    expect(autorizacion.usuario?.id).toBe(idJimmy);

    const resultado = caja.intentarCerrar(
      sesionId,
      { modo: 'simple', monto: '480' },
      { autorizadaPor: idJimmy, via: 'remoto' },
    );

    expect(resultado.sesion?.diferenciaAutorizadaVia).toBe('remoto');
  });

  it('el PIN de un usuario de VENTA no autoriza, ni como normal ni como remoto', () => {
    const rechazo = autenticacion.autorizarComoAdministrador(
      PIN_DE_LA_CAJERA,
      'cierre_con_diferencia',
      { aceptaPinRemoto: true },
    );
    expect(rechazo.autenticado).toBe(false);
  });

  it('el cierre con diferencia queda en auditoría con quién autorizó y por cuál vía', () => {
    const sesionId = turnoDeQuinientos();
    caja.intentarCerrar(
      sesionId,
      { modo: 'simple', monto: '480' },
      { autorizadaPor: idJimmy, via: 'remoto' },
    );

    const asiento = base
      .prepare("SELECT valor_nuevo FROM auditoria_log WHERE accion = 'caja_cerrada'")
      .get() as { valor_nuevo: string };
    const datos = JSON.parse(asiento.valor_nuevo) as Record<string, unknown>;

    expect(datos.diferencia).toBe('-20.00');
    expect(datos.montoReal).toBe('480.00');
    expect(datos.autorizadaPor).toBe(idJimmy);
    expect(datos.autorizadaVia).toBe('remoto');
    expect(accionesDeAuditoria()).toContain('caja_cerrada');
  });

  it('la diferencia se calcula con Decimal: 500.10 - 500.05 da exactamente 0.05', () => {
    const sesionId = caja.abrir(idCajera, { modo: 'simple', monto: '500.05' }).id;
    const resultado = caja.intentarCerrar(sesionId, { modo: 'simple', monto: '500.10' });
    expect(resultado.diferencia).toBe('0.05');
  });

  it('no se puede cerrar dos veces el mismo turno', () => {
    const sesionId = turnoDeQuinientos();
    caja.intentarCerrar(sesionId, { modo: 'simple', monto: '500' });
    expect(() => caja.intentarCerrar(sesionId, { modo: 'simple', monto: '500' })).toThrow(
      /ya está cerrado/,
    );
  });
});

// ===========================================================================
describe('monto_esperado: pendiente del módulo de ventas', () => {
  it('HOY equivale al monto inicial, porque todavía no hay ventas que sumar', () => {
    // Cuando exista el módulo de ventas esto DEBE pasar a ser
    // monto_inicial + ventas en efectivo de la sesión. Ver CLAUDE.md §4.10.
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '750.25' });
    expect(montoACadena(caja.montoEsperadoDe(sesion))).toBe('750.25');
  });
});
