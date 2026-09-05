/**
 * Contrato de comunicación entre el renderer (React) y el proceso principal.
 *
 * REGLA DE ARQUITECTURA: el renderer NUNCA toca SQLite, el sistema de archivos
 * ni la red. Todo lo que necesita lo pide por uno de estos canales. Este
 * archivo es la frontera: si un dato no está declarado aquí, no cruza.
 *
 * Los nombres de canal usan el patrón "modulo:accion" en español, porque son
 * vocabulario de negocio y así se leen directo en el log de auditoría.
 */

import { z } from 'zod';

/** Largo máximo del texto de prueba que puede escribirse en la tabla de diagnóstico. */
const LARGO_MAXIMO_DESCRIPCION_PRUEBA = 200;

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

/**
 * Catálogo único de canales IPC. Se declara `as const` para que TypeScript
 * conozca los literales exactos y sea imposible invocar un canal inexistente
 * por un error de tipeo.
 */
export const CANALES_IPC = {
  /** Diagnóstico de la conexión a SQLite (Tarea 4 del andamiaje). */
  diagnosticoBaseDeDatos: 'diagnostico:base-de-datos',
  /** Datos de la aplicación y de los adaptadores activos. */
  diagnosticoAplicacion: 'diagnostico:aplicacion',
} as const;

/** Unión de todos los canales válidos. */
export type CanalIpc = (typeof CANALES_IPC)[keyof typeof CANALES_IPC];

// ---------------------------------------------------------------------------
// Sobre de respuesta
// ---------------------------------------------------------------------------

/** Error transportable por IPC. No se envían objetos `Error` porque no
 *  sobreviven la serialización estructurada de Electron. */
export interface ErrorIpc {
  readonly codigo: string;
  readonly mensaje: string;
  readonly detalle?: string;
}

/**
 * Toda respuesta IPC viaja en este sobre.
 *
 * Se prefiere un resultado explícito sobre lanzar excepciones a través del
 * puente: así la interfaz siempre recibe algo que puede mostrarle al cajero, y
 * el auditor puede distinguir "falló" de "no había datos".
 */
export type RespuestaIpc<T> =
  | { readonly ok: true; readonly datos: T }
  | { readonly ok: false; readonly error: ErrorIpc };

/** Construye una respuesta exitosa. */
export function respuestaExitosa<T>(datos: T): RespuestaIpc<T> {
  return { ok: true, datos };
}

/** Construye una respuesta fallida. */
export function respuestaFallida<T>(codigo: string, mensaje: string, detalle?: string): RespuestaIpc<T> {
  return detalle === undefined ? { ok: false, error: { codigo, mensaje } } : { ok: false, error: { codigo, mensaje, detalle } };
}

// ---------------------------------------------------------------------------
// DTO: diagnóstico de base de datos
// ---------------------------------------------------------------------------

/**
 * Esquema de validación de la solicitud de diagnóstico.
 *
 * Todo payload que cruza IPC se valida en el proceso principal antes de tocar
 * la base de datos. El renderer es código que corre en una ventana web: aunque
 * hoy lo escribamos nosotros, se trata como entrada no confiable por principio.
 */
export const esquemaSolicitudDiagnostico = z.object({
  /** Si es `true`, el diagnóstico cuenta los registros de la tabla de prueba. */
  incluirConteoDeRegistros: z.boolean().default(true),
  /** Texto opcional que se inserta como registro de prueba para verificar escritura. */
  descripcionDePrueba: z.string().min(1).max(LARGO_MAXIMO_DESCRIPCION_PRUEBA).optional(),
});

/** Solicitud de diagnóstico ya validada. */
export type SolicitudDiagnostico = z.infer<typeof esquemaSolicitudDiagnostico>;

/** Resultado del diagnóstico de la base de datos local. */
export interface DiagnosticoBaseDeDatos {
  readonly conectada: boolean;
  /** Ruta absoluta del archivo SQLite en la máquina del cliente. */
  readonly rutaArchivo: string;
  readonly versionSqlite: string;
  /** Modo de journal efectivo (se espera "wal"). */
  readonly modoJournal: string;
  /** Si las llaves foráneas están activas (se espera `true`). */
  readonly llavesForaneasActivas: boolean;
  /** Nombre de la tabla de prueba usada para verificar lectura y escritura. */
  readonly tablaDePrueba: string;
  /** Cuántos registros tiene la tabla de prueba, o `null` si no se pidió contar. */
  readonly registrosDePrueba: number | null;
  /** Última descripción escrita en la tabla de prueba, si hay alguna. */
  readonly ultimoRegistro: string | null;
  /** Marca de tiempo ISO-8601 UTC del diagnóstico. */
  readonly verificadoEn: string;
}

// ---------------------------------------------------------------------------
// DTO: diagnóstico de la aplicación
// ---------------------------------------------------------------------------

/** Estado general de la aplicación y de los adaptadores activos. */
export interface DiagnosticoAplicacion {
  readonly nombreAplicacion: string;
  readonly version: string;
  readonly entorno: 'desarrollo' | 'produccion';
  readonly versionElectron: string;
  readonly versionNode: string;
  readonly versionChrome: string;
  readonly plataforma: string;
  /** Adaptador de impresión en uso (por defecto, el que solo genera PDF). */
  readonly adaptadorImpresion: string;
  /** Adaptador de sincronización en uso (por defecto, el simulado). */
  readonly adaptadorSincronizacion: string;
  /** `true` si la sincronización no está tocando la red (plan gratuito protegido). */
  readonly sincronizacionSimulada: boolean;
}

// ---------------------------------------------------------------------------
// Superficie que el preload expone al renderer
// ---------------------------------------------------------------------------

/**
 * API que `window.pos` ofrece a React. Es la única puerta del renderer hacia
 * el proceso principal; no hay `require`, ni `ipcRenderer` suelto, ni Node.
 */
export interface ApiPos {
  readonly diagnostico: {
    /** Verifica la conexión a SQLite y, opcionalmente, escribe un registro de prueba. */
    baseDeDatos(solicitud?: Partial<SolicitudDiagnostico>): Promise<RespuestaIpc<DiagnosticoBaseDeDatos>>;
    /** Devuelve versiones y adaptadores activos. */
    aplicacion(): Promise<RespuestaIpc<DiagnosticoAplicacion>>;
  };
}
