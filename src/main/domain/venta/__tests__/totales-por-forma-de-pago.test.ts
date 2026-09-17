/**
 * Cuánto entró y cómo se pagó: la suma, y que se haga en UN SOLO LUGAR.
 *
 * ===========================================================================
 * LAS DOS MITADES QUE ESTA PRUEBA CUBRE
 * ===========================================================================
 *
 * 1. **Que sume bien**, con los casos que el punto flotante arruina. No son
 *    hipotéticos: `1.1 + 2.2 + 4.4` da `7.700000000000001` y `3.3 + 6.6` da
 *    `9.899999999999999` en JavaScript, y cada prueba lleva su control que lo
 *    mide en vez de afirmarlo.
 *
 * 2. **Que nadie vuelva a escribir el reparto por su cuenta.** Hasta el
 *    2026-09-17 vivía suelto dentro de `resumenDeVentas`, y cuando el historial
 *    de recibos necesitó lo mismo, copiarlo habría dejado dos lugares que
 *    contestan la misma pregunta y que pueden empezar a contestarla distinto
 *    —uno excluyendo las ventas anuladas y el otro no, por ejemplo— sin que
 *    nada fallara. Es la misma clase de defecto que ya costó una vuelta con el
 *    nombre legible de las tablas (§4.57), y se cierra igual: con una prueba
 *    estructural, no con cuidado.
 *
 * QUÉ CUENTA COMO «escribir el reparto por su cuenta»: un `.filter(...)` cuyo
 * cuerpo compara `formaPago` contra `'efectivo'` o `'tarjeta'`. Se recorre el
 * árbol sintáctico y no texto suelto, así que un `if (formaPago === 'efectivo')`
 * —que es otra cosa: decidir sobre UNA venta, no partir un conjunto— no cuenta,
 * y un comentario tampoco.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { totalesPorFormaDePago } from '../totales-por-forma-de-pago';

const RAIZ_DEL_PROYECTO = join(__dirname, '..', '..', '..', '..');
const RUTA_DE_LA_FUENTE = join(__dirname, '..', 'totales-por-forma-de-pago.ts');

/** Las carpetas donde nadie puede repartir por forma de pago a mano. */
const CARPETAS = [
  join(RAIZ_DEL_PROYECTO, 'main'),
  join(RAIZ_DEL_PROYECTO, 'renderer', 'src'),
  join(RAIZ_DEL_PROYECTO, 'shared'),
];

// ===========================================================================
// 1. La suma
// ===========================================================================

describe('El reparto por forma de pago suma con Decimal, no con punto flotante', () => {
  it('SUMA EXACTA en efectivo: 1.10 + 2.20 + 4.40 da 7.70, no 7.700000000000001', () => {
    const totales = totalesPorFormaDePago([
      { formaPago: 'efectivo', total: '1.10' },
      { formaPago: 'efectivo', total: '2.20' },
      { formaPago: 'efectivo', total: '4.40' },
    ]);

    // El control, medido: así de mal sale sumando con `Number`.
    expect(1.1 + 2.2 + 4.4).toBe(7.700000000000001);
    expect(totales.enEfectivo).toBe('7.70');
  });

  it('SUMA EXACTA con tarjeta: 3.30 + 6.60 da 9.90, no 9.899999999999999', () => {
    const totales = totalesPorFormaDePago([
      { formaPago: 'tarjeta', total: '3.30' },
      { formaPago: 'tarjeta', total: '6.60' },
    ]);

    expect(3.3 + 6.6).toBe(9.899999999999999);
    expect(totales.enTarjeta).toBe('9.90');
  });

  it('EFECTIVO + TARJETA DA EXACTAMENTE EL GENERAL', () => {
    const totales = totalesPorFormaDePago([
      { formaPago: 'efectivo', total: '1.10' },
      { formaPago: 'efectivo', total: '2.20' },
      { formaPago: 'efectivo', total: '4.40' },
      { formaPago: 'tarjeta', total: '3.30' },
      { formaPago: 'tarjeta', total: '6.60' },
    ]);

    expect(totales.enEfectivo).toBe('7.70');
    expect(totales.enTarjeta).toBe('9.90');
    expect(totales.general).toBe('17.60');
  });

  it('cada venta va a UN SOLO montón: las dos partes suman el general en veinte casos seguidos', () => {
    const ventas = Array.from({ length: 20 }, (_, indice) => ({
      formaPago: indice % 2 === 0 ? ('efectivo' as const) : ('tarjeta' as const),
      // Montos de dos decimales que en punto flotante no cierran.
      total: `${String(indice + 1)}.${String((indice * 7) % 10)}${String((indice * 3) % 10)}`,
    }));

    const totales = totalesPorFormaDePago(ventas);

    const aCentavos = (monto: string): number => Math.round(Number(monto) * 100);
    expect(aCentavos(totales.enEfectivo) + aCentavos(totales.enTarjeta)).toBe(
      aCentavos(totales.general),
    );
  });

  it('cuenta cuántas ventas hay de cada forma de pago, no solo los montos', () => {
    const totales = totalesPorFormaDePago([
      { formaPago: 'efectivo', total: '1.00' },
      { formaPago: 'efectivo', total: '2.00' },
      { formaPago: 'tarjeta', total: '3.00' },
    ]);

    expect(totales.ventasEnEfectivo).toBe(2);
    expect(totales.ventasEnTarjeta).toBe(1);
    expect(totales.cantidadDeVentas).toBe(3);
  });

  it('sin ninguna venta devuelve ceros canónicos, nunca una cadena vacía ni NaN', () => {
    const totales = totalesPorFormaDePago([]);

    expect(totales).toEqual({
      enEfectivo: '0.00',
      enTarjeta: '0.00',
      general: '0.00',
      ventasEnEfectivo: 0,
      ventasEnTarjeta: 0,
      cantidadDeVentas: 0,
    });
  });

  it('un montón vacío da 0.00 y el otro su suma', () => {
    const totales = totalesPorFormaDePago([{ formaPago: 'tarjeta', total: '3.30' }]);

    expect(totales.enEfectivo).toBe('0.00');
    expect(totales.enTarjeta).toBe('3.30');
    expect(totales.general).toBe('3.30');
  });

  it('acepta la cadena canónica y el Decimal, y da lo mismo con las dos', () => {
    const comoCadena = totalesPorFormaDePago([{ formaPago: 'efectivo', total: '4.165' }]);
    const comoNumero = totalesPorFormaDePago([{ formaPago: 'efectivo', total: 4.165 }]);

    expect(comoCadena.enEfectivo).toBe(comoNumero.enEfectivo);
  });

  it('NO ORDENA NI DESCARTA NADA: suma todo lo que le den, en el orden que le den', () => {
    const ventas = [
      { formaPago: 'efectivo' as const, total: '100.00' },
      { formaPago: 'efectivo' as const, total: '2.50' },
    ];

    expect(totalesPorFormaDePago(ventas).enEfectivo).toBe('102.50');
    expect(totalesPorFormaDePago([...ventas].reverse()).enEfectivo).toBe('102.50');
  });
});

// ===========================================================================
// 2. Una sola fuente
// ===========================================================================

function archivosDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre !== '__tests__') {
        salida.push(...archivosDe(ruta));
      }
    } else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      salida.push(ruta);
    }
  }
  return salida;
}

function arbolDe(ruta: string, codigo = readFileSync(ruta, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(
    ruta,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ruta.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** `true` si el nodo nombra `formaPago`, como identificador o como propiedad. */
function nombraLaFormaDePago(nodo: ts.Node): boolean {
  if (ts.isIdentifier(nodo)) {
    return nodo.text === 'formaPago';
  }
  return ts.isPropertyAccessExpression(nodo) && nodo.name.text === 'formaPago';
}

/** `true` si el nodo es `'efectivo'` o `'tarjeta'`. */
function esUnaFormaDePago(nodo: ts.Node): boolean {
  return ts.isStringLiteral(nodo) && (nodo.text === 'efectivo' || nodo.text === 'tarjeta');
}

/** `true` si en algún lado de este nodo se compara `formaPago` con una de sus dos formas. */
function comparaLaFormaDePago(nodo: ts.Node): boolean {
  if (
    ts.isBinaryExpression(nodo) &&
    ((nombraLaFormaDePago(nodo.left) && esUnaFormaDePago(nodo.right)) ||
      (nombraLaFormaDePago(nodo.right) && esUnaFormaDePago(nodo.left)))
  ) {
    return true;
  }
  return ts.forEachChild(nodo, comparaLaFormaDePago) ?? false;
}

/**
 * Los `.filter(...)` que parten un conjunto por forma de pago.
 *
 * Exportada para que la prueba de control pueda ejercitar el propio detector:
 * uno roto que no encontrara nunca nada dejaría pasar la prueba de arriba en
 * falso, que es lo que este proyecto ya aprendió a no permitir.
 */
export function repartosPorFormaDePagoEn(arbol: ts.SourceFile): number[] {
  const lineas: number[] = [];
  const visitar = (nodo: ts.Node): void => {
    const esFilter =
      ts.isCallExpression(nodo) &&
      ts.isPropertyAccessExpression(nodo.expression) &&
      nodo.expression.name.text === 'filter';

    if (esFilter && nodo.arguments.some((argumento) => comparaLaFormaDePago(argumento))) {
      lineas.push(arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return lineas;
}

describe('El reparto por forma de pago vive en UN SOLO archivo', () => {
  it('ningún archivo del proceso principal, la ventana ni shared lo escribe por su cuenta', () => {
    const encontrados: string[] = [];
    for (const carpeta of CARPETAS) {
      for (const ruta of archivosDe(carpeta)) {
        if (ruta === RUTA_DE_LA_FUENTE) {
          continue;
        }
        for (const linea of repartosPorFormaDePagoEn(arbolDe(ruta))) {
          encontrados.push(
            `${relative(RAIZ_DEL_PROYECTO, ruta)}:${String(linea)} parte un conjunto por forma de pago`,
          );
        }
      }
    }

    expect(encontrados).toEqual([]);
  });

  it('la fuente única SÍ lo hace: es la que tiene que hacerlo', () => {
    expect(repartosPorFormaDePagoEn(arbolDe(RUTA_DE_LA_FUENTE))).toHaveLength(2);
  });

  it('CONTROL DEL DETECTOR: encuentra el reparto cuando está', () => {
    const conElDefecto = arbolDe(
      'inventado.ts',
      `const enEfectivo = ventas.filter((venta) => venta.formaPago === 'efectivo');`,
    );

    expect(repartosPorFormaDePagoEn(conElDefecto)).toEqual([1]);
  });

  it('CONTROL DEL DETECTOR: un `if` sobre UNA venta no es un reparto, y un comentario tampoco', () => {
    const sinElDefecto = arbolDe(
      'inventado.ts',
      [
        `// ventas.filter((venta) => venta.formaPago === 'efectivo')`,
        `if (datos.formaPago === 'tarjeta' && boleta === '') { rechazar(); }`,
        `const activos = productos.filter((uno) => uno.activo);`,
      ].join('\n'),
    );

    expect(repartosPorFormaDePagoEn(sinElDefecto)).toEqual([]);
  });

  it('los dos que la usan la IMPORTAN, y no tienen su propia copia', () => {
    const consumidores = [
      join(RAIZ_DEL_PROYECTO, 'main', 'domain', 'reportes', 'servicio-de-reportes.ts'),
      join(RAIZ_DEL_PROYECTO, 'main', 'ipc', 'recibos.ts'),
    ];

    for (const ruta of consumidores) {
      expect(readFileSync(ruta, 'utf8')).toContain('totalesPorFormaDePago');
      expect(repartosPorFormaDePagoEn(arbolDe(ruta))).toEqual([]);
    }
  });
});
