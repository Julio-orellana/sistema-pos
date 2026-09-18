/**
 * Los arneses de `scripts/` terminan la aplicación por UNA sola vía (§6.2,
 * punto 49).
 *
 * POR QUÉ EXISTE. `npm run verify:pantallas:caja` terminaba a veces con código
 * 1 DESPUÉS de pasar sus 57 comprobaciones. Medido forzando el orden:
 * `app.process()` de Playwright lanza «Cannot read properties of undefined
 * (reading '_object')» si se la llama DESPUÉS de que Playwright procesó el
 * cierre de la aplicación, y responde si se la llama antes. El arnés cerraba
 * la aplicación a propósito y después, en su `finally`, hacía
 * `app.process().kill('SIGKILL')`. Cinco arneses más tenían esa misma línea en
 * su limpieza.
 *
 * LA REGLA. El proceso se guarda justo después de `electron.launch()` y se
 * termina con `terminarAplicacion`, de `scripts/terminar-aplicacion.cjs`. Esta
 * prueba recorre el árbol sintáctico de cada guion y falla, nombrando archivo y
 * línea, si alguno:
 *   1. mata un proceso por su cuenta (`.kill(`) fuera de esa función, o
 *   2. usa el resultado de `.process()` en el acto (`app.process().algo`), que
 *      es la forma que se evalúa tarde y lanza.
 *
 * LO QUE NO PUEDE VER, dicho en voz alta: si alguien guarda `app.process()`
 * en una variable RECIÉN al final, cuando la aplicación ya se cerró, la
 * sintaxis es la misma que la correcta. Eso lo sostiene el comentario junto a
 * cada `const procesoDeLaAplicacion = app.process();`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CARPETA = join(process.cwd(), 'scripts');
const LA_UNICA_VIA = 'terminar-aplicacion.cjs';

interface Hallazgo {
  readonly archivo: string;
  readonly linea: number;
  readonly texto: string;
}

/** Recorre un guion y devuelve cada `.kill(` y cada `.process().algo`. */
function buscar(archivo: string, fuente: string): { matan: Hallazgo[]; encadenan: Hallazgo[] } {
  const arbol = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matan: Hallazgo[] = [];
  const encadenan: Hallazgo[] = [];
  const hallazgo = (nodo: ts.Node): Hallazgo => ({
    archivo,
    linea: arbol.getLineAndCharacterOfPosition(nodo.getStart()).line + 1,
    texto: nodo.getText().replace(/\s+/g, ' ').slice(0, 80),
  });
  const visitar = (nodo: ts.Node): void => {
    if (
      ts.isCallExpression(nodo) &&
      ts.isPropertyAccessExpression(nodo.expression) &&
      nodo.expression.name.text === 'kill'
    ) {
      matan.push(hallazgo(nodo));
    }
    // `algo.process()` usado en el acto: `(algo.process()).loQueSea`.
    if (
      ts.isPropertyAccessExpression(nodo) &&
      ts.isCallExpression(nodo.expression) &&
      ts.isPropertyAccessExpression(nodo.expression.expression) &&
      nodo.expression.expression.name.text === 'process'
    ) {
      encadenan.push(hallazgo(nodo));
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return { matan, encadenan };
}

function guiones(): string[] {
  return readdirSync(CARPETA).filter((nombre) => nombre.endsWith('.cjs'));
}

describe('Los arneses terminan la aplicación por una sola vía (§6.2, punto 49)', () => {
  it('ningún guion mata un proceso por su cuenta: solo terminar-aplicacion.cjs', () => {
    const fuera = guiones()
      .filter((nombre) => nombre !== LA_UNICA_VIA)
      .flatMap((nombre) => buscar(nombre, readFileSync(join(CARPETA, nombre), 'utf8')).matan)
      .map((h) => `scripts/${h.archivo}:${String(h.linea)} ${h.texto}`);
    expect(fuera).toEqual([]);
  });

  it('ningún guion usa `.process()` en el acto: el proceso se guarda al lanzar la aplicación', () => {
    const encadenados = guiones()
      .flatMap((nombre) => buscar(nombre, readFileSync(join(CARPETA, nombre), 'utf8')).encadenan)
      .map((h) => `scripts/${h.archivo}:${String(h.linea)} ${h.texto}`);
    expect(encadenados).toEqual([]);
  });

  it('control: los dos detectores encuentran la forma que costó, y un comentario no cuenta', () => {
    const fuente = [
      '// app.process().kill("SIGKILL") en un comentario no cuenta',
      'function limpiar(app) {',
      "  app.process().kill('SIGKILL');",
      '}',
    ].join('\n');
    const { matan, encadenan } = buscar('ejemplo.cjs', fuente);
    expect(matan.map((h) => h.linea)).toEqual([3]);
    expect(encadenan.map((h) => h.linea)).toEqual([3]);
  });

  it('control: guardar el proceso al lanzar y pasárselo a la función no es un hallazgo', () => {
    const fuente = [
      'const procesoDeLaAplicacion = app.process();',
      'terminarAplicacion(procesoDeLaAplicacion);',
    ].join('\n');
    expect(buscar('ejemplo.cjs', fuente)).toEqual({ matan: [], encadenan: [] });
  });
});

describe('terminarAplicacion: termina el proceso solo si sigue vivo, y no lanza nunca', () => {
  const { terminarAplicacion } = createRequire(import.meta.url)(join(CARPETA, LA_UNICA_VIA)) as {
    terminarAplicacion: (proceso: unknown) => { pid: number | undefined; yaHabiaTerminado: boolean };
  };

  interface ProcesoDeMentira {
    readonly senales: string[];
    readonly objeto: unknown;
  }

  /** Un proceso de mentira que anota cada señal. */
  function proceso(
    estado: { exitCode: number | null; signalCode: string | null },
    alMatar?: () => void,
  ): ProcesoDeMentira {
    const senales: string[] = [];
    return {
      senales,
      objeto: {
        pid: 4242,
        ...estado,
        kill: (senal: string): boolean => {
          senales.push(senal);
          alMatar?.();
          return true;
        },
      },
    };
  }

  it('con la aplicación VIVA le manda SIGKILL una vez', () => {
    const p = proceso({ exitCode: null, signalCode: null });
    expect(terminarAplicacion(p.objeto)).toEqual({ pid: 4242, yaHabiaTerminado: false });
    expect(p.senales).toEqual(['SIGKILL']);
  });

  it('si la aplicación ya salió sola (la salida controlada del arnés de caja), no le manda nada', () => {
    const p = proceso({ exitCode: 0, signalCode: null });
    expect(terminarAplicacion(p.objeto)).toEqual({ pid: 4242, yaHabiaTerminado: true });
    expect(p.senales).toEqual([]);
  });

  it('si ya la había matado una señal, tampoco', () => {
    const p = proceso({ exitCode: null, signalCode: 'SIGKILL' });
    expect(terminarAplicacion(p.objeto).yaHabiaTerminado).toBe(true);
    expect(p.senales).toEqual([]);
  });

  it('si terminó justo entre la pregunta y la señal y `kill` lanza, no lanza', () => {
    const p = proceso({ exitCode: null, signalCode: null }, () => {
      throw new Error('ESRCH');
    });
    expect(() => terminarAplicacion(p.objeto)).not.toThrow();
  });
});
