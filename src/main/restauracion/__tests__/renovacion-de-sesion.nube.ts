/**
 * LA SESIÓN DE RESTAURACIÓN SE RENUEVA SOLA A MITAD DE UNA RESTAURACIÓN MÁS
 * LARGA QUE LA VIDA DEL ACCESS TOKEN (§6.6 del diseño, decisión 2).
 *
 * `npm run verify:restauracion:renovacion`. Tarda lo que dura un token más un
 * margen: con el JWT de `pos-pruebas-descartable` en 900 s, unos 17 minutos.
 * Por eso NO corre con `verify:restauracion` a secas: exige
 * `POS_NUBE_RENOVACION=1`, y sin esa variable se salta entero.
 *
 * La pregunta que contesta, con las piezas REALES: si una restauración dura
 * más que los 900 s del access token, ¿se renueva sola, o se corta?
 *
 *   1. Nube vacía; se siembra y se sube la terminal de origen, como en el
 *      arnés principal.
 *   2. Se restaura con `ClienteDeRestauracionHttp` y `ServicioDeRestauracion`
 *      reales, pero con un cliente envuelto que DEMORA cada lectura de página
 *      lo justo para que la transferencia de las doce tablas cruce el 75 % de
 *      la vida del token —el instante en que `tokenVigente()` renueva
 *      (`vida-del-token.ts`)—. La demora la pone el arnés, no la aplicación:
 *      es el equivalente de una tienda con un año de ventas y una conexión
 *      lenta, sin tener que sembrar un año de ventas.
 *   3. Se comprueba que A MITAD de la transferencia hubo un
 *      `POST /auth/v1/token?grant_type=refresh_token -> 200`, que las páginas
 *      siguientes viajaron con OTRO access token, y que la restauración llegó
 *      entera a la revisión con la verificación cuadrando.
 *   4. EL CONTROL: pasado `exp` + 40 s del primer token —más que la cota
 *      medida de ~32 s de tolerancia (§4.22)—, ese mismo token presentado a
 *      mano a PostgREST contesta `401 PGRST303`. Es lo que le habría pasado a
 *      una restauración que no renovara. En ese mismo instante el cliente,
 *      con el token renovado, sigue leyendo con 200.
 *
 * Imprime la salida CRUDA: cada petición con hora, código y la HUELLA del
 * token que llevó (ocho caracteres del sha256, nunca el token), y cada tabla
 * con la hora en que terminó. La conclusión va encima de la evidencia.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { observarLotesEncolados } from '@main/database/bandeja-de-salida';
import { reiniciarSenalDeTransaccion } from '@main/database/transaccion-en-curso';
import { ClienteDeAuthHttp } from '@main/sincronizacion/auth-de-nube';
import { AlmacenDeCredencial } from '@main/sincronizacion/credencial';
import { SesionDeNube } from '@main/sincronizacion/sesion-de-nube';
import { esperaHastaRenovar, leerClaimsSinVerificar, vidaDelTokenEnSegundos } from '@main/sincronizacion/vida-del-token';

import type { ClienteDeRestauracion, ClienteDeRestauracionHttp, SesionDeRestauracionIniciada } from '../cliente-de-restauracion';
import type { FilaDeLaNube } from '../conversion-de-tipos';
import type { ContratoDeLaNube } from '../deriva-de-esquema';
import { ORDEN_DE_RESTAURACION } from '../orden-de-restauracion';
import { ARCHIVO_DEL_PUESTO_DE_CONTROL } from '../puesto-de-control';
import type { ServicioDeRestauracion } from '../servicio-de-restauracion';
import {
  anotar,
  CifradoParaLaPrueba,
  CLAVE_DE_RESTAURACION,
  clienteReal,
  conReintentoAnte5xx,
  CORREO_DE_RESTAURACION,
  dormir,
  entorno,
  exigirNubeVacia,
  fetchAnotado,
  huellaDeToken,
  ids,
  idsEnLaNube,
  LLAVE_PUBLICABLE,
  observarPeticiones,
  type PeticionObservada,
  servicioSobre,
  subirTodo,
  URL_DEL_PROYECTO,
} from './ayuda-nube';
import { sembrarTerminalDeOrigen } from './terminal-de-origen';

const ACTIVADA = process.env.POS_NUBE_RENOVACION === '1';

/** Más que la cota medida de tolerancia tras `exp` (~32 s, §4.22): con esto el token viejo ya no sirve seguro. */
const MARGEN_TRAS_EXP_S = 40;
/** Sobre cuántas páginas se reparte la espera hasta la renovación, para que ocurra con tablas antes y después. */
const PAGINAS_ANTES_DE_RENOVAR = 9;
const MS_POR_SEGUNDO = 1000;
/** El arnés entero puede tardar dos vidas de token. */
const TIEMPO_MAXIMO_MS = 40 * 60 * MS_POR_SEGUNDO;

/** El cliente real, con una espera ANTES de cada lectura de página. Todo lo demás pasa derecho. */
class ClienteConRetraso implements ClienteDeRestauracion {
  public readonly paginas: { readonly tabla: string; readonly en: string }[] = [];

  public constructor(
    private readonly real: ClienteDeRestauracionHttp,
    private readonly retrasoMs: number,
  ) {}

  public iniciarSesion(correo: string, contrasena: string): Promise<SesionDeRestauracionIniciada> {
    return this.real.iniciarSesion(correo, contrasena);
  }
  public cerrarSesion(): Promise<void> {
    return this.real.cerrarSesion();
  }
  public contrato(): Promise<ContratoDeLaNube> {
    return this.real.contrato();
  }
  public contar(tabla: string): Promise<number> {
    return conReintentoAnte5xx(`conteo de ${tabla}`, () => this.real.contar(tabla));
  }
  public async leerPagina(tabla: string, desdeId: string | null, limite: number): Promise<FilaDeLaNube[]> {
    await dormir(this.retrasoMs);
    this.paginas.push({ tabla, en: new Date().toISOString() });
    // El reintento ante un 5xx es del arnés (ver `conReintentoAnte5xx`): lo que
    // se mide acá es la renovación del token, no qué hace la aplicación con un 504.
    return conReintentoAnte5xx(`página de ${tabla}`, () => this.real.leerPagina(tabla, desdeId, limite));
  }
  public leerFila(tabla: string, id: string): Promise<FilaDeLaNube | null> {
    return this.real.leerFila(tabla, id);
  }
  public leerHijas(tabla: string, columna: string, valor: string): Promise<FilaDeLaNube[]> {
    return this.real.leerHijas(tabla, columna, valor);
  }
  public ventasPorMes(): ReturnType<ClienteDeRestauracionHttp['ventasPorMes']> {
    return this.real.ventasPorMes();
  }
  public bajarFoto(objeto: string): Promise<Buffer | null> {
    return this.real.bajarFoto(objeto);
  }
}

interface Renovacion {
  readonly en: string;
  readonly estado: number | null;
  /** Qué tablas ya estaban listas cuando se renovó, según el servicio. */
  readonly tablasListas: readonly string[];
  readonly fase: string;
}

let carpetaA: string;
let carpetaB: string;
let origen: { base: Database; limpiar: () => void };
let destino: { base: Database; limpiar: () => void };
let restauracion: ServicioDeRestauracion | null = null;
let cliente: ClienteConRetraso;

/** El servicio, o un error claro si el `beforeAll` no llegó a crearlo. */
function servicio(): ServicioDeRestauracion {
  if (restauracion === null) {
    throw new Error('la restauración no se inició: mirá el fallo del beforeAll');
  }
  return restauracion;
}
let dejarDeObservar: (() => void) | null = null;

/** Lo medido del PRIMER token de la restauración, y del que lo reemplazó. */
let iatDelPrimerToken = 0;
let expDelPrimerToken = 0;
let vidaEnSegundos = 0;
let esperaHastaRenovarMs = 0;
let retrasoPorPaginaMs = 0;
let primerToken: string | null = null;
/** Huella del token con que viajó cada petición de lectura, en orden. */
const huellasPorLectura: { readonly ruta: string; readonly huella: string; readonly en: string }[] = [];
const renovaciones: Renovacion[] = [];
let inicioDeLaRestauracion = 0;
let finDeLaRestauracion = 0;

describe.skipIf(!ACTIVADA)('La sesión de restauración se renueva sola durante una restauración más larga que el token', () => {
  beforeAll(async () => {
    reiniciarSenalDeTransaccion();
    observarLotesEncolados(null);
    carpetaA = mkdtempSync(join(tmpdir(), 'pos-nube-renovacion-origen-'));
    carpetaB = mkdtempSync(join(tmpdir(), 'pos-nube-renovacion-destino-'));
    origen = crearBaseMigrada();
    destino = crearBaseMigrada();

    await exigirNubeVacia();

    // 1. La terminal de origen, subida entera con la credencial de terminal.
    const terminal = sembrarTerminalDeOrigen(origen.base, carpetaA);
    rmSync(join(carpetaA, terminal.fotoDeLosHuevos.rutaRelativa), { force: true });
    const sesionDeTerminal = new SesionDeNube({
      auth: new ClienteDeAuthHttp(URL_DEL_PROYECTO, LLAVE_PUBLICABLE, fetchAnotado('auth')),
      credencial: new AlmacenDeCredencial(carpetaA, new CifradoParaLaPrueba()),
      registrar: (m): void => {
        anotar(`  sesion de terminal: ${m}`);
      },
    });
    await sesionDeTerminal.conectar(entorno.POS_NUBE_TERMINAL_CORREO ?? '', entorno.POS_NUBE_TERMINAL_CLAVE ?? '');
    anotar('--- SUBIDA: la terminal de origen entera ---');
    await subirTodo(terminal.repos, carpetaA, sesionDeTerminal);
    sesionDeTerminal.detener();

    // 2. Cuánto dura un token de restauración HOY, medido en uno recién acuñado
    //    (una sesión aparte, que se cierra con scope=local y no toca a la otra).
    const auth = new ClienteDeAuthHttp(URL_DEL_PROYECTO, LLAVE_PUBLICABLE, fetchAnotado('auth'));
    const sonda = await auth.iniciarSesionConContrasena(CORREO_DE_RESTAURACION, CLAVE_DE_RESTAURACION);
    if (!sonda.ok) {
      throw new Error(`no se pudo acuñar el token de sonda: ${sonda.fallo.mensaje}`);
    }
    const claimsDeSonda = leerClaimsSinVerificar(sonda.sesion.accessToken);
    vidaEnSegundos = vidaDelTokenEnSegundos(claimsDeSonda);
    esperaHastaRenovarMs = esperaHastaRenovar(claimsDeSonda);
    retrasoPorPaginaMs = Math.ceil(esperaHastaRenovarMs / PAGINAS_ANTES_DE_RENOVAR / MS_POR_SEGUNDO) * MS_POR_SEGUNDO;
    await fetchAnotado('auth')(`${URL_DEL_PROYECTO}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: LLAVE_PUBLICABLE, Authorization: `Bearer ${sonda.sesion.accessToken}` },
    });
    anotar(
      `token de sonda: exp - iat = ${String(vidaEnSegundos)} s; se renueva a los ${String(esperaHastaRenovarMs / MS_POR_SEGUNDO)} s; ` +
        `retraso por página = ${String(retrasoPorPaginaMs / MS_POR_SEGUNDO)} s × ${String(ORDEN_DE_RESTAURACION.length + 1)} páginas`,
    );

    // 3. La restauración REAL, observando cada petición.
    dejarDeObservar = observarPeticiones((peticion: PeticionObservada): void => {
      if (peticion.ruta.startsWith('/rest/v1/') && peticion.token !== null) {
        if (primerToken === null) {
          primerToken = peticion.token;
          const claims = leerClaimsSinVerificar(peticion.token);
          iatDelPrimerToken = claims.iat;
          expDelPrimerToken = claims.exp;
          anotar(`primer token de la restauración: huella ${huellaDeToken(peticion.token)}, iat=${String(claims.iat)}, exp=${String(claims.exp)}`);
        }
        huellasPorLectura.push({ ruta: peticion.ruta, huella: huellaDeToken(peticion.token), en: new Date().toISOString() });
      }
      if (peticion.ruta.includes('grant_type=refresh_token')) {
        const progreso = servicio().progreso();
        renovaciones.push({
          en: new Date().toISOString(),
          estado: peticion.estado,
          tablasListas: progreso.tablas.filter((t) => t.estado === 'lista').map((t) => t.tabla),
          fase: progreso.fase,
        });
        anotar(`RENOVACIÓN observada (HTTP ${String(peticion.estado)}) en fase ${progreso.fase}, con listas: ${progreso.tablas.filter((t) => t.estado === 'lista').map((t) => t.tabla).join(', ')}`);
      }
    });
    cliente = new ClienteConRetraso(clienteReal(), retrasoPorPaginaMs);
    restauracion = servicioSobre(destino.base, carpetaB, cliente);
    anotar('--- RESTAURACIÓN, con retraso por página ---');
    inicioDeLaRestauracion = Date.now();
    await servicio().iniciar({ correo: CORREO_DE_RESTAURACION, contrasena: CLAVE_DE_RESTAURACION, motivo: 'falla', fechaDelRobo: null });
    await servicio().esperarACorrida();
    finDeLaRestauracion = Date.now();
    anotar(`restauración en fase ${servicio().progreso().fase} tras ${String(Math.round((finDeLaRestauracion - inicioDeLaRestauracion) / MS_POR_SEGUNDO))} s`);
  }, TIEMPO_MAXIMO_MS);

  afterAll(async () => {
    dejarDeObservar?.();
    if (restauracion?.progreso().fase === 'revision') {
      await restauracion.cancelar();
    }
    observarLotesEncolados(null);
    reiniciarSenalDeTransaccion();
    origen.limpiar();
    destino.limpiar();
    rmSync(carpetaA, { recursive: true, force: true });
    rmSync(carpetaB, { recursive: true, force: true });
  });

  it('la restauración duró MÁS que el 75 % de la vida del token y llegó a la revisión con la verificación cuadrando, sin cortarse', () => {
    const duracionS = (finDeLaRestauracion - inicioDeLaRestauracion) / MS_POR_SEGUNDO;
    anotar(`duración de la restauración: ${String(Math.round(duracionS))} s; vida del token: ${String(vidaEnSegundos)} s; renovación a los ${String(esperaHastaRenovarMs / MS_POR_SEGUNDO)} s`);
    expect(duracionS).toBeGreaterThan(esperaHastaRenovarMs / MS_POR_SEGUNDO);
    expect(servicio().progreso().mensaje).toBeNull();
    expect(servicio().progreso().fase).toBe('revision');
    expect(servicio().progreso().verificacion?.ok).toBe(true);
    expect(servicio().progreso().tablas.every((t) => t.estado === 'lista')).toBe(true);
  });

  it('a MITAD de la transferencia hubo exactamente una renovación (refresh_token -> 200), con tablas listas antes y tablas por bajar después', () => {
    for (const r of renovaciones) {
      anotar(`  renovación ${r.en}: HTTP ${String(r.estado)}, fase ${r.fase}, listas antes: ${r.tablasListas.join(', ')}`);
    }
    expect(renovaciones).toHaveLength(1);
    const [renovacion] = renovaciones;
    expect(renovacion?.estado).toBe(200);
    expect(renovacion?.fase).toBe('tablas');
    expect(renovacion?.tablasListas.length).toBeGreaterThan(0);
    expect(renovacion?.tablasListas.length).toBeLessThan(ORDEN_DE_RESTAURACION.length);
  });

  it('las lecturas ANTERIORES a la renovación viajaron con el primer token y las POSTERIORES con otro distinto, y ninguna fue rechazada', () => {
    const [renovacion] = renovaciones;
    expect(renovacion).toBeDefined();
    const antes = huellasPorLectura.filter((h) => h.en < (renovacion?.en ?? ''));
    const despues = huellasPorLectura.filter((h) => h.en > (renovacion?.en ?? ''));
    const huellaA = primerToken === null ? '' : huellaDeToken(primerToken);
    anotar(`  lecturas antes de renovar: ${String(antes.length)} (huellas: ${[...new Set(antes.map((h) => h.huella))].join(', ')}); después: ${String(despues.length)} (huellas: ${[...new Set(despues.map((h) => h.huella))].join(', ')})`);
    expect(antes.length).toBeGreaterThan(0);
    expect(despues.length).toBeGreaterThan(0);
    expect(antes.every((h) => h.huella === huellaA)).toBe(true);
    expect(despues.every((h) => h.huella !== huellaA)).toBe(true);
    expect(new Set(despues.map((h) => h.huella)).size).toBe(1);
    expect(cliente.paginas.length).toBeGreaterThanOrEqual(ORDEN_DE_RESTAURACION.length);
  });

  it(
    'CONTROL: pasado exp + 40 s, el PRIMER token presentado a mano a PostgREST se rechaza con 401 PGRST303 (así se cortaría sin renovación), y en ese mismo instante el cliente renovado sigue leyendo con 200',
    async () => {
      expect(primerToken).not.toBeNull();
      const limite = (expDelPrimerToken + MARGEN_TRAS_EXP_S) * MS_POR_SEGUNDO;
      const faltan = limite - Date.now();
      if (faltan > 0) {
        anotar(`esperando ${String(Math.ceil(faltan / MS_POR_SEGUNDO))} s hasta exp + ${String(MARGEN_TRAS_EXP_S)} s del primer token…`);
        await dormir(faltan);
      }
      const respuesta = await fetchAnotado('control')(`${URL_DEL_PROYECTO}/rest/v1/usuarios?select=id&limit=1`, {
        headers: { apikey: LLAVE_PUBLICABLE, Authorization: `Bearer ${primerToken ?? ''}` },
      });
      const cuerpo = await respuesta.text();
      anotar(`  primer token a mano, ${String(Math.round((Date.now() / MS_POR_SEGUNDO - expDelPrimerToken)))} s después de su exp: HTTP ${String(respuesta.status)} ${cuerpo.slice(0, 160)}`);
      expect(respuesta.status).toBe(401);
      expect(cuerpo).toContain('PGRST303');

      const conteo = await cliente.contar('usuarios');
      anotar(`  el cliente, en el mismo instante: usuarios en la nube = ${String(conteo)}`);
      expect(conteo).toBe(ids(destino.base, 'usuarios').length);
      expect(servicio().progreso().fase).toBe('revision');
      expect(Date.now() / MS_POR_SEGUNDO).toBeGreaterThan(iatDelPrimerToken + vidaEnSegundos);
    },
    TIEMPO_MAXIMO_MS,
  );

  it('NINGÚN id se regeneró en el camino: cada tabla local es exactamente el conjunto de ids de la nube', async () => {
    const lector = clienteReal();
    await lector.iniciarSesion(CORREO_DE_RESTAURACION, CLAVE_DE_RESTAURACION);
    for (const tabla of ORDEN_DE_RESTAURACION) {
      expect(ids(destino.base, tabla), tabla).toEqual(await idsEnLaNube(lector, tabla));
    }
    await lector.cerrarSesion();
    expect(existsSync(join(carpetaB, ARCHIVO_DEL_PUESTO_DE_CONTROL))).toBe(true);
  });
});
