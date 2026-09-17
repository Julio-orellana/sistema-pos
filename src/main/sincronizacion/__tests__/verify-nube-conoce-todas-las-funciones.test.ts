/**
 * La batería de `npm run verify:nube` prueba las puertas de TODAS las funciones
 * de escritura de la nube, no de una copia vieja de la lista.
 *
 * ===========================================================================
 * POR QUÉ EXISTE ESTA PRUEBA
 * ===========================================================================
 *
 * `scripts/verificacion-de-nube.cjs` es CommonJS y no puede importar
 * `src/shared/contrato-de-sincronizacion.ts`, así que su lista de funciones es
 * una COPIA escrita a mano. Medido el 2026-09-17: la copia tenía las cinco de la
 * 0023 y le faltaba `sincronizar_asiento`, que existe desde la 0027. Durante
 * esos tres días la batería comprobó que la llave publicable, un usuario sin rol
 * y el rol de restauración no pueden llamar a las cinco… y nunca lo comprobó
 * para la sexta. Es el defecto de §4.29 (una función que nada vigila), del lado
 * de las pruebas.
 *
 * El guion no se puede cargar con `require`: al cargarse corre. Por eso se lee
 * su TEXTO con el compilador de TypeScript, como las otras pruebas
 * estructurales del proyecto.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { FUNCIONES_DE_ESCRITURA } from '@shared/contrato-de-sincronizacion';

const RUTA_DEL_GUION = join(__dirname, '..', '..', '..', '..', 'scripts', 'verificacion-de-nube.cjs');

/** Las cadenas del arreglo `const FUNCIONES_DE_ESCRITURA = Object.freeze([...])` de un guion, o null si no está. */
export function funcionesDeEscrituraDelGuion(codigo: string): string[] | null {
  const arbol = ts.createSourceFile('guion.cjs', codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let encontradas: string[] | null = null;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.name.text === 'FUNCIONES_DE_ESCRITURA' && nodo.initializer !== undefined) {
      let valor: ts.Expression = nodo.initializer;
      if (ts.isCallExpression(valor) && valor.arguments[0] !== undefined) {
        valor = valor.arguments[0];
      }
      if (ts.isArrayLiteralExpression(valor)) {
        encontradas = valor.elements.filter(ts.isStringLiteral).map((literal) => literal.text);
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return encontradas;
}

describe('verify:nube prueba las puertas de TODAS las funciones de escritura', () => {
  it('CONTROL: el lector encuentra la lista dentro de Object.freeze y también sin él', () => {
    expect(funcionesDeEscrituraDelGuion("const FUNCIONES_DE_ESCRITURA = Object.freeze(['a', 'b']);")).toEqual(['a', 'b']);
    expect(funcionesDeEscrituraDelGuion("const FUNCIONES_DE_ESCRITURA = ['c'];")).toEqual(['c']);
    expect(funcionesDeEscrituraDelGuion("// const FUNCIONES_DE_ESCRITURA = ['en un comentario'];")).toBeNull();
  });

  it('la lista del guion es EXACTAMENTE la de la terminal: ninguna función sin sus puertas probadas, ninguna de más', () => {
    const delGuion = funcionesDeEscrituraDelGuion(readFileSync(RUTA_DEL_GUION, 'utf8'));
    expect(delGuion, 'el guion ya no declara FUNCIONES_DE_ESCRITURA').not.toBeNull();
    const enElGuion = [...(delGuion ?? [])].sort();
    const enLaTerminal: string[] = [...FUNCIONES_DE_ESCRITURA].sort();
    expect({
      laTerminalLaTieneYElGuionNo: enLaTerminal.filter((f) => !enElGuion.includes(f)),
      elGuionLaTieneYLaTerminalNo: enElGuion.filter((f) => !enLaTerminal.includes(f)),
    }).toEqual({ laTerminalLaTieneYElGuionNo: [], elGuionLaTieneYLaTerminalNo: [] });
  });
});
