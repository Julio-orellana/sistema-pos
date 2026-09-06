/**
 * Pruebas del servicio de autenticación.
 *
 * Todo lo que se construya de aquí en adelante depende de saber quién es el
 * usuario y qué rol tiene, así que estas pruebas cubren el bloqueo por
 * intentos, la auditoría y los casos borde con el mismo detalle que money.ts.
 *
 * Se corren contra bases SQLite REALES: el bloqueo se persiste en la base y lo
 * que se quiere comprobar es justamente eso.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { type ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import {
  INTENTOS_MAXIMOS,
  SEGUNDOS_DE_BLOQUEO,
  ServicioDeAutenticacion,
} from '../autenticacion';

const PIN_DE_JIMMY = '2468';
const PIN_DE_LA_CAJERA = '1357';
const PIN_EQUIVOCADO = '9999';
const MILISEGUNDOS_POR_SEGUNDO = 1000;

let base: Database;
let repos: Repositorios;
let servicio: ServicioDeAutenticacion;
let limpiar: () => void;
let instante: number;

/** Adelanta el reloj del servicio, sin esperar de verdad. */
function avanzarSegundos(segundos: number): void {
  instante += segundos * MILISEGUNDOS_POR_SEGUNDO;
}

/** Ids de los usuarios sembrados en cada prueba. */
let idJimmy: string;
let idCajera: string;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  instante = Date.UTC(2026, 8, 6, 12, 0, 0);

  servicio = new ServicioDeAutenticacion({
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
    ahora: (): number => instante,
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin(PIN_DE_JIMMY),
  }).id;
  idCajera = repos.usuarios.crear({
    nombre: 'Cajera',
    rol: 'venta',
    pinHash: generarHashDePin(PIN_DE_LA_CAJERA),
  }).id;
});

afterEach(() => {
  limpiar();
});

/** Acciones registradas en la bitácora, en orden. */
function accionesDeAuditoria(): string[] {
  return (
    base.prepare('SELECT accion FROM auditoria_log ORDER BY fecha, rowid').all() as {
      accion: string;
    }[]
  ).map((fila) => fila.accion);
}

// ===========================================================================
describe('Ingreso correcto', () => {
  it('un PIN correcto autentica y devuelve el usuario', () => {
    const resultado = servicio.autenticar(idJimmy, PIN_DE_JIMMY);

    expect(resultado.autenticado).toBe(true);
    expect(resultado.codigo).toBe('INGRESO_CORRECTO');
    expect(resultado.usuario?.nombre).toBe('Jimmy');
    expect(resultado.usuario?.rol).toBe('administrativo');
  });

  it('cada usuario entra con SU pin, no con el del otro', () => {
    expect(servicio.autenticar(idCajera, PIN_DE_LA_CAJERA).autenticado).toBe(true);
    expect(servicio.autenticar(idCajera, PIN_DE_JIMMY).autenticado).toBe(false);
  });

  it('el ingreso correcto queda en la bitácora de auditoría', () => {
    servicio.autenticar(idJimmy, PIN_DE_JIMMY);
    expect(accionesDeAuditoria()).toContain('ingreso_correcto');
  });

  it('un usuario desactivado no puede entrar aunque el PIN sea correcto', () => {
    repos.usuarios.desactivar(idCajera);
    const resultado = servicio.autenticar(idCajera, PIN_DE_LA_CAJERA);

    expect(resultado.autenticado).toBe(false);
    expect(resultado.codigo).toBe('USUARIO_INACTIVO');
  });

  it('un usuario que no existe se rechaza sin lanzar', () => {
    const resultado = servicio.autenticar('00000000-0000-4000-8000-000000000000', PIN_DE_JIMMY);
    expect(resultado.codigo).toBe('USUARIO_INEXISTENTE');
  });
});

// ===========================================================================
describe('Qué consume un intento y qué no (mismo criterio que la salida controlada)', () => {
  it('SÍ consume intento: cuatro dígitos completos pero equivocados', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(1);
  });

  it('NO consume intento: una entrada incompleta de tres dígitos', () => {
    const resultado = servicio.autenticar(idJimmy, '246');

    expect(resultado.codigo).toBe('FORMATO_INVALIDO');
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
  });

  it('NO consume intento: una entrada con algo que no es un dígito', () => {
    servicio.autenticar(idJimmy, '24a8');
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
  });

  it('NO consume intento: una entrada vacía', () => {
    servicio.autenticar(idJimmy, '');
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
  });

  it('mezclar entradas inválidas NO diluye el contador', () => {
    servicio.autenticar(idJimmy, '24');        // inválido, no cuenta
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO); // cuenta
    servicio.autenticar(idJimmy, 'abcd');      // inválido, no cuenta
    servicio.autenticar(idJimmy, '1111');      // cuenta

    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(2);
  });

  it('un intento fallido queda en la bitácora', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    expect(accionesDeAuditoria()).toContain('ingreso_fallido');
  });
});

// ===========================================================================
describe('Bloqueo por intentos, POR USUARIO y persistido en la base', () => {
  it(`al fallo número ${String(INTENTOS_MAXIMOS)} el usuario queda bloqueado`, () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    const tercero = servicio.autenticar(idJimmy, PIN_EQUIVOCADO);

    expect(tercero.codigo).toBe('USUARIO_BLOQUEADO');
    expect(repos.usuarios.obtenerPorId(idJimmy)?.bloqueadoHasta).not.toBeNull();
    expect(accionesDeAuditoria()).toContain('usuario_bloqueado');
  });

  it('durante el bloqueo rechaza incluso el PIN CORRECTO', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);

    const conElCorrecto = servicio.autenticar(idJimmy, PIN_DE_JIMMY);
    expect(conElCorrecto.autenticado).toBe(false);
    expect(conElCorrecto.codigo).toBe('USUARIO_BLOQUEADO');
  });

  it('el bloqueo se levanta solo al cumplirse el tiempo', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);

    avanzarSegundos(SEGUNDOS_DE_BLOQUEO - 1);
    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).codigo).toBe('USUARIO_BLOQUEADO');

    avanzarSegundos(2);
    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('BLOQUEAR A UNO NO BLOQUEA AL OTRO: el límite es por usuario', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);

    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).codigo).toBe('USUARIO_BLOQUEADO');
    // La cajera sigue pudiendo trabajar.
    expect(servicio.autenticar(idCajera, PIN_DE_LA_CAJERA).autenticado).toBe(true);
  });

  it('EL BLOQUEO SOBREVIVE A UN REINICIO: está en la base, no en memoria', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);

    // Se simula reiniciar la aplicación: servicio nuevo, misma base.
    const servicioReiniciado = new ServicioDeAutenticacion({
      usuarios: repos.usuarios,
      auditoria: repos.auditoria,
      bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
      ahora: (): number => instante,
    });

    expect(servicioReiniciado.autenticar(idJimmy, PIN_DE_JIMMY).codigo).toBe('USUARIO_BLOQUEADO');
  });

  it('un ingreso correcto reinicia el contador de intentos', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(2);

    servicio.autenticar(idJimmy, PIN_DE_JIMMY);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.bloqueadoHasta).toBeNull();
  });

  it('NUNCA informa cuántos intentos quedan, solo cuánto falta para reintentar', () => {
    const primero = servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    expect(primero.mensaje).not.toMatch(/\d+\s*(intento|restante)/i);
    expect(primero.segundosParaReintentar).toBeNull();

    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    const tercero = servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    expect(tercero.segundosParaReintentar).toBe(SEGUNDOS_DE_BLOQUEO);
  });
});

// ===========================================================================
describe('Autorización administrativa (la que usa la salida controlada)', () => {
  it('acepta el PIN de un administrador y devuelve QUIÉN autorizó', () => {
    const resultado = servicio.autorizarComoAdministrador(PIN_DE_JIMMY);

    expect(resultado.autenticado).toBe(true);
    expect(resultado.usuario?.id).toBe(idJimmy);
  });

  it('NO acepta el PIN de un usuario de venta: no es administrador', () => {
    const resultado = servicio.autorizarComoAdministrador(PIN_DE_LA_CAJERA);
    expect(resultado.autenticado).toBe(false);
  });

  it('un PIN mal formado no consume intentos de nadie', () => {
    servicio.autorizarComoAdministrador('12');
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
  });

  it('tres intentos equivocados bloquean el DIÁLOGO, no a los administradores', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    const tercero = servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);

    expect(tercero.codigo).toBe('AUTORIZACION_BLOQUEADA');
    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY).autenticado).toBe(false);
  });

  it('sin administradores en la instalación, la autorización se rechaza con su propio código', () => {
    const prueba = crearBaseMigrada();
    const otrosRepos = crearRepositorios(prueba.base);
    const sinAdmins = new ServicioDeAutenticacion({
      usuarios: otrosRepos.usuarios,
      auditoria: otrosRepos.auditoria,
      bloqueosDeAutorizacion: otrosRepos.bloqueosDeAutorizacion,
    });

    expect(sinAdmins.autorizarComoAdministrador('1234').codigo).toBe('SIN_ADMINISTRADORES');
    prueba.limpiar();
  });
});

// ===========================================================================
describe('Primer arranque', () => {
  it('con usuarios existentes, NO requiere configuración inicial', () => {
    expect(servicio.requiereConfiguracionInicial()).toBe(false);
  });

  it('con la tabla vacía, requiere configuración inicial', () => {
    const prueba = crearBaseMigrada();
    const otrosRepos = crearRepositorios(prueba.base);
    const recienInstalado = new ServicioDeAutenticacion({
      usuarios: otrosRepos.usuarios,
      auditoria: otrosRepos.auditoria,
      bloqueosDeAutorizacion: otrosRepos.bloqueosDeAutorizacion,
    });

    expect(recienInstalado.requiereConfiguracionInicial()).toBe(true);
    prueba.limpiar();
  });

  it('crea el primer administrador y deja asiento de auditoría', () => {
    const prueba = crearBaseMigrada();
    const otrosRepos = crearRepositorios(prueba.base);
    const recienInstalado = new ServicioDeAutenticacion({
      usuarios: otrosRepos.usuarios,
      auditoria: otrosRepos.auditoria,
      bloqueosDeAutorizacion: otrosRepos.bloqueosDeAutorizacion,
    });

    const creado = recienInstalado.crearPrimerAdministrador('Jimmy', generarHashDePin('4321'));

    expect(creado.rol).toBe('administrativo');
    expect(recienInstalado.requiereConfiguracionInicial()).toBe(false);
    expect(recienInstalado.autenticar(creado.id, '4321').autenticado).toBe(true);

    const acciones = (
      prueba.base.prepare('SELECT accion FROM auditoria_log').all() as { accion: string }[]
    ).map((f) => f.accion);
    expect(acciones).toContain('primer_administrador_creado');
    prueba.limpiar();
  });

  it('SE NIEGA a crear un "primer" administrador si ya hay usuarios', () => {
    // Sin esta condición, el canal sería una puerta para crearse un
    // administrador en cualquier momento desde la interfaz.
    expect(() => servicio.crearPrimerAdministrador('Intruso', generarHashDePin('0000'))).toThrow(
      /instalación vacía/,
    );
  });
});


// ===========================================================================
describe('LOS DOS CANDADOS ESTÁN SEPARADOS (ingreso vs. diálogo de autorización)', () => {
  // Antes compartían usuarios.intentos_fallidos: tres errores en el diálogo de
  // salida dejaban a TODOS los administradores sin poder iniciar sesión, lo que
  // convertía una función de administrador en una negación de servicio al
  // alcance de cualquier cajero.

  it('fallar en el DIÁLOGO no suma intentos a ningún usuario', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);

    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
    expect(repos.usuarios.obtenerPorId(idCajera)?.intentosFallidos).toBe(0);
  });

  it('bloquear el DIÁLOGO no impide iniciar sesión: es el caso que motivó la separación', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);

    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY).codigo).toBe('AUTORIZACION_BLOQUEADA');
    // Y sin embargo Jimmy puede entrar a trabajar con normalidad.
    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('bloquear a un USUARIO no bloquea el diálogo de autorización', () => {
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);

    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).codigo).toBe('USUARIO_BLOQUEADO');
    // El diálogo sigue aceptando su PIN: es otra superficie.
    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('un PIN equivocado cuenta UNA vez, no una por cada administrador', () => {
    // Con dos administradores, dos errores no deben agotar los tres intentos.
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);

    expect(repos.bloqueosDeAutorizacion.obtener('salida_controlada').intentosFallidos).toBe(2);
    // El tercero sí bloquea.
    expect(servicio.autorizarComoAdministrador(PIN_EQUIVOCADO).codigo).toBe('AUTORIZACION_BLOQUEADA');
  });

  it('el candado del diálogo se persiste: sobrevive a un reinicio', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);

    const reiniciado = new ServicioDeAutenticacion({
      usuarios: repos.usuarios,
      auditoria: repos.auditoria,
      bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
      ahora: (): number => instante,
    });

    expect(reiniciado.autorizarComoAdministrador(PIN_DE_JIMMY).codigo).toBe('AUTORIZACION_BLOQUEADA');
  });

  it('el bloqueo del diálogo se levanta solo al cumplirse el tiempo', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);

    avanzarSegundos(SEGUNDOS_DE_BLOQUEO + 1);
    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('una autorización correcta libera el candado del diálogo', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_DE_JIMMY);

    expect(repos.bloqueosDeAutorizacion.obtener('salida_controlada').intentosFallidos).toBe(0);
  });

  it('una autorización correcta NO toca el contador de ingreso del usuario', () => {
    // Son independientes en las dos direcciones.
    servicio.autenticar(idJimmy, PIN_EQUIVOCADO);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(1);

    servicio.autorizarComoAdministrador(PIN_DE_JIMMY);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(1);
  });

  it('el bloqueo del diálogo queda en la bitácora de auditoría', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO);

    expect(accionesDeAuditoria()).toContain('autorizacion_bloqueada');
  });
});

// ===========================================================================
describe('PIN de autorización remota', () => {
  const PIN_REMOTO = '8642';

  it('un administrador puede configurar su PIN remoto', () => {
    servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.pinRemotoHash).not.toBeNull();
  });

  it('SE RECHAZA un PIN remoto igual al PIN normal, y el mensaje explica por qué', () => {
    try {
      servicio.configurarPinRemoto(idJimmy, PIN_DE_JIMMY);
      expect.unreachable('Se esperaba que un PIN remoto igual al normal fuera rechazado.');
    } catch (error) {
      const negocio = error as ErrorDeNegocio;
      expect(negocio.codigo).toBe('DATO_INVALIDO');
      expect(negocio.mensajeParaElUsuario).toContain('DISTINTO');
      expect(negocio.mensajeParaElUsuario).toContain('teléfono');
    }
    // Y no quedó configurado.
    expect(repos.usuarios.obtenerPorId(idJimmy)?.pinRemotoHash).toBeNull();
  });

  it('un usuario de VENTA no puede tener PIN remoto', () => {
    expect(() => { servicio.configurarPinRemoto(idCajera, PIN_REMOTO); }).toThrow(/administrador/);
  });

  it('rechaza un PIN remoto con formato inválido', () => {
    expect(() => { servicio.configurarPinRemoto(idJimmy, '123'); }).toThrow(/cuatro dígitos/);
  });

  it('el PIN remoto NO sirve para iniciar sesión: es solo para autorizar', () => {
    servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
    expect(servicio.autenticar(idJimmy, PIN_REMOTO).autenticado).toBe(false);
    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('el PIN remoto NO autoriza donde no se acepta (salida controlada)', () => {
    servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
    // No es que cerrar la app sea una acción física. El PIN remoto se pidió
    // para una sola cosa —autorizar diferencias de caja— y dárselo además a
    // la salida controlada le ampliaría el alcance más allá de lo pedido.
    expect(servicio.autorizarComoAdministrador(PIN_REMOTO, 'salida_controlada').autenticado).toBe(
      false,
    );
  });

  it('el PIN normal autoriza como PRESENCIAL y el remoto como REMOTO', () => {
    servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
    const opciones = { aceptaPinRemoto: true };

    const presencial = servicio.autorizarComoAdministrador(
      PIN_DE_JIMMY,
      'cierre_con_diferencia',
      opciones,
    );
    expect(presencial.viaDeAutorizacion).toBe('presencial');

    const remoto = servicio.autorizarComoAdministrador(
      PIN_REMOTO,
      'cierre_con_diferencia',
      opciones,
    );
    expect(remoto.viaDeAutorizacion).toBe('remoto');
    expect(remoto.usuario?.id).toBe(idJimmy);
  });

  it('configurar el PIN remoto queda en auditoría, sin guardar el código', () => {
    servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);

    const asiento = base
      .prepare("SELECT valor_nuevo FROM auditoria_log WHERE accion = 'pin_remoto_configurado'")
      .get() as { valor_nuevo: string };

    expect(JSON.parse(asiento.valor_nuevo)).toEqual({ configurado: true });
    expect(asiento.valor_nuevo).not.toContain(PIN_REMOTO);
  });
});

// ===========================================================================
describe('Las superficies de autorización tienen candados INDEPENDIENTES entre sí', () => {
  const PIN_EQUIVOCADO_2 = '0000';

  /** Agota los tres intentos de una superficie. */
  function bloquear(superficie: 'salida_controlada' | 'cierre_con_diferencia'): void {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO_2, superficie);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO_2, superficie);
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO_2, superficie);
  }

  it('bloquear el CIERRE CON DIFERENCIA no bloquea la SALIDA CONTROLADA', () => {
    bloquear('cierre_con_diferencia');

    expect(
      servicio.autorizarComoAdministrador(PIN_DE_JIMMY, 'cierre_con_diferencia').codigo,
    ).toBe('AUTORIZACION_BLOQUEADA');
    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY, 'salida_controlada').autenticado).toBe(
      true,
    );
  });

  it('bloquear la SALIDA CONTROLADA no bloquea el CIERRE CON DIFERENCIA', () => {
    bloquear('salida_controlada');

    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY, 'salida_controlada').codigo).toBe(
      'AUTORIZACION_BLOQUEADA',
    );
    expect(
      servicio.autorizarComoAdministrador(PIN_DE_JIMMY, 'cierre_con_diferencia').autenticado,
    ).toBe(true);
  });

  it('bloquear CUALQUIERA de las dos no impide iniciar sesión', () => {
    bloquear('cierre_con_diferencia');
    bloquear('salida_controlada');

    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
  });

  it('cada superficie lleva su propio contador en la base', () => {
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO_2, 'cierre_con_diferencia');
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO_2, 'cierre_con_diferencia');
    servicio.autorizarComoAdministrador(PIN_EQUIVOCADO_2, 'salida_controlada');

    expect(repos.bloqueosDeAutorizacion.obtener('cierre_con_diferencia').intentosFallidos).toBe(2);
    expect(repos.bloqueosDeAutorizacion.obtener('salida_controlada').intentosFallidos).toBe(1);
  });
});
