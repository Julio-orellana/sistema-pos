/**
 * Las reglas de `verify:paquete`, la revisión que corre ANTES de que exista el
 * instalador (§4.37 de CLAUDE.md).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTA PRUEBA EXISTE, Y POR QUÉ CARGA EL GUION DE VERDAD
 * ---------------------------------------------------------------------------
 * El control nació de un defecto real: el primer instalador del proyecto
 * llevaba `.env.nube-pruebas` adentro, o sea contraseñas de Supabase dentro
 * del `.exe` que se le manda al cliente.
 *
 * Un control así no vale por existir: **vale si muerde**. Dos de sus reglas
 * —la de los archivos de prueba y la de las dependencias que no son de
 * producción— no se pudieron falsificar tocando `electron-builder.yml`,
 * porque electron-builder decide por su cuenta qué entra de `node_modules` y
 * los patrones no alcanzan para meter ahí lo que uno quiera. Así que la
 * falsificación vive acá, donde sí se puede: se le pasan rutas a mano y se
 * comprueba, regla por regla, que marque lo que tiene que marcar **y que no
 * marque lo que no**.
 *
 * Carga `scripts/verificacion-de-paquete.cjs`, el archivo que el empaquetado
 * usa de verdad, y no una copia: es el mismo criterio con que
 * `seguro-del-proyecto-de-pruebas.test.ts` carga el seguro real (§4.20).
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const requerir = createRequire(import.meta.url);
const RUTA_DEL_GUION = join(process.cwd(), 'scripts', 'verificacion-de-paquete.cjs');

interface Hallazgo {
  readonly regla: string;
  readonly porque: string;
  readonly ruta: string;
}

interface GuionDePaquete {
  revisarRutas: (rutas: readonly string[], admitidas: ReadonlySet<string>) => Hallazgo[];
  dependenciasDeProduccion: () => Set<string>;
  REGLAS: readonly { readonly nombre: string }[];
}

const guion = requerir(RUTA_DEL_GUION) as GuionDePaquete;

/** Las que el proyecto admite de verdad, leídas del árbol instalado. */
const ADMITIDAS = guion.dependenciasDeProduccion();

/** Lo que un paquete sano tiene adentro, para usarlo de control en cada caso. */
const RUTAS_SANAS = [
  '/package.json',
  '/dist-electron/main/index.js',
  '/dist-electron/preload/index.js',
  '/dist/renderer/index.html',
  '/dist/renderer/assets/index-abc123.js',
  '/node_modules/zod/index.cjs',
  '/node_modules/better-sqlite3/lib/database.js',
  '/node_modules/better-sqlite3/prebuilds/win32-x64.node',
  '/node_modules/react-dom/client.js',
  '/node_modules/scheduler/index.js',
  '/node_modules/node-addon-api/napi.h',
  '/node_modules/decimal.js/decimal.js',
];

function revisar(rutas: readonly string[]): Hallazgo[] {
  return guion.revisarRutas(rutas, ADMITIDAS);
}

function reglasDe(hallazgos: readonly Hallazgo[]): string[] {
  return [...new Set(hallazgos.map((h) => h.regla))];
}

describe('UN PAQUETE SANO NO SE MARCA (el control: sin esto, una regla rota que marcara todo también «pasaría»)', () => {
  it('no encuentra nada en las rutas de un paquete correcto', () => {
    expect(revisar(RUTAS_SANAS)).toEqual([]);
  });

  it('`node_modules/zod/src` no se confunde con el `src/` del proyecto', () => {
    expect(revisar(['/node_modules/zod/src/index.ts'])).toEqual([]);
  });

  it('un archivo que solo CONTIENE la palabra test no se marca', () => {
    expect(revisar(['/dist/renderer/assets/contest-abc.js', '/node_modules/zod/latest.js'])).toEqual([]);
  });
});

describe('Credenciales: ningún .env puede viajar', () => {
  it('marca .env.nube-pruebas, que es el que trae contraseñas de verdad', () => {
    const hallazgos = revisar(['/.env.nube-pruebas']);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.regla).toBe('credenciales (.env)');
    expect(hallazgos[0]?.ruta).toBe('/.env.nube-pruebas');
  });

  it('marca TODAS las variantes, incluida la de ejemplo y las de cualquier subcarpeta', () => {
    const rutas = ['/.env', '/.env.example', '/.env.nube-real', '/.env.nube-pruebas.ejemplo', '/algo/.env.local'];
    expect(revisar(rutas).map((h) => h.ruta)).toEqual(rutas);
  });

  it('NO marca un archivo que apenas empieza parecido', () => {
    expect(revisar(['/environment.js', '/dist/envio.js'])).toEqual([]);
  });
});

describe('Código fuente y carpetas del repositorio', () => {
  it('marca el src/ del proyecto, con su nombre exacto', () => {
    const hallazgos = revisar(['/src/main/index.ts', '/src/shared/money.ts', '/src']);
    expect(hallazgos.map((h) => h.ruta)).toEqual(['/src/main/index.ts', '/src/shared/money.ts', '/src']);
    expect(reglasDe(hallazgos)).toEqual(['código fuente sin compilar (src/)']);
  });

  it('marca docs/, scripts/ y supabase/', () => {
    const hallazgos = revisar(['/docs/SINCRONIZACION.md', '/scripts/verificacion-de-nube.cjs', '/supabase/migrations/0023.sql']);
    expect(hallazgos).toHaveLength(3);
    expect(reglasDe(hallazgos)).toEqual(['carpetas del repositorio (docs/, scripts/, supabase/)']);
  });
});

describe('Pruebas: ni las del proyecto ni las que publican las dependencias', () => {
  it('marca una carpeta de prueba de una dependencia', () => {
    const hallazgos = revisar(['/node_modules/zod/src/v3/tests/array.test.ts']);
    // Cae por las dos reglas: está en una carpeta de prueba y además es un
    // archivo .test. Las dos se informan, que es lo correcto: quien lo lea ve
    // los dos motivos por los que no debería estar.
    expect(reglasDe(hallazgos).sort()).toEqual(['archivos de prueba (.test / .spec)', 'carpetas de prueba']);
  });

  it('marca las cuatro formas de carpeta de prueba', () => {
    const rutas = [
      '/node_modules/algo/__tests__/x.js',
      '/node_modules/algo/__mocks__/y.js',
      '/node_modules/algo/test/z.js',
      '/node_modules/algo/tests/w.js',
      '/node_modules/algo/spec/v.js',
    ];
    expect(revisar(rutas).filter((h) => h.regla === 'carpetas de prueba')).toHaveLength(rutas.length);
  });

  it('marca .test y .spec en sus extensiones habituales', () => {
    const rutas = ['/a/b.test.ts', '/a/b.spec.ts', '/a/b.test.tsx', '/a/b.spec.js', '/a/b.test.mjs', '/a/b.test.cjs'];
    expect(revisar(rutas).filter((h) => h.regla === 'archivos de prueba (.test / .spec)')).toHaveLength(rutas.length);
  });

  it('NO marca un archivo que solo tiene «test» en el nombre sin ser una prueba', () => {
    // `zod` y no un nombre inventado: un paquete que no existe lo marcaría la
    // regla de las dependencias y el control mediría otra cosa. Lo encontró
    // esta misma prueba al fallar la primera vez.
    expect(revisar(['/dist/testigo.js', '/node_modules/zod/latest.js', '/node_modules/zod/protest.js'])).toEqual([]);
  });
});

describe('DEPENDENCIAS: solo las de producción, y el cierre transitivo cuenta', () => {
  it('las dependencias reales del proyecto NO se marcan', () => {
    // Las cinco de `dependencies` más las dos transitivas que hacen falta.
    for (const paquete of ['better-sqlite3', 'decimal.js', 'react', 'react-dom', 'zod', 'node-addon-api', 'scheduler']) {
      expect(ADMITIDAS.has(paquete), `${paquete} tiene que estar admitido`).toBe(true);
    }
    expect(revisar(['/node_modules/node-addon-api/napi.h', '/node_modules/scheduler/index.js'])).toEqual([]);
  });

  it('MARCA una devDependency: es el caso que de verdad importa', () => {
    const hallazgos = revisar(['/node_modules/playwright-core/index.js']);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.regla).toBe('dependencia que no es de producción');
    expect(hallazgos[0]?.porque).toContain('playwright-core');
  });

  it('marca vitest y electron-builder, que son las otras dos que no pueden viajar', () => {
    const hallazgos = revisar(['/node_modules/vitest/dist/index.js', '/node_modules/electron-builder/out/index.js']);
    expect(hallazgos).toHaveLength(2);
    expect(reglasDe(hallazgos)).toEqual(['dependencia que no es de producción']);
  });

  it('marca un paquete CON ÁMBITO que no es de producción, con el nombre completo y no solo el ámbito', () => {
    const hallazgos = revisar(['/node_modules/@playwright/test/index.js']);
    const porDependencia = hallazgos.filter((h) => h.regla === 'dependencia que no es de producción');
    expect(porDependencia).toHaveLength(1);
    expect(porDependencia[0]?.porque).toContain('@playwright/test');
    // Cae además por la regla de las carpetas de prueba, porque el paquete se
    // llama `test`. Que las dos lo marquen está bien: son dos motivos ciertos.
    expect(reglasDe(hallazgos)).toHaveLength(2);
  });

  it('mira TODOS los niveles de anidamiento, no solo el primero', () => {
    const hallazgos = revisar(['/node_modules/zod/node_modules/vitest/index.js']);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.regla).toBe('dependencia que no es de producción');
  });

  it('una dependencia admitida anidada dentro de otra admitida NO se marca', () => {
    expect(revisar(['/node_modules/react-dom/node_modules/scheduler/index.js'])).toEqual([]);
  });
});

describe('El informe alcanza para arreglar el problema', () => {
  it('cada hallazgo trae la ruta EXACTA y el motivo, no un resumen', () => {
    const hallazgos = revisar(['/.env.nube-pruebas']);
    expect(hallazgos[0]?.ruta).toBe('/.env.nube-pruebas');
    expect(hallazgos[0]?.porque).toContain('contraseñas');
  });

  it('un paquete con varios problemas los informa todos, no solo el primero', () => {
    const hallazgos = revisar(['/.env', '/src/main/index.ts', '/docs/x.md', '/node_modules/vitest/a.js']);
    expect(hallazgos).toHaveLength(4);
    expect(reglasDe(hallazgos)).toHaveLength(4);
  });

  it('las cinco reglas de ruta están declaradas, para que la lista no se achique sin que se note', () => {
    expect(guion.REGLAS.map((r) => r.nombre)).toEqual([
      'credenciales (.env)',
      'código fuente sin compilar (src/)',
      'carpetas del repositorio (docs/, scripts/, supabase/)',
      'carpetas de prueba',
      'archivos de prueba (.test / .spec)',
    ]);
  });
});
