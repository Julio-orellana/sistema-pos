/**
 * Conexión a la base de datos local SQLite.
 *
 * REGLA DE ARQUITECTURA: este archivo solo puede importarse desde el proceso
 * principal. El renderer jamás abre la base de datos; pide datos por IPC.
 *
 * ALCANCE ACTUAL: únicamente la conexión y una tabla de prueba que demuestra
 * que se puede leer y escribir. El esquema real del negocio (productos,
 * ventas, lotes, descuentos, caja) se diseña en el siguiente prompt.
 */

import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';

import type { DiagnosticoBaseDeDatos, SolicitudDiagnostico } from '@shared/types/ipc';

/** Nombre del archivo SQLite dentro de la carpeta de datos del usuario. */
const NOMBRE_ARCHIVO_BASE_DE_DATOS = 'pos-agricola.db';

/** Tabla temporal de verificación. Se elimina cuando llegue el esquema real. */
export const TABLA_DE_PRUEBA = 'prueba_conexion';

/** Instancia única. SQLite con better-sqlite3 es síncrono y no necesita pool. */
let conexion: Database.Database | null = null;

/**
 * Devuelve la ruta del archivo de base de datos.
 * Vive en `userData` (Application Support en macOS, AppData en Windows) para
 * que sobreviva a las actualizaciones de la aplicación y no se pierda al
 * reinstalar: ahí están las ventas de Jimmy.
 */
export function obtenerRutaBaseDeDatos(): string {
  return join(app.getPath('userData'), NOMBRE_ARCHIVO_BASE_DE_DATOS);
}

/**
 * Abre la base de datos y deja lista la tabla de prueba.
 * Es idempotente: llamarla dos veces devuelve la misma conexión.
 */
export function abrirBaseDeDatos(): Database.Database {
  if (conexion !== null) {
    return conexion;
  }

  const base = new Database(obtenerRutaBaseDeDatos());

  // WAL permite leer mientras se escribe: el cajero puede consultar un precio
  // mientras se está guardando una venta, sin bloqueos.
  base.pragma('journal_mode = WAL');

  // FULL (y no NORMAL) porque en la tienda hay cortes de energía: preferimos
  // una escritura un poco más lenta a perder la última venta cobrada.
  base.pragma('synchronous = FULL');

  // Las llaves foráneas vienen apagadas por defecto en SQLite. Se encienden
  // desde ya para que el esquema real no pueda quedar con datos huérfanos.
  base.pragma('foreign_keys = ON');

  crearTablaDePrueba(base);
  conexion = base;
  return conexion;
}

/** Devuelve la conexión abierta; falla ruidosamente si se usa antes de tiempo. */
export function obtenerBaseDeDatos(): Database.Database {
  if (conexion === null) {
    throw new Error(
      'La base de datos no está abierta. Llamá a abrirBaseDeDatos() durante el arranque de la aplicación.',
    );
  }
  return conexion;
}

/** Cierra la conexión al salir de la aplicación. */
export function cerrarBaseDeDatos(): void {
  if (conexion !== null) {
    conexion.close();
    conexion = null;
  }
}

/**
 * Crea la tabla temporal de verificación.
 *
 * TODO(esquema): reemplazar por las migraciones reales del dominio en el
 * siguiente prompt. Esta tabla existe solo para probar que better-sqlite3
 * quedó correctamente compilado contra el ABI de Electron.
 */
function crearTablaDePrueba(base: Database.Database): void {
  base.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLA_DE_PRUEBA} (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      descripcion  TEXT    NOT NULL,
      creado_en    TEXT    NOT NULL
    );
  `);
}

/** Fila tal como la devuelve SQLite para la tabla de prueba. */
interface FilaDePrueba {
  readonly descripcion: string;
}

/** Fila del conteo de registros. */
interface FilaConteo {
  readonly total: number;
}

/** Fila de una consulta PRAGMA que devuelve un solo valor. */
interface FilaPragmaTexto {
  readonly valor: string;
}

/**
 * Ejecuta el diagnóstico completo de la base de datos: verifica la conexión,
 * lee la configuración efectiva y —si se pide— escribe un registro de prueba
 * para demostrar que la escritura también funciona.
 */
export function ejecutarDiagnostico(solicitud: SolicitudDiagnostico): DiagnosticoBaseDeDatos {
  const base = obtenerBaseDeDatos();
  const verificadoEn = new Date().toISOString();

  if (solicitud.descripcionDePrueba !== undefined) {
    base
      .prepare(`INSERT INTO ${TABLA_DE_PRUEBA} (descripcion, creado_en) VALUES (?, ?)`)
      .run(solicitud.descripcionDePrueba, verificadoEn);
  }

  const versionSqlite = base.prepare('SELECT sqlite_version() AS valor').get() as FilaPragmaTexto;
  const modoJournal = String(base.pragma('journal_mode', { simple: true }));
  const llavesForaneas = Number(base.pragma('foreign_keys', { simple: true }));

  const registrosDePrueba = solicitud.incluirConteoDeRegistros
    ? (base.prepare(`SELECT COUNT(*) AS total FROM ${TABLA_DE_PRUEBA}`).get() as FilaConteo).total
    : null;

  const ultimaFila = base
    .prepare(`SELECT descripcion FROM ${TABLA_DE_PRUEBA} ORDER BY id DESC LIMIT 1`)
    .get() as FilaDePrueba | undefined;

  return {
    conectada: base.open,
    rutaArchivo: base.name,
    versionSqlite: versionSqlite.valor,
    modoJournal,
    llavesForaneasActivas: llavesForaneas === 1,
    tablaDePrueba: TABLA_DE_PRUEBA,
    registrosDePrueba,
    ultimoRegistro: ultimaFila?.descripcion ?? null,
    verificadoEn,
  };
}
