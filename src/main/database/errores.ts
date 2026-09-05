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
  | 'CAJA_YA_ABIERTA'
  | 'NUMERO_DE_RECIBO_DUPLICADO'
  | 'REGISTRO_DUPLICADO'
  | 'REFERENCIA_INEXISTENTE'
  | 'REGISTRO_EN_USO'
  | 'AUDITORIA_INMUTABLE'
  | 'VALOR_DECIMAL_INVALIDO'
  | 'DATO_INVALIDO';

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
  {
    codigo: 'CAJA_YA_ABIERTA',
    mensaje: 'Ese usuario ya tiene un turno de caja abierto. Hay que cerrarlo antes de abrir otro.',
    // SQLite reporta la columna, no el nombre del índice parcial:
    // "UNIQUE constraint failed: caja_sesiones.usuario_id". Comprobado.
    coincide: (error) =>
      contiene(error.message, 'caja_sesiones.usuario_id', 'idx_caja_sesiones_una_abierta'),
  },
  {
    codigo: 'NUMERO_DE_RECIBO_DUPLICADO',
    mensaje: 'Ese número de recibo ya existe. Volvé a intentar la operación.',
    coincide: (error) => contiene(error.message, 'recibos.numero_recibo'),
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
