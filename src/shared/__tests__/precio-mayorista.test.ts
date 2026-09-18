/**
 * Las reglas de la configuración del precio mayorista (spec 002, §4.2), que
 * comparten el formulario y el servicio de productos.
 *
 *   R1  Van juntos. R2  Precio válido y no negativo.
 *   R3  Precio ESTRICTAMENTE menor que la lista. R4  Cantidad mayor que cero.
 */

import { describe, expect, it } from 'vitest';

import { montoACadena, cantidadACadena } from '../money';
import {
  MENSAJES_DEL_PRECIO_MAYORISTA,
  revisarPrecioMayorista,
  type EntradaDelPrecioMayorista,
} from '../precio-mayorista';

/** El mensaje del rechazo, o «ok» con lo que se guardaría. */
function revisar(entrada: EntradaDelPrecioMayorista): string {
  const revision = revisarPrecioMayorista(entrada);
  if (!revision.ok) {
    return revision.mensaje;
  }
  if (revision.mayorista === null) {
    return 'ok sin mayorista';
  }
  return `ok ${montoACadena(revision.mayorista.precio)} desde ${cantidadACadena(revision.mayorista.cantidadMinima)}`;
}

describe('R1 — El precio y la cantidad mínima van juntos', () => {
  it('sin ninguno de los dos, el producto queda SIN precio mayorista', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: null, cantidadMinima: null })).toBe('ok sin mayorista');
    expect(revisar({ precioBase: '6.00', precioMayorista: '  ', cantidadMinima: '' })).toBe('ok sin mayorista');
  });

  it('con la casilla MARCADA y los dos vacíos, falta el precio (no es «sin mayorista»)', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '', cantidadMinima: '', exigido: true })).toBe(
      MENSAJES_DEL_PRECIO_MAYORISTA.faltaPrecio,
    );
  });

  it('con la cantidad y sin el precio, dice que falta el precio', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: null, cantidadMinima: '50' })).toBe(
      'Falta el precio mayorista.',
    );
  });

  it('con el precio y sin la cantidad, dice que falta la cantidad mínima', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '5.50', cantidadMinima: null })).toBe(
      'Falta la cantidad mínima para el precio mayorista.',
    );
  });
});

describe('R2 — El precio mayorista es un monto válido y no negativo', () => {
  it('rechaza lo que no es un número', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: 'cinco', cantidadMinima: '50' })).toBe(
      'El precio mayorista tiene que ser un número.',
    );
  });

  it('rechaza un precio negativo', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '-1.00', cantidadMinima: '50' })).toBe(
      'El precio mayorista no puede ser negativo.',
    );
  });

  it('acepta Q0.00, igual que un precio de lista de cero (spec §4.2, pregunta 3)', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '0', cantidadMinima: '50' })).toBe('ok 0.00 desde 50.000');
  });
});

describe('R3 — El precio mayorista es ESTRICTAMENTE menor que el de lista', () => {
  it('menor: se acepta, redondeado como se va a guardar', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '5.5', cantidadMinima: '50' })).toBe(
      'ok 5.50 desde 50.000',
    );
  });

  it('IGUAL a la lista: se rechaza, con los dos montos en el mensaje', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '6.00', cantidadMinima: '50' })).toBe(
      'El precio mayorista (Q6.00) tiene que ser menor que el precio de lista (Q6.00). ' +
        'Bajá el precio mayorista o quitalo.',
    );
  });

  it('mayor que la lista: se rechaza', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '7.25', cantidadMinima: '50' })).toMatch(
      /^El precio mayorista \(Q7\.25\) tiene que ser menor que el precio de lista \(Q6\.00\)/,
    );
  });

  it('BAJAR LA LISTA por debajo de un mayorista que ya había dice lo mismo (CA-24)', () => {
    expect(revisar({ precioBase: '5.00', precioMayorista: '5.50', cantidadMinima: '50.000' })).toMatch(
      /^El precio mayorista \(Q5\.50\) tiene que ser menor que el precio de lista \(Q5\.00\)/,
    );
  });

  it('compara DESPUÉS de redondear: 9.999 se guarda como 10.00, que no es menor que 10.00', () => {
    expect(revisar({ precioBase: '10.00', precioMayorista: '9.999', cantidadMinima: '5' })).toMatch(
      /^El precio mayorista \(Q10\.00\)/,
    );
    expect(revisar({ precioBase: '10.00', precioMayorista: '9.994', cantidadMinima: '5' })).toBe(
      'ok 9.99 desde 5.000',
    );
  });

  it('compara NÚMEROS, no texto: Q9.00 es menor que Q10.00 (como texto, «9.00» > «10.00»)', () => {
    expect(revisar({ precioBase: '10.00', precioMayorista: '9.00', cantidadMinima: '5' })).toBe('ok 9.00 desde 5.000');
    expect(revisar({ precioBase: '9.00', precioMayorista: '10.00', cantidadMinima: '5' })).toMatch(
      /tiene que ser menor que el precio de lista/,
    );
  });

  it('si el precio de lista no es un número, R3 no se evalúa: la lista tiene su propia regla, que va antes', () => {
    expect(revisar({ precioBase: 'abc', precioMayorista: '5.50', cantidadMinima: '50' })).toBe('ok 5.50 desde 50.000');
  });
});

describe('R4 — La cantidad mínima es mayor que cero', () => {
  it('rechaza cero', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '5.50', cantidadMinima: '0' })).toBe(
      'La cantidad mínima para el precio mayorista tiene que ser mayor que cero.',
    );
  });

  it('rechaza lo que al redondearse a tres decimales queda en cero (0.0004)', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '5.50', cantidadMinima: '0.0004' })).toBe(
      MENSAJES_DEL_PRECIO_MAYORISTA.cantidadNoPositiva,
    );
  });

  it('rechaza una cantidad negativa', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '5.50', cantidadMinima: '-5' })).toBe(
      MENSAJES_DEL_PRECIO_MAYORISTA.cantidadNoPositiva,
    );
  });

  it('rechaza lo que no es un número', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '5.50', cantidadMinima: 'medio quintal' })).toBe(
      'La cantidad mínima para el precio mayorista tiene que ser un número.',
    );
  });

  it('acepta una cantidad chica pero positiva (0.001) y una por peso con decimales (25.5 kg)', () => {
    expect(revisar({ precioBase: '6.00', precioMayorista: '5.50', cantidadMinima: '0.001' })).toBe(
      'ok 5.50 desde 0.001',
    );
    expect(revisar({ precioBase: '9.00', precioMayorista: '8.20', cantidadMinima: '25.5' })).toBe(
      'ok 8.20 desde 25.500',
    );
  });
});

describe('Cada rechazo trae su causa técnica, para la bitácora', () => {
  it('la causa nombra la columna y el valor', () => {
    const revision = revisarPrecioMayorista({ precioBase: '6.00', precioMayorista: '6.50', cantidadMinima: '10' });
    expect(revision.ok).toBe(false);
    if (!revision.ok) {
      expect(revision.causaTecnica).toBe('precio_mayorista 6.50 no es menor que precio_base 6.00.');
    }
  });
});
