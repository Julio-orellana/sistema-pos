/**
 * errores.ts — Traducción de errores de base de datos a errores de negocio.
 *
 * POR QUÉ EXISTE: cuando una venta futura intente descontar más inventario del
 * que hay, la base va a rechazarla con el mensaje
 * "CHECK constraint failed: productos_inventario_no_negativo". Ese texto no se
 * le puede mostrar a un cajero con un cliente enfrente, y tampoco sirve para
 * que la interfaz decida qué hacer.
 *
 * Este módulo es el ÚNICO punto donde un error crudo de SQLite o de Postgres se
 * convierte en un error de negocio con código y mensaje en español. Está
 * preparado desde ahora, aunque la lógica de ventas todavía no exista, para que
 * cuando llegue no haya tentación de dejar pasar el error crudo.
 *
 * REGLA PARA QUIEN AGREGUE UN REPOSITORIO: toda escritura pasa por
 * `RepositorioBase.ejecutar()`, que aplica esta traducción. Si una escritura no
 * pasa por ahí, un fallo de restricción llega crudo hasta la interfaz.
 */

/** Situaciones de negocio que la base puede detectar por su cuenta. */
export type CodigoErrorDeNegocio =
  | 'STOCK_INSUFICIENTE'
  | 'CONFLICTO_DE_INVENTARIO'
  | 'CAJA_YA_ABIERTA'
  | 'NUMERO_DE_RECIBO_DUPLICADO'
  | 'REGISTRO_DUPLICADO'
  | 'REFERENCIA_INEXISTENTE'
  | 'REGISTRO_EN_USO'
  | 'AUDITORIA_INMUTABLE'
  | 'PERMISO_DENEGADO'
  | 'VALOR_DECIMAL_INVALIDO'
  | 'DATO_INVALIDO'
  // Impresora de la terminal (§4.43).
  | 'IMPRESORAS_NO_LISTADAS'
  | 'IMPRESORA_NO_INSTALADA'
  | 'PRUEBA_NO_VIGENTE'
  // Anulación de una venta (docs/ANULACION-DE-VENTA.md). Todos se detectan
  // ANTES de pedir el PIN, salvo que la base los atrape como última red.
  | 'VENTA_YA_ANULADA'
  | 'CAJA_DE_LA_VENTA_CERRADA'
  | 'VOUCHER_NO_COINCIDE'
  | 'UNIDAD_CAMBIADA'
  | 'CONTADORES_INCONSISTENTES'
  // Autorización remota por TOTP (migraciones 036 y 037).
  | 'CIFRADO_NO_DISPONIBLE'
  | 'INSCRIPCION_NO_VIGENTE'
  | 'CODIGO_DE_INSCRIPCION_INCORRECTO'
  | 'ANULACION_INMUTABLE';

/**
 * Error de negocio. Lleva un mensaje pensado para mostrarse en pantalla y
 * conserva la causa técnica para la bitácora, que es donde sí interesa el
 * detalle de SQLite.
 */
export class ErrorDeNegocio extends Error {
  public readonly codigo: CodigoErrorDeNegocio;
  /** Texto que se le puede mostrar al cajero tal cual. */
  public readonly mensajeParaElUsuario: string;
  /** Mensaje original de la base, para el log de auditoría. */
  public readonly causaTecnica: string;

  public constructor(
    codigo: CodigoErrorDeNegocio,
    mensajeParaElUsuario: string,
    causaTecnica: string,
  ) {
    super(mensajeParaElUsuario);
    this.name = 'ErrorDeNegocio';
    this.codigo = codigo;
    this.mensajeParaElUsuario = mensajeParaElUsuario;
    this.causaTecnica = causaTecnica;
  }
}

/** Forma mínima de un error de base de datos, sin depender del controlador. */
interface ErrorDeBaseDeDatos {
  readonly message: string;
  /** SQLite: 'SQLITE_CONSTRAINT_CHECK'. Postgres: '23514'. */
  readonly code?: string;
  /** Postgres expone el nombre de la restricción; SQLite lo pone en el mensaje. */
  readonly constraint?: string;
}

/** ¿El valor tiene forma de error de base de datos? */
function esErrorDeBaseDeDatos(error: unknown): error is ErrorDeBaseDeDatos {
  return error instanceof Error;
}

/** Lee el nombre de la restricción, venga de donde venga. */
function nombreDeRestriccion(error: ErrorDeBaseDeDatos): string {
  if (typeof error.constraint === 'string' && error.constraint.length > 0) {
    return error.constraint;
  }
  // SQLite lo incluye en el texto: "CHECK constraint failed: <nombre>".
  const coincidencia = /constraint failed:\s*(.+)$/im.exec(error.message);
  return coincidencia?.[1]?.trim() ?? '';
}

/**
 * Cada regla que la base hace cumplir y cómo se le explica a una persona.
 *
 * El orden importa: se evalúan de arriba hacia abajo y gana la primera que
 * coincide, así que las reglas específicas van antes que las genéricas.
 */
interface ReglaDeTraduccion {
  readonly codigo: CodigoErrorDeNegocio;
  readonly mensaje: string;
  /** ¿Este error corresponde a esta regla? */
  readonly coincide: (error: ErrorDeBaseDeDatos, restriccion: string) => boolean;
}

/** Contiene alguna de las señales dadas, sin distinguir mayúsculas. */
function contiene(texto: string, ...señales: readonly string[]): boolean {
  const enMinusculas = texto.toLowerCase();
  return señales.some((señal) => enMinusculas.includes(señal.toLowerCase()));
}

const REGLAS: readonly ReglaDeTraduccion[] = [
  {
    codigo: 'STOCK_INSUFICIENTE',
    mensaje: 'Stock insuficiente para completar la venta.',
    coincide: (_error, restriccion) => restriccion === 'productos_inventario_no_negativo',
  },
  /*
    Las dos reglas de tabla del precio mayorista (migración 039, spec 002). El
    servicio de productos las revisa ANTES con `revisarPrecioMayorista`, que da
    el mensaje exacto; estas son la última red, por si algo llegara a la base
    sin pasar por él. Van antes del DATO_INVALIDO genérico, que las taparía.
  */
  {
    codigo: 'DATO_INVALIDO',
    mensaje: 'El precio mayorista y su cantidad mínima van juntos: se ponen los dos o ninguno.',
    coincide: (_error, restriccion) => restriccion === 'productos_mayorista_completo',
  },
  {
    codigo: 'DATO_INVALIDO',
    mensaje: 'El precio mayorista tiene que ser menor que el precio de lista. Bajá el precio mayorista o quitalo.',
    coincide: (_error, restriccion) => restriccion === 'productos_mayorista_menor_que_lista',
  },
  {
    codigo: 'CAJA_YA_ABIERTA',
    // El mensaje NO dice de quién es la caja, y es deliberado: desde la
    // migración 010 la caja es UNA en todo el sistema, así que la que está
    // abierta puede ser de cualquiera. Decir "ya tenés" sería falso la mitad
    // de las veces y mandaría a buscar un turno propio que no existe.
    mensaje: 'Ya hay una caja abierta en el sistema. Hay que cerrarla antes de abrir otra.',
    // SQLite reporta la columna indexada, no el nombre del índice parcial.
    // Desde la 010 el índice es sobre `estado`, así que el mensaje pasó de
    // "caja_sesiones.usuario_id" a "caja_sesiones.estado". Se reconocen los
    // dos: una base todavía sin migrar reportaría el viejo.
    coincide: (error) =>
      contiene(
        error.message,
        'caja_sesiones.estado',
        'caja_sesiones.usuario_id',
        'idx_caja_sesiones_una_abierta',
      ),
  },
  {
    codigo: 'NUMERO_DE_RECIBO_DUPLICADO',
    mensaje: 'Ese número de recibo ya existe. Volvé a intentar la operación.',
    coincide: (error) => contiene(error.message, 'recibos.numero_recibo'),
  },
  {
    // Va ANTES que la bitácora: el disparador de la 033 no dice «inmutable» a
    // propósito, pero la regla específica tiene que ganar igual.
    codigo: 'ANULACION_INMUTABLE',
    mensaje: 'Una anulación de venta no se puede modificar ni borrar.',
    coincide: (error) => contiene(error.message, 'anulación de venta no se puede'),
  },
  {
    // El servicio lo comprueba antes; esta es la última red del UNIQUE.
    codigo: 'VENTA_YA_ANULADA',
    mensaje: 'Esa venta ya estaba anulada.',
    coincide: (error) => contiene(error.message, 'anulaciones_de_venta.venta_id'),
  },
  {
    codigo: 'AUDITORIA_INMUTABLE',
    mensaje: 'La bitácora de auditoría no se puede modificar ni borrar.',
    coincide: (error) => contiene(error.message, 'inmutable'),
  },
  {
    codigo: 'VALOR_DECIMAL_INVALIDO',
    mensaje:
      'Un importe o una cantidad no tiene el formato exacto que exige el sistema. ' +
      'Es un error de programación: el valor no pasó por money.ts.',
    coincide: (error) => contiene(error.message, "typeof(", "GLOB"),
  },
  {
    codigo: 'REFERENCIA_INEXISTENTE',
    mensaje: 'La operación hace referencia a un registro que no existe.',
    coincide: (error) => contiene(error.message, 'FOREIGN KEY constraint failed', '23503'),
  },
  {
    codigo: 'REGISTRO_DUPLICADO',
    mensaje: 'Ya existe un registro con esos datos.',
    coincide: (error) => contiene(error.message, 'UNIQUE constraint failed', 'duplicate key'),
  },
  {
    codigo: 'DATO_INVALIDO',
    mensaje: 'Los datos de la operación no cumplen una regla del sistema.',
    coincide: (error) => contiene(error.message, 'CHECK constraint failed', 'violates check constraint'),
  },
];

/**
 * Convierte un error de base de datos en un `ErrorDeNegocio` cuando reconoce la
 * regla que se violó.
 *
 * Si no lo reconoce, devuelve el error original SIN envolverlo. Es deliberado:
 * envolver todo con un mensaje genérico escondería fallos reales de
 * programación detrás de un texto tranquilizador.
 */
export function traducirErrorDeBaseDeDatos(error: unknown): unknown {
  if (!esErrorDeBaseDeDatos(error)) {
    return error;
  }
  if (error instanceof ErrorDeNegocio) {
    return error;
  }

  const restriccion = nombreDeRestriccion(error);
  const regla = REGLAS.find((candidata) => candidata.coincide(error, restriccion));

  if (regla === undefined) {
    return error;
  }

  return new ErrorDeNegocio(regla.codigo, regla.mensaje, error.message);
}

/**
 * Error de conflicto de inventario: el saldo del producto cambió entre que se
 * leyó y que se quiso escribir, así que el comparar-y-cambiar no encontró el
 * valor esperado y no actualizó ninguna fila.
 *
 * NO nace de una restricción de la base, sino de que el UPDATE condicional
 * afectó cero filas. Se declara aquí igual para que el futuro módulo de ventas
 * use este código y este mensaje exactos, y no improvise los suyos.
 *
 * POLÍTICA: cero reintentos automáticos. La transacción se revierte entera y el
 * cajero decide. El porqué está en la sección 4.3 de CLAUDE.md.
 */
export function errorDeConflictoDeInventario(
  nombreDelProducto: string,
  causaTecnica = 'El UPDATE condicional de inventario afectó 0 filas.',
): ErrorDeNegocio {
  return new ErrorDeNegocio(
    'CONFLICTO_DE_INVENTARIO',
    `El inventario de ${nombreDelProducto} cambió mientras se cobraba. ` +
      'No se registró la venta. Revisá la cantidad y volvé a cobrar.',
    causaTecnica,
  );
}

/**
 * El conflicto del comparar-y-cambiar AL ANULAR (docs/ANULACION-DE-VENTA.md §2.5).
 *
 * Es el mismo código que el de la venta, con otro texto: el de la venta dice
 * «mientras se cobraba» y «no se registró la venta», que acá sería falso. Rige
 * la misma política de §4.3: cero reintentos, se revierte todo y decide quien
 * pidió.
 */
export function errorDeConflictoDeInventarioAlAnular(
  nombreDelProducto: string,
  causaTecnica: string,
): ErrorDeNegocio {
  return new ErrorDeNegocio(
    'CONFLICTO_DE_INVENTARIO',
    `El inventario de ${nombreDelProducto} cambió mientras se anulaba. ` +
      'La venta no se anuló. Volvé a intentarlo.',
    causaTecnica,
  );
}

/**
 * Ejecuta una operación contra la base traduciendo cualquier error de
 * restricción. Es el envoltorio que usan los repositorios.
 */
export function ejecutarTraduciendoErrores<T>(operacion: () => T): T {
  try {
    return operacion();
  } catch (error) {
    throw traducirErrorDeBaseDeDatos(error);
  }
}
