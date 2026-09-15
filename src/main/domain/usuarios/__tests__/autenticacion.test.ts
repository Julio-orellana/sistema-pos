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
  VIDA_DE_LA_INSCRIPCION_PENDIENTE_MS,
} from '../autenticacion';
import { decodificarBase32, SEGUNDOS_POR_PASO } from '../totp';
import { CifradoDePrueba, codigoDeLaApp, inscribir, SECRETO_DE_PRUEBA, sembrarAutorizacionRemota } from './ayuda-totp';

const PIN_DE_JIMMY = '2468';
const PIN_DE_LA_CAJERA = '1357';
const PIN_EQUIVOCADO = '9999';
const MILISEGUNDOS_POR_SEGUNDO = 1000;

let base: Database;
let repos: Repositorios;
let servicio: ServicioDeAutenticacion;
let limpiar: () => void;
let instante: number;
let cifrado: CifradoDePrueba;
/** Lo que el servicio anotó en la bitácora técnica. */
let bitacora: string[];

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
  cifrado = new CifradoDePrueba();
  bitacora = [];

  servicio = new ServicioDeAutenticacion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
    cifrado,
    log: { registrar: (origen, mensaje): void => { bitacora.push(`[${origen}] ${mensaje}`); } },
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
      base,
      usuarios: repos.usuarios,
      auditoria: repos.auditoria,
      bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
    cifrado,
    log: { registrar: (origen, mensaje): void => { bitacora.push(`[${origen}] ${mensaje}`); } },
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
      base,
      usuarios: otrosRepos.usuarios,
      auditoria: otrosRepos.auditoria,
      bloqueosDeAutorizacion: otrosRepos.bloqueosDeAutorizacion,
      cifrado,
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
      base: prueba.base,
      usuarios: otrosRepos.usuarios,
      auditoria: otrosRepos.auditoria,
      bloqueosDeAutorizacion: otrosRepos.bloqueosDeAutorizacion,
      cifrado,
    });

    expect(recienInstalado.requiereConfiguracionInicial()).toBe(true);
    prueba.limpiar();
  });

  it('EL PRIMER ADMINISTRADOR SE ENCOLA: sin esto no se sincroniza nada, nunca', () => {
    /*
      ===================================================================
      NO ES UNA PRUEBA DE PROLIJIDAD: SIN ESTO LA NUBE QUEDA MUERTA
      ===================================================================
      Hasta la fase 3.b esto escribía las dos filas sin encolar, y se descubrió
      corriendo una venta real contra Postgres. `auditoria_log.usuario_id` tiene
      llave foránea hacia `usuarios`, y **todo** asiento de la tienda lleva el id
      de quien hizo la operación. Con el primer administrador sin subir, el
      primer lote moría con `23503` y la cola quedaba detenida **para siempre**
      en una instalación nueva. Ver CLAUDE.md §4.25.
    */
    const prueba = crearBaseMigrada();
    const otrosRepos = crearRepositorios(prueba.base);
    const recienInstalado = new ServicioDeAutenticacion({
      base: prueba.base,
      usuarios: otrosRepos.usuarios,
      auditoria: otrosRepos.auditoria,
      bloqueosDeAutorizacion: otrosRepos.bloqueosDeAutorizacion,
      cifrado,
    });

    const creado = recienInstalado.crearPrimerAdministrador('Jimmy', generarHashDePin('4321'));

    const encolado = prueba.base
      .prepare('SELECT entidad_tipo, entidad_id, orden_en_lote FROM sync_cola ORDER BY orden_en_lote')
      .all() as { entidad_tipo: string; entidad_id: string; orden_en_lote: number }[];

    expect(encolado.map((f) => f.entidad_tipo)).toEqual(['usuarios', 'auditoria_log']);
    expect(encolado[0]?.entidad_id).toBe(creado.id);
    // Padres antes que hijos: el usuario va PRIMERO, y su asiento después.
    expect(encolado[0]?.orden_en_lote).toBeLessThan(encolado[1]?.orden_en_lote ?? -1);

    // Y en UN SOLO lote: o suben las dos o no sube ninguna.
    const lotes = prueba.base.prepare('SELECT DISTINCT lote_id FROM sync_cola').all();
    expect(lotes).toHaveLength(1);

    prueba.limpiar();
  });

  it('crea el primer administrador y deja asiento de auditoría', () => {
    const prueba = crearBaseMigrada();
    const otrosRepos = crearRepositorios(prueba.base);
    const recienInstalado = new ServicioDeAutenticacion({
      base: prueba.base,
      usuarios: otrosRepos.usuarios,
      auditoria: otrosRepos.auditoria,
      bloqueosDeAutorizacion: otrosRepos.bloqueosDeAutorizacion,
      cifrado,
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
      base,
      usuarios: repos.usuarios,
      auditoria: repos.auditoria,
      bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
    cifrado,
    log: { registrar: (origen, mensaje): void => { bitacora.push(`[${origen}] ${mensaje}`); } },
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
describe('Autorización remota por TOTP: la INSCRIPCIÓN', () => {
  const MS_POR_PASO = SEGUNDOS_POR_PASO * MILISEGUNDOS_POR_SEGUNDO;

  /** Todo lo que una inscripción podría haber tocado, para comparar antes y después. */
  function huella(): string {
    return JSON.stringify({
      usuarios: base.prepare('SELECT * FROM usuarios ORDER BY id').all(),
      auditoria: base.prepare('SELECT COUNT(*) AS n FROM auditoria_log').get(),
      cola: base.prepare('SELECT COUNT(*) AS n FROM sync_cola').get(),
      candados: base.prepare('SELECT * FROM bloqueos_de_autorizacion ORDER BY superficie').all(),
    });
  }

  it('INICIAR no escribe nada: devuelve un secreto de 160 bits y la URI del QR con el nombre de la persona', () => {
    const antes = huella();
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS Jimmy Cano');

    expect(decodificarBase32(inscripcion.secreto)).toHaveLength(20);
    expect(inscripcion.uri).toBe(
      `otpauth://totp/POS%20Jimmy%20Cano:Jimmy?secret=${inscripcion.secreto}&issuer=POS%20Jimmy%20Cano&algorithm=SHA1&digits=6&period=30`,
    );
    expect(inscripcion.reemplazaUnaAnterior).toBe(false);
    expect(huella()).toBe(antes);
    expect(cifrado.vecesQueCifro).toBe(0);
  });

  it('CONFIRMAR con el código de la app guarda el secreto CIFRADO, y descifrado es el mismo', () => {
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    servicio.confirmarInscripcionRemota(idJimmy, codigoDeLaApp(inscripcion.secreto, instante));

    const guardado = repos.usuarios.obtenerPorId(idJimmy)?.totpSecretoCifrado;
    expect(guardado).toBeInstanceOf(Buffer);
    expect(guardado?.includes(Buffer.from(inscripcion.secreto, 'utf8'))).toBe(false);
    expect(guardado?.includes(decodificarBase32(inscripcion.secreto))).toBe(false);
    expect(cifrado.decryptString(guardado ?? Buffer.alloc(0))).toBe(inscripcion.secreto);
  });

  it('un código INCORRECTO no deja NINGÚN rastro —ni columna, ni asiento, ni cola, ni candado— y descarta la inscripción', () => {
    const antes = huella();
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    const correcto = codigoDeLaApp(inscripcion.secreto, instante);
    const incorrecto = correcto === '000000' ? '000001' : '000000';

    try {
      servicio.confirmarInscripcionRemota(idJimmy, incorrecto);
      expect.unreachable('Se esperaba el rechazo del código incorrecto.');
    } catch (error) {
      expect((error as ErrorDeNegocio).codigo).toBe('CODIGO_DE_INSCRIPCION_INCORRECTO');
      expect((error as ErrorDeNegocio).mensajeParaElUsuario).toContain('no se guardó nada');
    }
    expect(huella()).toBe(antes);
    expect(cifrado.vecesQueCifro).toBe(0);

    // Descartada: ni el código correcto la revive. El secreto mostrado ya no sirve.
    expect(() => { servicio.confirmarInscripcionRemota(idJimmy, correcto); }).toThrow(/Empezá de nuevo/);
    expect(huella()).toBe(antes);
  });

  it('y se puede REINTENTAR: una inscripción nueva trae OTRO secreto y esa sí se guarda', () => {
    const primera = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    expect(() => { servicio.confirmarInscripcionRemota(idJimmy, '000000'); }).toThrow();

    const segunda = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    expect(segunda.secreto).not.toBe(primera.secreto);
    servicio.confirmarInscripcionRemota(idJimmy, codigoDeLaApp(segunda.secreto, instante));
    expect(repos.usuarios.obtenerPorId(idJimmy)?.totpSecretoCifrado).not.toBeNull();
  });

  it('un código MAL FORMADO no descarta la inscripción: no se llegó a comparar nada', () => {
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    expect(() => { servicio.confirmarInscripcionRemota(idJimmy, '12345'); }).toThrow(/seis dígitos/);
    servicio.confirmarInscripcionRemota(idJimmy, codigoDeLaApp(inscripcion.secreto, instante));
    expect(repos.usuarios.obtenerPorId(idJimmy)?.totpSecretoCifrado).not.toBeNull();
  });

  it('la inscripción VENCE: pasados diez minutos no se confirma', () => {
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    instante += VIDA_DE_LA_INSCRIPCION_PENDIENTE_MS + 1;
    expect(() => {
      servicio.confirmarInscripcionRemota(idJimmy, codigoDeLaApp(inscripcion.secreto, instante));
    }).toThrow(/Empezá de nuevo/);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.totpSecretoCifrado).toBeNull();
  });

  it('CANCELAR descarta la inscripción en curso', () => {
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    servicio.cancelarInscripcionRemota(idJimmy);
    expect(() => {
      servicio.confirmarInscripcionRemota(idJimmy, codigoDeLaApp(inscripcion.secreto, instante));
    }).toThrow(/Empezá de nuevo/);
  });

  it('SOLO SOBRE LA PROPIA CUENTA: la inscripción de uno no la confirma otro administrador', () => {
    const rosa = repos.usuarios.crear({ nombre: 'Rosa', rol: 'administrativo', pinHash: generarHashDePin('4321') }).id;
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    expect(() => {
      servicio.confirmarInscripcionRemota(rosa, codigoDeLaApp(inscripcion.secreto, instante));
    }).toThrow(/Empezá de nuevo/);
    expect(repos.usuarios.obtenerPorId(rosa)?.totpSecretoCifrado).toBeNull();
    expect(repos.usuarios.obtenerPorId(idJimmy)?.totpSecretoCifrado).toBeNull();
  });

  it('un usuario de VENTA no se puede inscribir, ni un administrador dado de baja', () => {
    expect(() => servicio.iniciarInscripcionRemota(idCajera, 'POS pruebas')).toThrow(/administrador activo/);
    const rosa = repos.usuarios.crear({ nombre: 'Rosa', rol: 'administrativo', pinHash: generarHashDePin('4321') }).id;
    repos.usuarios.fijarActivo(rosa, false);
    expect(() => servicio.iniciarInscripcionRemota(rosa, 'POS pruebas')).toThrow(/administrador activo/);
  });

  it('sin el cifrado del sistema NO se muestra ningún secreto: un secreto que no se puede guardar no se muestra', () => {
    cifrado.disponible = false;
    try {
      servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
      expect.unreachable('Se esperaba CIFRADO_NO_DISPONIBLE.');
    } catch (error) {
      expect((error as ErrorDeNegocio).codigo).toBe('CIFRADO_NO_DISPONIBLE');
    }
  });

  it('REINSCRIBIRSE reemplaza el secreto anterior SIN conocerlo: el código viejo deja de autorizar y el nuevo autoriza', () => {
    const viejo = inscribir(servicio, idJimmy, instante);
    instante += MS_POR_PASO * 4;

    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    expect(inscripcion.reemplazaUnaAnterior).toBe(true);
    servicio.confirmarInscripcionRemota(idJimmy, codigoDeLaApp(inscripcion.secreto, instante));

    // El paso consumido se reinició con el secreto: el siguiente paso del NUEVO sirve.
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(viejo, instante, 1), 'cierre_con_diferencia').autenticado).toBe(false);
    const nuevo = servicio.autorizarComoAdministrador(codigoDeLaApp(inscripcion.secreto, instante, 1), 'cierre_con_diferencia');
    expect(nuevo.autenticado).toBe(true);
    expect(nuevo.viaDeAutorizacion).toBe('remoto');
  });

  it('queda en auditoría y se encola, SIN el secreto ni el código', () => {
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    const codigo = codigoDeLaApp(inscripcion.secreto, instante);
    servicio.confirmarInscripcionRemota(idJimmy, codigo);

    const asiento = base
      .prepare("SELECT id, valor_nuevo FROM auditoria_log WHERE accion = 'autorizacion_remota_inscrita'")
      .get() as { id: string; valor_nuevo: string };
    expect(JSON.parse(asiento.valor_nuevo)).toEqual({ mecanismo: 'totp', reemplazoUnaAnterior: false });
    expect(asiento.valor_nuevo).not.toContain(inscripcion.secreto);
    expect(asiento.valor_nuevo).not.toContain(codigo);

    const cola = base.prepare('SELECT entidad_tipo, entidad_id, payload FROM sync_cola ORDER BY orden_en_lote').all() as {
      entidad_tipo: string;
      entidad_id: string;
      payload: string;
    }[];
    expect(cola.map((f) => f.entidad_tipo)).toEqual(['usuarios', 'auditoria_log']);
    for (const fila of cola) {
      expect(fila.payload).not.toContain(inscripcion.secreto);
      expect(fila.payload).not.toContain('totp_secreto_cifrado');
      expect(fila.payload).not.toContain('totp_ultimo_paso');
    }
  });
});

// ===========================================================================
describe('Autorización remota por TOTP: la VERIFICACIÓN', () => {
  const MS_POR_PASO = SEGUNDOS_POR_PASO * MILISEGUNDOS_POR_SEGUNDO;

  it('VECTOR DE RFC 6238: con el secreto del apéndice B y T = 59 s, el código 287082 autoriza como remoto', () => {
    // «12345678901234567890» en Base32. El vector de 8 dígitos es 94287082; los
    // 6 que muestra una app son los últimos seis.
    sembrarAutorizacionRemota(repos.usuarios, cifrado, idJimmy, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    instante = 59 * MILISEGUNDOS_POR_SEGUNDO;

    const permiso = servicio.autorizarComoAdministrador('287082', 'cierre_con_diferencia');
    expect(permiso.autenticado).toBe(true);
    expect(permiso.viaDeAutorizacion).toBe('remoto');
    expect(permiso.usuario?.id).toBe(idJimmy);
  });

  it('control del vector: el código de 8 dígitos del RFC NO se acepta, y uno cambiado tampoco', () => {
    sembrarAutorizacionRemota(repos.usuarios, cifrado, idJimmy, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    instante = 59 * MILISEGUNDOS_POR_SEGUNDO;
    expect(servicio.autorizarComoAdministrador('94287082', 'cierre_con_diferencia').codigo).toBe('FORMATO_INVALIDO');
    expect(servicio.autorizarComoAdministrador('287083', 'cierre_con_diferencia').codigo).toBe('PIN_INCORRECTO');
  });

  it('±30 s: el código de un teléfono 30 s ATRASADO o 30 s ADELANTADO se acepta', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    instante += MS_POR_PASO * 3;

    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante - MS_POR_PASO), 'cierre_con_diferencia').autenticado).toBe(true);
    instante += MS_POR_PASO * 3;
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante + MS_POR_PASO), 'cierre_con_diferencia').autenticado).toBe(true);
  });

  it('±60 s (dos pasos): se RECHAZA y cuenta como intento, atrasado o adelantado', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    instante += MS_POR_PASO * 5;

    const atrasado = servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante - 2 * MS_POR_PASO), 'cierre_con_diferencia');
    expect(atrasado.autenticado).toBe(false);
    expect(atrasado.codigo).toBe('PIN_INCORRECTO');
    const adelantado = servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante + 2 * MS_POR_PASO), 'cierre_con_diferencia');
    expect(adelantado.autenticado).toBe(false);
    expect(repos.bloqueosDeAutorizacion.obtener('cierre_con_diferencia').intentosFallidos).toBe(2);
  });

  it('el MISMO código no sirve dos veces: CODIGO_YA_USADO, y cuenta como intento', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    instante += MS_POR_PASO * 2;
    const codigo = codigoDeLaApp(secreto, instante);

    expect(servicio.autorizarComoAdministrador(codigo, 'descuento_excedente').autenticado).toBe(true);
    const repetido = servicio.autorizarComoAdministrador(codigo, 'cierre_con_diferencia');
    expect(repetido.autenticado).toBe(false);
    expect(repetido.codigo).toBe('CODIGO_YA_USADO');
    expect(repos.bloqueosDeAutorizacion.obtener('cierre_con_diferencia').intentosFallidos).toBe(1);

    // El código SIGUIENTE sí sirve.
    instante += MS_POR_PASO;
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante), 'cierre_con_diferencia').autenticado).toBe(true);
  });

  it('un código ANTERIOR al último usado tampoco sirve, aunque siga dentro de la ventana', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    instante += MS_POR_PASO * 3;
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante), 'salida_controlada').autenticado).toBe(true);
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante, -1), 'salida_controlada').codigo).toBe('CODIGO_YA_USADO');
  });

  it('el código con el que se CONFIRMÓ la inscripción no sirve para autorizar', () => {
    const inscripcion = servicio.iniciarInscripcionRemota(idJimmy, 'POS pruebas');
    const codigo = codigoDeLaApp(inscripcion.secreto, instante);
    servicio.confirmarInscripcionRemota(idJimmy, codigo);
    expect(servicio.autorizarComoAdministrador(codigo, 'cierre_con_diferencia').codigo).toBe('CODIGO_YA_USADO');
  });

  it('el código remoto NO sirve para iniciar sesión', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    const intento = servicio.autenticar(idJimmy, codigoDeLaApp(secreto, instante, 1));
    expect(intento.autenticado).toBe(false);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
  });

  it('donde no se acepta, un código de 6 dígitos es FORMATO_INVALIDO: no autoriza, no consume intento ni paso', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    const codigo = codigoDeLaApp(secreto, instante, 1);
    const pasoAntes = repos.usuarios.obtenerPorId(idJimmy)?.totpUltimoPaso;

    const intento = servicio.autorizarComoAdministrador(codigo, 'cierre_de_caja_ajena');
    expect(intento.autenticado).toBe(false);
    expect(intento.codigo).toBe('FORMATO_INVALIDO');
    expect(repos.bloqueosDeAutorizacion.obtener('cierre_de_caja_ajena').intentosFallidos).toBe(0);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.totpUltimoPaso).toBe(pasoAntes);
    // Y el mismo código sigue sirviendo donde sí se acepta.
    expect(servicio.autorizarComoAdministrador(codigo, 'salida_controlada').autenticado).toBe(true);
  });

  it('con DOS administradores inscritos, cada código se atribuye a su dueño', () => {
    const rosa = repos.usuarios.crear({ nombre: 'Rosa', rol: 'administrativo', pinHash: generarHashDePin('4321') }).id;
    const deJimmy = inscribir(servicio, idJimmy, instante);
    const deRosa = inscribir(servicio, rosa, instante);

    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(deRosa, instante, 1), 'cierre_con_diferencia').usuario?.id).toBe(rosa);
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(deJimmy, instante, 1), 'cierre_con_diferencia').usuario?.id).toBe(idJimmy);
  });

  it('un código que coincide con DOS administradores a la vez es AMBIGUO: no autoriza, no cuenta intento, no consume ningún paso', () => {
    // Con secretos aleatorios pasa muy rara vez; se fuerza sembrando el mismo.
    const rosa = repos.usuarios.crear({ nombre: 'Rosa', rol: 'administrativo', pinHash: generarHashDePin('4321') }).id;
    sembrarAutorizacionRemota(repos.usuarios, cifrado, idJimmy);
    sembrarAutorizacionRemota(repos.usuarios, cifrado, rosa);

    const intento = servicio.autorizarComoAdministrador(codigoDeLaApp(SECRETO_DE_PRUEBA, instante), 'cierre_con_diferencia');
    expect(intento.autenticado).toBe(false);
    expect(intento.codigo).toBe('CODIGO_AMBIGUO');
    expect(intento.usuario).toBeNull();
    expect(repos.bloqueosDeAutorizacion.obtener('cierre_con_diferencia').intentosFallidos).toBe(0);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.totpUltimoPaso).toBeNull();
    expect(repos.usuarios.obtenerPorId(rosa)?.totpUltimoPaso).toBeNull();
  });

  it('un administrador DADO DE BAJA deja de autorizar con su código', () => {
    const rosa = repos.usuarios.crear({ nombre: 'Rosa', rol: 'administrativo', pinHash: generarHashDePin('4321') }).id;
    const deRosa = inscribir(servicio, rosa, instante);
    repos.usuarios.fijarActivo(rosa, false);
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(deRosa, instante, 1), 'cierre_con_diferencia').autenticado).toBe(false);
  });

  it('un secreto que NO SE PUEDE DESCIFRAR no autoriza ni rompe nada, y la bitácora lo dice sin el secreto', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    cifrado.fallarAlDescifrar = true;

    const intento = servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante, 1), 'cierre_con_diferencia');
    expect(intento.autenticado).toBe(false);
    expect(intento.codigo).toBe('PIN_INCORRECTO');
    expect(bitacora.join('\n')).toContain(idJimmy);
    expect(bitacora.join('\n')).toContain('volver a inscribirse');
    expect(bitacora.join('\n')).not.toContain(secreto);
    // Y el PIN normal sigue autorizando.
    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY, 'cierre_con_diferencia').autenticado).toBe(true);
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
  let secreto: string;

  beforeEach(() => {
    secreto = inscribir(servicio, idJimmy, instante);
  });

  it('la tabla cubre las SEIS superficies, sin huecos', () => {
    // El tipo `Record<SuperficieDeAutorizacion, boolean>` ya lo exige al
    // compilar; esto lo comprueba también en ejecución, por si alguien agregara
    // una superficie con un `as` de por medio.
    //
    // Creció a cinco en la Fase 4.a con `saltar_lote_de_sincronizacion`
    // (pantalla de sincronización, decisión 9 del diseño): NO acepta el
    // remoto, por el mismo alcance mínimo que `cierre_de_caja_ajena`.
    //
    // Creció a seis con `anulacion_de_venta` (docs/ANULACION-DE-VENTA.md §4):
    // tampoco acepta el remoto.
    expect(Object.keys(ACEPTA_PIN_REMOTO).sort()).toEqual([
      'anulacion_de_venta',
      'cierre_con_diferencia',
      'cierre_de_caja_ajena',
      'descuento_excedente',
      'salida_controlada',
      'saltar_lote_de_sincronizacion',
    ]);
  });

  it('las TRES que lo aceptan: el cierre descuadrado, el descuento excedente y, desde el 2026-09-15, la salida controlada', () => {
    expect(ACEPTA_PIN_REMOTO.cierre_con_diferencia).toBe(true);
    expect(ACEPTA_PIN_REMOTO.descuento_excedente).toBe(true);
    expect(ACEPTA_PIN_REMOTO.salida_controlada).toBe(true);
  });

  it('las TRES que NO lo aceptan siguen sin aceptarlo: la ampliación no se hereda', () => {
    expect(ACEPTA_PIN_REMOTO.cierre_de_caja_ajena).toBe(false);
    expect(ACEPTA_PIN_REMOTO.saltar_lote_de_sincronizacion).toBe(false);
    // docs/ANULACION-DE-VENTA.md §4.2: el fraude que este PIN frena es el que un
    // teléfono no puede verificar.
    expect(ACEPTA_PIN_REMOTO.anulacion_de_venta).toBe(false);
  });

  it('y el comportamiento real coincide con la tabla, superficie por superficie', () => {
    // La mitad que de verdad importa: que la tabla no sea una declaración
    // decorativa sino lo que el servicio hace.
    for (const [superficie, acepta] of Object.entries(ACEPTA_PIN_REMOTO)) {
      // Un paso más por superficie: un código no sirve dos veces.
      instante += SEGUNDOS_POR_PASO * MILISEGUNDOS_POR_SEGUNDO;
      const intento = servicio.autorizarComoAdministrador(
        codigoDeLaApp(secreto, instante),
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
  // Desde el 2026-09-15 son TRES: `salida_controlada` se sumó a la pareja.
  const LAS_QUE_ACEPTAN_REMOTO: readonly SuperficieDeAutorizacion[] = [
    'salida_controlada',
    'cierre_con_diferencia',
    'descuento_excedente',
  ];

  for (const bloqueadaConRemoto of LAS_QUE_ACEPTAN_REMOTO) {
    for (const otra of LAS_QUE_ACEPTAN_REMOTO.filter((una) => una !== bloqueadaConRemoto)) {
      it(`bloquear ${bloqueadaConRemoto} no bloquea ${otra}, que SIGUE aceptando el PIN REMOTO`, () => {
        const secreto = inscribir(servicio, idJimmy, instante);
        agotar(bloqueadaConRemoto);

        expect(bloqueada(bloqueadaConRemoto)).toBe(true);

        // La otra sigue aceptando el remoto, que es la mitad que importa: no
        // alcanza con que no esté bloqueada, tiene que seguir autorizando.
        const permiso = servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante, 1), otra);
        expect(permiso.autenticado).toBe(true);
        expect(permiso.viaDeAutorizacion).toBe('remoto');
      });
    }

    it(`y ${bloqueadaConRemoto} bloqueada tampoco acepta el remoto: el candado manda`, () => {
      // La contraparte. Un candado que dejara pasar el PIN remoto no sería un
      // candado: bastaría con tener el otro código para saltarlo.
      const secreto = inscribir(servicio, idJimmy, instante);
      agotar(bloqueadaConRemoto);

      const intento = servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante, 1), bloqueadaConRemoto);
      expect(intento.autenticado).toBe(false);
      expect(intento.codigo).toBe('AUTORIZACION_BLOQUEADA');
    });
  }

  it('agotar la diferencia y el descuento NO impide iniciar sesión ni salir de la app, tampoco con el PIN remoto', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    agotar('cierre_con_diferencia');
    agotar('descuento_excedente');

    expect(bloqueada('cierre_con_diferencia')).toBe(true);
    expect(bloqueada('descuento_excedente')).toBe(true);
    expect(bloqueada('salida_controlada')).toBe(false);
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante, 1), 'salida_controlada').autenticado).toBe(true);
    expect(servicio.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
  });

  it('agotar la SALIDA no bloquea la caja ajena, que sigue aceptando el PIN normal', () => {
    const secreto = inscribir(servicio, idJimmy, instante);
    agotar('salida_controlada');

    expect(bloqueada('salida_controlada')).toBe(true);
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(secreto, instante, 1), 'salida_controlada').codigo).toBe(
      'AUTORIZACION_BLOQUEADA',
    );
    expect(servicio.autorizarComoAdministrador(PIN_DE_JIMMY, 'cierre_de_caja_ajena').autenticado).toBe(
      true,
    );
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
