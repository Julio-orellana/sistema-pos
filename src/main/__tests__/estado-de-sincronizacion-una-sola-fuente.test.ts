/**
 * El texto, el color y la lista de estados de la sincronización tienen UNA sola
 * fuente: `src/shared/estado-de-sincronizacion.ts`.
 *
 * ===========================================================================
 * POR QUÉ EXISTE ESTA PRUEBA
 * ===========================================================================
 *
 * Hasta el 2026-09-17 la misma verdad estaba escrita en cinco lugares:
 *
 *   1. la unión de estados en `resumen-de-sincronizacion.ts` (proceso principal);
 *   2. la unión otra vez, a mano, en `src/shared/types/ipc.ts`;
 *   3. el texto de la barra en `resumen-de-sincronizacion.ts`;
 *   4. el texto de la barra otra vez en `BarraDeEstado.tsx`;
 *   5. el color, en los dos mismos archivos.
 *
 * Las pruebas de Vitest fijaban la copia del proceso principal (3 y 5), y la
 * que se VE es la de la barra (4). Una prueba que fija un texto que nadie
 * muestra no fija nada. El compilador sí vigilaba que las uniones coincidieran,
 * pero no que los textos dijeran lo mismo.
 *
 * Las etiquetas largas de `PantallaDeSincronizacion.tsx` NO son una copia:
 * dicen otra cosa, más larga, para otra pantalla, y su `Record` sobre la unión
 * obliga al compilador a pedir una por estado.
 *
 * La prueba recorre el árbol sintáctico, no busca texto suelto: un comentario
 * que cite «Nube: al día» no es una copia del texto.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..');
const RAIZ_DEL_RENDERER = join(RAIZ, 'renderer', 'src');
const RAIZ_DEL_PRINCIPAL = join(RAIZ, 'main');
const RUTA_DEL_CONTRATO_IPC = join(RAIZ, 'shared', 'types', 'ipc.ts');

/** El prefijo de todo texto de la barra de nube. */
const PREFIJO_DEL_TEXTO = 'Nube:';

/** Las funciones que solo pueden existir en la fuente única. */
const FUNCIONES_DE_LA_FUENTE = new Set(['textoDeBarraDeEstado', 'colorDeEstado']);

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

/** Los literales de texto (y los pedazos de plantilla) que contienen el prefijo. */
export function textosDeNubeEn(arbol: ts.SourceFile): { linea: number; texto: string }[] {
  const encontrados: { linea: number; texto: string }[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (
      ts.isStringLiteral(nodo) ||
      ts.isNoSubstitutionTemplateLiteral(nodo) ||
      ts.isTemplateHead(nodo) ||
      ts.isTemplateMiddle(nodo) ||
      ts.isTemplateTail(nodo) ||
      ts.isJsxText(nodo)
    ) {
      if (nodo.text.includes(PREFIJO_DEL_TEXTO)) {
        encontrados.push({
          linea: arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1,
          texto: nodo.text,
        });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return encontrados;
}

/** Declaraciones de funciones que se llaman como las de la fuente única. */
export function funcionesDeLaFuenteEn(arbol: ts.SourceFile): { linea: number; nombre: string }[] {
  const encontradas: { linea: number; nombre: string }[] = [];
  const visitar = (nodo: ts.Node): void => {
    let nombre: string | null = null;
    if (ts.isFunctionDeclaration(nodo) && nodo.name !== undefined) {
      nombre = nodo.name.text;
    } else if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name)) {
      nombre = nodo.name.text;
    }
    if (nombre !== null && FUNCIONES_DE_LA_FUENTE.has(nombre)) {
      encontradas.push({
        linea: arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1,
        nombre,
      });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return encontradas;
}

function relativa(ruta: string): string {
  return relative(RAIZ, ruta).split(sep).join('/');
}

describe('El texto de la barra de nube vive en UN solo archivo', () => {
  it('CONTROL: el detector encuentra un texto «Nube: …» en un literal y en una plantilla, y NO en un comentario', () => {
    const arbol = arbolDe(
      'control.tsx',
      [
        '// Nube: al día (esto es un comentario y no cuenta)',
        "const a = 'Nube: al día';",
        'const b = `Nube: ${String(2)} pendientes`;',
        'const c = <span>Nube: DETENIDA</span>;',
      ].join('\n'),
    );
    expect(textosDeNubeEn(arbol).map((t) => t.linea)).toEqual([2, 3, 4]);
  });

  it('ningún archivo del renderer escribe un texto «Nube: …» por su cuenta', () => {
    const copias = archivosDe(RAIZ_DEL_RENDERER).flatMap((ruta) =>
      textosDeNubeEn(arbolDe(ruta)).map((t) => `${relativa(ruta)}:${String(t.linea)} «${t.texto}»`),
    );
    expect(copias).toEqual([]);
  });

  it('ningún archivo del proceso principal escribe un texto «Nube: …» por su cuenta', () => {
    const copias = archivosDe(RAIZ_DEL_PRINCIPAL).flatMap((ruta) =>
      textosDeNubeEn(arbolDe(ruta)).map((t) => `${relativa(ruta)}:${String(t.linea)} «${t.texto}»`),
    );
    expect(copias).toEqual([]);
  });

  it('CONTROL: el detector de funciones encuentra una declaración y una flecha con esos nombres', () => {
    const arbol = arbolDe(
      'control.ts',
      'function textoDeBarraDeEstado() {}\nconst colorDeEstado = () => 1;\nconst otra = 2;',
    );
    expect(funcionesDeLaFuenteEn(arbol).map((f) => f.nombre)).toEqual([
      'textoDeBarraDeEstado',
      'colorDeEstado',
    ]);
  });

  it('ni el renderer ni el proceso principal declaran su propio textoDeBarraDeEstado o colorDeEstado', () => {
    const copias = [...archivosDe(RAIZ_DEL_RENDERER), ...archivosDe(RAIZ_DEL_PRINCIPAL)].flatMap((ruta) =>
      funcionesDeLaFuenteEn(arbolDe(ruta)).map((f) => `${relativa(ruta)}:${String(f.linea)} ${f.nombre}`),
    );
    expect(copias).toEqual([]);
  });

  it('la fuente única SÍ tiene los textos (si no, la búsqueda de arriba no probaría nada)', () => {
    const textos = textosDeNubeEn(arbolDe(join(RAIZ, 'shared', 'estado-de-sincronizacion.ts')));
    expect(textos.length).toBeGreaterThanOrEqual(6);
  });

  it('la unión del contrato IPC es la de la fuente única, no una lista escrita a mano', () => {
    const arbol = arbolDe(RUTA_DEL_CONTRATO_IPC);
    let definicion: ts.TypeNode | null = null;
    const visitar = (nodo: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(nodo) && nodo.name.text === 'EstadoDeSincronizacionIpc') {
        definicion = nodo.type;
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(arbol);
    expect(definicion).not.toBeNull();
    const nodo = definicion as unknown as ts.TypeNode;
    expect(ts.isTypeReferenceNode(nodo) && nodo.typeName.getText(arbol)).toBe('EstadoDeSincronizacion');
  });
});
