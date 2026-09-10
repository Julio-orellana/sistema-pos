/**
 * Módulo de catálogo: productos.
 *
 * El repositorio ya sabía leer y escribir la tabla. Lo que vive aquí son las
 * reglas de negocio que no estaban en ninguna parte:
 *
 *   · un producto por peso EXIGE unidad; uno por unidad NO puede tenerla,
 *   · la cantidad predefinida del ícono es estrictamente mayor que cero,
 *   · el precio base no puede ser negativo,
 *   · un producto nunca se borra, solo se desactiva,
 *   · mover el inventario es una operación PROPIA, no un campo más de editar.
 *
 * TODO SE VALIDA ANTES DE TOCAR LA BASE. Las restricciones del esquema siguen
 * siendo la última red —y hay pruebas que lo comprueban—, pero un cajero o un
 * administrador no puede recibir "CHECK constraint failed: productos" como
 * respuesta a haber dejado un campo vacío. Cada regla tiene aquí su mensaje.
 *
 * SE PUEDE CAMBIAR `tipoMedida` DESPUÉS DE CREADO, a propósito: `venta_detalle`
 * guarda una foto del nombre, la unidad y el precio al momento de cada venta,
 * así que un cambio de hoy no altera un solo comprobante de ayer. Prohibirlo
 * obligaría a crear un producto nuevo por un error de carga y a arrastrar un
 * duplicado inútil en el catálogo.
 */

import type Decimal from 'decimal.js';

import {
  cantidadACadena,
  decimal,
  esEntradaDecimalValida,
  esNegativo,
  esPositivo,
  montoACadena,
  redondearCantidad,
  redondearMonto,
  sumar,
} from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import type {
  Producto,
  TipoMedida,
  UnidadPeso,
} from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeCategorias } from '@main/database/repositories/categorias';
import type { RepositorioDeProductos } from '@main/database/repositories/productos';

/** Acciones de producto que quedan en la bitácora de auditoría. */
export const ACCIONES_DE_PRODUCTO = {
  creado: 'producto_creado',
  editado: 'producto_editado',
  desactivado: 'producto_desactivado',
  reactivado: 'producto_reactivado',
  /**
   * Recepción de mercadería. Tiene su propio nombre de acción, distinto de
   * `producto_editado`, porque son hechos distintos del negocio: uno corrige
   * el catálogo y el otro dice que entró mercadería a la bodega.
   */
  inventarioAjustado: 'inventario_ajustado',
} as const;

/** Largo máximo del nombre de un producto. */
const LARGO_MAXIMO_DEL_NOMBRE = 80;

/** Largo máximo del motivo de un ajuste de inventario. */
const LARGO_MAXIMO_DEL_MOTIVO = 200;

/** Unidades de peso admitidas, para validar antes de llegar al CHECK. */
const UNIDADES_DE_PESO: readonly UnidadPeso[] = ['lb', 'kg'];

/** Tipos de medida admitidos. */
const TIPOS_DE_MEDIDA: readonly TipoMedida[] = ['unidad', 'peso'];

/** Datos con los que se crea o se edita un producto. */
export interface DatosDeProducto {
  readonly nombre: string;
  readonly categoriaId: string;
  readonly tipoMedida: TipoMedida;
  /** Obligatoria si `tipoMedida` es 'peso'; debe faltar si es 'unidad'. */
  readonly unidadPeso: UnidadPeso | null;
  readonly cantidadPredefinidaIcono: string;
  readonly precioBase: string;
  readonly fotoPath: string | null;
}

/** Datos de creación: los de edición más el saldo inicial de inventario. */
export interface DatosDeProductoNuevo extends DatosDeProducto {
  /** Puede ser 0: un producto se puede dar de alta antes de que llegue. */
  readonly inventarioInicial: string;
}

/** Una recepción de mercadería. */
export interface AjusteDeInventario {
  readonly productoId: string;
  /** Cantidad a SUMAR. Estrictamente positiva en este módulo. */
  readonly cantidad: string;
  /** Texto libre: "compra a proveedor X". Opcional. */
  readonly motivo?: string | null;
}

/** Resultado de una recepción de mercadería, para mostrarlo y auditarlo. */
export interface ResultadoDeAjuste {
  readonly producto: Producto;
  readonly cantidadAnterior: string;
  readonly cantidadAgregada: string;
  readonly cantidadNueva: string;
}

/** Los mismos datos ya normalizados y verificados. */
interface DatosVerificados {
  readonly nombre: string;
  readonly categoriaId: string;
  readonly tipoMedida: TipoMedida;
  readonly unidadPeso: UnidadPeso | null;
  readonly cantidadPredefinidaIcono: Decimal;
  readonly precioBase: Decimal;
  readonly fotoPath: string | null;
}

/** Dependencias del servicio. */
export interface DependenciasDeProductos {
  readonly productos: RepositorioDeProductos;
  readonly categorias: RepositorioDeCategorias;
  readonly auditoria: RepositorioDeAuditoria;
  readonly ahora?: () => number;
}

export class ServicioDeProductos {
  private readonly productos: RepositorioDeProductos;
  private readonly categorias: RepositorioDeCategorias;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeProductos) {
    this.productos = dependencias.productos;
    this.categorias = dependencias.categorias;
    this.auditoria = dependencias.auditoria;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  // -------------------------------------------------------------------------
  // Validación
  // -------------------------------------------------------------------------

  /** Convierte texto a Decimal, o falla con el nombre del campo en el mensaje. */
  private aDecimal(valor: string, campo: string): Decimal {
    if (!esEntradaDecimalValida(valor)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `${campo} tiene que ser un número.`,
        `valor no numérico en ${campo}: ${JSON.stringify(valor)}`,
      );
    }
    return decimal(valor);
  }

  /**
   * LA REGLA CENTRAL: coherencia entre tipo de medida y unidad de peso.
   *
   * Se comprueba aquí, antes de cualquier escritura, y no solo en el CHECK del
   * esquema. La base diría "CHECK constraint failed: productos" sin decir cuál
   * de sus doce restricciones falló; quien está cargando el catálogo tiene que
   * leer qué le falta.
   */
  private verificarCoherenciaDeMedida(
    tipoMedida: TipoMedida,
    unidadPeso: UnidadPeso | null,
  ): void {
    if (tipoMedida === 'peso' && unidadPeso === null) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Un producto que se vende por peso necesita una unidad: libras o kilogramos.',
        "tipo_medida='peso' sin unidad_peso.",
      );
    }
    if (tipoMedida === 'unidad' && unidadPeso !== null) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Un producto que se vende por unidad no lleva unidad de peso. Quitá la unidad o cambialo a venta por peso.',
        `tipo_medida='unidad' con unidad_peso='${unidadPeso}'.`,
      );
    }
  }

  /** Normaliza y valida todo lo que comparten crear y editar. */
  private verificar(datos: DatosDeProducto): DatosVerificados {
    const nombre = datos.nombre.trim();

    if (nombre.length === 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El producto necesita un nombre.',
        'nombre vacío o solo espacios.',
      );
    }
    if (nombre.length > LARGO_MAXIMO_DEL_NOMBRE) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El nombre del producto no puede pasar de ${String(LARGO_MAXIMO_DEL_NOMBRE)} caracteres.`,
        `nombre de ${String(nombre.length)} caracteres.`,
      );
    }

    if (!TIPOS_DE_MEDIDA.includes(datos.tipoMedida)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El tipo de medida tiene que ser "unidad" o "peso".',
        `tipo_medida recibido: ${JSON.stringify(datos.tipoMedida)}`,
      );
    }
    if (datos.unidadPeso !== null && !UNIDADES_DE_PESO.includes(datos.unidadPeso)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'La unidad de peso tiene que ser "lb" o "kg".',
        `unidad_peso recibida: ${JSON.stringify(datos.unidadPeso)}`,
      );
    }
    this.verificarCoherenciaDeMedida(datos.tipoMedida, datos.unidadPeso);

    // La categoría tiene que existir. Se admite una categoría DESACTIVADA solo
    // si el producto ya la tenía; eso lo comprueba quien llama, porque aquí no
    // se sabe si es alta o edición.
    const categoria = this.categorias.obtenerPorId(datos.categoriaId);
    if (categoria === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'Esa categoría no existe.',
        `categoria_id inexistente: ${datos.categoriaId}`,
      );
    }

    const cantidadIcono = redondearCantidad(
      this.aDecimal(datos.cantidadPredefinidaIcono, 'La cantidad del ícono'),
    );
    if (!esPositivo(cantidadIcono)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'La cantidad del ícono tiene que ser mayor que cero: un botón que agrega cero al carrito no hace nada.',
        `cantidad_predefinida_icono recibida: ${cantidadACadena(cantidadIcono)}`,
      );
    }

    const precio = redondearMonto(this.aDecimal(datos.precioBase, 'El precio'));
    if (esNegativo(precio)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        // Neutro a propósito: el 0 se acepta, pero POR QUÉ le sirve a la tienda
        // es una definición de negocio que Jimmy no confirmó. Un mensaje que
        // se la atribuya convierte una suposición nuestra en algo que parece
        // decidido por él.
        'El precio no puede ser negativo.',
        `precio_base recibido: ${montoACadena(precio)}`,
      );
    }

    return {
      nombre,
      categoriaId: datos.categoriaId,
      tipoMedida: datos.tipoMedida,
      unidadPeso: datos.unidadPeso,
      cantidadPredefinidaIcono: cantidadIcono,
      precioBase: precio,
      fotoPath: datos.fotoPath,
    };
  }

  /**
   * Comprueba que el nombre no lo tenga ya otro producto.
   *
   * Igual que en categorías, existe para dar el mensaje de negocio y para
   * poder avisar si el que lo ocupa está desactivado: el nombre "no aparece"
   * en pantalla pero sigue tomado por el UNIQUE de la tabla.
   */
  private exigirNombreLibre(nombre: string, exceptoId: string | null): void {
    const enConflicto = this.productos
      .listarTodos()
      .find(
        (producto) =>
          producto.id !== exceptoId &&
          producto.nombre.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'),
      );

    if (enConflicto === undefined) {
      return;
    }

    const aclaracion = enConflicto.activo
      ? ''
      : ' Ese producto está desactivado: reactivalo en vez de crear otro igual.';

    throw new ErrorDeNegocio(
      'REGISTRO_DUPLICADO',
      `Ya existe un producto llamado "${enConflicto.nombre}".${aclaracion}`,
      `nombre en conflicto con el producto ${enConflicto.id}.`,
    );
  }

  /** Busca un producto o falla con un mensaje de negocio. */
  private exigirProducto(id: string): Producto {
    const producto = this.productos.obtenerPorId(id);
    if (producto === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'Ese producto no existe.',
        `producto_id inexistente: ${id}`,
      );
    }
    return producto;
  }

  // -------------------------------------------------------------------------
  // Operaciones
  // -------------------------------------------------------------------------

  public crear(usuarioId: string, datos: DatosDeProductoNuevo): Producto {
    const verificados = this.verificar(datos);
    this.exigirNombreLibre(verificados.nombre, null);

    // Al dar de alta no se puede elegir una categoría retirada: si estuviera
    // desactivada, el producto nacería en un grupo que ya nadie mantiene.
    const categoria = this.categorias.obtenerPorId(verificados.categoriaId);
    if (categoria !== null && !categoria.activo) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `La categoría "${categoria.nombre}" está desactivada. Reactivala o elegí otra.`,
        `alta de producto contra la categoría desactivada ${categoria.id}.`,
      );
    }

    const inventarioInicial = redondearCantidad(
      this.aDecimal(datos.inventarioInicial, 'El inventario inicial'),
    );
    if (esNegativo(inventarioInicial)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El inventario inicial no puede ser negativo. Puede ser 0 si la mercadería todavía no llegó.',
        `inventario inicial recibido: ${cantidadACadena(inventarioInicial)}`,
      );
    }

    const creado = this.productos.crear({
      nombre: verificados.nombre,
      categoriaId: verificados.categoriaId,
      fotoPath: verificados.fotoPath,
      tipoMedida: verificados.tipoMedida,
      unidadPeso: verificados.unidadPeso,
      cantidadPredefinidaIcono: verificados.cantidadPredefinidaIcono,
      precioBase: verificados.precioBase,
      inventarioDisponible: inventarioInicial,
      activo: true,
    });

    this.auditoria.registrar({
      usuarioId,
      accion: ACCIONES_DE_PRODUCTO.creado,
      entidadTipo: 'productos',
      entidadId: creado.id,
      valorNuevo: {
        nombre: creado.nombre,
        categoriaId: creado.categoriaId,
        tipoMedida: creado.tipoMedida,
        unidadPeso: creado.unidadPeso,
        precioBase: montoACadena(creado.precioBase),
        inventarioInicial: cantidadACadena(creado.inventarioDisponible),
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return creado;
  }

  /**
   * Edita el catálogo de un producto. NO toca el inventario: para eso está
   * `ajustarInventario`, que deja su propio asiento.
   */
  public editar(usuarioId: string, id: string, datos: DatosDeProducto): Producto {
    const anterior = this.exigirProducto(id);
    const verificados = this.verificar(datos);
    this.exigirNombreLibre(verificados.nombre, id);

    // Al editar sí se admite una categoría desactivada, pero solo si es la que
    // el producto ya tenía: al retirar una categoría no se obliga a reclasificar
    // todo su catálogo antes de poder corregirle un precio.
    const categoria = this.categorias.obtenerPorId(verificados.categoriaId);
    if (
      categoria !== null &&
      !categoria.activo &&
      categoria.id !== anterior.categoriaId
    ) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `La categoría "${categoria.nombre}" está desactivada. Reactivala o elegí otra.`,
        `intento de mover el producto ${id} a la categoría desactivada ${categoria.id}.`,
      );
    }

    this.productos.actualizar(id, {
      nombre: verificados.nombre,
      categoriaId: verificados.categoriaId,
      fotoPath: verificados.fotoPath,
      tipoMedida: verificados.tipoMedida,
      unidadPeso: verificados.unidadPeso,
      cantidadPredefinidaIcono: verificados.cantidadPredefinidaIcono,
      precioBase: verificados.precioBase,
    });

    this.auditoria.registrar({
      usuarioId,
      accion: ACCIONES_DE_PRODUCTO.editado,
      entidadTipo: 'productos',
      entidadId: id,
      valorAnterior: {
        nombre: anterior.nombre,
        categoriaId: anterior.categoriaId,
        tipoMedida: anterior.tipoMedida,
        unidadPeso: anterior.unidadPeso,
        precioBase: montoACadena(anterior.precioBase),
        fotoPath: anterior.fotoPath,
      },
      valorNuevo: {
        nombre: verificados.nombre,
        categoriaId: verificados.categoriaId,
        tipoMedida: verificados.tipoMedida,
        unidadPeso: verificados.unidadPeso,
        precioBase: montoACadena(verificados.precioBase),
        fotoPath: verificados.fotoPath,
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return this.exigirProducto(id);
  }

  /**
   * Desactiva o reactiva. Nunca borra: `venta_detalle` referencia el producto,
   * y su historial de ventas tiene que seguir consultándose.
   */
  public fijarActivo(usuarioId: string, id: string, activo: boolean): Producto {
    const anterior = this.exigirProducto(id);

    if (anterior.activo === activo) {
      return anterior;
    }

    this.productos.fijarActivo(id, activo);

    this.auditoria.registrar({
      usuarioId,
      accion: activo ? ACCIONES_DE_PRODUCTO.reactivado : ACCIONES_DE_PRODUCTO.desactivado,
      entidadTipo: 'productos',
      entidadId: id,
      valorAnterior: { activo: anterior.activo },
      valorNuevo: {
        activo,
        nombre: anterior.nombre,
        // Se deja constancia de con cuánto inventario quedó guardado: un
        // producto retirado con saldo es mercadería que sigue en la bodega y
        // deja de poder venderse.
        inventarioAlDesactivar: cantidadACadena(anterior.inventarioDisponible),
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return this.exigirProducto(id);
  }

  /**
   * RECEPCIÓN DE MERCADERÍA. Suma al saldo del producto.
   *
   * Es una operación propia y no un campo de "editar producto" porque es un
   * hecho distinto del negocio —entró mercadería— y merece su propio asiento
   * de auditoría, con el saldo anterior, el nuevo y el motivo.
   *
   * SOLO SUMA. Las mermas, pérdidas y correcciones a la baja son un módulo
   * futuro con sus propias reglas de autorización: dejar que esta operación
   * aceptara negativos convertiría la recepción de mercadería en una vía para
   * bajar inventario sin controles. Un valor negativo se rechaza AQUÍ, con
   * mensaje claro, mucho antes de llegar al CHECK del esquema, que sigue
   * siendo la última red por si alguna vez algo se salta esta comprobación.
   */
  public ajustarInventario(usuarioId: string, ajuste: AjusteDeInventario): ResultadoDeAjuste {
    const producto = this.exigirProducto(ajuste.productoId);

    const cantidad = redondearCantidad(this.aDecimal(ajuste.cantidad, 'La cantidad'));

    if (!esPositivo(cantidad)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'La cantidad a ingresar tiene que ser mayor que cero. Este ajuste solo suma mercadería recibida; ' +
          'las mermas y pérdidas son otro módulo, todavía no disponible.',
        `cantidad de ajuste no positiva: ${cantidadACadena(cantidad)}`,
      );
    }

    const motivo = (ajuste.motivo ?? '').trim();
    if (motivo.length > LARGO_MAXIMO_DEL_MOTIVO) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El motivo no puede pasar de ${String(LARGO_MAXIMO_DEL_MOTIVO)} caracteres.`,
        `motivo de ${String(motivo.length)} caracteres.`,
      );
    }

    // Con Decimal, nunca con aritmética nativa: el inventario a granel lleva
    // tres decimales y `0.1 + 0.2` no da `0.3` en JavaScript.
    const anterior = producto.inventarioDisponible;
    const nuevoSaldo = redondearCantidad(sumar(anterior, cantidad));

    this.productos.fijarInventario(producto.id, nuevoSaldo);

    const resultado: ResultadoDeAjuste = {
      producto: this.exigirProducto(producto.id),
      cantidadAnterior: cantidadACadena(anterior),
      cantidadAgregada: cantidadACadena(cantidad),
      cantidadNueva: cantidadACadena(nuevoSaldo),
    };

    this.auditoria.registrar({
      usuarioId,
      accion: ACCIONES_DE_PRODUCTO.inventarioAjustado,
      entidadTipo: 'productos',
      entidadId: producto.id,
      valorAnterior: { inventarioDisponible: resultado.cantidadAnterior },
      valorNuevo: {
        nombre: producto.nombre,
        inventarioDisponible: resultado.cantidadNueva,
        cantidadAgregada: resultado.cantidadAgregada,
        motivo: motivo.length === 0 ? null : motivo,
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return resultado;
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  /** Para la pantalla de administración: activos e inactivos. */
  public listarTodos(): readonly Producto[] {
    return this.productos.listarTodos();
  }

  /** Para la pantalla de venta: solo lo que se puede vender hoy. */
  public listarActivos(): readonly Producto[] {
    return this.productos.listarActivos();
  }

  /**
   * Lo mismo, pero EN EL ORDEN DE LA CUADRÍCULA de venta: los más vendidos
   * primero, con el nombre como desempate determinista.
   */
  public listarParaVenta(): readonly Producto[] {
    return this.productos.listarParaVenta();
  }

  public obtener(id: string): Producto {
    return this.exigirProducto(id);
  }
}
