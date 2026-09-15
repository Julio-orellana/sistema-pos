/**
 * EL ASIENTO `conflicto_de_inventario` SE ESCRIBE POR UNA SOLA PUERTA.
 *
 * ===========================================================================
 * POR QUÉ EXISTE (2026-09-15)
 * ===========================================================================
 *
 * La venta y la anulación escribían la misma acción, cada una por su cuenta, y
 * quedaron con dos formas distintas: `comparacion` / `saldoQueSeLeyo` /
 * `momento` en una, `detalle` / `saldoLeido` / `causaTecnica` en la otra. Se
 * escribieron a la vez, sin verse, y nada fallaba. Julio decidió una forma
 * única, que vive en `conflicto-de-inventario.ts`.
 *
 * Alinear los dos servicios no alcanza: el tercero que escriba esta acción el
 * año que viene vuelve a abrir el hueco. Es el mismo criterio de «todo asiento
 * pasa por el envoltorio» y de «todo campo pasa por el teclado».
 *
 * ===========================================================================
 * LA REGLA
 * ===========================================================================
 *
 * > **El texto `conflicto_de_inventario` aparece, como cadena, en UN SOLO
 * > archivo del código de producción: `domain/venta/conflicto-de-inventario.ts`.**
 * > Tampoco se puede importar su constante desde otro lado.
 *
 * Sin la cadena ni la constante no hay forma de escribir esa acción, así que
 * todo asiento de conflicto pasa por `dejarConstanciaDelConflictoDeInventario`,
 * que arma la forma única con `valorDelConflictoDeInventario`.
 *
 * Se revisa el ÁRBOL SINTÁCTICO con el compilador de TypeScript, no el texto:
 * un comentario que nombre la acción no cuenta. Se revisan `src/main` y
 * `src/shared`, sin las pruebas.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const CARPETAS = [join(RAIZ, 'src', 'main'), join(RAIZ, 'src', 'shared')];

/** La ÚNICA puerta. */
const PUERTA = 'src/main/domain/venta/conflicto-de-inventario.ts';

const ACCION = 'conflicto_de_inventario';
const CONSTANTE = 'ACCION_CONFLICTO_DE_INVENTARIO';

/**
 * Archivos que pueden nombrar la acción fuera de la puerta, con su razón.
 *
 * Está vacía a propósito: una entrada sin motivo escrito hace fallar otra prueba.
 */
const EXCEPCIONES_CON_MOTIVO: Readonly<Record<string, string>> = {};

export interface UsoDeLaAccion {
  readonly archivo: string;
  readonly linea: number;
  readonly que: string;
}

/**
 * Dónde nombra un archivo la acción del conflicto: una cadena (también dentro
 * de una plantilla) o la constante. Pura, para darle casos armados a mano.
 */
export function usosDeLaAccion(archivo: string, fuente: string): UsoDeLaAccion[] {
  const arbol = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const usos: UsoDeLaAccion[] = [];
  const anotar = (nodo: ts.Node, que: string): void => {
    const { line } = arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol));
    usos.push({ archivo, linea: line + 1, que });
  };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isStringLiteralLike(nodo) && nodo.text.includes(ACCION)) {
      anotar(nodo, `la cadena '${ACCION}'`);
    } else if (
      (ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) &&
      nodo.text.includes(ACCION)
    ) {
      anotar(nodo, `'${ACCION}' dentro de una plantilla`);
    } else if (ts.isIdentifier(nodo) && nodo.text === CONSTANTE) {
      anotar(nodo, `la constante ${CONSTANTE}`);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return usos;
}

function archivosDeProduccion(carpeta: string): string[] {
  const archivos: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre !== '__tests__' && nombre !== 'node_modules') {
        archivos.push(...archivosDeProduccion(ruta));
      }
    } else if (nombre.endsWith('.ts') && !nombre.endsWith('.d.ts') && !/\.(test|spec|nube)\.ts$/.test(nombre)) {
      archivos.push(ruta);
    }
  }
  return archivos;
}

function nombreRelativo(ruta: string): string {
  return relative(RAIZ, ruta).split(sep).join('/');
}

const archivos = CARPETAS.flatMap((carpeta) => archivosDeProduccion(carpeta));

describe('conflicto_de_inventario: una sola puerta', () => {
  it('el recorrido encuentra el código de producción (si no, la prueba pasaría en falso)', () => {
    const nombres = archivos.map(nombreRelativo);
    expect(nombres.length).toBeGreaterThan(80);
    expect(nombres).toContain(PUERTA);
    expect(nombres).toContain('src/main/domain/venta/servicio-de-venta.ts');
    expect(nombres).toContain('src/main/domain/venta/servicio-de-anulacion.ts');
  });

  it('NINGÚN archivo fuera de la puerta nombra la acción, ni como cadena ni con su constante', () => {
    const encontrados = archivos
      .map((ruta) => ({ ruta, nombre: nombreRelativo(ruta) }))
      .filter(({ nombre }) => nombre !== PUERTA && EXCEPCIONES_CON_MOTIVO[nombre] === undefined)
      .flatMap(({ ruta, nombre }) => usosDeLaAccion(nombre, readFileSync(ruta, 'utf8')));
    expect(
      encontrados.map(
        ({ archivo, linea, que }) =>
          `${archivo}:${String(linea)} nombra ${que}: el asiento del conflicto se escribe SOLO con ` +
          'dejarConstanciaDelConflictoDeInventario (domain/venta/conflicto-de-inventario.ts), que tiene la forma única.',
      ),
    ).toEqual([]);
  });

  it('la puerta SÍ nombra la acción, una sola vez (si no, la exclusión no estaría excluyendo nada)', () => {
    const usos = usosDeLaAccion(PUERTA, readFileSync(join(RAIZ, PUERTA), 'utf8'));
    expect(usos.filter((uso) => uso.que.startsWith('la cadena'))).toHaveLength(1);
  });

  it('las DOS operaciones escriben por la puerta: los dos servicios la llaman', () => {
    for (const servicio of ['servicio-de-venta.ts', 'servicio-de-anulacion.ts']) {
      const fuente = readFileSync(join(RAIZ, 'src/main/domain/venta', servicio), 'utf8');
      expect(fuente, servicio).toMatch(/dejarConstanciaDelConflictoDeInventario\(/);
    }
  });

  it('toda excepción lleva su motivo escrito', () => {
    for (const [archivo, motivo] of Object.entries(EXCEPCIONES_CON_MOTIVO)) {
      expect(motivo.trim().length, `la excepción de ${archivo} no dice por qué`).toBeGreaterThan(20);
    }
  });
});

describe('Control del propio detector', () => {
  it('marca la cadena suelta, con archivo y línea', () => {
    const fuente = ['export const A = {', "  conflicto: 'conflicto_de_inventario',", '};'].join('\n');
    expect(usosDeLaAccion('x.ts', fuente)).toEqual([
      { archivo: 'x.ts', linea: 2, que: "la cadena 'conflicto_de_inventario'" },
    ]);
  });

  it('marca la cadena con comillas dobles, dentro de una plantilla y dentro de SQL', () => {
    expect(usosDeLaAccion('x.ts', 'export const a = "conflicto_de_inventario";')).toHaveLength(1);
    expect(usosDeLaAccion('x.ts', 'export const a = (n: string) => `conflicto_de_inventario ${n}`;')).toHaveLength(1);
    expect(usosDeLaAccion('x.ts', 'export const a = `conflicto_de_inventario`;')).toHaveLength(1);
    expect(
      usosDeLaAccion('x.ts', "export const q = \"SELECT * FROM auditoria_log WHERE accion = 'conflicto_de_inventario'\";"),
    ).toHaveLength(1);
  });

  it('marca la constante importada', () => {
    const fuente = "import { ACCION_CONFLICTO_DE_INVENTARIO } from './conflicto-de-inventario';\nexport const a = ACCION_CONFLICTO_DE_INVENTARIO;";
    expect(usosDeLaAccion('x.ts', fuente)).toHaveLength(2);
  });

  it('NO marca un comentario que nombra la acción, ni otras acciones parecidas', () => {
    const fuente = [
      '/** Escribe el asiento `conflicto_de_inventario` por la puerta. */',
      '// conflicto_de_inventario',
      "export const a = 'venta_anulada';",
      "export const b = 'conflicto';",
    ].join('\n');
    expect(usosDeLaAccion('x.ts', fuente)).toEqual([]);
  });
});
