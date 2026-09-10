/**
 * El ticket de venta EN MEMORIA.
 *
 * ESTE MÓDULO NO PERSISTE NADA. Arma y edita el carrito mientras el cajero lo
 * construye; el registro de la venta —con su transacción, el descuento atómico
 * de inventario y el reparto de centavos del comprobante— llega en su propio
 * módulo. Aquí no hay ni un `window.pos`.
 *
 * TODO SE CALCULA CON DECIMAL, nunca con aritmética nativa: un ticket de tres
 * pesadas a Q0.67 la libra descuadra el corte de caja si se suma con `number`.
 * Las cantidades y los precios entran y salen como CADENA canónica, que es la
 * misma forma en que viajan por IPC y en que se guardan.
 *
 * Las funciones son puras y devuelven arreglos nuevos: así la pantalla no
 * puede mutar el ticket por accidente y las pruebas no necesitan un DOM.
 */

import type Decimal from 'decimal.js';

import {
  CERO,
  cantidadACadena,
  decimal,
  esMayorQue,
  montoACadena,
  multiplicar,
  redondearCantidad,
  redondearMonto,
  sumar,
  sumarLista,
} from '@shared/money';
import { montoDelDescuento, totalConDescuento, type DescuentoPedido } from '@shared/descuento';
import type { PrecioEspecialVigente, ProductoParaVender } from '@shared/types/ipc';

/**
 * Una línea del ticket.
 *
 * `precioUnitario` es una FOTO del precio al momento de agregar el producto,
 * no una referencia viva: si alguien edita el precio en otra pantalla mientras
 * el cliente espera, el ticket en curso no debe cambiar bajo los pies del
 * cajero. Es el mismo criterio con que `venta_detalle` guarda su snapshot.
 */
export interface LineaDeTicket {
  readonly productoId: string;
  readonly nombre: string;
  readonly tipoMedida: 'unidad' | 'peso';
  readonly unidadPeso: 'lb' | 'kg' | null;
  /** Cantidad, cadena canónica de tres decimales. */
  readonly cantidad: string;
  /**
   * Precio unitario congelado, YA CON EL PRECIO ESPECIAL APLICADO. Cadena
   * canónica de dos decimales. Es por este que se cobra.
   */
  readonly precioUnitario: string;
  /** Precio de lista, para poder mostrar de cuánto bajó. */
  readonly precioBase: string;
  /** El precio especial que rebajó la línea, o `null` si se cobra el de lista. */
  readonly precioEspecial: PrecioEspecialVigente | null;
  /** Inventario conocido al cargar la pantalla. Solo para advertir. */
  readonly inventarioConocido: string;
  readonly fotoUrl: string | null;
}

/** Cómo se nombra la unidad de una línea en pantalla. */
export function unidadDe(linea: LineaDeTicket): string {
  if (linea.tipoMedida === 'peso') {
    return linea.unidadPeso ?? '';
  }
  return Number(linea.cantidad) === 1 ? 'unidad' : 'unidades';
}

/** Cuántos decimales admite la cantidad de este producto. */
export function decimalesDe(tipoMedida: 'unidad' | 'peso'): number {
  // Tres para el peso, el mismo límite que rige en todo el sistema; cero para
  // lo que se vende por unidad, donde media docena se pide como seis huevos.
  const DECIMALES_DE_PESO = 3;
  return tipoMedida === 'peso' ? DECIMALES_DE_PESO : 0;
}

/**
 * Agrega un producto al ticket.
 *
 * Si el producto YA ESTÁ, suma la cantidad predefinida a la línea existente en
 * vez de crear una segunda. Dos líneas del mismo producto obligarían al cajero
 * a sumarlas de cabeza para saber cuánto lleva el cliente, y al comprobante a
 * imprimir el mismo renglón dos veces.
 */
export function agregarAlTicket(
  lineas: readonly LineaDeTicket[],
  producto: ProductoParaVender,
): LineaDeTicket[] {
  const existente = lineas.find((linea) => linea.productoId === producto.id);

  if (existente === undefined) {
    return [
      ...lineas,
      {
        productoId: producto.id,
        nombre: producto.nombre,
        tipoMedida: producto.tipoMedida,
        unidadPeso: producto.unidadPeso,
        cantidad: cantidadACadena(producto.cantidadPredefinidaIcono),
        // El EFECTIVO, no el de lista: si hay un precio especial vigente, el
        // cliente paga ese. El de lista se guarda al lado solo para mostrarlo.
        precioUnitario: montoACadena(producto.precioEfectivo),
        precioBase: montoACadena(producto.precioBase),
        precioEspecial: producto.precioEspecial,
        inventarioConocido: cantidadACadena(producto.inventarioDisponible),
        fotoUrl: producto.fotoUrl,
      },
    ];
  }

  const sumada = redondearCantidad(
    sumar(existente.cantidad, producto.cantidadPredefinidaIcono),
  );
  return lineas.map((linea) =>
    linea.productoId === producto.id
      ? { ...linea, cantidad: cantidadACadena(sumada) }
      : linea,
  );
}

/**
 * Fija la cantidad exacta de una línea, tal como quedó en el teclado.
 *
 * No suma: reemplaza. Es la operación de "corregir lo que pesé", distinta de
 * volver a tocar el ícono.
 */
export function fijarCantidad(
  lineas: readonly LineaDeTicket[],
  productoId: string,
  cantidad: string,
): LineaDeTicket[] {
  const redondeada = redondearCantidad(decimal(cantidad));
  return lineas.map((linea) =>
    linea.productoId === productoId
      ? { ...linea, cantidad: cantidadACadena(redondeada) }
      : linea,
  );
}

/** Quita una línea completa del ticket. */
export function quitarDelTicket(
  lineas: readonly LineaDeTicket[],
  productoId: string,
): LineaDeTicket[] {
  return lineas.filter((linea) => linea.productoId !== productoId);
}

/**
 * Subtotal de una línea: cantidad × precio unitario.
 *
 * NO se redondea acá. La política del proyecto es redondeo único al final, así
 * que el valor exacto se conserva y solo se redondea al mostrarlo o al sumarlo
 * en el total. Tres pesadas de 0.5 lb a Q0.67 valen Q0.335 cada una: redondear
 * línea por línea le cobraría un centavo de más al cliente.
 */
export function subtotalExactoDeLinea(linea: LineaDeTicket): Decimal {
  return multiplicar(linea.cantidad, linea.precioUnitario);
}

/** El subtotal de la línea tal como se imprime, redondeado una sola vez. */
export function subtotalDeLineaParaMostrar(linea: LineaDeTicket): string {
  return montoACadena(redondearMonto(subtotalExactoDeLinea(linea)));
}

/**
 * Total del ticket: la suma de los subtotales EXACTOS, redondeada una vez.
 *
 * Sumar los subtotales ya redondeados daría un total distinto en cuanto
 * aparezcan medios centavos, y sería el cliente quien pagara la diferencia.
 */
export function totalDelTicket(lineas: readonly LineaDeTicket[]): Decimal {
  if (lineas.length === 0) {
    return CERO;
  }
  return redondearMonto(sumarLista(lineas.map(subtotalExactoDeLinea)));
}

/** El total, como cadena canónica lista para mostrar. */
export function totalDelTicketParaMostrar(lineas: readonly LineaDeTicket[]): string {
  return montoACadena(totalDelTicket(lineas));
}

/** La suma de los subtotales EXACTOS, sin redondear y sin descuento. */
export function subtotalExactoDelTicket(lineas: readonly LineaDeTicket[]): Decimal {
  if (lineas.length === 0) {
    return CERO;
  }
  return sumarLista(lineas.map(subtotalExactoDeLinea));
}

/**
 * Cuánto rebaja el descuento discrecional sobre este ticket.
 *
 * Se calcula con la MISMA función que usa el proceso principal al cobrar
 * (`@shared/descuento`), no con una copia: si fueran dos implementaciones, el
 * número que ve el cajero podría no ser el que termina cobrándose.
 */
export function descuentoDelTicket(
  lineas: readonly LineaDeTicket[],
  descuento: DescuentoPedido | null,
): Decimal {
  if (descuento === null) {
    return CERO;
  }
  return montoDelDescuento(subtotalExactoDelTicket(lineas), descuento);
}

/** El total con el descuento aplicado, redondeado una sola vez. */
export function totalDelTicketConDescuento(
  lineas: readonly LineaDeTicket[],
  descuento: DescuentoPedido | null,
): Decimal {
  if (lineas.length === 0) {
    return CERO;
  }
  return totalConDescuento(subtotalExactoDelTicket(lineas), descuento);
}

/** ¿Alguna línea se está cobrando con un precio especial vigente? */
export function hayPrecioEspecial(lineas: readonly LineaDeTicket[]): boolean {
  return lineas.some((linea) => linea.precioEspecial !== null);
}

/**
 * Cómo se describe un precio especial en el ticket: «10 % menos», «Q2 menos».
 *
 * Dice CUÁNTO BAJÓ y no el nombre de la promoción, porque no hay ninguno: la
 * tabla `precios_especiales` guarda un tipo y un valor, no una etiqueta. Poner
 * un texto inventado le atribuiría a la tienda una promoción con nombre que
 * nadie configuró.
 */
export function descripcionDePrecioEspecial(especial: PrecioEspecialVigente): string {
  if (especial.tipo === 'porcentaje') {
    return `${cantidadLegible(especial.valor)} % menos`;
  }
  return `Q${cantidadLegible(especial.valor)} menos`;
}

/** Cuántas unidades de producto distintas lleva el ticket. */
export function cantidadDeLineas(lineas: readonly LineaDeTicket[]): number {
  return lineas.length;
}

/**
 * ¿La cantidad pedida supera el inventario que se conocía al abrir la pantalla?
 *
 * ADVERTENCIA DE INTERFAZ SOLAMENTE, NO ES LA FUENTE DE VERDAD. El saldo que
 * se compara acá es una foto tomada al cargar la pantalla: mientras el cajero
 * arma el ticket, ese número puede haber cambiado. La comprobación que
 * realmente impide vender más de lo que hay es el piso `>= 0` de la base,
 * aplicado dentro de la transacción atómica que registra la venta —ver
 * CLAUDE.md §4.3—, y esa todavía no existe: llega en el módulo de registro de
 * venta.
 *
 * Por eso esto NO bloquea la edición: avisa. Bloquear con un dato que puede
 * estar viejo impediría vender mercadería que sí está en la bodega.
 */
export function excedeInventarioConocido(linea: LineaDeTicket): boolean {
  return esMayorQue(linea.cantidad, linea.inventarioConocido);
}

/** Texto del aviso de inventario, o `null` si no hay nada que advertir. */
export function avisoDeInventario(linea: LineaDeTicket): string | null {
  if (!excedeInventarioConocido(linea)) {
    return null;
  }
  // Legible, no canónica: «Solo hay 8 lb» y no «Solo hay 8.000 lb». El aviso
  // lo lee un cajero apurado, no un auditor revisando la base.
  const disponible = cantidadLegible(linea.inventarioConocido);
  return `Solo hay ${disponible} ${unidadDe(linea)} en el inventario registrado.`;
}

/**
 * La cantidad tal como se lee en el mostrador: sin ceros decorativos.
 *
 * La forma canónica lleva siempre tres decimales porque así se guarda y así
 * viaja, pero «1.000 lb» en un ícono es ruido: se muestra «1 lb». Los
 * decimales que SÍ significan algo se conservan enteros: 0.500 se muestra
 * como 0.5, no como 0.
 */
export function cantidadLegible(valor: string): string {
  const canonica = cantidadACadena(valor);
  if (!canonica.includes('.')) {
    return canonica;
  }
  return canonica.replace(/\.?0+$/, '');
}

/** Cómo se describe la cantidad predefinida de un producto en su ícono. */
export function descripcionDeCantidad(producto: ProductoParaVender): string {
  const cantidad = cantidadLegible(producto.cantidadPredefinidaIcono);
  if (producto.tipoMedida === 'peso') {
    return `${cantidad} ${producto.unidadPeso ?? ''} · a granel`;
  }
  return `${cantidad} ${Number(cantidad) === 1 ? 'unidad' : 'unidades'}`;
}
