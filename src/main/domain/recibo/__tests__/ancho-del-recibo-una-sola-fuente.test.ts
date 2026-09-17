/**
 * EL ANCHO DEL RECIBO EN CARACTERES SE DECLARA UNA SOLA VEZ: `COLUMNAS_80MM`.
 *
 * ===========================================================================
 * POR QUÉ EXISTE (2026-09-17)
 * ===========================================================================
 *
 * `escpos.ts` exportaba `COLUMNAS_TERMICA = 48`, y `plantilla-de-recibo.ts`
 * exportaba `COLUMNAS_80MM = 48`. Nadie usaba la primera: el recibo sale con
 * `COLUMNAS_80MM` (punto 39 de §6.2). Las dos decían lo mismo, pero el día que
 * alguien cambiara una, la otra habría quedado diciendo otra cosa sin que nada
 * fallara. El 48 está respaldado por la ficha de la 3nStar RPT004: 576 puntos
 * ÷ 12 de la Font A (§4.43).
 *
 * Es el mismo criterio de la puerta única del conflicto de inventario y del
 * teclado en pantalla: lo que tiene que existir una sola vez lo vigila una
 * prueba sobre el árbol sintáctico, no la memoria de quien escribe.
 *
 * ===========================================================================
 * LA REGLA
 * ===========================================================================
 *
 * > **Fuera de `COLUMNAS_80MM` en `plantilla-de-recibo.ts`, ningún archivo de
 * > `src/main`, `src/shared` ni `src/renderer` declara un número que sea el
 * > ancho del recibo.** Quien lo necesite importa `COLUMNAS_80MM`.
 *
 * Cuenta como declaración del ancho, en una constante, una variable, un
 * parámetro con valor por omisión, una propiedad o un miembro de enum:
 *
 *   - el literal `48`, se llame como se llame; o
 *   - cualquier número literal con un nombre de ancho en caracteres
 *     («columnas», «caracteres por línea», «ancho en caracteres»).
 *
 * NO cuenta un 48 pasado como argumento (`randomBytes(48)`), ni un comentario.
 * Se revisa el árbol sintáctico con el compilador de TypeScript, sin las
 * pruebas.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const CARPETAS = [
  join(RAIZ, 'src', 'main'),
  join(RAIZ, 'src', 'shared'),
  join(RAIZ, 'src', 'renderer', 'src'),
];

/** La ÚNICA declaración permitida. */
const FUENTE = { archivo: 'src/main/domain/recibo/plantilla-de-recibo.ts', nombre: 'COLUMNAS_80MM' };

const ANCHO = 48;

/**
 * Nombres que dicen «ancho del recibo en caracteres», con o sin guiones bajos.
 * «columnas» va en PLURAL a propósito: `columna` en singular es el índice de un
 * bucle (`qr.ts`), no un ancho.
 */
const NOMBRE_DE_ANCHO = /columnas|caracteres_?por_?linea|ancho_?en_?caracteres/i;

export interface DeclaracionDeAncho {
  readonly archivo: string;
  readonly linea: number;
  readonly nombre: string;
  readonly valor: string;
}

function nombreDe(nodo: ts.Node): string | null {
  if (
    (ts.isVariableDeclaration(nodo) ||
      ts.isParameter(nodo) ||
      ts.isPropertyDeclaration(nodo) ||
      ts.isPropertyAssignment(nodo) ||
      ts.isEnumMember(nodo)) &&
    (ts.isIdentifier(nodo.name) || ts.isStringLiteral(nodo.name))
  ) {
    return nodo.name.text;
  }
  return null;
}

function inicializadorDe(nodo: ts.Node): ts.Expression | undefined {
  if (
    ts.isVariableDeclaration(nodo) ||
    ts.isParameter(nodo) ||
    ts.isPropertyDeclaration(nodo) ||
    ts.isEnumMember(nodo)
  ) {
    return nodo.initializer;
  }
  if (ts.isPropertyAssignment(nodo)) {
    return nodo.initializer;
  }
  return undefined;
}

/** Las declaraciones del ancho en un archivo. Pura, para darle casos armados a mano. */
export function declaracionesDeAncho(archivo: string, fuente: string): DeclaracionDeAncho[] {
  const arbol = ts.createSourceFile(
    archivo,
    fuente,
    ts.ScriptTarget.Latest,
    true,
    archivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const encontradas: DeclaracionDeAncho[] = [];
  const visitar = (nodo: ts.Node): void => {
    const nombre = nombreDe(nodo);
    const inicial = inicializadorDe(nodo);
    if (nombre !== null && inicial !== undefined && ts.isNumericLiteral(inicial)) {
      if (Number(inicial.text) === ANCHO || NOMBRE_DE_ANCHO.test(nombre)) {
        const { line } = arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol));
        encontradas.push({ archivo, linea: line + 1, nombre, valor: inicial.text });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return encontradas;
}

function archivosDeProduccion(carpeta: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre !== '__tests__') {
        salida.push(...archivosDeProduccion(ruta));
      }
    } else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) && !nombre.endsWith('.d.ts')) {
      salida.push(ruta);
    }
  }
  return salida;
}

function todasLasDeclaraciones(): DeclaracionDeAncho[] {
  return CARPETAS.flatMap((carpeta) =>
    archivosDeProduccion(carpeta).flatMap((ruta) =>
      declaracionesDeAncho(relative(RAIZ, ruta).split(sep).join('/'), readFileSync(ruta, 'utf8')),
    ),
  );
}

describe('El ancho del recibo en caracteres se declara UNA sola vez (punto 39)', () => {
  it('CONTROL: el detector encuentra un 48 en una constante, un parámetro por omisión y una propiedad', () => {
    const fuente = [
      'export const COLUMNAS_TERMICA = 48;',
      'function dibujar(texto: string, ancho = 48): void {}',
      'const opciones = { anchoDelTicket: 48 };',
    ].join('\n');
    expect(declaracionesDeAncho('control.ts', fuente).map((d) => d.linea)).toEqual([1, 2, 3]);
  });

  it('CONTROL: encuentra un nombre de ancho aunque el número sea otro (alguien «ajustó» la copia)', () => {
    const fuente = 'const CARACTERES_POR_LINEA = 42;\nenum Papel { columnas = 32 }';
    expect(declaracionesDeAncho('control.ts', fuente).map((d) => d.nombre)).toEqual([
      'CARACTERES_POR_LINEA',
      'columnas',
    ]);
  });

  it('CONTROL: NO cuenta un 48 como argumento, un comentario, ni importar la constante de la fuente', () => {
    const fuente = [
      "import { COLUMNAS_80MM } from './plantilla-de-recibo';",
      '// el ancho es 48',
      'const bytes = randomBytes(48);',
      'const ancho = COLUMNAS_80MM;',
      'const intentos = 3;',
    ].join('\n');
    expect(declaracionesDeAncho('control.ts', fuente)).toEqual([]);
  });

  it('CONTROL: un índice de bucle llamado «columna» (singular) no es un ancho', () => {
    expect(declaracionesDeAncho('control.ts', 'for (let columna = 0; columna < 4; columna += 1) {}')).toEqual([]);
  });

  it('la fuente declara COLUMNAS_80MM = 48, una sola vez', () => {
    const enLaFuente = todasLasDeclaraciones().filter((d) => d.archivo === FUENTE.archivo);
    expect(enLaFuente).toEqual([
      expect.objectContaining({ nombre: FUENTE.nombre, valor: String(ANCHO) }),
    ]);
  });

  it('ningún otro archivo de src/main, src/shared ni src/renderer declara su propia copia del ancho', () => {
    const copias = todasLasDeclaraciones()
      .filter((d) => !(d.archivo === FUENTE.archivo && d.nombre === FUENTE.nombre))
      .map((d) => `${d.archivo}:${String(d.linea)} ${d.nombre} = ${d.valor}`);
    expect(copias).toEqual([]);
  });
});
