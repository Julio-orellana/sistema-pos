/**
 * Las dos únicas conversaciones que la terminal tiene con Supabase Auth.
 *
 *   1. `contrasena`  → una vez, cuando el administrador conecta la terminal.
 *   2. `refresco`    → cada vez que hay que renovar el access token.
 *
 * Es una capa DELGADA a propósito: arma la petición, lee la respuesta y
 * devuelve un resultado. No decide cuándo renovar (eso es `vida-del-token.ts`),
 * no decide qué hacer con un fallo (eso es `sesion-de-nube.ts`) y no guarda
 * nada (eso es `credencial.ts`). Está separada para que las otras tres se
 * puedan probar sin red, inyectando un cliente de mentira.
 *
 * ===========================================================================
 * LA CONTRASEÑA NO SE GUARDA, NO SE REGISTRA Y NO SALE EN NINGÚN ERROR
 * ===========================================================================
 *
 * Entra por parámetro, se serializa dentro del cuerpo de UNA petición y no se
 * guarda en ningún campo de ningún objeto. **Ningún mensaje de error de este
 * archivo la incluye ni la insinúa**, tampoco su largo: un mensaje que dijera
 * «la contraseña de 24 caracteres fue rechazada» estaría filtrando a la
 * bitácora técnica —que es un archivo de texto plano— algo que el resto del
 * módulo se esfuerza en no escribir nunca. Hay una prueba que recorre el
 * archivo de credencial y la bitácora buscándola.
 */

import type { ObservadorDelRelojDeLaNube } from './reloj-de-la-nube';

/** Lo que devuelve Auth cuando la cosa sale bien. */
export interface SesionDeAuth {
  readonly accessToken: string;
  readonly tokenDeRefresco: string;
  /**
   * Lo que el servidor dice que dura, en segundos.
   *
   * **NO se usa para agendar la renovación**: para eso vale `exp - iat` del
   * propio token, que es más robusto porque no depende de que este campo
   * venga ni de cuánto tardó la respuesta en llegar. Se conserva para poder
   * compararlo con la vida real en la bitácora y para la comprobación de la
   * pantalla.
   */
  readonly duracionDeclaradaEnSegundos: number | null;
}

/** Lo que devuelve Auth cuando no. */
export interface FalloDeAuth {
  /**
   * Código HTTP, o `undefined` si no hubo respuesta.
   *
   * **La ausencia es el caso de la red caída**, y quien la lea tiene que
   * tratarla como transitoria: es el mismo criterio de `reintentos.ts`.
   */
  readonly estadoHttp?: number;
  /** Mensaje ya legible, sin la contraseña ni ningún token adentro. */
  readonly mensaje: string;
}

export type ResultadoDeAuth =
  | { readonly ok: true; readonly sesion: SesionDeAuth }
  | { readonly ok: false; readonly fallo: FalloDeAuth };

/** Contrato con Supabase Auth, para poder inyectar uno falso en las pruebas. */
export interface ClienteDeAuth {
  iniciarSesionConContrasena(correo: string, contrasena: string): Promise<ResultadoDeAuth>;
  refrescar(tokenDeRefresco: string): Promise<ResultadoDeAuth>;
}

/** Cuánto se espera una respuesta de Auth antes de darla por perdida. */
export const TIEMPO_MAXIMO_DE_AUTH_MS = 20_000;

/** Para expresar ese tope en segundos dentro del mensaje de error. */
const MS_POR_SEGUNDO = 1000;

interface CuerpoDeAuth {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
  readonly error_description?: unknown;
  readonly msg?: unknown;
  readonly error?: unknown;
  /** El código estable de GoTrue: `invalid_credentials`, `validation_failed`, … */
  readonly error_code?: unknown;
}

/**
 * El `error_code` de GoTrue, si vino. Es el dato que de verdad identifica el
 * rechazo: el `msg` es texto para una persona y puede cambiar de redacción,
 * el código no.
 */
function codigoDelCuerpo(cuerpo: CuerpoDeAuth | null): string {
  return typeof cuerpo?.error_code === 'string' && cuerpo.error_code !== '' ? cuerpo.error_code : 'sin error_code';
}

/**
 * Saca un mensaje legible del cuerpo de un error de GoTrue, que según el caso
 * usa `error_description`, `msg` o `error`.
 */
function mensajeDelCuerpo(cuerpo: CuerpoDeAuth | null, estado: number): string {
  const candidatos = [cuerpo?.error_description, cuerpo?.msg, cuerpo?.error];
  for (const candidato of candidatos) {
    if (typeof candidato === 'string' && candidato !== '') {
      return candidato;
    }
  }
  return `Supabase Auth respondió ${String(estado)} sin explicar por qué.`;
}

/** Lo opcional del cliente de Auth: dónde anotar y con qué medir el reloj. */
export interface OpcionesDelClienteDeAuth {
  /**
   * Dónde queda el rechazo, con su código. Va a la bitácora TÉCNICA.
   *
   * **Esto nació de un problema real, el 2026-09-14.** Un ingreso de
   * restauración fue rechazado y la aplicación solo mostró «Supabase rechazó
   * ese correo y esa contraseña»: el `error_code` exacto no quedaba en ningún
   * lado —Auth no recibía ningún registrador, y la causa técnica viaja al
   * renderer dentro de la respuesta IPC sin pasar por `log-tecnico.log`—, así
   * que hubo que reproducirlo por fuera con `curl` para verlo. Con esto, el
   * `invalid_credentials` queda escrito la primera vez.
   */
  readonly registrar?: (mensaje: string) => void;
  /** Mide el reloj de esta máquina contra el del servidor (riesgo 8.5). */
  readonly relojDeLaNube?: ObservadorDelRelojDeLaNube;
}

/** Cliente real, por HTTPS, contra el endpoint de Auth del proyecto. */
export class ClienteDeAuthHttp implements ClienteDeAuth {
  private readonly registrar: (mensaje: string) => void;
  private readonly relojDeLaNube: ObservadorDelRelojDeLaNube | null;

  public constructor(
    private readonly urlDelProyecto: string,
    private readonly llavePublicable: string,
    private readonly fetchImpl: typeof fetch = fetch,
    opciones: OpcionesDelClienteDeAuth = {},
  ) {
    this.registrar = opciones.registrar ?? ((): void => undefined);
    this.relojDeLaNube = opciones.relojDeLaNube ?? null;
  }

  public iniciarSesionConContrasena(correo: string, contrasena: string): Promise<ResultadoDeAuth> {
    return this.pedirToken('password', { email: correo, password: contrasena }, `el ingreso de ${correo}`);
  }

  public refrescar(tokenDeRefresco: string): Promise<ResultadoDeAuth> {
    return this.pedirToken('refresh_token', { refresh_token: tokenDeRefresco }, 'la renovación de la sesión');
  }

  private async pedirToken(
    tipo: 'password' | 'refresh_token',
    cuerpo: Readonly<Record<string, string>>,
    /**
     * Qué se estaba intentando, para la bitácora. **Nunca lleva la contraseña
     * ni el token de refresco**: solo el correo, que no es secreto y ya se
     * registra al iniciar sesión bien.
     */
    queSeIntentaba: string,
  ): Promise<ResultadoDeAuth> {
    const url = `${this.urlDelProyecto.replace(/\/+$/, '')}/auth/v1/token?grant_type=${tipo}`;
    const cancelacion = new AbortController();
    const reloj = setTimeout(() => {
      cancelacion.abort();
    }, TIEMPO_MAXIMO_DE_AUTH_MS);

    const enviadoEn = Date.now();
    try {
      const respuesta = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          apikey: this.llavePublicable,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cuerpo),
        signal: cancelacion.signal,
      });
      this.relojDeLaNube?.observar({
        cabeceraDate: respuesta.headers.get('date'),
        enviadoEn,
        recibidoEn: Date.now(),
      });

      const texto = await respuesta.text();
      let leido: CuerpoDeAuth | null = null;
      try {
        leido = texto === '' ? null : (JSON.parse(texto) as CuerpoDeAuth);
      } catch {
        leido = null;
      }

      if (!respuesta.ok) {
        const mensaje = mensajeDelCuerpo(leido, respuesta.status);
        this.registrar(
          `Auth rechazó ${queSeIntentaba}: HTTP ${String(respuesta.status)} ${codigoDelCuerpo(leido)} «${mensaje}»`,
        );
        return {
          ok: false,
          fallo: { estadoHttp: respuesta.status, mensaje },
        };
      }

      const accessToken = leido?.access_token;
      const refresco = leido?.refresh_token;
      if (typeof accessToken !== 'string' || typeof refresco !== 'string') {
        return {
          ok: false,
          fallo: {
            estadoHttp: respuesta.status,
            mensaje: 'Supabase Auth contestó que sí pero sin los dos tokens; la respuesta no sirve.',
          },
        };
      }

      return {
        ok: true,
        sesion: {
          accessToken,
          tokenDeRefresco: refresco,
          duracionDeclaradaEnSegundos:
            typeof leido?.expires_in === 'number' ? leido.expires_in : null,
        },
      };
    } catch (error) {
      // Sin `estadoHttp`: no hubo respuesta. Quien lo lea sabe que es
      // transitorio, que es lo correcto para un corte de red.
      const detalle = error instanceof Error ? error.message : String(error);
      const agotado = error instanceof Error && error.name === 'AbortError';
      const mensaje = agotado
        ? `Supabase Auth no contestó en ${String(TIEMPO_MAXIMO_DE_AUTH_MS / MS_POR_SEGUNDO)} s.`
        : `No se pudo hablar con Supabase Auth: ${detalle}`;
      // Sin código: no hubo respuesta. Queda igual en la bitácora, porque «no
      // contestó» y «contestó que no» se diagnostican distinto.
      this.registrar(`Auth no contestó a ${queSeIntentaba}: ${mensaje}`);
      return {
        ok: false,
        fallo: {
          mensaje,
        },
      };
    } finally {
      clearTimeout(reloj);
    }
  }
}
