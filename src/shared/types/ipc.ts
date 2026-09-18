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

import type { EstadoDeSincronizacion } from '../estado-de-sincronizacion';

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
  /**
   * Autorización remota por TOTP (migraciones 036 y 037), solo sobre la PROPIA
   * cuenta de un administrador. Reemplazan al viejo `sesion:configurar-pin-remoto`.
   *
   *   · iniciar: genera un secreto, lo guarda EN MEMORIA y devuelve el QR y el
   *     secreto en Base32 para mostrarlos. No escribe nada.
   *   · confirmar: con el primer código del teléfono. Solo si coincide se
   *     guarda el secreto, cifrado; si no, se descarta la inscripción entera.
   *   · cancelar: descarta la inscripción en curso.
   */
  iniciarAutorizacionRemota: 'sesion:autorizacion-remota-iniciar',
  confirmarAutorizacionRemota: 'sesion:autorizacion-remota-confirmar',
  cancelarAutorizacionRemota: 'sesion:autorizacion-remota-cancelar',

  // --- Caja ---------------------------------------------------------------
  /** Turno abierto del usuario en sesión y denominaciones para contar. */
  estadoDeCaja: 'caja:estado',
  /** Abre un turno para el usuario en sesión. */
  abrirCaja: 'caja:abrir',
  /** Intenta cerrar el turno; con diferencia, exige PIN de autorización. */
  cerrarCaja: 'caja:cerrar',
  /**
   * Descarta la autorización de un cierre ya validada con PIN y todavía no
   * confirmada. Vive en el proceso principal: cancelar solo en la pantalla la
   * dejaría usable desde la consola (§4.40).
   */
  cancelarAutorizacionDeCierre: 'caja:cancelar-autorizacion-de-cierre',

  // --- Catálogo: categorías ------------------------------------------------
  /** Todas las categorías, activas e inactivas, con su conteo de productos. */
  categoriasListar: 'catalogo:categorias-listar',
  /** Crea una categoría. */
  categoriasCrear: 'catalogo:categorias-crear',
  /** Edita nombre y orden de una categoría. */
  categoriasEditar: 'catalogo:categorias-editar',
  /** Activa o desactiva una categoría. Nunca la borra. */
  categoriasFijarActivo: 'catalogo:categorias-fijar-activo',

  // --- Catálogo: productos -------------------------------------------------
  /** Todos los productos, activos e inactivos, con su categoría resuelta. */
  productosListar: 'catalogo:productos-listar',
  /** Crea un producto con su inventario inicial. */
  productosCrear: 'catalogo:productos-crear',
  /** Edita los datos de catálogo de un producto. NO mueve el inventario. */
  productosEditar: 'catalogo:productos-editar',
  /** Activa o desactiva un producto. Nunca lo borra. */
  productosFijarActivo: 'catalogo:productos-fijar-activo',
  /**
   * Recepción de mercadería: SUMA al inventario y deja su propio asiento de
   * auditoría. Canal separado de `productosEditar` a propósito: es un hecho
   * distinto del negocio, no un campo más del formulario.
   */
  productosAjustarInventario: 'catalogo:productos-ajustar-inventario',
  /**
   * Abre el diálogo nativo de archivos, valida la imagen y la copia a la
   * carpeta de datos del usuario. Devuelve la ruta relativa que se guarda.
   */
  productosElegirFoto: 'catalogo:productos-elegir-foto',

  // --- Venta ---------------------------------------------------------------
  /**
   * Todo lo que la pantalla de venta necesita para dibujarse: si se puede
   * vender, el catálogo activo en su orden y las categorías.
   *
   * Es un canal APARTE de los del catálogo a propósito: aquellos exigen rol
   * administrativo, y vender lo hace un cajero. Devuelve solo productos
   * activos y ningún dato de administración.
   */
  ventaEstado: 'venta:estado',
  /**
   * Registra la venta del ticket. Es el canal que escribe: descuenta
   * inventario, inserta la venta y su detalle y mueve los contadores, todo
   * dentro de una sola transacción.
   */
  ventaCobrar: 'venta:cobrar',
  /**
   * Anula una venta ya registrada (docs/ANULACION-DE-VENTA.md). Se llama DOS
   * veces, como el cobro con descuento excedente: la primera SIN PIN valida
   * todo y devuelve la vista previa; la segunda CON el PIN de un administrador
   * ejecuta. Si algo impide la anulación —caja cerrada, voucher que no
   * coincide, unidad cambiada— la primera ya lo dice y no se pide el PIN.
   */
  ventaAnular: 'venta:anular',

  // --- Gestión de usuarios --------------------------------------------------
  /**
   * Alta, edición, cambio de PIN y baja de usuarios.
   *
   * TODOS exigen rol administrativo. Hasta el Prompt 21 el sistema solo sabía
   * crear al PRIMER administrador, y únicamente mientras la tabla estuviera
   * vacía: no había forma de dar de alta al cajero de la tienda.
   */
  usuariosListar: 'usuarios:listar',
  usuariosCrear: 'usuarios:crear',
  usuariosEditar: 'usuarios:editar',
  /** Acción APARTE de editar: el PIN es información sensible, no un campo más. */
  usuariosCambiarPin: 'usuarios:cambiar-pin',
  usuariosFijarActivo: 'usuarios:fijar-activo',

  // --- Negocio y recibos ----------------------------------------------------
  /** Datos de la tienda que encabezan el recibo. Solo rol administrativo. */
  negocioObtener: 'negocio:obtener',
  negocioGuardar: 'negocio:guardar',
  /** Historial de recibos emitidos. Lo consulta cualquiera con sesión. */
  recibosListar: 'recibos:listar',
  /** Vuelve a emitir uno ya emitido, regenerando el PDF desde la base. */
  recibosReimprimir: 'recibos:reimprimir',
  /** El recibo en texto plano, para mostrarlo en pantalla tal como sale. */
  recibosVer: 'recibos:ver',

  // --- Reportes -------------------------------------------------------------
  /**
   * Los tres reportes. TODOS exigen rol administrativo: son la foto de cuánto
   * entró y de qué hay en bodega, que es información de dueño, no de mostrador.
   *
   * NINGUNO AGREGA NI ORDENA EN SQL sobre una columna decimal: el proceso
   * principal trae las filas y suma con Decimal.js. Ver CLAUDE.md §4.15.
   */
  reportesResumenDeVentas: 'reportes:resumen-de-ventas',
  reportesVentasPorProducto: 'reportes:ventas-por-producto',
  reportesInventario: 'reportes:inventario',

  // --- Límites de descuento -------------------------------------------------
  /** Topes de descuento por rol. Reemplazan la dependencia de `seed:limites`. */
  limitesListar: 'limites:listar',
  limitesFijar: 'limites:fijar',

  // --- Conexión con la nube (fase 3.a) --------------------------------------
  /**
   * Estado de la credencial de la terminal. Solo rol administrativo.
   *
   * **NO devuelve ningún secreto**: ni el token de refresco, ni el access
   * token, ni por supuesto la contraseña. Solo si hay credencial, con qué
   * correo y cómo va la renovación.
   */
  nubeEstado: 'nube:estado',
  /**
   * Conecta la terminal: inicia sesión contra Supabase Auth y guarda **solo**
   * el token de refresco, cifrado. Solo rol administrativo.
   *
   * La contraseña viaja por este canal una vez y no se guarda en ningún lado.
   */
  nubeConectar: 'nube:conectar',

  // --- Sincronización: barra de estado y pantalla (fase 4.a) ---------------
  /**
   * Resumen LIVIANO del estado de sincronización. SIN guard de rol: lo
   * consulta la barra de estado, que está montada siempre, incluso antes de
   * iniciar sesión. No devuelve nada sensible, solo cuántos pendientes hay y
   * un estado ya calculado (§3.3 del diseño).
   */
  sincronizacionResumen: 'sincronizacion:resumen',
  /**
   * Detalle completo para la pantalla de sincronización. Solo rol
   * administrativo: pendientes por tabla, el lote bloqueante con su error
   * completo, y el estado de la credencial.
   */
  sincronizacionDetalle: 'sincronizacion:detalle',
  /** «Reintentar ahora»: quita el bloqueo de un lote y agenda un ciclo. Solo rol administrativo. */
  sincronizacionReintentarLote: 'sincronizacion:reintentar-lote',
  /**
   * «Saltar este lote»: exige PIN de administrador y queda en `auditoria_log`
   * (decisión 9 del diseño). Es la única forma legítima de dejar un hueco
   * deliberado en el respaldo de la nube.
   */
  sincronizacionSaltarLote: 'sincronizacion:saltar-lote',

  // --- Restauración desde la nube (fase 4.b) ---------------------------------
  /**
   * NINGUNO de estos canales lleva guard de sesión ni de rol, y no es un
   * descuido: la restauración corre sobre una instalación VACÍA, antes de que
   * exista ningún usuario local, así que no hay sesión que exigir. Quien
   * autoriza es la nube: hace falta iniciar sesión con el usuario de rol
   * `restauracion` (el del dueño), y el servicio se niega en cuanto la base
   * tiene una sola fila de negocio. Ver `src/main/ipc/restauracion.ts`.
   */
  /** ¿Está configurada la nube, está vacía la base, hay una restauración a medias? */
  restauracionEstado: 'restauracion:estado',
  /** Inicia sesión en la nube, comprueba las precondiciones y arranca la transferencia. */
  restauracionIniciar: 'restauracion:iniciar',
  /** Sigue una restauración interrumpida por la tabla y la página donde quedó. */
  restauracionRetomar: 'restauracion:retomar',
  /** El avance, tabla por tabla, para la pantalla de progreso. */
  restauracionProgreso: 'restauracion:progreso',
  /** Para al terminar la página en curso. Lo bajado queda; se puede retomar. */
  restauracionCancelar: 'restauracion:cancelar',
  /** Restaura igual una fila que quedó excluida por ser posterior al robo. */
  restauracionAceptarExcluida: 'restauracion:aceptar-excluida',
  /** La revisión obligatoria de un usuario con cambios posteriores al robo. */
  restauracionRevisarUsuario: 'restauracion:revisar-usuario',
  /** Le asigna un PIN nuevo a un usuario restaurado, que llega sin ninguno. */
  restauracionAsignarPin: 'restauracion:asignar-pin',
  /** Cierra la restauración: asiento, cierre de sesión en la nube, fin del puesto de control. */
  restauracionTerminar: 'restauracion:terminar',

  // --- Impresora térmica de ESTA terminal (§4.43) -----------------------------
  /**
   * Todos exigen rol administrativo. La impresora es configuración de la
   * terminal (vive en `impresora.json`, no en la base) y el ticket de prueba
   * gasta papel de verdad.
   */
  /** Qué impresora hay configurada, dicho para una persona, y la última prueba. */
  impresoraEstado: 'impresora:estado',
  /** Las impresoras que el sistema operativo tiene instaladas. */
  impresoraListar: 'impresora:listar',
  /** Guarda en `impresora.json` el NOMBRE de una impresora de la lista. */
  impresoraGuardar: 'impresora:guardar',
  /** Quita la impresora: los recibos vuelven a quedar solo en PDF. */
  impresoraQuitar: 'impresora:quitar',
  /** Manda un ticket de prueba corto, sin datos de ventas, a la impresora elegida. */
  impresoraImprimirPrueba: 'impresora:imprimir-prueba',
  /** Lo que la persona vio salir del ticket de prueba. */
  impresoraConfirmarPrueba: 'impresora:confirmar-prueba',

  // --- Historial de cajas (§4.44) ----------------------------------------------
  /**
   * Los dos exigen rol administrativo. El historial muestra cuánto se contó,
   * cuánto faltó y quién autorizó cada corrección: es para auditar, no para
   * operar la caja.
   */
  /** Todas las sesiones de caja, con filtro por días de apertura y por quién abrió. */
  cajasHistorial: 'cajas:historial',
  /** Una sesión con su desglose de denominaciones y todos sus conteos sellados. */
  cajasDetalle: 'cajas:detalle',
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
  /**
   * La impresora de esta terminal, dicha para una persona: «Sin impresora
   * configurada — los recibos solo se generan en PDF» o «Impresora
   * configurada: [nombre]». Nunca el nombre de una clase del código.
   */
  readonly impresora: string;
  /** Adaptador de sincronización en uso (por defecto, el simulado). */
  readonly adaptadorSincronizacion: string;
  /** `true` si la sincronización no está tocando la red (plan gratuito protegido). */
  readonly sincronizacionSimulada: boolean;
  /**
   * Qué tarjeta gráfica vio Chromium y qué aceleró, dicho para leerlo:
   * «GPU 0x8086:0x0116 · composición: enabled · rasterizado: …» (§4.62).
   */
  readonly aceleracionGrafica: string;
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
  /**
   * `true` si el usuario no tiene ningún PIN: fue restaurado desde la nube y
   * todavía nadie le asignó uno. No puede entrar con ningún PIN, y la pantalla
   * lo dice en vez de dejar que consuma intentos contra una marca.
   */
  readonly sinPin: boolean;
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
  /**
   * `true` si hay una restauración desde la nube que empezó y no terminó
   * (existe su puesto de control). Mientras sea `true`, la única pantalla
   * accesible es la de restauración: la base está a medias y sus usuarios no
   * tienen PIN todavía.
   */
  readonly restauracionIncompleta: boolean;
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

/** Largo del código remoto de TOTP en la frontera. */
const LARGO_DEL_CODIGO_REMOTO_IPC = 6;

/**
 * Payload de cierre de caja.
 *
 * Hay DOS PIN posibles y son distintos, no dos nombres de lo mismo:
 *
 *   · `pinCajaAjena` autoriza cerrar un turno que abrió otra persona. Solo
 *     acepta el PIN NORMAL de un administrador.
 *   · `pin` autoriza una DIFERENCIA de arqueo. Acepta también el código de
 *     seis dígitos de la app de autenticación.
 *
 * Un mismo cierre puede necesitar los dos: cerrar la caja de otro y encima
 * encontrarla descuadrada. Cada uno tiene su propio candado de intentos.
 */

export const esquemaCierreDeCaja = z.object({
  efectivo: esquemaEfectivoDeclarado,
  /** 4 dígitos (PIN normal) o 6 (código remoto de TOTP). El servicio decide cuál es. */
  pin: z.string().min(LARGO_DEL_PIN_IPC).max(LARGO_DEL_CODIGO_REMOTO_IPC).optional(),
  pinCajaAjena: z.string().length(LARGO_DEL_PIN_IPC).optional(),
  /**
   * Segundo paso del cierre autorizado: confirma la autorización que un PIN
   * correcto dejó pendiente. Sin PIN: el PIN ya se validó y no se reenvía.
   */
  confirmarAutorizacion: z.literal(true).optional(),
});

/** Payload de la confirmación de una inscripción remota: el primer código del teléfono. */
export const esquemaCodigoDeInscripcion = z.object({ codigo: z.string().length(LARGO_DEL_CODIGO_REMOTO_IPC) });

/**
 * Una inscripción remota iniciada, tal como la muestra la pantalla.
 *
 * LLEVA EL SECRETO, y es la única respuesta del sistema que lo lleva: tiene que
 * verse para cargarlo en el teléfono. La pantalla lo muestra y no lo guarda.
 */
export interface InscripcionRemotaIpc {
  /** El secreto en Base32, para teclearlo a mano. */
  readonly secreto: string;
  /**
   * El QR de la URI `otpauth://`, como matriz de módulos: `true` es un módulo
   * oscuro. Se dibuja en la pantalla con rectángulos, sin HTML crudo.
   */
  readonly qr: readonly (readonly boolean[])[];
  /** Si reemplaza una inscripción anterior de esta misma persona. */
  readonly reemplazaUnaAnterior: boolean;
  /** Hasta cuándo se puede confirmar (ISO-8601 UTC). */
  readonly venceEn: string;
}

/** Una denominación tal como la muestra la pantalla de conteo. */
export interface DenominacionParaContar {
  readonly id: string;
  /** Valor facial como cadena canónica de dos decimales. */
  readonly valor: string;
  readonly tipo: 'billete' | 'moneda';
  readonly orden: number;
}

/**
 * EL turno de caja abierto del sistema, si hay alguno.
 *
 * No es "el turno del usuario en sesión": la caja física es una sola y puede
 * haberla abierto otra persona. La pantalla necesita saber quién, para poder
 * mostrar los tres estados posibles.
 */
export interface TurnoAbierto {
  readonly id: string;
  readonly montoInicial: string;
  readonly abiertaEn: string;
  /** Quién lo abrió. */
  readonly abiertaPorId: string;
  /** Nombre de quien lo abrió, ya resuelto: el renderer no cruza tablas. */
  readonly abiertaPorNombre: string;
  /**
   * `true` si lo abrió alguien distinto del usuario en sesión. Lo decide el
   * proceso principal y no la interfaz: es la misma comprobación que después
   * exige el PIN, y calcularla dos veces es pedirle a las dos que coincidan.
   */
  readonly esDeOtroUsuario: boolean;
  /**
   * Suma de las ventas EN EFECTIVO y completadas de este turno, hasta ahora.
   * Cadena canónica de dos decimales. La calcula el proceso principal con
   * Decimal.js: la pantalla no suma.
   *
   * `null` PARA TODO USUARIO QUE NO SEA ADMINISTRATIVO (§4.40): inicial más
   * ventas en efectivo ES el teórico, así que viaja o no viaja junto con él.
   */
  readonly ventasEnEfectivo: string | null;
  /** Cuántas ventas en efectivo lleva el turno. `null` con la misma regla. */
  readonly cantidadDeVentasEnEfectivo: number | null;
  /**
   * `monto_inicial + ventasEnEfectivo`: lo que DEBERÍA haber en el cajón en
   * este momento. Es el mismo cálculo que `monto_esperado` al cerrar
   * (`ServicioDeCaja.montoEsperadoDe`), mostrado durante el turno (§4.39).
   *
   * `null` PARA TODO USUARIO QUE NO SEA ADMINISTRATIVO (§4.40). Lo decide
   * `turnoParaLaVentana` en el proceso principal: lo que no cruza el puente no
   * se puede leer desde la consola.
   */
  readonly montoTeorico: string | null;
  /**
   * El primer conteo de cierre sellado de este turno, si hubo alguno. Viene de
   * `auditoria_log`, así que sigue ahí aunque se salga de la pantalla o se
   * reinicie la aplicación: que el aviso se borrara al reiniciar invitaría a
   * reiniciar para no verlo.
   *
   * SIN el esperado ni la diferencia (§4.40): se muestra mientras se vuelve a
   * contar, y esos dos datos dirían qué número poner.
   */
  readonly primerConteoSellado: ConteoConfirmadoIpc | null;
}

/** Un conteo de cierre ya confirmado, sin nada que revele el esperado. */
export interface ConteoConfirmadoIpc {
  readonly fecha: string;
  readonly montoReal: string;
}

/** Lo que la pantalla de caja necesita para dibujarse. */
export interface EstadoDeCaja {
  /** `null` si NO hay ninguna caja abierta en todo el sistema. */
  readonly turnoAbierto: TurnoAbierto | null;
  readonly denominaciones: readonly DenominacionParaContar[];
}

/** Un conteo de cierre confirmado con diferencia, que quedó sellado (§4.39). */
export interface ConteoSelladoIpc {
  readonly fecha: string;
  /** `null` para quien no es administrativo (§4.40): ver `resultadoDeCierreParaLaVentana`. */
  readonly montoEsperado: string | null;
  readonly montoReal: string;
  /** `null` con la misma regla: lo contado menos la diferencia es el esperado. */
  readonly diferencia: string | null;
}

/**
 * Resultado de intentar cerrar un turno.
 *
 * `codigo` puede ser `CIERRE_CORRECTO`, `REQUIERE_AUTORIZACION` (hay
 * diferencia), `REQUIERE_AUTORIZACION_DE_RECONTEO` (el conteo de ahora cuadra
 * pero el turno ya tiene un conteo sellado con diferencia: cambió lo contado,
 * cambió lo esperado, o las dos cosas), `REQUIERE_AUTORIZACION_DE_CAJA_AJENA`
 * (la abrió otro), o el código de un intento de autorización fallido.
 */
export interface ResultadoDeCierreIpc {
  readonly cerrada: boolean;
  readonly codigo: string;
  readonly mensaje: string;
  /**
   * Diferencia como cadena canónica, con signo. Negativa es faltante.
   *
   * `null` para quien no es administrativo mientras la caja no se cerró
   * (§4.40): con lo contado, la diferencia revela el esperado.
   */
  readonly diferencia: string | null;
  /**
   * Lo que el sistema espera. `null` MIENTRAS NO SE HAYA CONFIRMADO NINGÚN
   * CONTEO (§4.40): el pedido de autorización de una caja ajena ocurre antes
   * de contar, y mandarlo ahí le diría a quien va a contar qué número poner.
   * Con un conteo confirmado viaja SOLO a un administrativo, que es quien
   * autoriza y tiene que ver qué aprueba (§4.9). A cualquier otro rol le llega
   * `null` hasta que la caja se cierra (`resultadoDeCierreParaLaVentana`).
   */
  readonly montoEsperado: string | null;
  readonly montoReal: string;
  /** Con cuál PIN se autorizó, si hubo autorización. */
  readonly autorizadaVia: 'presencial' | 'remoto' | null;
  /** Segundos para reintentar si el diálogo de autorización quedó bloqueado. */
  readonly segundosParaReintentar: number | null;
  /** Con cuánto se abrió el turno. Para la confirmación del cierre. */
  readonly montoInicial: string;
  /**
   * El primer conteo sellado del turno, si es distinto del de ahora. La
   * pantalla lo muestra al pedir la autorización: quien autoriza tiene que ver
   * los DOS números, no solo el último.
   */
  readonly primerConteo: ConteoSelladoIpc | null;
}

// ---------------------------------------------------------------------------
// DTO: catálogo (categorías y productos)
// ---------------------------------------------------------------------------

/** Largo máximo del nombre de una categoría, repetido aquí para la frontera. */
const LARGO_MAXIMO_NOMBRE_CATEGORIA = 60;

/** Largo máximo del nombre de un producto. */
const LARGO_MAXIMO_NOMBRE_PRODUCTO = 80;

/** Largo máximo del motivo de un ajuste de inventario. */
const LARGO_MAXIMO_MOTIVO = 200;

/** Largo máximo de un número escrito a mano (precio, cantidad, inventario). */
const LARGO_MAXIMO_NUMERO = 20;

/** Orden máximo admitido en la frontera; más allá es un error de tecleo. */
const ORDEN_MAXIMO = 9999;

/** Largo máximo de una ruta relativa de foto. */
const LARGO_MAXIMO_RUTA_FOTO = 300;

/** Tipos de medida, en la frontera. */
export const TIPOS_DE_MEDIDA_IPC = ['unidad', 'peso'] as const;

/** Unidades de peso, en la frontera. */
export const UNIDADES_DE_PESO_IPC = ['lb', 'kg'] as const;

/** Cómo se mide un producto, del lado de la interfaz. */
export type TipoMedidaIpc = (typeof TIPOS_DE_MEDIDA_IPC)[number];

/** Unidad de peso, del lado de la interfaz. */
export type UnidadPesoIpc = (typeof UNIDADES_DE_PESO_IPC)[number];

/** Payload de creación de categoría. */
export const esquemaCategoriaNueva = z.object({
  nombre: z.string().min(1).max(LARGO_MAXIMO_NOMBRE_CATEGORIA),
  orden: z.number().int().min(0).max(ORDEN_MAXIMO),
});

/** Payload de edición de categoría. */
export const esquemaCategoriaEditada = esquemaCategoriaNueva.extend({
  id: z.string().min(1),
});

/** Payload de activación o desactivación, común a categorías y productos. */
export const esquemaFijarActivo = z.object({
  id: z.string().min(1),
  activo: z.boolean(),
});

/**
 * Campos de catálogo de un producto.
 *
 * `unidadPeso` viaja como `null` cuando no aplica, nunca ausente: así el
 * proceso principal distingue "se mandó vacío a propósito" de "se olvidó el
 * campo", y la coherencia con `tipoMedida` se comprueba sobre un valor real.
 * La regla en sí NO vive aquí sino en el servicio, porque una validación en la
 * frontera se saltaría llamando al servicio desde otro lugar.
 */
const camposDeProducto = {
  nombre: z.string().min(1).max(LARGO_MAXIMO_NOMBRE_PRODUCTO),
  categoriaId: z.string().min(1),
  tipoMedida: z.enum(TIPOS_DE_MEDIDA_IPC),
  unidadPeso: z.enum(UNIDADES_DE_PESO_IPC).nullable(),
  cantidadPredefinidaIcono: z.string().min(1).max(LARGO_MAXIMO_NUMERO),
  precioBase: z.string().min(1).max(LARGO_MAXIMO_NUMERO),
  /**
   * Costo para la tienda. OBLIGATORIO en el payload y nulable: la pantalla
   * dice siempre qué quiere, y `null` (o vacío) es «sin costo cargado».
   */
  precioCompra: z.string().max(LARGO_MAXIMO_NUMERO).nullable(),
  fotoPath: z.string().max(LARGO_MAXIMO_RUTA_FOTO).nullable(),
};

/** Payload de creación de producto: los campos de catálogo más el saldo inicial. */
export const esquemaProductoNuevo = z.object({
  ...camposDeProducto,
  inventarioInicial: z.string().min(1).max(LARGO_MAXIMO_NUMERO),
});

/** Payload de edición de producto. Sin inventario: eso es otra operación. */
export const esquemaProductoEditado = z.object({
  ...camposDeProducto,
  id: z.string().min(1),
});

/** Payload de una recepción de mercadería. */
export const esquemaAjusteDeInventario = z.object({
  productoId: z.string().min(1),
  cantidad: z.string().min(1).max(LARGO_MAXIMO_NUMERO),
  motivo: z.string().max(LARGO_MAXIMO_MOTIVO).nullable(),
});

/** Datos de un producto nuevo, ya validados. */
export type ProductoNuevoIpc = z.infer<typeof esquemaProductoNuevo>;

/** Datos de un producto editado, ya validados. */
export type ProductoEditadoIpc = z.infer<typeof esquemaProductoEditado>;

/** Una categoría tal como la muestra la pantalla de administración. */
export interface CategoriaIpc {
  readonly id: string;
  readonly nombre: string;
  readonly orden: number;
  readonly activo: boolean;
  /** Cuántos productos la referencian. Se muestra antes de desactivarla. */
  readonly productosAsociados: number;
}

/** Un producto tal como lo muestra la pantalla de administración. */
export interface ProductoIpc {
  readonly id: string;
  readonly nombre: string;
  readonly categoriaId: string;
  /** Nombre de la categoría, ya resuelto: el renderer no cruza tablas. */
  readonly categoriaNombre: string;
  readonly tipoMedida: TipoMedidaIpc;
  readonly unidadPeso: UnidadPesoIpc | null;
  /** Cantidad del ícono, como cadena canónica de tres decimales. */
  readonly cantidadPredefinidaIcono: string;
  /** Precio, como cadena canónica de dos decimales. */
  readonly precioBase: string;
  /**
   * Costo, como cadena canónica de dos decimales, o `null` si no se cargó.
   * Solo viaja en este DTO, que exige rol administrativo: la cuadrícula de
   * venta (`ProductoParaVender`) no lo lleva.
   */
  readonly precioCompra: string | null;
  /** Inventario, como cadena canónica de tres decimales. */
  readonly inventarioDisponible: string;
  /** Ruta relativa guardada en la base, o `null`. */
  readonly fotoPath: string | null;
  /**
   * URL con la que la ventana puede mostrar la foto, o `null`.
   *
   * Es un esquema propio servido por el proceso principal. El renderer no lee
   * el disco: pide esta URL y el proceso principal decide qué archivo entrega,
   * comprobando antes que la ruta caiga dentro de la carpeta de fotos.
   */
  readonly fotoUrl: string | null;
  readonly activo: boolean;
  readonly contadorVentas: number;
}

/** Resultado de una recepción de mercadería, para confirmarla en pantalla. */
export interface ResultadoDeAjusteIpc {
  readonly producto: ProductoIpc;
  readonly cantidadAnterior: string;
  readonly cantidadAgregada: string;
  readonly cantidadNueva: string;
}

/** Resultado de elegir una foto con el diálogo nativo. */
export interface FotoElegidaIpc {
  /** `false` si la persona cerró el diálogo sin elegir nada. */
  readonly elegida: boolean;
  /** Ruta relativa ya copiada a la carpeta de datos, o `null`. */
  readonly fotoPath: string | null;
  /** URL para mostrarla de inmediato en el formulario, o `null`. */
  readonly fotoUrl: string | null;
}

// ---------------------------------------------------------------------------
// DTO: pantalla de venta
// ---------------------------------------------------------------------------

/** Por qué no se puede vender, cuando no se puede. */
export type MotivoParaNoVender = 'SIN_CAJA_ABIERTA' | 'CAJA_DE_OTRO_USUARIO';

/** Una categoría, tal como la muestra la barra lateral de la venta. */
export interface CategoriaDeVenta {
  readonly id: string;
  readonly nombre: string;
  /** Cuántos productos ACTIVOS tiene. Se muestra bajo el nombre. */
  readonly productos: number;
}

/** Tipos de valor de un descuento, en la frontera. */
export const TIPOS_DE_VALOR_IPC = ['porcentaje', 'monto_fijo'] as const;

/** Porcentaje o quetzales, del lado de la interfaz. */
export type TipoValorIpc = (typeof TIPOS_DE_VALOR_IPC)[number];

/** Formas de pago, en la frontera. */
export const FORMAS_DE_PAGO_IPC = ['efectivo', 'tarjeta'] as const;

/** Cómo pagó el cliente, del lado de la interfaz. */
export type FormaPagoIpc = (typeof FORMAS_DE_PAGO_IPC)[number];

/**
 * El precio especial que está rebajando a un producto hoy.
 *
 * Es POR PRODUCTO y PRECONFIGURADO: lo dejó puesto un administrador con una
 * vigencia. No confundir con el descuento discrecional, que es sobre la venta
 * completa y lo decide quien vende en el momento.
 */
export interface PrecioEspecialVigente {
  readonly id: string;
  readonly tipo: TipoValorIpc;
  /** Cadena canónica de dos decimales: 10.00 significa 10 % o Q10. */
  readonly valor: string;
  readonly vigenteDesde: string;
  readonly vigenteHasta: string | null;
}

/**
 * Un producto tal como lo muestra la cuadrícula de venta.
 *
 * Los decimales viajan como CADENA canónica, nunca como `number`: es la misma
 * regla que rige en todo el proyecto, y la pantalla los vuelve a convertir a
 * Decimal para calcular el ticket.
 */
export interface ProductoParaVender {
  readonly id: string;
  readonly nombre: string;
  readonly categoriaId: string;
  readonly categoriaNombre: string;
  readonly tipoMedida: TipoMedidaIpc;
  readonly unidadPeso: UnidadPesoIpc | null;
  /** Cuánto agrega un toque al ícono. Cadena canónica de tres decimales. */
  readonly cantidadPredefinidaIcono: string;
  /** Precio de lista. Cadena canónica de dos decimales. */
  readonly precioBase: string;
  /**
   * El precio que se le cobra HOY, ya con el precio especial vigente aplicado.
   *
   * Es igual a `precioBase` cuando no hay ninguno vigente. La pantalla cobra
   * SIEMPRE por este, nunca por `precioBase`: el de lista queda solo para
   * poder mostrar tachado de cuánto bajó.
   */
  readonly precioEfectivo: string;
  /** El precio especial que se está aplicando, o `null` si se cobra el de lista. */
  readonly precioEspecial: PrecioEspecialVigente | null;
  /**
   * Inventario conocido AL MOMENTO de cargar la pantalla.
   *
   * Sirve para advertir, nunca para decidir: la comprobación real y atómica
   * ocurre al registrar la venta, en su propia transacción.
   */
  readonly inventarioDisponible: string;
  readonly fotoUrl: string | null;
  /** Cuántas veces se vendió. Ordena la cuadrícula. */
  readonly contadorVentas: number;
}

/** Lo que la pantalla de venta necesita para dibujarse. */
export interface EstadoDeVenta {
  /** `true` solo si hay una caja abierta POR el usuario en sesión. */
  readonly puedeVender: boolean;
  /** Por qué no, cuando no se puede. `null` si sí se puede. */
  readonly motivo: MotivoParaNoVender | null;
  /** El turno abierto del sistema, si hay alguno. */
  readonly turnoAbierto: TurnoAbierto | null;
  /** Vacíos cuando no se puede vender: no se filtra catálogo de más. */
  readonly categorias: readonly CategoriaDeVenta[];
  readonly productos: readonly ProductoParaVender[];
}

/** Largo máximo del número de boleta de un voucher de tarjeta. */
const LARGO_MAXIMO_BOLETA = 40;

/**
 * Largo máximo de un decimal que llega como cadena.
 *
 * No es una regla de negocio: es un freno a un payload absurdo antes de que
 * llegue al dominio. Quién decide si el número es válido es `money.ts`.
 */
const LARGO_MAXIMO_DECIMAL = 20;

/** Cuántas líneas puede tener un ticket como máximo. */
const LINEAS_MAXIMAS_DEL_TICKET = 200;

/**
 * Payload de cobro.
 *
 * NO LLEVA PRECIOS NI TOTALES, y eso es deliberado: el precio de cada línea y
 * el total los recalcula el proceso principal contra el catálogo y los precios
 * especiales vigentes. Si viajaran desde la ventana, cualquiera podría cobrar
 * un maíz a un centavo llamando al canal directamente.
 */
export const esquemaCobro = z.object({
  lineas: z
    .array(
      z.object({
        productoId: z.uuid(),
        /** Cantidad pedida. Cadena decimal; el dominio la redondea a tres. */
        cantidad: z.string().min(1).max(LARGO_MAXIMO_DECIMAL),
      }),
    )
    .min(1)
    .max(LINEAS_MAXIMAS_DEL_TICKET),
  descuento: z
    .object({
      tipo: z.enum(TIPOS_DE_VALOR_IPC),
      valor: z.string().min(1).max(LARGO_MAXIMO_DECIMAL),
    })
    .nullable(),
  formaPago: z.enum(FORMAS_DE_PAGO_IPC),
  numBoleta: z.string().max(LARGO_MAXIMO_BOLETA).nullable(),
  /**
   * PIN del administrador que autoriza un descuento por encima del tope del
   * rol. Se manda solo en el SEGUNDO intento: el primero llega sin él, para
   * que la pantalla pueda mostrar cuánto se está por autorizar antes de pedir
   * el código.
   */
  pinDescuento: z.string().min(1).max(LARGO_MAXIMO_DECIMAL).optional(),
});

/** Payload de cobro, ya validado. */
export type PedidoDeCobro = z.infer<typeof esquemaCobro>;

/**
 * Largo máximo del motivo de una anulación EN EL PUENTE. No es la regla: la
 * regla —hasta 200 caracteres— la aplica el servicio, con un mensaje que lo
 * dice. Esto solo frena un payload absurdo.
 */
const LARGO_MAXIMO_MOTIVO_DE_ANULACION_EN_EL_PUENTE = 1000;

/** Largo máximo de un PIN que llega por el puente. El formato lo decide `@shared/pin`. */
const LARGO_MAXIMO_PIN_EN_EL_PUENTE = 20;

/**
 * Pedido de anulación de una venta (docs/ANULACION-DE-VENTA.md §4.3).
 *
 * NO LLEVA quién la pide: sale de la sesión del proceso principal. Y el PIN va
 * en `null` en el primer pedido, que solo valida y arma la vista previa.
 */
export const esquemaPedidoDeAnulacion = z.object({
  ventaId: z.uuid(),
  motivo: z.string().max(LARGO_MAXIMO_MOTIVO_DE_ANULACION_EN_EL_PUENTE),
  /** El voucher de la venta ORIGINAL, si fue con tarjeta; `null` en efectivo (§3.3). */
  voucher: z.string().max(LARGO_MAXIMO_BOLETA).nullable(),
  pin: z.string().min(1).max(LARGO_MAXIMO_PIN_EN_EL_PUENTE).nullable(),
});

/** Pedido de anulación, ya validado. */
export type PedidoDeAnulacionIpc = z.infer<typeof esquemaPedidoDeAnulacion>;

/** Lo que se muestra antes de pedir el PIN. Nunca lleva el teórico de la caja (§3.4). */
export interface VistaPreviaDeAnulacionIpc {
  readonly ventaId: string;
  /** `null` si la venta no llegó a tener recibo. */
  readonly numeroRecibo: number | null;
  readonly fecha: string;
  readonly vendidaPor: PersonaIpc;
  readonly cajaAbiertaPor: PersonaIpc;
  readonly formaPago: FormaPagoIpc;
  /** El voucher, solo con tarjeta. */
  readonly numBoleta: string | null;
  readonly total: string;
  readonly lineas: readonly {
    readonly productoId: string;
    readonly nombreSnap: string;
    readonly unidadSnap: string;
    readonly cantidad: string;
    readonly productoActivo: boolean;
  }[];
  /** Nombres de los productos desactivados hoy: se reponen igual y no se reactivan. */
  readonly productosDesactivados: readonly string[];
  readonly avisoDeDevolucion: string;
}

/** Una anulación ya hecha. */
export interface AnulacionRegistradaIpc {
  readonly id: string;
  readonly ventaId: string;
  readonly fecha: string;
  readonly solicitadaPor: string;
  readonly autorizadaPor: string;
  readonly autorizadaVia: 'presencial' | 'remoto';
  readonly motivo: string;
  readonly numeroRecibo: number | null;
  readonly formaPago: FormaPagoIpc;
  readonly total: string;
  /** El total si fue en efectivo; `0.00` con tarjeta. */
  readonly efectivoQueDejaDeContar: string;
  readonly productos: readonly {
    readonly productoId: string;
    readonly nombreSnap: string;
    readonly unidadSnap: string;
    readonly cantidad: string;
    readonly productoActivo: boolean;
    readonly saldoAnterior: string;
    readonly saldoNuevo: string;
  }[];
}

/**
 * Resultado de pedir una anulación que PASÓ las validaciones.
 *
 * `codigo` es `REQUIERE_AUTORIZACION` (primer pedido, sin PIN),
 * `ANULACION_CORRECTA`, o el código de una autorización rechazada
 * (`PIN_INCORRECTO`, `AUTORIZACION_BLOQUEADA`…). Una anulación que NO pasa las
 * validaciones llega como error (`ok: false`), con su código y su mensaje.
 */
export interface ResultadoDeAnulacionIpc {
  readonly anulada: boolean;
  readonly codigo: string;
  readonly mensaje: string;
  readonly vistaPrevia: VistaPreviaDeAnulacionIpc;
  /** Segundos para reintentar, cuando el candado del PIN está cerrado. */
  readonly segundosParaReintentar: number | null;
  /** La anulación hecha, o `null` si todavía no se anuló. */
  readonly anulacion: AnulacionRegistradaIpc | null;
}

/** Una venta que quedó registrada. */
export interface VentaRegistrada {
  readonly registrada: true;
  readonly ventaId: string;
  /** Fecha ISO de la venta, tal como quedó guardada. */
  readonly fecha: string;
  readonly subtotal: string;
  readonly descuentoAplicado: string;
  readonly total: string;
  readonly formaPago: FormaPagoIpc;
  readonly numBoleta: string | null;
  readonly lineas: number;
  /** Cuántas líneas se cobraron con un precio especial vigente. */
  readonly lineasConPrecioEspecial: number;
  /**
   * El recibo que se emitió junto con la venta.
   *
   * Viaja con la venta y no en una consulta aparte porque el cajero tiene que
   * ver EN EL MISMO AVISO si el recibo salió por la impresora o si le toca
   * explicarle al cliente que por ahora queda solo en PDF.
   */
  readonly recibo: ReciboDeLaVentaIpc;
}

/** El recibo emitido al cerrar una venta. */
export interface ReciboDeLaVentaIpc {
  readonly id: string;
  readonly numeroRecibo: number;
  readonly rutaPdf: string;
  /** `true` si el PDF quedó escrito. Es el respaldo obligatorio del proyecto. */
  readonly pdfGenerado: boolean;
  /** `true` si además salió por la impresora térmica. */
  readonly impreso: boolean;
  /** Qué decirle al cajero sobre la impresión, en una frase. */
  readonly mensajeDeImpresion: string;
}

/**
 * Una venta que NO se registró, y por qué.
 *
 * `requiereAutorizacion` distingue el caso que no es un error: el descuento
 * pasa el tope del rol y falta el PIN. La pantalla usa `tope` y `exceso` para
 * mostrar exactamente qué se está por autorizar ANTES de pedir el código.
 */
export interface VentaRechazada {
  readonly registrada: false;
  readonly codigo: string;
  readonly mensaje: string;
  readonly requiereAutorizacion: boolean;
  /** El tope del rol de quien vende. `null` si el rechazo es por otra cosa. */
  readonly tope: string | null;
  /** Cuánto se pasa del tope. `null` si el rechazo es por otra cosa. */
  readonly exceso: string | null;
  /** Segundos para reintentar, cuando el candado del PIN está cerrado. */
  readonly segundosParaReintentar: number | null;
}

/** Resultado de intentar cobrar. */
export type ResultadoDeCobro = VentaRegistrada | VentaRechazada;

/** Largo máximo del nombre de un usuario. */
const LARGO_MAXIMO_NOMBRE_USUARIO = 60;

/**
 * Payload de alta de usuario.
 *
 * El PIN viaja en claro por IPC, igual que en el ingreso y en el primer
 * arranque: el renderer no puede hashear nada porque `@shared/auth` usa
 * `node:crypto` y tiene prohibido llegar a la ventana. El hash se hace en el
 * proceso principal y el PIN no vuelve nunca.
 */
export const esquemaUsuarioNuevo = z.object({
  nombre: z.string().min(1).max(LARGO_MAXIMO_NOMBRE_USUARIO),
  rol: z.enum(ROLES),
  pin: z.string().min(LARGO_MINIMO_PIN_IPC).max(LARGO_MAXIMO_PIN_IPC),
});

/** Payload de alta ya validado. */
export type UsuarioNuevoIpc = z.infer<typeof esquemaUsuarioNuevo>;

/** Payload de edición. NO lleva PIN: cambiarlo es su propio canal. */
export const esquemaUsuarioEditado = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1).max(LARGO_MAXIMO_NOMBRE_USUARIO),
  rol: z.enum(ROLES),
});

/** Payload de edición ya validado. */
export type UsuarioEditadoIpc = z.infer<typeof esquemaUsuarioEditado>;

/** Payload de cambio de PIN. */
export const esquemaCambioDePin = z.object({
  id: z.string().min(1),
  pin: z.string().min(LARGO_MINIMO_PIN_IPC).max(LARGO_MAXIMO_PIN_IPC),
});

/**
 * Un usuario tal como lo muestra la pantalla de gestión.
 *
 * NO LLEVA `pinHash` NI el secreto de TOTP, y no es un olvido: el hash no tiene
 * nada que hacer en la ventana. Tampoco sirve para nada allí, y exponerlo
 * pondría al alcance de un renderer comprometido el material con el que
 * atacar los PIN fuera de línea.
 */
export interface UsuarioIpc {
  readonly id: string;
  readonly nombre: string;
  readonly rol: RolIpc;
  readonly activo: boolean;
  /** `true` si está inscrito en la autorización remota por TOTP. Sí o no: nunca el secreto. */
  readonly tieneAutorizacionRemota: boolean;
  /**
   * `true` si no tiene ningún PIN: fue restaurado desde la nube y nadie le
   * asignó uno (por ejemplo, un usuario de baja que se reactiva después de una
   * restauración). Se le asigna con «cambiar PIN».
   */
  readonly sinPin: boolean;
  /** `true` si ahora mismo está bloqueado por intentos fallidos. */
  readonly bloqueado: boolean;
  /** `true` si es el usuario que está usando la aplicación en este momento. */
  readonly esUnoMismo: boolean;
  /**
   * `true` si es el ÚNICO administrador activo.
   *
   * La pantalla lo usa para explicar por qué no se lo puede dar de baja, en vez
   * de dejar que el intento falle con un mensaje que llega tarde.
   */
  readonly esElUnicoAdministrador: boolean;
  readonly creadoEn: string;
}

/** Largo máximo de cada campo de la configuración del negocio. */
const LARGOS_DEL_NEGOCIO = {
  nombreComercial: 80,
  direccion: 160,
  telefono: 40,
  nit: 20,
} as const;

/**
 * Payload de la configuración del negocio.
 *
 * Los cuatro campos aceptan `null` porque los datos reales de Jimmy todavía no
 * llegaron: se puede guardar el nombre sin saber el NIT. `null` es «sin
 * configurar», y el recibo pone un marcador entre corchetes en su lugar.
 */
export const esquemaConfiguracionDeNegocio = z.object({
  nombreComercial: z.string().max(LARGOS_DEL_NEGOCIO.nombreComercial).nullable(),
  direccion: z.string().max(LARGOS_DEL_NEGOCIO.direccion).nullable(),
  telefono: z.string().max(LARGOS_DEL_NEGOCIO.telefono).nullable(),
  nit: z.string().max(LARGOS_DEL_NEGOCIO.nit).nullable(),
});

/** Configuración del negocio, ya validada. */
export type ConfiguracionDeNegocioIpc = z.infer<typeof esquemaConfiguracionDeNegocio>;

// ---------------------------------------------------------------------------
// Conexión con la nube (fase 3.a)
// ---------------------------------------------------------------------------

/**
 * Correo y contraseña del usuario de terminal, tecleados UNA vez.
 *
 * No hay tope de largo para la contraseña: §1.2 del diseño pide una
 * «contraseña larga aleatoria», y un `max()` acá sería un techo inventado que
 * empujaría hacia contraseñas más cortas. El piso sí existe, para atrapar el
 * campo vacío antes de gastar una petición de red.
 */
const LARGOS_DEL_CORREO = {
  /** `a@b` es lo más corto que puede parecerse a un correo. */
  minimo: 3,
  /** El tope del RFC 5321 para una dirección completa. */
  maximo: 320,
} as const;

export const esquemaConexionDeNube = z.object({
  correo: z.string().min(LARGOS_DEL_CORREO.minimo).max(LARGOS_DEL_CORREO.maximo),
  contrasena: z.string().min(1),
});

/** Lo que la pantalla manda para conectar. */
export type ConexionDeNubeIpc = z.infer<typeof esquemaConexionDeNube>;

/**
 * Estado de la credencial, tal como lo ve la pantalla.
 *
 * **Ningún campo de esta interfaz es un secreto**, y es deliberado: si el
 * token de refresco o el access token viajaran hasta el renderer, quedarían al
 * alcance de cualquier cosa que corra ahí, y todo el cuidado de guardarlos
 * cifrados en el disco no serviría de nada.
 */
export interface EstadoDeNubeIpc {
  /** Hay un archivo de credencial guardado. */
  readonly hayCredencial: boolean;
  /** Hay un access token vigente ahora mismo. */
  readonly conectada: boolean;
  /** Con qué usuario, leído de los claims del token. */
  readonly correo: string | null;
  /** El rol del token. Debería ser siempre `'terminal'`. */
  readonly rol: string | null;
  /** `exp - iat`: la vida real que emite el proyecto, en segundos. */
  readonly vidaDelTokenSegundos: number | null;
  /** Segundos que el reloj local va adelantado respecto del servidor. */
  readonly desfaseDeRelojSegundos: number | null;
  /** `true` si ese desfase pasa la tolerancia medida de PostgREST (30 s). */
  readonly relojSospechoso: boolean;
  /** Renovaciones seguidas que fallaron. Cero cuando todo va bien. */
  readonly renovacionesFallidas: number;
  /** Qué pasó la última vez. Nunca lleva tokens ni contraseñas. */
  readonly ultimoMotivo: string | null;
  /**
   * `true` cuando la nube RECHAZÓ la credencial: la terminal quedó sin poder
   * subir y solo se sale volviendo a conectar. No es lo mismo que un corte de
   * red, y tampoco que el access token venza, que pasa cada 900 s.
   */
  readonly revocada: boolean;
  /** Desde cuándo está así, en ISO-8601. */
  readonly revocadaDesde: string | null;
  /** Hasta cuándo un token ya emitido pudo seguir escribiendo (§4.22). */
  readonly exposicionHasta: string | null;
  /** Filas esperando en `sync_cola` sin poder subir. */
  readonly filasPendientes: number | null;
}

// ---------------------------------------------------------------------------
// DTO: sincronización (fase 4.a — barra de estado y pantalla)
// ---------------------------------------------------------------------------

/**
 * Los estados que puede mostrar la sincronización, calculados en el proceso
 * principal (`resumen-de-sincronizacion.ts`). El renderer nunca decide el
 * estado: solo lo muestra con el texto y el color que le corresponden. La
 * lista vive en `src/shared/estado-de-sincronizacion.ts`, una sola vez: hasta
 * el 2026-09-17 esta unión era una tercera copia escrita a mano.
 */
export type EstadoDeSincronizacionIpc = EstadoDeSincronizacion;

/**
 * Resumen LIVIANO. Lo pide la barra de estado, SIN sesión ni rol: no lleva
 * ningún dato sensible, solo lo necesario para un texto corto y un color.
 */
export interface ResumenDeSincronizacionIpc {
  /** `false` cuando esta copia no tiene ningún proyecto de nube configurado. */
  readonly configurada: boolean;
  readonly estado: EstadoDeSincronizacionIpc;
  readonly pendientes: number;
  /** ISO-8601 de la fila pendiente más vieja, o `null` si no hay pendientes. */
  readonly pendienteMasViejaDesde: string | null;
}

/** Cuántos pendientes hay agrupados por tabla (o por `archivo_foto`). */
export interface PendientesPorTablaIpc {
  readonly entidadTipo: string;
  readonly total: number;
}

/** El lote que hoy detiene la cola, con lo que hace falta para decidir. */
export interface LoteBloqueanteIpc {
  readonly loteId: string;
  /** El error TAL CUAL lo devolvió la función de Postgres, sin resumir. */
  readonly error: string;
  readonly intentos: number;
  readonly tablas: readonly string[];
  readonly creadoEn: string;
}

/** El detalle completo. Solo rol administrativo. */
export interface DetalleDeSincronizacionIpc extends ResumenDeSincronizacionIpc {
  readonly pendientesPorTabla: readonly PendientesPorTablaIpc[];
  readonly ultimoExitoEn: string | null;
  readonly loteBloqueante: LoteBloqueanteIpc | null;
  readonly archivosApartados: number;
  readonly hayCredencial: boolean;
  readonly revocada: boolean;
  readonly conectada: boolean;
}

/** Payload de «reintentar ahora». */
export const esquemaLoteId = z.object({ loteId: z.uuid() });
export type LoteIdIpc = z.infer<typeof esquemaLoteId>;

/** Largo del PIN en la frontera de «saltar lote»: mismo rango que la salida controlada. */
const LARGO_MINIMO_PIN_SALTO = 4;
const LARGO_MAXIMO_PIN_SALTO = 12;

/** Payload de «saltar este lote»: el lote y el PIN de un administrador. */
export const esquemaSaltoDeLote = z.object({
  loteId: z.uuid(),
  pin: z.string().min(LARGO_MINIMO_PIN_SALTO).max(LARGO_MAXIMO_PIN_SALTO),
});
export type SaltoDeLoteIpc = z.infer<typeof esquemaSaltoDeLote>;

/** Qué contenía el lote saltado, para que la pantalla confirme qué se saltó. */
export interface LoteSaltadoIpc {
  readonly loteId: string;
  readonly tablas: readonly string[];
  readonly filas: number;
}

/** Resultado de intentar saltar un lote: puede fallar por PIN, no solo tener éxito. */
export interface ResultadoDeSaltoDeLoteIpc {
  readonly saltado: boolean;
  readonly mensaje: string;
  /** Segundos para reintentar si el candado de la superficie se bloqueó. */
  readonly segundosParaReintentar: number | null;
  /** Presente solo cuando `saltado` es `true`. */
  readonly lote: LoteSaltadoIpc | null;
}

// ---------------------------------------------------------------------------
// DTO: restauración desde la nube (fase 4.b)
// ---------------------------------------------------------------------------

/** Por qué se restaura. Solo fecha la revisión de anomalías; el reset de PIN es siempre. */
export const MOTIVOS_DE_RESTAURACION_IPC = ['falla', 'robo'] as const;
export type MotivoDeRestauracionIpc = (typeof MOTIVOS_DE_RESTAURACION_IPC)[number];

/**
 * Lo que la pantalla manda para iniciar. La contraseña cruza el puente UNA
 * vez y no se guarda de ningún lado (§6.2 del diseño): la sesión de
 * restauración es efímera y nunca toca `safeStorage`.
 */
export const esquemaInicioDeRestauracion = z.object({
  correo: z.string().min(LARGOS_DEL_CORREO.minimo).max(LARGOS_DEL_CORREO.maximo),
  contrasena: z.string().min(1),
  motivo: z.enum(MOTIVOS_DE_RESTAURACION_IPC),
  /** ISO-8601. Obligatoria si el motivo es `robo`; el servicio lo exige. */
  fechaDelRobo: z.string().nullable(),
});
export type InicioDeRestauracionIpc = z.infer<typeof esquemaInicioDeRestauracion>;

/** Para retomar hay que volver a iniciar sesión: la sesión anterior se descartó. */
export const esquemaRetomaDeRestauracion = z.object({
  correo: z.string().min(LARGOS_DEL_CORREO.minimo).max(LARGOS_DEL_CORREO.maximo),
  contrasena: z.string().min(1),
});
export type RetomaDeRestauracionIpc = z.infer<typeof esquemaRetomaDeRestauracion>;

/** Una fila excluida que el administrador pide restaurar igual. */
export const esquemaFilaExcluida = z.object({ tabla: z.string().min(1), id: z.string().min(1) });
export type FilaExcluidaIpc = z.infer<typeof esquemaFilaExcluida>;

/** La decisión sobre un usuario con cambios posteriores al robo. */
export const esquemaRevisionDeUsuario = z.object({
  id: z.string().min(1),
  rol: z.enum(ROLES),
  activo: z.boolean(),
});
export type RevisionDeUsuarioIpc = z.infer<typeof esquemaRevisionDeUsuario>;

/** El PIN nuevo de un usuario restaurado. */
export const esquemaPinDeRestauracion = z.object({
  id: z.string().min(1),
  pin: z.string().length(LARGO_DEL_PIN_IPC),
});
export type PinDeRestauracionIpc = z.infer<typeof esquemaPinDeRestauracion>;

export type FaseDeRestauracionIpc =
  | 'inactiva'
  | 'iniciando'
  | 'tablas'
  | 'archivos'
  | 'verificacion'
  | 'revision'
  | 'terminada'
  | 'cancelada'
  | 'fallida';

export interface ProgresoDeTablaIpc {
  readonly tabla: string;
  readonly estado: 'esperando' | 'bajando' | 'lista';
  readonly filas: number;
  /** Cuántas tiene la nube, cuando ya se preguntó. */
  readonly total: number | null;
}

export interface ConteoVerificadoIpc {
  readonly tabla: string;
  readonly nube: number;
  readonly local: number;
  /** Filas posteriores al robo que se dejaron afuera a propósito. */
  readonly excluidas: number;
  readonly coincide: boolean;
}

export interface MesVerificadoIpc {
  readonly mes: string;
  readonly nube: string;
  readonly local: string;
  readonly excluidas: string;
  readonly coincide: boolean;
}

export interface VerificacionDeRestauracionIpc {
  readonly conteos: readonly ConteoVerificadoIpc[];
  readonly ventasPorMes: readonly MesVerificadoIpc[];
  readonly ok: boolean;
  readonly detalle: readonly string[];
}

/** Una fila con `recibido_en` posterior a la fecha del robo (§6.5). */
export interface AnomaliaDeRestauracionIpc {
  readonly tabla: string;
  readonly id: string;
  readonly recibidoEn: string;
  readonly resumen: string;
  /** `true` si NO se restauró: es de una tabla que la nube solo inserta. */
  readonly excluida: boolean;
  /** `true` si el administrador pidió restaurarla igual. */
  readonly aceptada: boolean;
  /** Solo usuarios: `true` cuando ya se revisó. */
  readonly revisada: boolean;
  readonly total: string | null;
  readonly fecha: string | null;
}

export interface UsuarioRestauradoIpc {
  readonly id: string;
  readonly nombre: string;
  readonly rol: RolIpc;
  readonly activo: boolean;
  readonly sinPin: boolean;
  /** `true` si tiene cambios posteriores al robo y hay que revisarlo. */
  readonly anomalo: boolean;
  readonly revisado: boolean;
}

/** El avance completo, para la pantalla. Nunca lleva ningún secreto. */
export interface ProgresoDeRestauracionIpc {
  readonly configurada: boolean;
  readonly fase: FaseDeRestauracionIpc;
  readonly mensaje: string | null;
  readonly proyecto: string | null;
  readonly correo: string | null;
  readonly motivo: MotivoDeRestauracionIpc | null;
  readonly fechaDelRobo: string | null;
  readonly tablas: readonly ProgresoDeTablaIpc[];
  readonly fotos: { readonly hechas: number; readonly total: number; readonly faltantes: readonly string[] } | null;
  readonly verificacion: VerificacionDeRestauracionIpc | null;
  readonly anomalias: readonly AnomaliaDeRestauracionIpc[];
  readonly usuarios: readonly UsuarioRestauradoIpc[];
  /** Ritmo de los últimos 30 s. NO es una estimación de tiempo total (§6.6). */
  readonly filasPorSegundo: number | null;
  readonly filasRestantes: number | null;
  readonly baseVacia: boolean;
  readonly hayRestauracionIncompleta: boolean;
}

/** Lo que devuelve conectar cuando sale bien. */
export interface ResumenDeConexionIpc {
  readonly correo: string | null;
  readonly rol: string | null;
  readonly vidaDelTokenSegundos: number;
  /** Lo que el servidor DIJO que dura, para poder compararlo con la vida real. */
  readonly duracionDeclaradaEnSegundos: number | null;
  readonly desfaseDeRelojSegundos: number;
  readonly relojSospechoso: boolean;
}

/** Payload que identifica un recibo. */
export const esquemaReciboPorId = z.object({
  id: z.uuid(),
});

/**
 * Por qué método de pago se está filtrando el historial de recibos.
 *
 * **EL FILTRO VIAJA AL PROCESO PRINCIPAL, no se aplica en la ventana**, y no es
 * un capricho: la línea de totales es de «el conjunto actualmente filtrado», y
 * la ventana no puede sumar. Si filtrara acá y sumara allá, o bien la ventana
 * haría aritmética de punto flotante —lo que §4.15 prohíbe— o bien los totales
 * serían de otro conjunto que el que se ve. Filtrando en el proceso principal,
 * las filas que se dibujan y los totales que se muestran salen de la misma
 * lista, por construcción.
 */
export type FiltroDeFormaPagoIpc = 'todas' | 'efectivo' | 'tarjeta';

/** Payload del historial: por qué método de pago se quiere filtrar. */
export const esquemaFiltroDeRecibos = z.object({
  formaPago: z.enum(['todas', 'efectivo', 'tarjeta']),
});

/**
 * La anulación de una venta, tal como la muestran el historial y el recibo.
 *
 * La fecha y la hora vienen ya formateadas en hora de Guatemala: la ventana no
 * hace aritmética de fechas, igual que con los períodos de los reportes.
 */
export interface AnulacionEnHistorialIpc {
  /** Día de la anulación, «15/09/2026». */
  readonly fecha: string;
  /** Hora de la anulación, «12:04». */
  readonly hora: string;
  /** Quién la autorizó, con el nombre de hoy. */
  readonly autorizadaPor: string;
  readonly motivo: string;
}

/** Una fila del historial de recibos. */
export interface ReciboEnHistorialIpc {
  readonly id: string;
  readonly ventaId: string;
  readonly numeroRecibo: number;
  /** Fecha y hora de la VENTA, no de la emisión del papel. */
  readonly fecha: string;
  readonly hora: string;
  readonly cajero: string;
  readonly total: string;
  readonly formaPago: FormaPagoIpc;
  /**
   * El voucher de la terminal del banco (`ventas.num_boleta`), o `null` en una
   * venta en efectivo.
   *
   * Viaja con el resto de la fila y no detrás de un rol, igual que el total:
   * el historial lo ve personal de la tienda, el número lo tecleó quien cobró,
   * y sale impreso en la COPIA DE LA TIENDA (`plantilla-de-recibo.ts`).
   *
   * CORREGIDO EL 2026-09-18 (spec 001). Este comentario decía que era «el mismo
   * número que ya sale IMPRESO en el papel del cliente», y que por eso
   * mostrarlo acá «no revela nada que el cliente no tenga en la mano». Desde
   * que salen dos copias, la del cliente ya no lo lleva. La decisión de que
   * llegue a cualquiera con sesión se sostiene por la razón de arriba.
   */
  readonly numBoleta: string | null;
  /** `true` si alguna vez salió por la impresora térmica. */
  readonly impreso: boolean;
  readonly lineas: number;
  /** `true` si la venta llevaba descuento discrecional. */
  readonly conDescuento: boolean;
  /** La anulación de esta venta, o `null` si sigue en pie (§1.1). */
  readonly anulacion: AnulacionEnHistorialIpc | null;
  /**
   * `true` si la pantalla debe OFRECER anular esta venta.
   *
   * Lo decide el proceso principal, con la misma regla que después aplica el
   * servicio: la caja donde se registró la venta sigue abierta y la venta no
   * está anulada. La pantalla no lo deduce ni compara cajas por su cuenta.
   */
  readonly sePuedeAnular: boolean;
}

/**
 * Cuánto suma el conjunto que el historial está mostrando.
 *
 * ---------------------------------------------------------------------------
 * QUÉ CUENTA Y QUÉ NO
 * ---------------------------------------------------------------------------
 * Solo las ventas **que siguen en pie**, y lo decide **la ausencia de su fila
 * en `anulaciones_de_venta`, nunca `ventas.estado`** —esa columna dice
 * 'completada' también en las anuladas (§1.3 del diseño)—. Es el mismo
 * criterio de todos los reportes (§4.15) y del efectivo esperado de la caja
 * (§4.10), y la razón es de negocio: una venta anulada es plata que se le
 * devolvió al cliente, así que sumarla diría que entró un dinero que salió.
 *
 * Lo anulado **no se esconde**: se informa aparte, en `anuladas` y
 * `totalAnulado`, para que el número de arriba se pueda leer sin tener que
 * sumar las filas a mano para descubrir que falta algo.
 */
export interface TotalesDelHistorialIpc {
  readonly enEfectivo: string;
  readonly enTarjeta: string;
  /** Efectivo + tarjeta, exacto al centavo. */
  readonly general: string;
  readonly ventasEnEfectivo: number;
  readonly ventasEnTarjeta: number;
  /** Cuántas ventas entraron en las sumas de arriba. */
  readonly cantidadDeVentas: number;
  /** Cuántas filas del conjunto están anuladas y quedaron fuera. */
  readonly anuladas: number;
  /** Cuánto sumaban esas anuladas, como referencia. */
  readonly totalAnulado: string;
}

/** Lo que devuelve el historial de recibos: las filas y, si corresponde, sus totales. */
export interface HistorialDeRecibosIpc {
  readonly recibos: readonly ReciboEnHistorialIpc[];
  /** El filtro con el que se armó esta lista, devuelto para que la pantalla no lo suponga. */
  readonly filtro: FiltroDeFormaPagoIpc;
  /**
   * Los totales, o **`null` si quien mira no tiene rol administrativo**.
   *
   * Lo decide el proceso principal, nunca la pantalla, por la misma razón que
   * el efectivo teórico de la caja (§4.40): esconderlo en la ventana no
   * protege nada, porque el canal se llama desde la consola. Cuánto entró a la
   * tienda es información de dueño y no de mostrador (§4.15).
   */
  readonly totales: TotalesDelHistorialIpc | null;
}

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------

/**
 * Qué período se está pidiendo.
 *
 * Las fechas del rango personalizado viajan como `AAAA-MM-DD` **en hora de
 * Guatemala**, no como instantes: quien las escribe está eligiendo días en un
 * calendario, no momentos. El proceso principal las convierte a instantes UTC
 * con el desfase del país, que es donde vive esa regla y no en la ventana.
 */
const LARGO_DE_UN_DIA_ISO = 10;

export const esquemaPeriodo = z.object({
  clase: z.enum(['hoy', 'ayer', 'ultimos-7-dias', 'este-mes', 'personalizado']),
  desde: z.string().max(LARGO_DE_UN_DIA_ISO).nullable().optional(),
  hasta: z.string().max(LARGO_DE_UN_DIA_ISO).nullable().optional(),
});

/** Período pedido, ya validado. */
export type PeriodoIpc = z.infer<typeof esquemaPeriodo>;

/** El período tal como se resolvió, para que la pantalla lo muestre. */
export interface PeriodoResueltoIpc {
  readonly clase: PeriodoIpc['clase'];
  /** Primer día incluido, `AAAA-MM-DD` de Guatemala. */
  readonly desdeDia: string;
  /** Último día incluido, `AAAA-MM-DD` de Guatemala. */
  readonly hastaDia: string;
  /** Cómo se lee: «Últimos 7 días · 05/09/2026 a 11/09/2026». */
  readonly etiqueta: string;
}

/** El resumen de ventas de un período. Todo monto, cadena canónica. */
export interface ResumenDeVentasIpc {
  readonly periodo: PeriodoResueltoIpc;
  readonly totalVendido: string;
  readonly cantidadDeVentas: number;
  readonly totalEnEfectivo: string;
  readonly totalEnTarjeta: string;
  readonly ventasEnEfectivo: number;
  readonly ventasEnTarjeta: number;
  /** Cuánto se dejó de cobrar. Es referencia, NO parte del total vendido. */
  readonly totalDeDescuentos: string;
  readonly ventasConDescuento: number;
}

/** Una fila del reporte de ventas por producto. */
export interface VentasDeUnProductoIpc {
  readonly productoId: string;
  readonly nombre: string;
  readonly unidad: string;
  /** Cantidad vendida EN EL PERÍODO, no el acumulado de toda la vida. */
  readonly cantidadVendida: string;
  readonly montoGenerado: string;
  readonly vecesVendido: number;
  /**
   * Margen de las líneas con foto del costo (`costo_unitario_snap`), o `null`
   * = «sin dato» si ninguna la tiene. Nunca cero por falta de costo.
   */
  readonly margen: string | null;
  /** Líneas del período sin foto del costo, fuera del margen. */
  readonly lineasSinCosto: number;
}

/** El reporte de ventas por producto, ya ordenado por monto descendente. */
export interface ReporteDeVentasPorProductoIpc {
  readonly periodo: PeriodoResueltoIpc;
  readonly productos: readonly VentasDeUnProductoIpc[];
  readonly montoTotal: string;
  /** Suma de los márgenes con dato. */
  readonly margenTotal: string;
  /** Líneas del período sin foto del costo, que no entran en `margenTotal`. */
  readonly lineasSinCosto: number;
  /** Lo cobrado en esas líneas. */
  readonly montoSinCosto: string;
}

/** Cómo se ordena el reporte de inventario. */
export const esquemaOrdenDeInventario = z.object({
  orden: z.enum(['nombre', 'cantidad']),
});

/** Una fila del reporte de inventario. */
export interface InventarioDeUnProductoIpc {
  readonly productoId: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly unidad: string;
  readonly inventarioDisponible: string;
}

/** La fotografía del inventario de hoy. */
export interface ReporteDeInventarioIpc {
  readonly productos: readonly InventarioDeUnProductoIpc[];
  readonly orden: 'nombre' | 'cantidad';
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Límites de descuento
// ---------------------------------------------------------------------------

/** El tope de un rol, tal como se muestra. */
export interface LimiteDeDescuentoIpc {
  readonly rol: RolIpc;
  readonly porcentaje: string;
  readonly montoFijo: string;
  /** `false` si el rol no tiene fila. Tope CERO, nunca «sin límite». */
  readonly configurado: boolean;
  /** Nombre de quien lo dejó así, o `null` si lo sembró el guion. */
  readonly editadoPor: string | null;
  readonly actualizadoEn: string | null;
}

/**
 * Cambio de tope. Los dos valores viajan como TEXTO, no como número.
 *
 * Es la misma razón por la que los montos se guardan como cadena: un `number`
 * de JavaScript no representa exactamente todos los decimales, y este valor se
 * compara después contra el descuento que pide un cajero.
 */
const LARGO_MAXIMO_DE_UN_TOPE = 20;

export const esquemaLimiteDeDescuento = z.object({
  rol: z.enum(['venta', 'administrativo']),
  porcentaje: z.string().min(1).max(LARGO_MAXIMO_DE_UN_TOPE),
  montoFijo: z.string().min(1).max(LARGO_MAXIMO_DE_UN_TOPE),
});

/** Cambio de tope, ya validado. */
export type CambioDeLimiteIpc = z.infer<typeof esquemaLimiteDeDescuento>;

/** Lo que se muestra después de reimprimir o al ver un recibo. */
export interface ReciboVistoIpc {
  readonly numeroRecibo: number;
  /**
   * El recibo COMPLETO en texto plano: la versión de pantalla, la misma
   * información que el PDF. Es la copia de la tienda sin su encabezado de
   * copia. Hasta el 2026-09-18 decía «tal como sale en el papel», que con un
   * solo papel era cierto; desde la spec 001 salen dos copias distintas.
   */
  readonly texto: string;
  /** Ruta del PDF en el disco. */
  readonly rutaPdf: string;
  readonly pdfGenerado: boolean;
  readonly impreso: boolean;
  readonly mensajeDeImpresion: string;
}

// ---------------------------------------------------------------------------
// DTO: historial de cajas (§4.44)
// ---------------------------------------------------------------------------

/** Filtro del historial. Los dos días van juntos o no va ninguno. */
export const esquemaFiltroDeHistorialDeCajas = z.object({
  /** Primer día de APERTURA incluido, `AAAA-MM-DD` de Guatemala. */
  desde: z.string().max(LARGO_DE_UN_DIA_ISO).nullable(),
  /** Último día de APERTURA incluido, `AAAA-MM-DD` de Guatemala. */
  hasta: z.string().max(LARGO_DE_UN_DIA_ISO).nullable(),
  /** Solo las sesiones que abrió este usuario; `null` son todas. */
  abiertaPor: z.uuid().nullable(),
});

export type FiltroDeHistorialDeCajasIpc = z.infer<typeof esquemaFiltroDeHistorialDeCajas>;

export const esquemaIdDeSesionDeCaja = z.object({ id: z.uuid() });

/** Una persona, con el nombre que tiene HOY en la tabla de usuarios. */
export interface PersonaIpc {
  readonly id: string;
  readonly nombre: string;
}

/** Un conteo de cierre sellado: se confirmó y daba diferencia (§4.39). */
export interface ConteoSelladoEnHistorialIpc {
  readonly fecha: string;
  readonly montoEsperado: string;
  readonly montoReal: string;
  readonly diferencia: string;
}

/** Si el efectivo contado cuadró, faltó o sobró. */
export type TipoDeDiferenciaIpc = 'cuadra' | 'faltante' | 'sobrante';

/** Cómo terminó una sesión cerrada. */
export interface CierreEnHistorialIpc {
  readonly cerradaEn: string;
  /** Quien cerró. Es quien abrió cuando `cerradaPorOtraPersona` es falso. */
  readonly cerradaPor: PersonaIpc;
  /** `true` cuando `caja_sesiones.cerrada_por` no es nulo: la cerró otra persona. */
  readonly cerradaPorOtraPersona: boolean;
  /** El administrador que autorizó cerrar la caja ajena, leído del asiento del cierre. */
  readonly cierreAjenoAutorizadoPor: PersonaIpc | null;
  /** `monto_esperado`: inicial más ventas en efectivo del turno (§4.10). */
  readonly montoTeorico: string;
  readonly montoReal: string;
  readonly diferencia: string;
  readonly tipoDeDiferencia: TipoDeDiferenciaIpc;
  /** Quién autorizó la diferencia y por qué vía. `null` si cuadró. */
  readonly diferenciaAutorizada: {
    readonly por: PersonaIpc;
    readonly via: 'presencial' | 'remoto';
  } | null;
}

/** Un conteo sellado que después se corrigió con autorización (§4.39). */
export interface ReconteoEnHistorialIpc {
  readonly fecha: string;
  /** Los conteos sellados ANTES del final, del más viejo al más nuevo. */
  readonly conteosSellados: readonly ConteoSelladoEnHistorialIpc[];
  readonly conteoFinal: {
    readonly montoEsperado: string;
    readonly montoReal: string;
    readonly diferencia: string;
  };
  readonly autorizadoPor: PersonaIpc | null;
  readonly via: 'presencial' | 'remoto' | null;
}

/** Una fila del historial. */
export interface SesionDeCajaEnHistorialIpc {
  readonly id: string;
  readonly estado: 'abierta' | 'cerrada';
  readonly abiertaEn: string;
  readonly abiertaPor: PersonaIpc;
  readonly montoInicial: string;
  readonly cierre: CierreEnHistorialIpc | null;
  /** Cuántos conteos se sellaron en esta sesión, corregidos o no. */
  readonly cantidadDeConteosSellados: number;
  readonly reconteo: ReconteoEnHistorialIpc | null;
  /**
   * Lo que no se pudo leer de la bitácora, dicho para una persona. Un asiento
   * ilegible se AVISA en vez de esconderse: este historial existe para auditar.
   */
  readonly avisos: readonly string[];
}

/** La lista, con el período aplicado y las personas que alguna vez abrieron caja. */
export interface HistorialDeCajasIpc {
  readonly sesiones: readonly SesionDeCajaEnHistorialIpc[];
  /** El rango de días aplicado, o `null` si se pidieron todas las fechas. */
  readonly periodo: PeriodoResueltoIpc | null;
  /** Para el filtro: todas las personas que abrieron alguna caja, con o sin filtro. */
  readonly personasQueAbrieron: readonly PersonaIpc[];
}

/** Un renglón del desglose por denominación. */
export interface LineaDeDesgloseEnHistorialIpc {
  readonly valor: string;
  readonly tipo: 'billete' | 'moneda';
  readonly cantidad: number;
  readonly subtotal: string;
}

/** El desglose de un momento, o `null` si ese momento se contó en modo simple. */
export interface DesgloseEnHistorialIpc {
  readonly lineas: readonly LineaDeDesgloseEnHistorialIpc[];
  readonly total: string;
}

/** La sesión expandida. */
export interface DetalleDeSesionDeCajaIpc {
  readonly sesion: SesionDeCajaEnHistorialIpc;
  /** TODOS los conteos sellados, incluso los de una caja que sigue abierta. */
  readonly conteosSellados: readonly ConteoSelladoEnHistorialIpc[];
  readonly desgloseDeApertura: DesgloseEnHistorialIpc | null;
  readonly desgloseDeCierre: DesgloseEnHistorialIpc | null;
}

// ---------------------------------------------------------------------------
// DTO: impresora térmica de esta terminal (§4.43)
// ---------------------------------------------------------------------------

/** Una impresora instalada en el sistema operativo, tal como la lista Electron. */
export interface ImpresoraDelSistemaIpc {
  /** El nombre con que la conoce el sistema: es lo que se guarda y a lo que se imprime. */
  readonly nombre: string;
  /** El nombre para mostrar. Suele coincidir con `nombre`. */
  readonly nombreVisible: string;
  readonly descripcion: string;
}

/** Qué vio salir la persona del ticket de prueba. */
export const RESULTADOS_DE_CONFIRMACION_IPC = ['bien', 'ilegible', 'nada'] as const;
export type ResultadoDeConfirmacionIpc = (typeof RESULTADOS_DE_CONFIRMACION_IPC)[number];

/**
 * Cómo terminó el ENVÍO del ticket de prueba, antes de que nadie lo mire.
 *
 *   · `enviado`: Windows aceptó el trabajo entero. NO dice que salió legible:
 *     una térmica ESC/POS no responde nada, así que eso lo dice la persona.
 *   · `no_encontrada`: el sistema no tiene ninguna impresora con ese nombre.
 *   · `no_se_pudo_enviar`: existe, pero abrirla o escribirle falló.
 *   · `trabajo_con_error`: Windows aceptó el trabajo y la impresora o el
 *     trabajo reportan un problema (desconectada, sin papel, error).
 *   · `entorno`: esta computadora no pudo ejecutar el envío (no es Windows,
 *     PowerShell no arrancó, o una política bloqueó el código de envío).
 */
export const CLASES_DE_ENVIO_IPC = [
  'enviado',
  'no_encontrada',
  'no_se_pudo_enviar',
  'trabajo_con_error',
  'entorno',
] as const;
export type ClaseDeEnvioIpc = (typeof CLASES_DE_ENVIO_IPC)[number];

/** La última prueba, guardada en `impresora.json`. */
export interface UltimaPruebaDeImpresoraIpc {
  readonly impresora: string;
  readonly fecha: string;
  readonly envio: ClaseDeEnvioIpc;
  /** `null` mientras nadie contestó, o si el envío no llegó a salir. */
  readonly confirmacion: ResultadoDeConfirmacionIpc | null;
}

export interface EstadoDeImpresoraIpc {
  /** `ninguna`, `cola` (nombre de impresora, el formato actual) o `ruta` (el formato viejo, solo se lee). */
  readonly tipo: 'ninguna' | 'cola' | 'ruta';
  /** El nombre de la impresora o la ruta vieja; `null` sin impresora. */
  readonly nombre: string | null;
  /** La frase para la persona, sin nombres de clases. */
  readonly descripcion: string;
  readonly ultimaPrueba: UltimaPruebaDeImpresoraIpc | null;
}

export interface ResultadoDePruebaDeImpresoraIpc {
  readonly clase: ClaseDeEnvioIpc;
  readonly titulo: string;
  readonly mensaje: string;
  /** El detalle técnico, para quien tenga que revisarlo (código de Windows, estado del trabajo). */
  readonly detalle: string | null;
  /** Solo si `clase` es `enviado`: con esto se contesta qué salió. */
  readonly pruebaId: string | null;
}

const LARGO_MAXIMO_NOMBRE_DE_IMPRESORA = 256;

export const esquemaNombreDeImpresora = z.object({
  nombre: z.string().trim().min(1).max(LARGO_MAXIMO_NOMBRE_DE_IMPRESORA),
});

export const esquemaConfirmacionDePrueba = z.object({
  pruebaId: z.uuid(),
  resultado: z.enum(RESULTADOS_DE_CONFIRMACION_IPC),
});
export type ConfirmacionDePruebaIpc = z.infer<typeof esquemaConfirmacionDePrueba>;

/** Lo que se contesta después de anotar qué salió del ticket. */
export interface ConfirmacionDePruebaRegistradaIpc {
  readonly estado: EstadoDeImpresoraIpc;
  readonly mensaje: string;
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
    /** Empieza la inscripción remota por TOTP del administrador en sesión: devuelve el QR y el secreto. */
    iniciarAutorizacionRemota(): Promise<RespuestaIpc<InscripcionRemotaIpc>>;
    /** La confirma con el primer código de la app. Solo así se guarda. */
    confirmarAutorizacionRemota(codigo: string): Promise<RespuestaIpc<boolean>>;
    /** Descarta la inscripción en curso. */
    cancelarAutorizacionRemota(): Promise<RespuestaIpc<boolean>>;
  };

  /** Apertura y cierre del turno de caja. */
  readonly caja: {
    /** Turno abierto del usuario en sesión y denominaciones para contar. */
    estado(): Promise<RespuestaIpc<EstadoDeCaja>>;
    /** Abre un turno para el usuario en sesión. */
    abrir(efectivo: EfectivoDeclaradoIpc): Promise<RespuestaIpc<TurnoAbierto>>;
    /**
     * Intenta cerrar. Sin `pin`, si hay diferencia devuelve
     * `REQUIERE_AUTORIZACION` (sin montos para quien no es administrativo).
     * Con el PIN correcto NO cierra: devuelve `AUTORIZACION_VALIDADA` con los
     * montos y deja la autorización pendiente en el proceso principal (§4.40).
     */
    cerrar(
      efectivo: EfectivoDeclaradoIpc,
      pin?: string,
      pinCajaAjena?: string,
    ): Promise<RespuestaIpc<ResultadoDeCierreIpc>>;
    /** Segunda confirmación: cierra con la autorización pendiente, si sigue valiendo. */
    confirmarCierreAutorizado(efectivo: EfectivoDeclaradoIpc): Promise<RespuestaIpc<ResultadoDeCierreIpc>>;
    /** Descarta la autorización pendiente. La caja sigue abierta. */
    cancelarAutorizacionDeCierre(): Promise<RespuestaIpc<boolean>>;
  };

  /**
   * Catálogo: categorías y productos.
   *
   * Todo lo de aquí exige rol administrativo, y lo hace cumplir el proceso
   * principal con el guard `requiereRol`. La interfaz oculta las opciones por
   * comodidad, no como control: esconder un botón no protege nada.
   */
  readonly catalogo: {
    /** Todas las categorías, con cuántos productos usa cada una. */
    listarCategorias(): Promise<RespuestaIpc<readonly CategoriaIpc[]>>;
    crearCategoria(nombre: string, orden: number): Promise<RespuestaIpc<CategoriaIpc>>;
    editarCategoria(
      id: string,
      nombre: string,
      orden: number,
    ): Promise<RespuestaIpc<CategoriaIpc>>;
    /** Activa o desactiva. Nunca borra. */
    fijarActivoCategoria(id: string, activo: boolean): Promise<RespuestaIpc<CategoriaIpc>>;

    /** Todos los productos, con su categoría ya resuelta. */
    listarProductos(): Promise<RespuestaIpc<readonly ProductoIpc[]>>;
    crearProducto(datos: ProductoNuevoIpc): Promise<RespuestaIpc<ProductoIpc>>;
    editarProducto(datos: ProductoEditadoIpc): Promise<RespuestaIpc<ProductoIpc>>;
    /** Activa o desactiva. Nunca borra. */
    fijarActivoProducto(id: string, activo: boolean): Promise<RespuestaIpc<ProductoIpc>>;
    /** Recepción de mercadería: suma al inventario y queda auditada. */
    ajustarInventario(
      productoId: string,
      cantidad: string,
      motivo: string | null,
    ): Promise<RespuestaIpc<ResultadoDeAjusteIpc>>;
    /** Abre el diálogo nativo, valida la imagen y la copia. */
    elegirFoto(): Promise<RespuestaIpc<FotoElegidaIpc>>;
  };

  /**
   * Pantalla de venta.
   *
   * Solo lectura en este módulo: arma el ticket en memoria y no persiste nada.
   * El registro de la venta llega en su propio prompt, con su transacción.
   */
  readonly venta: {
    /** Si se puede vender, el catálogo activo en su orden y las categorías. */
    estado(): Promise<RespuestaIpc<EstadoDeVenta>>;
    /**
     * Registra la venta del ticket, en una sola transacción.
     *
     * Se llama DOS veces cuando el descuento excede el tope del rol: la
     * primera sin `pinDescuento`, que devuelve el rechazo con el tope y el
     * exceso para mostrarlos, y la segunda con el PIN del administrador.
     */
    cobrar(pedido: PedidoDeCobro): Promise<RespuestaIpc<ResultadoDeCobro>>;
    /**
     * Anula una venta ya registrada. Se llama DOS veces: la primera con `pin`
     * en `null`, que valida y devuelve la vista previa, y la segunda con el PIN
     * de un administrador, que ejecuta.
     */
    anular(pedido: PedidoDeAnulacionIpc): Promise<RespuestaIpc<ResultadoDeAnulacionIpc>>;
  };

  /**
   * Gestión de usuarios. Todo exige rol administrativo.
   *
   * Cierra el hueco que existía desde el Prompt 3: hasta entonces solo se podía
   * crear al primer administrador, y solo con la tabla vacía.
   */
  readonly usuarios: {
    /** Todos, activos e inactivos, con los activos primero. */
    listar(): Promise<RespuestaIpc<readonly UsuarioIpc[]>>;
    crear(datos: UsuarioNuevoIpc): Promise<RespuestaIpc<UsuarioIpc>>;
    /** Nombre y rol. El PIN NO se toca acá. */
    editar(datos: UsuarioEditadoIpc): Promise<RespuestaIpc<UsuarioIpc>>;
    /** Acción aparte: no pide el PIN anterior, para poder resolver un olvido. */
    cambiarPin(id: string, pin: string): Promise<RespuestaIpc<UsuarioIpc>>;
    /** Da de baja o vuelve a habilitar. Nunca borra. */
    fijarActivo(id: string, activo: boolean): Promise<RespuestaIpc<UsuarioIpc>>;
  };

  /** Datos de la tienda que encabezan el recibo. Solo rol administrativo. */
  readonly negocio: {
    obtener(): Promise<RespuestaIpc<ConfiguracionDeNegocioIpc>>;
    guardar(datos: ConfiguracionDeNegocioIpc): Promise<RespuestaIpc<ConfiguracionDeNegocioIpc>>;
  };

  /**
   * Historial de recibos y reimpresión.
   *
   * Reimprimir REGENERA el PDF desde las filas de la venta, nunca reusa el
   * archivo del disco: así un recibo emitido antes de cargar los datos de la
   * tienda sale, al reimprimirse, con el nombre y el NIT correctos.
   */
  readonly recibos: {
    listar(filtro?: FiltroDeFormaPagoIpc): Promise<RespuestaIpc<HistorialDeRecibosIpc>>;
    ver(id: string): Promise<RespuestaIpc<ReciboVistoIpc>>;
    reimprimir(id: string): Promise<RespuestaIpc<ReciboVistoIpc>>;
  };

  /**
   * Los tres reportes, todos con rol administrativo.
   *
   * Ninguno agrega en SQL: el proceso principal trae las filas y suma con
   * Decimal.js, así que los montos son exactos al centavo. Ver CLAUDE.md §4.15.
   */
  readonly reportes: {
    resumenDeVentas(periodo: PeriodoIpc): Promise<RespuestaIpc<ResumenDeVentasIpc>>;
    ventasPorProducto(periodo: PeriodoIpc): Promise<RespuestaIpc<ReporteDeVentasPorProductoIpc>>;
    inventario(orden: 'nombre' | 'cantidad'): Promise<RespuestaIpc<ReporteDeInventarioIpc>>;
  };

  /** Topes de descuento por rol. Solo rol administrativo. */
  readonly limites: {
    listar(): Promise<RespuestaIpc<readonly LimiteDeDescuentoIpc[]>>;
    fijar(cambio: CambioDeLimiteIpc): Promise<RespuestaIpc<LimiteDeDescuentoIpc>>;
  };

  /**
   * Conexión de la terminal con la nube. Solo rol administrativo.
   *
   * Es el aprovisionamiento de §1.3 del diseño: un acto manual de una sola vez
   * por terminal. Lo que queda en el disco es una sesión —el token de refresco
   * cifrado—, nunca la contraseña.
   */
  readonly nube: {
    /** Cómo está la credencial. No devuelve ningún secreto. */
    estado(): Promise<RespuestaIpc<EstadoDeNubeIpc>>;
    /** Inicia sesión y guarda el token de refresco. La contraseña se descarta. */
    conectar(datos: ConexionDeNubeIpc): Promise<RespuestaIpc<ResumenDeConexionIpc>>;
  };

  /**
   * Sincronización con la nube: barra de estado y pantalla (fase 4.a).
   *
   * `resumen` NO exige rol ni sesión: la barra de estado está montada siempre,
   * incluso antes de iniciar sesión, y no lleva ningún dato sensible. Las
   * otras tres exigen rol administrativo del lado del proceso principal.
   */
  readonly sincronizacion: {
    /** Liviano. Lo consulta la barra de estado en todo momento. */
    resumen(): Promise<RespuestaIpc<ResumenDeSincronizacionIpc>>;
    /** Completo: pendientes por tabla, último éxito, lote bloqueante con su error. */
    detalle(): Promise<RespuestaIpc<DetalleDeSincronizacionIpc>>;
    /** Quita el bloqueo de un lote y agenda un ciclo inmediato. */
    reintentarLote(datos: LoteIdIpc): Promise<RespuestaIpc<boolean>>;
    /** Salta un lote a mano. Exige PIN y queda en `auditoria_log` (decisión 9). */
    saltarLote(datos: SaltoDeLoteIpc): Promise<RespuestaIpc<ResultadoDeSaltoDeLoteIpc>>;
  };

  /**
   * Restauración desde la nube (fase 4.b). Sin guard de sesión: corre sobre
   * una instalación vacía, antes de que exista ningún usuario local. Quien
   * autoriza es la nube, con el usuario de rol `restauracion`.
   */
  readonly restauracion: {
    estado(): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    /** Inicia sesión, comprueba precondiciones y arranca. La contraseña no se guarda. */
    iniciar(datos: InicioDeRestauracionIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    retomar(datos: RetomaDeRestauracionIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    progreso(): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    cancelar(): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    aceptarExcluida(datos: FilaExcluidaIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    revisarUsuario(datos: RevisionDeUsuarioIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    asignarPin(datos: PinDeRestauracionIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
    terminar(): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>>;
  };

  /** Impresora térmica de esta terminal (§4.43). Todo con rol administrativo. */
  /** Historial de cajas. Solo rol administrativo (§4.44). */
  readonly historialDeCajas: {
    listar(filtro: FiltroDeHistorialDeCajasIpc): Promise<RespuestaIpc<HistorialDeCajasIpc>>;
    detalle(id: string): Promise<RespuestaIpc<DetalleDeSesionDeCajaIpc>>;
  };

  readonly impresora: {
    estado(): Promise<RespuestaIpc<EstadoDeImpresoraIpc>>;
    listar(): Promise<RespuestaIpc<readonly ImpresoraDelSistemaIpc[]>>;
    guardar(nombre: string): Promise<RespuestaIpc<EstadoDeImpresoraIpc>>;
    quitar(): Promise<RespuestaIpc<EstadoDeImpresoraIpc>>;
    imprimirPrueba(nombre: string): Promise<RespuestaIpc<ResultadoDePruebaDeImpresoraIpc>>;
    confirmarPrueba(datos: ConfirmacionDePruebaIpc): Promise<RespuestaIpc<ConfirmacionDePruebaRegistradaIpc>>;
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
