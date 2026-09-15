/**
 * auth.ts — Hash y verificación del PIN de un usuario.
 *
 * ===========================================================================
 * ESTE MÓDULO NO PUEDE IMPORTARSE DESDE EL RENDERER.
 * ===========================================================================
 * Usa `node:crypto`, que no existe en la ventana. Hay una regla de ESLint que
 * lo impide. La interfaz nunca calcula ni verifica hashes: manda el PIN por
 * IPC y el proceso principal responde si es correcto. Si el renderer pudiera
 * verificar por su cuenta, un renderer comprometido podría decir que sí.
 *
 * ===========================================================================
 * POR QUÉ scrypt Y NO SHA-256
 * ===========================================================================
 * Un PIN de cuatro dígitos tiene solo 10 000 valores posibles. Con SHA-256,
 * una computadora común prueba los 10 000 en una fracción de segundo: si
 * alguien se lleva el archivo .db, saca todos los PIN de la tienda en lo que
 * tarda en abrirlo. SHA-256 está diseñado para ser RÁPIDO, que es exactamente
 * lo contrario de lo que hace falta acá.
 *
 * scrypt está diseñado para ser lento y para exigir memoria, de modo que no se
 * pueda acelerar con hardware especializado. Con los parámetros de abajo cada
 * verificación cuesta decenas de milisegundos: imperceptible para el cajero,
 * y convierte los 10 000 intentos en minutos por usuario en vez de un
 * parpadeo. Sumado al bloqueo por intentos, el ataque en línea es inviable y
 * el ataque contra el archivo robado deja de ser instantáneo.
 *
 * Viene en `node:crypto`, así que no agrega ninguna dependencia externa.
 *
 * ===========================================================================
 * FORMATO DE SERIALIZACIÓN DEL CAMPO pin_hash
 * ===========================================================================
 * Todo se guarda en el campo `pin_hash` que ya existía, en una sola cadena:
 *
 *     scrypt$1$16384$8$1$<sal-en-base64>$<clave-en-base64>
 *     └────┘ │ └───┘ │ │ └────────────┘ └──────────────┘
 *     algo   │  N    r p      sal              clave derivada
 *            └ versión del formato
 *
 * Se eligió una cadena con separadores y no columnas nuevas ni JSON por tres
 * razones concretas:
 *
 *   1. La sal viaja pegada a su hash. Es imposible guardar uno sin el otro o
 *      cruzarlos entre usuarios por un error de consulta.
 *   2. Lleva los PARÁMETROS adentro. El día que haya que endurecer el costo,
 *      los hashes viejos se siguen verificando con sus propios parámetros y se
 *      re-generan al próximo ingreso correcto, sin migración de datos.
 *   3. Lleva ALGORITMO y VERSIÓN adelante. Cambiar de scrypt a otra cosa más
 *      adelante es reconocer el prefijo, no adivinar qué formato tiene la fila.
 *
 * No se reutilizó el formato de `crypt(3)` de Unix porque su codificación en
 * base64 es no estándar y habría que implementarla a mano.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { LARGO_DEL_PIN, tieneFormatoDePinValido } from './pin';

/** Nombre del algoritmo, primer campo del formato serializado. */
const ALGORITMO = 'scrypt';

/** Versión del formato. Si cambia la estructura de la cadena, sube este número. */
const VERSION_DEL_FORMATO = 1;

/**
 * Costo de CPU y memoria de scrypt. 16384 es el valor recomendado por defecto
 * de Node: cuesta unas decenas de milisegundos, que el cajero no percibe.
 */
const COSTO_N = 16384;

/** Tamaño de bloque. Con r=8, scrypt usa alrededor de 16 MB por verificación. */
const TAMANO_DE_BLOQUE_R = 8;

/** Paralelización. 1 es el valor estándar. */
const PARALELIZACION_P = 1;

/** Bytes de sal aleatoria. 16 bytes es lo habitual y de sobra. */
const BYTES_DE_SAL = 16;

/** Bytes de la clave derivada. */
const BYTES_DE_CLAVE = 32;

/** Cuántos campos tiene la cadena serializada. */
const CAMPOS_DEL_FORMATO = 7;

/** Separador entre campos. No aparece en base64, así que no hay ambigüedad. */
const SEPARADOR = '$';

/**
 * ===========================================================================
 * EL CENTINELA «SIN PIN»: un usuario restaurado desde la nube no tiene PIN
 * ===========================================================================
 *
 * Desde la decisión 17 del diseño de sincronización, `pin_hash` y
 * `pin_remoto_hash` **no existen en Postgres**: un usuario que baja de la nube
 * en una restauración (fase 4.b) llega sin ningún hash, no porque se descarte
 * uno sino porque nunca viajó. El esquema local, en cambio, exige
 * `pin_hash NOT NULL CHECK (length(pin_hash) > 0)`.
 *
 * Este valor es lo que se escribe en esa columna para un usuario restaurado.
 * Tiene tres propiedades, y las tres están probadas:
 *
 *   1. **Satisface el CHECK** de la columna: es texto no vacío.
 *   2. **`verificarPin` lo rechaza SIEMPRE, sin lanzar.** No hay ningún PIN de
 *      cuatro dígitos que coincida con él, porque no es un hash: es una marca.
 *      Y no lanza `HASH_ILEGIBLE` como haría con un hash corrupto, porque no
 *      es corrupción: es el estado esperado de todo usuario restaurado.
 *   3. **`generarHashDePin` no puede producirlo**: todo hash real empieza por
 *      `scrypt$`, y este no.
 *
 * El efecto es el de la decisión 15 del diseño —toda restauración resetea
 * todos los PIN, sin excepción— **por construcción y no por una regla aparte**:
 * no hay ningún hash real que un usuario restaurado pueda «recordar», ni
 * siquiera el que tenía antes de que el equipo se perdiera. Nadie entra hasta
 * que un administrador le asigna un PIN nuevo, y eso ocurre dentro de la
 * propia pantalla de restauración, que no se da por terminada mientras un
 * usuario activo siga con esta marca.
 */
export const HASH_SIN_PIN = 'sin-pin';

/** `true` si el hash guardado es un hash de verdad y no el centinela «sin PIN». */
export function tienePin(hashGuardado: string): boolean {
  return hashGuardado !== HASH_SIN_PIN;
}

/** Códigos de error de este módulo. */
export type CodigoErrorDeAuth = 'FORMATO_DE_PIN_INVALIDO' | 'HASH_ILEGIBLE';

/** Error al generar o verificar un PIN. */
export class ErrorDeAuth extends Error {
  public readonly codigo: CodigoErrorDeAuth;

  public constructor(codigo: CodigoErrorDeAuth, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeAuth';
    this.codigo = codigo;
  }
}

/** Parámetros leídos de un hash guardado. */
interface HashDeserializado {
  readonly costoN: number;
  readonly tamanoDeBloque: number;
  readonly paralelizacion: number;
  readonly sal: Buffer;
  readonly clave: Buffer;
}

/**
 * Genera el hash de un PIN nuevo, con una sal aleatoria propia.
 *
 * Dos usuarios con el mismo PIN producen hashes distintos, porque la sal se
 * sortea por separado en cada llamada. Eso impide que alguien que vea la tabla
 * deduzca que dos personas comparten PIN, y anula las tablas precalculadas.
 */
export function generarHashDePin(pin: string): string {
  if (!tieneFormatoDePinValido(pin)) {
    throw new ErrorDeAuth(
      'FORMATO_DE_PIN_INVALIDO',
      `El PIN debe tener exactamente ${String(LARGO_DEL_PIN)} dígitos numéricos.`,
    );
  }

  const sal = randomBytes(BYTES_DE_SAL);
  const clave = scryptSync(pin, sal, BYTES_DE_CLAVE, {
    N: COSTO_N,
    r: TAMANO_DE_BLOQUE_R,
    p: PARALELIZACION_P,
  });

  return [
    ALGORITMO,
    String(VERSION_DEL_FORMATO),
    String(COSTO_N),
    String(TAMANO_DE_BLOQUE_R),
    String(PARALELIZACION_P),
    sal.toString('base64'),
    clave.toString('base64'),
  ].join(SEPARADOR);
}

/** Lee una cadena guardada en pin_hash y devuelve sus partes. */
function deserializarHash(hashGuardado: string): HashDeserializado {
  const partes = hashGuardado.split(SEPARADOR);
  if (partes.length !== CAMPOS_DEL_FORMATO || partes[0] !== ALGORITMO) {
    throw new ErrorDeAuth(
      'HASH_ILEGIBLE',
      'El hash guardado no tiene el formato esperado. La fila está corrupta o viene de otra versión.',
    );
  }

  const [, , costoN, tamanoDeBloque, paralelizacion, sal, clave] = partes;
  if (
    costoN === undefined ||
    tamanoDeBloque === undefined ||
    paralelizacion === undefined ||
    sal === undefined ||
    clave === undefined
  ) {
    throw new ErrorDeAuth('HASH_ILEGIBLE', 'El hash guardado está incompleto.');
  }

  return {
    costoN: Number(costoN),
    tamanoDeBloque: Number(tamanoDeBloque),
    paralelizacion: Number(paralelizacion),
    sal: Buffer.from(sal, 'base64'),
    clave: Buffer.from(clave, 'base64'),
  };
}

/**
 * Verifica un PIN contra un hash guardado.
 *
 * Devuelve `false` —no lanza— cuando el PIN no tiene formato válido: quien
 * llama decide si eso cuenta como intento fallido. La comparación es en tiempo
 * constante con `timingSafeEqual`, para no filtrar información sobre el hash
 * correcto a quien mida cuánto tarda la respuesta.
 *
 * Los parámetros de costo se leen del propio hash guardado y no de las
 * constantes de este archivo: así un hash viejo se sigue verificando aunque
 * mañana subamos el costo para los nuevos.
 */
export function verificarPin(pin: string, hashGuardado: string): boolean {
  if (!tieneFormatoDePinValido(pin)) {
    return false;
  }

  // Un usuario restaurado no tiene PIN: ningún PIN coincide, y no es un error.
  // Ver `HASH_SIN_PIN`. Va ANTES de deserializar, porque el centinela no tiene
  // la forma de un hash y `deserializarHash` lo tomaría por una fila corrupta.
  if (!tienePin(hashGuardado)) {
    return false;
  }

  const guardado = deserializarHash(hashGuardado);
  const candidata = scryptSync(pin, guardado.sal, guardado.clave.length, {
    N: guardado.costoN,
    r: guardado.tamanoDeBloque,
    p: guardado.paralelizacion,
  });

  if (candidata.length !== guardado.clave.length) {
    return false;
  }
  return timingSafeEqual(candidata, guardado.clave);
}

/** Parámetros con los que se generó un hash, para diagnóstico y auditoría. */
export function describirHash(hashGuardado: string): {
  readonly algoritmo: string;
  readonly costoN: number;
  readonly bytesDeSal: number;
  readonly bytesDeClave: number;
} {
  const guardado = deserializarHash(hashGuardado);
  return {
    algoritmo: ALGORITMO,
    costoN: guardado.costoN,
    bytesDeSal: guardado.sal.length,
    bytesDeClave: guardado.clave.length,
  };
}
