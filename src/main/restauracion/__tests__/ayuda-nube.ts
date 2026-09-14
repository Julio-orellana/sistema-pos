/**
 * Lo que comparten los arneses que hablan con `pos-pruebas-descartable`
 * (`*.nube.ts`, `npm run verify:restauracion`): el entorno y el seguro, el
 * `fetch` que anota cada petición, y las piezas REALES de la aplicación
 * armadas para subir una terminal de origen y para restaurar.
 *
 * NO es un archivo de prueba: `vitest.nube.config.ts` solo incluye `*.nube.ts`,
 * y `npm test` no mira esta carpeta con red. Importarlo comprueba el seguro
 * antes de que nadie haga una petición.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';

import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { ClienteDeAuthHttp } from '@main/sincronizacion/auth-de-nube';
import type { CifradoSeguro } from '@main/sincronizacion/credencial';
import { DetectorDeConexion } from '@main/sincronizacion/deteccion-de-conexion';
import type { SesionDeNube } from '@main/sincronizacion/sesion-de-nube';
import { SubidorDeFotos } from '@main/sincronizacion/subida-de-fotos';
import { SupabaseSyncProvider } from '@main/sincronizacion/supabase-sync-provider';
import { TrabajadorDeSincronizacion } from '@main/sincronizacion/trabajador';

import { ClienteDeRestauracionHttp, type ClienteDeRestauracion } from '../cliente-de-restauracion';
import { ORDEN_DE_RESTAURACION } from '../orden-de-restauracion';
import { AlmacenDelPuestoDeControl } from '../puesto-de-control';
import { ServicioDeRestauracion } from '../servicio-de-restauracion';

// ---------------------------------------------------------------------------
// Entorno y seguro
// ---------------------------------------------------------------------------

export const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));

function leerEntorno(): Record<string, string> {
  const ruta = join(RAIZ, '.env.nube-pruebas');
  if (!existsSync(ruta)) {
    throw new Error(`Falta ${ruta}: sin las credenciales del proyecto de PRUEBAS no se puede verificar (ver .env.nube-pruebas.ejemplo).`);
  }
  const valores: Record<string, string> = {};
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (limpia === '' || limpia.startsWith('#')) continue;
    const separador = limpia.indexOf('=');
    if (separador <= 0) continue;
    valores[limpia.slice(0, separador).trim()] = limpia.slice(separador + 1).trim();
  }
  for (const clave of [
    'POS_NUBE_PROYECTO',
    'POS_NUBE_URL',
    'POS_NUBE_LLAVE_PUBLICABLE',
    'POS_NUBE_TERMINAL_CORREO',
    'POS_NUBE_TERMINAL_CLAVE',
    'POS_NUBE_RESTAURACION_CORREO',
    'POS_NUBE_RESTAURACION_CLAVE',
  ]) {
    if (valores[clave] === undefined || valores[clave] === '') {
      throw new Error(`Falta ${clave} en .env.nube-pruebas.`);
    }
  }
  return valores;
}

export const entorno = leerEntorno();
export const URL_DEL_PROYECTO = entorno.POS_NUBE_URL ?? '';
export const LLAVE_PUBLICABLE = entorno.POS_NUBE_LLAVE_PUBLICABLE ?? '';
export const CORREO_DE_RESTAURACION = entorno.POS_NUBE_RESTAURACION_CORREO ?? '';
export const CLAVE_DE_RESTAURACION = entorno.POS_NUBE_RESTAURACION_CLAVE ?? '';

// EL SEGURO, antes de cualquier petición: la misma función que usa verify:nube.
const cargar = createRequire(import.meta.url);
const { exigirProyectoDePrueba } = cargar(join(RAIZ, 'scripts', 'proyectos-de-prueba.cjs')) as {
  exigirProyectoDePrueba: (referencia: string, url: string) => string;
};
exigirProyectoDePrueba(entorno.POS_NUBE_PROYECTO ?? '', URL_DEL_PROYECTO);

// ---------------------------------------------------------------------------
// La salida cruda: cada petición con su hora, su código y la huella del token
// ---------------------------------------------------------------------------

export const peticiones: string[] = [];

/** Lo que un observador ve de cada petición. El token va entero SOLO acá, en memoria; a la bitácora va su huella. */
export interface PeticionObservada {
  readonly metodo: string;
  readonly ruta: string;
  readonly estado: number | null;
  readonly token: string | null;
}

const observadores = new Set<(peticion: PeticionObservada) => void>();

/** Registra un observador de peticiones. Devuelve cómo quitarlo. */
export function observarPeticiones(observador: (peticion: PeticionObservada) => void): () => void {
  observadores.add(observador);
  return (): void => {
    observadores.delete(observador);
  };
}

/** Ocho caracteres del sha256 del token: alcanza para saber si dos peticiones llevaron el MISMO, sin escribir el token. */
export function huellaDeToken(token: string): string {
  const LARGO = 8;
  return createHash('sha256').update(token).digest('hex').slice(0, LARGO);
}

function tokenDe(opciones: RequestInit | undefined): string | null {
  if (opciones?.headers === undefined) return null;
  const valor = new Headers(opciones.headers).get('authorization');
  return valor === null ? null : valor.replace(/^Bearer\s+/i, '');
}

/** Un `fetch` que anota hora, método, ruta, código y huella del token de cada petición. Sirve como `typeof fetch` y como `BuscarEnLaRed`. */
export function fetchAnotado(etiqueta: string): typeof fetch {
  return async (entrada: string | URL | Request, opciones?: RequestInit): Promise<Response> => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    const inicio = new Date().toISOString();
    const metodo = opciones?.method ?? 'GET';
    const ruta = url.replace(URL_DEL_PROYECTO, '');
    const token = tokenDe(opciones);
    const huella = token === null ? '' : ` [token ${huellaDeToken(token)}]`;
    try {
      const respuesta = await fetch(url, opciones);
      const linea = `${inicio} [${etiqueta}] ${metodo} ${ruta} -> HTTP ${String(respuesta.status)}${huella}`;
      peticiones.push(linea);
      console.info(linea);
      for (const observador of observadores) observador({ metodo, ruta, estado: respuesta.status, token });
      return respuesta;
    } catch (error) {
      const linea = `${inicio} [${etiqueta}] ${metodo} ${ruta} -> SIN RESPUESTA (${error instanceof Error ? error.message : String(error)})${huella}`;
      peticiones.push(linea);
      console.info(linea);
      for (const observador of observadores) observador({ metodo, ruta, estado: null, token });
      throw error;
    }
  };
}

export const anotar = (mensaje: string): void => {
  console.info(`${new Date().toISOString()} ${mensaje}`);
};

// ---------------------------------------------------------------------------
// Ayudas chicas
// ---------------------------------------------------------------------------

/** Un cifrado trivial para la credencial de la terminal de origen: vive en una carpeta temporal. */
export class CifradoParaLaPrueba implements CifradoSeguro {
  public isEncryptionAvailable(): boolean {
    return true;
  }
  public encryptString(texto: string): Buffer {
    return Buffer.from(texto, 'utf8').reverse();
  }
  public decryptString(cifrado: Buffer): string {
    return Buffer.from(cifrado).reverse().toString('utf8');
  }
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function contar(base: Database, tabla: string): number {
  return (base.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n;
}

export function ids(base: Database, tabla: string): string[] {
  return (base.prepare(`SELECT id FROM ${tabla} ORDER BY id`).all() as { id: string }[]).map((f) => f.id);
}

export function filaPorId(base: Database, tabla: string, id: string): Record<string, unknown> | undefined {
  return base.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

export function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Reintenta una lectura ante un 5xx de la nube. El proyecto de pruebas contesta
 * `504 Gateway Timeout` de vez en cuando (tres veces el 2026-09-14, en menos de
 * media hora). Es resiliencia del ARNÉS, no de la aplicación: el cliente de
 * restauración NO reintenta y deja la restauración «detenida», retomable
 * (CLAUDE.md §5, Prompt 52); acá se reintenta para que un 504 en una
 * precondición o en una página no tire una corrida de diecisiete minutos.
 */
export async function conReintentoAnte5xx<T>(que: string, operacion: () => Promise<T>): Promise<T> {
  const INTENTOS = 3;
  const ESPERA_MS = 5000;
  for (let intento = 1; ; intento += 1) {
    try {
      return await operacion();
    } catch (error) {
      const causa = error instanceof ErrorDeNegocio ? error.causaTecnica : '';
      if (intento >= INTENTOS || !/HTTP 5\d\d/.test(causa)) {
        throw error;
      }
      anotar(`  ${que}: la nube contestó 5xx (${causa.slice(0, 90)}); se reintenta en ${String(ESPERA_MS / 1000)} s (intento ${String(intento)} de ${String(INTENTOS)})`);
      await dormir(ESPERA_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Subir la terminal de origen con las piezas reales
// ---------------------------------------------------------------------------

const SIN_PAUSA = 0;

export async function subirTodo(repos: Repositorios, carpeta: string, sesion: SesionDeNube): Promise<void> {
  const trabajador = new TrabajadorDeSincronizacion({
    cola: repos.syncCola,
    proveedor: new SupabaseSyncProvider({
      urlDelProyecto: URL_DEL_PROYECTO,
      llavePublicable: LLAVE_PUBLICABLE,
      sesion,
      buscar: fetchAnotado('terminal'),
      registrar: (m): void => {
        anotar(`  proveedor: ${m}`);
      },
      subidorDeFotos: new SubidorDeFotos({
        urlDelProyecto: URL_DEL_PROYECTO,
        llavePublicable: LLAVE_PUBLICABLE,
        accessToken: (): string | null => sesion.accessTokenVigente(),
        buscar: fetchAnotado('terminal'),
        leerArchivo: (rutaRelativa): Buffer | null => {
          try {
            return readFileSync(join(carpeta, rutaRelativa));
          } catch {
            return null;
          }
        },
      }),
    }),
    presupuesto: { pausaEntreLotesMs: SIN_PAUSA },
    registrar: (m): void => {
      anotar(`  trabajador: ${m}`);
    },
  });

  const CICLOS_MAXIMOS = 20;
  for (let ciclo = 1; ciclo <= CICLOS_MAXIMOS; ciclo += 1) {
    const resumen = await trabajador.ejecutarCiclo();
    anotar(
      `ciclo ${String(ciclo)}: ${resumen.motivo}; ${String(resumen.lotesSubidos)} lotes, ${String(resumen.filasSubidas)} filas; pendientes en la cola: ${String(repos.syncCola.contarPendientes())}`,
    );
    if (resumen.motivo === 'cola_detenida') {
      const bloqueante = repos.syncCola.obtenerLoteBloqueante();
      throw new Error(`la cola se detuvo al subir la terminal de origen: ${bloqueante?.error ?? 'sin error registrado'}`);
    }
    // Lo único que puede quedar es la foto APARTADA (la que se borró del disco a propósito).
    if (repos.syncCola.contarLotesPendientes() === repos.syncCola.contarArchivosApartados()) {
      return;
    }
  }
  throw new Error('la cola no se vació en 20 ciclos');
}

// ---------------------------------------------------------------------------
// Restaurar con las piezas reales
// ---------------------------------------------------------------------------

export function clienteReal(): ClienteDeRestauracionHttp {
  return new ClienteDeRestauracionHttp({
    urlDelProyecto: URL_DEL_PROYECTO,
    llavePublicable: LLAVE_PUBLICABLE,
    auth: new ClienteDeAuthHttp(URL_DEL_PROYECTO, LLAVE_PUBLICABLE, fetchAnotado('auth')),
    buscar: fetchAnotado('restauracion'),
    registrar: (m): void => {
      anotar(`  cliente: ${m}`);
    },
  });
}

export function servicioSobre(base: Database, carpeta: string, cliente: ClienteDeRestauracion, filasPorPagina?: number): ServicioDeRestauracion {
  const repos = crearRepositorios(base);
  return new ServicioDeRestauracion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    cliente,
    urlDelProyecto: URL_DEL_PROYECTO,
    puestoDeControl: new AlmacenDelPuestoDeControl(carpeta),
    carpetaDeDatos: carpeta,
    comprobarNube: async (): Promise<{ hayNube: boolean; motivo: string }> => {
      const detector = new DetectorDeConexion({
        urlDelProyecto: URL_DEL_PROYECTO,
        referenciaDelProyecto: entorno.POS_NUBE_PROYECTO ?? '',
        llavePublicable: LLAVE_PUBLICABLE,
        buscar: fetchAnotado('salud'),
      });
      const veredicto = await detector.comprobar();
      anotar(`  salud: ${veredicto.hayNube ? 'hay nube' : 'SIN NUBE'} (${veredicto.motivo})`);
      return veredicto;
    },
    registrar: (m): void => {
      anotar(`  restauracion: ${m}`);
    },
    ...(filasPorPagina === undefined ? {} : { filasPorPagina }),
  });
}

/** Todos los ids de una tabla en la nube, leídos por páginas con la credencial de restauración. */
export async function idsEnLaNube(cliente: ClienteDeRestauracion, tabla: string): Promise<string[]> {
  const todos: string[] = [];
  let desde: string | null = null;
  const PAGINA = 1000;
  for (;;) {
    const pagina = await cliente.leerPagina(tabla, desde, PAGINA);
    if (pagina.length === 0) break;
    for (const fila of pagina) todos.push(String(fila.id));
    desde = String(pagina[pagina.length - 1]?.id);
    if (pagina.length < PAGINA) break;
  }
  return todos.sort();
}

/**
 * La nube tiene que estar vacía antes de sembrar, y lo comprueba la credencial
 * de restauración. Con filas viejas los UNIQUE de `usuarios.nombre` o
 * `recibos.numero_recibo` detendrían la cola por el 23505 del punto 19 de
 * §6.2, que es otro problema y no el que estos arneses verifican.
 */
export async function exigirNubeVacia(): Promise<void> {
  const lector = clienteReal();
  await lector.iniciarSesion(CORREO_DE_RESTAURACION, CLAVE_DE_RESTAURACION);
  const conFilas: string[] = [];
  for (const tabla of ORDEN_DE_RESTAURACION) {
    if (tabla === 'configuracion_negocio') continue;
    const n = await conReintentoAnte5xx(`conteo de ${tabla}`, () => lector.contar(tabla));
    if (n > 0) conFilas.push(`${tabla}=${String(n)}`);
  }
  await lector.cerrarSesion();
  if (conFilas.length > 0) {
    throw new Error(
      `El proyecto de pruebas NO está vacío (${conFilas.join(', ')}). Vaciá las once tablas por SQL y volvé a correr: con filas viejas los UNIQUE detendrían la cola (punto 19 de §6.2), que es otro problema.`,
    );
  }
  anotar('la nube está vacía: se puede sembrar');
}
