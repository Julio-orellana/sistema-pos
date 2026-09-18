/**
 * NINGÚN CAMINO MANDA A LA TÉRMICA LA VERSIÓN DE PANTALLA DEL RECIBO
 * (spec/features/001-recibo-copia-tienda-cliente, CA-16 y CA-18).
 *
 * ===========================================================================
 * POR QUÉ EXISTE
 * ===========================================================================
 *
 * Desde la spec 001 hay tres textos del recibo: la copia del cliente, la de la
 * tienda y la versión de pantalla. La de pantalla lleva los dos datos de
 * control interno —quién autorizó un descuento y el número de boleta— y no
 * lleva encabezado de copia. Si algún día un camino nuevo la mandara a la
 * térmica, el cliente se llevaría esos datos a su casa **sin que nada
 * fallara**: el papel saldría igual de prolijo.
 *
 * El parámetro `destino` de `reciboComoTexto` es obligatorio, así que el
 * compilador ya obliga a decir para qué es cada texto. Esta prueba cierra lo
 * que el compilador no ve: QUÉ destino se pide DÓNDE.
 *
 * ===========================================================================
 * LAS REGLAS
 * ===========================================================================
 *
 * En el código de producción de `src/main` (sin las pruebas):
 *
 *   1. Toda llamada a `reciboComoTexto` dice su destino.
 *   2. **El destino `'pantalla'` solo lo pide `src/main/ipc/recibos.ts`**, que
 *      es la pantalla del historial.
 *   3. Un destino que no es un literal solo existe dentro de
 *      `textosDeLasCopias`, que recorre la lista de copias.
 *   4. Un comprobante de `tipo: 'recibo'` arma `copiasEnTexto` con
 *      `textosDeLasCopias(...)`, y con nada más: es la única lista de copias y
 *      el único orden.
 *   5. `copiasEnTexto` nunca se arma llamando a `reciboComoTexto` a mano.
 *
 * Otros comprobantes que no sean recibos (un corte de caja impreso, algún día)
 * pueden armar sus copias como quieran: esta prueba vigila el recibo.
 *
 * Se revisa el árbol sintáctico con el compilador de TypeScript, así que un
 * comentario o una cadena que nombre estas funciones no cuenta.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const CARPETA = join(RAIZ, 'src', 'main');

/** El único archivo que pide la versión de pantalla. */
const LA_PANTALLA = 'src/main/ipc/recibos.ts';
/** Donde vive `textosDeLasCopias`, la única que pasa un destino que no es un literal. */
const LA_PLANTILLA = 'src/main/domain/recibo/plantilla-de-recibo.ts';

export interface HallazgoDeCopias {
  readonly archivo: string;
  readonly linea: number;
  readonly detalle: string;
}

/** ¿Es una llamada a la función con ese nombre, suelta o como `x.nombre(...)`? */
function llamaA(nodo: ts.Node, nombre: string): nodo is ts.CallExpression {
  if (!ts.isCallExpression(nodo)) {
    return false;
  }
  const llamado = nodo.expression;
  return (
    (ts.isIdentifier(llamado) && llamado.text === nombre) ||
    (ts.isPropertyAccessExpression(llamado) && llamado.name.text === nombre)
  );
}

/** ¿Hay alguna llamada a `nombre` en cualquier parte de este subárbol? */
function contieneLlamadaA(nodo: ts.Node, nombre: string): boolean {
  if (llamaA(nodo, nombre)) {
    return true;
  }
  return ts.forEachChild(nodo, (hijo) => (contieneLlamadaA(hijo, nombre) ? true : undefined)) ?? false;
}

/** ¿El nodo está dentro de la función declarada con ese nombre? */
function dentroDeLaFuncion(nodo: ts.Node, nombre: string): boolean {
  let actual: ts.Node = nodo;
  while (!ts.isSourceFile(actual)) {
    actual = actual.parent;
    if (ts.isFunctionDeclaration(actual) && actual.name?.text === nombre) {
      return true;
    }
  }
  return false;
}

/** El nombre de una propiedad de un objeto literal, si es un identificador o una cadena. */
function nombreDePropiedad(propiedad: ts.ObjectLiteralElementLike): string | null {
  const nombre = propiedad.name;
  if (nombre !== undefined && (ts.isIdentifier(nombre) || ts.isStringLiteral(nombre))) {
    return nombre.text;
  }
  return null;
}

/** Lo que infringe las reglas en un archivo. Pura, para darle casos armados a mano. */
export function hallazgosDeCopias(archivo: string, fuente: string): HallazgoDeCopias[] {
  const arbol = ts.createSourceFile(
    archivo,
    fuente,
    ts.ScriptTarget.Latest,
    true,
    archivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hallazgos: HallazgoDeCopias[] = [];
  const anotar = (nodo: ts.Node, detalle: string): void => {
    const { line } = arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol));
    hallazgos.push({ archivo, linea: line + 1, detalle });
  };

  const visitar = (nodo: ts.Node): void => {
    if (llamaA(nodo, 'reciboComoTexto')) {
      const destino = nodo.arguments[1];
      if (destino === undefined) {
        anotar(nodo, 'reciboComoTexto sin destino');
      } else if (ts.isStringLiteral(destino) || ts.isNoSubstitutionTemplateLiteral(destino)) {
        if (destino.text === 'pantalla' && archivo !== LA_PANTALLA) {
          anotar(nodo, `pide la versión de PANTALLA fuera de ${LA_PANTALLA}`);
        }
      } else if (!(archivo === LA_PLANTILLA && dentroDeLaFuncion(nodo, 'textosDeLasCopias'))) {
        anotar(nodo, `destino que no es un literal (${destino.getText(arbol)}) fuera de textosDeLasCopias`);
      }
    }

    if (ts.isObjectLiteralExpression(nodo)) {
      const esUnRecibo = nodo.properties.some(
        (propiedad) =>
          ts.isPropertyAssignment(propiedad) &&
          nombreDePropiedad(propiedad) === 'tipo' &&
          ts.isStringLiteral(propiedad.initializer) &&
          propiedad.initializer.text === 'recibo',
      );
      for (const propiedad of nodo.properties) {
        if (nombreDePropiedad(propiedad) !== 'copiasEnTexto') {
          continue;
        }
        if (ts.isShorthandPropertyAssignment(propiedad)) {
          if (esUnRecibo) {
            anotar(propiedad, 'copiasEnTexto de un recibo sale de una variable, no de textosDeLasCopias(...)');
          }
          continue;
        }
        if (!ts.isPropertyAssignment(propiedad)) {
          continue;
        }
        if (contieneLlamadaA(propiedad.initializer, 'reciboComoTexto')) {
          anotar(propiedad, 'copiasEnTexto se arma llamando a reciboComoTexto a mano');
        }
        if (esUnRecibo && !llamaA(propiedad.initializer, 'textosDeLasCopias')) {
          anotar(propiedad, `copiasEnTexto de un recibo no sale de textosDeLasCopias(...): ${propiedad.initializer.getText(arbol)}`);
        }
      }
    }

    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return hallazgos;
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

function fuentesDeProduccion(): { archivo: string; fuente: string }[] {
  return archivosDeProduccion(CARPETA).map((ruta) => ({
    archivo: relative(RAIZ, ruta).split(sep).join('/'),
    fuente: readFileSync(ruta, 'utf8'),
  }));
}

describe('Ningún camino manda a la térmica la versión de pantalla del recibo (spec 001)', () => {
  // ---- Controles del detector: sin ellos, una búsqueda rota pasaría en falso.
  it('CONTROL: encuentra la versión de pantalla pedida desde otro archivo', () => {
    const fuente = "const texto = reciboComoTexto(modelo, 'pantalla');";
    expect(hallazgosDeCopias('src/main/otro.ts', fuente)).toEqual([
      { archivo: 'src/main/otro.ts', linea: 1, detalle: `pide la versión de PANTALLA fuera de ${LA_PANTALLA}` },
    ]);
  });

  it('CONTROL: encuentra un destino armado en una variable fuera de textosDeLasCopias', () => {
    const fuente = "const destino = elegir();\nconst texto = reciboComoTexto(modelo, destino);";
    expect(hallazgosDeCopias('src/main/otro.ts', fuente).map((h) => h.linea)).toEqual([2]);
  });

  it('CONTROL: encuentra un recibo que manda a la térmica un texto armado a mano', () => {
    const fuente = [
      'const comprobante = {',
      "  tipo: 'recibo',",
      "  copiasEnTexto: [reciboComoTexto(modelo, 'pantalla')],",
      '};',
    ].join('\n');
    expect(hallazgosDeCopias('src/main/domain/recibo/servicio-de-recibos.ts', fuente).map((h) => h.detalle)).toEqual([
      'copiasEnTexto se arma llamando a reciboComoTexto a mano',
      "copiasEnTexto de un recibo no sale de textosDeLasCopias(...): [reciboComoTexto(modelo, 'pantalla')]",
      `pide la versión de PANTALLA fuera de ${LA_PANTALLA}`,
    ]);
  });

  it('CONTROL: también encuentra las dos copias armadas a mano en otro orden (esquivan la lista única)', () => {
    const fuente = "const c = { tipo: 'recibo', copiasEnTexto: [reciboComoTexto(m, 'tienda'), reciboComoTexto(m, 'cliente')] };";
    expect(hallazgosDeCopias('src/main/otro.ts', fuente).map((h) => h.detalle)).toContain(
      'copiasEnTexto se arma llamando a reciboComoTexto a mano',
    );
  });

  it('CONTROL: NO cuenta un comentario, ni la función de la plantilla, ni el comprobante de otra cosa', () => {
    const plantilla = [
      "// reciboComoTexto(modelo, 'pantalla') en un comentario no cuenta",
      'export function textosDeLasCopias(modelo: ModeloDeRecibo): readonly string[] {',
      '  return COPIAS_QUE_SE_IMPRIMEN.map((copia) => reciboComoTexto(modelo, copia));',
      '}',
    ].join('\n');
    expect(hallazgosDeCopias(LA_PLANTILLA, plantilla)).toEqual([]);
    const otroComprobante = "const c = { tipo: 'corte_de_caja', copiasEnTexto: ['uno', 'dos'] };";
    expect(hallazgosDeCopias('src/main/otro.ts', otroComprobante)).toEqual([]);
    const pantalla = "texto: reciboComoTexto(modelo, 'pantalla'),";
    expect(hallazgosDeCopias(LA_PANTALLA, `const x = { ${pantalla} };`)).toEqual([]);
  });

  // ---- El código de verdad -------------------------------------------------
  it('el código de producción de src/main cumple las cinco reglas', () => {
    const hallazgos = fuentesDeProduccion()
      .flatMap(({ archivo, fuente }) => hallazgosDeCopias(archivo, fuente))
      .map((h) => `${h.archivo}:${String(h.linea)} ${h.detalle}`);
    expect(hallazgos).toEqual([]);
  });

  it('y lo que vigila EXISTE: la pantalla pide su versión, y el servicio arma las copias con textosDeLasCopias', () => {
    const fuentes = new Map(fuentesDeProduccion().map(({ archivo, fuente }) => [archivo, fuente]));
    expect(fuentes.get(LA_PANTALLA)).toMatch(/reciboComoTexto\([^)]*'pantalla'\)/);
    expect(fuentes.get('src/main/domain/recibo/servicio-de-recibos.ts')).toMatch(
      /copiasEnTexto:\s*textosDeLasCopias\(modelo\)/,
    );
  });
});
