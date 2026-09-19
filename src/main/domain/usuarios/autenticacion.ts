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
import type { Database } from 'better-sqlite3';

import { ErrorDeNegocio } from '@main/database/errores';
import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import { tieneFormatoDePinValido } from '@shared/pin';
import type { Usuario, ViaDeAutorizacion } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import type { CifradoSeguro } from '@main/sincronizacion/credencial';
import { LogTecnicoSilencioso, type LogTecnico } from '@main/log-tecnico';
import { generarSecretoTotp, pasoQueCoincide, tieneFormatoDeCodigoTotp, uriOtpauth } from './totp';
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
 * «Remoto» es, desde la migración 036, el código de seis dígitos de la app de
 * autenticación (TOTP). Hasta entonces era un PIN remoto fijo de cuatro
 * dígitos; la tabla y sus razones no cambiaron con el mecanismo.
 *
 * | Superficie | ¿Remoto? | Razón |
 * |---|---|---|
 * | `cierre_con_diferencia` | **Sí** | Es el caso para el que la autorización remota se creó: un descuadre que hay que autorizar por teléfono. |
 * | `descuento_excedente` | **Sí**, desde el 2026-09-11 | **DECISIÓN EXPLÍCITA DE JULIO, no una corrección.** Ver abajo. |
 * | `salida_controlada` | **Sí**, desde el 2026-09-15 | Segunda decisión explícita. Ver abajo. |
 * | `cierre_de_caja_ajena` | **No** | Alcance mínimo. Además, quien cierra una caja ajena está parado frente a ella. |
 * | `saltar_lote_de_sincronizacion` | **No** | El hueco que deja es permanente: quien autoriza tiene que ver el error. |
 * | `anulacion_de_venta` | **Sí**, desde el 2026-09-19 | **Tercera decisión explícita, a pedido del cliente, y la primera que deshace una defensa de seguridad.** Hasta ese día: ~~No. Por teléfono lo que se autoriza es un relato (docs/ANULACION-DE-VENTA.md §4.2).~~ Ver abajo. |
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
 * La contrapartida de la salida, dicha en voz alta: con el PIN remoto FIJO,
 * quien lo escuchaba una vez podía cerrar la aplicación hasta que se cambiara.
 * Con TOTP (migración 036) el código dictado sirve una sola vez y como mucho
 * unos 90 segundos, así que esa exposición se acota a una autorización.
 *
 * Queda una contrapartida dicha en voz alta: **un descuento es dinero que sale
 * de la venta**, y autorizarlo por teléfono es aprobarlo sin ver el ticket.
 * Contra eso juega que el monto que se autoriza queda registrado con su vía, su
 * autorizante y su asiento de auditoría, y que la alternativa real no era
 * «autorizarlo mirando» sino «no poder venderlo».
 *
 * ## `anulacion_de_venta`: la tercera ampliación, y la primera que deshace una defensa de seguridad
 *
 * Hasta el 2026-09-19 NO aceptaba el remoto, por una razón que **sigue siendo
 * cierta** y se deja escrita entera: anular una venta afirma un hecho físico
 * (que el cliente devolvió la mercadería y que el dinero salió del cajón) que un
 * administrador a distancia no puede verificar. Por teléfono lo que se autoriza
 * es un relato. Es además el fraude más común en un punto de venta: se cobra en
 * efectivo, se anula y el dinero queda en el bolsillo de quien anuló. Y mueve
 * más que un descuento: borra del corte el total entero de una venta ya cobrada
 * y sube el inventario (docs/ANULACION-DE-VENTA.md §4.2).
 *
 * Esa razón se sostenía en TRES capas, y las tres cambian juntas: esta tabla, la
 * migración 038 local y su espejo 0038 en la nube, que ponían en la base el CHECK
 * `anulaciones_de_venta_solo_presencial`. La 040 y la 0040 lo quitan, y una
 * prueba exige que la base y esta tabla sigan diciendo lo mismo
 * (`anulacion-solo-presencial.test.ts`).
 *
 * **Jimmy pidió poder autorizar anulaciones a distancia, con el riesgo
 * explicado, y Julio lo aprobó el 2026-09-19** (spec 003, CLAUDE.md §4.70). A
 * diferencia del descuento y la salida, esto no amplía una superficie que nunca
 * tuvo más que esta tabla: desarma una defensa puesta a propósito en tres capas.
 * Lo que queda contra el fraude es lo que se REGISTRA: quién pidió, quién
 * autorizó, por qué vía (en la fila y en el asiento `venta_anulada`), el
 * motivo, cada intento fallido y un contador de anulaciones a distancia en el
 * resumen de ventas. Con TOTP, el código dictado sirve una sola vez. Nada de eso
 * lo IMPIDE: deja rastro para encontrarlo después.
 *
 * `cierre_de_caja_ajena` y `saltar_lote_de_sincronizacion` siguen sin aceptarlo:
 * la ampliación no se hereda.
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
  /*
    SÍ acepta el remoto desde el 2026-09-19, a pedido explícito del cliente e
    informado del riesgo (spec 003, CLAUDE.md §4.70). Ver la cabecera.

    HASTA ESE DÍA decía esto, y la razón sigue siendo cierta: «NO acepta el
    remoto (docs/ANULACION-DE-VENTA.md §4.2, decisión 2). Quien autoriza tiene
    que ver que hay un cliente, que la mercadería volvió y que el dinero salió
    del cajón: por teléfono lo que se autoriza es un relato. Y mueve más que un
    descuento: borra del corte el total entero de una venta ya cobrada y sube el
    inventario. Ampliarlo exigiría una decisión explícita, como el descuento y la
    salida.»

    CAMBIA JUNTO CON LA BASE: la 040 (local) y la 0040 (nube) quitan la
    restricción que la 038 y la 0038 pusieron. Con esto en `true` y sin la 040, la
    anulación remota se revertiría entera al escribir su fila.
  */
  anulacion_de_venta: true,
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
  | 'AUTORIZACION_BLOQUEADA'
  /** Un código remoto correcto que ya se usó: sirve una sola vez (RFC 6238 §5.2). Cuenta como intento. */
  | 'CODIGO_YA_USADO'
  /** Un código remoto que coincide con el de DOS administradores a la vez. No cuenta como intento. */
  | 'CODIGO_AMBIGUO';

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
  /**
   * Un administrador se inscribió en la autorización remota por TOTP, o
   * reemplazó su inscripción anterior. Reemplaza a `pin_remoto_configurado`,
   * que se escribía con el PIN remoto fijo.
   */
  autorizacionRemotaInscrita: 'autorizacion_remota_inscrita',
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
  /**
   * El cifrado reversible del secreto de TOTP: `safeStorage` de Electron, el
   * MISMO mecanismo que la credencial de sincronización (§4.23).
   *
   * **No es opcional**: sin él la autorización remota no podría leer ningún
   * secreto, y fallaría en silencio. Con él obligatorio, el compilador nombra
   * los lugares que construyen el servicio.
   */
  readonly cifrado: CifradoSeguro;
  /**
   * Bitácora técnica, para anotar un secreto que no se pudo descifrar. Nunca
   * recibe el secreto ni el código.
   */
  readonly log?: LogTecnico;
  /** Reloj inyectable: las pruebas lo reemplazan para no esperar 30 segundos. */
  readonly ahora?: () => number;
}

/**
 * Cuánto dura una inscripción iniciada y no confirmada: el tiempo de abrir la
 * app de autenticación, escanear el QR y teclear el primer código. Pasado ese
 * tiempo, el secreto que se mostró se descarta sin haberse guardado nunca.
 */
export const VIDA_DE_LA_INSCRIPCION_PENDIENTE_MS = 600_000; // diez minutos

/** Lo que la pantalla necesita para mostrar la inscripción. */
export interface InscripcionIniciada {
  /**
   * El secreto en Base32, para teclearlo a mano en el teléfono. Es la ÚNICA vez
   * que sale del proceso principal, y sale porque tiene que verse en pantalla.
   */
  readonly secreto: string;
  /** La URI `otpauth://` que codifica el QR. */
  readonly uri: string;
  /** Si esta persona ya tenía una inscripción, que esta va a reemplazar. */
  readonly reemplazaUnaAnterior: boolean;
  /** Hasta cuándo se puede confirmar (ISO-8601 UTC). */
  readonly venceEn: string;
}

/** Una inscripción mostrada y todavía no confirmada. Vive SOLO en memoria. */
interface InscripcionPendiente {
  readonly usuarioId: string;
  readonly secreto: string;
  readonly venceEnMs: number;
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
  private readonly cifrado: CifradoSeguro;
  private readonly log: LogTecnico;
  private readonly ahora: () => number;
  /**
   * La inscripción mostrada y no confirmada, si hay una. EN MEMORIA a
   * propósito: un secreto que nadie confirmó no se escribe en ningún lado, y si
   * se cierra la aplicación se pierde, que es lo correcto.
   */
  private inscripcionPendiente: InscripcionPendiente | null = null;

  public constructor(dependencias: DependenciasDeAutenticacion) {
    this.base = dependencias.base;
    this.usuarios = dependencias.usuarios;
    this.auditoria = dependencias.auditoria;
    this.bloqueos = dependencias.bloqueosDeAutorizacion;
    this.cifrado = dependencias.cifrado;
    this.log = dependencias.log ?? new LogTecnicoSilencioso();
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

    /*
      CUÁL DE LOS DOS SE TECLEÓ LO DICE EL LARGO, sin preguntarle al cajero.
      El PIN normal tiene 4 dígitos y el código remoto de TOTP tiene 6, así que
      ya no puede pasar que un mismo número sea las dos cosas a la vez: la regla
      vieja de «probar primero los normales para que gane la lectura
      presencial» dejó de hacer falta.
    */
    if (tieneFormatoDePinValido(pin)) {
      for (const administrador of administradores) {
        if (verificarPin(pin, administrador.pinHash)) {
          return this.autorizacionConcedida(superficie, administrador, 'presencial');
        }
      }
      return this.registrarFalloDeAutorizacion(superficie, candado.intentosFallidos);
    }

    if (aceptaPinRemoto && tieneFormatoDeCodigoTotp(pin)) {
      return this.autorizarConCodigoRemoto(superficie, administradores, pin, candado.intentosFallidos);
    }

    // Una entrada que ni siquiera es un PIN posible para esta superficie no
    // consume intentos: tampoco un código de 6 dígitos donde el remoto no vale.
    return this.resultado(
      false,
      'FORMATO_INVALIDO',
      aceptaPinRemoto
        ? 'Ingresá el PIN de cuatro dígitos o el código de seis dígitos de la aplicación.'
        : 'El PIN debe tener cuatro dígitos.',
      null,
      null,
    );
  }

  /**
   * El código remoto de TOTP contra el secreto de cada administrador activo.
   *
   * CUATRO SALIDAS, y cada una por su razón:
   *
   *   · Coincide con UNO y ese paso no se había usado → autoriza como
   *     `remoto` y CONSUME el paso: el mismo código no sirve dos veces
   *     (RFC 6238 §5.2). Un código dictado por teléfono y escuchado por otra
   *     persona no alcanza para una segunda autorización.
   *   · Coincide con UNO pero ese paso ya se usó → rechaza con
   *     `CODIGO_YA_USADO`, y CUENTA como intento: es un código bien formado
   *     que no autoriza.
   *   · Coincide con DOS O MÁS a la vez → rechaza con `CODIGO_AMBIGUO`, sin
   *     contar intento y sin consumir nada. Con dos secretos distintos pasa
   *     muy rara vez, pero atribuirle la autorización a uno de los dos sería
   *     exactamente la atribución equivocada que §4.7 existe para impedir. El
   *     código siguiente ya no coincide.
   *   · No coincide con nadie → intento fallido, como un PIN equivocado.
   *
   * Un secreto que no se puede descifrar no autoriza ni tumba la verificación:
   * se anota en la bitácora técnica, sin el secreto, y se sigue con los demás.
   */
  private autorizarConCodigoRemoto(
    superficie: SuperficieDeAutorizacion,
    administradores: readonly Usuario[],
    codigo: string,
    intentosPrevios: number,
  ): ResultadoDeAutenticacion {
    const instante = this.ahora();
    const coincidencias: { readonly administrador: Usuario; readonly paso: number }[] = [];
    for (const administrador of administradores) {
      const secreto = this.descifrarSecreto(administrador);
      if (secreto === null) {
        continue;
      }
      const paso = pasoQueCoincide(secreto, codigo, instante);
      if (paso !== null) {
        coincidencias.push({ administrador, paso });
      }
    }

    if (coincidencias.length > 1) {
      return this.resultado(
        false,
        'CODIGO_AMBIGUO',
        'Ese código coincide con el de más de un administrador. Esperá el código siguiente de la aplicación y volvé a intentar.',
        null,
        null,
      );
    }

    const [coincidencia] = coincidencias;
    if (coincidencia === undefined) {
      return this.registrarFalloDeAutorizacion(superficie, intentosPrevios);
    }

    if (!this.usuarios.consumirPasoTotp(coincidencia.administrador.id, coincidencia.paso)) {
      return this.registrarFalloDeAutorizacion(superficie, intentosPrevios, {
        codigo: 'CODIGO_YA_USADO',
        mensaje: 'Ese código ya se usó para otra autorización. Esperá a que la aplicación muestre el siguiente.',
      });
    }

    return this.autorizacionConcedida(superficie, coincidencia.administrador, 'remoto');
  }

  /**
   * El secreto de TOTP en claro, o `null` si no hay o no se puede descifrar.
   *
   * Lo que se anota en la bitácora dice DE QUIÉN y POR QUÉ, y nunca el secreto
   * ni los bytes cifrados.
   */
  private descifrarSecreto(administrador: Usuario): string | null {
    if (administrador.totpSecretoCifrado === null) {
      return null;
    }
    if (!this.cifrado.isEncryptionAvailable()) {
      this.log.registrar(
        'autenticacion',
        `No se pudo verificar la autorización remota de ${administrador.id}: esta máquina no tiene el cifrado del sistema disponible.`,
      );
      return null;
    }
    try {
      return this.cifrado.decryptString(administrador.totpSecretoCifrado);
    } catch {
      this.log.registrar(
        'autenticacion',
        `No se pudo descifrar el secreto de autorización remota de ${administrador.id}. ` +
          'Si cambió el nombre de la aplicación, ningún secreto anterior se puede leer: esa persona tiene que volver a inscribirse.',
      );
      return null;
    }
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

  /**
   * Suma un intento al candado de la superficie y lo bloquea si se agotaron.
   *
   * `sinBloqueo` cambia solo el código y el mensaje del caso que NO bloquea
   * —un código remoto ya usado dice eso y no «PIN incorrecto»—; el conteo de
   * intentos es el mismo.
   */
  private registrarFalloDeAutorizacion(
    superficie: SuperficieDeAutorizacion,
    intentosPrevios: number,
    sinBloqueo: { readonly codigo: CodigoDeAutenticacion; readonly mensaje: string } = {
      codigo: 'PIN_INCORRECTO',
      mensaje: 'PIN incorrecto.',
    },
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

    return this.resultado(false, sinBloqueo.codigo, sinBloqueo.mensaje, null, null);
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
   * Empieza la inscripción de la autorización remota por TOTP de una persona.
   *
   * Genera un secreto nuevo de 160 bits y lo guarda EN MEMORIA, sin escribirlo
   * en ningún lado. Solo se guarda —cifrado— cuando `confirmarInscripcionRemota`
   * recibe un código correcto calculado con él: así se comprueba que el
   * teléfono quedó configurado de verdad antes de reemplazar nada.
   *
   * Solo sobre la PROPIA cuenta: quien llama pasa el usuario de la sesión, nunca
   * uno elegido en la pantalla. Iniciar otra inscripción descarta la anterior
   * sin confirmar.
   *
   * `emisor` es el nombre con el que la app del teléfono muestra la cuenta.
   */
  public iniciarInscripcionRemota(usuarioId: string, emisor: string): InscripcionIniciada {
    const usuario = this.exigirAdministradorActivo(usuarioId);

    // Antes de mostrar nada: un secreto que no se va a poder guardar no se
    // muestra. Si se mostrara, la persona lo cargaría en el teléfono y después
    // la confirmación fallaría sin remedio.
    if (!this.cifrado.isEncryptionAvailable()) {
      throw new ErrorDeNegocio(
        'CIFRADO_NO_DISPONIBLE',
        'Esta computadora no tiene disponible el cifrado del sistema, así que no puede guardar el código de autorización remota.',
        'safeStorage.isEncryptionAvailable() devolvió false al iniciar la inscripción.',
      );
    }

    const secreto = generarSecretoTotp();
    const venceEnMs = this.ahora() + VIDA_DE_LA_INSCRIPCION_PENDIENTE_MS;
    this.inscripcionPendiente = { usuarioId, secreto, venceEnMs };

    return {
      secreto,
      uri: uriOtpauth(emisor, usuario.nombre, secreto),
      reemplazaUnaAnterior: usuario.totpSecretoCifrado !== null,
      venceEn: new Date(venceEnMs).toISOString(),
    };
  }

  /**
   * Confirma la inscripción con el primer código que muestra el teléfono.
   *
   * Tres salidas:
   *
   *   · Código mal formado → se rechaza SIN descartar la inscripción: no se
   *     llegó a comparar nada.
   *   · Código bien formado que no coincide → se DESCARTA la inscripción entera
   *     y no queda NINGÚN rastro: ni fila, ni asiento, ni cola. Para reintentar
   *     hay que empezar de nuevo, con un QR nuevo.
   *   · Código correcto → el secreto se guarda CIFRADO, reemplazando el anterior
   *     si había uno; el código de la confirmación queda consumido, y queda un
   *     asiento que dice que se inscribió, sin el secreto.
   *
   * La colisión de PIN (`colision-de-pin.ts`) NO se comprueba acá, y no es un
   * olvido: el secreto es aleatorio de 160 bits y lo genera el sistema, nunca
   * lo elige una persona.
   */
  public confirmarInscripcionRemota(usuarioId: string, codigo: string): void {
    const pendiente = this.inscripcionPendiente;
    if (pendiente?.usuarioId !== usuarioId || pendiente.venceEnMs < this.ahora()) {
      if (pendiente !== null && pendiente.venceEnMs < this.ahora()) {
        this.inscripcionPendiente = null;
      }
      throw new ErrorDeNegocio(
        'INSCRIPCION_NO_VIGENTE',
        'No hay ninguna inscripción en curso. Empezá de nuevo para ver un código QR nuevo.',
        `No hay inscripción remota vigente para ${usuarioId}.`,
      );
    }

    if (!tieneFormatoDeCodigoTotp(codigo)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El código de la aplicación tiene seis dígitos.',
        'Código de confirmación de inscripción mal formado.',
      );
    }

    const paso = pasoQueCoincide(pendiente.secreto, codigo, this.ahora());
    if (paso === null) {
      this.inscripcionPendiente = null;
      throw new ErrorDeNegocio(
        'CODIGO_DE_INSCRIPCION_INCORRECTO',
        'El código no coincide, así que no se guardó nada. Borrá en la aplicación del teléfono la cuenta que acabás de agregar y empezá de nuevo: se va a mostrar un código QR nuevo.',
        'El código de confirmación no coincide con el secreto pendiente.',
      );
    }

    const usuario = this.exigirAdministradorActivo(usuarioId);
    let cifrado: Buffer;
    try {
      cifrado = this.cifrado.encryptString(pendiente.secreto);
    } catch {
      this.inscripcionPendiente = null;
      throw new ErrorDeNegocio(
        'CIFRADO_NO_DISPONIBLE',
        'No se pudo cifrar el código de autorización remota, así que no se guardó nada. Empezá de nuevo.',
        'safeStorage.encryptString falló al confirmar la inscripción.',
      );
    }

    /*
      Encola la fila de `usuarios` y su asiento, como toda operación de negocio
      (§4.26). **El secreto NO viaja**: `COLUMNAS_EXCLUIDAS` saca
      `totp_secreto_cifrado` y `totp_ultimo_paso` de todo payload, y el asiento
      no lo lleva. La fila se encola porque `actualizado_en` cambió.
    */
    conBandejaDeSalida(this.base, () => {
      this.usuarios.fijarTotpCifrado(usuarioId, cifrado);
      // El código con el que se confirmó ya se vio en pantalla: no sirve para
      // autorizar nada después.
      this.usuarios.consumirPasoTotp(usuarioId, paso);
      const asiento = this.auditoria.registrar({
        usuarioId,
        accion: ACCIONES_DE_AUDITORIA.autorizacionRemotaInscrita,
        entidadTipo: 'usuarios',
        entidadId: usuarioId,
        valorNuevo: { mecanismo: 'totp', reemplazoUnaAnterior: usuario.totpSecretoCifrado !== null },
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

    this.inscripcionPendiente = null;
  }

  /** Descarta la inscripción en curso de esa persona, si hay una. No escribe nada. */
  public cancelarInscripcionRemota(usuarioId: string): void {
    if (this.inscripcionPendiente?.usuarioId === usuarioId) {
      this.inscripcionPendiente = null;
    }
  }

  /** El usuario, si existe, está activo y es administrador; si no, el error que lo dice. */
  private exigirAdministradorActivo(usuarioId: string): Usuario {
    const usuario = this.usuarios.obtenerPorId(usuarioId);
    if (usuario === null) {
      throw new ErrorDeNegocio('REFERENCIA_INEXISTENTE', 'No se encontró el usuario.', `usuario_id inexistente: ${usuarioId}`);
    }
    if (usuario.rol !== 'administrativo' || !usuario.activo) {
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        'Solo un administrador activo puede tener autorización remota.',
        `El usuario ${usuarioId} tiene rol ${usuario.rol} y activo=${String(usuario.activo)}.`,
      );
    }
    return usuario;
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
