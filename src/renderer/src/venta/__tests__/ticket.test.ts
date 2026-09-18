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
import { decimal, montoACadena, sumarLista, multiplicar, redondearMonto } from '@shared/money';
import {
  agregarAlTicket,
  avisoDeInventario,
  cantidadLegible,
  decimalesDe,
  descripcionDeCantidad,
  descripcionDePrecioEspecial,
  descuentoDelTicket,
  excedeInventarioConocido,
  descripcionDePrecioMayorista,
  fijarCantidad,
  hayPrecioEspecial,
  hayPrecioMayorista,
  quitarDelTicket,
  subtotalDeLineaParaMostrar,
  subtotalExactoDelTicket,
  totalDelTicketConDescuento,
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
  precioEfectivo: '0.67',
  precioEspecial: null,
  mayorista: null,
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
  precioEfectivo: '42.00',
  precioEspecial: null,
  mayorista: null,
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

// ===========================================================================
/**
 * El precio especial en el ticket.
 *
 * El error que estas pruebas cierran es cobrar el precio de lista teniendo una
 * promoción vigente: el cliente pagaría de más y nadie lo notaría, porque el
 * ticket se ve igual de bien con un número que con el otro.
 */
describe('Precio especial: se cobra el efectivo, y se ve que se aplicó', () => {
  /** El maíz con un 20 % de rebaja ya resuelta por el proceso principal. */
  const MAIZ_REBAJADO: ProductoParaVender = {
    ...MAIZ,
    precioEfectivo: '0.54',
    precioEspecial: {
      id: 'pe-1',
      tipo: 'porcentaje',
      valor: '20.00',
      vigenteDesde: '2026-09-01T00:00:00.000Z',
      vigenteHasta: null,
    },
  };

  it('la línea se cobra al precio EFECTIVO, no al de lista', () => {
    const [linea] = agregarAlTicket([], MAIZ_REBAJADO);
    expect(linea?.precioUnitario).toBe('0.54');
    // Y el de lista se conserva al lado, para poder mostrar de cuánto bajó.
    expect(linea?.precioBase).toBe('0.67');
  });

  it('el subtotal usa el precio efectivo', () => {
    const lineas = agregarAlTicket([], MAIZ_REBAJADO);
    // Media libra a Q0.54 son Q0.27, no Q0.335.
    expect(subtotalDeLineaParaMostrar(lineas[0]!)).toBe('0.27');
  });

  it('sin precio especial la línea queda marcada como tal', () => {
    const [linea] = agregarAlTicket([], MAIZ);
    expect(linea?.precioEspecial).toBeNull();
    expect(hayPrecioEspecial(agregarAlTicket([], MAIZ))).toBe(false);
  });

  it('con precio especial el ticket lo sabe', () => {
    expect(hayPrecioEspecial(agregarAlTicket([], MAIZ_REBAJADO))).toBe(true);
  });

  it('la descripción dice CUÁNTO baja, sin inventarle nombre a la promoción', () => {
    expect(
      descripcionDePrecioEspecial({
        id: 'pe-1',
        tipo: 'porcentaje',
        valor: '20.00',
        vigenteDesde: '2026-09-01T00:00:00.000Z',
        vigenteHasta: null,
      }),
    ).toBe('20 % menos');

    expect(
      descripcionDePrecioEspecial({
        id: 'pe-2',
        tipo: 'monto_fijo',
        valor: '2.50',
        vigenteDesde: '2026-09-01T00:00:00.000Z',
        vigenteHasta: null,
      }),
    ).toBe('Q2.5 menos');
  });
});

// ===========================================================================
/**
 * El descuento sobre la venta completa.
 *
 * Estas cuentas tienen que dar EXACTAMENTE lo mismo que las del proceso
 * principal, porque son literalmente las mismas funciones: el módulo compartido
 * `@shared/descuento`. Si algún día alguien las duplica, estas pruebas siguen
 * pasando y el cliente empieza a pagar un total distinto del que ve.
 */
describe('Descuento del ticket: lo que se muestra es lo que se va a cobrar', () => {
  /** Un ticket de Q42.00: un cartón de huevos. */
  function ticketDeCuarentaYDos(): LineaDeTicket[] {
    return agregarAlTicket([], HUEVOS);
  }

  it('sin descuento, el total es el subtotal redondeado', () => {
    const lineas = ticketDeCuarentaYDos();
    expect(montoACadena(totalDelTicketConDescuento(lineas, null))).toBe('42.00');
    expect(montoACadena(descuentoDelTicket(lineas, null))).toBe('0.00');
  });

  it('un descuento en porcentaje rebaja la proporción', () => {
    const lineas = ticketDeCuarentaYDos();
    const pedido = { tipo: 'porcentaje' as const, valor: decimal('10') };

    expect(montoACadena(descuentoDelTicket(lineas, pedido))).toBe('4.20');
    expect(montoACadena(totalDelTicketConDescuento(lineas, pedido))).toBe('37.80');
  });

  it('un descuento de monto fijo rebaja los quetzales que dice', () => {
    const lineas = ticketDeCuarentaYDos();
    const pedido = { tipo: 'monto_fijo' as const, valor: decimal('5.50') };

    expect(montoACadena(totalDelTicketConDescuento(lineas, pedido))).toBe('36.50');
  });

  it('PISO EN CERO: un descuento mayor que la venta no devuelve dinero', () => {
    const lineas = ticketDeCuarentaYDos();
    const pedido = { tipo: 'monto_fijo' as const, valor: decimal('100') };

    expect(montoACadena(totalDelTicketConDescuento(lineas, pedido))).toBe('0.00');
  });

  it('el descuento se aplica sobre el subtotal EXACTO, no sobre el redondeado', () => {
    // Tres medias libras a Q0.67: subtotal exacto 1.005, que redondea a 1.01.
    let lineas = agregarAlTicket([], MAIZ);
    lineas = fijarCantidad(lineas, MAIZ.id, '1.5');
    expect(montoACadena(subtotalExactoDelTicket(lineas))).toBe('1.01');

    const pedido = { tipo: 'porcentaje' as const, valor: decimal('50') };
    // La mitad de 1.005 es 0.5025, y 1.005 − 0.5025 = 0.5025 → 0.50.
    expect(montoACadena(totalDelTicketConDescuento(lineas, pedido))).toBe('0.50');
  });
});

// ===========================================================================
/*
  SPEC 002 — El precio mayorista en el ticket (CA-12): el precio de la línea se
  recalcula EN VIVO cada vez que cambia la cantidad, con la misma función que
  usa el proceso principal al cobrar (`@shared/precio-de-linea`).

  Maíz por libra: lista Q6.00, mayorista Q5.50 desde 50 lb, ícono de 1 lb.
*/
const MAIZ_MAYORISTA: ProductoParaVender = {
  ...MAIZ,
  id: 'p-maiz-mayorista',
  cantidadPredefinidaIcono: '1.000',
  precioBase: '6.00',
  precioEfectivo: '6.00',
  mayorista: { precio: '5.50', cantidadMinima: '50.000' },
  inventarioDisponible: '500.000',
};

/** Precio, origen y subtotal de la única línea, legibles juntos. */
function linea(lineas: readonly LineaDeTicket[]): string {
  const [primera] = lineas;
  if (primera === undefined) {
    throw new Error('El ticket está vacío.');
  }
  return `${primera.cantidad} × ${primera.precioUnitario} ${primera.origenDelPrecio} = ${subtotalDeLineaParaMostrar(primera)}`;
}

describe('SPEC 002 — El precio mayorista se recalcula en vivo al cambiar la cantidad (CA-12)', () => {
  it('al agregar 1 lb se cobra la LISTA', () => {
    expect(linea(agregarAlTicket([], MAIZ_MAYORISTA))).toBe('1.000 × 6.00 lista = 6.00');
  });

  it('con el TECLADO, llegar a 50 lb pasa al precio mayorista; 49.999 lo devuelve a la lista', () => {
    let lineas = agregarAlTicket([], MAIZ_MAYORISTA);
    lineas = fijarCantidad(lineas, MAIZ_MAYORISTA.id, '50');
    expect(linea(lineas)).toBe('50.000 × 5.50 mayorista = 275.00');
    expect(totalDelTicketParaMostrar(lineas)).toBe('275.00');

    lineas = fijarCantidad(lineas, MAIZ_MAYORISTA.id, '49.999');
    expect(linea(lineas)).toBe('49.999 × 6.00 lista = 299.99');
    expect(totalDelTicketParaMostrar(lineas)).toBe('299.99');

    lineas = fijarCantidad(lineas, MAIZ_MAYORISTA.id, '80');
    expect(linea(lineas)).toBe('80.000 × 5.50 mayorista = 440.00');
  });

  it('VOLVIENDO A TOCAR EL ÍCONO también se cruza el umbral: 49 lb + 1 lb = 50 lb a precio mayorista', () => {
    let lineas = fijarCantidad(agregarAlTicket([], MAIZ_MAYORISTA), MAIZ_MAYORISTA.id, '49');
    expect(linea(lineas)).toBe('49.000 × 6.00 lista = 294.00');

    lineas = agregarAlTicket(lineas, MAIZ_MAYORISTA);
    expect(linea(lineas)).toBe('50.000 × 5.50 mayorista = 275.00');
  });

  it('con especial y mayorista: gana el menor, y el origen dice cuál', () => {
    const conEspecialDel5: ProductoParaVender = {
      ...MAIZ_MAYORISTA,
      precioEfectivo: '5.70',
      precioEspecial: {
        id: 'pe-1',
        tipo: 'porcentaje',
        valor: '5.00',
        vigenteDesde: '2026-09-01T00:00:00.000Z',
        vigenteHasta: null,
      },
    };
    let lineas = agregarAlTicket([], conEspecialDel5);
    expect(linea(lineas)).toBe('1.000 × 5.70 especial = 5.70');
    lineas = fijarCantidad(lineas, conEspecialDel5.id, '50');
    expect(linea(lineas)).toBe('50.000 × 5.50 mayorista = 275.00');
    expect(hayPrecioMayorista(lineas)).toBe(true);
    expect(hayPrecioEspecial(lineas)).toBe(false);
  });

  it('un producto sin mayorista no cambia de precio con ninguna cantidad', () => {
    let lineas = agregarAlTicket([], { ...MAIZ_MAYORISTA, mayorista: null });
    lineas = fijarCantidad(lineas, MAIZ_MAYORISTA.id, '1000');
    expect(linea(lineas)).toBe('1000.000 × 6.00 lista = 6000.00');
  });

  it('la descripción dice DESDE CUÁNTO, en la unidad del producto', () => {
    const [porLibra] = agregarAlTicket([], MAIZ_MAYORISTA);
    const [porUnidad] = agregarAlTicket([], {
      ...HUEVOS,
      mayorista: { precio: '40.00', cantidadMinima: '30.000' },
    });
    const [porKilo] = agregarAlTicket([], {
      ...MAIZ_MAYORISTA,
      unidadPeso: 'kg',
      mayorista: { precio: '5.50', cantidadMinima: '25.500' },
    });
    expect(porLibra === undefined ? '' : descripcionDePrecioMayorista(porLibra)).toBe('desde 50 lb');
    expect(porUnidad === undefined ? '' : descripcionDePrecioMayorista(porUnidad)).toBe('desde 30 unidades');
    expect(porKilo === undefined ? '' : descripcionDePrecioMayorista(porKilo)).toBe('desde 25.5 kg');
  });
});
