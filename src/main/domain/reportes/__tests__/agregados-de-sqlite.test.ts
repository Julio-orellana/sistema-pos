/**
 * POR QUÉ NINGÚN REPORTE PUEDE AGREGAR NI ORDENAR EN SQL. Medido, no supuesto.
 *
 * Esta prueba no verifica código del proyecto: verifica **el motor**. Mide qué
 * hace SQLite de verdad cuando se le pide sumar u ordenar una columna TEXT que
 * guarda un decimal canónico, y deja el resultado escrito para que ninguna
 * sesión futura tenga que confiar en la palabra de nadie.
 *
 * Son dos trampas distintas y las dos están acá:
 *
 *   1. **`SUM()` convierte a punto flotante.** Es la que CLAUDE.md §5 viene
 *      señalando desde el Prompt 1 y la razón de ser de `money.ts`.
 *   2. **`ORDER BY` compara como TEXTO, alfabéticamente.** Esta no estaba
 *      anotada en ninguna parte y es más traicionera, porque no produce un
 *      decimal raro que llame la atención: produce una lista en un orden
 *      plausible pero equivocado.
 *
 * Si una versión futura de SQLite cambiara alguno de los dos comportamientos,
 * esta prueba falla en desarrollo —no en el mostrador— y alguien revisa si la
 * regla sigue haciendo falta.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as BaseDeDatos } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { montoACadena, sumarLista } from '@shared/money';
import { desdeColumnaDecimal } from '@main/database/decimal-columns';

let base: BaseDeDatos;

beforeEach(() => {
  base = new Database(':memory:');
  base.exec('CREATE TABLE medida (monto TEXT NOT NULL, cantidad TEXT NOT NULL)');
});

afterEach(() => {
  base.close();
});

/**
 * Diez montos de dos decimales. Su suma exacta es Q13.46.
 */
const MONTOS = ['0.10', '0.20', '0.30', '0.70', '1.10', '2.30', '8.70', '0.01', '0.02', '0.03'];

/**
 * Cinco valores con la forma de `subtotal_exacto`: el importe de una línea SIN
 * redondear, que es como se guarda (§5, «se guardan los dos por separado»).
 *
 * **ESTE ES EL CASO QUE DE VERDAD DUELE**, y se buscó a propósito: su suma
 * exacta es 18.495, que redondeada a centavos da **Q18.50**. Sumados en punto
 * flotante dan 18.494999999999997, que redondea a **Q18.49**. Un centavo
 * entero de diferencia, y en contra de la tienda.
 */
const EXACTOS = ['4.0131', '1.88326', '4.53776', '7.18912', '0.87176'];

/** Cantidades con distinta cantidad de dígitos enteros, que es lo que rompe el orden. */
const CANTIDADES = ['9.000', '10.000', '100.000', '2.500', '85.000'];

// ===========================================================================
describe('SUM() de SQLite sobre una columna TEXT de dinero pasa por punto flotante', () => {
  beforeEach(() => {
    const insertar = base.prepare('INSERT INTO medida (monto, cantidad) VALUES (?, ?)');
    for (const monto of MONTOS) {
      insertar.run(monto, '1.000');
    }
  });

  it('la suma exacta con Decimal es 13.46', () => {
    expect(montoACadena(sumarLista(MONTOS))).toBe('13.46');
  });

  it('SUM() de SQL NO devuelve 13.46: devuelve 13.459999999999999', () => {
    const { suma } = base.prepare('SELECT SUM(monto) AS suma FROM medida').get() as {
      suma: number;
    };
    // El número exacto que devuelve queda escrito: es la evidencia.
    expect(suma).toBe(13.459999999999999);
    expect(suma).not.toBe(13.46);
  });

  it('y devuelve un REAL, no un texto: la conversión a punto flotante es real', () => {
    const { tipo } = base.prepare('SELECT typeof(SUM(monto)) AS tipo FROM medida').get() as {
      tipo: string;
    };
    expect(tipo).toBe('real');
  });

  it('TOTAL() tampoco salva: tiene el mismo defecto', () => {
    // Se comprueba la alternativa obvia, para que nadie la proponga creyendo
    // que resuelve algo.
    const { suma } = base.prepare('SELECT TOTAL(monto) AS suma FROM medida').get() as {
      suma: number;
    };
    expect(suma).not.toBe(13.46);
  });

  it('el proyecto RECHAZA leer un número de una columna decimal, así que ni siquiera pasa', () => {
    /*
      La segunda red. `decimal-columns.ts` es la única vía para leer estas
      columnas y se niega ruidosamente si la base devuelve un número en vez de
      texto (§5). Un reporte escrito con `SUM()` no daría un número silenciosamente
      malo: se caería al intentar leerlo, que es el comportamiento correcto.
    */
    const { suma } = base.prepare('SELECT SUM(monto) AS suma FROM medida').get() as {
      suma: number;
    };
    expect(() => desdeColumnaDecimal(suma as unknown as string, 'prueba.suma')).toThrow();
  });
});

// ===========================================================================
describe('Con valores SIN redondear, SUM() de SQL cambia el centavo del reporte', () => {
  beforeEach(() => {
    const insertar = base.prepare('INSERT INTO medida (monto, cantidad) VALUES (?, ?)');
    for (const exacto of EXACTOS) {
      insertar.run(exacto, '1.000');
    }
  });

  it('la suma exacta es 18.495, que en quetzales es Q18.50', () => {
    expect(sumarLista(EXACTOS).toString()).toBe('18.495');
    expect(montoACadena(sumarLista(EXACTOS))).toBe('18.50');
  });

  it('SUM() de SQL da 18.494999999999997, que en quetzales es Q18.49', () => {
    const { suma } = base.prepare('SELECT SUM(monto) AS suma FROM medida').get() as {
      suma: number;
    };
    expect(suma).toBe(18.494999999999997);
    expect((Math.round(suma * 100) / 100).toFixed(2)).toBe('18.49');
  });

  it('UN CENTAVO DE DIFERENCIA, y en contra de la tienda', () => {
    const { suma } = base.prepare('SELECT SUM(monto) AS suma FROM medida').get() as {
      suma: number;
    };
    const porSql = (Math.round(suma * 100) / 100).toFixed(2);
    const exacto = montoACadena(sumarLista(EXACTOS));

    expect(porSql).not.toBe(exacto);
    expect(exacto).toBe('18.50');
    expect(porSql).toBe('18.49');
  });
});

// ===========================================================================
describe('ORDER BY de SQLite sobre una columna TEXT de cantidad ordena ALFABÉTICAMENTE', () => {
  beforeEach(() => {
    const insertar = base.prepare('INSERT INTO medida (monto, cantidad) VALUES (?, ?)');
    for (const cantidad of CANTIDADES) {
      insertar.run('1.00', cantidad);
    }
  });

  it('devuelve 10.000 antes que 2.500: el orden es por bytes, no por número', () => {
    const orden = (
      base.prepare('SELECT cantidad FROM medida ORDER BY cantidad').all() as {
        cantidad: string;
      }[]
    ).map((fila) => fila.cantidad);

    expect(orden).toEqual(['10.000', '100.000', '2.500', '85.000', '9.000']);
  });

  it('el orden NUMÉRICO correcto es otro, y es el que el reporte tiene que dar', () => {
    const correcto = [...CANTIDADES].sort((a, b) => Number(a) - Number(b));
    expect(correcto).toEqual(['2.500', '9.000', '10.000', '85.000', '100.000']);
  });

  it('MIN() devuelve 10.000, que no es el menor de la lista', () => {
    const { menor } = base.prepare('SELECT MIN(cantidad) AS menor FROM medida').get() as {
      menor: string;
    };
    expect(menor).toBe('10.000');
    expect(menor).not.toBe('2.500');
  });

  it('EL DAÑO CONCRETO: el reporte de inventario mostraría al revés lo que busca', () => {
    /*
      El reporte de inventario se ordena ascendente para ver PRIMERO lo que menos
      queda. Ordenado en SQL, un producto con 10 libras aparecería antes que uno
      con 2.5, que es exactamente lo contrario de para lo que sirve el reporte, y
      sin ningún síntoma visible: la lista se ve ordenada.
    */
    const primero = (
      base.prepare('SELECT cantidad FROM medida ORDER BY cantidad LIMIT 1').get() as {
        cantidad: string;
      }
    ).cantidad;

    expect(primero).toBe('10.000');
    expect(primero).not.toBe('2.500');
  });
});

// ===========================================================================
/**
 * La regla, aplicada al código de verdad.
 *
 * Se leen los archivos que los reportes usan y se comprueba que no haya ninguna
 * función agregada de SQL sobre una columna decimal. Es la contracara de las
 * pruebas de arriba: aquellas miden que el peligro existe, esta comprueba que
 * el proyecto no lo corre.
 */
describe('Ningún reporte agrega ni ordena decimales en SQL', () => {
  const archivos = [
    join(__dirname, '..', 'servicio-de-reportes.ts'),
    join(__dirname, '..', '..', '..', 'database', 'repositories', 'ventas.ts'),
    join(__dirname, '..', '..', '..', 'database', 'repositories', 'venta-detalle.ts'),
    join(__dirname, '..', '..', '..', 'database', 'repositories', 'productos.ts'),
  ];

  /** Las columnas decimales que un agregado de SQL arruinaría. */
  const COLUMNAS_DECIMALES = [
    'total',
    'subtotal',
    'subtotal_exacto',
    'subtotal_impreso',
    'descuento_valor',
    'cantidad',
    'inventario_disponible',
    'precio_base',
    'precio_unitario_snap',
    'cantidad_vendida',
  ];

  for (const ruta of archivos) {
    const nombre = ruta.split('/').slice(-1)[0] ?? ruta;

    it(`${nombre} no llama a SUM, AVG, TOTAL, MIN ni MAX sobre una columna decimal`, () => {
      const fuente = readFileSync(ruta, 'utf8');
      /*
        Se buscan las funciones agregadas de SQL con una columna decimal
        adentro. No alcanza con buscar «SUM(» a secas: los comentarios de estos
        mismos archivos explican por qué NO se usa, y una prueba que prohibiera
        la palabra prohibiría también la explicación.
      */
      for (const columna of COLUMNAS_DECIMALES) {
        const agregado = new RegExp(
          `\\b(SUM|AVG|TOTAL|MIN|MAX)\\s*\\(\\s*[a-z_.]*\\b${columna}\\b`,
          'i',
        );
        expect(agregado.test(fuente), `${nombre} agrega ${columna} en SQL`).toBe(false);
      }
    });

    it(`${nombre} no ordena en SQL por una columna decimal`, () => {
      const fuente = readFileSync(ruta, 'utf8');
      for (const columna of COLUMNAS_DECIMALES) {
        const orden = new RegExp(`ORDER BY\\s+[a-z_.]*\\b${columna}\\b`, 'i');
        expect(orden.test(fuente), `${nombre} ordena por ${columna} en SQL`).toBe(false);
      }
    });
  }

  it('el servicio de reportes sí usa las funciones de Decimal', () => {
    // La contraparte positiva: que no agregue en SQL no sirve de nada si además
    // no suma en ningún lado.
    const fuente = readFileSync(archivos[0] ?? '', 'utf8');
    expect(fuente).toContain('sumarLista');
    expect(fuente).toContain('@shared/money');
  });
});
