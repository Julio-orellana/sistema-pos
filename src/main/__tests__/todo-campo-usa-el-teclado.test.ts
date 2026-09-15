/**
 * TODO CAMPO DONDE SE ESCRIBE PASA POR EL TECLADO EN PANTALLA. Sin excepciones
 * no escritas.
 *
 * ===========================================================================
 * POR QUÉ EXISTE (2026-09-15)
 * ===========================================================================
 *
 * La tienda es una pantalla táctil sin teclado físico garantizado: un campo
 * que no abre el teclado en pantalla es un campo que NO SE PUEDE USAR. Jimmy lo
 * encontró primero en los formularios de productos y categorías (§4.39), se
 * arreglaron esos, y el 2026-09-15 apareció el diálogo de salida controlada
 * con el mismo defecto: un `<input type="password">` nativo, escrito el
 * 2026-09-04, dos días antes de que existiera cualquier teclado en pantalla, y
 * nunca migrado. La auditoría de ese día encontró VEINTIÚN campos más.
 *
 * El problema no era un campo: era que agregar un `<input>` suelto no hacía
 * fallar nada. Es la misma clase de hueco que ya se cerró con «todo asiento de
 * auditoría pasa por el envoltorio» y «todo canal IPC responde algo
 * serializable», y se cierra igual: con una prueba que recorre el código.
 *
 * ===========================================================================
 * LAS DOS REGLAS
 * ===========================================================================
 *
 * 1. **Ningún archivo del renderer dibuja un `<input>`, un `<textarea>` ni un
 *    `contentEditable` por su cuenta.** La única puerta es
 *    `components/TecladoEnPantalla.tsx` (`CampoDeTexto` y `CampoDeFecha`). Un
 *    PIN que se confirma solo usa `TecladoNumerico`, que no tiene ningún campo.
 *    Se admiten afuera SOLO los `<input type="radio">` y `type="checkbox"` con
 *    el tipo escrito literal: se tocan, no reciben texto.
 *
 * 2. **En `App.tsx`, el `ProveedorDeTeclado` es el único hijo de `<main>`.**
 *    Fuera del proveedor, un `CampoDeTexto` se degrada EN SILENCIO a un campo
 *    común sin teclado. El diálogo de salida estaba montado afuera, así que ni
 *    migrar su campo le habría servido.
 *
 * Es una comprobación sobre el ÁRBOL SINTÁCTICO, con el compilador de
 * TypeScript, y no sobre el texto: un `<input>` citado en un comentario no
 * cuenta, y un `<input` partido en varias líneas tampoco se escapa.
 *
 * Vive en `src/main/__tests__` y no junto a los componentes porque necesita
 * leer archivos (`node:fs`), y el proyecto de TypeScript del renderer no tiene
 * los tipos de Node a propósito.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ_DEL_RENDERER = join(__dirname, '..', '..', 'renderer', 'src');

/** El ÚNICO archivo que puede dibujar un campo nativo. */
const MODULO_DEL_TECLADO = join('components', 'TecladoEnPantalla.tsx');

/**
 * Archivos que pueden dibujar un campo nativo SIN el teclado, con su razón.
 *
 * Está vacía a propósito. Si alguna vez hace falta una, la razón va escrita al
 * lado: una lista de excepciones sin motivos deja de significar algo.
 */
const EXCEPCIONES_CON_MOTIVO: Readonly<Record<string, string>> = {};

/** Tipos de `<input>` que se tocan y no reciben texto. */
const TIPOS_QUE_NO_RECIBEN_TEXTO = new Set(['radio', 'checkbox']);

/** Un campo que no pasa por el teclado, con dónde está. */
export interface CampoSinTeclado {
  readonly archivo: string;
  readonly linea: number;
  readonly que: string;
}

/**
 * Los campos de texto que un archivo dibuja por su cuenta.
 *
 * Pura: recibe el nombre y el texto, así se le puede dar un caso armado a mano
 * y comprobar que el detector muerde.
 */
export function camposSinTeclado(archivo: string, fuente: string): CampoSinTeclado[] {
  const arbol = ts.createSourceFile(
    archivo,
    fuente,
    ts.ScriptTarget.Latest,
    true,
    archivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const encontrados: CampoSinTeclado[] = [];
  const anotar = (nodo: ts.Node, que: string): void => {
    const { line } = arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol));
    encontrados.push({ archivo, linea: line + 1, que });
  };

  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const etiqueta = nodo.tagName.getText(arbol);
      if (etiqueta === 'input') {
        const tipo = tipoLiteral(nodo.attributes);
        if (tipo === null || !TIPOS_QUE_NO_RECIBEN_TEXTO.has(tipo)) {
          anotar(nodo, `<input${tipo === null ? '' : ` type="${tipo}"`}>`);
        }
      } else if (etiqueta === 'textarea') {
        anotar(nodo, '<textarea>');
      }
    }
    if (ts.isJsxAttribute(nodo) && /^contenteditable$/i.test(nodo.name.getText(arbol))) {
      anotar(nodo, 'contentEditable');
    }
    if (
      ts.isCallExpression(nodo) &&
      /(^|\.)createElement$/.test(nodo.expression.getText(arbol)) &&
      nodo.arguments.length > 0
    ) {
      const primero = nodo.arguments[0];
      if (
        primero !== undefined &&
        ts.isStringLiteralLike(primero) &&
        (primero.text === 'input' || primero.text === 'textarea')
      ) {
        anotar(nodo, `createElement('${primero.text}')`);
      }
    }
    if (
      ts.isBinaryExpression(nodo) &&
      nodo.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      /\.contentEditable$/i.test(nodo.left.getText(arbol))
    ) {
      anotar(nodo, '.contentEditable =');
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return encontrados;
}

/** El valor de `type="…"` si está escrito literal; `null` si no está o no es literal. */
function tipoLiteral(atributos: ts.JsxAttributes): string | null {
  for (const atributo of atributos.properties) {
    if (ts.isJsxAttribute(atributo) && atributo.name.getText() === 'type') {
      const inicial = atributo.initializer;
      if (inicial !== undefined && ts.isStringLiteral(inicial)) {
        return inicial.text;
      }
      // `type={algo}`: no se puede saber qué va a ser. Cuenta como campo.
      return null;
    }
  }
  return null;
}

/**
 * ¿`<main>` tiene al `ProveedorDeTeclado` como único hijo?
 *
 * Devuelve la lista de lo que sobra, vacía si está bien.
 */
export function hijosDeMainFueraDelProveedor(fuente: string): string[] {
  const arbol = ts.createSourceFile('App.tsx', fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const encontrado: { hijos: string[] | null } = { hijos: null };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxElement(nodo) && nodo.openingElement.tagName.getText(arbol) === 'main') {
      encontrado.hijos = nodo.children
        .filter((hijo) => !(ts.isJsxText(hijo) && hijo.containsOnlyTriviaWhiteSpaces))
        // `{/* comentario */}` es una expresión vacía: no dibuja nada.
        .filter((hijo) => !(ts.isJsxExpression(hijo) && hijo.expression === undefined))
        .map((hijo) =>
          ts.isJsxElement(hijo)
            ? hijo.openingElement.tagName.getText(arbol)
            : ts.isJsxSelfClosingElement(hijo)
              ? hijo.tagName.getText(arbol)
              : hijo.getText(arbol),
        );
      return;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  const lista = encontrado.hijos;
  if (lista === null) {
    return ['(no se encontró <main> en App.tsx)'];
  }
  return lista.length === 1 && lista[0] === 'ProveedorDeTeclado' ? [] : lista;
}

/** Todos los `.ts` y `.tsx` del renderer, sin las pruebas. */
function archivosDelRenderer(carpeta: string = RAIZ_DEL_RENDERER): string[] {
  const archivos: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre !== '__tests__') {
        archivos.push(...archivosDelRenderer(ruta));
      }
    } else if (/\.tsx?$/.test(nombre) && !nombre.endsWith('.d.ts')) {
      archivos.push(ruta);
    }
  }
  return archivos;
}

/** Lo que el renderer de HOY dibuja sin teclado, fuera del módulo permitido. */
function camposSinTecladoEnElRenderer(): CampoSinTeclado[] {
  return archivosDelRenderer()
    .map((ruta) => ({ ruta, nombre: relative(RAIZ_DEL_RENDERER, ruta).split(sep).join('/') }))
    .filter(({ nombre }) => nombre !== MODULO_DEL_TECLADO.split(sep).join('/'))
    .filter(({ nombre }) => EXCEPCIONES_CON_MOTIVO[nombre] === undefined)
    .flatMap(({ ruta, nombre }) => camposSinTeclado(nombre, readFileSync(ruta, 'utf8')));
}

describe('Ningún campo del renderer se salta el teclado en pantalla', () => {
  it('el recorrido encuentra los archivos del renderer (si no, la prueba pasaría en falso)', () => {
    const nombres = archivosDelRenderer().map((ruta) => relative(RAIZ_DEL_RENDERER, ruta));
    expect(nombres.length).toBeGreaterThan(30);
    expect(nombres).toContain(join('components', 'ModalDeSalida.tsx'));
    expect(nombres).toContain(MODULO_DEL_TECLADO);
  });

  it('NINGÚN archivo fuera de TecladoEnPantalla.tsx dibuja un <input> de texto, un <textarea> ni un contentEditable', () => {
    const encontrados = camposSinTecladoEnElRenderer();
    expect(
      encontrados.map(
        ({ archivo, linea, que }) =>
          `${archivo}:${String(linea)} dibuja ${que} por su cuenta: usá CampoDeTexto o CampoDeFecha ` +
          '(components/TecladoEnPantalla.tsx), o TecladoNumerico para un PIN. En la pantalla táctil de la ' +
          'tienda, sin teclado físico, un campo nativo no se puede usar.',
      ),
    ).toEqual([]);
  });

  it('el módulo del teclado SÍ dibuja sus campos nativos (si no, la exclusión no estaría excluyendo nada)', () => {
    const fuente = readFileSync(join(RAIZ_DEL_RENDERER, MODULO_DEL_TECLADO), 'utf8');
    expect(camposSinTeclado(MODULO_DEL_TECLADO, fuente).length).toBeGreaterThanOrEqual(2);
  });

  it('toda excepción lleva su motivo escrito', () => {
    for (const [archivo, motivo] of Object.entries(EXCEPCIONES_CON_MOTIVO)) {
      expect(motivo.trim().length, `la excepción de ${archivo} no dice por qué`).toBeGreaterThan(20);
    }
  });

  it('en App.tsx, el ProveedorDeTeclado es el ÚNICO hijo de <main>: nada queda montado fuera del teclado', () => {
    const fuente = readFileSync(join(RAIZ_DEL_RENDERER, 'App.tsx'), 'utf8');
    expect(hijosDeMainFueraDelProveedor(fuente)).toEqual([]);
  });
});

describe('Control del propio detector: muerde lo que tiene que morder y nada más', () => {
  it('marca un <input> sin tipo, con nombre de archivo y línea', () => {
    const fuente = ['export function F() {', '  return (', '    <input value="x" />', '  );', '}'].join('\n');
    expect(camposSinTeclado('components/F.tsx', fuente)).toEqual([
      { archivo: 'components/F.tsx', linea: 3, que: '<input>' },
    ]);
  });

  it('marca password, text, search, email, date y datetime-local', () => {
    for (const tipo of ['password', 'text', 'search', 'email', 'date', 'datetime-local', 'number']) {
      const fuente = `export const F = () => <label><input type="${tipo}" /></label>;`;
      expect(camposSinTeclado('F.tsx', fuente), tipo).toHaveLength(1);
    }
  });

  it('marca un <input> con el tipo calculado, porque no se puede saber qué va a ser', () => {
    expect(camposSinTeclado('F.tsx', 'export const F = (t: string) => <input type={t} />;')).toHaveLength(1);
  });

  it('marca un <input> partido en varias líneas y con hijos', () => {
    const fuente = 'export const F = () => (\n  <input\n    className="x"\n  ></input>\n);';
    expect(camposSinTeclado('F.tsx', fuente)).toEqual([{ archivo: 'F.tsx', linea: 2, que: '<input>' }]);
  });

  it('marca <textarea>, contentEditable y createElement("input")', () => {
    expect(camposSinTeclado('F.tsx', 'export const F = () => <textarea />;')).toHaveLength(1);
    expect(camposSinTeclado('F.tsx', 'export const F = () => <div contentEditable />;')).toHaveLength(1);
    expect(
      camposSinTeclado('F.ts', "import { createElement } from 'react';\nexport const F = () => createElement('input');"),
    ).toHaveLength(1);
    expect(camposSinTeclado('F.ts', "export const F = () => document.createElement('textarea');")).toHaveLength(1);
    expect(camposSinTeclado('F.ts', 'export const F = (e: HTMLElement) => { e.contentEditable = "true"; };')).toHaveLength(1);
  });

  it('NO marca radio ni checkbox, ni un <input> citado en un comentario, ni un CampoDeTexto', () => {
    const fuente = [
      '/** Antes era un `<input type="password">`. */',
      'export const F = () => (',
      '  <>',
      '    {/* <input /> */}',
      '    <input type="radio" name="a" />',
      '    <input type="checkbox" />',
      '    <CampoDeTexto etiqueta="x" valor="" alCambiar={() => {}} />',
      '    <select><option>a</option></select>',
      '  </>',
      ');',
    ].join('\n');
    expect(camposSinTeclado('F.tsx', fuente)).toEqual([]);
  });

  it('el control de App.tsx marca un componente montado FUERA del proveedor', () => {
    const mal = [
      'export const App = () => (',
      '  <main className="pantalla">',
      '    <ModalDeSalida />',
      '    <ProveedorDeTeclado>{contenido}</ProveedorDeTeclado>',
      '  </main>',
      ');',
    ].join('\n');
    expect(hijosDeMainFueraDelProveedor(mal)).toEqual(['ModalDeSalida', 'ProveedorDeTeclado']);
    const bien = [
      'export const App = () => (',
      '  <main className="pantalla">',
      '    {/* comentario */}',
      '    <ProveedorDeTeclado><ModalDeSalida />{contenido}</ProveedorDeTeclado>',
      '  </main>',
      ');',
    ].join('\n');
    expect(hijosDeMainFueraDelProveedor(bien)).toEqual([]);
  });
});
