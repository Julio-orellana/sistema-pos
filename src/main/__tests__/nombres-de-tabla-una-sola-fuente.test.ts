/**
 * El nombre legible de cada tabla tiene UNA sola fuente:
 * `src/shared/nombres-de-tabla.ts`.
 *
 * ===========================================================================
 * POR QUÉ EXISTE ESTA PRUEBA
 * ===========================================================================
 *
 * Hasta el 2026-09-17 la misma verdad estaba escrita a mano en dos pantallas,
 * cada una con su propio `NOMBRES_DE_TABLA` y en distinto orden:
 *
 *   1. `PantallaDeSincronizacion.tsx` (con `archivo_foto`, que la otra no tenía);
 *   2. `PantallaDeRestauracion.tsx`.
 *
 * Se desincronizaron con la primera tabla nueva: al crearse
 * `anulaciones_de_venta` (CLAUDE.md §4.45) solo se agregó a una, y la pantalla
 * de sincronización mostró el nombre técnico de una anulación pendiente. Se
 * arreglaron los dos mapas a mano (§4.53) y **nada impedía que volviera a
 * pasar**: agregar una tabla y olvidarse de una copia no hacía fallar nada.
 *
 * Esta prueba cubre las dos mitades del defecto:
 *
 *   · que nadie vuelva a declarar su propio mapa (el árbol sintáctico);
 *   · que la fuente única cubra TODAS las tablas (las listas que ya existen).
 *
 * ===========================================================================
 * QUÉ CUENTA COMO «SU PROPIO MAPA»
 * ===========================================================================
 *
 * Un literal de objeto con al menos tres claves que son nombres de tabla y
 * cuyos valores son textos. El criterio excluye a propósito las listas que
 * este proyecto sí tiene repartidas y que NO son etiquetas:
 * `TABLAS_ADMITIDAS_POR_FUNCION` y `COLUMNAS_EXCLUIDAS` tienen arrays por
 * valor, y `TABLAS_QUE_VIAJAN` y `ORDEN_DE_RESTAURACION` son arrays.
 *
 * Se recorre el árbol sintáctico y no se busca texto suelto: un comentario que
 * cite «líneas de venta» no es una copia del mapa.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { NOMBRES_DE_TABLA, nombreLegibleDeTabla } from '@shared/nombres-de-tabla';
import { TIPO_DE_ENTRADA_DE_FOTO, type TablaSincronizable } from '../database/bandeja-de-salida';
import { ORDEN_DE_RESTAURACION } from '../restauracion/orden-de-restauracion';

const RAIZ = join(__dirname, '..', '..');
const RAIZ_DEL_RENDERER = join(RAIZ, 'renderer', 'src');
const RAIZ_DEL_PRINCIPAL = join(RAIZ, 'main');
const RUTA_DE_LA_FUENTE = join(RAIZ, 'shared', 'nombres-de-tabla.ts');

/** Cuántas claves de tabla tiene que tener un objeto para contar como un mapa de nombres. */
const CLAVES_PARA_CONTAR_COMO_MAPA = 3;

/** Los nombres que delatan un mapa de tablas. Son los del esquema, no los legibles. */
const NOMBRES_TECNICOS = new Set<string>([...ORDEN_DE_RESTAURACION, TIPO_DE_ENTRADA_DE_FOTO]);

/** Las funciones que solo pueden existir en la fuente única. */
const FUNCIONES_DE_LA_FUENTE = new Set(['nombreLegibleDeTabla', 'nombreDeTabla']);

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

/** El nombre de una propiedad, si se puede leer sin ejecutar nada. */
function nombreDePropiedad(propiedad: ts.PropertyAssignment): string | null {
  if (ts.isIdentifier(propiedad.name)) {
    return propiedad.name.text;
  }
  return ts.isStringLiteral(propiedad.name) ? propiedad.name.text : null;
}

/** Los literales de objeto que se ven como un mapa de nombre de tabla a texto. */
export function mapasDeNombresEn(arbol: ts.SourceFile): { linea: number; claves: string[] }[] {
  const encontrados: { linea: number; claves: string[] }[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isObjectLiteralExpression(nodo)) {
      const claves: string[] = [];
      for (const propiedad of nodo.properties) {
        if (!ts.isPropertyAssignment(propiedad)) {
          continue;
        }
        const clave = nombreDePropiedad(propiedad);
        const valorEsTexto =
          ts.isStringLiteral(propiedad.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(propiedad.initializer) ||
          ts.isTemplateExpression(propiedad.initializer);
        if (clave !== null && valorEsTexto && NOMBRES_TECNICOS.has(clave)) {
          claves.push(clave);
        }
      }
      if (claves.length >= CLAVES_PARA_CONTAR_COMO_MAPA) {
        encontrados.push({
          linea: arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1,
          claves,
        });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return encontrados;
}

/** Declaraciones de funciones que se llaman como la de la fuente única. */
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

describe('El nombre legible de una tabla vive en UN solo archivo', () => {
  it('CONTROL: el detector encuentra un mapa de tablas y NO una lista ni un mapa de otra cosa', () => {
    const arbol = arbolDe(
      'control.ts',
      [
        '// usuarios: «usuarios» (esto es un comentario y no cuenta)',
        "const mapa = { usuarios: 'usuarios', ventas: 'ventas', recibos: 'recibos' };",
        "const lista = ['usuarios', 'ventas', 'recibos'];",
        "const porFuncion = { usuarios: ['a'], ventas: ['b'], recibos: ['c'] };",
        "const dosSolas = { usuarios: 'usuarios', ventas: 'ventas' };",
        "const otraCosa = { presencial: 'en persona', remoto: 'por teléfono', mixto: 'los dos' };",
      ].join('\n'),
    );
    const hallazgos = mapasDeNombresEn(arbol);
    expect(hallazgos.map((m) => m.linea)).toEqual([2]);
    expect(hallazgos[0]?.claves).toEqual(['usuarios', 'ventas', 'recibos']);
  });

  it('ningún archivo del renderer declara su propio mapa de nombres de tabla', () => {
    const copias = archivosDe(RAIZ_DEL_RENDERER).flatMap((ruta) =>
      mapasDeNombresEn(arbolDe(ruta)).map((m) => `${relativa(ruta)}:${String(m.linea)} ${m.claves.join(', ')}`),
    );
    expect(copias).toEqual([]);
  });

  it('ningún archivo del proceso principal declara su propio mapa de nombres de tabla', () => {
    const copias = archivosDe(RAIZ_DEL_PRINCIPAL).flatMap((ruta) =>
      mapasDeNombresEn(arbolDe(ruta)).map((m) => `${relativa(ruta)}:${String(m.linea)} ${m.claves.join(', ')}`),
    );
    expect(copias).toEqual([]);
  });

  it('CONTROL: el detector de funciones encuentra una declaración y una flecha con esos nombres', () => {
    const arbol = arbolDe(
      'control.ts',
      'function nombreLegibleDeTabla() {}\nconst nombreDeTabla = () => 1;\nconst otra = 2;',
    );
    expect(funcionesDeLaFuenteEn(arbol).map((f) => f.nombre)).toEqual(['nombreLegibleDeTabla', 'nombreDeTabla']);
  });

  it('ni el renderer ni el proceso principal declaran su propia función de nombre legible', () => {
    const copias = [...archivosDe(RAIZ_DEL_RENDERER), ...archivosDe(RAIZ_DEL_PRINCIPAL)].flatMap((ruta) =>
      funcionesDeLaFuenteEn(arbolDe(ruta)).map((f) => `${relativa(ruta)}:${String(f.linea)} ${f.nombre}`),
    );
    expect(copias).toEqual([]);
  });

  it('la fuente única SÍ tiene el mapa (si no, las búsquedas de arriba no probarían nada)', () => {
    const hallazgos = mapasDeNombresEn(arbolDe(RUTA_DE_LA_FUENTE));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.claves).toEqual(Object.keys(NOMBRES_DE_TABLA));
  });
});

describe('La fuente única cubre TODAS las tablas, sin faltar ni sobrar', () => {
  it('nombra EXACTAMENTE las trece tablas que la aplicación restaura, más archivo_foto', () => {
    const nombradas = Object.keys(NOMBRES_DE_TABLA)
      .filter((clave) => clave !== TIPO_DE_ENTRADA_DE_FOTO)
      .sort();
    expect(nombradas).toEqual([...ORDEN_DE_RESTAURACION].sort());
  });

  it('nombra la entrada de archivo con la que la cola encola una foto', () => {
    expect(Object.keys(NOMBRES_DE_TABLA)).toContain(TIPO_DE_ENTRADA_DE_FOTO);
  });

  it('cubre el tipo TablaSincronizable: el compilador lo exige, y esta prueba lo dice en voz alta', () => {
    /*
      La comprobación de verdad la hace `npm run typecheck`: si una tabla nueva
      entra en `TablaSincronizable` y no en el mapa, esta asignación no compila.
      La prueba la usa para que la falla también se vea corriendo `npm test`.
    */
    const cobertura: Readonly<Record<TablaSincronizable, string>> = NOMBRES_DE_TABLA;
    expect(Object.keys(cobertura)).toContain('anulaciones_de_venta');
  });

  it('ninguna tabla se queda con su nombre técnico: todas tienen un texto no vacío', () => {
    const sinNombre = Object.entries(NOMBRES_DE_TABLA).filter(([, texto]) => texto.trim() === '');
    expect(sinNombre).toEqual([]);
  });

  it('una clave desconocida se devuelve tal cual, sin fallar', () => {
    expect(nombreLegibleDeTabla('tabla_que_no_existe')).toBe('tabla_que_no_existe');
  });

  it('traduce, no repite: venta_detalle y caja_sesion_denominaciones NO se muestran con su nombre técnico', () => {
    expect(nombreLegibleDeTabla('venta_detalle')).toBe('líneas de venta');
    expect(nombreLegibleDeTabla('caja_sesion_denominaciones')).toBe('arqueos de caja');
    expect(nombreLegibleDeTabla('anulaciones_de_venta')).toBe('anulaciones de venta');
    expect(nombreLegibleDeTabla(TIPO_DE_ENTRADA_DE_FOTO)).toBe('fotos de producto');
  });
});
