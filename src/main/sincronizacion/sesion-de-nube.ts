/**
 * La sesión de la terminal contra Supabase Auth: conectarla una vez y
 * mantenerla viva sola (§1.3 y §1.6 del diseño).
 *
 * Junta las otras tres piezas y no reimplementa ninguna: `auth-de-nube.ts`
 * habla con la red, `credencial.ts` guarda el token de refresco cifrado y
 * `vida-del-token.ts` decide los tiempos. Acá vive solo la coreografía.
 *
 * ===========================================================================
 * EL TOKEN DE REFRESCO ROTA, Y POR ESO SE GUARDA ANTES QUE NADA
 * ===========================================================================
 *
 * Los tokens de refresco de Supabase son **de un solo uso**: cada renovación
 * devuelve uno nuevo y quema el anterior. La consecuencia práctica es dura y
 * hay que tenerla presente al leer `renovar()`: **si una renovación sale bien
 * y no se persiste el token nuevo, la sesión queda perdida** —el viejo ya no
 * sirve y el nuevo no se guardó—, y hay que volver a teclear la contraseña.
 *
 * Por eso lo PRIMERO que hace `aplicarSesion` es escribir la credencial, antes
 * de tocar el estado en memoria, antes de agendar nada y antes de registrar
 * nada en la bitácora. Cualquier cosa que falle después deja el disco correcto.
 *
 * La otra mitad la cubre el propio GoTrue: §1.6 documenta que reutilizar el
 * token padre dentro del mismo linaje devuelve el activo, así que **una
 * respuesta que se pierde en la red no termina la sesión**.
 */

import { ErrorDeNegocio } from '@main/database/errores';

import type { ClienteDeAuth, SesionDeAuth } from './auth-de-nube';
import type { AlmacenDeCredencial } from './credencial';
import {
  COTA_DE_TOLERANCIA_MEDIDA_S,
  desfaseDeRelojEnSegundos,
  elDesfaseMerecePreocupar,
  esperaHastaRenovar,
  esperaTrasFalloDeRenovacion,
  finDeLaVentanaDeExposicion,
  leerClaimsSinVerificar,
  vidaDelTokenEnSegundos,
  type ClaimsDelToken,
} from './vida-del-token';

/**
 * El rol que las políticas de la nube exigen para escribir (§1.2).
 *
 * Va sin tilde a propósito, igual que `'restauracion'`: las políticas de la
 * `0025` y de la `0026` comparan contra este literal exacto, y una tilde
 * devolvería cero filas sin ningún error visible.
 */
export const ROL_DE_LA_TERMINAL = 'terminal';

/**
 * De qué clase es un fallo AL RENOVAR.
 *
 * ===========================================================================
 * NO ES «401 = REVOCADA», Y ESO SE MIDIÓ ANTES DE ESCRIBIRLO
 * ===========================================================================
 *
 * La forma evidente sería mirar el 401, y **habría sido un control que no
 * dispara nunca**. Medido contra `pos-pruebas-descartable` el 2026-09-13,
 * GoTrue contesta **400**, no 401, cuando el token de refresco no sirve:
 *
 *   refresco inventado    -> HTTP 400 {"error_code":"validation_failed",
 *                                      "msg":"Refresh token is not valid"}
 *   contraseña equivocada -> HTTP 400 {"error_code":"invalid_credentials"}
 *   usuario inexistente   -> HTTP 400 {"error_code":"invalid_credentials"}
 *
 * (El 401 sí es lo que devuelve **PostgREST** ante un access token vencido,
 * que es otra cosa completamente distinta y pasa cada 900 s de forma normal.
 * Confundir las dos habría hecho que la aplicación se declarara revocada en
 * cada renovación.)
 *
 * Por eso la regla se escribe **al revés**: se enumera lo que SÍ es
 * transitorio, y todo lo demás se lee como credencial muerta. Es el criterio
 * conservador en la dirección correcta: ante un código nuevo que nadie
 * previó, la aplicación prefiere avisar de más —y que una persona mire— antes
 * que reintentar en bucle una credencial que ya no sirve.
 */
export type ClaseDeFalloDeRenovacion =
  /** Sin red, 5xx, 408, 425, 429. Se reintenta con la escalera. */
  | 'transitorio'
  /** El servidor rechazó la credencial. No se arregla reintentando. */
  | 'credencial_muerta';

const CODIGOS_TRANSITORIOS = {
  tiempoDeEsperaAgotado: 408,
  demasiadoPronto: 425,
  limiteDeTasa: 429,
  primerErrorDelServidor: 500,
} as const;

export function clasificarFalloDeRenovacion(estadoHttp: number | undefined): ClaseDeFalloDeRenovacion {
  // Sin código no hubo respuesta: es el caso de la red caída, el más común.
  if (estadoHttp === undefined) {
    return 'transitorio';
  }
  if (estadoHttp >= CODIGOS_TRANSITORIOS.primerErrorDelServidor) {
    return 'transitorio';
  }
  if (
    estadoHttp === CODIGOS_TRANSITORIOS.tiempoDeEsperaAgotado ||
    estadoHttp === CODIGOS_TRANSITORIOS.demasiadoPronto ||
    estadoHttp === CODIGOS_TRANSITORIOS.limiteDeTasa
  ) {
    return 'transitorio';
  }
  return 'credencial_muerta';
}

/** Lo que la pantalla necesita saber, sin ningún secreto adentro. */
export interface EstadoDeNube {
  /** Hay un archivo de credencial guardado en el disco. */
  readonly hayCredencial: boolean;
  /** Hay un access token vigente en memoria ahora mismo. */
  readonly conectada: boolean;
  /** Con qué usuario, leído de los claims del token. `null` si no hay token. */
  readonly correo: string | null;
  /** El rol que trae el token. Debería ser siempre `'terminal'`. */
  readonly rol: string | null;
  /** `exp - iat`, la vida real que emite este proyecto. */
  readonly vidaDelTokenSegundos: number | null;
  /** Cuánto adelantado va el reloj de esta máquina. Diagnóstico del riesgo 8.5. */
  readonly desfaseDeRelojSegundos: number | null;
  /** `true` si ese desfase pasa la tolerancia medida de PostgREST. */
  readonly relojSospechoso: boolean;
  /** Renovaciones seguidas que fallaron. Cero cuando todo va bien. */
  readonly renovacionesFallidas: number;
  /** Qué pasó la última vez, para mostrarlo. Nunca lleva tokens ni contraseñas. */
  readonly ultimoMotivo: string | null;
  /**
   * `true` cuando hay un archivo de credencial y la última vez que se leyó NO
   * se pudo usar: no se descifró o estaba vacío (§4.52). Es distinto de
   * `revocada` (la nube la rechazó) y de no tener conexión: el arreglo es
   * reconectar. Una sesión buena lo vuelve a `false`.
   */
  readonly credencialIlegible: boolean;

  // --- Credencial revocada (fase 3.a, segunda mitad) ------------------------
  /**
   * `true` cuando el servidor rechazó la credencial y esta terminal quedó
   * **sin credencial útil**: sigue encolando, no puede subir, y solo se sale
   * volviendo a conectar con una contraseña nueva.
   */
  readonly revocada: boolean;
  /** Desde cuándo, en ISO-8601. Es lo que el aviso muestra. */
  readonly revocadaDesde: string | null;
  /**
   * Hasta qué instante un token YA EMITIDO pudo seguir escribiendo en la nube,
   * usando la cota medida de §4.22. Es la ventana de exposición de §1.5.
   */
  readonly exposicionHasta: string | null;
  /** Filas esperando en `sync_cola`, para que el aviso diga cuánto se acumula. */
  readonly filasPendientes: number | null;
}

/** Lo que `conectar` devuelve cuando sale bien. */
export interface ResumenDeConexion {
  readonly correo: string | null;
  readonly rol: string | null;
  readonly vidaDelTokenSegundos: number;
  readonly duracionDeclaradaEnSegundos: number | null;
  readonly desfaseDeRelojSegundos: number;
  readonly relojSospechoso: boolean;
}

export interface DependenciasDeLaSesionDeNube {
  readonly auth: ClienteDeAuth;
  readonly credencial: AlmacenDeCredencial;
  /** Reloj de pared, solo para medir el desfase. Inyectable para las pruebas. */
  readonly ahora?: () => number;
  /** `setTimeout`, inyectable: las pruebas no pueden esperar once minutos. */
  readonly programar?: (accion: () => void, ms: number) => unknown;
  readonly cancelar?: (identificador: unknown) => void;
  readonly registrar?: (mensaje: string) => void;
  /** Variación del backoff. Se inyecta para fijarla en las pruebas. */
  readonly azar?: () => number;
  /**
   * Cuántas filas esperan en `sync_cola`. Opcional: solo sirve para que el
   * aviso de credencial revocada diga cuánto se está acumulando, y la sesión
   * funciona igual sin esto.
   */
  readonly contarPendientes?: () => number;
}

export class SesionDeNube {
  private readonly auth: ClienteDeAuth;
  private readonly credencial: AlmacenDeCredencial;
  private readonly ahora: () => number;
  private readonly programar: (accion: () => void, ms: number) => unknown;
  private readonly cancelar: (identificador: unknown) => void;
  private readonly registrar: (mensaje: string) => void;
  private readonly azar: () => number;
  private readonly contarPendientes: (() => number) | null;

  /** El único temporizador vivo. Uno solo, siempre, como en el planificador. */
  private pendiente: unknown = null;
  private detenido = false;

  private accessToken: string | null = null;
  private claims: ClaimsDelToken | null = null;
  private desfase: number | null = null;
  private fallidas = 0;
  private motivo: string | null = null;
  private revocadaDesde: string | null = null;
  /** El `exp` del último token que se llegó a tener, para la ventana de §1.5. */
  private ultimoExp: number | null = null;
  /** Ver `primerIntentoTerminado`. */
  private intentoDeArranqueTerminado = false;
  /** Ver `EstadoDeNube.credencialIlegible`. */
  private credencialIlegible = false;

  public constructor(dependencias: DependenciasDeLaSesionDeNube) {
    this.auth = dependencias.auth;
    this.credencial = dependencias.credencial;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
    this.programar =
      dependencias.programar ??
      ((accion, ms): unknown => {
        const identificador = setTimeout(accion, ms);
        // Igual que en el planificador: sin `unref`, un temporizador de once
        // minutos dejaría el proceso principal esperando después de que la
        // salida controlada pidió cerrar, y el cierre ordenado se colgaría.
        identificador.unref();
        return identificador;
      });
    this.cancelar =
      dependencias.cancelar ??
      ((identificador): void => {
        clearTimeout(identificador as ReturnType<typeof setTimeout>);
      });
    this.registrar = dependencias.registrar ?? ((): void => undefined);
    this.azar = dependencias.azar ?? Math.random;
    this.contarPendientes = dependencias.contarPendientes ?? null;
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  public estado(): EstadoDeNube {
    return {
      hayCredencial: this.credencial.estado().existe,
      conectada: this.accessToken !== null,
      correo: this.claims?.correo ?? null,
      rol: this.claims?.rol ?? null,
      vidaDelTokenSegundos: this.claims === null ? null : vidaDelTokenEnSegundos(this.claims),
      desfaseDeRelojSegundos: this.desfase,
      relojSospechoso: this.desfase !== null && elDesfaseMerecePreocupar(this.desfase),
      renovacionesFallidas: this.fallidas,
      ultimoMotivo: this.motivo,
      credencialIlegible: this.credencialIlegible,
      revocada: this.revocadaDesde !== null,
      revocadaDesde: this.revocadaDesde,
      exposicionHasta:
        this.revocadaDesde !== null && this.ultimoExp !== null
          ? new Date(finDeLaVentanaDeExposicion({ exp: this.ultimoExp })).toISOString()
          : null,
      filasPendientes: this.contarPendientes === null ? null : this.contarPendientes(),
    };
  }

  /**
   * `true` cuando `arrancar` ya terminó su primer intento: consiguió un token,
   * falló, o no había credencial que probar.
   *
   * **Existe para que «sin token» no se lea como «sin conexión» antes de
   * haber preguntado.** Al abrir la aplicación todavía no hay access token
   * porque la sesión arranca DESPUÉS de mostrar la ventana (§4.50), no porque
   * falte la red. Medido el 2026-09-17: con Auth contestando bien, la barra
   * decía «Nube: sin conexión — 2 pendientes» a los 514 ms, antes de que la
   * renovación terminara, y lo sostenía hasta su siguiente consulta, 20 s
   * después (§4.51). Vive en memoria: un arranque nuevo vuelve a no saber.
   */
  public get primerIntentoTerminado(): boolean {
    return this.intentoDeArranqueTerminado;
  }

  /**
   * El access token vigente, o `null`.
   *
   * Lo va a usar el `SupabaseSyncProvider` de la fase 3.b. Devuelve `null` sin
   * dramatizar cuando no hay: la cola sigue llenándose igual, que es el
   * comportamiento correcto y ya está construido (§4.18).
   */
  public accessTokenVigente(): string | null {
    /*
      REVOCADA = SIN CREDENCIAL, aunque el token de memoria todavía no haya
      vencido. Es una decisión y conviene que esté escrita: cuando el servidor
      rechaza el refresco, el access token que ya se tiene **puede seguir
      funcionando** hasta su `exp` más la cota medida de §4.22 —hasta 15
      minutos y medio con los 900 s del real—, y la aplicación **renuncia a esa
      ventana a propósito**.

      El motivo es que la revocación existe para el escenario de §1.5, la
      terminal robada. Seguir escribiendo con una credencial que el servidor ya
      declaró muerta sería actuar contra lo que el dueño acaba de decidir, y lo
      único que se gana son unos minutos de subida que igual no se pierden: la
      cola vive en SQLite y sube entera al reaprovisionar.
    */
    return this.revocadaDesde === null ? this.accessToken : null;
  }

  // -------------------------------------------------------------------------
  // Conectar: el acto manual de una sola vez (§1.3, paso 2 y 3)
  // -------------------------------------------------------------------------

  /**
   * Inicia sesión con correo y contraseña y guarda **solo** el token de
   * refresco.
   *
   * **LA CONTRASEÑA NO SE GUARDA EN NINGÚN LADO.** Entra por parámetro, se la
   * pasa a `auth.iniciarSesionConContrasena` y sale del alcance al terminar
   * esta función: no se asigna a ningún campo, no se registra en la bitácora y
   * no aparece en ningún mensaje de error. Hay pruebas que lo comprueban
   * leyendo el archivo de credencial y la bitácora.
   */
  public async conectar(correo: string, contrasena: string): Promise<ResumenDeConexion> {
    const resultado = await this.auth.iniciarSesionConContrasena(correo, contrasena);

    if (!resultado.ok) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        this.explicarFalloDeConexion(resultado.fallo.estadoHttp, resultado.fallo.mensaje),
        `Auth respondió ${resultado.fallo.estadoHttp === undefined ? 'sin código' : String(resultado.fallo.estadoHttp)}: ${resultado.fallo.mensaje}`,
      );
    }

    const claims = leerClaimsSinVerificar(resultado.sesion.accessToken);
    this.exigirCredencialDeTerminal(claims);

    this.aplicarSesion(resultado.sesion, claims);
    const desfase = this.desfase ?? 0;

    this.registrar(
      `conectada con ${claims.correo ?? 'un usuario sin correo en el token'}; ` +
        `el token vive ${String(vidaDelTokenEnSegundos(claims))} s y el reloj de esta máquina va ${String(desfase)} s respecto del servidor`,
    );

    return {
      correo: claims.correo,
      rol: claims.rol,
      vidaDelTokenSegundos: vidaDelTokenEnSegundos(claims),
      duracionDeclaradaEnSegundos: resultado.sesion.duracionDeclaradaEnSegundos,
      desfaseDeRelojSegundos: desfase,
      relojSospechoso: elDesfaseMerecePreocupar(desfase),
    };
  }

  /**
   * Rechaza una credencial que no es la de una terminal, **antes de
   * guardarla**.
   *
   * No es una barrera de seguridad —la barrera es RLS— sino un aviso temprano:
   * si el administrador teclea por error su propia cuenta de restauración, la
   * terminal quedaría con una credencial que no puede escribir ni una fila, y
   * el síntoma aparecería mucho después, como lotes rechazados con `42501`. Es
   * mejor decírselo mientras tiene el teclado en la mano.
   */
  private exigirCredencialDeTerminal(claims: ClaimsDelToken): void {
    if (claims.esAnonimo) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Esa sesión es anónima, y las políticas de la nube las rechazan. Usá el usuario de terminal con su correo y contraseña.',
        'is_anonymous = true',
      );
    }
    if (claims.rol !== ROL_DE_LA_TERMINAL) {
      const queTrae = claims.rol === null ? 'ningún rol' : `el rol «${claims.rol}»`;
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `Ese usuario trae ${queTrae}, y la terminal necesita el rol «${ROL_DE_LA_TERMINAL}». ` +
          'No se guardó ninguna credencial. Revisá que sea el usuario de la terminal y no el de restauración.',
        `app_metadata.rol = ${claims.rol ?? 'ausente'}`,
      );
    }
  }

  /** Traduce el fallo de Auth a algo que se pueda leer frente a la pantalla. */
  private explicarFalloDeConexion(estado: number | undefined, mensaje: string): string {
    const CREDENCIAL_RECHAZADA = 400;
    const NO_AUTORIZADO = 401;
    if (estado === undefined) {
      return `No se pudo llegar a Supabase. Revisá la conexión a internet y volvé a intentar. (${mensaje})`;
    }
    if (estado === CREDENCIAL_RECHAZADA || estado === NO_AUTORIZADO) {
      return 'Supabase rechazó ese correo y esa contraseña. Revisá que sean los del usuario de la terminal.';
    }
    return `Supabase respondió con un error al iniciar sesión: ${mensaje}`;
  }

  // -------------------------------------------------------------------------
  // Mantenerse viva sola (§1.6)
  // -------------------------------------------------------------------------

  /**
   * Al arrancar la aplicación: si hay credencial guardada, la usa para
   * conseguir un access token y queda funcionando sola.
   *
   * **No lanza nunca.** Que la nube no esté disponible al encender la
   * computadora de la tienda es normal —el internet puede tardar en levantar—
   * y no puede ser motivo para que el punto de venta no abra. Si falla, se
   * agenda el reintento y la cola sigue llenándose, que es exactamente lo que
   * ya hace el trabajador cuando no hay a quién hablarle.
   */
  public async arrancar(): Promise<void> {
    this.detenido = false;
    // Arrancar RE-VERIFICA contra el servidor: ver el comentario de `renovar`.
    this.revocadaDesde = null;
    const guardado = this.credencial.leer();
    this.credencialIlegible = guardado === null && this.credencial.ultimaLecturaIlegible;
    if (guardado === null) {
      this.motivo =
        this.credencial.ultimoMotivo ??
        'No hay ninguna credencial guardada. Conectá la terminal desde la pantalla «Conectar con la nube».';
      this.registrar(this.motivo);
      this.intentoDeArranqueTerminado = true;
      return;
    }
    await this.renovar();
    this.intentoDeArranqueTerminado = true;
  }

  /**
   * Cambia el access token por uno nuevo con el token de refresco guardado.
   *
   * Público para que las pruebas puedan dispararlo sin esperar al
   * temporizador, igual que hace el planificador.
   */
  public async renovar(): Promise<void> {
    if (this.detenido) {
      return;
    }
    /*
      Ya se sabe que la credencial está muerta: no se vuelve a preguntar por un
      temporizador. **Sí se vuelve a preguntar al ARRANCAR**, porque el estado
      de revocada vive en memoria y no en el disco: un arranque nuevo re-verifica
      contra el servidor en vez de creerle a una decisión vieja. Cuesta una
      petición por arranque y evita que un 400 de plataforma deje a la terminal
      declarada muerta para siempre.
    */
    if (this.revocadaDesde !== null) {
      return;
    }

    const guardado = this.credencial.leer();
    this.credencialIlegible = guardado === null && this.credencial.ultimaLecturaIlegible;
    if (guardado === null) {
      this.olvidarSesionEnMemoria();
      this.motivo = this.credencial.ultimoMotivo ?? 'No hay credencial guardada para renovar.';
      return;
    }

    const resultado = await this.auth.refrescar(guardado);
    /*
      Se vuelve a preguntar DESPUÉS del await, y por un método: entre que la
      petición salió y volvió, la aplicación pudo haber pedido cerrarse.
      TypeScript estrecha `this.detenido` a partir del chequeo de arriba y
      marcaría la comparación directa como siempre falsa, cuando en tiempo de
      ejecución no lo es.
    */
    if (this.fueDetenida()) {
      return;
    }

    if (resultado.ok) {
      const claims = leerClaimsSinVerificar(resultado.sesion.accessToken);
      this.aplicarSesion(resultado.sesion, claims);
      this.registrar(
        `access token renovado; vive ${String(vidaDelTokenEnSegundos(claims))} s y se renovará antes de vencer`,
      );
      return;
    }

    const clase = clasificarFalloDeRenovacion(resultado.fallo.estadoHttp);
    const comoLlego =
      resultado.fallo.estadoHttp === undefined
        ? 'sin respuesta del servidor'
        : `HTTP ${String(resultado.fallo.estadoHttp)}`;

    if (clase === 'credencial_muerta') {
      this.declararRevocada(`${comoLlego}: ${resultado.fallo.mensaje}`);
      return;
    }

    this.fallidas += 1;
    this.motivo = resultado.fallo.mensaje;
    this.registrar(
      `falló la renovación (intento ${String(this.fallidas)}${resultado.fallo.estadoHttp === undefined ? ', sin respuesta del servidor' : `, HTTP ${String(resultado.fallo.estadoHttp)}`}): ${resultado.fallo.mensaje}`,
    );
    this.agendar(esperaTrasFalloDeRenovacion(this.fallidas, this.azar));
  }

  /**
   * Guarda la credencial nueva y agenda la próxima renovación.
   *
   * **El orden importa y no es casual**: primero el disco. Ver la cabecera del
   * archivo, sobre la rotación del token de refresco.
   */
  private aplicarSesion(sesion: SesionDeAuth, claims: ClaimsDelToken): void {
    this.credencial.guardar(sesion.tokenDeRefresco);

    this.accessToken = sesion.accessToken;
    this.claims = claims;
    this.ultimoExp = claims.exp;
    this.fallidas = 0;
    this.motivo = null;
    // La credencial recién guardada se escribió con el cifrado de ESTA
    // aplicación: ya no está dañada.
    this.credencialIlegible = false;
    /*
      Una sesión buena BORRA el estado de revocada. Es el único camino de
      salida, y es el que corresponde: si el servidor volvió a dar tokens, la
      credencial que hay sirve. Pasa al reconectar con contraseña nueva, y
      también en el arranque siguiente si el 400 había sido de plataforma.
    */
    this.revocadaDesde = null;

    this.desfase = desfaseDeRelojEnSegundos(claims, this.ahora());
    if (elDesfaseMerecePreocupar(this.desfase)) {
      this.registrar(
        `AVISO: el reloj de esta máquina va ${String(this.desfase)} s respecto del servidor de Supabase. ` +
          'La renovación no depende del reloj local y sigue funcionando, pero conviene corregirlo en Windows (riesgo 8.5 del diseño).',
      );
    }

    this.agendar(esperaHastaRenovar(claims));
  }

  private agendar(ms: number): void {
    if (this.detenido) {
      return;
    }
    if (this.pendiente !== null) {
      this.cancelar(this.pendiente);
    }
    this.pendiente = this.programar(() => {
      this.pendiente = null;
      void this.renovar();
    }, ms);
  }

  /**
   * La credencial ya no sirve: esta terminal queda **sin credencial**.
   *
   * ===========================================================================
   * NO SE REINTENTA, Y NO SE BORRA EL ARCHIVO
   * ===========================================================================
   *
   * **No se reintenta** porque no hay nada que un reintento arregle: el
   * servidor no dijo «ahora no», dijo «esta credencial no». Reintentar cada
   * minuto para siempre consumiría cuota del plan gratuito sin ningún
   * beneficio, y —peor— dejaría el problema invisible detrás de un contador
   * que sube. Es el mismo criterio con que la cola de subida trata un fallo
   * determinístico (§4.18): detenerse **visiblemente** en vez de girar en
   * falso. Se sale volviendo a conectar desde la pantalla.
   *
   * **No se borra el archivo de credencial**, y es deliberado: si este 400
   * viniera de un problema de plataforma y no de una revocación real,
   * borrarlo habría destruido una credencial que servía. Borrar es
   * irreversible; marcarla muerta en memoria no. Al reconectar se reemplaza
   * sola.
   *
   * **LA COLA SIGUE LLENÁNDOSE Y NO SE PIERDE NADA.** La bandeja de salida
   * escribe en `sync_cola` dentro de la transacción de cada operación de
   * negocio (§4.17) y no sabe ni le importa si hay credencial. Lo que se
   * detiene es la subida, no la venta.
   */
  private declararRevocada(detalle: string): void {
    const yaEstaba = this.revocadaDesde !== null;
    if (!yaEstaba) {
      this.revocadaDesde = new Date(this.ahora()).toISOString();
    }
    this.fallidas = 0;
    this.motivo =
      'La nube rechazó la credencial de esta terminal. Hay que volver a conectarla ' +
      `desde «Conectar con la nube» con una contraseña nueva. (${detalle})`;
    this.olvidarSesionEnMemoria();

    if (!yaEstaba) {
      const pendientes = this.contarPendientes === null ? null : this.contarPendientes();
      const hasta =
        this.ultimoExp === null
          ? 'no se sabe: nunca se llegó a tener un token'
          : new Date(finDeLaVentanaDeExposicion({ exp: this.ultimoExp })).toISOString();
      this.registrar(
        `CREDENCIAL RECHAZADA POR LA NUBE (${detalle}). La terminal queda SIN CREDENCIAL: ` +
          `sigue encolando y no puede subir hasta que alguien la reconecte. ` +
          `Filas esperando en la cola: ${pendientes === null ? 'no se contaron' : String(pendientes)}. ` +
          `Un token ya emitido pudo seguir siendo aceptado hasta ${hasta} ` +
          `(el exp más la cota medida de ${String(COTA_DE_TOLERANCIA_MEDIDA_S)} s, §4.22).`,
      );
    }
  }

  /** Igual que leer `this.detenido`, pero sin que TypeScript lo estreche. */
  private fueDetenida(): boolean {
    return this.detenido;
  }

  private olvidarSesionEnMemoria(): void {
    this.accessToken = null;
    this.claims = null;
  }

  /**
   * Deja de renovar. Se llama al cerrar la aplicación.
   *
   * No borra la credencial: cerrar el punto de venta por la noche no es
   * desconectar la terminal de la nube.
   */
  public detener(): void {
    this.detenido = true;
    if (this.pendiente !== null) {
      this.cancelar(this.pendiente);
      this.pendiente = null;
    }
    this.olvidarSesionEnMemoria();
  }
}
