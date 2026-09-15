/**
 * Conexión a la base de datos local SQLite.
 *
 * REGLA DE ARQUITECTURA: este archivo solo puede importarse desde el proceso
 * principal. El renderer jamás abre la base de datos; pide datos por IPC.
 *
 * No importa Electron a propósito (la ruta del archivo vive en db-path.ts),
 * para que las pruebas puedan abrir bases reales sin arrancar la aplicación.
 */

import Database from 'better-sqlite3';

import type { DiagnosticoBaseDeDatos, SolicitudDiagnostico } from '@shared/types/ipc';
import {
  aplicarMigraciones,
  contarMigracionesAplicadas,
  obtenerUltimaMigracion,
  type ResultadoMigraciones,
} from './migrator';

/** Instancia única. SQLite con better-sqlite3 es síncrono y no necesita pool. */
let conexion: Database.Database | null = null;

/**
 * Aplica la configuración obligatoria a una conexión recién abierta.
 * Se expone aparte para que las pruebas configuren sus bases igual que la real.
 */
export function configurarConexion(base: Database.Database): void {
  // WAL permite leer mientras se escribe: el cajero puede consultar un precio
  // mientras se está guardando una venta, sin bloqueos.
  base.pragma('journal_mode = WAL');

  // FULL (y no NORMAL) porque en la tienda hay cortes de energía: preferimos
  // una escritura un poco más lenta a perder la última venta cobrada.
  base.pragma('synchronous = FULL');

  // Las llaves foráneas vienen APAGADAS por defecto en SQLite. Sin esto, las
  // referencias del esquema serían decorativas y se podrían dejar registros
  // huérfanos: una venta apuntando a un usuario que ya no existe.
  base.pragma('foreign_keys = ON');
}

/**
 * Abre una base de datos en la ruta indicada, la configura y aplica las
 * migraciones pendientes. Devuelve la conexión y el informe del migrador.
 */
export function abrirBaseDeDatosEn(ruta: string): {
  base: Database.Database;
  migraciones: ResultadoMigraciones;
} {
  const base = new Database(ruta);
  configurarConexion(base);
  const migraciones = aplicarMigraciones(base);
  return { base, migraciones };
}

/**
 * Abre la base de datos de la aplicación. Es idempotente: llamarla dos veces
 * devuelve la misma conexión sin volver a migrar.
 */
export function abrirBaseDeDatos(ruta: string): ResultadoMigraciones {
  if (conexion !== null) {
    return {
      aplicadasAhora: [],
      yaAplicadas: [],
      totalConocidas: contarMigracionesAplicadas(conexion),
      ultimaAplicada: obtenerUltimaMigracion(conexion),
    };
  }

  const abierta = abrirBaseDeDatosEn(ruta);
  conexion = abierta.base;
  return abierta.migraciones;
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

/** Informe del cierre ordenado, para el log y para la verificación de arranque. */
export interface ResultadoCierreOrdenado {
  readonly cerrada: boolean;
  readonly puntoDeControlAplicado: boolean;
  readonly mensaje: string;
}

/**
 * Cierra la base de datos de forma ordenada.
 *
 * La diferencia con `cerrarBaseDeDatos` es el punto de control (checkpoint) del
 * WAL. Con `journal_mode = WAL`, las escrituras recientes viven en un archivo
 * aparte (`-wal`) hasta que se consolidan en el archivo principal. Cerrar sin
 * consolidar deja la base correcta pero repartida en dos archivos, lo que
 * complica los respaldos y la revisión del archivo por parte del auditor.
 *
 * `TRUNCATE` vuelca todo al archivo principal y vacía el WAL, de modo que
 * después de una salida controlada el archivo .db contiene absolutamente todo.
 *
 * Nunca lanza: un fallo al consolidar no puede impedir que la aplicación
 * cierre, porque entonces habría que volver a matar el proceso a la fuerza.
 */
export function cerrarBaseDeDatosOrdenadamente(): ResultadoCierreOrdenado {
  if (conexion === null) {
    return {
      cerrada: false,
      puntoDeControlAplicado: false,
      mensaje: 'No había ninguna conexión abierta que cerrar.',
    };
  }

  let puntoDeControlAplicado = false;
  try {
    conexion.pragma('wal_checkpoint(TRUNCATE)');
    puntoDeControlAplicado = true;
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`[base-de-datos] No se pudo consolidar el WAL antes de cerrar: ${detalle}`);
  }

  conexion.close();
  conexion = null;

  return {
    cerrada: true,
    puntoDeControlAplicado,
    mensaje: puntoDeControlAplicado
      ? 'Base de datos consolidada y cerrada correctamente.'
      : 'Base de datos cerrada, pero el WAL no se pudo consolidar.',
  };
}

/** Fila de una consulta que devuelve un solo valor de texto. */
interface FilaTexto {
  readonly valor: string;
}

/** Fila de un conteo. */
interface FilaConteo {
  readonly total: number;
}

/** Nombre de una tabla del esquema. */
interface FilaNombreDeTabla {
  readonly name: string;
}

/**
 * Diagnóstico de la base de datos: verifica la conexión, la configuración
 * efectiva y el estado de las migraciones.
 *
 * Ya no escribe registros de prueba: desde que existe el esquema real, lo que
 * hay que verificar es que las migraciones corrieron y que las restricciones
 * están activas, no que se puede insertar en una tabla de juguete.
 */
export function ejecutarDiagnostico(solicitud: SolicitudDiagnostico): DiagnosticoBaseDeDatos {
  const base = obtenerBaseDeDatos();

  const versionSqlite = base.prepare('SELECT sqlite_version() AS valor').get() as FilaTexto;
  const modoJournal = String(base.pragma('journal_mode', { simple: true }));
  const llavesForaneas = Number(base.pragma('foreign_keys', { simple: true }));

  const tablas = base
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all() as FilaNombreDeTabla[];

  const conteoPorTabla: Record<string, number> = {};
  if (solicitud.incluirConteoDeRegistros) {
    for (const tabla of tablas) {
      // El nombre viene de sqlite_master, no de la interfaz: no hay inyección
      // posible, pero se entrecomilla igual por disciplina.
      const fila = base.prepare(`SELECT COUNT(*) AS total FROM "${tabla.name}"`).get() as FilaConteo;
      conteoPorTabla[tabla.name] = fila.total;
    }
  }

  return {
    conectada: base.open,
    rutaArchivo: base.name,
    versionSqlite: versionSqlite.valor,
    modoJournal,
    llavesForaneasActivas: llavesForaneas === 1,
    tablas: tablas.map((tabla) => tabla.name),
    migracionesAplicadas: contarMigracionesAplicadas(base),
    ultimaMigracion: obtenerUltimaMigracion(base),
    conteoPorTabla: solicitud.incluirConteoDeRegistros ? conteoPorTabla : null,
    verificadoEn: new Date().toISOString(),
  };
}
