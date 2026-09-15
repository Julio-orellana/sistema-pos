/**
 * Topes de descuento por defecto — HERRAMIENTA DE DESARROLLO, NO UNA MIGRACIÓN.
 *
 * POR QUÉ EXISTE. `limites_descuento` arranca vacía, y sin fila el tope de un
 * rol es CERO: el valor seguro, para que un olvido de configuración no se
 * convierta en un permiso. La consecuencia práctica es que en una instalación
 * recién montada **cualquier descuento pide el PIN de un administrador**, así
 * que no se puede probar el camino normal —descuento dentro del límite, sin
 * PIN— sin poner las filas a mano en la base.
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

/** Un tope a sembrar: a qué rol y con qué números. */
export interface TopeSembrado {
  readonly rol: Rol;
  /** Porcentaje máximo, cadena canónica de dos decimales. */
  readonly porcentaje: string;
  /** Monto fijo máximo en quetzales, cadena canónica de dos decimales. */
  readonly montoFijo: string;
}

/**
 * Los topes que siembra el guion, uno por rol.
 *
 * LOS DOS ROLES PASAN POR EL MISMO MECANISMO. No hay ninguna excepción por rol
 * en el código: un administrador no se salta la comprobación, simplemente tiene
 * un tope más alto. Es la misma forma que ya tomó el cierre de caja ajena
 * (§4.9), y evita el caso especial «salvo que sea administrador», que en este
 * proyecto ya costó una vuelta con la intercepción de `Cmd+Q`.
 *
 * SOBRE LOS NÚMEROS DEL ROL `administrativo`:
 *
 *   · **100 % es un techo honesto, no un número mágico.** Significa «puede
 *     descontar la venta entera», y el total ya tiene piso en cero
 *     (`totalConDescuento`). En la práctica un administrador nunca llega a
 *     autorizarse a sí mismo por la vía del porcentaje.
 *   · **Q1 000 en el monto fijo sí es una cifra redonda y provisional.** El
 *     esquema no tiene forma de decir «ilimitado» —las dos columnas son
 *     decimales NOT NULL con piso cero, y la ausencia de fila significa CERO,
 *     no infinito—, así que un tope sin límite habría que escribirlo como un
 *     número mágico enorme. Se prefirió una cifra legible, que además casi
 *     nunca es la que topa porque el porcentaje ya llega al 100 %.
 *
 * ADVERTENCIA QUE HAY QUE REVISAR, NO OLVIDAR: **este tope asume que el rol
 * `administrativo` lo tiene el DUEÑO del negocio.** Si algún día se le asigna a
 * un empleado de confianza que no es Jimmy, un tope del 100 % le da la
 * capacidad de regalar mercadería sin que nadie más se entere, y el número
 * correcto pasa a ser otro. Eso depende del punto 6 de §6.2, que sigue abierto:
 * qué roles existen de verdad en la tienda.
 */
export const TOPES_SEMBRADOS: readonly TopeSembrado[] = [
  // Valores de prueba, no una definición del negocio.
  { rol: 'venta', porcentaje: '10.00', montoFijo: '20.00' },
  { rol: 'administrativo', porcentaje: '100.00', montoFijo: '1000.00' },
];

/** Qué pasó con el tope de un rol. */
export interface TopeAplicado {
  readonly rol: Rol;
  /** `true` si ya había una fila para ese rol y se reemplazó. */
  readonly reemplazo: boolean;
  readonly limite: LimiteDescuento;
}

/** Qué hizo el guion, para poder comparar lo esperado contra lo real. */
export interface InformeDeLimites {
  readonly aplicados: readonly TopeAplicado[];
}

/** Qué borró la limpieza. */
export interface InformeDeLimpiezaDeLimites {
  /** Los roles a los que sí había algo que quitarles. */
  readonly borrados: readonly Rol[];
}

/**
 * Siembra el tope de cada rol.
 *
 * `fijar` del repositorio ya reemplaza la fila si existe —hay un único límite
 * vigente por rol, garantizado por el UNIQUE de la columna—, así que correr
 * esto dos veces deja el mismo resultado y no duplica nada.
 *
 * `editadoPor` queda en `null` a propósito: lo puso un guion de desarrollo, no
 * una persona, y anotar el id de un administrador diría en la base que él tomó
 * esta decisión.
 */
export function sembrarLimitesDeDescuento(repositorios: Repositorios): InformeDeLimites {
  const aplicados = TOPES_SEMBRADOS.map((tope): TopeAplicado => {
    const anterior = repositorios.limitesDescuento.obtenerPorRol(tope.rol);
    const limite = repositorios.limitesDescuento.fijar({
      rol: tope.rol,
      descuentoMaxPorcentaje: tope.porcentaje,
      descuentoMaxMontoFijo: tope.montoFijo,
      editadoPor: null,
    });
    return { rol: tope.rol, reemplazo: anterior !== null, limite };
  });

  return { aplicados };
}

/**
 * Quita los topes sembrados y devuelve los roles a su estado de fábrica: sin
 * fila, y por lo tanto con tope cero.
 *
 * Borra físicamente, igual que la limpieza del catálogo de ejemplo y por la
 * misma razón: estas filas no tienen historial que proteger. Lo que sí queda es
 * el rastro de las ventas que se hicieron mientras estuvieron puestas, que
 * viven en `ventas` y en `auditoria_log` y no se tocan.
 */
export function limpiarLimitesDeDescuento(
  repositorios: Repositorios,
): InformeDeLimpiezaDeLimites {
  const borrados = TOPES_SEMBRADOS.filter((tope) =>
    repositorios.limitesDescuento.borrarPorRol(tope.rol),
  ).map((tope) => tope.rol);

  return { borrados };
}

/** El tope de cada rol tal como está ahora, para imprimirlo en el informe. */
export function topesActuales(repositorios: Repositorios): readonly LimiteDescuento[] {
  return repositorios.limitesDescuento.listar();
}
