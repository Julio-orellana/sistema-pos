/**
 * Los arneses de `scripts/` mandan a la ventana EXACTAMENTE las claves que el
 * contrato IPC exige hoy.
 *
 * ===========================================================================
 * POR QUÉ EXISTE
 * ===========================================================================
 * La spec 002 (2026-09-18) hizo obligatorias `precioMayorista` y
 * `cantidadMinimaMayorista` en el payload de producto. Seis arneses creaban
 * productos por el canal sin esas dos claves, y desde ese día fallaban antes
 * de medir nada: «Los datos enviados desde la interfaz no cumplen el contrato
 * esperado». Nada lo avisó, porque los arneses no corren en `npm test`. Se
 * descubrió el 2026-09-19, al correr el de anulación para la spec 003.
 *
 * Esta prueba recorre el árbol sintáctico de cada arnés, busca las llamadas
 * `window.pos.<módulo>.<método>(<objeto literal>)` y compara las claves del
 * objeto con las del esquema Zod que valida ese argumento. Falla, con archivo
 * y línea, si falta una clave obligatoria o sobra una que el esquema no tiene.
 *
 * Y falla si aparece una llamada nueva de esa forma sin su esquema en el mapa
 * de abajo: así un arnés no puede empezar a mandar un payload que nadie vigila.
 *
 * Lo que NO mira: los objetos anidados (las líneas de un cobro), los valores,
 * ni los argumentos que no son un objeto literal.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  esquemaCobro,
  esquemaEfectivoDeclarado,
  esquemaFiltroDeHistorialDeCajas,
  esquemaLimiteDeDescuento,
  esquemaPedidoDeAnulacion,
  esquemaProductoEditado,
  esquemaProductoNuevo,
  esquemaUsuarioNuevo,
} from '@shared/types/ipc';

const CARPETA = join(__dirname, '..', '..', '..', 'scripts');

/**
 * El esquema del PRIMER argumento de cada método que un arnés llama con un
 * objeto literal. Es el argumento del preload, no siempre el payload del
 * canal: `caja.abrir(efectivo)` lo envuelve en `{ efectivo }` (preload/index.ts).
 */
const ESQUEMA_DEL_ARGUMENTO: Readonly<Record<string, z.ZodType>> = {
  'window.pos.caja.abrir': esquemaEfectivoDeclarado,
  'window.pos.caja.cerrar': esquemaEfectivoDeclarado,
  'window.pos.caja.confirmarCierreAutorizado': esquemaEfectivoDeclarado,
  'window.pos.catalogo.crearProducto': esquemaProductoNuevo,
  'window.pos.catalogo.editarProducto': esquemaProductoEditado,
  'window.pos.historialDeCajas.listar': esquemaFiltroDeHistorialDeCajas,
  'window.pos.limites.fijar': esquemaLimiteDeDescuento,
  'window.pos.usuarios.crear': esquemaUsuarioNuevo,
  'window.pos.venta.anular': esquemaPedidoDeAnulacion,
  'window.pos.venta.cobrar': esquemaCobro,
};

interface Llamada {
  readonly archivo: string;
  readonly linea: number;
  readonly metodo: string;
  /** Las claves del objeto literal, o `null` si tiene propagación o claves calculadas. */
  readonly claves: readonly string[] | null;
}

/** Todas las llamadas `window.pos.X.Y({ … })` de un texto de JavaScript. */
function llamadasDe(archivo: string, texto: string): Llamada[] {
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const encontradas: Llamada[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
      const metodo = nodo.expression.getText(fuente);
      const [primero] = nodo.arguments;
      if (metodo.startsWith('window.pos.') && primero !== undefined && ts.isObjectLiteralExpression(primero)) {
        const claves: string[] = [];
        let comprobable = true;
        for (const propiedad of primero.properties) {
          if (
            (ts.isPropertyAssignment(propiedad) || ts.isShorthandPropertyAssignment(propiedad)) &&
            (ts.isIdentifier(propiedad.name) || ts.isStringLiteral(propiedad.name))
          ) {
            claves.push(propiedad.name.text);
          } else {
            comprobable = false;
          }
        }
        encontradas.push({
          archivo,
          linea: fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1,
          metodo,
          claves: comprobable ? claves : null,
        });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return encontradas;
}

/** Las formas que acepta un esquema: una por opción si es una unión. */
function formasDe(esquema: z.ZodType): { obligatorias: string[]; todas: string[] }[] {
  const interno = esquema as unknown as {
    options?: z.ZodType[];
    shape?: Record<string, z.ZodType>;
  };
  if (interno.options !== undefined) {
    return interno.options.flatMap((opcion) => formasDe(opcion));
  }
  const forma = interno.shape ?? {};
  const todas = Object.keys(forma);
  return [
    {
      todas,
      obligatorias: todas.filter((clave) => !(forma[clave]?.safeParse(undefined).success ?? false)),
    },
  ];
}

/** Por qué una llamada no cumple su esquema, o `null` si cumple. */
function problemaDe(llamada: Llamada): string | null {
  const esquema = ESQUEMA_DEL_ARGUMENTO[llamada.metodo];
  if (esquema === undefined) {
    return 'no tiene esquema en ESQUEMA_DEL_ARGUMENTO';
  }
  if (llamada.claves === null) {
    return 'el objeto usa propagación o claves calculadas: no se puede comprobar';
  }
  const claves = llamada.claves;
  const motivos = formasDe(esquema).map((forma) => {
    const faltan = forma.obligatorias.filter((clave) => !claves.includes(clave));
    const sobran = claves.filter((clave) => !forma.todas.includes(clave));
    return faltan.length === 0 && sobran.length === 0
      ? null
      : `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}]`;
  });
  return motivos.includes(null) ? null : motivos.join(' | ');
}

/** La única llamada de un texto de control; falla si no la encuentra. */
function unaLlamada(texto: string): Llamada {
  const [llamada] = llamadasDe('control.cjs', texto);
  if (llamada === undefined) {
    throw new Error(`el detector no encontró ninguna llamada en: ${texto}`);
  }
  return llamada;
}

function todasLasLlamadas(): Llamada[] {
  return readdirSync(CARPETA)
    .filter((nombre) => nombre.endsWith('.cjs'))
    .flatMap((nombre) => llamadasDe(nombre, readFileSync(join(CARPETA, nombre), 'utf8')));
}

describe('LOS ARNESES MANDAN EL CONTRATO VIGENTE', () => {
  it('control: el detector encuentra las llamadas y lee sus claves', () => {
    const [llamada] = llamadasDe(
      'control.cjs',
      "async () => { await window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pin: p.ana }); }",
    );
    expect(llamada).toEqual({
      archivo: 'control.cjs',
      linea: 1,
      metodo: 'window.pos.usuarios.crear',
      claves: ['nombre', 'rol', 'pin'],
    });
  });

  it('control: una clave que FALTA o que SOBRA se detecta', () => {
    const falta = unaLlamada("window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta' });");
    const sobra = unaLlamada("window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pin: '1357', edad: 3 });");
    expect(problemaDe(falta)).toBe('faltan [pin] · sobran []');
    expect(problemaDe(sobra)).toBe('faltan [] · sobran [edad]');
  });

  it('control: una unión acepta cualquiera de sus formas, y una opcional puede faltar', () => {
    const simple = unaLlamada("window.pos.caja.abrir({ modo: 'simple', monto: '500' });");
    expect(problemaDe(simple)).toBeNull();
  });

  it('control: un método sin esquema y un objeto con propagación no pasan callados', () => {
    const sinEsquema = unaLlamada('window.pos.nuevo.metodo({ a: 1 });');
    const conPropagacion = unaLlamada('window.pos.usuarios.crear({ ...datos });');
    expect(problemaDe(sinEsquema)).toBe('no tiene esquema en ESQUEMA_DEL_ARGUMENTO');
    expect(problemaDe(conPropagacion)).toContain('no se puede comprobar');
  });

  it('los arneses de verdad tienen llamadas que revisar (si no, esta prueba no mira nada)', () => {
    const llamadas = todasLasLlamadas();
    expect(llamadas.length).toBeGreaterThan(20);
    expect(new Set(llamadas.map((llamada) => llamada.archivo)).size).toBeGreaterThan(5);
  });

  it('NINGUNA llamada de un arnés manda claves de menos o de más', () => {
    const problemas = todasLasLlamadas()
      .map((llamada) => ({ llamada, problema: problemaDe(llamada) }))
      .filter((uno) => uno.problema !== null)
      .map(({ llamada, problema }) => `${llamada.archivo}:${String(llamada.linea)} ${llamada.metodo}: ${String(problema)}`);
    expect(problemas).toEqual([]);
  });
});
