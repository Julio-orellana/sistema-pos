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

/**
 * Payload de cierre de caja.
 *
 * Hay DOS PIN posibles y son distintos, no dos nombres de lo mismo:
 *
 *   · `pinCajaAjena` autoriza cerrar un turno que abrió otra persona. Solo
 *     acepta el PIN NORMAL de un administrador.
 *   · `pin` autoriza una DIFERENCIA de arqueo. Acepta también el PIN remoto.
 *
 * Un mismo cierre puede necesitar los dos: cerrar la caja de otro y encima
 * encontrarla descuadrada. Cada uno tiene su propio candado de intentos.
 */
export const esquemaCierreDeCaja = z.object({
  efectivo: esquemaEfectivoDeclarado,
  pin: z.string().length(LARGO_DEL_PIN_IPC).optional(),
  pinCajaAjena: z.string().length(LARGO_DEL_PIN_IPC).optional(),
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
}

/** Lo que la pantalla de caja necesita para dibujarse. */
export interface EstadoDeCaja {
  /** `null` si NO hay ninguna caja abierta en todo el sistema. */
  readonly turnoAbierto: TurnoAbierto | null;
  readonly denominaciones: readonly DenominacionParaContar[];
}

/**
 * Resultado de intentar cerrar un turno.
 *
 * `codigo` puede ser `CIERRE_CORRECTO`, `REQUIERE_AUTORIZACION` (hay
 * diferencia), `REQUIERE_AUTORIZACION_DE_CAJA_AJENA` (la abrió otro), o el
 * código de un intento de autorización fallido.
 */
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
 * NO LLEVA `pinHash` NI `pinRemotoHash`, y no es un olvido: el hash no tiene
 * nada que hacer en la ventana. Tampoco sirve para nada allí, y exponerlo
 * pondría al alcance de un renderer comprometido el material con el que
 * atacar los PIN fuera de línea.
 */
export interface UsuarioIpc {
  readonly id: string;
  readonly nombre: string;
  readonly rol: RolIpc;
  readonly activo: boolean;
  /** `true` si tiene configurado el PIN de autorización remota. */
  readonly tienePinRemoto: boolean;
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

/** Payload que identifica un recibo. */
export const esquemaReciboPorId = z.object({
  id: z.uuid(),
});

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
  /** `true` si alguna vez salió por la impresora térmica. */
  readonly impreso: boolean;
  readonly lineas: number;
  /** `true` si la venta llevaba descuento discrecional. */
  readonly conDescuento: boolean;
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
}

/** El reporte de ventas por producto, ya ordenado por monto descendente. */
export interface ReporteDeVentasPorProductoIpc {
  readonly periodo: PeriodoResueltoIpc;
  readonly productos: readonly VentasDeUnProductoIpc[];
  readonly montoTotal: string;
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
  /** El recibo tal como sale en el papel, en texto plano. */
  readonly texto: string;
  /** Ruta del PDF en el disco. */
  readonly rutaPdf: string;
  readonly pdfGenerado: boolean;
  readonly impreso: boolean;
  readonly mensajeDeImpresion: string;
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
      pinCajaAjena?: string,
    ): Promise<RespuestaIpc<ResultadoDeCierreIpc>>;
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
    listar(): Promise<RespuestaIpc<readonly ReciboEnHistorialIpc[]>>;
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
