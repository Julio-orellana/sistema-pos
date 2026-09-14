/**
 * LA RESTAURACIÓN CONTRA `pos-pruebas-descartable`, DE VERDAD.
 *
 * `npm run verify:restauracion`. No corre en `npm test`: habla con Supabase.
 *
 * Qué hace, de punta a punta y con las piezas REALES:
 *
 *   1. Llena una TERMINAL DE ORIGEN (SQLite real, servicios reales) con el
 *      catálogo realista de `terminal-de-origen.ts`, y la SUBE con la
 *      credencial de terminal: `SesionDeNube`, `SupabaseSyncProvider`,
 *      `SubidorDeFotos` y `TrabajadorDeSincronizacion`, los de la aplicación.
 *   2. Anota la hora, espera, y sube una SEGUNDA tanda —una caja nueva, una
 *      venta más, un usuario editado— para que exista «lo que la nube recibió
 *      después del robo».
 *   3. RESTAURA en una base nueva con `ClienteDeRestauracionHttp` y la
 *      credencial de restauración, con motivo «robo» y esa hora.
 *   4. Compara: ids fila por fila contra la nube, decimales byte a byte contra
 *      la terminal de origen, sha256 de la foto, usuarios sin PIN, conteos y
 *      suma por mes al centavo, y las anomalías por `recibido_en`.
 *   5. Y las tres cosas que tienen que NEGARSE o RETOMAR: base no vacía,
 *      deriva de esquema (un caso de §9.3 reintroducido), cancelar y retomar.
 *
 * Imprime la salida CRUDA: cada petición HTTP con su hora, método, ruta y
 * código, y cada ciclo del trabajador. El resumen va encima de la evidencia,
 * nunca en lugar de ella.
 *
 * ANTES DE CORRER: las once tablas de negocio del proyecto de pruebas tienen
 * que estar VACÍAS (por SQL, como siempre: `auditoria_log` no se vacía por
 * PostgREST). Con filas viejas, los UNIQUE de `usuarios.nombre` o
 * `recibos.numero_recibo` detendrían la cola por el 23505 del punto 19 de
 * §6.2, que es otro problema y no el que esto verifica. El arnés lo comprueba
 * y se niega a seguir si no es así.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HASH_SIN_PIN } from '@shared/auth';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { observarLotesEncolados } from '@main/database/bandeja-de-salida';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { reiniciarSenalDeTransaccion } from '@main/database/transaccion-en-curso';
import { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ClienteDeAuthHttp } from '@main/sincronizacion/auth-de-nube';
import { AlmacenDeCredencial, type CifradoSeguro } from '@main/sincronizacion/credencial';
import { DetectorDeConexion } from '@main/sincronizacion/deteccion-de-conexion';
import { SesionDeNube } from '@main/sincronizacion/sesion-de-nube';
import { SubidorDeFotos } from '@main/sincronizacion/subida-de-fotos';
import { SupabaseSyncProvider } from '@main/sincronizacion/supabase-sync-provider';
import { TrabajadorDeSincronizacion } from '@main/sincronizacion/trabajador';

import { ClienteDeRestauracionHttp, type ClienteDeRestauracion } from '../cliente-de-restauracion';
import type { FilaDeLaNube } from '../conversion-de-tipos';
import type { ContratoDeLaNube } from '../deriva-de-esquema';
import { ORDEN_DE_RESTAURACION } from '../orden-de-restauracion';
import { AlmacenDelPuestoDeControl, ARCHIVO_DEL_PUESTO_DE_CONTROL } from '../puesto-de-control';
import { ServicioDeRestauracion } from '../servicio-de-restauracion';
import { sembrarTerminalDeOrigen, type TerminalDeOrigen } from './terminal-de-origen';

// ---------------------------------------------------------------------------
// Entorno y seguro
// ---------------------------------------------------------------------------

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));

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

const entorno = leerEntorno();
const URL_DEL_PROYECTO = entorno.POS_NUBE_URL ?? '';
const LLAVE_PUBLICABLE = entorno.POS_NUBE_LLAVE_PUBLICABLE ?? '';

// EL SEGURO, antes de cualquier petición: la misma función que usa verify:nube.
const cargar = createRequire(import.meta.url);
const { exigirProyectoDePrueba } = cargar(join(RAIZ, 'scripts', 'proyectos-de-prueba.cjs')) as {
  exigirProyectoDePrueba: (referencia: string, url: string) => string;
};
exigirProyectoDePrueba(entorno.POS_NUBE_PROYECTO ?? '', URL_DEL_PROYECTO);

// ---------------------------------------------------------------------------
// La salida cruda: cada petición con su hora y su código
// ---------------------------------------------------------------------------

const peticiones: string[] = [];

/** Un `fetch` que anota hora, método, ruta y código de cada petición. Sirve como `typeof fetch` y como `BuscarEnLaRed`. */
function fetchAnotado(etiqueta: string): typeof fetch {
  return async (entrada: string | URL | Request, opciones?: RequestInit): Promise<Response> => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    const inicio = new Date().toISOString();
    const metodo = opciones?.method ?? 'GET';
    const ruta = url.replace(URL_DEL_PROYECTO, '');
    try {
      const respuesta = await fetch(url, opciones);
      const linea = `${inicio} [${etiqueta}] ${metodo} ${ruta} -> HTTP ${String(respuesta.status)}`;
      peticiones.push(linea);
      console.info(linea);
      return respuesta;
    } catch (error) {
      const linea = `${inicio} [${etiqueta}] ${metodo} ${ruta} -> SIN RESPUESTA (${error instanceof Error ? error.message : String(error)})`;
      peticiones.push(linea);
      console.info(linea);
      throw error;
    }
  };
}

const anotar = (mensaje: string): void => {
  console.info(`${new Date().toISOString()} ${mensaje}`);
};

/** Un cifrado trivial para la credencial de la terminal de origen: vive en una carpeta temporal. */
class CifradoParaLaPrueba implements CifradoSeguro {
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

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function contar(base: Database, tabla: string): number {
  return (base.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n;
}

function ids(base: Database, tabla: string): string[] {
  return (base.prepare(`SELECT id FROM ${tabla} ORDER BY id`).all() as { id: string }[]).map((f) => f.id);
}

function filaPorId(base: Database, tabla: string, id: string): Record<string, unknown> | undefined {
  return base.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Subir la terminal de origen con las piezas reales
// ---------------------------------------------------------------------------

const SIN_PAUSA = 0;

async function subirTodo(repos: Repositorios, carpeta: string, sesion: SesionDeNube): Promise<void> {
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
// Un cliente de restauración envuelto: cuenta páginas y sesiones, y puede
// devolver un contrato manipulado (para la deriva) o cancelar a mitad.
// ---------------------------------------------------------------------------

class ClienteEnvuelto implements ClienteDeRestauracion {
  public sesionesIniciadas = 0;
  public paginasLeidas = 0;
  public contratoManipulado: ((contrato: ContratoDeLaNube) => ContratoDeLaNube) | null = null;
  public alLeerPagina: ((numero: number) => void) | null = null;

  public constructor(private readonly real: ClienteDeRestauracionHttp) {}

  public async iniciarSesion(correo: string, contrasena: string): Promise<{ correo: string; rol: string }> {
    this.sesionesIniciadas += 1;
    return this.real.iniciarSesion(correo, contrasena);
  }
  public cerrarSesion(): Promise<void> {
    return this.real.cerrarSesion();
  }
  public async contrato(): Promise<ContratoDeLaNube> {
    const contrato = await this.real.contrato();
    return this.contratoManipulado === null ? contrato : this.contratoManipulado(contrato);
  }
  public contar(tabla: string): Promise<number> {
    return this.real.contar(tabla);
  }
  public leerPagina(tabla: string, desdeId: string | null, limite: number): Promise<FilaDeLaNube[]> {
    this.paginasLeidas += 1;
    this.alLeerPagina?.(this.paginasLeidas);
    return this.real.leerPagina(tabla, desdeId, limite);
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

function clienteReal(): ClienteDeRestauracionHttp {
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

function servicioSobre(base: Database, carpeta: string, cliente: ClienteDeRestauracion, filasPorPagina?: number): ServicioDeRestauracion {
  const repos = crearRepositorios(base);
  return new ServicioDeRestauracion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    cliente,
    urlDelProyecto: URL_DEL_PROYECTO,
    puestoDeControl: new AlmacenDelPuestoDeControl(carpeta),
    carpetaDeDatos: carpeta,
    carpetaDeRecibos: join(carpeta, 'recibos'),
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
async function idsEnLaNube(cliente: ClienteDeRestauracion, tabla: string): Promise<string[]> {
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

// ---------------------------------------------------------------------------
// El recorrido
// ---------------------------------------------------------------------------

let carpetaA: string;
let carpetaB: string;
let origen: { base: Database; limpiar: () => void };
let destino: { base: Database; limpiar: () => void };
let terminal: TerminalDeOrigen;
let reposA: Repositorios;
let sesionDeTerminal: SesionDeNube;
let fechaDelRobo: string;
let idVentaPosterior = '';
let idCajaPosterior = '';
let restauracion: ServicioDeRestauracion;
let clienteDeRestauracion: ClienteEnvuelto;

beforeAll(async () => {
  reiniciarSenalDeTransaccion();
  observarLotesEncolados(null);
  carpetaA = mkdtempSync(join(tmpdir(), 'pos-nube-origen-'));
  carpetaB = mkdtempSync(join(tmpdir(), 'pos-nube-destino-'));
  origen = crearBaseMigrada();
  destino = crearBaseMigrada();

  // 0. La nube tiene que estar vacía, y lo comprueba la credencial de restauración.
  const lector = clienteReal();
  await lector.iniciarSesion(entorno.POS_NUBE_RESTAURACION_CORREO ?? '', entorno.POS_NUBE_RESTAURACION_CLAVE ?? '');
  const conFilas: string[] = [];
  for (const tabla of ORDEN_DE_RESTAURACION) {
    if (tabla === 'configuracion_negocio') continue;
    const n = await lector.contar(tabla);
    if (n > 0) conFilas.push(`${tabla}=${String(n)}`);
  }
  await lector.cerrarSesion();
  if (conFilas.length > 0) {
    throw new Error(
      `El proyecto de pruebas NO está vacío (${conFilas.join(', ')}). Vaciá las once tablas por SQL y volvé a correr: con filas viejas los UNIQUE detendrían la cola (punto 19 de §6.2), que es otro problema.`,
    );
  }
  anotar('la nube está vacía: se puede sembrar');

  // 1. Sembrar la terminal de origen y subirla entera.
  terminal = sembrarTerminalDeOrigen(origen.base, carpetaA);
  reposA = terminal.repos;
  // La foto de los huevos se borra del disco ANTES de subir: es el caso «la
  // fila tiene foto y la nube no», y el trabajador la aparta sin detenerse.
  rmSync(join(carpetaA, terminal.fotoDeLosHuevos.rutaRelativa), { force: true });

  sesionDeTerminal = new SesionDeNube({
    auth: new ClienteDeAuthHttp(URL_DEL_PROYECTO, LLAVE_PUBLICABLE, fetchAnotado('auth')),
    credencial: new AlmacenDeCredencial(carpetaA, new CifradoParaLaPrueba()),
    registrar: (m): void => {
      anotar(`  sesion de terminal: ${m}`);
    },
  });
  await sesionDeTerminal.conectar(entorno.POS_NUBE_TERMINAL_CORREO ?? '', entorno.POS_NUBE_TERMINAL_CLAVE ?? '');
  anotar('--- SUBIDA 1: la terminal de origen entera ---');
  await subirTodo(reposA, carpetaA, sesionDeTerminal);

  // 2. La hora del «robo», y una segunda tanda después de ella.
  const ESPERA_PARA_SEPARAR_TANDAS_MS = 2500;
  await new Promise((r) => setTimeout(r, ESPERA_PARA_SEPARAR_TANDAS_MS));
  fechaDelRobo = new Date().toISOString();
  anotar(`--- FECHA DEL ROBO (reloj local, desfase medido ≈ 0): ${fechaDelRobo} ---`);
  await new Promise((r) => setTimeout(r, ESPERA_PARA_SEPARAR_TANDAS_MS));

  const usuarios = new ServicioDeUsuarios({ base: origen.base, usuarios: reposA.usuarios, auditoria: reposA.auditoria });
  usuarios.editar(terminal.ids.jimmy, terminal.ids.ana, { nombre: 'Ana María', rol: 'venta' });
  const caja = new ServicioDeCaja({
    base: origen.base,
    cajaSesiones: reposA.cajaSesiones,
    denominaciones: reposA.denominaciones,
    desglose: reposA.desgloseDeCaja,
    ventas: reposA.ventas,
    auditoria: reposA.auditoria,
  });
  // La caja abierta de la tanda 1 se cierra primero: una sola abierta en todo el sistema.
  const cierre = caja.intentarCerrar(terminal.ids.cajaAbierta, { modo: 'simple', monto: '250.00' }, { usuarioQueCierra: terminal.ids.jimmy });
  if (!cierre.cerrada) throw new Error(`no cerró la caja abierta: ${cierre.mensaje}`);
  const cajaPosterior = caja.abrir(terminal.ids.jimmy, { modo: 'simple', monto: '300.00' });
  idCajaPosterior = cajaPosterior.id;
  const venta = new ServicioDeVenta({
    base: origen.base,
    ventas: reposA.ventas,
    ventaDetalle: reposA.ventaDetalle,
    productos: reposA.productos,
    preciosEspeciales: reposA.preciosEspeciales,
    limitesDescuento: reposA.limitesDescuento,
    cajaSesiones: reposA.cajaSesiones,
    auditoria: reposA.auditoria,
  });
  idVentaPosterior = venta.registrar(terminal.ids.jimmy, 'administrativo', {
    lineas: [{ productoId: terminal.ids.frijol, cantidad: '1' }],
    descuento: null,
    formaPago: 'efectivo',
    numBoleta: null,
  }).venta.id;
  anotar('--- SUBIDA 2: lo posterior al robo (usuario editado, caja nueva, una venta) ---');
  await subirTodo(reposA, carpetaA, sesionDeTerminal);
  sesionDeTerminal.detener();

  // 3. Restaurar en una base nueva, con motivo robo.
  anotar('--- RESTAURACIÓN ---');
  clienteDeRestauracion = new ClienteEnvuelto(clienteReal());
  restauracion = servicioSobre(destino.base, carpetaB, clienteDeRestauracion);
  await restauracion.iniciar({
    correo: entorno.POS_NUBE_RESTAURACION_CORREO ?? '',
    contrasena: entorno.POS_NUBE_RESTAURACION_CLAVE ?? '',
    motivo: 'robo',
    fechaDelRobo,
  });
  await restauracion.esperarACorrida();
  anotar(`restauración en fase ${restauracion.progreso().fase}${restauracion.progreso().mensaje === null ? '' : `: ${restauracion.progreso().mensaje ?? ''}`}`);
});

afterAll(() => {
  observarLotesEncolados(null);
  reiniciarSenalDeTransaccion();
  console.info(`\n${String(peticiones.length)} peticiones HTTP en total.`);
  origen.limpiar();
  destino.limpiar();
  rmSync(carpetaA, { recursive: true, force: true });
  rmSync(carpetaB, { recursive: true, force: true });
});

describe('La restauración contra pos-pruebas-descartable', () => {
  it('llegó a la revisión: precondiciones cumplidas, tablas listas, sin mensaje de fallo', () => {
    const progreso = restauracion.progreso();
    expect(progreso.mensaje).toBeNull();
    expect(progreso.fase).toBe('revision');
    expect(progreso.tablas.every((t) => t.estado === 'lista')).toBe(true);
  });

  it('NINGÚN id se regeneró: cada tabla local, más sus excluidas, es exactamente el conjunto de ids de la nube', async () => {
    const lector = clienteReal();
    await lector.iniciarSesion(entorno.POS_NUBE_RESTAURACION_CORREO ?? '', entorno.POS_NUBE_RESTAURACION_CLAVE ?? '');
    const excluidas = restauracion.progreso().anomalias.filter((a) => a.excluida && !a.aceptada);
    for (const tabla of ORDEN_DE_RESTAURACION) {
      const enLaNube = await idsEnLaNube(lector, tabla);
      const locales = [...ids(destino.base, tabla), ...excluidas.filter((a) => a.tabla === tabla).map((a) => a.id)].sort();
      expect(locales, tabla).toEqual(enLaNube);
      anotar(`  ${tabla}: ${String(enLaNube.length)} ids en la nube, ${String(locales.length)} acá (con excluidas)`);
    }
    await lector.cerrarSesion();
  });

  it('LOS DECIMALES SOBREVIVEN BYTE A BYTE: las filas de la terminal de origen son idénticas en la restaurada', () => {
    /*
      `precios_especiales` NO se compara contra el origen, y conviene decir por
      qué: en producción nada la escribe —no hay servicio, ni canal, ni
      pantalla (CLAUDE.md §4.17, punto 18 de §6.2)— y la terminal de origen la
      siembra por el repositorio directo, que NO encola. Esa fila nunca llega a
      la nube, así que la restauración no puede traerla y la comprobación de
      ids contra la nube (que sí pasa) es la que manda. Lo que la venta usó de
      ese precio especial viaja igual: es el `precio_unitario_snap` de
      `venta_detalle`, que acá sí se compara byte a byte.
    */
    const tablasComparables = ['venta_detalle', 'productos', 'caja_sesion_denominaciones', 'limites_descuento', 'categorias', 'configuracion_negocio'];
    expect(contar(destino.base, 'precios_especiales')).toBe(0);
    expect(contar(origen.base, 'precios_especiales')).toBe(1);
    for (const tabla of tablasComparables) {
      for (const id of ids(origen.base, tabla)) {
        const restaurada = filaPorId(destino.base, tabla, id);
        const original = filaPorId(origen.base, tabla, id);
        if (tabla === 'venta_detalle' && restaurada === undefined) {
          // La línea de la venta posterior al robo quedó excluida: se comprueba aparte.
          continue;
        }
        expect(restaurada, `${tabla}/${id}`).toEqual(original);
      }
    }
    const linea = origen.base.prepare('SELECT id, subtotal_exacto FROM venta_detalle WHERE venta_id = ?').get(terminal.ids.ventaCombinada) as { id: string; subtotal_exacto: string };
    expect(linea.subtotal_exacto).toBe('4.165');
    const restaurada = destino.base.prepare('SELECT subtotal_exacto FROM venta_detalle WHERE venta_id = ?').get(terminal.ids.ventaCombinada) as { subtotal_exacto: string };
    expect(restaurada.subtotal_exacto).toBe('4.165');
    anotar('  venta_detalle.subtotal_exacto de la venta combinada: origen 4.165, restaurada 4.165');
  });

  it('EL TEXTO CRUDO que devuelve PostgREST para numeric(18,6) trae ceros de relleno, y la normalización los quita', async () => {
    const lector = clienteReal();
    await lector.iniciarSesion(entorno.POS_NUBE_RESTAURACION_CORREO ?? '', entorno.POS_NUBE_RESTAURACION_CLAVE ?? '');
    const linea = origen.base.prepare('SELECT id FROM venta_detalle WHERE venta_id = ?').get(terminal.ids.ventaCombinada) as { id: string };
    const cruda = await lector.leerFila('venta_detalle', linea.id);
    await lector.cerrarSesion();
    anotar(
      `  PostgREST devolvió venta_detalle.subtotal_exacto = ${JSON.stringify(cruda?.subtotal_exacto)} (tipo ${typeof cruda?.subtotal_exacto}), cantidad = ${JSON.stringify(cruda?.cantidad)}, creado_en = ${JSON.stringify(cruda?.creado_en)}, recibido_en = ${JSON.stringify(cruda?.recibido_en)}`,
    );
    expect(cruda?.subtotal_exacto).toBe('4.165000');
    expect(typeof cruda?.subtotal_exacto).toBe('string');
    expect(cruda?.cantidad).toBe('3.500');
  });

  it('la foto que subió la terminal vuelve con el MISMO sha256; la que no llegó a la nube queda listada', () => {
    const local = join(carpetaB, terminal.fotoDelMaiz.rutaRelativa);
    expect(existsSync(local)).toBe(true);
    const bajado = sha256(readFileSync(local));
    expect(bajado).toBe(sha256(terminal.fotoDelMaiz.bytes));
    anotar(`  foto del maíz: sha256 subido ${sha256(terminal.fotoDelMaiz.bytes)} = bajado ${bajado}`);
    expect(restauracion.progreso().fotos?.faltantes).toEqual([terminal.fotoDeLosHuevos.rutaRelativa]);
  });

  it('TODO usuario restaurado quedó sin ningún PIN utilizable', () => {
    const usuarios = destino.base.prepare('SELECT nombre, pin_hash, pin_remoto_hash, intentos_fallidos, bloqueado_hasta FROM usuarios').all() as Record<string, unknown>[];
    expect(usuarios.length).toBeGreaterThanOrEqual(2);
    for (const u of usuarios) {
      expect(u.pin_hash).toBe(HASH_SIN_PIN);
      expect(u.pin_remoto_hash).toBeNull();
      expect(u.intentos_fallidos).toBe(0);
      expect(u.bloqueado_hasta).toBeNull();
    }
  });

  it('la verificación cuadra: conteos nube = local + excluidas, y la suma de ventas por mes AL CENTAVO (SUM de Postgres contra Decimal)', () => {
    const verificacion = restauracion.progreso().verificacion;
    expect(verificacion?.ok).toBe(true);
    for (const c of verificacion?.conteos ?? []) {
      anotar(`  ${c.tabla}: nube ${String(c.nube)} = local ${String(c.local)} + excluidas ${String(c.excluidas)} -> ${c.coincide ? 'coincide' : 'NO'}`);
      expect(c.coincide, c.tabla).toBe(true);
    }
    for (const m of verificacion?.ventasPorMes ?? []) {
      anotar(`  ventas ${m.mes}: nube Q${m.nube} = local Q${m.local} + excluidas Q${m.excluidas} -> ${m.coincide ? 'coincide' : 'NO'}`);
      expect(m.coincide, m.mes).toBe(true);
    }
    expect(verificacion?.ventasPorMes.length).toBeGreaterThan(0);
  });

  it('las anomalías por recibido_en son exactamente lo de la segunda tanda: la venta excluida, la caja y el usuario restaurados y listados', () => {
    const anomalias = restauracion.progreso().anomalias;
    for (const a of anomalias) {
      anotar(`  anomalía ${a.tabla}/${a.id} recibido_en=${a.recibidoEn} ${a.excluida ? 'EXCLUIDA' : 'restaurada'}: ${a.resumen}`);
    }
    const porClave = new Map(anomalias.map((a) => [`${a.tabla}/${a.id}`, a]));
    expect(porClave.get(`ventas/${idVentaPosterior}`)?.excluida).toBe(true);
    expect(porClave.get(`caja_sesiones/${idCajaPosterior}`)?.excluida).toBe(false);
    expect(porClave.get(`usuarios/${terminal.ids.ana}`)?.excluida).toBe(false);
    expect(porClave.get(`productos/${terminal.ids.frijol}`)?.excluida).toBe(false);
    // Y nada de la primera tanda aparece.
    expect(porClave.has(`ventas/${terminal.ids.ventaCombinada}`)).toBe(false);
    expect(porClave.has(`usuarios/${terminal.ids.jimmy}`)).toBe(false);
    expect(destino.base.prepare('SELECT count(*) AS n FROM ventas WHERE id = ?').get(idVentaPosterior)).toEqual({ n: 0 });
  });

  it('aceptar la venta excluida la restaura con su línea y su recibo, y la verificación sigue cuadrando', async () => {
    await restauracion.aceptarExcluida('ventas', idVentaPosterior);
    expect(destino.base.prepare('SELECT count(*) AS n FROM ventas WHERE id = ?').get(idVentaPosterior)).toEqual({ n: 1 });
    expect(restauracion.progreso().verificacion?.ok).toBe(true);
    const detalleOrigen = origen.base.prepare('SELECT * FROM venta_detalle WHERE venta_id = ?').all(idVentaPosterior);
    const detalleRestaurado = destino.base.prepare('SELECT * FROM venta_detalle WHERE venta_id = ?').all(idVentaPosterior);
    expect(detalleRestaurado).toEqual(detalleOrigen);
  });

  it('revisar al usuario, asignar los PIN y terminar: sesión cerrada en la nube y puesto de control borrado', async () => {
    restauracion.revisarUsuario(terminal.ids.ana, { rol: 'venta', activo: true });
    for (const u of restauracion.progreso().usuarios.filter((u) => u.activo)) {
      restauracion.asignarPin(u.id, u.id === terminal.ids.jimmy ? '9753' : '8642');
    }
    expect(restauracion.impedimentosParaTerminar()).toEqual([]);
    const final = await restauracion.terminar();
    expect(final.fase).toBe('terminada');
    expect(existsSync(join(carpetaB, ARCHIVO_DEL_PUESTO_DE_CONTROL))).toBe(false);
    expect(peticiones.some((p) => p.includes('/auth/v1/logout'))).toBe(true);
  });

  it('SE NIEGA con una base local que ya tiene datos, sin iniciar sesión', async () => {
    const cliente = new ClienteEnvuelto(clienteReal());
    const servicio = servicioSobre(origen.base, carpetaA, cliente);
    await expect(
      servicio.iniciar({ correo: entorno.POS_NUBE_RESTAURACION_CORREO ?? '', contrasena: entorno.POS_NUBE_RESTAURACION_CLAVE ?? '', motivo: 'falla', fechaDelRobo: null }),
    ).rejects.toThrow(/ya tiene datos/);
    expect(cliente.sesionesIniciadas).toBe(0);
  });

  it('con DERIVA de esquema (ventas.total quitada del contrato, caso de §9.3) se detiene en la precondición, con la base vacía', async () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'pos-nube-deriva-'));
    const base = crearBaseMigrada();
    try {
      const cliente = new ClienteEnvuelto(clienteReal());
      cliente.contratoManipulado = (contrato): ContratoDeLaNube => ({
        ...contrato,
        tablas: { ...contrato.tablas, ventas: (contrato.tablas.ventas ?? []).filter((c) => c.nombre !== 'total') },
      });
      const servicio = servicioSobre(base.base, carpeta, cliente);
      await expect(
        servicio.iniciar({ correo: entorno.POS_NUBE_RESTAURACION_CORREO ?? '', contrasena: entorno.POS_NUBE_RESTAURACION_CLAVE ?? '', motivo: 'falla', fechaDelRobo: null }),
      ).rejects.toThrow(/ventas\.total existe en SQLite y no en la nube/);
      expect(cliente.paginasLeidas).toBe(0);
      for (const tabla of ORDEN_DE_RESTAURACION) {
        if (tabla !== 'configuracion_negocio') expect(contar(base.base, tabla), tabla).toBe(0);
      }
      expect(existsSync(join(carpeta, ARCHIVO_DEL_PUESTO_DE_CONTROL))).toBe(false);
    } finally {
      base.limpiar();
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  it('CANCELAR a mitad y RETOMAR: ni duplica ni pierde; termina con los mismos ids que la nube', async () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'pos-nube-retoma-'));
    const base = crearBaseMigrada();
    try {
      let servicio: ServicioDeRestauracion | null = null;
      const cliente = new ClienteEnvuelto(clienteReal());
      const PAGINA_EN_QUE_SE_CANCELA = 5;
      cliente.alLeerPagina = (numero): void => {
        if (numero === PAGINA_EN_QUE_SE_CANCELA) void servicio?.cancelar();
      };
      const FILAS_POR_PAGINA = 2;
      servicio = servicioSobre(base.base, carpeta, cliente, FILAS_POR_PAGINA);
      await servicio.iniciar({ correo: entorno.POS_NUBE_RESTAURACION_CORREO ?? '', contrasena: entorno.POS_NUBE_RESTAURACION_CLAVE ?? '', motivo: 'falla', fechaDelRobo: null });
      await servicio.esperarACorrida();
      expect(servicio.progreso().fase).toBe('cancelada');
      const parciales = ORDEN_DE_RESTAURACION.map((t) => `${t}=${String(contar(base.base, t))}`);
      anotar(`  cancelada tras ${String(cliente.paginasLeidas)} páginas; filas locales: ${parciales.join(', ')}`);
      expect(existsSync(join(carpeta, ARCHIVO_DEL_PUESTO_DE_CONTROL))).toBe(true);

      const retomado = servicioSobre(base.base, carpeta, new ClienteEnvuelto(clienteReal()), FILAS_POR_PAGINA);
      expect(retomado.hayRestauracionIncompleta()).toBe(true);
      await retomado.retomar({ correo: entorno.POS_NUBE_RESTAURACION_CORREO ?? '', contrasena: entorno.POS_NUBE_RESTAURACION_CLAVE ?? '' });
      await retomado.esperarACorrida();
      expect(retomado.progreso().fase).toBe('revision');
      expect(retomado.progreso().verificacion?.ok).toBe(true);
      const lector = clienteReal();
      await lector.iniciarSesion(entorno.POS_NUBE_RESTAURACION_CORREO ?? '', entorno.POS_NUBE_RESTAURACION_CLAVE ?? '');
      for (const tabla of ORDEN_DE_RESTAURACION) {
        expect(ids(base.base, tabla), tabla).toEqual(await idsEnLaNube(lector, tabla));
      }
      await lector.cerrarSesion();
      await retomado.cancelar();
    } finally {
      base.limpiar();
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
