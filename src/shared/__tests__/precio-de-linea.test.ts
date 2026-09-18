/**
 * La regla del precio de una línea (spec 002, §3): el MENOR entre lista,
 * especial vigente y mayorista si la cantidad llega al umbral.
 *
 * Es la función que usan la venta (lo que se cobra) y la pantalla (lo que se
 * ve). Estas pruebas son la lista de verificación de la spec, con sus números:
 *
 *   · Maíz, por libra: lista Q6.00, mayorista Q5.50 desde 50 lb.
 *   · Azúcar, por kilogramo: lista Q9.00, mayorista Q8.20 desde 25.5 kg.
 *   · Huevo, por unidad: lista Q1.25, mayorista Q1.10 desde 30 unidades.
 *
 * El precio especial llega YA APLICADO (lo calcula `precioEfectivoDe`, que no
 * se toca): acá se escribe como el precio que dejó, por ejemplo Q5.40 para un
 * 10 % sobre Q6.00.
 */

import { describe, expect, it } from 'vitest';

import { montoACadena } from '../money';
import { calificaParaMayorista, precioDeLinea, type CandidatosDePrecio } from '../precio-de-linea';

const MAYORISTA_DEL_MAIZ = { precio: '5.50', cantidadMinima: '50.000' } as const;

/** Precio y origen, legibles, para que un fallo diga los dos a la vez. */
function elegir(candidatos: CandidatosDePrecio, cantidad: string): string {
  const { precio, origen } = precioDeLinea(candidatos, cantidad);
  return `${montoACadena(precio)} ${origen}`;
}

describe('CA-1 y CA-2 — Solo precio mayorista (Maíz: lista Q6.00, mayorista Q5.50 desde 50 lb)', () => {
  const maiz: CandidatosDePrecio = { lista: '6.00', especial: null, mayorista: MAYORISTA_DEL_MAIZ };

  it('CA-1: con 49.999 lb NO llega al umbral y se cobra la lista, sin marca', () => {
    expect(elegir(maiz, '49.999')).toBe('6.00 lista');
  });

  it('CA-2: con 50.000 lb EXACTAS ya califica: el umbral es inclusivo', () => {
    expect(elegir(maiz, '50.000')).toBe('5.50 mayorista');
  });

  it('CA-2: con 80 lb también se cobra el mayorista, en TODA la línea', () => {
    expect(elegir(maiz, '80.000')).toBe('5.50 mayorista');
  });

  it('con una cantidad chica (1 lb) se cobra la lista', () => {
    expect(elegir(maiz, '1.000')).toBe('6.00 lista');
  });
});

describe('CA-3 — Solo precio especial: el comportamiento de antes de la spec 002, intacto', () => {
  const conEspecial: CandidatosDePrecio = { lista: '6.00', especial: '5.40', mayorista: null };

  it('con cualquier cantidad se cobra el especial (Q5.40, un 10 % sobre Q6.00)', () => {
    expect(elegir(conEspecial, '1.000')).toBe('5.40 especial');
    expect(elegir(conEspecial, '500.000')).toBe('5.40 especial');
  });

  it('un especial que rebaja CERO se sigue marcando como especial, como antes', () => {
    expect(elegir({ lista: '6.00', especial: '6.00', mayorista: null }, '3.000')).toBe('6.00 especial');
  });

  it('sin especial ni mayorista, se cobra la lista', () => {
    expect(elegir({ lista: '6.00', especial: null, mayorista: null }, '3.000')).toBe('6.00 lista');
  });
});

describe('CA-4 a CA-6 — Especial y mayorista a la vez: gana el menor', () => {
  it('CA-4: gana el MAYORISTA si es más barato (especial 5 % = Q5.70, mayorista Q5.50) y la cantidad califica', () => {
    const ambos: CandidatosDePrecio = { lista: '6.00', especial: '5.70', mayorista: MAYORISTA_DEL_MAIZ };
    expect(elegir(ambos, '50.000')).toBe('5.50 mayorista');
  });

  it('CA-4: con 49.999 lb el mayorista no compite y se cobra el especial', () => {
    const ambos: CandidatosDePrecio = { lista: '6.00', especial: '5.70', mayorista: MAYORISTA_DEL_MAIZ };
    expect(elegir(ambos, '49.999')).toBe('5.70 especial');
  });

  it('CA-5: gana el ESPECIAL si es más barato (especial 10 % = Q5.40, mayorista Q5.50), aunque la cantidad califique', () => {
    const ambos: CandidatosDePrecio = { lista: '6.00', especial: '5.40', mayorista: MAYORISTA_DEL_MAIZ };
    expect(elegir(ambos, '60.000')).toBe('5.40 especial');
  });

  it('CA-6: EMPATE entre especial y mayorista (los dos Q5.50): se cobra Q5.50 y la marca es la del especial', () => {
    const empate: CandidatosDePrecio = { lista: '6.00', especial: '5.50', mayorista: MAYORISTA_DEL_MAIZ };
    expect(elegir(empate, '60.000')).toBe('5.50 especial');
  });

  it('empate entre lista y mayorista: no se marca el mayorista, porque no bajó nada', () => {
    const empate: CandidatosDePrecio = {
      lista: '5.50',
      especial: null,
      mayorista: { precio: '5.50', cantidadMinima: '50.000' },
    };
    expect(elegir(empate, '60.000')).toBe('5.50 lista');
  });
});

describe('CA-7 — EL CASO DE SEGURIDAD: un mayorista fijo que quedó más caro que la lista', () => {
  /*
    El mayorista Q5.50 se fijó cuando la lista era Q6.00; después la lista bajó
    a Q5.00. Con la decisión 1 de la spec (A: CHECK en la base) ese estado no se
    puede GUARDAR —la base lo rechaza, y eso tiene su propia prueba—. Esta es la
    otra mitad: aunque llegara, la regla de precio cobraría la lista.
  */
  const listaBajada: CandidatosDePrecio = { lista: '5.00', especial: null, mayorista: MAYORISTA_DEL_MAIZ };

  it('con 60 lb se cobra la LISTA (Q5.00), nunca el mayorista (Q5.50)', () => {
    expect(elegir(listaBajada, '60.000')).toBe('5.00 lista');
  });

  it('con un especial del 10 % sobre la lista nueva (Q4.50) se cobra el especial', () => {
    expect(elegir({ ...listaBajada, especial: '4.50' }, '60.000')).toBe('4.50 especial');
  });

  it('el precio cobrado nunca pasa del de lista, en ninguna combinación de la grilla', () => {
    const listas = ['5.00', '5.50', '6.00'];
    const especiales = [null, '4.50', '5.50', '6.00'];
    const mayoristas = [null, MAYORISTA_DEL_MAIZ, { precio: '7.00', cantidadMinima: '10.000' }];
    const cantidades = ['1.000', '49.999', '50.000', '80.000'];
    for (const lista of listas) {
      for (const especial of especiales) {
        for (const mayorista of mayoristas) {
          for (const cantidad of cantidades) {
            const { precio } = precioDeLinea({ lista, especial, mayorista }, cantidad);
            expect(
              precio.lessThanOrEqualTo(lista),
              `lista ${lista}, especial ${String(especial)}, mayorista ${JSON.stringify(mayorista)}, ${cantidad}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe('CA-9 a CA-11 — El umbral en la unidad del producto', () => {
  it('CA-9, por libra: el borde está en el tercer decimal (49.999 lb lista, 50.000 lb mayorista)', () => {
    const maiz: CandidatosDePrecio = { lista: '6.00', especial: null, mayorista: MAYORISTA_DEL_MAIZ };
    expect(elegir(maiz, '49.999')).toBe('6.00 lista');
    expect(elegir(maiz, '50.000')).toBe('5.50 mayorista');
  });

  it('CA-10, por kilogramo (Azúcar): 25.499 kg se cobra Q9.00 y 25.500 kg, Q8.20', () => {
    const azucar: CandidatosDePrecio = {
      lista: '9.00',
      especial: null,
      mayorista: { precio: '8.20', cantidadMinima: '25.500' },
    };
    expect(elegir(azucar, '25.499')).toBe('9.00 lista');
    expect(elegir(azucar, '25.500')).toBe('8.20 mayorista');
  });

  it('CA-11, por unidad (Huevo): 29 unidades se cobran a Q1.25 y 30, a Q1.10', () => {
    const huevo: CandidatosDePrecio = {
      lista: '1.25',
      especial: null,
      mayorista: { precio: '1.10', cantidadMinima: '30.000' },
    };
    expect(elegir(huevo, '29.000')).toBe('1.25 lista');
    expect(elegir(huevo, '30.000')).toBe('1.10 mayorista');
  });
});

describe('calificaParaMayorista', () => {
  it('sin configuración mayorista, ninguna cantidad califica', () => {
    expect(calificaParaMayorista(null, '1000.000')).toBe(false);
  });

  it('el umbral es inclusivo, y compara números, no texto («100.000» es más que «9.000»)', () => {
    expect(calificaParaMayorista({ precio: '1.00', cantidadMinima: '9.000' }, '100.000')).toBe(true);
    expect(calificaParaMayorista({ precio: '1.00', cantidadMinima: '100.000' }, '9.000')).toBe(false);
    expect(calificaParaMayorista({ precio: '1.00', cantidadMinima: '100.000' }, '100.000')).toBe(true);
  });
});

describe('Los precios se comparan como NÚMEROS, no como texto', () => {
  it('Q10.00 de lista contra Q9.00 mayorista: gana 9.00 (como texto, «10.00» < «9.00»)', () => {
    expect(
      elegir({ lista: '10.00', especial: null, mayorista: { precio: '9.00', cantidadMinima: '1.000' } }, '1.000'),
    ).toBe('9.00 mayorista');
  });
});
