/**
 * Las reglas de la CONFIGURACIÓN del precio mayorista de un producto (spec 002,
 * §4.2), con sus textos.
 *
 * VIVE EN `shared` porque las dos capas tienen que decir lo mismo: el
 * formulario las revisa mientras se escribe, y el servicio de productos las
 * revisa antes de escribir. Con dos copias, tarde o temprano el formulario
 * dejaría pasar algo que el servicio rechaza —o al revés—, y quien carga el
 * catálogo vería un mensaje distinto según por dónde entró. **El texto de cada
 * rechazo existe una sola vez, acá.**
 *
 * La base de datos hace cumplir las mismas cuatro reglas con CHECK (migración
 * 039): esta función existe para decirlas con palabras antes de llegar ahí.
 *
 *   R1  Van juntos: el precio y la cantidad mínima, los dos o ninguno.
 *   R2  El precio es un monto válido y no negativo.
 *   R3  El precio es ESTRICTAMENTE menor que el precio de lista.
 *   R4  La cantidad mínima es una cantidad válida y estrictamente mayor que cero.
 *
 * SE REVISA SOBRE LOS VALORES REDONDEADOS, el precio a dos decimales y la
 * cantidad a tres, que es como se van a guardar. Así esta función decide lo
 * mismo que decidiría la base: un «9.999» contra una lista de Q10.00 se guarda
 * como 10.00, y 10.00 no es menor que 10.00.
 */

import type Decimal from 'decimal.js';

import {
  cantidadACadena,
  esEntradaDecimalValida,
  esMenorQue,
  esNegativo,
  esPositivo,
  formatearQuetzales,
  montoACadena,
  redondearCantidad,
  redondearMonto,
} from './money';

/** Los textos que ve quien carga el catálogo. Una sola vez, para las dos capas. */
export const MENSAJES_DEL_PRECIO_MAYORISTA = {
  faltaPrecio: 'Falta el precio mayorista.',
  faltaCantidad: 'Falta la cantidad mínima para el precio mayorista.',
  precioNoNumerico: 'El precio mayorista tiene que ser un número.',
  precioNegativo: 'El precio mayorista no puede ser negativo.',
  cantidadNoNumerica: 'La cantidad mínima para el precio mayorista tiene que ser un número.',
  cantidadNoPositiva: 'La cantidad mínima para el precio mayorista tiene que ser mayor que cero.',
} as const;

/**
 * R3, con los dos montos a la vista. Sirve igual para quien pone un mayorista
 * demasiado alto y para quien baja la lista por debajo del mayorista que ya
 * había: en los dos casos hay que bajar el mayorista o quitarlo.
 */
export function mensajeDeMayoristaNoMenorQueLista(precio: Decimal, lista: Decimal): string {
  return (
    `El precio mayorista (${formatearQuetzales(precio)}) tiene que ser menor que el precio ` +
    `de lista (${formatearQuetzales(lista)}). Bajá el precio mayorista o quitalo.`
  );
}

/** Lo que se revisa: el precio de lista y los dos datos del mayorista, como texto. */
export interface EntradaDelPrecioMayorista {
  readonly precioBase: string;
  /** `null` o vacío es «no viene». */
  readonly precioMayorista: string | null;
  /** `null` o vacío es «no viene». */
  readonly cantidadMinima: string | null;
  /**
   * `true` cuando la casilla «¿Aplica precio mayorista?» está marcada: entonces
   * los dos datos son obligatorios y dejarlos vacíos es un faltante, no «sin
   * mayorista».
   */
  readonly exigido?: boolean;
}

/** El precio mayorista ya revisado, redondeado como se va a guardar. */
export interface PrecioMayoristaRevisado {
  readonly precio: Decimal;
  readonly cantidadMinima: Decimal;
}

/** El resultado de revisar: la configuración (o ninguna), o el motivo del rechazo. */
export type RevisionDelPrecioMayorista =
  | { readonly ok: true; readonly mayorista: PrecioMayoristaRevisado | null }
  | { readonly ok: false; readonly mensaje: string; readonly causaTecnica: string };

function rechazo(mensaje: string, causaTecnica: string): RevisionDelPrecioMayorista {
  return { ok: false, mensaje, causaTecnica };
}

/**
 * Revisa la configuración del precio mayorista contra las reglas R1 a R4.
 *
 * Devuelve el PRIMER motivo, no todos: es el criterio del formulario de
 * producto, donde decir qué corregir ahora sirve más que una lista.
 *
 * R3 solo se revisa si el precio de lista es un número: si no lo es, el precio
 * de lista tiene su propia regla, que va antes (en el servicio y en el
 * formulario), y compararlo acá no tendría sentido.
 */
export function revisarPrecioMayorista(entrada: EntradaDelPrecioMayorista): RevisionDelPrecioMayorista {
  const textoDelPrecio = (entrada.precioMayorista ?? '').trim();
  const textoDeLaCantidad = (entrada.cantidadMinima ?? '').trim();
  const exigido = entrada.exigido ?? false;

  // ---- R1: los dos o ninguno ---------------------------------------------
  if (textoDelPrecio === '' && textoDeLaCantidad === '') {
    if (exigido) {
      return rechazo(MENSAJES_DEL_PRECIO_MAYORISTA.faltaPrecio, 'Casilla marcada sin precio ni cantidad mínima.');
    }
    return { ok: true, mayorista: null };
  }
  if (textoDelPrecio === '') {
    return rechazo(
      MENSAJES_DEL_PRECIO_MAYORISTA.faltaPrecio,
      `cantidad_minima_mayorista ${JSON.stringify(textoDeLaCantidad)} sin precio_mayorista.`,
    );
  }
  if (textoDeLaCantidad === '') {
    return rechazo(
      MENSAJES_DEL_PRECIO_MAYORISTA.faltaCantidad,
      `precio_mayorista ${JSON.stringify(textoDelPrecio)} sin cantidad_minima_mayorista.`,
    );
  }

  // ---- R2: un monto válido y no negativo ------------------------------------
  if (!esEntradaDecimalValida(textoDelPrecio)) {
    return rechazo(
      MENSAJES_DEL_PRECIO_MAYORISTA.precioNoNumerico,
      `precio_mayorista no numérico: ${JSON.stringify(textoDelPrecio)}`,
    );
  }
  const precio = redondearMonto(textoDelPrecio);
  if (esNegativo(precio)) {
    return rechazo(MENSAJES_DEL_PRECIO_MAYORISTA.precioNegativo, `precio_mayorista recibido: ${montoACadena(precio)}`);
  }

  // ---- R4: una cantidad válida y mayor que cero ------------------------------
  if (!esEntradaDecimalValida(textoDeLaCantidad)) {
    return rechazo(
      MENSAJES_DEL_PRECIO_MAYORISTA.cantidadNoNumerica,
      `cantidad_minima_mayorista no numérica: ${JSON.stringify(textoDeLaCantidad)}`,
    );
  }
  const cantidadMinima = redondearCantidad(textoDeLaCantidad);
  if (!esPositivo(cantidadMinima)) {
    return rechazo(
      MENSAJES_DEL_PRECIO_MAYORISTA.cantidadNoPositiva,
      `cantidad_minima_mayorista recibida (redondeada a tres decimales): ${cantidadACadena(cantidadMinima)}`,
    );
  }

  // ---- R3: estrictamente menor que la lista ----------------------------------
  const textoDeLaLista = entrada.precioBase.trim();
  if (esEntradaDecimalValida(textoDeLaLista)) {
    const lista = redondearMonto(textoDeLaLista);
    if (!esMenorQue(precio, lista)) {
      return rechazo(
        mensajeDeMayoristaNoMenorQueLista(precio, lista),
        `precio_mayorista ${montoACadena(precio)} no es menor que precio_base ${montoACadena(lista)}.`,
      );
    }
  }

  return { ok: true, mayorista: { precio, cantidadMinima } };
}
