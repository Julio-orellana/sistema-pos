/**
 * NADA QUE USE LA RED CORRE ANTES DE QUE LA VENTANA SE VEA.
 *
 * ===========================================================================
 * POR QUÉ EXISTE (2026-09-17)
 * ===========================================================================
 *
 * En la tienda de Jimmy, con la red del local conectada, la aplicación no
 * llegó a mostrar ninguna pantalla, con CPU y disco en 0 %. Sin red, abría
 * normal. Julio pidió que el arranque NUNCA pueda quedar esperando una
 * respuesta de red que podría no llegar jamás.
 *
 * Hasta ese día, la sesión con la nube, el trabajador de sincronización y el
 * sondeo de `net.isOnline()` arrancaban en el mismo turno en que se creaba la
 * ventana, o sea ANTES de que se mostrara. En macOS no la bloqueaban (medido),
 * pero nada impedía que lo hicieran. Desde ese día arrancan dentro de
 * `arrancarLoQueUsaLaRed`, que se llama una sola vez, cuando
 * `mostrarCuandoEsteLista` confirma que la ventana ya se mostró.
 *
 * ===========================================================================
 * LO QUE COMPRUEBA, sobre el árbol sintáctico de `src/main/index.ts`
 * ===========================================================================
 *
 * 1. Toda llamada que usa la red o su estado —`net.fetch`, `fetch`,
 *    `net.isOnline`, y los métodos `arrancar`, `ejecutarAhora`, `comprobar`,
 *    `latir`, `refrescar`, `iniciarSesionConContrasena`, `empujarCambios`—
 *    está en uno de estos lugares:
 *      a. dentro de `arrancarLoQueUsaLaRed` (la compuerta);
 *      b. dentro de una función que es el VALOR de una propiedad de un objeto,
 *         o sea una dependencia inyectada que un servicio llama a pedido y no
 *         al arrancar (`sistemaDiceQueHayRed: () => net.isOnline()`);
 *      c. en la lista de excepciones, con su motivo escrito.
 *    Cualquier otro lugar —el cuerpo del arranque, una función que se invoca a
 *    sí misma, un manejador de evento suelto— es una falla con archivo y línea.
 * 2. `arrancarLoQueUsaLaRed` se llama UNA sola vez, y esa llamada está en el
 *    `.then(...)` de `mostrarCuandoEsteLista(...)`.
 * 3. Controles: la compuerta tiene adentro las llamadas que tiene que tener, y
 *    el detector muerde con casos armados a mano. Sin eso, un método
 *    renombrado dejaría la prueba pasando en falso.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RUTA_DEL_ARRANQUE = join(__dirname, '..', 'index.ts');

/** El nombre de la compuerta. */
const COMPUERTA = 'arrancarLoQueUsaLaRed';

/** Métodos que, llamados, salen a la red o arrancan algo que sale. */
const METODOS_QUE_USAN_LA_RED = new Set([
  'arrancar',
  'ejecutarAhora',
  'comprobar',
  'latir',
  'refrescar',
  'iniciarSesionConContrasena',
  'empujarCambios',
]);

export interface LlamadaDeRed {
  readonly linea: number;
  readonly texto: string;
  readonly donde: 'compuerta' | 'dependencia-inyectada' | 'excepcion' | 'FUERA';
  readonly motivo?: string;
}

export interface AnalisisDelArranque {
  readonly llamadas: readonly LlamadaDeRed[];
  /** Las líneas donde se llama a la compuerta, y si esa llamada está en el `.then` de `mostrarCuandoEsteLista`. */
  readonly llamadasALaCompuerta: readonly { readonly linea: number; readonly despuesDeMostrar: boolean }[];
}

function esFuncion(nodo: ts.Node): nodo is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(nodo) ||
    ts.isFunctionExpression(nodo) ||
    ts.isFunctionDeclaration(nodo) ||
    ts.isMethodDeclaration(nodo)
  );
}

/** Qué se está llamando: `net.fetch`, `fetch`, `.arrancar`… o `null` si no interesa. */
function queUsaLaRed(llamada: ts.CallExpression, arbol: ts.SourceFile): string | null {
  const callee = llamada.expression;
  if (ts.isIdentifier(callee) && callee.text === 'fetch') {
    return 'fetch';
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const nombre = callee.name.text;
    const objeto = callee.expression.getText(arbol);
    if (objeto === 'net' && (nombre === 'fetch' || nombre === 'isOnline' || nombre === 'request')) {
      return `net.${nombre}`;
    }
    if (METODOS_QUE_USAN_LA_RED.has(nombre)) {
      return `${objeto}.${nombre}`;
    }
  }
  return null;
}

/** La función más cercana que encierra al nodo, o `null` si está al nivel del módulo. */
function funcionQueLoEncierra(nodo: ts.Node): ts.FunctionLikeDeclaration | null {
  for (let actual = nodo.parent; !ts.isSourceFile(actual); actual = actual.parent) {
    if (esFuncion(actual)) {
      return actual;
    }
  }
  return null;
}

function esLaCompuerta(funcion: ts.Node): boolean {
  const padre = funcion.parent;
  return (
    ts.isVariableDeclaration(padre) &&
    padre.initializer === funcion &&
    ts.isIdentifier(padre.name) &&
    padre.name.text === COMPUERTA
  );
}

/** ¿Está dentro de la compuerta, a cualquier profundidad? */
function estaEnLaCompuerta(nodo: ts.Node): boolean {
  for (let actual = nodo.parent; !ts.isSourceFile(actual); actual = actual.parent) {
    if (esFuncion(actual) && esLaCompuerta(actual)) {
      return true;
    }
  }
  return false;
}

/** ¿Es el valor de una propiedad de un objeto literal? (`clave: () => …`) */
function esDependenciaInyectada(funcion: ts.FunctionLikeDeclaration): boolean {
  const padre = funcion.parent;
  return ts.isPropertyAssignment(padre) && padre.initializer === funcion;
}

/**
 * Excepciones, con su motivo. Hoy hay una.
 *
 * `protocol.handle('pos-foto', …)` hace `net.fetch(pathToFileURL(ruta))`: lee
 * una foto del DISCO para dársela a la ventana. Es `file:`, no sale a ninguna
 * red, y corre solo cuando la ventana pide una foto.
 */
function excepcion(llamada: ts.CallExpression, funcion: ts.FunctionLikeDeclaration | null, arbol: ts.SourceFile): string | null {
  const primerArgumento = llamada.arguments[0];
  if (
    funcion !== null &&
    llamada.expression.getText(arbol) === 'net.fetch' &&
    primerArgumento !== undefined &&
    primerArgumento.getText(arbol).startsWith('pathToFileURL(') &&
    ts.isCallExpression(funcion.parent) &&
    funcion.parent.expression.getText(arbol) === 'protocol.handle'
  ) {
    return 'protocol.handle lee una foto del disco (file:), no sale a la red';
  }
  return null;
}

/** Pura: se le puede dar un caso armado a mano. */
export function analizarArranque(archivo: string, fuente: string): AnalisisDelArranque {
  const arbol = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const llamadas: LlamadaDeRed[] = [];
  const llamadasALaCompuerta: { linea: number; despuesDeMostrar: boolean }[] = [];
  const lineaDe = (nodo: ts.Node): number => arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1;

  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo)) {
      if (ts.isIdentifier(nodo.expression) && nodo.expression.text === COMPUERTA) {
        const funcion = funcionQueLoEncierra(nodo);
        const llamadaDelThen = funcion?.parent;
        const despuesDeMostrar =
          llamadaDelThen !== undefined &&
          ts.isCallExpression(llamadaDelThen) &&
          ts.isPropertyAccessExpression(llamadaDelThen.expression) &&
          llamadaDelThen.expression.name.text === 'then' &&
          ts.isCallExpression(llamadaDelThen.expression.expression) &&
          llamadaDelThen.expression.expression.expression.getText(arbol) === 'mostrarCuandoEsteLista';
        llamadasALaCompuerta.push({ linea: lineaDe(nodo), despuesDeMostrar });
      }
      const que = queUsaLaRed(nodo, arbol);
      if (que !== null) {
        const funcion = funcionQueLoEncierra(nodo);
        const texto = nodo.getText(arbol).split('\n')[0] ?? que;
        if (estaEnLaCompuerta(nodo)) {
          llamadas.push({ linea: lineaDe(nodo), texto, donde: 'compuerta' });
        } else if (funcion !== null && esDependenciaInyectada(funcion)) {
          llamadas.push({ linea: lineaDe(nodo), texto, donde: 'dependencia-inyectada' });
        } else {
          const motivo = excepcion(nodo, funcion, arbol);
          llamadas.push(
            motivo === null
              ? { linea: lineaDe(nodo), texto, donde: 'FUERA' }
              : { linea: lineaDe(nodo), texto, donde: 'excepcion', motivo },
          );
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return { llamadas, llamadasALaCompuerta };
}

describe('El detector muerde (controles con casos armados a mano)', () => {
  const envolver = (cuerpo: string): string => `app.whenReady().then(() => {\n${cuerpo}\n});`;

  it('un arrancar() en el cuerpo del arranque es una falla', () => {
    const { llamadas } = analizarArranque('caso.ts', envolver('void sesionDeNube?.arrancar();'));
    expect(llamadas.map((l) => l.donde)).toEqual(['FUERA']);
  });

  it('el mismo arrancar() dentro de la compuerta no es falla', () => {
    const { llamadas } = analizarArranque(
      'caso.ts',
      envolver('const arrancarLoQueUsaLaRed = (): void => { void sesionDeNube?.arrancar(); };'),
    );
    expect(llamadas.map((l) => l.donde)).toEqual(['compuerta']);
  });

  it('una dependencia inyectada (clave: () => net.isOnline()) no es falla', () => {
    const { llamadas } = analizarArranque('caso.ts', envolver('new Detector({ sistemaDiceQueHayRed: () => net.isOnline() });'));
    expect(llamadas.map((l) => l.donde)).toEqual(['dependencia-inyectada']);
  });

  it('una función que se invoca a sí misma NO se escapa', () => {
    const { llamadas } = analizarArranque('caso.ts', envolver('void (async () => { await sesionDeNube.arrancar(); })();'));
    expect(llamadas.map((l) => l.donde)).toEqual(['FUERA']);
  });

  it('un manejador de evento suelto (did-finish-load) tampoco se escapa', () => {
    const { llamadas } = analizarArranque(
      'caso.ts',
      envolver("ventana.webContents.once('did-finish-load', () => { net.isOnline(); });"),
    );
    expect(llamadas.map((l) => l.donde)).toEqual(['FUERA']);
  });

  it('llamar a la compuerta fuera del .then de mostrarCuandoEsteLista se detecta', () => {
    const fuera = analizarArranque('caso.ts', envolver('arrancarLoQueUsaLaRed();'));
    expect(fuera.llamadasALaCompuerta.map((l) => l.despuesDeMostrar)).toEqual([false]);
    const dentro = analizarArranque(
      'caso.ts',
      envolver('void mostrarCuandoEsteLista(ventana, {}).then(() => { arrancarLoQueUsaLaRed(); });'),
    );
    expect(dentro.llamadasALaCompuerta.map((l) => l.despuesDeMostrar)).toEqual([true]);
  });

  it('un net.fetch a la red dentro de protocol.handle NO entra por la excepción del archivo local', () => {
    const { llamadas } = analizarArranque(
      'caso.ts',
      envolver("protocol.handle('x', async () => net.fetch('https://example.invalid'));"),
    );
    expect(llamadas.map((l) => l.donde)).toEqual(['FUERA']);
  });
});

describe('src/main/index.ts: nada que use la red corre antes de que la ventana se vea', () => {
  const analisis = analizarArranque('src/main/index.ts', readFileSync(RUTA_DEL_ARRANQUE, 'utf8'));

  it('NINGUNA llamada que usa la red está fuera de la compuerta, de una dependencia inyectada o de una excepción con motivo', () => {
    const fuera = analisis.llamadas
      .filter((llamada) => llamada.donde === 'FUERA')
      .map((llamada) => `src/main/index.ts:${String(llamada.linea)} ${llamada.texto}`);
    expect(fuera).toEqual([]);
  });

  it('la compuerta se llama UNA sola vez, y en el .then de mostrarCuandoEsteLista', () => {
    expect(analisis.llamadasALaCompuerta).toHaveLength(1);
    expect(analisis.llamadasALaCompuerta[0]?.despuesDeMostrar).toBe(true);
  });

  it('CONTROL: la compuerta tiene adentro la sesión con la nube, el trabajador y el sondeo del enlace', () => {
    const enLaCompuerta = analisis.llamadas.filter((llamada) => llamada.donde === 'compuerta').map((llamada) => llamada.texto);
    expect(enLaCompuerta.some((texto) => texto.includes('sesionDeNube?.arrancar'))).toBe(true);
    expect(enLaCompuerta.some((texto) => texto.includes('planificadorDeSincronizacion.arrancar'))).toBe(true);
    expect(enLaCompuerta.some((texto) => texto.includes('net.isOnline'))).toBe(true);
    expect(enLaCompuerta.some((texto) => texto.includes('.latir('))).toBe(true);
  });

  it('las excepciones son exactamente las que tienen motivo escrito (hoy: la foto del disco)', () => {
    const excepciones = analisis.llamadas.filter((llamada) => llamada.donde === 'excepcion');
    expect(excepciones.map((llamada) => llamada.motivo)).toEqual([
      'protocol.handle lee una foto del disco (file:), no sale a la red',
    ]);
  });
});
