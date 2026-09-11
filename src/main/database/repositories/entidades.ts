/**
 * Entidades del dominio tal como las devuelven los repositorios.
 *
 * Los campos decimales son `Decimal`, no `number` ni `string`: el repositorio
 * ya hizo la conversión desde el TEXT de la base usando decimal-columns.ts, y
 * quien recibe la entidad trabaja con aritmética exacta desde el primer
 * momento. Un `number` en cualquiera de estos campos sería un defecto.
 *
 * Los identificadores son UUID en cadena, generados en el cliente.
 * Las fechas son cadenas ISO-8601 en UTC.
 *
 * Viven junto a los repositorios y no en src/shared porque el renderer nunca
 * ve estas entidades: recibe DTO serializables por IPC, con los decimales ya
 * convertidos a cadena.
 */

import type Decimal from 'decimal.js';

/** Roles del sistema. */
export type Rol = 'venta' | 'administrativo';

/** Cómo se mide un producto. */
export type TipoMedida = 'unidad' | 'peso';

/** Unidades de peso admitidas. */
export type UnidadPeso = 'lb' | 'kg';

/** Naturaleza de un descuento o precio especial. */
export type TipoValor = 'porcentaje' | 'monto_fijo';

/** Estado de un turno de caja. */
export type EstadoCaja = 'abierta' | 'cerrada';

/** Estado de una venta. */
export type EstadoVenta = 'completada' | 'anulada';

/** Formas de pago aceptadas. */
export type FormaPago = 'efectivo' | 'tarjeta';

/** Naturaleza de una denominación de efectivo. */
export type TipoDeDenominacion = 'billete' | 'moneda';

/** En qué momento del turno se contó el efectivo. */
export type MomentoDeArqueo = 'apertura' | 'cierre';

/**
 * Cómo autorizó un administrador: presente frente a la pantalla con su PIN
 * normal, o a distancia con su PIN de autorización remota.
 *
 * Lo determina el sistema según cuál hash coincidió, **nunca se le pregunta al
 * cajero**. Vale para el cierre descuadrado y, desde el 2026-09-11, también
 * para el descuento que excede el tope del rol.
 */
export type ViaDeAutorizacion = 'presencial' | 'remoto';

/** Estado de sincronización de un registro con la nube. */
export type EstadoSincronizacion = 'pendiente' | 'sincronizado' | 'error';

/** Operación replicable hacia la nube. */
export type OperacionSync = 'insertar' | 'actualizar' | 'eliminar';

// ---------------------------------------------------------------------------

/** Usuario del sistema. El PIN nunca sale de la base en claro. */
export interface Usuario {
  readonly id: string;
  readonly nombre: string;
  readonly rol: Rol;
  readonly pinHash: string;
  /**
   * Hash del PIN de autorización REMOTA, o `null` si no lo configuró.
   *
   * Es un segundo PIN, distinto del normal, pensado para dictarse por
   * teléfono. Ver la migración 005 y CLAUDE.md §4.9.
   */
  readonly pinRemotoHash: string | null;
  readonly activo: boolean;
  /** Intentos de PIN fallidos consecutivos. Se reinicia al ingresar bien. */
  readonly intentosFallidos: number;
  /**
   * Momento (ISO-8601 UTC) hasta el cual el usuario no puede intentar de
   * nuevo, o `null` si no está bloqueado. Se persiste en la base a propósito:
   * si viviera en memoria, bastaría con reiniciar la aplicación para reiniciar
   * el contador y seguir adivinando.
   */
  readonly bloqueadoHasta: string | null;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Datos para crear un usuario. El id y las fechas los pone el repositorio. */
export interface NuevoUsuario {
  readonly nombre: string;
  readonly rol: Rol;
  readonly pinHash: string;
  readonly activo?: boolean;
}

// ---------------------------------------------------------------------------

/** Categoría de productos, para agrupar los íconos de la pantalla de venta. */
export interface Categoria {
  readonly id: string;
  readonly nombre: string;
  readonly orden: number;
  /**
   * Baja lógica: una categoría inactiva deja de ofrecerse al crear o editar un
   * producto, y NADA más. Los productos que ya la referencian siguen intactos
   * y siguen vendiéndose. Nunca se borra físicamente, porque
   * `productos.categoria_id` la referencia con ON DELETE RESTRICT.
   */
  readonly activo: boolean;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Datos para crear una categoría. */
export interface NuevaCategoria {
  readonly nombre: string;
  readonly orden?: number;
}

/** Campos editables de una categoría existente. */
export interface CambiosDeCategoria {
  readonly nombre: string;
  readonly orden: number;
}

// ---------------------------------------------------------------------------

/**
 * Producto del catálogo.
 *
 * `inventarioDisponible` es un ÚNICO saldo acumulado: sube con cada ingreso de
 * mercadería y baja con cada venta. No hay lotes.
 */
export interface Producto {
  readonly id: string;
  readonly nombre: string;
  readonly categoriaId: string;
  readonly fotoPath: string | null;
  readonly tipoMedida: TipoMedida;
  readonly unidadPeso: UnidadPeso | null;
  readonly cantidadPredefinidaIcono: Decimal;
  readonly precioBase: Decimal;
  readonly inventarioDisponible: Decimal;
  /** Cuántas VECES se vendió. Ordena los íconos de la pantalla de venta. */
  readonly contadorVentas: number;
  /** Cuánta CANTIDAD acumulada salió. No es comparable entre unidades. */
  readonly cantidadVendida: Decimal;
  readonly activo: boolean;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Datos para crear un producto. */
export interface NuevoProducto {
  readonly nombre: string;
  readonly categoriaId: string;
  readonly fotoPath?: string | null;
  readonly tipoMedida: TipoMedida;
  readonly unidadPeso?: UnidadPeso | null;
  readonly cantidadPredefinidaIcono: Decimal | string;
  readonly precioBase: Decimal | string;
  readonly inventarioDisponible: Decimal | string;
  readonly activo?: boolean;
}

/**
 * Campos editables de un producto existente.
 *
 * NO incluye `inventarioDisponible`: mover el saldo es recepción de mercadería
 * y tiene su propia operación auditada (`ServicioDeProductos.ajustarInventario`).
 * Dejarlo aquí permitiría cambiar el inventario "de paso" al corregir un
 * precio, sin que quedara constancia de que entró mercadería.
 *
 * Tampoco incluye `contadorVentas`, que solo lo mueve una venta real.
 */
export interface CambiosDeProducto {
  readonly nombre: string;
  readonly categoriaId: string;
  readonly fotoPath: string | null;
  readonly tipoMedida: TipoMedida;
  readonly unidadPeso: UnidadPeso | null;
  readonly cantidadPredefinidaIcono: Decimal | string;
  readonly precioBase: Decimal | string;
}

// ---------------------------------------------------------------------------

/** Precio especial vigente para un producto durante una ventana de tiempo. */
export interface PrecioEspecial {
  readonly id: string;
  readonly productoId: string;
  readonly tipo: TipoValor;
  readonly valor: Decimal;
  readonly vigenteDesde: string;
  readonly vigenteHasta: string | null;
  readonly activo: boolean;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Datos para crear un precio especial. */
export interface NuevoPrecioEspecial {
  readonly productoId: string;
  readonly tipo: TipoValor;
  readonly valor: Decimal | string;
  readonly vigenteDesde: string;
  readonly vigenteHasta?: string | null;
  readonly activo?: boolean;
}

// ---------------------------------------------------------------------------

/** Tope de descuento que un rol puede aplicar sin autorización. */
export interface LimiteDescuento {
  readonly id: string;
  readonly rol: Rol;
  readonly descuentoMaxPorcentaje: Decimal;
  readonly descuentoMaxMontoFijo: Decimal;
  readonly editadoPor: string | null;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Datos para fijar el límite de un rol. */
export interface NuevoLimiteDescuento {
  readonly rol: Rol;
  readonly descuentoMaxPorcentaje: Decimal | string;
  readonly descuentoMaxMontoFijo: Decimal | string;
  readonly editadoPor?: string | null;
}

// ---------------------------------------------------------------------------

/** Turno de caja. Los montos del cierre son nulos hasta que se cierra. */
export interface CajaSesion {
  readonly id: string;
  readonly usuarioId: string;
  readonly montoInicial: Decimal;
  readonly abiertaEn: string;
  readonly montoEsperado: Decimal | null;
  readonly montoReal: Decimal | null;
  readonly diferencia: Decimal | null;
  readonly cerradaEn: string | null;
  /**
   * Quién CERRÓ el turno, si no fue quien lo abrió; `null` en el caso normal.
   *
   * `usuarioId` dice quién abrió. Desde la migración 010 la caja es una sola
   * en todo el sistema, así que puede cerrarla otra persona con autorización
   * de un administrador. Guarda a quien cerró, NO a quien autorizó: eso último
   * queda en el asiento de auditoría.
   */
  readonly cerradaPor: string | null;
  readonly estado: EstadoCaja;
  /** Administrador que autorizó cerrar con diferencia, o `null`. */
  readonly diferenciaAutorizadaPor: string | null;
  /** Por cuál vía autorizó. Va siempre junto con el autorizante. */
  readonly diferenciaAutorizadaVia: ViaDeAutorizacion | null;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Datos para abrir un turno de caja. */
export interface NuevaCajaSesion {
  readonly usuarioId: string;
  readonly montoInicial: Decimal | string;
  readonly abiertaEn?: string;
}

/** Datos del corte con que se cierra un turno. */
export interface CierreDeCaja {
  readonly montoEsperado: Decimal | string;
  readonly montoReal: Decimal | string;
  readonly diferencia: Decimal | string;
  readonly cerradaEn?: string;
  /** Administrador que autorizó la diferencia, si hubo. */
  readonly autorizadaPor?: string | null;
  /** Vía por la que autorizó. Va siempre junto con el autorizante. */
  readonly autorizadaVia?: ViaDeAutorizacion | null;
  /** Quién cerró, si no fue quien abrió. `null` u omitido en el caso normal. */
  readonly cerradaPor?: string | null;
}

// ---------------------------------------------------------------------------

/** Una denominación de efectivo del quetzal. */
export interface Denominacion {
  readonly id: string;
  readonly valor: Decimal;
  readonly tipo: TipoDeDenominacion;
  readonly orden: number;
  readonly activo: boolean;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Cuántas piezas de una denominación se contaron. */
export interface LineaDeDesglose {
  readonly denominacionId: string;
  readonly cantidad: number;
}

/** Una fila del desglose ya guardada. */
export interface DesgloseDeCaja {
  readonly id: string;
  readonly cajaSesionId: string;
  readonly denominacionId: string;
  readonly momento: MomentoDeArqueo;
  readonly cantidad: number;
  readonly creadoEn: string;
}

// ---------------------------------------------------------------------------

/** Cabecera de una venta. */
export interface Venta {
  readonly id: string;
  readonly cajaSesionId: string;
  readonly usuarioId: string;
  readonly fecha: string;
  readonly subtotal: Decimal;
  readonly descuentoTipo: TipoValor | null;
  readonly descuentoValor: Decimal | null;
  readonly descuentoAutorizadoPor: string | null;
  /**
   * Por cuál vía se autorizó. Va SIEMPRE junto con `descuentoAutorizadoPor`:
   * los dos llenos o los dos vacíos, y lo hace cumplir la base (migración 017).
   */
  readonly descuentoAutorizadoVia: ViaDeAutorizacion | null;
  readonly total: Decimal;
  readonly formaPago: FormaPago;
  readonly numBoleta: string | null;
  readonly estado: EstadoVenta;
  readonly estadoSincronizacion: EstadoSincronizacion;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
}

/** Datos para registrar una venta. */
export interface NuevaVenta {
  readonly cajaSesionId: string;
  readonly usuarioId: string;
  readonly fecha?: string;
  readonly subtotal: Decimal | string;
  readonly descuentoTipo?: TipoValor | null;
  readonly descuentoValor?: Decimal | string | null;
  readonly descuentoAutorizadoPor?: string | null;
  readonly descuentoAutorizadoVia?: ViaDeAutorizacion | null;
  readonly total: Decimal | string;
  readonly formaPago: FormaPago;
  readonly numBoleta?: string | null;
  readonly estado?: EstadoVenta;
}

// ---------------------------------------------------------------------------

/**
 * Línea de una venta.
 *
 * Los campos `*Snap` son COPIAS del dato al momento de la venta, no
 * referencias vivas: si el producto cambia de nombre o de precio mañana, el
 * recibo histórico no cambia.
 */
export interface VentaDetalle {
  readonly id: string;
  readonly ventaId: string;
  readonly productoId: string;
  readonly productoNombreSnap: string;
  readonly unidadSnap: string;
  readonly cantidad: Decimal;
  readonly precioUnitarioSnap: Decimal;
  /** Valor sin redondear, del que se deriva el total real. */
  readonly subtotalExacto: Decimal;
  /** Valor conciliado que aparece impreso en el recibo. */
  readonly subtotalImpreso: Decimal;
  /** Orden de captura. Decide el desempate del reparto de centavos. */
  readonly ordenLinea: number;
  readonly creadoEn: string;
}

/** Datos para agregar una línea a una venta. */
export interface NuevaVentaDetalle {
  readonly ventaId: string;
  readonly productoId: string;
  readonly productoNombreSnap: string;
  readonly unidadSnap: string;
  readonly cantidad: Decimal | string;
  readonly precioUnitarioSnap: Decimal | string;
  readonly subtotalExacto: Decimal | string;
  readonly subtotalImpreso: Decimal | string;
  readonly ordenLinea: number;
}

// ---------------------------------------------------------------------------

/**
 * Datos de la tienda que encabezan el recibo.
 *
 * Las cuatro son nulables porque los datos reales de Jimmy todavía no llegaron.
 * `null` significa «sin configurar», y el recibo imprime un marcador entre
 * corchetes en su lugar. NUNCA una cadena vacía: el esquema lo impide, para que
 * no haya dos formas distintas de estar vacío.
 */
export interface ConfiguracionNegocio {
  readonly nombreComercial: string | null;
  readonly direccion: string | null;
  readonly telefono: string | null;
  readonly nit: string | null;
  readonly actualizadoEn: string;
}

/** Los cuatro campos editables de la configuración. */
export interface CambiosDeConfiguracion {
  readonly nombreComercial: string | null;
  readonly direccion: string | null;
  readonly telefono: string | null;
  readonly nit: string | null;
}

/** Comprobante emitido por una venta. El PDF siempre existe. */
export interface Recibo {
  readonly id: string;
  readonly ventaId: string;
  readonly numeroRecibo: number;
  readonly pdfPath: string;
  readonly impreso: boolean;
  readonly creadoEn: string;
}

/** Datos para registrar un recibo. */
export interface NuevoRecibo {
  readonly ventaId: string;
  readonly numeroRecibo: number;
  readonly pdfPath: string;
  readonly impreso?: boolean;
}

// ---------------------------------------------------------------------------

/** Asiento de la bitácora de auditoría. Es inmutable una vez escrito. */
export interface AsientoAuditoria {
  readonly id: string;
  readonly usuarioId: string | null;
  readonly accion: string;
  readonly entidadTipo: string;
  readonly entidadId: string | null;
  readonly valorAnterior: string | null;
  readonly valorNuevo: string | null;
  readonly fecha: string;
}

/** Datos para escribir un asiento de auditoría. */
export interface NuevoAsientoAuditoria {
  readonly usuarioId?: string | null;
  readonly accion: string;
  readonly entidadTipo: string;
  readonly entidadId?: string | null;
  /** Se serializa a JSON automáticamente. */
  readonly valorAnterior?: unknown;
  /** Se serializa a JSON automáticamente. */
  readonly valorNuevo?: unknown;
  readonly fecha?: string;
}

// ---------------------------------------------------------------------------

/** Elemento de la cola local de sincronización. */
export interface ElementoSyncCola {
  readonly id: string;
  readonly entidadTipo: string;
  readonly entidadId: string;
  readonly operacion: OperacionSync;
  readonly payload: string;
  readonly intentadoEn: string | null;
  readonly sincronizadoEn: string | null;
  readonly error: string | null;
  readonly creadoEn: string;
  /** Agrupa las filas de UNA unidad de trabajo: o suben juntas o no sube ninguna. */
  readonly loteId: string;
  /** Padres antes que hijos dentro del lote. Empieza en 0. */
  readonly ordenEnLote: number;
  /** Cuántas veces se intentó subir este lote. Alimenta el backoff. */
  readonly intentos: number;
  /** Cuándo volver a intentar, ISO-8601 UTC. `null` = disponible ahora mismo. */
  readonly proximoIntentoEn: string | null;
  /** `true` si este lote falló con un error determinístico y detiene la cola. */
  readonly bloqueante: boolean;
}

/** Datos para encolar un cambio. */
export interface NuevoElementoSyncCola {
  readonly entidadTipo: string;
  readonly entidadId: string;
  readonly operacion: OperacionSync;
  /** Se serializa a JSON automáticamente. */
  readonly payload: unknown;
}
