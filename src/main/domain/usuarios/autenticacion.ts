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

import { generarHashDePin, verificarPin } from '@shared/auth';
import type { Database } from 'better-sqlite3';

import { ErrorDeNegocio } from '@main/database/errores';
import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import { tieneFormatoDePinValido } from '@shared/pin';
import type { Usuario, ViaDeAutorizacion } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import { exigirPinNoUsado } from './colision-de-pin';
import type {
  RepositorioDeBloqueosDeAutorizacion,
  SuperficieDeAutorizacion,
} from '@main/database/repositories/bloqueos-de-autorizacion';

/**
 * QUÉ SUPERFICIE ACEPTA EL PIN REMOTO, Y CUÁL NO. Una sola tabla, acá.
 *
 * ## Por qué es una tabla y no un argumento de quien llama
 *
 * La verificación dual —probar el PIN normal de todos los administradores y
 * después los remotos, y reportar cuál coincidió— vive desde el Prompt 13 en
 * `autorizarComoAdministrador` y nunca estuvo duplicada. Lo que SÍ estaba
 * repetido era **la política**: cada uno de los cuatro lugares que autoriza
 * escribía `{ aceptaPinRemoto: true }` o `false` a mano, junto al nombre de la
 * superficie. Dos datos que tienen que concordar siempre, decididos en archivos
 * distintos, es una discrepancia esperando a ocurrir: alcanzaba con que alguien
 * copiara un bloque y cambiara el nombre de la superficie sin cambiar el
 * booleano para que una superficie empezara a aceptar un PIN que la
 * documentación dice que no acepta, **sin que nada fallara**.
 *
 * Ahora la política viaja con la superficie y quien llama no puede
 * contradecirla: no hay dónde escribir el booleano.
 *
 * ## Qué acepta cada una, y por qué
 *
 * | Superficie | ¿PIN remoto? | Razón |
 * |---|---|---|
 * | `salida_controlada` | **No** | El PIN remoto se pidió para autorizar diferencias de caja por teléfono. Dárselo además a cerrar la aplicación sería ampliarle el alcance más allá de lo pedido (§4.9). |
 * | `cierre_de_caja_ajena` | **No** | Misma razón de alcance. Además, quien cierra una caja ajena está parado frente a ella. |
 * | `cierre_con_diferencia` | **Sí** | Es el caso para el que el PIN remoto se creó: un descuadre que hay que autorizar por teléfono. |
 * | `descuento_excedente` | **Sí**, desde el 2026-09-11 | **DECISIÓN EXPLÍCITA DE JULIO, no una corrección.** Ver abajo. |
 *
 * ## `descuento_excedente`: por qué cambió, y por qué eso no afloja la regla
 *
 * Nació en el Prompt 19 aceptando **solo** el PIN normal, con este argumento:
 * un permiso creado para un caso que termina sirviendo para varios deja de ser
 * un permiso acotado, así que cada superficie nueva que lo acepte se pide y se
 * decide aparte. El argumento era —y sigue siendo— correcto, y el código decía
 * textualmente que ampliarlo exigía una decisión explícita.
 *
 * **Esa decisión se tomó el 2026-09-11**: Jimmy no siempre está en la tienda y
 * un cliente no puede quedarse esperando en el mostrador a que el dueño
 * vuelva. Así que esto **no corrige un error**: es exactamente el mecanismo que
 * el diseño anterior previó, funcionando como se esperaba. El valor por omisión
 * sigue siendo NO aceptar el remoto.
 *
 * **Y la SEGUNDA vez, el 2026-09-15, fue `salida_controlada`**: Jimmy necesita
 * poder autorizar que se apague el punto de venta al final del día cuando no
 * hay ningún administrador en la tienda. Tampoco corrige un error: la regla de
 * alcance mínimo se aplicó, la ampliación se pidió, y se decidió a propósito.
 * `cierre_de_caja_ajena` y `saltar_lote_de_sincronizacion` siguen sin aceptarlo.
 *
 * La contrapartida de la salida, dicha en voz alta: quien recibe el PIN remoto
 * dictado por teléfono puede, desde ese momento y hasta que se cambie, cerrar la
 * aplicación además de autorizar diferencias y descuentos. Cerrar es ordenado y
 * queda en la auditoría con su vía, así que el daño es acotado; pero el PIN
 * dictado conviene cambiarlo si deja de haber confianza en quien lo escuchó.
 *
 * Queda una contrapartida dicha en voz alta: **un descuento es dinero que sale
 * de la venta**, y autorizarlo por teléfono es aprobarlo sin ver el ticket.
 * Contra eso juega que el monto que se autoriza queda registrado con su vía, su
 * autorizante y su asiento de auditoría, y que la alternativa real no era
 * «autorizarlo mirando» sino «no poder venderlo».
 */
export const ACEPTA_PIN_REMOTO: Readonly<Record<SuperficieDeAutorizacion, boolean>> = {
  // Ampliada por decisión explícita de Julio el 2026-09-15 (ver arriba).
  salida_controlada: true,
  cierre_de_caja_ajena: false,
  cierre_con_diferencia: true,
  descuento_excedente: true,
  /*
    NO acepta el remoto, por alcance mínimo (§4.9 de CLAUDE.md): cada
    superficie nueva empieza en `false` y ampliarla exige una decisión
    explícita, nunca heredarla. Acá el argumento es más fuerte que en
    `cierre_de_caja_ajena`: saltar un lote deja un hueco PERMANENTE en el
    respaldo, y quien lo autoriza tiene que estar viendo la pantalla con el
    error, no recibiendo un código por teléfono.
  */
  saltar_lote_de_sincronizacion: false,
};

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
  /** Un administrador configuró o cambió su PIN de autorización remota. */
  pinRemotoConfigurado: 'pin_remoto_configurado',
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
  /**
   * Con cuál de los dos PIN coincidió, en una autorización administrativa.
   *
   * `'presencial'` = su PIN normal, o sea que estaba ahí. `'remoto'` = su PIN
   * de autorización a distancia, dictado por teléfono. `null` cuando no aplica.
   * Lo determina el sistema según cuál hash coincidió: nunca se le pregunta al
   * cajero cuál está usando.
   */
  readonly viaDeAutorizacion: ViaDeAutorizacion | null;
}

/** Dependencias del servicio. Se inyectan para poder probarlo entero. */
export interface DependenciasDeAutenticacion {
  /**
   * La conexión, para que `crearPrimerAdministrador` pueda ENCOLAR.
   *
   * **No es opcional a propósito.** Este servicio no abría ninguna transacción
   * hasta la fase 3.b, y por eso no la tenía; el día que se descubrió que el
   * primer administrador no llegaba nunca a la nube (§4.25), hacerla opcional
   * habría dejado el hueco abierto en cualquier sitio que se olvidara de
   * pasarla, y en silencio. Con ella obligatoria, el compilador nombra los
   * lugares.
   */
  readonly base: Database;
  readonly usuarios: RepositorioDeUsuarios;
  readonly auditoria: RepositorioDeAuditoria;
  /** Candado por superficie del diálogo de autorización. */
  readonly bloqueosDeAutorizacion: RepositorioDeBloqueosDeAutorizacion;
  /** Reloj inyectable: las pruebas lo reemplazan para no esperar 30 segundos. */
  readonly ahora?: () => number;
}

/**
 * Por cuál de las tres rutas llegó una solicitud de salida controlada.
 *
 * Es un DATO del asiento de auditoría, no una acción distinta: por las tres
 * ocurre el mismo hecho de negocio.
 */
export type OrigenDeSalida = 'atajo_de_teclado' | 'cierre_del_sistema' | 'boton_de_interfaz';

export class ServicioDeAutenticacion {
  private readonly base: Database;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly bloqueos: RepositorioDeBloqueosDeAutorizacion;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeAutenticacion) {
    this.base = dependencias.base;
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
   * administrador lo va a teclear ni cuál de sus dos PIN va a usar.
   *
   * **ES LA ÚNICA PUERTA DE AUTORIZACIÓN DEL SISTEMA**, y la usan las cuatro
   * superficies. Aparece un diálogo, alguien teclea cuatro dígitos, y esta
   * función averigua si corresponden a algún administrador activo y **por cuál
   * vía**: presencial si coincidió su PIN normal, remoto si coincidió el de
   * autorización a distancia.
   *
   * QUÉ SUPERFICIE ACEPTA EL PIN REMOTO NO SE LE PREGUNTA A QUIEN LLAMA: sale
   * de `ACEPTA_PIN_REMOTO`, que está arriba en este mismo archivo. Antes era un
   * argumento, y eso permitía que el nombre de la superficie y su política se
   * escribieran por separado y terminaran discrepando sin que nada fallara.
   *
   * **CADA SUPERFICIE CONSERVA SU PROPIO CANDADO**, y eso no cambia porque dos
   * de ellas acepten ahora el mismo PIN: `cierre_con_diferencia` y
   * `descuento_excedente` comparten qué PIN aceptan y **no** comparten el
   * contador de intentos. Bloquear una no bloquea la otra (§4.8), y hay pruebas
   * de las diez combinaciones cruzadas.
   *
   * Probar contra varios usuarios es deliberado y no debilita nada: el PIN
   * solo autoriza si coincide con el de un administrador real, y el intento
   * fallido cuenta UNA vez para la superficie, no una por administrador.
   */
  public autorizarComoAdministrador(
    pin: string,
    superficie: SuperficieDeAutorizacion = 'salida_controlada',
  ): ResultadoDeAutenticacion {
    const aceptaPinRemoto = ACEPTA_PIN_REMOTO[superficie];
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

    // Dos pasadas, y el orden importa: primero TODOS los PIN normales y
    // después los remotos. Así, si por casualidad el PIN remoto de alguien
    // coincidiera con el PIN normal de otro, gana la lectura presencial, que
    // es la más conservadora de las dos para la auditoría.
    for (const administrador of administradores) {
      if (verificarPin(pin, administrador.pinHash)) {
        return this.autorizacionConcedida(superficie, administrador, 'presencial');
      }
    }

    if (aceptaPinRemoto) {
      for (const administrador of administradores) {
        if (
          administrador.pinRemotoHash !== null &&
          verificarPin(pin, administrador.pinRemotoHash)
        ) {
          return this.autorizacionConcedida(superficie, administrador, 'remoto');
        }
      }
    }

    return this.registrarFalloDeAutorizacion(superficie, candado.intentosFallidos);
  }

  /** Acierto: libera el candado de la superficie y reporta por cuál vía fue. */
  private autorizacionConcedida(
    superficie: SuperficieDeAutorizacion,
    administrador: Usuario,
    via: ViaDeAutorizacion,
  ): ResultadoDeAutenticacion {
    // NO se toca el contador de ingreso del usuario: son superficies distintas.
    this.bloqueos.fijar(superficie, 0, null);
    return this.resultado(
      true,
      'INGRESO_CORRECTO',
      via === 'remoto' ? 'Autorización remota correcta.' : 'Autorización correcta.',
      administrador,
      null,
      via,
    );
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
      /*
        EL CANDADO NO VIAJA, PERO EL HECHO SÍ. §4.8 lo dice con todas las
        letras: `bloqueos_de_autorizacion` es estado operativo de esta
        terminal y se queda acá, pero «el hecho auditable sí viaja:
        `autorizacion_bloqueada` queda en `auditoria_log`, que sí está
        espejada». Hasta la fase 3.b no viajaba, y esa afirmación era falsa.
      */
      conBandejaDeSalida(this.base, () => {
        const asiento = this.auditoria.registrar({
          accion: ACCIONES_DE_AUDITORIA.autorizacionBloqueada,
          entidadTipo: 'autorizacion',
          entidadId: null,
          valorNuevo: { superficie, bloqueadoHasta },
          fecha: new Date(this.ahora()).toISOString(),
        });
        return {
          resultado: undefined,
          entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
        };
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

    /*
      ===================================================================
      ENCOLA, Y ESO NO ES UN DETALLE: SIN ESTO NO SE SINCRONIZA NADA
      ===================================================================
      Hasta la fase 3.b esto escribía las dos filas sueltas, sin transacción y
      **sin encolar**. La consecuencia se descubrió corriendo una venta real
      contra Postgres: `auditoria_log.usuario_id` tiene llave foránea hacia
      `usuarios`, y **todo** asiento de auditoría de la tienda lleva el id de
      quien hizo la operación. Con el primer administrador sin subir, el primer
      lote que se intentara subir moría con `23503` y **la cola quedaba
      detenida para siempre en una instalación nueva**. Ver §4.25.
    */
    return conBandejaDeSalida(this.base, () => {
      const creado = this.usuarios.crear({ nombre, rol: 'administrativo', pinHash });
      const asiento = this.auditoria.registrar({
        usuarioId: creado.id,
        accion: ACCIONES_DE_AUDITORIA.primerAdministradorCreado,
        entidadTipo: 'usuarios',
        entidadId: creado.id,
        valorNuevo: { nombre: creado.nombre, rol: creado.rol },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: creado,
        entradas: [
          { tabla: 'usuarios' as const, id: creado.id, operacion: 'insertar' as const },
          { tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const },
        ],
      };
    });
  }

  /**
   * Configura el PIN de autorización remota de un usuario.
   *
   * REGLA: debe ser DISTINTO de su PIN normal. Este código se dicta por
   * teléfono; si fuera el mismo, dictarlo entregaría también el acceso a su
   * sesión y la separación entera que este PIN existe para lograr quedaría
   * anulada. Se comprueba acá y no en la interfaz: una validación que vive en
   * la pantalla se salta llamando al canal directamente.
   */
  public configurarPinRemoto(usuarioId: string, pin: string): void {
    const usuario = this.usuarios.obtenerPorId(usuarioId);
    if (usuario === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'No se encontró el usuario.',
        `usuario_id inexistente: ${usuarioId}`,
      );
    }
    if (usuario.rol !== 'administrativo') {
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        'Solo un administrador puede tener PIN de autorización remota.',
        `El usuario ${usuarioId} tiene rol ${usuario.rol}.`,
      );
    }
    if (!tieneFormatoDePinValido(pin)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El PIN remoto debe tener cuatro dígitos.',
        `Formato inválido para el PIN remoto del usuario ${usuarioId}.`,
      );
    }
    if (verificarPin(pin, usuario.pinHash)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El PIN remoto debe ser DISTINTO de tu PIN normal. Este se dicta por teléfono: ' +
          'si fuera el mismo, estarías entregando también el acceso a tu sesión.',
        'Se intentó fijar un pin_remoto_hash igual al pin_hash del propio usuario.',
      );
    }

    /*
      Y TAMPOCO PUEDE CHOCAR CON EL DE OTRA PERSONA. La comprobación de arriba
      mira solo el PIN normal de uno mismo, que es un caso distinto: allí lo que
      se protege es no regalar el acceso a la propia sesión al dictar el código
      por teléfono. Acá se protege la ATRIBUCIÓN en la auditoría.

      Este diálogo prueba el PIN contra todos los administradores activos
      —primero los normales, después los remotos— y se queda con el primero que
      coincida (§4.9). Un PIN remoto igual al PIN de otra persona haría que la
      autorización quedara registrada a nombre de quien no la dio.

      Es la MISMA función que usan el alta de usuarios y el cambio de PIN, no
      una copia: la regla tiene que ser una sola, o la colisión entra por la
      puerta que quedó floja. Excluye a uno mismo, no nombra a nadie en el
      rechazo y trata un hash ilegible como que no coincide, igual que allá.
    */
    exigirPinNoUsado(this.usuarios, pin, usuarioId);

    /*
      Encola la fila de `usuarios` y su asiento. **El hash del PIN remoto NO
      viaja**: `COLUMNAS_EXCLUIDAS` de la bandeja de salida lo saca del
      payload (decisión 17), así que lo que sube es el resto de la fila. Se
      encola igual porque `actualizado_en` cambió y el asiento tiene que
      llegar.
    */
    conBandejaDeSalida(this.base, () => {
      this.usuarios.actualizarPinRemotoHash(usuarioId, generarHashDePin(pin));
      const asiento = this.auditoria.registrar({
        usuarioId,
        accion: ACCIONES_DE_AUDITORIA.pinRemotoConfigurado,
        entidadTipo: 'usuarios',
        entidadId: usuarioId,
        // Nunca se registra el PIN ni su hash, solo que se configuró.
        valorNuevo: { configurado: true },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [
          { tabla: 'usuarios' as const, id: usuarioId, operacion: 'actualizar' as const },
          { tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const },
        ],
      };
    });
  }

  /** Registra en auditoría una salida controlada, con su origen. */
  public registrarSalida(
    autorizada: boolean,
    origen: OrigenDeSalida,
    usuarioId: string | null,
    detalle: string,
    autorizadaVia: ViaDeAutorizacion | null = null,
  ): void {
    conBandejaDeSalida(this.base, () => {
      const asiento = this.auditoria.registrar({
        usuarioId,
        accion: autorizada
          ? ACCIONES_DE_AUDITORIA.salidaAutorizada
          : ACCIONES_DE_AUDITORIA.salidaRechazada,
        entidadTipo: 'aplicacion',
        // El origen es un DATO del asiento, no una acción distinta: por las tres
        // rutas ocurre el mismo hecho de negocio.
        // `autorizadaVia` es el mismo dato que guardan el descuento y el cierre
        // de caja: con qué PIN se autorizó. `null` en un rechazo.
        valorNuevo: { origen, detalle, autorizadaVia },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
      };
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
    /*
      **El contador de intentos NO viaja y el asiento SÍ.** `intentos_fallidos`
      y `bloqueado_hasta` son estado operativo de esta terminal (§4.4) y ni
      siquiera existen en Postgres; el hecho de que alguien entró es un hecho
      del negocio y va a `auditoria_log`, que está espejada. Por eso lo único
      que se encola es el asiento.
    */
    conBandejaDeSalida(this.base, () => {
      this.usuarios.fijarEstadoDeBloqueo(usuario.id, 0, null);
      const asiento = this.auditoria.registrar({
        usuarioId: usuario.id,
        accion: ACCIONES_DE_AUDITORIA.ingresoCorrecto,
        entidadTipo: 'usuarios',
        entidadId: usuario.id,
        valorNuevo: { rol: usuario.rol },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
      };
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

    /*
      Igual que el ingreso correcto: el contador se queda acá y el asiento
      viaja. §4.8 lo dice para este caso concreto: «`usuario_bloqueado` […]
      queda en `auditoria_log`, que sí está espejada».
    */
    conBandejaDeSalida(this.base, () => {
      this.usuarios.fijarEstadoDeBloqueo(usuario.id, seBloquea ? 0 : intentos, bloqueadoHasta);
      const asiento = this.auditoria.registrar({
        usuarioId: usuario.id,
        accion: seBloquea
          ? ACCIONES_DE_AUDITORIA.usuarioBloqueado
          : ACCIONES_DE_AUDITORIA.ingresoFallido,
        entidadTipo: 'usuarios',
        entidadId: usuario.id,
        valorNuevo: { intentosFallidos: intentos, bloqueadoHasta },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
      };
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
    viaDeAutorizacion: ViaDeAutorizacion | null = null,
  ): ResultadoDeAutenticacion {
    return { autenticado, codigo, mensaje, usuario, segundosParaReintentar, viaDeAutorizacion };
  }
}
