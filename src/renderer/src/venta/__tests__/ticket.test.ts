/**
 * Pruebas del ticket de venta en memoria.
 *
 * Lo que se verifica acá es lo que el cajero ve mientras arma la venta con un
 * cliente enfrente: que tocar dos veces el mismo producto no duplique la
 * línea, que el total sea exacto al centavo, y que el aviso de inventario
 * avise sin estorbar. Nada de esto toca la base de datos.
 */

import { describe, expect, it } from 'vitest';

import type { ProductoParaVender } from '@shared/types/ipc';
import { montoACadena, sumarLista, multiplicar, redondearMonto } from '@shared/money';
import {
  agregarAlTicket,
  avisoDeInventario,
  cantidadLegible,
  decimalesDe,
  descripcionDeCantidad,
  excedeInventarioConocido,
  fijarCantidad,
  quitarDelTicket,
  subtotalDeLineaParaMostrar,
  totalDelTicketParaMostrar,
  unidadDe,
  type LineaDeTicket,
} from '../ticket';

/** Un producto por peso: maíz a Q0.67 la libra, con el ícono de media libra. */
const MAIZ: ProductoParaVender = {
  id: 'p-maiz',
  nombre: 'Maíz blanco',
  categoriaId: 'c-granos',
  categoriaNombre: 'Granos',
  tipoMedida: 'peso',
  unidadPeso: 'lb',
  cantidadPredefinidaIcono: '0.500',
  precioBase: '0.67',
  inventarioDisponible: '8.000',
  fotoUrl: null,
  contadorVentas: 0,
};

/** Un producto por unidad: cartón de huevos. */
const HUEVOS: ProductoParaVender = {
  id: 'p-huevos',
  nombre: 'Huevos, cartón de 30',
  categoriaId: 'c-huevos',
  categoriaNombre: 'Huevos',
  tipoMedida: 'unidad',
  unidadPeso: null,
  cantidadPredefinidaIcono: '1.000',
  precioBase: '42.00',
  inventarioDisponible: '24.000',
  fotoUrl: null,
  contadorVentas: 0,
};

/** Suma los subtotales exactos a mano, para contrastar con el total. */
function totalCalculadoAMano(lineas: readonly LineaDeTicket[]): string {
  return montoACadena(
    redondearMonto(
      sumarLista(lineas.map((linea) => multiplicar(linea.cantidad, linea.precioUnitario))),
    ),
  );
}

// ===========================================================================
describe('Agregar productos al ticket', () => {
  it('el primer toque crea una línea con la cantidad predefinida del ícono', () => {
    const [linea] = agregarAlTicket([], MAIZ);

    expect(linea?.productoId).toBe('p-maiz');
    expect(linea?.cantidad).toBe('0.500');
    expect(linea?.precioUnitario).toBe('0.67');
  });

  it('TOCAR DE NUEVO EL MISMO PRODUCTO SUMA, no crea una segunda línea', () => {
    // Dos líneas del mismo producto obligarían al cajero a sumarlas de cabeza
    // para saber cuánto lleva el cliente.
    const ticket = agregarAlTicket(agregarAlTicket([], MAIZ), MAIZ);

    expect(ticket).toHaveLength(1);
    expect(ticket[0]?.cantidad).toBe('1.000');
  });

  it('cinco toques suman cinco veces la cantidad predefinida', () => {
    let ticket = agregarAlTicket([], MAIZ);
    for (let toque = 0; toque < 4; toque += 1) {
      ticket = agregarAlTicket(ticket, MAIZ);
    }

    expect(ticket).toHaveLength(1);
    expect(ticket[0]?.cantidad).toBe('2.500');
  });

  it('productos distintos SÍ son líneas distintas', () => {
    const ticket = agregarAlTicket(agregarAlTicket([], MAIZ), HUEVOS);

    expect(ticket).toHaveLength(2);
    expect(ticket.map((linea) => linea.productoId)).toEqual(['p-maiz', 'p-huevos']);
  });

  it('el precio de la línea es una FOTO: no cambia si el catálogo cambia', () => {
    const ticket = agregarAlTicket([], MAIZ);
    const conOtroPrecio: ProductoParaVender = { ...MAIZ, precioBase: '9.99' };

    // El segundo toque suma cantidad pero NO repisa el precio congelado: el
    // ticket en curso no puede cambiar bajo los pies del cajero.
    const despues = agregarAlTicket(ticket, conOtroPrecio);
    expect(despues[0]?.precioUnitario).toBe('0.67');
  });

  it('no muta el arreglo que recibe', () => {
    const original = agregarAlTicket([], MAIZ);
    agregarAlTicket(original, HUEVOS);

    expect(original).toHaveLength(1);
  });
});

// ===========================================================================
describe('Corregir la cantidad de una línea', () => {
  it('REEMPLAZA la cantidad, no la suma', () => {
    const ticket = fijarCantidad(agregarAlTicket([], MAIZ), 'p-maiz', '3');

    expect(ticket[0]?.cantidad).toBe('3.000');
  });

  it('conserva los tres decimales de un peso', () => {
    const ticket = fijarCantidad(agregarAlTicket([], MAIZ), 'p-maiz', '1.256');
    expect(ticket[0]?.cantidad).toBe('1.256');
  });

  it('no toca las demás líneas', () => {
    const ticket = fijarCantidad(
      agregarAlTicket(agregarAlTicket([], MAIZ), HUEVOS),
      'p-maiz',
      '2',
    );

    expect(ticket[1]?.cantidad).toBe('1.000');
  });
});

// ===========================================================================
describe('Quitar líneas', () => {
  it('quita solo la línea indicada', () => {
    const ticket = quitarDelTicket(
      agregarAlTicket(agregarAlTicket([], MAIZ), HUEVOS),
      'p-maiz',
    );

    expect(ticket).toHaveLength(1);
    expect(ticket[0]?.productoId).toBe('p-huevos');
  });

  it('quitar algo que no está no rompe nada', () => {
    const ticket = agregarAlTicket([], MAIZ);
    expect(quitarDelTicket(ticket, 'no-existe')).toHaveLength(1);
  });
});

// ===========================================================================
describe('El total se calcula con Decimal y coincide con la suma manual', () => {
  it('un caso simple: un cartón de huevos', () => {
    const ticket = agregarAlTicket([], HUEVOS);

    expect(totalDelTicketParaMostrar(ticket)).toBe('42.00');
    expect(totalDelTicketParaMostrar(ticket)).toBe(totalCalculadoAMano(ticket));
  });

  it('TRES PESADAS DE MEDIA LIBRA A Q0.67: el total es Q1.01, no Q1.02', () => {
    // Es el caso que da nombre a la política de redondeo único al final. Cada
    // pesada vale Q0.335: redondeando línea por línea el cliente pagaría un
    // centavo de más.
    let ticket = agregarAlTicket([], MAIZ);
    ticket = agregarAlTicket(ticket, MAIZ);
    ticket = agregarAlTicket(ticket, MAIZ);
    // Tres toques de 0.5 lb dan una sola línea de 1.5 lb.
    expect(ticket[0]?.cantidad).toBe('1.500');
    expect(totalDelTicketParaMostrar(ticket)).toBe('1.01');
  });

  it('con decimales feos, el total sigue coincidiendo con la suma manual', () => {
    let ticket = agregarAlTicket([], MAIZ);
    ticket = fijarCantidad(ticket, 'p-maiz', '1.333');
    ticket = agregarAlTicket(ticket, HUEVOS);
    ticket = fijarCantidad(ticket, 'p-huevos', '7');

    // 1.333 × 0.67 = 0.89311  ·  7 × 42.00 = 294.00  →  294.89311 → 294.89
    expect(totalDelTicketParaMostrar(ticket)).toBe('294.89');
    expect(totalDelTicketParaMostrar(ticket)).toBe(totalCalculadoAMano(ticket));
  });

  it('otro caso incómodo: 0.001 lb de un producto caro', () => {
    let ticket = agregarAlTicket([], MAIZ);
    ticket = fijarCantidad(ticket, 'p-maiz', '0.001');

    // 0.001 × 0.67 = 0.00067, que redondea a 0.00. El total no inventa un
    // centavo que nadie va a cobrar.
    expect(totalDelTicketParaMostrar(ticket)).toBe('0.00');
  });

  it('el ticket vacío vale cero, no rompe', () => {
    expect(totalDelTicketParaMostrar([])).toBe('0.00');
  });

  it('con muchas líneas el total sigue siendo exacto', () => {
    let ticket: readonly LineaDeTicket[] = [];
    const cantidades = ['0.333', '1.667', '2.125', '0.875', '3.001'];
    for (const [indice, cantidad] of cantidades.entries()) {
      const producto: ProductoParaVender = {
        ...MAIZ,
        id: `p-${String(indice)}`,
        nombre: `Producto ${String(indice)}`,
        precioBase: '3.33',
      };
      ticket = fijarCantidad(agregarAlTicket(ticket, producto), producto.id, cantidad);
    }

    expect(ticket).toHaveLength(5);
    expect(totalDelTicketParaMostrar(ticket)).toBe(totalCalculadoAMano(ticket));
  });

  it('el subtotal MOSTRADO de una línea se redondea una sola vez', () => {
    const ticket = fijarCantidad(agregarAlTicket([], MAIZ), 'p-maiz', '0.500');
    // 0.5 × 0.67 = 0.335 → se muestra 0.34 (HALF_UP), pero el total no usa
    // ese valor redondeado para sumar.
    expect(subtotalDeLineaParaMostrar(ticket[0]!)).toBe('0.34');
  });
});

// ===========================================================================
describe('El aviso de inventario avisa, pero no bloquea', () => {
  it('no dice nada mientras la cantidad cabe en el inventario conocido', () => {
    const ticket = agregarAlTicket([], MAIZ);

    expect(excedeInventarioConocido(ticket[0]!)).toBe(false);
    expect(avisoDeInventario(ticket[0]!)).toBeNull();
  });

  it('avisa cuando la cantidad supera lo disponible, diciendo cuánto hay', () => {
    const ticket = fijarCantidad(agregarAlTicket([], MAIZ), 'p-maiz', '12');
    const linea = ticket[0]!;

    expect(excedeInventarioConocido(linea)).toBe(true);
    expect(avisoDeInventario(linea)).toContain('Solo hay 8 lb');
    expect(avisoDeInventario(linea)).toContain('lb');
  });

  it('avisar NO impide seguir editando la línea', () => {
    // Es la propiedad importante: el saldo comparado es una foto vieja, y
    // bloquear con un dato viejo impediría vender mercadería que sí está.
    let ticket = fijarCantidad(agregarAlTicket([], MAIZ), 'p-maiz', '12');
    expect(avisoDeInventario(ticket[0]!)).not.toBeNull();

    ticket = fijarCantidad(ticket, 'p-maiz', '20');
    expect(ticket[0]?.cantidad).toBe('20.000');

    ticket = fijarCantidad(ticket, 'p-maiz', '2');
    expect(avisoDeInventario(ticket[0]!)).toBeNull();
  });

  it('justo en el límite del inventario NO avisa', () => {
    const ticket = fijarCantidad(agregarAlTicket([], MAIZ), 'p-maiz', '8');
    expect(avisoDeInventario(ticket[0]!)).toBeNull();
  });
});

// ===========================================================================
describe('Cómo se leen las cantidades en el mostrador', () => {
  it('quita los ceros decorativos pero conserva los decimales que significan', () => {
    expect(cantidadLegible('1.000')).toBe('1');
    expect(cantidadLegible('0.500')).toBe('0.5');
    expect(cantidadLegible('1.256')).toBe('1.256');
    expect(cantidadLegible('12.000')).toBe('12');
  });

  it('describe la cantidad del ícono según el tipo de producto', () => {
    expect(descripcionDeCantidad(MAIZ)).toBe('0.5 lb · a granel');
    expect(descripcionDeCantidad(HUEVOS)).toBe('1 unidad');
    expect(descripcionDeCantidad({ ...HUEVOS, cantidadPredefinidaIcono: '12.000' })).toBe(
      '12 unidades',
    );
  });

  it('la unidad de una línea sale del tipo de medida', () => {
    const porPeso = agregarAlTicket([], MAIZ)[0]!;
    const porUnidad = agregarAlTicket([], HUEVOS)[0]!;

    expect(unidadDe(porPeso)).toBe('lb');
    expect(unidadDe(porUnidad)).toBe('unidad');
  });

  it('los decimales admitidos dependen del tipo de medida', () => {
    expect(decimalesDe('peso')).toBe(3);
    expect(decimalesDe('unidad')).toBe(0);
  });
});
