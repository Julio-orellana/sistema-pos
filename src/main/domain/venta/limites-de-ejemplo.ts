/**
 * Límite de descuento por defecto — HERRAMIENTA DE DESARROLLO, NO UNA MIGRACIÓN.
 *
 * POR QUÉ EXISTE. `limites_descuento` arranca vacía, y sin fila el tope de un
 * rol es CERO: el valor seguro, para que un olvido de configuración no se
 * convierta en un permiso. La consecuencia práctica es que en una instalación
 * recién montada **cualquier descuento pide el PIN de un administrador**, así
 * que no se puede probar el camino normal —descuento dentro del límite, sin
 * PIN— sin poner una fila a mano en la base.
 *
 * POR QUÉ NO ES UNA MIGRACIÓN, que es la confusión probable: una migración es
 * historial permanente del esquema, se aplica una vez y no se deshace. Un tope
 * de descuento es CONFIGURACIÓN del negocio, la cambia un administrador cuando
 * quiere, y sembrarla en una migración dejaría el valor de este guion metido
 * para siempre en la base de la tienda. Mismo criterio que el catálogo de
 * ejemplo (`datos-de-ejemplo.ts`).
 *
 * ESTO NO REEMPLAZA LA PANTALLA DE CONFIGURACIÓN, que todavía no existe y es un
 * pendiente propio (CLAUDE.md §6.2, punto 15). Es un andamio para poder probar
 * el módulo de descuentos mientras tanto.
 *
 * Se usa con `npm run seed:limites` y `npm run seed:limites:limpiar`.
 */

import type { Repositorios } from '@main/database/repositories';
import type { LimiteDescuento, Rol } from '@main/database/repositories/entidades';

/**
 * El tope que se siembra, y para qué rol.
 *
 * SOLO SE TOCA EL ROL `venta`, y es deliberado. Cuánto puede descontar un
 * administrador sin autorizarse a sí mismo es una definición de negocio que
 * Jimmy no confirmó, y ponerle un número acá se la atribuiría. Mientras no haya
 * fila, su tope es cero y cualquier descuento que pida necesita autorización,
 * que es el comportamiento seguro.
 */
export const ROL_SEMBRADO: Rol = 'venta';

/** 10 % de la venta. Valor de prueba, no una definición del negocio. */
export const PORCENTAJE_POR_DEFECTO = '10.00';

/** Q20 fijos. Valor de prueba, no una definición del negocio. */
export const MONTO_FIJO_POR_DEFECTO = '20.00';

/** Qué hizo el guion, para poder comparar lo esperado contra lo real. */
export interface InformeDeLimites {
  /** `true` si ya había una fila para ese rol y se reemplazó. */
  readonly reemplazo: boolean;
  readonly limite: LimiteDescuento;
}

/** Qué borró la limpieza. */
export interface InformeDeLimpiezaDeLimites {
  /** `true` si había una fila que borrar. */
  readonly borro: boolean;
}

/**
 * Siembra el tope del rol de venta.
 *
 * `fijar` del repositorio ya reemplaza la fila si existe —hay un único límite
 * vigente por rol, garantizado por el UNIQUE de la columna—, así que correr
 * esto dos veces deja el mismo resultado y no duplica nada.
 *
 * `editadoPor` queda en `null` a propósito: lo puso un guion de desarrollo, no
 * una persona, y anotar el id de un administrador diría en la base que él tomó
 * esta decisión.
 */
export function sembrarLimiteDeDescuento(repositorios: Repositorios): InformeDeLimites {
  const anterior = repositorios.limitesDescuento.obtenerPorRol(ROL_SEMBRADO);

  const limite = repositorios.limitesDescuento.fijar({
    rol: ROL_SEMBRADO,
    descuentoMaxPorcentaje: PORCENTAJE_POR_DEFECTO,
    descuentoMaxMontoFijo: MONTO_FIJO_POR_DEFECTO,
    editadoPor: null,
  });

  return { reemplazo: anterior !== null, limite };
}

/**
 * Quita el tope sembrado y devuelve el rol a su estado de fábrica: sin fila, y
 * por lo tanto con tope cero.
 *
 * Borra físicamente, igual que la limpieza del catálogo de ejemplo y por la
 * misma razón: esta fila no tiene historial que proteger. Lo que sí queda es el
 * rastro de las ventas que se hicieron mientras estuvo puesta, que viven en
 * `ventas` y en `auditoria_log` y no se tocan.
 */
export function limpiarLimiteDeDescuento(
  repositorios: Repositorios,
): InformeDeLimpiezaDeLimites {
  const existente = repositorios.limitesDescuento.obtenerPorRol(ROL_SEMBRADO);
  if (existente === null) {
    return { borro: false };
  }
  repositorios.limitesDescuento.borrarPorRol(ROL_SEMBRADO);
  return { borro: true };
}

/** El tope de cada rol tal como está ahora, para imprimirlo en el informe. */
export function topesActuales(repositorios: Repositorios): readonly LimiteDescuento[] {
  return repositorios.limitesDescuento.listar();
}
