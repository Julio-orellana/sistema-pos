/**
 * Cuánto vive un access token y cuándo hay que renovarlo.
 *
 * Todo lo de este archivo es **puro**: sin red, sin reloj propio, sin Electron.
 * Recibe el token —o los claims ya leídos— y el instante que le pasen, y
 * devuelve números. Se prueba con una tabla de casos escritos, igual que
 * `reintentos.ts`.
 *
 * ===========================================================================
 * LA REGLA CENTRAL: LA VIDA DEL TOKEN SE MIDE CON EL RELOJ DEL SERVIDOR
 * ===========================================================================
 *
 * **NUNCA se calcula `exp - Date.now()`.** Es la forma evidente y es la
 * equivocada, porque mezcla un instante del servidor con un instante de esta
 * máquina, y `docs/SINCRONIZACION.md` §1.6 advierte que un equipo de
 * escritorio puede desfasarse minutos u horas. Las dos direcciones rompen:
 *
 *   · Reloj ADELANTADO una hora  →  `exp - Date.now()` da negativo  →  la
 *     aplicación renovaría sin parar, en bucle, contra el servidor.
 *   · Reloj ATRASADO una hora    →  da una hora y media  →  la aplicación
 *     esperaría a renovar hasta mucho después de que el token esté muerto.
 *
 * La vida sale de **`exp - iat`**, dos instantes del MISMO reloj —el del
 * servidor que firmó el token—, así que la resta es exacta aunque esta máquina
 * crea que es 1998. A partir de ahí se agenda un `setTimeout` de esa duración,
 * que es un temporizador relativo y tampoco depende del reloj de pared.
 *
 * El desfase se calcula igual, pero **solo para dejarlo en la bitácora
 * técnica**: es un diagnóstico, no una entrada del cálculo.
 */

// ===========================================================================
// LECTURA DEL JWT
// ===========================================================================

/**
 * Los claims que a este módulo le importan de un access token de Supabase.
 *
 * Es un subconjunto a propósito: el token trae más cosas y ninguna hace falta
 * acá.
 */
export interface ClaimsDelToken {
  /** Emitido en, en segundos desde la época. Reloj del SERVIDOR. */
  readonly iat: number;
  /** Vence en, en segundos desde la época. Reloj del SERVIDOR. */
  readonly exp: number;
  /** El rol que las políticas RLS exigen. Vive en `app_metadata`. */
  readonly rol: string | null;
  /** `true` si la sesión es anónima. Las políticas exigen que sea `false`. */
  readonly esAnonimo: boolean;
  /** Correo del usuario, para poder decir en pantalla con quién se conectó. */
  readonly correo: string | null;
}

/**
 * Lee la carga útil de un JWT **SIN VERIFICAR LA FIRMA**, y eso está bien acá
 * por dos razones que conviene dejar escritas para que nadie lo copie a un
 * lugar donde no valga:
 *
 *  1. **No se puede verificar**: la firma se valida con el secreto del
 *     proyecto, que esta aplicación no tiene ni debe tener. Quien verifica es
 *     PostgREST, del otro lado.
 *  2. **No se decide nada de seguridad con esto.** El token acaba de llegar
 *     por HTTPS desde el propio servidor de Auth en la misma petición que lo
 *     pidió, así que es auténtico por transporte; y lo único que se hace con
 *     los claims es (a) calcular cuándo renovar y (b) avisarle al
 *     administrador que se equivocó de usuario. **La barrera real sigue siendo
 *     RLS del lado de la nube**, que sí verifica la firma.
 *
 * Si alguna vez alguien quiere usar esta función para AUTORIZAR algo, la
 * respuesta es no.
 */
export function leerClaimsSinVerificar(accessToken: string): ClaimsDelToken {
  const partes = accessToken.split('.');
  const PARTES_DE_UN_JWT = 3;
  const carga = partes[1];
  if (partes.length !== PARTES_DE_UN_JWT || carga === undefined || carga === '') {
    throw new Error('El access token no tiene la forma de un JWT (cabecera.carga.firma).');
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
  } catch {
    throw new Error('La carga útil del access token no es JSON válido.');
  }
  if (typeof crudo !== 'object' || crudo === null) {
    throw new Error('La carga útil del access token no es un objeto.');
  }

  const campos = crudo as Record<string, unknown>;
  const iat = campos.iat;
  const exp = campos.exp;
  if (typeof iat !== 'number' || typeof exp !== 'number') {
    throw new Error('El access token no trae `iat` y `exp` numéricos; sin ellos no se puede saber cuándo renovarlo.');
  }

  const metadatos = campos.app_metadata;
  const rol =
    typeof metadatos === 'object' && metadatos !== null
      ? ((metadatos as Record<string, unknown>).rol ?? null)
      : null;

  return {
    iat,
    exp,
    rol: typeof rol === 'string' ? rol : null,
    // Ausente se lee como NO anónimo, que es lo que hace GoTrue con las
    // sesiones normales: el claim solo aparece cuando la sesión es anónima.
    esAnonimo: campos.is_anonymous === true,
    correo: typeof campos.email === 'string' ? campos.email : null,
  };
}

// ===========================================================================
// VIDA Y RENOVACIÓN
// ===========================================================================

/**
 * Qué fracción de la vida del token se deja pasar antes de renovar.
 *
 * Con los 900 s medidos, renovar al 75 % significa hacerlo a los 675 s y dejar
 * **225 segundos de colchón** antes del vencimiento. Ese colchón no es
 * decorativo: es el presupuesto de reintentos si la red está caída en ese
 * momento (ver `ESCALERA_DE_RENOVACION_MS`), y con él entran seis intentos
 * antes de que el token muera.
 *
 * Más temprano gastaría refrescos de más contra la cuota del plan gratuito;
 * más tarde dejaría sin margen al primer corte de red.
 */
export const FRACCION_DE_VIDA_PARA_RENOVAR = 0.75;

/**
 * Piso absoluto de la espera, en milisegundos.
 *
 * Protege del caso absurdo —un token de vida cero o negativa por un servidor
 * mal configurado— que si no dejaría a la aplicación renovando en un bucle
 * cerrado contra Auth. Un bucle así no es un error visible: es una aplicación
 * que parece funcionar mientras consume la cuota.
 */
export const ESPERA_MINIMA_MS = 5_000;

/**
 * A partir de cuántos segundos de desfase de reloj vale la pena avisar.
 *
 * **Es el UMBRAL DEL AVISO, no una tolerancia medida**, y el nombre lo dice
 * a propósito: una versión anterior de esta constante se llamaba
 * `TOLERANCIA_DE_RELOJ_MEDIDA_S`, y ese nombre afirmaba más de lo que la
 * medición sostiene.
 *
 * **Lo que sí está medido** contra `pos-pruebas-descartable`, el 2026-09-13,
 * en dos corridas independientes, es una **COTA**: un token vencido deja de
 * servir en algún punto por debajo de los ~33 s después del `exp`.
 *
 *   corrida 1 (cada 5 s):  aceptado en exp+26.0s  →  rechazado en exp+31.0s
 *   corrida 2 (cada 2 s):  aceptado en exp+30.1s  →  rechazado en exp+32.3s
 *
 * Los 30 de acá son **el número redondo que cae dentro de esa cota**, y que
 * además es el valor por omisión habitual de esta clase de tolerancia. **No se
 * midió que sean exactamente 30**: se midió que el token no sobrevive más allá
 * de ~32 s, que es lo que importa para afirmar que la ventana está acotada.
 *
 * **Y NO se usa como margen para renovar.** Renovar tarde confiando en esta
 * tolerancia sería apostar a un comportamiento de la plataforma que puede
 * cambiar sin avisar. Su único uso es decidir cuándo gritar en la bitácora
 * técnica por un reloj mal puesto. Ver CLAUDE.md §4.22.
 */
export const DESFASE_QUE_MERECE_AVISO_S = 30;

/**
 * La COTA medida de cuánto sobrevive un access token después de su `exp`.
 *
 * **Es una cota superior medida, no una tolerancia exacta**, y la diferencia
 * importa: lo que se observó en dos corridas contra `pos-pruebas-descartable`
 * el 2026-09-13 es que el token deja de servir *en algún punto* por debajo de
 * los ~32.3 s; no que la tolerancia sea de 30 (ver `DESFASE_QUE_MERECE_AVISO_S`
 * y CLAUDE.md §4.22). Se redondea hacia ARRIBA a 33 a propósito: para lo que
 * se usa —calcular hasta cuándo un token ya emitido PUDO seguir sirviendo—
 * quedarse corto sería subestimar la exposición, y eso es el error caro.
 *
 * Sirve para una sola cosa: cuando se detecta que la credencial fue revocada,
 * decir hasta qué instante un token ya emitido pudo seguir escribiendo en la
 * nube. Es la cota de la ventana de §1.5 del diseño, la de la terminal robada.
 */
export const COTA_DE_TOLERANCIA_MEDIDA_S = 33;

/**
 * Hasta qué instante un token ya emitido pudo seguir siendo aceptado.
 *
 * `exp` más la cota medida. Se devuelve en milisegundos de época para que
 * quien lo muestre decida el formato.
 */
export function finDeLaVentanaDeExposicion(claims: Pick<ClaimsDelToken, 'exp'>): number {
  const MS_POR_SEGUNDO = 1000;
  return (claims.exp + COTA_DE_TOLERANCIA_MEDIDA_S) * MS_POR_SEGUNDO;
}

/**
 * La vida del token en segundos, medida con el reloj del servidor.
 *
 * `exp` e `iat` los puso el mismo servidor en el mismo instante, así que su
 * resta es exacta sin importar qué hora crea que es esta máquina. Ver la
 * cabecera del archivo.
 */
export function vidaDelTokenEnSegundos(claims: Pick<ClaimsDelToken, 'iat' | 'exp'>): number {
  return claims.exp - claims.iat;
}

/**
 * Dentro de cuántos milisegundos toca renovar, contados desde AHORA.
 *
 * Es una duración relativa, no un instante: se le pasa directo a `setTimeout`,
 * que cuenta con un temporizador propio y no con el reloj de pared.
 */
export function esperaHastaRenovar(claims: Pick<ClaimsDelToken, 'iat' | 'exp'>): number {
  const MS_POR_SEGUNDO = 1000;
  const vida = vidaDelTokenEnSegundos(claims);
  const espera = Math.round(vida * FRACCION_DE_VIDA_PARA_RENOVAR * MS_POR_SEGUNDO);
  return Math.max(espera, ESPERA_MINIMA_MS);
}

/**
 * Cuántos segundos adelantado va el reloj de esta máquina respecto del que
 * firmó el token. Negativo significa atrasado.
 *
 * **Es diagnóstico y nada más.** No entra en ningún cálculo de renovación, a
 * propósito: si entrara, un reloj mal puesto dejaría de ser un dato molesto y
 * pasaría a ser una entrada que puede romper la renovación, que es justo lo
 * que la regla de la cabecera evita.
 */
export function desfaseDeRelojEnSegundos(
  claims: Pick<ClaimsDelToken, 'iat'>,
  ahoraLocalMs: number,
): number {
  const MS_POR_SEGUNDO = 1000;
  return Math.round(ahoraLocalMs / MS_POR_SEGUNDO - claims.iat);
}

/**
 * `true` si el desfase es lo bastante grande como para dejarlo anotado.
 *
 * El umbral son los 30 s de `DESFASE_QUE_MERECE_AVISO_S`: por debajo de eso la
 * nube absorbe el desfase —está medido que tolera al menos 30 s— y anotarlo
 * sería llenar la bitácora de ruido. Por encima, es el riesgo 8.5 del diseño
 * ocurriendo de verdad, y hay que poder verlo.
 */
export function elDesfaseMerecePreocupar(desfaseSegundos: number): boolean {
  return Math.abs(desfaseSegundos) > DESFASE_QUE_MERECE_AVISO_S;
}

// ===========================================================================
// REINTENTOS DE LA RENOVACIÓN
// ===========================================================================

/**
 * La escalera de espera cuando **la renovación** falla.
 *
 * > **NO ES LA DE `reintentos.ts`, Y NO SE PUEDE REUSAR.** Aquella sube hasta
 * > **una hora** entre intentos, y es lo correcto para la cola de subida: un
 * > lote que no subió hoy sube mañana y no se pierde nada. Acá no: el access
 * > token muere a los 900 segundos, así que un peldaño de 30 minutos
 * > significaría **no intentar ni una sola vez** dentro del colchón que queda
 * > antes del vencimiento. La forma de la escalera la impone la vida del
 * > token, no la paciencia del que espera.
 *
 * Con los 225 s de colchón que deja renovar al 75 % de un token de 900 s,
 * estos peldaños dan **seis intentos** antes del `exp`: a los 0, 5, 20, 65,
 * 125 y 185 segundos del primer fallo.
 *
 * El techo de 60 s también es deliberado: pasado el `exp` el access token ya
 * no sirve, pero **el token de refresco sigue vivo**, así que se sigue
 * intentando cada minuto hasta que vuelva la red. Un minuto es barato para el
 * plan gratuito y suficientemente rápido para que la tienda se recupere sola
 * en cuanto haya internet.
 */
const ESPERAS_DE_RENOVACION_MS = {
  /** 5 segundos */
  primera: 5_000,
  /** 15 segundos */
  segunda: 15_000,
  /** 45 segundos */
  tercera: 45_000,
  /** 1 minuto, y de ahí en adelante siempre esta */
  techo: 60_000,
} as const;

export const ESCALERA_DE_RENOVACION_MS: readonly number[] = [
  ESPERAS_DE_RENOVACION_MS.primera,
  ESPERAS_DE_RENOVACION_MS.segunda,
  ESPERAS_DE_RENOVACION_MS.tercera,
  ESPERAS_DE_RENOVACION_MS.techo,
];

/** La misma variación de ±20 % que usa la cola, y por la misma razón. */
export const VARIACION_DE_RENOVACION = 0.2;

/**
 * Cuánto esperar tras el intento de renovación número `intento` (1 es el
 * primer fallo).
 *
 * `azar` se inyecta para que las pruebas fijen la variación en vez de medir un
 * rango: una prueba que solo comprueba «cayó entre 4 y 6 segundos» pasa igual
 * si el cálculo está mal.
 */
export function esperaTrasFalloDeRenovacion(
  intento: number,
  azar: () => number = Math.random,
): number {
  const indice = Math.min(Math.max(intento, 1), ESCALERA_DE_RENOVACION_MS.length) - 1;
  const base = ESCALERA_DE_RENOVACION_MS[indice] ?? ESCALERA_DE_RENOVACION_MS[0] ?? ESPERA_MINIMA_MS;

  const AMPLITUD = 2;
  const desvio = (azar() * AMPLITUD - 1) * VARIACION_DE_RENOVACION;
  return Math.round(base * (1 + desvio));
}
