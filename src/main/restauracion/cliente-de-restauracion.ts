/**
 * Cómo la restauración habla con la nube: una sesión EFÍMERA con el rol
 * `restauracion`, lecturas por PostgREST bajo las políticas de la 0025, y
 * descargas de Storage bajo las de la 0026.
 *
 * ===========================================================================
 * LA SESIÓN VIVE EN MEMORIA Y SE DESCARTA. NUNCA TOCA `safeStorage`.
 * ===========================================================================
 *
 * §6.2 del diseño: la credencial de restauración es la que puede LEER TODO, y
 * por eso no se queda en la máquina. Se inicia sesión con correo y contraseña
 * en el momento, los dos tokens viven en un campo de esta clase mientras la
 * pantalla está abierta, y `cerrarSesion()` los revoca en GoTrue y los olvida.
 * La contraseña entra por parámetro y sale del alcance en la misma llamada:
 * no se guarda, no se registra y no aparece en ningún mensaje.
 *
 * Una restauración puede durar más que los 900 s de un access token (§6.6), así
 * que la sesión se renueva sola con el token de refresco, con la misma regla
 * de `vida-del-token.ts`: al 75 % de la vida medida con `exp - iat`, nunca con
 * el reloj local.
 *
 * ===========================================================================
 * SOLO LEE, Y SOLO CON SELECT DIRECTO. NUNCA POR LAS FUNCIONES `sincronizar_*`
 * ===========================================================================
 *
 * Esas funciones son la única puerta de ESCRITURA de la terminal, y exigen el
 * rol `terminal` en su primera línea. La restauración lee tablas con `SELECT`
 * bajo las políticas de lectura del rol `restauracion`, llama al contrato y a
 * la suma por mes —las dos `SECURITY INVOKER`— y baja objetos de Storage. Hay
 * una prueba estructural que comprueba que este archivo no nombra ninguna
 * función `sincronizar_`.
 *
 * ===========================================================================
 * LOS NUMÉRICOS SE PIDEN CON `::text`
 * ===========================================================================
 *
 * PostgREST serializa `NUMERIC` como número JSON, y un número JSON es un
 * `double`. Cada columna numérica se pide como `columna::text`, que PostgREST
 * devuelve con el mismo nombre de columna y como cadena: la representación
 * textual exacta de Postgres, con sus ceros de relleno, que después normaliza
 * `conversion-de-tipos.ts`.
 */

import { z } from 'zod';

import { ErrorDeNegocio } from '@main/database/errores';
import type { ClienteDeAuth } from '@main/sincronizacion/auth-de-nube';
import {
  esperaHastaRenovar,
  leerClaimsSinVerificar,
  type ClaimsDelToken,
} from '@main/sincronizacion/vida-del-token';
import { FUNCION_DEL_CONTRATO, FUNCIONES_DE_RESTAURACION } from '@shared/contrato-de-sincronizacion';
import { columnasNumericasDe, CLASES_DE_COLUMNA, type FilaDeLaNube } from './conversion-de-tipos';
import { esquemaDelContrato, type ContratoDeLaNube } from './deriva-de-esquema';
import { TABLA_QUE_SOLO_SE_VERIFICA } from './orden-de-restauracion';

/** El rol que las políticas de la 0025 y la 0026 exigen para leer. Sin tilde, como el literal de las políticas. */
export const ROL_DE_RESTAURACION = 'restauracion';

/** El bucket del que se bajan las fotos. Los PDF no se bajan: nunca se subieron (§2.5.3). */
const BUCKET_DE_FOTOS = 'fotos';

/** Igual que en el proveedor de la fase 3.b: `net.fetch` de Electron no es asignable a `typeof fetch`. */
export type BuscarEnLaRed = (url: string, opciones?: RequestInit) => Promise<Response>;

/** Cuánto se espera una respuesta de PostgREST antes de darla por perdida. */
export const TIEMPO_MAXIMO_DE_LECTURA_MS = 30_000;

/** Una foto tarda más: es un archivo, no una fila. */
export const TIEMPO_MAXIMO_DE_DESCARGA_MS = 60_000;

/** El tope de PostgREST por petición (§6.6): pedir más devuelve igual 1000. */
export const FILAS_MAXIMAS_POR_PAGINA = 1000;

/**
 * Los códigos que este cliente distingue.
 *
 * **`206` ES ÉXITO, Y SE MIDIÓ.** PostgREST contesta `206 Partial Content`
 * —no `200`— cuando una lectura con `Prefer: count=exact` no cubre la tabla
 * entera, que es exactamente lo que hace `contar()` con `limit=1`. Medido
 * contra `pos-pruebas-descartable` el 2026-09-14, en la primera corrida de
 * `verify:restauracion`:
 *
 *   GET /rest/v1/usuarios?select=id&limit=1  ->  HTTP 206
 *   content-range: 0-0/2
 *
 * La primera versión de este cliente exigía `200` y tomaba ese `206` por un
 * rechazo, así que la restauración se detenía en la primera tabla. Lo
 * encontró el arnés contra la nube real, no una prueba con dobles: el doble
 * contestaba lo que yo creía que contestaba la nube.
 */
const HTTP = { ok: 200, contenidoParcial: 206, noEncontrado: 404 } as const;

/** Cuánto del cuerpo de un rechazo se conserva para el mensaje. */
const LARGO_MAXIMO_DEL_ERROR = 400;

/** Lo que devuelve `restauracion_ventas_por_mes()`: una fila por mes, con la suma como TEXTO. */
export const esquemaDeVentasPorMes = z.array(
  z.object({ mes: z.string(), ventas: z.number().int(), total: z.string() }),
);
export type VentasPorMesDeLaNube = z.infer<typeof esquemaDeVentasPorMes>;

/** Quién inició sesión, para la pantalla y la auditoría. Sin ningún secreto. */
export interface SesionDeRestauracionIniciada {
  readonly correo: string;
  readonly rol: string;
}

/**
 * El contrato del cliente, para poder inyectar uno de mentira en las pruebas
 * del servicio. La implementación real es `ClienteDeRestauracionHttp`.
 */
export interface ClienteDeRestauracion {
  iniciarSesion(correo: string, contrasena: string): Promise<SesionDeRestauracionIniciada>;
  cerrarSesion(): Promise<void>;
  contrato(): Promise<ContratoDeLaNube>;
  /** Cuántas filas tiene la tabla en la nube, con `Prefer: count=exact`. */
  contar(tabla: string): Promise<number>;
  /** Una página de filas ordenadas por `id`, a partir de `desdeId` (exclusivo). Trae `recibido_en`. */
  leerPagina(tabla: string, desdeId: string | null, limite: number): Promise<FilaDeLaNube[]>;
  leerFila(tabla: string, id: string): Promise<FilaDeLaNube | null>;
  /** Las filas de `tabla` cuya `columna` vale `valor`, ordenadas por `id`. */
  leerHijas(tabla: string, columna: string, valor: string): Promise<FilaDeLaNube[]>;
  ventasPorMes(): Promise<VentasPorMesDeLaNube>;
  /** Los bytes de una foto del bucket `fotos`, o `null` si la nube no la tiene. */
  bajarFoto(objeto: string): Promise<Buffer | null>;
}

export interface DependenciasDelClienteDeRestauracion {
  readonly urlDelProyecto: string;
  readonly llavePublicable: string;
  readonly auth: ClienteDeAuth;
  readonly buscar: BuscarEnLaRed;
  readonly ahora?: () => number;
  readonly registrar?: (mensaje: string) => void;
}

interface SesionEnMemoria {
  accessToken: string;
  tokenDeRefresco: string;
  claims: ClaimsDelToken;
  /** Reloj local al recibirla: solo para saber cuánto pasó, nunca para comparar con `exp`. */
  recibidaEn: number;
}

export class ClienteDeRestauracionHttp implements ClienteDeRestauracion {
  private readonly urlDelProyecto: string;
  private readonly llavePublicable: string;
  private readonly auth: ClienteDeAuth;
  private readonly buscar: BuscarEnLaRed;
  private readonly ahora: () => number;
  private readonly registrar: (mensaje: string) => void;

  private sesion: SesionEnMemoria | null = null;

  public constructor(dependencias: DependenciasDelClienteDeRestauracion) {
    this.urlDelProyecto = dependencias.urlDelProyecto.replace(/\/+$/, '');
    this.llavePublicable = dependencias.llavePublicable;
    this.auth = dependencias.auth;
    this.buscar = dependencias.buscar;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
    this.registrar = dependencias.registrar ?? ((): void => undefined);
  }

  // -------------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------------

  public async iniciarSesion(correo: string, contrasena: string): Promise<SesionDeRestauracionIniciada> {
    const resultado = await this.auth.iniciarSesionConContrasena(correo, contrasena);
    if (!resultado.ok) {
      const estado = resultado.fallo.estadoHttp;
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        estado === undefined
          ? `No se pudo llegar a Supabase. Revisá la conexión a internet. (${resultado.fallo.mensaje})`
          : 'Supabase rechazó ese correo y esa contraseña. Revisá que sean los de tu usuario de restauración.',
        `Auth respondió ${estado === undefined ? 'sin código' : String(estado)}: ${resultado.fallo.mensaje}`,
      );
    }
    const claims = leerClaimsSinVerificar(resultado.sesion.accessToken);
    if (claims.esAnonimo || claims.rol !== ROL_DE_RESTAURACION) {
      // No se guarda nada: la sesión no sirve para restaurar. Y no es una
      // barrera de seguridad —la barrera son las políticas— sino un aviso
      // temprano, igual que en la conexión de la terminal (§4.23).
      const queTrae = claims.rol === null ? 'ningún rol' : `el rol «${claims.rol}»`;
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        `Ese usuario trae ${queTrae}, y para restaurar hace falta el rol «${ROL_DE_RESTAURACION}». ` +
          'Revisá que sea tu usuario de restauración y no el de la terminal.',
        `app_metadata.rol = ${claims.rol ?? 'ausente'}, is_anonymous = ${String(claims.esAnonimo)}`,
      );
    }
    this.sesion = {
      accessToken: resultado.sesion.accessToken,
      tokenDeRefresco: resultado.sesion.tokenDeRefresco,
      claims,
      recibidaEn: this.ahora(),
    };
    this.registrar(`sesión de restauración iniciada como ${claims.correo ?? correo}`);
    return { correo: claims.correo ?? correo, rol: claims.rol };
  }

  /**
   * Revoca ESTA sesión en GoTrue y la olvida. Nunca lanza: si la red se cayó,
   * el token de refresco igual muere solo, y lo que importa es que de este
   * lado no quede nada.
   *
   * **`scope=local`, y se midió por qué.** Sin el parámetro, GoTrue revoca
   * TODAS las sesiones del usuario —el alcance por omisión es `global`—, y el
   * usuario de restauración es el del dueño: cerrar la restauración le
   * cerraría también cualquier otra sesión que tuviera abierta con esa misma
   * cuenta. Se vio en la segunda corrida de `verify:restauracion` (2026-09-14):
   * un cierre global desde otra sesión del mismo usuario dejó a la sesión de
   * la restauración sin poder cerrarse (`POST /auth/v1/logout -> HTTP 403`),
   * aunque su access token seguía sirviendo. Con `scope=local` cada sesión
   * cierra la suya y nada más.
   */
  public async cerrarSesion(): Promise<void> {
    const sesion = this.sesion;
    this.sesion = null;
    if (sesion === null) {
      return;
    }
    try {
      const respuesta = await this.buscar(`${this.urlDelProyecto}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: this.llavePublicable, Authorization: `Bearer ${sesion.accessToken}` },
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_DE_LECTURA_MS),
      });
      this.registrar(`sesión de restauración cerrada (HTTP ${String(respuesta.status)})`);
    } catch (error) {
      this.registrar(`no se pudo avisar el cierre de sesión a la nube: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** El access token vigente, renovándolo si ya se consumió el 75 % de su vida. */
  private async tokenVigente(): Promise<string> {
    const sesion = this.sesion;
    if (sesion === null) {
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        'No hay una sesión de restauración iniciada.',
        'se pidió una lectura sin sesión',
      );
    }
    if (this.ahora() - sesion.recibidaEn < esperaHastaRenovar(sesion.claims)) {
      return sesion.accessToken;
    }
    const renovada = await this.auth.refrescar(sesion.tokenDeRefresco);
    if (!renovada.ok) {
      this.sesion = null;
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        'La sesión de restauración venció y no se pudo renovar. Volvé a iniciar sesión y retomá.',
        `refresco rechazado: ${renovada.fallo.mensaje}`,
      );
    }
    this.sesion = {
      accessToken: renovada.sesion.accessToken,
      tokenDeRefresco: renovada.sesion.tokenDeRefresco,
      claims: leerClaimsSinVerificar(renovada.sesion.accessToken),
      recibidaEn: this.ahora(),
    };
    this.registrar('access token de restauración renovado');
    return this.sesion.accessToken;
  }

  // -------------------------------------------------------------------------
  // Peticiones
  // -------------------------------------------------------------------------

  private async pedir(
    ruta: string,
    opciones: { readonly metodo?: 'GET' | 'POST'; readonly cuerpo?: unknown; readonly prefer?: string; readonly tiempoMaximoMs?: number },
  ): Promise<Response> {
    const token = await this.tokenVigente();
    const headers: Record<string, string> = {
      apikey: this.llavePublicable,
      Authorization: `Bearer ${token}`,
    };
    if (opciones.cuerpo !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opciones.prefer !== undefined) {
      headers.Prefer = opciones.prefer;
    }
    const metodo = opciones.metodo ?? 'GET';
    try {
      const respuesta = await this.buscar(`${this.urlDelProyecto}${ruta}`, {
        method: metodo,
        headers,
        ...(opciones.cuerpo === undefined ? {} : { body: JSON.stringify(opciones.cuerpo) }),
        signal: AbortSignal.timeout(opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_DE_LECTURA_MS),
      });
      // Cada petición queda en la bitácora técnica con su método, su ruta y su
      // código: es la evidencia cruda de una restauración, la misma que los
      // arneses anotaban por su cuenta. Nunca el token, que va en la cabecera.
      this.registrar(`${metodo} ${rutaParaLaBitacora(ruta)} -> HTTP ${String(respuesta.status)}`);
      return respuesta;
    } catch (error) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Se perdió la conexión con la nube a mitad de la restauración. Revisá el internet y retomá: no se pierde lo que ya bajó.',
        `sin respuesta de ${ruta}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async exigirJson(respuesta: Response, que: string): Promise<unknown> {
    const texto = await respuesta.text();
    if (respuesta.status !== HTTP.ok && respuesta.status !== HTTP.contenidoParcial) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `La nube rechazó ${que} (HTTP ${String(respuesta.status)}): ${texto.slice(0, LARGO_MAXIMO_DEL_ERROR)}`,
        `HTTP ${String(respuesta.status)} al pedir ${que}: ${texto.slice(0, LARGO_MAXIMO_DEL_ERROR)}`,
      );
    }
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      throw new ErrorDeNegocio('DATO_INVALIDO', `La nube contestó ${que} con algo que no es JSON.`, texto.slice(0, LARGO_MAXIMO_DEL_ERROR));
    }
  }

  public async contrato(): Promise<ContratoDeLaNube> {
    const respuesta = await this.pedir(`/rest/v1/rpc/${FUNCION_DEL_CONTRATO}`, { metodo: 'POST', cuerpo: {} });
    return esquemaDelContrato.parse(await this.exigirJson(respuesta, 'el contrato'));
  }

  public async contar(tabla: string): Promise<number> {
    const respuesta = await this.pedir(`/rest/v1/${tabla}?select=id&limit=1`, { prefer: 'count=exact' });
    await this.exigirJson(respuesta, `el conteo de ${tabla}`);
    // `Content-Range: 0-0/N`, o `*/0` con la tabla vacía.
    const rango = respuesta.headers.get('content-range') ?? '';
    const total = rango.split('/')[1];
    if (total === undefined || !/^\d+$/.test(total)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `La nube no dijo cuántas filas tiene ${tabla}.`,
        `content-range ilegible: «${rango}»`,
      );
    }
    return Number(total);
  }

  /** La lista `select=` de una tabla: todas sus columnas, los numéricos como texto, más `recibido_en`. */
  private seleccionDe(tabla: string): string {
    const clases = CLASES_DE_COLUMNA[tabla];
    if (clases === undefined) {
      throw new ErrorDeNegocio('DATO_INVALIDO', `La tabla ${tabla} no se restaura.`, 'tabla fuera de CLASES_DE_COLUMNA');
    }
    const numericas = columnasNumericasDe(tabla);
    const columnas = Object.keys(clases).map((columna) => (numericas.includes(columna) ? `${columna}::text` : columna));
    if (tabla !== TABLA_QUE_SOLO_SE_VERIFICA) {
      columnas.push('recibido_en');
    }
    return columnas.join(',');
  }

  private async leerFilas(tabla: string, filtro: string, que: string): Promise<FilaDeLaNube[]> {
    const respuesta = await this.pedir(`/rest/v1/${tabla}?select=${this.seleccionDe(tabla)}&order=id.asc${filtro}`, {});
    const datos = await this.exigirJson(respuesta, que);
    if (!Array.isArray(datos)) {
      throw new ErrorDeNegocio('DATO_INVALIDO', `La nube contestó ${que} sin una lista de filas.`, JSON.stringify(datos).slice(0, LARGO_MAXIMO_DEL_ERROR));
    }
    return datos as FilaDeLaNube[];
  }

  public leerPagina(tabla: string, desdeId: string | null, limite: number): Promise<FilaDeLaNube[]> {
    const tope = Math.min(Math.max(limite, 1), FILAS_MAXIMAS_POR_PAGINA);
    const desde = desdeId === null ? '' : `&id=gt.${encodeURIComponent(desdeId)}`;
    return this.leerFilas(tabla, `${desde}&limit=${String(tope)}`, `una página de ${tabla}`);
  }

  public async leerFila(tabla: string, id: string): Promise<FilaDeLaNube | null> {
    const filas = await this.leerFilas(tabla, `&id=eq.${encodeURIComponent(id)}&limit=1`, `la fila ${id} de ${tabla}`);
    return filas[0] ?? null;
  }

  public leerHijas(tabla: string, columna: string, valor: string): Promise<FilaDeLaNube[]> {
    if (!/^[a-z_]+$/.test(columna)) {
      throw new ErrorDeNegocio('DATO_INVALIDO', 'Columna de filtro inválida.', `columna «${columna}»`);
    }
    return this.leerFilas(tabla, `&${columna}=eq.${encodeURIComponent(valor)}`, `las filas de ${tabla} con ${columna} = ${valor}`);
  }

  public async ventasPorMes(): Promise<VentasPorMesDeLaNube> {
    const [funcion] = FUNCIONES_DE_RESTAURACION;
    const respuesta = await this.pedir(`/rest/v1/rpc/${funcion}`, { metodo: 'POST', cuerpo: {} });
    return esquemaDeVentasPorMes.parse(await this.exigirJson(respuesta, 'la suma de ventas por mes'));
  }

  public async bajarFoto(objeto: string): Promise<Buffer | null> {
    const respuesta = await this.pedir(
      `/storage/v1/object/${BUCKET_DE_FOTOS}/${encodeURIComponent(objeto)}`,
      { tiempoMaximoMs: TIEMPO_MAXIMO_DE_DESCARGA_MS },
    );
    if (respuesta.status === HTTP.ok) {
      return Buffer.from(await respuesta.arrayBuffer());
    }
    const texto = await respuesta.text();
    // Storage contesta el «no existe» con 400 o 404 y `not_found` en el cuerpo (medido en la fase 2.c).
    if (respuesta.status === HTTP.noEncontrado || texto.includes('not_found') || texto.includes('Object not found')) {
      return null;
    }
    throw new ErrorDeNegocio(
      'DATO_INVALIDO',
      `Storage rechazó la foto ${objeto} (HTTP ${String(respuesta.status)}): ${texto.slice(0, LARGO_MAXIMO_DEL_ERROR)}`,
      `HTTP ${String(respuesta.status)} al bajar ${objeto}`,
    );
  }
}

/**
 * La ruta tal como va a la bitácora: sin la lista `select=` ni el `order=`,
 * que son largos y siempre iguales para una tabla, y con lo que sí distingue
 * una petición de otra (`limit`, `id=gt.…`, `id=eq.…`). El token nunca está
 * acá: viaja en la cabecera `Authorization`, que no se registra.
 */
export function rutaParaLaBitacora(ruta: string): string {
  const separador = ruta.indexOf('?');
  if (separador === -1) {
    return ruta;
  }
  const camino = ruta.slice(0, separador);
  const parametros = new URLSearchParams(ruta.slice(separador + 1));
  parametros.delete('select');
  parametros.delete('order');
  const resto = parametros.toString();
  return resto === '' ? camino : `${camino}?${resto}`;
}
