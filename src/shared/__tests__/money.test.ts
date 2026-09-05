/**
 * Pruebas de money.ts.
 *
 * Estas pruebas están escritas para ser AUDITABLES: cada nombre describe el
 * caso concreto y el resultado esperado, de modo que se puedan leer como una
 * lista de verificación sin abrir el código de implementación.
 *
 * Se ejecutan con: npm test
 */

import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';

import {
  BASE_PORCENTAJE,
  CERO,
  DECIMALES_MONTO,
  ErrorDeMonto,
  aCadena,
  aNumeroSoloParaMostrar,
  absoluto,
  cantidadACadena,
  comparar,
  conciliarSubtotalesConTotal,
  decimal,
  dividir,
  esCero,
  esEntradaDecimalValida,
  esIgual,
  esMayorOIgualQue,
  esMayorQue,
  esMenorOIgualQue,
  esMenorQue,
  esNegativo,
  esPositivo,
  formatearPeso,
  formatearQuetzales,
  limitarARango,
  maximo,
  minimo,
  montoACadena,
  multiplicar,
  negar,
  pesoACadena,
  porcentajeDe,
  porcentajeQueRepresenta,
  redondearA,
  redondearCantidad,
  redondearMonto,
  redondearPeso,
  repartirMonto,
  restar,
  restarPorcentaje,
  sumar,
  sumarLista,
} from '../money';

// ===========================================================================
describe('El problema que este módulo existe para resolver: punto flotante', () => {
  it('0.1 + 0.2 da exactamente 0.3 (JavaScript nativo daría 0.30000000000000004)', () => {
    expect(aCadena(sumar('0.1', '0.2'))).toBe('0.3');
    expect(esIgual(sumar('0.1', '0.2'), '0.3')).toBe(true);
  });

  it('deja constancia de que la aritmética nativa de JavaScript SÍ falla en ese caso', () => {
    // Esta prueba documenta el motivo del proyecto: si algún día alguien
    // "simplifica" money.ts a números nativos, el fallo será evidente.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('0.1 + 0.2 + 0.3 da exactamente 0.6', () => {
    expect(aCadena(sumar('0.1', '0.2', '0.3'))).toBe('0.6');
  });

  it('sumar diez veces 0.1 da exactamente 1 y no 0.9999999999999999', () => {
    const diezDecimos = Array.from({ length: 10 }, () => '0.1');
    expect(aCadena(sumarLista(diezDecimos))).toBe('1');
  });

  it('1.005 redondeado a centavos da 1.01 (con números nativos daría 1.00)', () => {
    expect(montoACadena('1.005')).toBe('1.01');
  });

  it('0.3 - 0.1 da exactamente 0.2', () => {
    expect(aCadena(restar('0.3', '0.1'))).toBe('0.2');
  });

  it('0.07 multiplicado por 100 da exactamente 7', () => {
    expect(aCadena(multiplicar('0.07', BASE_PORCENTAJE))).toBe('7');
  });
});

// ===========================================================================
describe('Política de redondeo del sistema: redondeo único al final', () => {
  // Este grupo es el que hace VINCULANTE la política descrita en el encabezado
  // de money.ts. Si alguien agrega un redondeo intermedio a cualquier función
  // de cálculo, alguna de estas pruebas falla.

  // Valor con más decimales de los que cualquier redondeo del sistema conserva.
  const MUCHOS_DECIMALES = '1.23456789';

  describe('Las operaciones de cálculo NO redondean', () => {
    it('sumar conserva todos los decimales', () => {
      expect(aCadena(sumar(MUCHOS_DECIMALES, '0'))).toBe('1.23456789');
    });

    it('sumarLista conserva todos los decimales', () => {
      expect(aCadena(sumarLista([MUCHOS_DECIMALES, '0']))).toBe('1.23456789');
    });

    it('restar conserva todos los decimales', () => {
      expect(aCadena(restar('2', '0.76543211'))).toBe('1.23456789');
    });

    it('multiplicar conserva todos los decimales', () => {
      expect(aCadena(multiplicar('0.001', '0.002'))).toBe('0.000002');
    });

    it('dividir conserva la precisión y no recorta a dos decimales', () => {
      // Un tercio no es representable de forma finita: debe conservar la
      // precisión interna de Decimal.js, no truncarse a 0.33.
      const unTercio = aCadena(dividir('1', '3'));
      expect(unTercio.startsWith('0.3333333333')).toBe(true);
      expect(unTercio.length).toBeGreaterThan('0.33'.length);
    });

    it('negar y absoluto conservan todos los decimales', () => {
      expect(aCadena(negar(MUCHOS_DECIMALES))).toBe('-1.23456789');
      expect(aCadena(absoluto(`-${MUCHOS_DECIMALES}`))).toBe('1.23456789');
    });

    it('porcentajeDe conserva todos los decimales', () => {
      expect(aCadena(porcentajeDe('133.33', '7.5'))).toBe('9.99975');
    });

    it('restarPorcentaje conserva todos los decimales', () => {
      expect(aCadena(restarPorcentaje('99.99', '5'))).toBe('94.9905');
    });

    it('porcentajeQueRepresenta conserva todos los decimales', () => {
      const porcentaje = aCadena(porcentajeQueRepresenta('1', '3'));
      expect(porcentaje.startsWith('33.3333333333')).toBe(true);
    });

    it('minimo, maximo y limitarARango devuelven el valor sin tocarlo', () => {
      expect(aCadena(minimo(MUCHOS_DECIMALES, '9'))).toBe('1.23456789');
      expect(aCadena(maximo(MUCHOS_DECIMALES, '0'))).toBe('1.23456789');
      expect(aCadena(limitarARango(MUCHOS_DECIMALES, '0', '9'))).toBe('1.23456789');
    });

    it('aCadena serializa sin redondear', () => {
      expect(aCadena(MUCHOS_DECIMALES)).toBe('1.23456789');
    });
  });

  describe('Solo las funciones de salida redondean', () => {
    it('redondearMonto, redondearPeso y redondearCantidad redondean a sus decimales', () => {
      expect(aCadena(redondearMonto(MUCHOS_DECIMALES))).toBe('1.23');
      expect(aCadena(redondearPeso(MUCHOS_DECIMALES))).toBe('1.235');
      expect(aCadena(redondearCantidad(MUCHOS_DECIMALES))).toBe('1.235');
    });

    it('las funciones de serialización redondean una sola vez, al escribir', () => {
      expect(montoACadena(MUCHOS_DECIMALES)).toBe('1.23');
      expect(pesoACadena(MUCHOS_DECIMALES)).toBe('1.235');
      expect(cantidadACadena(MUCHOS_DECIMALES)).toBe('1.235');
    });

    it('las funciones de formato redondean una sola vez, al mostrar', () => {
      expect(formatearQuetzales(MUCHOS_DECIMALES)).toBe('Q1.23');
      expect(formatearPeso(MUCHOS_DECIMALES, 'lb')).toBe('1.235 lb');
    });
  });

  describe('Una cadena larga de operaciones solo se redondea al final', () => {
    it('cinco operaciones encadenadas mantienen la precisión hasta el último paso', () => {
      // Peso x precio, menos 7%, mas 3 centavos, entre 3, por 3: si alguna
      // función redondeara en medio, el resultado exacto no coincidiría.
      const PRECIO_POR_LIBRA = '3.33';
      const LIBRAS = '7.77';
      const PORCENTAJE = '7';
      const AJUSTE = '0.03';
      const PARTES = '3';

      const paso1 = multiplicar(LIBRAS, PRECIO_POR_LIBRA);
      const paso2 = restarPorcentaje(paso1, PORCENTAJE);
      const paso3 = sumar(paso2, AJUSTE);
      const paso4 = dividir(paso3, PARTES);
      const paso5 = multiplicar(paso4, PARTES);

      expect(aCadena(paso1)).toBe('25.8741');
      expect(aCadena(paso2)).toBe('24.062913');
      expect(aCadena(paso3)).toBe('24.092913');
      // El valor exacto sobrevive el viaje de ida y vuelta por la división.
      expect(esIgual(paso5, paso3)).toBe(true);
      // Y recién aquí, una sola vez, se redondea.
      expect(montoACadena(paso5)).toBe('24.09');
    });

    it('redondear en cada paso da un resultado distinto: por eso está prohibido', () => {
      const PRECIO_POR_LIBRA = '0.67';
      const LIBRAS_POR_PESADA = '0.5';
      const linea = multiplicar(LIBRAS_POR_PESADA, PRECIO_POR_LIBRA);

      const politicaDelSistema = montoACadena(sumar(linea, linea, linea));
      const politicaProhibida = montoACadena(
        sumar(redondearMonto(linea), redondearMonto(linea), redondearMonto(linea)),
      );

      expect(politicaDelSistema).toBe('1.01');
      expect(politicaProhibida).toBe('1.02');
      expect(politicaDelSistema).not.toBe(politicaProhibida);
    });
  });

  describe('repartirMonto es una excepción controlada, y está acotada', () => {
    it('redondea porque un centavo no se puede partir, pero la suma cuadra exacta', () => {
      const TOTAL = '7.77';
      const partes = repartirMonto(TOTAL, ['1', '1', '1', '1', '1', '1', '1']);

      // Cada parte quedó redondeada a centavos...
      for (const parte of partes) {
        expect(aCadena(parte)).toBe(montoACadena(parte));
      }
      // ...y aun así la suma es exactamente el total, sin centavos perdidos.
      expect(esIgual(sumarLista(partes), TOTAL)).toBe(true);
    });

    it('la garantía se sostiene con montos y ponderaciones difíciles', () => {
      const casos: readonly { readonly total: string; readonly pesos: readonly string[] }[] = [
        { total: '0.01', pesos: ['1', '1', '1'] },
        { total: '100', pesos: ['1', '2', '3', '7'] },
        { total: '9.99', pesos: ['0.333', '0.333', '0.334'] },
        { total: '-0.07', pesos: ['5', '3'] },
        { total: '1234.56', pesos: ['1'] },
      ];

      for (const caso of casos) {
        const partes = repartirMonto(caso.total, caso.pesos);
        expect(montoACadena(sumarLista(partes))).toBe(montoACadena(caso.total));
      }
    });
  });
});

// ===========================================================================
describe('Construcción y validación de valores decimales', () => {
  it('acepta una cadena y conserva su valor exacto', () => {
    expect(aCadena(decimal('1234.5678'))).toBe('1234.5678');
  });

  it('acepta un número literal', () => {
    expect(aCadena(decimal(25))).toBe('25');
  });

  it('acepta una instancia de Decimal y la devuelve tal cual', () => {
    const original = new Decimal('9.99');
    expect(decimal(original)).toBe(original);
  });

  it('ignora espacios alrededor de la cadena', () => {
    expect(aCadena(decimal('  42.50  '))).toBe('42.5');
  });

  it('rechaza una cadena vacía con código VALOR_NO_NUMERICO', () => {
    expect(() => decimal('')).toThrow(ErrorDeMonto);
    try {
      decimal('   ');
      expect.unreachable('Se esperaba que una cadena en blanco fuera rechazada.');
    } catch (error) {
      expect((error as ErrorDeMonto).codigo).toBe('VALOR_NO_NUMERICO');
    }
  });

  it('rechaza texto que no es un número, como "abc"', () => {
    expect(() => decimal('abc')).toThrow(/no representa un número válido/);
  });

  it('rechaza NaN con código VALOR_NO_FINITO', () => {
    try {
      decimal(Number.NaN);
      expect.unreachable('Se esperaba que NaN fuera rechazado.');
    } catch (error) {
      expect((error as ErrorDeMonto).codigo).toBe('VALOR_NO_FINITO');
    }
  });

  it('rechaza Infinity con código VALOR_NO_FINITO', () => {
    try {
      decimal(Number.POSITIVE_INFINITY);
      expect.unreachable('Se esperaba que Infinity fuera rechazado.');
    } catch (error) {
      expect((error as ErrorDeMonto).codigo).toBe('VALOR_NO_FINITO');
    }
  });

  it('esEntradaDecimalValida distingue valores utilizables de basura', () => {
    expect(esEntradaDecimalValida('10.50')).toBe(true);
    expect(esEntradaDecimalValida(10.5)).toBe(true);
    expect(esEntradaDecimalValida(new Decimal('10.5'))).toBe(true);
    expect(esEntradaDecimalValida('diez con cincuenta')).toBe(false);
    expect(esEntradaDecimalValida(null)).toBe(false);
    expect(esEntradaDecimalValida(undefined)).toBe(false);
    expect(esEntradaDecimalValida({ monto: '10' })).toBe(false);
  });
});

// ===========================================================================
describe('Operaciones aritméticas básicas', () => {
  it('sumar sin argumentos devuelve cero', () => {
    expect(aCadena(sumar())).toBe('0');
  });

  it('restar aplica todos los sustraendos en orden', () => {
    expect(aCadena(restar('100', '10', '5.50'))).toBe('84.5');
  });

  it('multiplicar sin argumentos devuelve cero (no hay nada que multiplicar)', () => {
    expect(aCadena(multiplicar())).toBe('0');
  });

  it('multiplicar calcula peso por precio unitario: 12.5 lb x Q3.75 = Q46.875', () => {
    expect(aCadena(multiplicar('12.5', '3.75'))).toBe('46.875');
  });

  it('dividir reparte un total entre unidades: Q100 entre 8 = Q12.5', () => {
    expect(aCadena(dividir('100', '8'))).toBe('12.5');
  });

  it('dividir entre cero lanza error en vez de devolver Infinity', () => {
    try {
      dividir('100', '0');
      expect.unreachable('Se esperaba que la división entre cero fuera rechazada.');
    } catch (error) {
      expect((error as ErrorDeMonto).codigo).toBe('DIVISION_ENTRE_CERO');
    }
  });

  it('negar invierte el signo, útil para registrar una devolución', () => {
    expect(aCadena(negar('25.75'))).toBe('-25.75');
    expect(aCadena(negar('-25.75'))).toBe('25.75');
  });

  it('absoluto devuelve la magnitud sin signo', () => {
    expect(aCadena(absoluto('-25.75'))).toBe('25.75');
  });
});

// ===========================================================================
describe('Redondeo comercial (medio hacia arriba)', () => {
  it('redondea 2.345 a 2.35 en montos (dos decimales)', () => {
    expect(montoACadena('2.345')).toBe('2.35');
  });

  it('redondea 2.344 a 2.34 en montos', () => {
    expect(montoACadena('2.344')).toBe('2.34');
  });

  it('usa medio hacia arriba y NO redondeo bancario: 0.125 da 0.13, no 0.12', () => {
    expect(montoACadena('0.125')).toBe('0.13');
    expect(montoACadena('0.135')).toBe('0.14');
  });

  it('redondea montos negativos alejándose de cero: -0.125 da -0.13', () => {
    expect(montoACadena('-0.125')).toBe('-0.13');
  });

  it('rellena con ceros para que un monto siempre tenga dos decimales', () => {
    expect(montoACadena('7')).toBe('7.00');
    expect(montoACadena('7.5')).toBe('7.50');
  });

  it('redondea pesos a tres decimales: 5.4567 lb da 5.457 lb', () => {
    expect(pesoACadena('5.4567')).toBe('5.457');
  });

  it('redondea cantidades a tres decimales', () => {
    expect(cantidadACadena('2.0004')).toBe('2.000');
    expect(aCadena(redondearCantidad('2.0006'))).toBe('2.001');
  });

  it('redondearA permite una cantidad arbitraria de decimales', () => {
    expect(aCadena(redondearA('3.14159', 0))).toBe('3');
    expect(aCadena(redondearA('3.14159', 4))).toBe('3.1416');
  });

  it('redondearA rechaza una cantidad de decimales negativa o fraccionaria', () => {
    expect(() => redondearA('3.14', -1)).toThrow(ErrorDeMonto);
    expect(() => redondearA('3.14', 1.5)).toThrow(ErrorDeMonto);
  });

  it('redondearMonto y redondearPeso devuelven Decimal, no cadena', () => {
    expect(redondearMonto('1.239')).toBeInstanceOf(Decimal);
    expect(redondearPeso('1.2394')).toBeInstanceOf(Decimal);
  });
});

// ===========================================================================
describe('Porcentajes (base de los descuentos)', () => {
  it('calcula el 10% de Q250 como Q25', () => {
    expect(aCadena(porcentajeDe('250', '10'))).toBe('25');
  });

  it('calcula el 7.5% de Q133.33 sin redondear prematuramente', () => {
    // 133.33 * 7.5 / 100 = 9.99975 exacto; el redondeo se decide después.
    expect(aCadena(porcentajeDe('133.33', '7.5'))).toBe('9.99975');
    expect(montoACadena(porcentajeDe('133.33', '7.5'))).toBe('10.00');
  });

  it('restarPorcentaje aplica un descuento: Q250 menos 10% da Q225', () => {
    expect(montoACadena(restarPorcentaje('250', '10'))).toBe('225.00');
  });

  it('encadena dos descuentos sin redondear en medio: Q99.99 con 5% y luego 3% da Q92.14', () => {
    // 99.99 - 5% = 94.9905 exacto; 94.9905 - 3% = 92.140785 exacto.
    const conDescuentoDeLinea = restarPorcentaje('99.99', '5');
    const conDescuentoGlobal = restarPorcentaje(conDescuentoDeLinea, '3');
    expect(aCadena(conDescuentoDeLinea)).toBe('94.9905');
    expect(aCadena(conDescuentoGlobal)).toBe('92.140785');
    expect(montoACadena(conDescuentoGlobal)).toBe('92.14');
  });

  it('redondear una sola vez al final evita el centavo de diferencia que produce redondear línea por línea', () => {
    // Tres pesadas de 0.5 lb a Q0.67/lb: cada línea vale exactamente Q0.335.
    const PRECIO_POR_LIBRA = '0.67';
    const LIBRAS_POR_PESADA = '0.5';
    const valorExactoDeLinea = multiplicar(LIBRAS_POR_PESADA, PRECIO_POR_LIBRA);
    expect(aCadena(valorExactoDeLinea)).toBe('0.335');

    // Camino correcto: sumar exacto y redondear una sola vez al final.
    const totalRedondeadoAlFinal = montoACadena(
      sumar(valorExactoDeLinea, valorExactoDeLinea, valorExactoDeLinea),
    );

    // Camino ingenuo: redondear cada línea y después sumar.
    const totalRedondeandoCadaLinea = montoACadena(
      sumar(
        redondearMonto(valorExactoDeLinea),
        redondearMonto(valorExactoDeLinea),
        redondearMonto(valorExactoDeLinea),
      ),
    );

    expect(totalRedondeadoAlFinal).toBe('1.01');
    expect(totalRedondeandoCadaLinea).toBe('1.02');
  });

  it('porcentajeQueRepresenta indica el descuento efectivo: Q25 sobre Q250 es 10%', () => {
    expect(aCadena(porcentajeQueRepresenta('25', '250'))).toBe('10');
  });

  it('porcentajeQueRepresenta rechaza un total de cero', () => {
    expect(() => porcentajeQueRepresenta('25', '0')).toThrow(ErrorDeMonto);
  });
});

// ===========================================================================
describe('Comparaciones', () => {
  it('reconoce como iguales dos escrituras del mismo valor: "1.10" y "1.1"', () => {
    expect(esIgual('1.10', '1.1')).toBe(true);
  });

  it('comparar devuelve -1, 0 y 1 según corresponda', () => {
    expect(comparar('1', '2')).toBe(-1);
    expect(comparar('2', '2')).toBe(0);
    expect(comparar('3', '2')).toBe(1);
  });

  it('evalúa mayor, menor y sus variantes con igualdad', () => {
    expect(esMayorQue('10.01', '10')).toBe(true);
    expect(esMayorQue('10', '10')).toBe(false);
    expect(esMayorOIgualQue('10', '10')).toBe(true);
    expect(esMenorQue('9.99', '10')).toBe(true);
    expect(esMenorOIgualQue('10', '10')).toBe(true);
  });

  it('identifica cero, positivo y negativo', () => {
    expect(esCero('0.00')).toBe(true);
    expect(esCero(CERO)).toBe(true);
    expect(esPositivo('0.01')).toBe(true);
    expect(esPositivo('0')).toBe(false);
    expect(esNegativo('-0.01')).toBe(true);
  });

  it('minimo y maximo eligen el valor correcto de una lista', () => {
    expect(aCadena(minimo('3', '1.5', '2'))).toBe('1.5');
    expect(aCadena(maximo('3', '1.5', '2'))).toBe('3');
  });

  it('limitarARango recorta un descuento al tope permitido', () => {
    // Un vendedor pide 30% cuando su límite es 15%: queda en 15%.
    expect(aCadena(limitarARango('30', '0', '15'))).toBe('15');
    expect(aCadena(limitarARango('10', '0', '15'))).toBe('10');
    expect(aCadena(limitarARango('-5', '0', '15'))).toBe('0');
  });
});

// ===========================================================================
describe('Reparto proporcional de un monto (prorrateo de descuento global)', () => {
  it('reparte Q10 entre tres líneas iguales sin perder ni un centavo', () => {
    const partes = repartirMonto('10', ['1', '1', '1']);
    expect(partes.map(aCadena)).toEqual(['3.34', '3.33', '3.33']);
    expect(montoACadena(sumarLista(partes))).toBe('10.00');
  });

  it('reparte proporcionalmente al monto de cada línea', () => {
    const partes = repartirMonto('100', ['50', '30', '20']);
    expect(partes.map(aCadena)).toEqual(['50', '30', '20']);
  });

  it('la suma de las partes es siempre exactamente el total, aun con decimales feos', () => {
    const partes = repartirMonto('7.77', ['1', '1', '1', '1', '1', '1', '1']);
    expect(montoACadena(sumarLista(partes))).toBe('7.77');
  });

  it('reparte también montos negativos (una devolución prorrateada)', () => {
    const partes = repartirMonto('-10', ['1', '1', '1']);
    expect(montoACadena(sumarLista(partes))).toBe('-10.00');
  });

  it('rechaza repartir sin líneas', () => {
    expect(() => repartirMonto('10', [])).toThrow(ErrorDeMonto);
  });

  it('rechaza ponderaciones negativas', () => {
    expect(() => repartirMonto('10', ['1', '-1'])).toThrow(/no pueden ser negativas/);
  });

  it('rechaza repartir cuando todas las ponderaciones son cero', () => {
    try {
      repartirMonto('10', ['0', '0']);
      expect.unreachable('Se esperaba que un reparto sin peso total fuera rechazado.');
    } catch (error) {
      expect((error as ErrorDeMonto).codigo).toBe('REPARTO_INVALIDO');
    }
  });
});

// ===========================================================================
describe('El comprobante impreso cuadra: las líneas suman exactamente el total', () => {
  /**
   * Imprime un comprobante tal como saldría en papel y devuelve las cadenas.
   * Trabaja con las MISMAS funciones que usará el módulo de comprobantes.
   */
  function imprimirComprobante(
    lineas: readonly { readonly producto: string; readonly libras: string; readonly precioPorLibra: string }[],
  ): { renglones: string[]; sumaDeLineasImpresas: string; totalImpreso: string } {
    const valoresExactos = lineas.map((linea) => multiplicar(linea.libras, linea.precioPorLibra));
    const comprobante = conciliarSubtotalesConTotal(valoresExactos);

    const renglones = lineas.map((linea, indice) => {
      const importe = montoACadena(comprobante.lineas[indice] ?? '0');
      return `${linea.producto} ${linea.libras} lb x Q${linea.precioPorLibra} = Q${importe}`;
    });

    return {
      renglones,
      sumaDeLineasImpresas: montoACadena(sumarLista(comprobante.lineas)),
      totalImpreso: montoACadena(comprobante.total),
    };
  }

  it('CASO CONCRETO DE TRES LÍNEAS donde el redondeo por línea SÍ difiere del total', () => {
    // Maíz 1.5 lb x Q2.23  = 3.345 exacto
    // Azúcar 2.5 lb x Q4.11 = 10.275 exacto
    // Frijol 0.5 lb x Q6.35 = 3.175 exacto
    // Suma exacta = 16.795  ->  total correcto Q16.80
    // Redondeando cada línea por su cuenta: 3.35 + 10.28 + 3.18 = Q16.81  (un centavo de más)
    const venta = [
      { producto: 'Maíz', libras: '1.5', precioPorLibra: '2.23' },
      { producto: 'Azúcar', libras: '2.5', precioPorLibra: '4.11' },
      { producto: 'Frijol', libras: '0.5', precioPorLibra: '6.35' },
    ];

    const valoresExactos = venta.map((linea) => multiplicar(linea.libras, linea.precioPorLibra));
    expect(valoresExactos.map(aCadena)).toEqual(['3.345', '10.275', '3.175']);

    // Así se vería el problema si cada línea se redondeara por su cuenta.
    const sumaIngenua = montoACadena(sumarLista(valoresExactos.map(redondearMonto)));
    expect(sumaIngenua).toBe('16.81');
    expect(montoACadena(sumarLista(valoresExactos))).toBe('16.80');

    // Y así queda el comprobante con la política del sistema.
    const comprobante = imprimirComprobante(venta);

    expect(comprobante.renglones).toEqual([
      'Maíz 1.5 lb x Q2.23 = Q3.35',
      'Azúcar 2.5 lb x Q4.11 = Q10.28',
      'Frijol 0.5 lb x Q6.35 = Q3.17',
    ]);
    expect(comprobante.totalImpreso).toBe('16.80');
    expect(comprobante.sumaDeLineasImpresas).toBe('16.80');
    expect(comprobante.sumaDeLineasImpresas).toBe(comprobante.totalImpreso);
  });

  it('el caso de las tres pesadas de 0.5 lb a Q0.67 también cuadra en el papel', () => {
    const venta = [
      { producto: 'Maíz', libras: '0.5', precioPorLibra: '0.67' },
      { producto: 'Maíz', libras: '0.5', precioPorLibra: '0.67' },
      { producto: 'Maíz', libras: '0.5', precioPorLibra: '0.67' },
    ];

    const comprobante = imprimirComprobante(venta);

    expect(comprobante.renglones).toEqual([
      'Maíz 0.5 lb x Q0.67 = Q0.34',
      'Maíz 0.5 lb x Q0.67 = Q0.34',
      'Maíz 0.5 lb x Q0.67 = Q0.33',
    ]);
    expect(comprobante.totalImpreso).toBe('1.01');
    expect(comprobante.sumaDeLineasImpresas).toBe('1.01');
  });

  it('el total impreso es el importe correcto, no la suma de líneas redondeadas', () => {
    const valoresExactos = ['3.345', '10.275', '3.175'];
    const comprobante = conciliarSubtotalesConTotal(valoresExactos);

    expect(aCadena(comprobante.totalExacto)).toBe('16.795');
    expect(montoACadena(comprobante.total)).toBe('16.80');
    expect(comprobante.centavosReconciliados).toBe(2);
  });

  it('ninguna línea impresa se desvía más de un centavo de su valor real', () => {
    const valoresExactos = ['3.345', '10.275', '3.175', '0.004', '99.999'];
    const comprobante = conciliarSubtotalesConTotal(valoresExactos);
    const UN_CENTAVO = '0.01';

    comprobante.lineas.forEach((impresa, indice) => {
      const exacta = valoresExactos[indice] ?? '0';
      expect(esMenorOIgualQue(absoluto(restar(impresa, exacta)), UN_CENTAVO)).toBe(true);
    });
  });

  it('con una sola línea, la línea impresa ES el total impreso', () => {
    const comprobante = conciliarSubtotalesConTotal(['12.345']);
    expect(montoACadena(comprobante.lineas[0] ?? '0')).toBe('12.35');
    expect(montoACadena(comprobante.total)).toBe('12.35');
  });

  it('cuadra también cuando ninguna línea necesita ajuste', () => {
    const comprobante = conciliarSubtotalesConTotal(['10.00', '5.50', '2.25']);
    expect(comprobante.centavosReconciliados).toBe(0);
    expect(comprobante.lineas.map(montoACadena)).toEqual(['10.00', '5.50', '2.25']);
    expect(montoACadena(comprobante.total)).toBe('17.75');
  });

  it('cuadra en una devolución, donde los importes son negativos', () => {
    const comprobante = conciliarSubtotalesConTotal(['-3.345', '-10.275', '-3.175']);
    expect(montoACadena(comprobante.total)).toBe('-16.80');
    expect(montoACadena(sumarLista(comprobante.lineas))).toBe('-16.80');
  });

  it('cuadra en una lista larga de pesadas incómodas', () => {
    const CANTIDAD_DE_PESADAS = 17;
    const valoresExactos = Array.from({ length: CANTIDAD_DE_PESADAS }, (_, indice) =>
      multiplicar(`0.${String(indice + 1).padStart(2, '0')}5`, '7.77'),
    );

    const comprobante = conciliarSubtotalesConTotal(valoresExactos);
    expect(montoACadena(sumarLista(comprobante.lineas))).toBe(montoACadena(comprobante.total));
  });

  it('cuadra en una batería de comprobantes distintos, sin excepción', () => {
    const comprobantes: readonly (readonly string[])[] = [
      ['0.005', '0.005'],
      ['0.005', '0.005', '0.005'],
      ['1.115', '2.225', '3.335', '4.445'],
      ['0.001', '0.001', '0.001', '0.001', '0.001'],
      ['33.333', '33.333', '33.334'],
      ['0.5', '0.25', '0.125', '0.0625'],
      ['-1.115', '2.225', '-3.335'],
      ['999.995', '0.004'],
    ];

    for (const lineas of comprobantes) {
      const comprobante = conciliarSubtotalesConTotal(lineas);
      expect(montoACadena(sumarLista(comprobante.lineas))).toBe(montoACadena(comprobante.total));
    }
  });

  it('rechaza conciliar un comprobante sin líneas', () => {
    expect(() => conciliarSubtotalesConTotal([])).toThrow(ErrorDeMonto);
  });

  describe('Por qué el residuo mayor y no "que lo absorba la última línea"', () => {
    it('con diez pesadas iguales, el residuo mayor deja cada línea a medio centavo de su valor', () => {
      const CANTIDAD = 10;
      const valorExacto = '0.335';
      const comprobante = conciliarSubtotalesConTotal(Array.from({ length: CANTIDAD }, () => valorExacto));

      const impresas = comprobante.lineas.map(montoACadena);
      expect(impresas.filter((importe) => importe === '0.34')).toHaveLength(5);
      expect(impresas.filter((importe) => importe === '0.33')).toHaveLength(5);
      expect(montoACadena(comprobante.total)).toBe('3.35');
      expect(montoACadena(sumarLista(comprobante.lineas))).toBe('3.35');
    });

    it('la alternativa descartada dejaría la última línea con Q0.29 en vez de Q0.34', () => {
      // Reconstrucción del criterio "que la diferencia la absorba la última
      // línea", para dejar por escrito por qué se descartó.
      const CANTIDAD = 10;
      const valorExacto = '0.335';
      const exactos = Array.from({ length: CANTIDAD }, () => valorExacto);

      const total = redondearMonto(sumarLista(exactos));
      const redondeadasPorLinea = exactos.map(redondearMonto);
      const sumaDeLasPrimeras = sumarLista(redondeadasPorLinea.slice(0, CANTIDAD - 1));
      const ultimaLineaAbsorbente = restar(total, sumaDeLasPrimeras);

      expect(montoACadena(ultimaLineaAbsorbente)).toBe('0.29');
      // Q0.29 impreso para una pesada que vale Q0.335: cinco centavos de
      // desviación en una sola línea, que en el mostrador se lee como un error.
      expect(esMayorQue(absoluto(restar(ultimaLineaAbsorbente, valorExacto)), '0.04')).toBe(true);
    });
  });
});

// ===========================================================================
describe('Serialización para guardar y transportar', () => {
  it('aCadena no usa notación exponencial en valores muy pequeños', () => {
    expect(aCadena('0.0000001')).toBe('0.0000001');
  });

  it('montoACadena produce la forma canónica de la base de datos', () => {
    expect(montoACadena('1234.5')).toBe('1234.50');
    expect(montoACadena(0)).toBe('0.00');
  });

  it('pesoACadena y cantidadACadena fijan tres decimales', () => {
    expect(pesoACadena('60')).toBe('60.000');
    expect(cantidadACadena('1.5')).toBe('1.500');
  });

  it('aNumeroSoloParaMostrar convierte a number para la interfaz', () => {
    expect(aNumeroSoloParaMostrar('12.34')).toBe(12.34);
  });

  it('la constante DECIMALES_MONTO refleja los centavos del quetzal', () => {
    expect(DECIMALES_MONTO).toBe(2);
  });
});

// ===========================================================================
describe('Formato para pantalla y recibos', () => {
  it('formatea Q1,234.56 con separador de miles', () => {
    expect(formatearQuetzales('1234.56')).toBe('Q1,234.56');
  });

  it('formatea montos de siete cifras con todos los separadores', () => {
    expect(formatearQuetzales('1234567.8')).toBe('Q1,234,567.80');
  });

  it('formatea montos menores a mil sin separador', () => {
    expect(formatearQuetzales('999.9')).toBe('Q999.90');
    expect(formatearQuetzales('0')).toBe('Q0.00');
  });

  it('coloca el signo negativo antes del símbolo de moneda', () => {
    expect(formatearQuetzales('-1234.56')).toBe('-Q1,234.56');
  });

  it('formatea un peso quitando los ceros decimales sobrantes', () => {
    expect(formatearPeso('5.500', 'lb')).toBe('5.5 lb');
    expect(formatearPeso('3', 'lb')).toBe('3 lb');
    expect(formatearPeso('0.125', 'lb')).toBe('0.125 lb');
  });
});

// ===========================================================================
describe('Escenario completo de una venta a granel (verificación de extremo a extremo)', () => {
  it('calcula una venta de maíz con descuento y cuadra al centavo', () => {
    // Jimmy vende 12.5 lb de maíz a Q3.75 la libra, con 7% de descuento.
    const PRECIO_POR_LIBRA = '3.75';
    const LIBRAS_VENDIDAS = '12.5';
    const PORCENTAJE_DESCUENTO = '7';

    const subtotal = multiplicar(LIBRAS_VENDIDAS, PRECIO_POR_LIBRA);
    const descuento = porcentajeDe(subtotal, PORCENTAJE_DESCUENTO);
    const total = restar(subtotal, descuento);

    expect(montoACadena(subtotal)).toBe('46.88');
    expect(montoACadena(descuento)).toBe('3.28');
    expect(montoACadena(total)).toBe('43.59');
    expect(formatearQuetzales(total)).toBe('Q43.59');
  });

  it('el vuelto se calcula exacto cuando el cliente paga con billete de Q50', () => {
    const PAGO_DEL_CLIENTE = '50';
    const total = restar(multiplicar('12.5', '3.75'), porcentajeDe(multiplicar('12.5', '3.75'), '7'));
    const vuelto = restar(PAGO_DEL_CLIENTE, redondearMonto(total));
    expect(montoACadena(vuelto)).toBe('6.41');
  });
});
