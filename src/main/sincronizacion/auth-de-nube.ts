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

/** Cliente real, por HTTPS, contra el endpoint de Auth del proyecto. */
export class ClienteDeAuthHttp implements ClienteDeAuth {
  public constructor(
    private readonly urlDelProyecto: string,
    private readonly llavePublicable: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public iniciarSesionConContrasena(correo: string, contrasena: string): Promise<ResultadoDeAuth> {
    return this.pedirToken('password', { email: correo, password: contrasena });
  }

  public refrescar(tokenDeRefresco: string): Promise<ResultadoDeAuth> {
    return this.pedirToken('refresh_token', { refresh_token: tokenDeRefresco });
  }

  private async pedirToken(
    tipo: 'password' | 'refresh_token',
    cuerpo: Readonly<Record<string, string>>,
  ): Promise<ResultadoDeAuth> {
    const url = `${this.urlDelProyecto.replace(/\/+$/, '')}/auth/v1/token?grant_type=${tipo}`;
    const cancelacion = new AbortController();
    const reloj = setTimeout(() => {
      cancelacion.abort();
    }, TIEMPO_MAXIMO_DE_AUTH_MS);

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

      const texto = await respuesta.text();
      let leido: CuerpoDeAuth | null = null;
      try {
        leido = texto === '' ? null : (JSON.parse(texto) as CuerpoDeAuth);
      } catch {
        leido = null;
      }

      if (!respuesta.ok) {
        return {
          ok: false,
          fallo: { estadoHttp: respuesta.status, mensaje: mensajeDelCuerpo(leido, respuesta.status) },
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
      return {
        ok: false,
        fallo: {
          mensaje: agotado
            ? `Supabase Auth no contestó en ${String(TIEMPO_MAXIMO_DE_AUTH_MS / MS_POR_SEGUNDO)} s.`
            : `No se pudo hablar con Supabase Auth: ${detalle}`,
        },
      };
    } finally {
      clearTimeout(reloj);
    }
  }
}
