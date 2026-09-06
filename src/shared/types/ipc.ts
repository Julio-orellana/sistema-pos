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
  /**
   * Proceso principal -> renderer. Avisa que se presionó el atajo de salida
   * controlada y que hay que pedirle el PIN al administrador.
   */
  solicitudDeSalidaControlada: 'kiosko:solicitud-de-salida',
  /** Renderer -> proceso principal. Envía el PIN para autorizar la salida. */
  confirmarSalidaControlada: 'kiosko:confirmar-salida',
  /**
   * Renderer -> proceso principal. Pide iniciar la salida controlada desde el
   * botón de la interfaz. Deliberadamente NO abre el diálogo por su cuenta: le
   * pide al proceso principal que lo solicite, para que recorra exactamente el
   * mismo camino que el atajo de teclado y quede una única vía auditable.
   */
  solicitarSalidaControlada: 'kiosko:solicitar-salida',

  // --- Sesión y usuarios -------------------------------------------------
  /** Estado de arranque: si falta configuración inicial y quién está en sesión. */
  estadoDeSesion: 'sesion:estado',
  /** Usuarios activos que se muestran en la pantalla de ingreso. */
  listarUsuariosParaIngreso: 'sesion:listar-usuarios',
  /** Intento de ingreso con usuario y PIN. */
  iniciarSesion: 'sesion:iniciar',
  /** Cierre de la sesión actual. */
  cerrarSesion: 'sesion:cerrar',
  /** Creación del primer administrador, solo en una instalación vacía. */
  crearPrimerAdministrador: 'sesion:crear-primer-administrador',
  /** Un administrador configura o cambia su propio PIN de autorización remota. */
  configurarPinRemoto: 'sesion:configurar-pin-remoto',

  // --- Caja ---------------------------------------------------------------
  /** Turno abierto del usuario en sesión y denominaciones para contar. */
  estadoDeCaja: 'caja:estado',
  /** Abre un turno para el usuario en sesión. */
  abrirCaja: 'caja:abrir',
  /** Intenta cerrar el turno; con diferencia, exige PIN de autorización. */
  cerrarCaja: 'caja:cerrar',
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
  /** Si es `true`, el diagnóstico cuenta los registros de cada tabla. */
  incluirConteoDeRegistros: z.boolean().default(true),
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
  /** Tablas que existen en el esquema, en orden alfabético. */
  readonly tablas: readonly string[];
  /** Cuántas migraciones se aplicaron. */
  readonly migracionesAplicadas: number;
  /** Nombre de la última migración aplicada, o `null` si la base está virgen. */
  readonly ultimaMigracion: string | null;
  /** Registros por tabla, o `null` si no se pidió contar. */
  readonly conteoPorTabla: Readonly<Record<string, number>> | null;
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
// DTO: salida controlada del modo kiosko
// ---------------------------------------------------------------------------

/** Largo mínimo del PIN aceptado en la frontera IPC. */
const LARGO_MINIMO_PIN_IPC = 4;

/** Largo máximo del PIN aceptado en la frontera IPC. */
const LARGO_MAXIMO_PIN_IPC = 12;

/**
 * Esquema del payload que autoriza la salida.
 *
 * El PIN se valida también aquí, en la frontera, y no solo en el verificador:
 * un payload con un PIN de 5000 caracteres no debería siquiera llegar a la
 * comparación criptográfica.
 */
export const esquemaConfirmacionDeSalida = z.object({
  pin: z.string().min(LARGO_MINIMO_PIN_IPC).max(LARGO_MAXIMO_PIN_IPC),
});

/** Confirmación de salida ya validada. */
export type ConfirmacionDeSalida = z.infer<typeof esquemaConfirmacionDeSalida>;

/** Resultado de un intento de salida controlada. */
export interface ResultadoIntentoDeSalida {
  /** `true` solo si el PIN fue correcto y la aplicación va a cerrarse. */
  readonly autorizado: boolean;
  /** Código del resultado, para el log de auditoría. */
  readonly codigo: string;
  /** Mensaje que se le muestra a quien intentó salir. */
  readonly mensaje: string;
  /**
   * Segundos que faltan para poder reintentar, o `null` si no hay bloqueo.
   *
   * Deliberadamente NO se informan los intentos restantes: es información útil
   * para quien está adivinando y para quien mira la pantalla de otro.
   */
  readonly segundosParaReintentar: number | null;
}

// ---------------------------------------------------------------------------
// DTO: sesión y usuarios
// ---------------------------------------------------------------------------

/** Largo exacto del PIN, repetido aquí para validar en la frontera. */
const LARGO_DEL_PIN_IPC = 4;

/** Largo máximo del nombre de un usuario. */
const LARGO_MAXIMO_DEL_NOMBRE = 80;

/** Roles del sistema, en la frontera. */
export const ROLES = ['venta', 'administrativo'] as const;

/** Rol de un usuario. */
export type RolIpc = (typeof ROLES)[number];

/** Payload de un intento de ingreso. */
export const esquemaIntentoDeIngreso = z.object({
  usuarioId: z.string().min(1),
  pin: z.string().length(LARGO_DEL_PIN_IPC),
});

/** Intento de ingreso ya validado. */
export type IntentoDeIngreso = z.infer<typeof esquemaIntentoDeIngreso>;

/** Payload de creación del primer administrador. */
export const esquemaPrimerAdministrador = z.object({
  nombre: z.string().min(1).max(LARGO_MAXIMO_DEL_NOMBRE),
  pin: z.string().length(LARGO_DEL_PIN_IPC),
});

/** Datos del primer administrador ya validados. */
export type DatosPrimerAdministrador = z.infer<typeof esquemaPrimerAdministrador>;

/** Un usuario tal como se muestra en la pantalla de ingreso. */
export interface UsuarioParaIngreso {
  readonly id: string;
  readonly nombre: string;
  readonly rol: RolIpc;
  /** `true` si ahora mismo no puede intentar. */
  readonly bloqueado: boolean;
  /** Segundos que faltan para poder intentar, o `null`. */
  readonly segundosParaReintentar: number | null;
}

/** Quién está en sesión. */
export interface SesionIniciada {
  readonly id: string;
  readonly nombre: string;
  readonly rol: RolIpc;
  readonly desde: string;
}

/** Estado de arranque de la aplicación. */
export interface EstadoDeSesion {
  /**
   * `true` si la instalación no tiene ningún usuario todavía. Mientras sea
   * `true`, la única pantalla accesible es la de configuración inicial.
   */
  readonly requiereConfiguracionInicial: boolean;
  /** Usuario en sesión, o `null` si nadie ingresó. */
  readonly sesion: SesionIniciada | null;
}

/** Resultado de un intento de ingreso. */
export interface ResultadoDeIngreso {
  readonly autenticado: boolean;
  readonly codigo: string;
  readonly mensaje: string;
  readonly sesion: SesionIniciada | null;
  /** Segundos que faltan para reintentar. Nunca se informan intentos restantes. */
  readonly segundosParaReintentar: number | null;
}

// ---------------------------------------------------------------------------
// DTO: caja
// ---------------------------------------------------------------------------

/** Cantidad máxima de líneas de desglose que se aceptan en un arqueo. */
const MAXIMO_DE_LINEAS_DE_DESGLOSE = 60;

/** Largo máximo del texto de un monto escrito a mano. */
const LARGO_MAXIMO_DE_MONTO = 20;

/**
 * Efectivo declarado, en uno de los dos modos.
 *
 * Es una unión discriminada a propósito: hace IMPOSIBLE mandar los dos modos a
 * la vez desde la interfaz, en vez de tener que validarlo a mano.
 */
export const esquemaEfectivoDeclarado = z.discriminatedUnion('modo', [
  z.object({
    modo: z.literal('simple'),
    monto: z.string().min(1).max(LARGO_MAXIMO_DE_MONTO),
  }),
  z.object({
    modo: z.literal('detallado'),
    lineas: z
      .array(
        z.object({
          denominacionId: z.string().min(1),
          cantidad: z.number().int().min(0),
        }),
      )
      .max(MAXIMO_DE_LINEAS_DE_DESGLOSE),
  }),
]);

/** Efectivo declarado ya validado. */
export type EfectivoDeclaradoIpc = z.infer<typeof esquemaEfectivoDeclarado>;

/** Payload de apertura de caja. El usuario sale de la sesión, nunca del payload. */
export const esquemaAperturaDeCaja = z.object({ efectivo: esquemaEfectivoDeclarado });

/** Payload de cierre de caja. El PIN solo viaja si hubo diferencia que autorizar. */
export const esquemaCierreDeCaja = z.object({
  efectivo: esquemaEfectivoDeclarado,
  pin: z.string().length(LARGO_DEL_PIN_IPC).optional(),
});

/** Payload de configuración del PIN remoto. */
export const esquemaPinRemoto = z.object({ pin: z.string().length(LARGO_DEL_PIN_IPC) });

/** Una denominación tal como la muestra la pantalla de conteo. */
export interface DenominacionParaContar {
  readonly id: string;
  /** Valor facial como cadena canónica de dos decimales. */
  readonly valor: string;
  readonly tipo: 'billete' | 'moneda';
  readonly orden: number;
}

/** Turno de caja abierto del usuario en sesión. */
export interface TurnoAbierto {
  readonly id: string;
  readonly montoInicial: string;
  readonly abiertaEn: string;
}

/** Lo que la pantalla de caja necesita para dibujarse. */
export interface EstadoDeCaja {
  readonly turnoAbierto: TurnoAbierto | null;
  readonly denominaciones: readonly DenominacionParaContar[];
}

/** Resultado de intentar cerrar un turno. */
export interface ResultadoDeCierreIpc {
  readonly cerrada: boolean;
  readonly codigo: string;
  readonly mensaje: string;
  /** Diferencia como cadena canónica, con signo. Negativa es faltante. */
  readonly diferencia: string;
  readonly montoEsperado: string;
  readonly montoReal: string;
  /** Con cuál PIN se autorizó, si hubo autorización. */
  readonly autorizadaVia: 'presencial' | 'remoto' | null;
  /** Segundos para reintentar si el diálogo de autorización quedó bloqueado. */
  readonly segundosParaReintentar: number | null;
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

  /** Sesión, usuarios y primer arranque. */
  readonly sesion: {
    /** Estado de arranque: configuración inicial pendiente y sesión actual. */
    estado(): Promise<RespuestaIpc<EstadoDeSesion>>;
    /** Usuarios activos para la pantalla de ingreso. */
    listarUsuarios(): Promise<RespuestaIpc<readonly UsuarioParaIngreso[]>>;
    /** Intenta ingresar con un usuario y su PIN. */
    iniciar(usuarioId: string, pin: string): Promise<RespuestaIpc<ResultadoDeIngreso>>;
    /** Cierra la sesión actual. */
    cerrar(): Promise<RespuestaIpc<boolean>>;
    /** Crea el primer administrador. Solo funciona en una instalación vacía. */
    crearPrimerAdministrador(
      nombre: string,
      pin: string,
    ): Promise<RespuestaIpc<SesionIniciada>>;
    /** Configura el PIN de autorización remota del administrador en sesión. */
    configurarPinRemoto(pin: string): Promise<RespuestaIpc<boolean>>;
  };

  /** Apertura y cierre del turno de caja. */
  readonly caja: {
    /** Turno abierto del usuario en sesión y denominaciones para contar. */
    estado(): Promise<RespuestaIpc<EstadoDeCaja>>;
    /** Abre un turno para el usuario en sesión. */
    abrir(efectivo: EfectivoDeclaradoIpc): Promise<RespuestaIpc<TurnoAbierto>>;
    /**
     * Intenta cerrar. Sin `pin`, si hay diferencia devuelve
     * `REQUIERE_AUTORIZACION` con el monto exacto para mostrarlo antes de
     * pedir el código.
     */
    cerrar(
      efectivo: EfectivoDeclaradoIpc,
      pin?: string,
    ): Promise<RespuestaIpc<ResultadoDeCierreIpc>>;
  };

  /**
   * Salida controlada del modo kiosko.
   *
   * No es una función de la interfaz de venta y no debe tener ningún botón,
   * menú ni pista visual. Solo se activa con el atajo del administrador.
   */
  readonly kiosko: {
    /**
     * Se suscribe al aviso de que se presionó el atajo de salida.
     * Devuelve la función para darse de baja.
     */
    alSolicitarSalida(alRecibir: () => void): () => void;
    /**
     * Pide iniciar la salida controlada. El proceso principal responde
     * emitiendo la misma solicitud de PIN que dispara el atajo de teclado.
     */
    solicitarSalida(): Promise<RespuestaIpc<boolean>>;
    /** Envía el PIN al proceso principal para autorizar la salida. */
    confirmarSalida(pin: string): Promise<RespuestaIpc<ResultadoIntentoDeSalida>>;
  };
}
