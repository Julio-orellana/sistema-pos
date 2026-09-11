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
import {
  crearRepositorios,
  type Repositorios,
  type SuperficieDeAutorizacion,
} from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import {
  ACEPTA_PIN_REMOTO,
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

    // Ya no se le pasa ningún `aceptaPinRemoto`: la política sale de la
    // superficie, y quien llama no tiene dónde contradecirla.
    const presencial = servicio.autorizarComoAdministrador(PIN_DE_JIMMY, 'cierre_con_diferencia');
    expect(presencial.viaDeAutorizacion).toBe('presencial');

    const remoto = servicio.autorizarComoAdministrador(PIN_REMOTO, 'cierre_con_diferencia');
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
  function bloquear(superficie: SuperficieDeAutorizacion): void {
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

// ===========================================================================
/**
 * LAS DIEZ COMBINACIONES CRUZADAS, en las dos direcciones.
 *
 * Hay CINCO lugares donde alguien teclea un PIN y se puede equivocar: las
 * cuatro superficies de autorización y el ingreso a la aplicación. Entre cinco
 * cosas hay diez pares, y cada par se prueba en los dos sentidos.
 *
 * POR QUÉ ESTÁN TODAS, y no una muestra: el defecto original de este proyecto
 * —un cajero que, tecleando mal tres veces en el diálogo de salida, dejaba a
 * TODOS los administradores sin poder iniciar sesión— era exactamente una de
 * estas combinaciones. Probar solo algunas deja el mismo agujero abierto en
 * las otras, y con cuatro superficies ya no alcanza con mirarlo a ojo. El
 * recuento crece rápido: cada superficie nueva agrega tantos pares como
 * superficies había, así que se generan en un bucle y no a mano.
 */
describe('QUÉ SUPERFICIE ACEPTA EL PIN REMOTO: una sola tabla decide', () => {
  /*
    Antes esto era un argumento que escribía quien llamaba, junto al nombre de
    la superficie. Dos datos que tienen que concordar siempre, decididos en
    archivos distintos, es una discrepancia esperando a ocurrir: alcanzaba con
    copiar un bloque y cambiar el nombre de la superficie sin tocar el booleano
    para que una superficie empezara a aceptar un PIN que la documentación dice
    que no acepta, sin que nada fallara. Ahora la política viaja con la
    superficie y no hay dónde contradecirla.
  */
  const PIN_REMOTO = '8642';

  beforeEach(() => {
    servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
  });

  it('la tabla cubre las CUATRO superficies, sin huecos', () => {
    // El tipo `Record<SuperficieDeAutorizacion, boolean>` ya lo exige al
    // compilar; esto lo comprueba también en ejecución, por si alguien agregara
    // una superficie con un `as` de por medio.
    expect(Object.keys(ACEPTA_PIN_REMOTO).sort()).toEqual([
      'cierre_con_diferencia',
      'cierre_de_caja_ajena',
      'descuento_excedente',
      'salida_controlada',
    ]);
  });

  it('las DOS que lo aceptan son el cierre descuadrado y el descuento excedente', () => {
    expect(ACEPTA_PIN_REMOTO.cierre_con_diferencia).toBe(true);
    expect(ACEPTA_PIN_REMOTO.descuento_excedente).toBe(true);
  });

  it('las DOS que NO lo aceptan siguen sin aceptarlo', () => {
    expect(ACEPTA_PIN_REMOTO.salida_controlada).toBe(false);
    expect(ACEPTA_PIN_REMOTO.cierre_de_caja_ajena).toBe(false);
  });

  it('y el comportamiento real coincide con la tabla, superficie por superficie', () => {
    // La mitad que de verdad importa: que la tabla no sea una declaración
    // decorativa sino lo que el servicio hace.
    for (const [superficie, acepta] of Object.entries(ACEPTA_PIN_REMOTO)) {
      const intento = servicio.autorizarComoAdministrador(
        PIN_REMOTO,
        superficie as SuperficieDeAutorizacion,
      );
      expect(intento.autenticado, `${superficie} debería ${acepta ? 'aceptar' : 'rechazar'}`).toBe(
        acepta,
      );
      if (acepta) {
        expect(intento.viaDeAutorizacion).toBe('remoto');
      }
    }
  });

  it('el PIN NORMAL autoriza en las cuatro, acepten o no el remoto', () => {
    // Ampliar qué acepta una superficie no le quitó nada a lo que ya aceptaba.
    for (const superficie of Object.keys(ACEPTA_PIN_REMOTO)) {
      const intento = servicio.autorizarComoAdministrador(
        PIN_DE_JIMMY,
        superficie as SuperficieDeAutorizacion,
      );
      expect(intento.autenticado, `${superficie} debe aceptar el PIN normal`).toBe(true);
      expect(intento.viaDeAutorizacion).toBe('presencial');
    }
  });
});

// ===========================================================================
describe('Los cinco candados son independientes: las diez combinaciones cruzadas', () => {
  const PIN_MALO = '0000';
  /** El PIN de autorización a distancia de Jimmy, para los casos con remoto. */
  const PIN_REMOTO = '8642';

  /** Las cuatro superficies de autorización. */
  const SUPERFICIES: readonly SuperficieDeAutorizacion[] = [
    'salida_controlada',
    'cierre_con_diferencia',
    'cierre_de_caja_ajena',
    'descuento_excedente',
  ];

  /** Agota los tres intentos de una superficie de autorización. */
  function agotar(superficie: SuperficieDeAutorizacion): void {
    for (let intento = 0; intento < 3; intento += 1) {
      servicio.autorizarComoAdministrador(PIN_MALO, superficie);
    }
  }

  /** Agota los tres intentos del INGRESO de un usuario. */
  function agotarIngreso(): void {
    for (let intento = 0; intento < 3; intento += 1) {
      servicio.autenticar(idJimmy, PIN_MALO);
    }
  }

  /** ¿Esta superficie está bloqueada ahora mismo? */
  function bloqueada(superficie: SuperficieDeAutorizacion): boolean {
    return servicio.autorizarComoAdministrador(PIN_DE_JIMMY, superficie).codigo ===
      'AUTORIZACION_BLOQUEADA';
  }

  /** ¿El ingreso está bloqueado ahora mismo? */
  function ingresoBloqueado(): boolean {
    return servicio.autenticar(idJimmy, PIN_DE_JIMMY).codigo === 'USUARIO_BLOQUEADO';
  }

  // ---- Los tres pares ENTRE SUPERFICIES, en ambos sentidos ----------------
  for (const bloqueada1 of SUPERFICIES) {
    for (const otra of SUPERFICIES) {
      if (bloqueada1 === otra) {
        continue;
      }
      it(`bloquear ${bloqueada1} NO bloquea ${otra}`, () => {
        agotar(bloqueada1);

        expect(bloqueada(bloqueada1)).toBe(true);
        expect(bloqueada(otra)).toBe(false);
      });
    }
  }

  // ---- Los tres pares SUPERFICIE ↔ INGRESO, en ambos sentidos -------------
  for (const superficie of SUPERFICIES) {
    it(`bloquear ${superficie} NO impide iniciar sesión`, () => {
      agotar(superficie);

      expect(bloqueada(superficie)).toBe(true);
      expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
      // Y ni siquiera le tocó el contador al usuario.
      expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
    });

    it(`bloquear el INGRESO no bloquea ${superficie}`, () => {
      agotarIngreso();

      expect(ingresoBloqueado()).toBe(true);
      expect(bloqueada(superficie)).toBe(false);
    });
  }

  // ---- EL CASO NUEVO: dos superficies que aceptan el MISMO PIN remoto ----
  /*
    Hasta el 2026-09-11 solo UNA superficie aceptaba el PIN remoto, así que este
    caso no existía: era imposible bloquear una con el remoto y preguntarse si
    la otra seguía aceptándolo. Ahora `cierre_con_diferencia` y
    `descuento_excedente` aceptan los dos el mismo PIN, y la pregunta es
    legítima: ¿compartir qué PIN aceptan hace que compartan candado?

    NO. El candado es de la SUPERFICIE, no del PIN ni de la persona (§4.8). Si
    lo compartieran, un cajero que fallara tres veces al pedir un descuento
    dejaría a la tienda sin poder cerrar una caja descuadrada, que es
    exactamente la negación de servicio que la separación vino a eliminar.
  */
  const PAREJA_QUE_ACEPTA_REMOTO: readonly SuperficieDeAutorizacion[] = [
    'cierre_con_diferencia',
    'descuento_excedente',
  ];

  for (const bloqueadaConRemoto of PAREJA_QUE_ACEPTA_REMOTO) {
    const otra = PAREJA_QUE_ACEPTA_REMOTO.find((una) => una !== bloqueadaConRemoto);

    it(`bloquear ${bloqueadaConRemoto} con el PIN REMOTO no bloquea ${String(otra)}`, () => {
      servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
      agotar(bloqueadaConRemoto);

      expect(bloqueada(bloqueadaConRemoto)).toBe(true);

      // La otra sigue aceptando el remoto, que es la mitad que importa: no
      // alcanza con que no esté bloqueada, tiene que seguir autorizando.
      const permiso = servicio.autorizarComoAdministrador(PIN_REMOTO, otra ?? 'salida_controlada');
      expect(permiso.autenticado).toBe(true);
      expect(permiso.viaDeAutorizacion).toBe('remoto');
    });

    it(`y ${bloqueadaConRemoto} bloqueada tampoco acepta el remoto: el candado manda`, () => {
      // La contraparte. Un candado que dejara pasar el PIN remoto no sería un
      // candado: bastaría con tener el otro código para saltarlo.
      servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
      agotar(bloqueadaConRemoto);

      const intento = servicio.autorizarComoAdministrador(PIN_REMOTO, bloqueadaConRemoto);
      expect(intento.autenticado).toBe(false);
      expect(intento.codigo).toBe('AUTORIZACION_BLOQUEADA');
    });
  }

  it('agotar las dos que aceptan el remoto NO impide iniciar sesión ni salir de la app', () => {
    servicio.configurarPinRemoto(idJimmy, PIN_REMOTO);
    agotar('cierre_con_diferencia');
    agotar('descuento_excedente');

    expect(bloqueada('cierre_con_diferencia')).toBe(true);
    expect(bloqueada('descuento_excedente')).toBe(true);
    expect(bloqueada('salida_controlada')).toBe(false);
    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('cada una de las cuatro superficies lleva su propio contador en la base', () => {
    servicio.autorizarComoAdministrador(PIN_MALO, 'salida_controlada');
    servicio.autorizarComoAdministrador(PIN_MALO, 'cierre_con_diferencia');
    servicio.autorizarComoAdministrador(PIN_MALO, 'cierre_con_diferencia');
    servicio.autorizarComoAdministrador(PIN_MALO, 'descuento_excedente');
    servicio.autorizarComoAdministrador(PIN_MALO, 'descuento_excedente');
    servicio.autorizarComoAdministrador(PIN_MALO, 'cierre_de_caja_ajena');
    servicio.autorizarComoAdministrador(PIN_MALO, 'cierre_de_caja_ajena');
    servicio.autorizarComoAdministrador(PIN_MALO, 'cierre_de_caja_ajena');

    expect(repos.bloqueosDeAutorizacion.obtener('salida_controlada').intentosFallidos).toBe(1);
    expect(repos.bloqueosDeAutorizacion.obtener('cierre_con_diferencia').intentosFallidos).toBe(2);
    expect(repos.bloqueosDeAutorizacion.obtener('descuento_excedente').intentosFallidos).toBe(2);

    // La tercera llegó al límite: el contador se reinicia y lo que queda es el
    // bloqueo con su vencimiento. Las otras tres siguen contando lo suyo, sin
    // bloquearse.
    const tercera = repos.bloqueosDeAutorizacion.obtener('cierre_de_caja_ajena');
    expect(tercera.intentosFallidos).toBe(0);
    expect(tercera.bloqueadoHasta).not.toBeNull();
    expect(repos.bloqueosDeAutorizacion.obtener('salida_controlada').bloqueadoHasta).toBeNull();
    expect(repos.bloqueosDeAutorizacion.obtener('cierre_con_diferencia').bloqueadoHasta).toBeNull();
    expect(repos.bloqueosDeAutorizacion.obtener('descuento_excedente').bloqueadoHasta).toBeNull();
  });

  it('bloquear las CUATRO a la vez sigue sin impedir el ingreso', () => {
    for (const superficie of SUPERFICIES) {
      agotar(superficie);
    }
    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('la base acepta la superficie nueva, y solo las cuatro declaradas', () => {
    servicio.autorizarComoAdministrador(PIN_MALO, 'descuento_excedente');
    expect(repos.bloqueosDeAutorizacion.obtener('descuento_excedente').intentosFallidos).toBe(1);

    // El CHECK de la migración 013 es lo que mantiene el conjunto a la vista.
    expect(() =>
      base
        .prepare(
          `INSERT INTO bloqueos_de_autorizacion (superficie, intentos_fallidos, actualizado_en)
           VALUES ('superficie_inventada', 1, '2026-09-08T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });
});
