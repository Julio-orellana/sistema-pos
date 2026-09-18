/**
 * Cómo viaja un producto a la cuadrícula de la pantalla de venta.
 *
 * Vive aparte de `venta.ts` para poder probarlo sin Electron: la prueba que
 * compara lo que la pantalla muestra con lo que el cobro guarda (spec 002,
 * CA-13) tiene que alimentar al ticket con EXACTAMENTE el DTO que manda el
 * proceso principal, no con una copia armada a mano en la prueba.
 *
 * El precio efectivo se resuelve acá, del lado del proceso principal, y no en
 * la pantalla: la ventana no tiene por qué saber la regla de vigencia de un
 * precio especial, y si la supiera podría equivocarse en silencio y mostrar un
 * precio que ya venció. Lo que SÍ viaja para que la pantalla decida sola es el
 * precio mayorista, porque depende de la cantidad y la cantidad cambia en cada
 * tecla (spec 002, P9). Lo que se cobra lo vuelve a decidir `venta:cobrar`.
 */

import { cantidadACadena, montoACadena } from '@shared/money';
import type { ProductoParaVender } from '@shared/types/ipc';
import type { PrecioEspecial, Producto } from '@main/database/repositories/entidades';
import { precioEfectivoDe } from '@main/domain/venta/precios';

/** Arma el DTO de un producto activo para la cuadrícula de venta. */
export function productoParaVender(
  producto: Producto,
  vigentes: readonly PrecioEspecial[],
  categoriaNombre: string,
  fotoUrl: string | null,
): ProductoParaVender {
  const efectivo = precioEfectivoDe(producto.precioBase, vigentes);
  const especial = efectivo.especialAplicado;

  return {
    id: producto.id,
    nombre: producto.nombre,
    categoriaId: producto.categoriaId,
    categoriaNombre,
    tipoMedida: producto.tipoMedida,
    unidadPeso: producto.unidadPeso,
    cantidadPredefinidaIcono: cantidadACadena(producto.cantidadPredefinidaIcono),
    precioBase: montoACadena(producto.precioBase),
    precioEfectivo: montoACadena(efectivo.precio),
    precioEspecial:
      especial === null
        ? null
        : {
            id: especial.id,
            tipo: especial.tipo,
            valor: montoACadena(especial.valor),
            vigenteDesde: especial.vigenteDesde,
            vigenteHasta: especial.vigenteHasta,
          },
    mayorista:
      producto.mayorista === null
        ? null
        : {
            precio: montoACadena(producto.mayorista.precio),
            cantidadMinima: cantidadACadena(producto.mayorista.cantidadMinima),
          },
    inventarioDisponible: cantidadACadena(producto.inventarioDisponible),
    fotoUrl,
    contadorVentas: producto.contadorVentas,
  };
}
