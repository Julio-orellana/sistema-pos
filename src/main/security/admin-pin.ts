/**
 * Verificación del PIN de administrador.
 *
 * Hoy es la única credencial del sistema y su primer uso es autorizar la
 * salida controlada del modo kiosko. Más adelante, el mismo contrato lo
 * cumplirá el módulo de usuarios para autorizar excepciones de descuento.
 *
 * PROVISIONAL Y DOCUMENTADO COMO TAL: mientras no exista el módulo de
 * usuarios, el PIN se lee de la configuración (variable de entorno). Eso
 * significa que hoy el sistema sabe QUE alguien autorizó, pero no QUIÉN.
 * TODO(usuarios): reemplazar por un verificador contra la tabla de usuarios,
 * con el PIN guardado como hash y con identificación del administrador que
 * autoriza, para que el log de auditoría pueda nombrarlo. Depende del punto 5
 * de "Pendiente de confirmación" en CLAUDE.md (¿un PIN por administrador o uno
 * solo para la tienda?).
 *
 * Este archivo no importa Electron a propósito: recibe su configuración por
 * parámetro y por eso se puede probar entero con Vitest.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** Resultado posible de un intento de autorización. */
export type CodigoResultadoPin =
  | 'PIN_CORRECTO'
  | 'PIN_INCORRECTO'
  | 'PIN_NO_CONFIGURADO'
  | 'FORMATO_INVALIDO'
  | 'DEMASIADOS_INTENTOS';

/** Resultado de verificar un PIN, con todo lo que la auditoría necesita saber. */
export interface ResultadoVerificacionPin {
  readonly autorizado: boolean;
  readonly codigo: CodigoResultadoPin;
  readonly mensaje: string;
  /** Intentos que quedan antes del bloqueo temporal. */
  readonly intentosRestantes: number;
  /** Momento (ISO-8601 UTC) hasta el cual está bloqueado, o `null`. */
  readonly bloqueadoHasta: string | null;
}

/** Contrato de verificación. El módulo de usuarios lo implementará más adelante. */
export interface VerificadorDePinAdministrador {
  verificar(pin: string): ResultadoVerificacionPin;
}

/** Largo mínimo aceptado para un PIN. */
export const LARGO_MINIMO_PIN = 4;

/** Largo máximo aceptado para un PIN. */
export const LARGO_MAXIMO_PIN = 12;

/** Intentos fallidos permitidos antes del bloqueo temporal. */
const INTENTOS_MAXIMOS_POR_DEFECTO = 3;

/** Duración del bloqueo temporal, en segundos. */
const SEGUNDOS_DE_BLOQUEO_POR_DEFECTO = 30;

/** Milisegundos que tiene un segundo. */
const MILISEGUNDOS_POR_SEGUNDO = 1000;

/** Opciones de construcción del verificador. */
export interface OpcionesVerificadorDePin {
  /** PIN esperado, o `null` si no hay ninguno configurado. */
  readonly pinConfigurado: string | null;
  readonly intentosMaximos?: number;
  readonly segundosDeBloqueo?: number;
  /** Reloj inyectable: las pruebas lo reemplazan para no esperar 30 segundos. */
  readonly ahora?: () => number;
}

/** Un PIN válido son solo dígitos, dentro del largo permitido. */
export function tieneFormatoDePinValido(pin: string): boolean {
  if (pin.length < LARGO_MINIMO_PIN || pin.length > LARGO_MAXIMO_PIN) {
    return false;
  }
  return /^[0-9]+$/.test(pin);
}

/**
 * Compara dos PIN en tiempo constante.
 *
 * Se comparan los resúmenes SHA-256 y no las cadenas directamente por dos
 * motivos: `timingSafeEqual` exige que ambos búferes midan lo mismo, y una
 * comparación con `===` termina apenas encuentra el primer carácter distinto,
 * lo que filtra información sobre el PIN correcto a quien mida los tiempos.
 */
function sonElMismoPin(ingresado: string, esperado: string): boolean {
  const resumenIngresado = createHash('sha256').update(ingresado, 'utf8').digest();
  const resumenEsperado = createHash('sha256').update(esperado, 'utf8').digest();
  return timingSafeEqual(resumenIngresado, resumenEsperado);
}

/**
 * Verificador que compara contra un PIN tomado de la configuración.
 *
 * Incluye un limitador de intentos: sin él, un PIN de cuatro dígitos se
 * adivina por fuerza bruta en minutos, y aquí el PIN es lo único que separa a
 * un cajero de cerrar el punto de venta.
 */
export class VerificadorDePinPorConfiguracion implements VerificadorDePinAdministrador {
  private readonly pinConfigurado: string | null;
  private readonly intentosMaximos: number;
  private readonly segundosDeBloqueo: number;
  private readonly ahora: () => number;

  private intentosFallidos = 0;
  private bloqueadoHastaMs: number | null = null;

  public constructor(opciones: OpcionesVerificadorDePin) {
    this.pinConfigurado = opciones.pinConfigurado;
    this.intentosMaximos = opciones.intentosMaximos ?? INTENTOS_MAXIMOS_POR_DEFECTO;
    this.segundosDeBloqueo = opciones.segundosDeBloqueo ?? SEGUNDOS_DE_BLOQUEO_POR_DEFECTO;
    this.ahora = opciones.ahora ?? ((): number => Date.now());
  }

  public verificar(pin: string): ResultadoVerificacionPin {
    const instante = this.ahora();

    if (this.bloqueadoHastaMs !== null && instante < this.bloqueadoHastaMs) {
      return this.resultado(
        false,
        'DEMASIADOS_INTENTOS',
        `Demasiados intentos fallidos. Volvé a intentar después de ${new Date(this.bloqueadoHastaMs).toISOString()}.`,
      );
    }

    // Se cumplió el bloqueo: se levanta y se reinicia el contador.
    if (this.bloqueadoHastaMs !== null && instante >= this.bloqueadoHastaMs) {
      this.bloqueadoHastaMs = null;
      this.intentosFallidos = 0;
    }

    if (this.pinConfigurado === null || this.pinConfigurado.length === 0) {
      return this.resultado(
        false,
        'PIN_NO_CONFIGURADO',
        'No hay PIN de administrador configurado en esta instalación, así que no se puede autorizar la salida.',
      );
    }

    if (!tieneFormatoDePinValido(pin)) {
      // No cuenta como intento fallido: es un error de tecleo, no un intento de
      // adivinar. Contarlo permitiría que un cajero se autobloquee por error.
      return this.resultado(
        false,
        'FORMATO_INVALIDO',
        `El PIN debe tener entre ${String(LARGO_MINIMO_PIN)} y ${String(LARGO_MAXIMO_PIN)} dígitos.`,
      );
    }

    if (sonElMismoPin(pin, this.pinConfigurado)) {
      this.intentosFallidos = 0;
      this.bloqueadoHastaMs = null;
      return this.resultado(true, 'PIN_CORRECTO', 'PIN correcto. Autorización concedida.');
    }

    this.intentosFallidos += 1;
    if (this.intentosFallidos >= this.intentosMaximos) {
      this.bloqueadoHastaMs = instante + this.segundosDeBloqueo * MILISEGUNDOS_POR_SEGUNDO;
      return this.resultado(
        false,
        'DEMASIADOS_INTENTOS',
        `PIN incorrecto. Se alcanzó el máximo de intentos; hay que esperar ${String(this.segundosDeBloqueo)} segundos.`,
      );
    }

    return this.resultado(false, 'PIN_INCORRECTO', 'PIN incorrecto.');
  }

  /** Intentos que quedan antes del bloqueo. */
  public intentosRestantes(): number {
    return Math.max(0, this.intentosMaximos - this.intentosFallidos);
  }

  private resultado(
    autorizado: boolean,
    codigo: CodigoResultadoPin,
    mensaje: string,
  ): ResultadoVerificacionPin {
    return {
      autorizado,
      codigo,
      mensaje,
      intentosRestantes: this.intentosRestantes(),
      bloqueadoHasta: this.bloqueadoHastaMs === null ? null : new Date(this.bloqueadoHastaMs).toISOString(),
    };
  }
}

/** PIN de respaldo para desarrollo, cuando no hay ninguno configurado. */
export const PIN_POR_DEFECTO_EN_DESARROLLO = '0000';

/**
 * Construye el verificador según el entorno.
 *
 * En desarrollo, si no hay PIN configurado se usa uno de respaldo conocido y se
 * avisa por consola: si no, cada sesión de desarrollo terminaría matando el
 * proceso a la fuerza, que es justamente el problema que la salida controlada
 * vino a resolver.
 *
 * En producción NO hay respaldo. Si no hay PIN configurado, la salida
 * controlada queda deshabilitada y lo dice con claridad, en vez de aceptar
 * silenciosamente un PIN que cualquiera podría adivinar.
 */
export function crearVerificadorDePin(
  entorno: Readonly<Record<string, string | undefined>>,
  esProduccion: boolean,
): VerificadorDePinAdministrador {
  const pinDelEntorno = entorno.POS_PIN_ADMINISTRADOR;
  const hayPinConfigurado = pinDelEntorno !== undefined && pinDelEntorno.length > 0;

  if (hayPinConfigurado) {
    return new VerificadorDePinPorConfiguracion({ pinConfigurado: pinDelEntorno });
  }

  if (esProduccion) {
    return new VerificadorDePinPorConfiguracion({ pinConfigurado: null });
  }

  console.warn(
    `[seguridad] No hay POS_PIN_ADMINISTRADOR configurado. En desarrollo se usa el PIN de respaldo ${PIN_POR_DEFECTO_EN_DESARROLLO}. En producción la salida controlada quedaría deshabilitada.`,
  );
  return new VerificadorDePinPorConfiguracion({ pinConfigurado: PIN_POR_DEFECTO_EN_DESARROLLO });
}
