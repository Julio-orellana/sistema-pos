/**
 * Servicio de autenticación: ingreso de usuarios y autorización administrativa.
 *
 * Es el único lugar del sistema donde se decide si un PIN es correcto. Las
 * tres rutas de salida controlada (atajo de teclado, intercepción de Cmd+Q y
 * botón de la interfaz) y la pantalla de ingreso llaman todas aquí: no hay
 * implementaciones paralelas.
 *
 * REGLAS QUE HACE CUMPLIR:
 *
 *   1. El PIN se compara contra el hash guardado del usuario, con scrypt.
 *      Nunca hay un PIN en claro en la base ni un PIN por defecto en el código.
 *   2. DOS CANDADOS SEPARADOS, uno por superficie de uso:
 *        · Ingreso a la aplicación -> candado POR USUARIO
 *          (`usuarios.intentos_fallidos`).
 *        · Diálogo de autorización -> candado POR SUPERFICIE
 *          (`bloqueos_de_autorizacion`), porque allí nadie eligió usuario y no
 *          hay a quién imputarle el intento.
 *      Los dos son de tres intentos y 30 segundos, y los dos se persisten:
 *      reiniciar la aplicación no los borra. Un error en el diálogo de
 *      autorización NO deja a nadie sin poder iniciar sesión. Ver la sección
 *      4.8 de CLAUDE.md.
 *   3. Solo cuenta como intento fallido un PIN con FORMATO VÁLIDO pero
 *      contenido equivocado. Una entrada incompleta o con algo que no sea un
 *      dígito es un error de tecleo y no consume intentos, para que nadie se
 *      autobloquee sin haber intentado adivinar nada.
 *   4. Un usuario bloqueado no puede intentar de nuevo hasta que pase el
 *      bloqueo, aunque el PIN que ingrese ahora sea el correcto.
 *   5. Todo ingreso, correcto o fallido, queda en la bitácora de auditoría.
 */

import { verificarPin } from '@shared/auth';
import { tieneFormatoDePinValido } from '@shared/pin';
import type { Usuario } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import type {
  RepositorioDeBloqueosDeAutorizacion,
  SuperficieDeAutorizacion,
} from '@main/database/repositories/bloqueos-de-autorizacion';

/** Intentos fallidos permitidos antes del bloqueo. */
export const INTENTOS_MAXIMOS = 3;

/** Duración del bloqueo, en segundos. */
export const SEGUNDOS_DE_BLOQUEO = 30;

/** Milisegundos que tiene un segundo. */
const MILISEGUNDOS_POR_SEGUNDO = 1000;

/** Resultado posible de un intento de ingreso. */
export type CodigoDeAutenticacion =
  | 'INGRESO_CORRECTO'
  | 'PIN_INCORRECTO'
  | 'FORMATO_INVALIDO'
  | 'USUARIO_BLOQUEADO'
  | 'USUARIO_INEXISTENTE'
  | 'USUARIO_INACTIVO'
  | 'SIN_ADMINISTRADORES'
  /** El diálogo de autorización está bloqueado. NO implica que un usuario lo esté. */
  | 'AUTORIZACION_BLOQUEADA';

/** Nombres de acción que se escriben en la bitácora de auditoría. */
export const ACCIONES_DE_AUDITORIA = {
  /** Ingreso correcto a la aplicación. */
  ingresoCorrecto: 'ingreso_correcto',
  /** Intento de ingreso rechazado. */
  ingresoFallido: 'ingreso_fallido',
  /** Usuario bloqueado por agotar los intentos. */
  usuarioBloqueado: 'usuario_bloqueado',
  /**
   * Salida controlada de la aplicación autorizada con PIN.
   *
   * Es UN SOLO nombre de acción para las tres rutas de entrada. Por dónde
   * entró la solicitud es un dato del asiento (`origen`), no una acción
   * distinta: desde el punto de vista del negocio es el mismo hecho.
   */
  salidaAutorizada: 'salida_controlada_autorizada',
  /** Intento de salida controlada rechazado. */
  salidaRechazada: 'salida_controlada_rechazada',
  /** Creación del primer administrador en el primer arranque. */
  primerAdministradorCreado: 'primer_administrador_creado',
  /** El diálogo de autorización quedó bloqueado por agotar los intentos. */
  autorizacionBloqueada: 'autorizacion_bloqueada',
} as const;

/** Resultado de un intento de autenticación. */
export interface ResultadoDeAutenticacion {
  readonly autenticado: boolean;
  readonly codigo: CodigoDeAutenticacion;
  /** Mensaje listo para mostrarle a quien está frente a la pantalla. */
  readonly mensaje: string;
  /** Usuario autenticado, o `null` si no lo está. */
  readonly usuario: Usuario | null;
  /**
   * Segundos que faltan para poder reintentar, o `null` si no está bloqueado.
   *
   * Se informa el tiempo pero NUNCA cuántos intentos quedan: quien mira la
   * pantalla por encima del hombro no debe enterarse de cuán cerca está el
   * bloqueo de otra persona.
   */
  readonly segundosParaReintentar: number | null;
}

/** Dependencias del servicio. Se inyectan para poder probarlo entero. */
export interface DependenciasDeAutenticacion {
  readonly usuarios: RepositorioDeUsuarios;
  readonly auditoria: RepositorioDeAuditoria;
  /** Candado por superficie del diálogo de autorización. */
  readonly bloqueosDeAutorizacion: RepositorioDeBloqueosDeAutorizacion;
  /** Reloj inyectable: las pruebas lo reemplazan para no esperar 30 segundos. */
  readonly ahora?: () => number;
}

/** Por cuál de las tres rutas llegó una solicitud de salida controlada. */
export type OrigenDeSalida = 'atajo_de_teclado' | 'cierre_del_sistema' | 'boton_de_interfaz';

export class ServicioDeAutenticacion {
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly bloqueos: RepositorioDeBloqueosDeAutorizacion;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeAutenticacion) {
    this.usuarios = dependencias.usuarios;
    this.auditoria = dependencias.auditoria;
    this.bloqueos = dependencias.bloqueosDeAutorizacion;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /** ¿La instalación todavía no tiene ningún usuario? */
  public requiereConfiguracionInicial(): boolean {
    return this.usuarios.estaVacia();
  }

  /**
   * Intenta autenticar a un usuario concreto con su PIN.
   *
   * Es la función que usa la pantalla de ingreso. La autorización
   * administrativa (para la salida controlada) usa `autorizarComoAdministrador`,
   * que se apoya en esta misma lógica.
   */
  public autenticar(usuarioId: string, pin: string): ResultadoDeAutenticacion {
    const usuario = this.usuarios.obtenerPorId(usuarioId);

    if (usuario === null) {
      return this.resultado(false, 'USUARIO_INEXISTENTE', 'El usuario no existe.', null, null);
    }
    if (!usuario.activo) {
      return this.resultado(false, 'USUARIO_INACTIVO', 'Ese usuario está desactivado.', null, null);
    }

    // El bloqueo se comprueba ANTES que el PIN: un usuario bloqueado no puede
    // entrar aunque acierte, o el bloqueo no serviría de nada.
    const segundosRestantes = this.segundosDeBloqueoRestantes(usuario);
    if (segundosRestantes !== null) {
      return this.resultado(
        false,
        'USUARIO_BLOQUEADO',
        `Usuario bloqueado temporalmente. Volvé a intentar en ${String(segundosRestantes)} segundos.`,
        null,
        segundosRestantes,
      );
    }

    // Una entrada que ni siquiera es un PIN posible es un error de tecleo: no
    // consume intentos ni se registra como intento de adivinar.
    if (!tieneFormatoDePinValido(pin)) {
      return this.resultado(
        false,
        'FORMATO_INVALIDO',
        'El PIN debe tener cuatro dígitos.',
        null,
        null,
      );
    }

    if (verificarPin(pin, usuario.pinHash)) {
      return this.registrarIngresoCorrecto(usuario);
    }
    return this.registrarIngresoFallido(usuario);
  }

  /**
   * Autoriza una acción administrativa con un PIN, sin saber de antemano qué
   * administrador lo va a teclear.
   *
   * Es lo que necesita la salida controlada: aparece un diálogo, alguien
   * teclea cuatro dígitos y hay que averiguar si corresponden a ALGÚN
   * administrador activo. Se prueba contra cada uno hasta encontrarlo, con el
   * mismo limitador de intentos por usuario.
   *
   * Probar contra varios usuarios es deliberado y no debilita nada: el PIN
   * solo autoriza si coincide con el de un administrador real, y el intento
   * fallido se le cuenta a todos los administradores contra los que se probó,
   * lo que hace que la fuerza bruta bloquee la cuenta en tres intentos igual.
   */
  public autorizarComoAdministrador(
    pin: string,
    superficie: SuperficieDeAutorizacion = 'salida_controlada',
  ): ResultadoDeAutenticacion {
    const administradores = this.usuarios.listarPorRol('administrativo');

    if (administradores.length === 0) {
      return this.resultado(
        false,
        'SIN_ADMINISTRADORES',
        'No hay ningún administrador configurado en esta instalación.',
        null,
        null,
      );
    }

    // El candado es de la SUPERFICIE, no de los usuarios: un error acá no deja
    // a nadie sin poder iniciar sesión. Ver la sección 4.8 de CLAUDE.md.
    const candado = this.bloqueos.obtener(superficie);
    const segundosRestantes = this.segundosRestantes(candado.bloqueadoHasta);
    if (segundosRestantes !== null) {
      return this.resultado(
        false,
        'AUTORIZACION_BLOQUEADA',
        `Autorización bloqueada temporalmente. Volvé a intentar en ${String(segundosRestantes)} segundos.`,
        null,
        segundosRestantes,
      );
    }

    // Una entrada que ni siquiera es un PIN posible no consume intentos.
    if (!tieneFormatoDePinValido(pin)) {
      return this.resultado(false, 'FORMATO_INVALIDO', 'El PIN debe tener cuatro dígitos.', null, null);
    }

    for (const administrador of administradores) {
      if (verificarPin(pin, administrador.pinHash)) {
        // Acierto: se libera el candado de la superficie. NO se toca el
        // contador de ingreso del usuario: son dos superficies distintas.
        this.bloqueos.fijar(superficie, 0, null);
        return this.resultado(
          true,
          'INGRESO_CORRECTO',
          'Autorización correcta.',
          administrador,
          null,
        );
      }
    }

    return this.registrarFalloDeAutorizacion(superficie, candado.intentosFallidos);
  }

  /** Suma un intento al candado de la superficie y lo bloquea si se agotaron. */
  private registrarFalloDeAutorizacion(
    superficie: SuperficieDeAutorizacion,
    intentosPrevios: number,
  ): ResultadoDeAutenticacion {
    // UN intento por PIN equivocado, no uno por administrador: el intento es de
    // la superficie, no de cada persona contra la que se comparó.
    const intentos = intentosPrevios + 1;
    const seBloquea = intentos >= INTENTOS_MAXIMOS;
    const bloqueadoHasta = seBloquea
      ? new Date(this.ahora() + SEGUNDOS_DE_BLOQUEO * MILISEGUNDOS_POR_SEGUNDO).toISOString()
      : null;

    this.bloqueos.fijar(superficie, seBloquea ? 0 : intentos, bloqueadoHasta);

    if (seBloquea) {
      this.auditoria.registrar({
        accion: ACCIONES_DE_AUDITORIA.autorizacionBloqueada,
        entidadTipo: 'autorizacion',
        entidadId: null,
        valorNuevo: { superficie, bloqueadoHasta },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return this.resultado(
        false,
        'AUTORIZACION_BLOQUEADA',
        `Demasiados intentos. Autorización bloqueada ${String(SEGUNDOS_DE_BLOQUEO)} segundos.`,
        null,
        SEGUNDOS_DE_BLOQUEO,
      );
    }

    return this.resultado(false, 'PIN_INCORRECTO', 'PIN incorrecto.', null, null);
  }

  /**
   * Crea el primer usuario administrativo de la instalación.
   *
   * Solo funciona si la tabla está COMPLETAMENTE vacía. Sin esa condición
   * sería una puerta para crearse un administrador desde la interfaz en
   * cualquier momento.
   */
  public crearPrimerAdministrador(nombre: string, pinHash: string): Usuario {
    if (!this.usuarios.estaVacia()) {
      throw new Error(
        'Ya existen usuarios: el primer administrador solo puede crearse en una instalación vacía.',
      );
    }

    const creado = this.usuarios.crear({ nombre, rol: 'administrativo', pinHash });
    this.auditoria.registrar({
      usuarioId: creado.id,
      accion: ACCIONES_DE_AUDITORIA.primerAdministradorCreado,
      entidadTipo: 'usuarios',
      entidadId: creado.id,
      valorNuevo: { nombre: creado.nombre, rol: creado.rol },
      fecha: new Date(this.ahora()).toISOString(),
    });
    return creado;
  }

  /** Registra en auditoría una salida controlada, con su origen. */
  public registrarSalida(
    autorizada: boolean,
    origen: OrigenDeSalida,
    usuarioId: string | null,
    detalle: string,
  ): void {
    this.auditoria.registrar({
      usuarioId,
      accion: autorizada
        ? ACCIONES_DE_AUDITORIA.salidaAutorizada
        : ACCIONES_DE_AUDITORIA.salidaRechazada,
      entidadTipo: 'aplicacion',
      // El origen es un DATO del asiento, no una acción distinta: por las tres
      // rutas ocurre el mismo hecho de negocio.
      valorNuevo: { origen, detalle },
      fecha: new Date(this.ahora()).toISOString(),
    });
  }

  /** Segundos que faltan para que se levante el bloqueo de un usuario. */
  private segundosDeBloqueoRestantes(usuario: Usuario): number | null {
    return this.segundosRestantes(usuario.bloqueadoHasta);
  }

  /** Segundos que faltan hasta una fecha de desbloqueo, o `null` si ya pasó. */
  private segundosRestantes(bloqueadoHasta: string | null): number | null {
    if (bloqueadoHasta === null) {
      return null;
    }
    const restanteMs = Date.parse(bloqueadoHasta) - this.ahora();
    if (restanteMs <= 0) {
      return null;
    }
    return Math.ceil(restanteMs / MILISEGUNDOS_POR_SEGUNDO);
  }

  /** Ingreso correcto: limpia el contador y deja asiento. */
  private registrarIngresoCorrecto(usuario: Usuario): ResultadoDeAutenticacion {
    this.usuarios.fijarEstadoDeBloqueo(usuario.id, 0, null);
    this.auditoria.registrar({
      usuarioId: usuario.id,
      accion: ACCIONES_DE_AUDITORIA.ingresoCorrecto,
      entidadTipo: 'usuarios',
      entidadId: usuario.id,
      valorNuevo: { rol: usuario.rol },
      fecha: new Date(this.ahora()).toISOString(),
    });

    const actualizado = this.usuarios.obtenerPorId(usuario.id);
    return this.resultado(true, 'INGRESO_CORRECTO', 'Ingreso correcto.', actualizado, null);
  }

  /** Intento fallido: suma uno al contador y bloquea si se agotaron. */
  private registrarIngresoFallido(usuario: Usuario): ResultadoDeAutenticacion {
    const intentos = usuario.intentosFallidos + 1;
    const seBloquea = intentos >= INTENTOS_MAXIMOS;
    const bloqueadoHasta = seBloquea
      ? new Date(this.ahora() + SEGUNDOS_DE_BLOQUEO * MILISEGUNDOS_POR_SEGUNDO).toISOString()
      : null;

    this.usuarios.fijarEstadoDeBloqueo(usuario.id, seBloquea ? 0 : intentos, bloqueadoHasta);

    this.auditoria.registrar({
      usuarioId: usuario.id,
      accion: seBloquea
        ? ACCIONES_DE_AUDITORIA.usuarioBloqueado
        : ACCIONES_DE_AUDITORIA.ingresoFallido,
      entidadTipo: 'usuarios',
      entidadId: usuario.id,
      valorNuevo: { intentosFallidos: intentos, bloqueadoHasta },
      fecha: new Date(this.ahora()).toISOString(),
    });

    if (seBloquea) {
      return this.resultado(
        false,
        'USUARIO_BLOQUEADO',
        `Demasiados intentos. Usuario bloqueado ${String(SEGUNDOS_DE_BLOQUEO)} segundos.`,
        null,
        SEGUNDOS_DE_BLOQUEO,
      );
    }
    // No se informa cuántos intentos quedan: es información útil para quien
    // está adivinando y para quien mira la pantalla de otro.
    return this.resultado(false, 'PIN_INCORRECTO', 'PIN incorrecto.', null, null);
  }

  private resultado(
    autenticado: boolean,
    codigo: CodigoDeAutenticacion,
    mensaje: string,
    usuario: Usuario | null,
    segundosParaReintentar: number | null,
  ): ResultadoDeAutenticacion {
    return { autenticado, codigo, mensaje, usuario, segundosParaReintentar };
  }
}
