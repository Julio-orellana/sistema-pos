/**
 * TODA PETICIÓN DE RED LLEVA SU LÍMITE DE TIEMPO. Sin excepciones no escritas.
 *
 * ===========================================================================
 * POR QUÉ EXISTE (2026-09-17)
 * ===========================================================================
 *
 * En la tienda de Jimmy la aplicación no llegó a mostrar ninguna pantalla con
 * la red del local conectada, y la hipótesis fue una petición de red que nunca
 * se resuelve ni se rechaza porque algo en esa red descarta los paquetes en
 * silencio.
 *
 * La auditoría de ese día encontró que TODAS las peticiones del proceso
 * principal ya pasaban un `signal` que las corta: el health y el latido (8 s),
 * Auth (20 s), la subida de lotes (30 s), las fotos (60 s) y la restauración
 * (30 s y 60 s). Y se MIDIÓ, con Electron 44 real, que ese corte funciona:
 * contra un servidor que acepta la conexión y nunca contesta, contra uno que
 * manda los encabezados y se calla a mitad del cuerpo, contra un TLS que nunca
 * completa y contra una dirección que descarta el SYN, `net.fetch` y el `fetch`
 * de Node rechazan a los 2 s con `AbortError`; SIN el `signal`, los dos
 * quedaron colgados más de 25 s.
 *
 * O sea que el límite existe en cada caso porque alguien se acordó de ponerlo,
 * y nada impedía agregar una petición nueva sin él. Esta prueba lo impide.
 *
 * ===========================================================================
 * LA REGLA
 * ===========================================================================
 *
 * Recorre el árbol sintáctico de `src/main` y `src/shared` (sin pruebas). Toda
 * llamada a `fetch`, `net.fetch`, `this.buscar` / `dependencias.buscar` o
 * `this.fetchImpl` tiene que pasar como segundo argumento un objeto literal con
 * la propiedad `signal`. Las otras formas de salir a la red —`net.request`,
 * `http.request`, `https.request`, `http.get`, `https.get`— no se admiten: no
 * hay dónde ponerles el mismo límite, así que son falla directa.
 *
 * Una lista de excepciones con su motivo, y un control de que el detector
 * encuentra las peticiones que existen: sin eso, un método renombrado dejaría
 * la prueba pasando en falso.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..', '..');
const CARPETAS = [join(RAIZ, 'src', 'main'), join(RAIZ, 'src', 'shared')];

/** Nombres de función que hacen una petición HTTP con la forma de `fetch`. */
const NOMBRES_DE_FETCH = new Set(['fetch', 'buscar', 'fetchImpl']);

/** Formas de salir a la red que no se admiten: no llevan el mismo límite. */
const FORMAS_NO_ADMITIDAS = new Set(['net.request', 'http.request', 'https.request', 'http.get', 'https.get']);

export interface PeticionDeRed {
  readonly archivo: string;
  readonly linea: number;
  readonly texto: string;
  readonly veredicto: 'con-limite' | 'excepcion' | 'SIN LIMITE' | 'FORMA NO ADMITIDA';
  readonly motivo?: string;
}

function tieneSignal(argumento: ts.Expression | undefined): boolean {
  if (argumento === undefined || !ts.isObjectLiteralExpression(argumento)) {
    return false;
  }
  return argumento.properties.some(
    (propiedad) =>
      (ts.isPropertyAssignment(propiedad) || ts.isShorthandPropertyAssignment(propiedad)) &&
      propiedad.name.getText() === 'signal',
  );
}

/**
 * Excepciones con su motivo. Hoy una: `protocol.handle('pos-foto', …)` en el
 * arranque hace `net.fetch(pathToFileURL(ruta))` para leer una foto del DISCO.
 * Es `file:`: no hay red que pueda no contestar.
 */
function motivoDeExcepcion(archivo: string, llamada: ts.CallExpression, arbol: ts.SourceFile): string | null {
  const primero = llamada.arguments[0];
  if (
    archivo === join('src', 'main', 'index.ts') &&
    llamada.expression.getText(arbol) === 'net.fetch' &&
    primero?.getText(arbol).startsWith('pathToFileURL(') === true
  ) {
    return 'lee una foto del disco con file:, no sale a ninguna red';
  }
  return null;
}

/** Pura: se le puede dar un caso armado a mano. */
export function peticionesDeRed(archivo: string, fuente: string): PeticionDeRed[] {
  const arbol = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const encontradas: PeticionDeRed[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo)) {
      const callee = nodo.expression;
      const textoDelCallee = callee.getText(arbol);
      const nombre = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      const linea = arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1;
      const texto = nodo.getText(arbol).split('\n')[0] ?? textoDelCallee;
      if (FORMAS_NO_ADMITIDAS.has(textoDelCallee)) {
        encontradas.push({ archivo, linea, texto, veredicto: 'FORMA NO ADMITIDA' });
      } else if (nombre !== null && NOMBRES_DE_FETCH.has(nombre)) {
        const motivo = motivoDeExcepcion(archivo, nodo, arbol);
        if (motivo !== null) {
          encontradas.push({ archivo, linea, texto, veredicto: 'excepcion', motivo });
        } else {
          encontradas.push({
            archivo,
            linea,
            texto,
            veredicto: tieneSignal(nodo.arguments[1]) ? 'con-limite' : 'SIN LIMITE',
          });
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return encontradas;
}

function archivosDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(carpeta)) {
    const ruta = join(carpeta, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === '__tests__') continue;
      salida.push(...archivosDe(ruta));
    } else if (ruta.endsWith('.ts') && !ruta.endsWith('.test.ts') && !ruta.endsWith('.nube.ts') && !ruta.endsWith('.d.ts')) {
      salida.push(ruta);
    }
  }
  return salida;
}

describe('El detector muerde (controles con casos armados a mano)', () => {
  it('un fetch con signal pasa; el mismo sin signal es falla', () => {
    expect(peticionesDeRed('c.ts', "void fetch('u', { method: 'GET', signal: c.signal });").map((p) => p.veredicto)).toEqual([
      'con-limite',
    ]);
    expect(peticionesDeRed('c.ts', "void fetch('u', { method: 'GET' });").map((p) => p.veredicto)).toEqual(['SIN LIMITE']);
    expect(peticionesDeRed('c.ts', "void fetch('u');").map((p) => p.veredicto)).toEqual(['SIN LIMITE']);
  });

  it('this.buscar y this.dependencias.buscar sin signal son falla', () => {
    expect(peticionesDeRed('c.ts', "void this.buscar('u', { headers: {} });").map((p) => p.veredicto)).toEqual(['SIN LIMITE']);
    expect(peticionesDeRed('c.ts', "void this.dependencias.buscar('u', {});").map((p) => p.veredicto)).toEqual(['SIN LIMITE']);
  });

  it('opciones armadas afuera (una variable o un spread) no cuentan: el límite tiene que verse en la llamada', () => {
    expect(peticionesDeRed('c.ts', "void net.fetch('u', opciones);").map((p) => p.veredicto)).toEqual(['SIN LIMITE']);
    expect(peticionesDeRed('c.ts', "void net.fetch('u', { ...opciones });").map((p) => p.veredicto)).toEqual(['SIN LIMITE']);
  });

  it('net.request y https.request son forma no admitida', () => {
    expect(peticionesDeRed('c.ts', "net.request('u'); https.request('u');").map((p) => p.veredicto)).toEqual([
      'FORMA NO ADMITIDA',
      'FORMA NO ADMITIDA',
    ]);
  });

  it('la excepción de la foto del disco NO alcanza a un net.fetch a la red', () => {
    expect(
      peticionesDeRed(join('src', 'main', 'index.ts'), "void net.fetch('https://x.invalid');").map((p) => p.veredicto),
    ).toEqual(['SIN LIMITE']);
  });
});

describe('src/main y src/shared: toda petición de red lleva su límite', () => {
  const todas = CARPETAS.flatMap((carpeta) =>
    archivosDe(carpeta).flatMap((ruta) => peticionesDeRed(relative(RAIZ, ruta), readFileSync(ruta, 'utf8'))),
  );
  const describir = (peticion: PeticionDeRed): string =>
    `${peticion.archivo.split(sep).join('/')}:${String(peticion.linea)} ${peticion.texto}`;

  it('NINGUNA petición sin límite ni por una forma no admitida', () => {
    const malas = todas.filter((p) => p.veredicto === 'SIN LIMITE' || p.veredicto === 'FORMA NO ADMITIDA').map(describir);
    expect(malas).toEqual([]);
  });

  it('CONTROL: el detector encuentra las peticiones que existen, módulo por módulo', () => {
    const conLimite = new Set(
      todas.filter((p) => p.veredicto === 'con-limite').map((p) => p.archivo.split(sep).join('/')),
    );
    expect([...conLimite].sort()).toEqual([
      'src/main/restauracion/cliente-de-restauracion.ts',
      'src/main/sincronizacion/auth-de-nube.ts',
      'src/main/sincronizacion/deteccion-de-conexion.ts',
      'src/main/sincronizacion/subida-de-fotos.ts',
      'src/main/sincronizacion/supabase-sync-provider.ts',
    ]);
    expect(todas.filter((p) => p.veredicto === 'con-limite')).toHaveLength(7);
  });

  it('las excepciones son exactamente las que tienen motivo (hoy: la foto del disco en el arranque)', () => {
    expect(todas.filter((p) => p.veredicto === 'excepcion').map((p) => p.motivo)).toEqual([
      'lee una foto del disco con file:, no sale a ninguna red',
    ]);
  });
});
