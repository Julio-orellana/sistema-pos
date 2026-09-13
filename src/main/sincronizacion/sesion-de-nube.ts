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
  desfaseDeRelojEnSegundos,
  elDesfaseMerecePreocupar,
  esperaHastaRenovar,
  esperaTrasFalloDeRenovacion,
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
}

export class SesionDeNube {
  private readonly auth: ClienteDeAuth;
  private readonly credencial: AlmacenDeCredencial;
  private readonly ahora: () => number;
  private readonly programar: (accion: () => void, ms: number) => unknown;
  private readonly cancelar: (identificador: unknown) => void;
  private readonly registrar: (mensaje: string) => void;
  private readonly azar: () => number;

  /** El único temporizador vivo. Uno solo, siempre, como en el planificador. */
  private pendiente: unknown = null;
  private detenido = false;

  private accessToken: string | null = null;
  private claims: ClaimsDelToken | null = null;
  private desfase: number | null = null;
  private fallidas = 0;
  private motivo: string | null = null;

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
    };
  }

  /**
   * El access token vigente, o `null`.
   *
   * Lo va a usar el `SupabaseSyncProvider` de la fase 3.b. Devuelve `null` sin
   * dramatizar cuando no hay: la cola sigue llenándose igual, que es el
   * comportamiento correcto y ya está construido (§4.18).
   */
  public accessTokenVigente(): string | null {
    return this.accessToken;
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
    const guardado = this.credencial.leer();
    if (guardado === null) {
      this.motivo =
        this.credencial.ultimoMotivo ??
        'No hay ninguna credencial guardada. Conectá la terminal desde la pantalla «Conectar con la nube».';
      this.registrar(this.motivo);
      return;
    }
    await this.renovar();
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

    const guardado = this.credencial.leer();
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

    /*
      ======================================================================
      TODO(sincronizacion, fase 3.a — SEGUNDA MITAD): distinguir «no hay red»
      de «esta credencial fue REVOCADA», y actuar distinto.
      ======================================================================

      HOY TODO FALLO SE REINTENTA IGUAL, incluido un 401. Es deliberado y es
      lo conservador —una credencial que sigue siendo válida nunca se
      descarta por un problema de red—, pero está incompleto en dos cosas
      que hay que construir:

        1. Un 401 al REFRESCAR significa que el token de refresco ya no
           sirve: usuario borrado, baneado o contraseña cambiada (§1.6).
           Reintentarlo cada minuto para siempre no lo va a arreglar y
           consume cuota del plan gratuito sin ningún beneficio.
        2. Falta el estado «sin credencial» visible: la barra de estado en
           rojo, con la fecha desde la que está así, mientras la cola sigue
           llenándose sin poder subir. La cola YA hace su parte (§4.18); lo
           que falta es que alguien se entere.

      LO QUE EL EXPERIMENTO DEL 2026-09-13 YA DEJÓ RESUELTO, para que quien
      construya esto no lo vuelva a medir (CLAUDE.md §4.22):

        · PostgREST SÍ rechaza un access token vencido, con
          `401 PGRST303 «JWT expired»`.
        · NO hay caché de validación: se probó con un token nunca usado y
          con otro ya usado, y los dos fueron rechazados igual.
        · La tolerancia de reloj es de ~30 segundos después del `exp`.

        Es decir: la ventana tras una revocación está acotada, y vale
        **la vida del token + 30 s**; con los 900 s medidos, 15 min y medio.

      Y UNA PRECISIÓN QUE HAY QUE TENER PRESENTE AL CONSTRUIRLO: la señal de
      «me revocaron» NO es que la API rechace el access token, sino que **el
      REFRESCO devuelva 401**, que es acá. El access token sigue siendo
      válido hasta su `exp` aunque el usuario ya no exista, porque PostgREST
      verifica firma y vencimiento y no si la sesión existe (§1.6).
    */
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
    this.fallidas = 0;
    this.motivo = null;

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
