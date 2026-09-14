#!/usr/bin/env node
/**
 * ¿QUÉ SE LE ESTÁ POR ENTREGAR A JIMMY? — la revisión del `.asar` antes de que
 * exista el instalador.
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALIÓ ESTO
 * ---------------------------------------------------------------------------
 * El primer instalador que armó el proyecto (§4.37 de CLAUDE.md) llevaba
 * adentro **`.env.nube-pruebas` y `.env.nube-real`**: las contraseñas de los
 * tres usuarios de Supabase del proyecto de pruebas, dentro del `.exe` que se
 * le manda al cliente. También `src/` entero con sus 93 archivos de prueba,
 * `docs/`, `scripts/` y `supabase/`.
 *
 * La causa fueron dos comportamientos de electron-builder que hay que medir y
 * no deducir: `files` **no es una lista blanca** —parte de `**​/*` y le suma
 * los patrones positivos— y `win.files` **reemplaza** a `files` en vez de
 * completarlo. Se corrigió, y la corrección se comprobó a mano listando el
 * asar. **A mano no escala**: el día que alguien agregue una carpeta o toque
 * un patrón, nada avisa. Esto es lo que avisa.
 *
 * ---------------------------------------------------------------------------
 * CORRE SOLO, Y ANTES DE QUE EXISTA EL `.EXE`
 * ---------------------------------------------------------------------------
 * Este archivo es **el `afterPack` de electron-builder**, no un guion aparte
 * que alguien tenga que acordarse de correr. `afterPack` ocurre cuando la
 * aplicación ya está empaquetada en `win-unpacked` pero **antes** de que el
 * destino NSIS arme el instalador, así que lanzar un error acá hace dos cosas
 * a la vez: aborta el empaquetado y **el `.exe` nunca llega a existir**.
 *
 * Y si en `release/` hubiera quedado un instalador de una corrida anterior, se
 * borra: lo peor que podría pasar es que alguien tomara el `.exe` viejo de una
 * carpeta donde la corrida nueva acaba de fallar.
 *
 * Se puede correr también a mano contra un paquete ya armado, para auditar:
 *
 *     npm run verify:paquete                 # busca el asar más reciente en release/
 *     npm run verify:paquete -- <ruta.asar>  # contra uno en particular
 *
 * Códigos de salida: 0 el paquete está limpio, 1 tiene algo que no debería
 * viajar, 2 no se pudo revisar (no hay asar, o no se pudo leer).
 */
'use strict';

const { existsSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs');
const { join, dirname } = require('node:path');

const RAIZ = join(__dirname, '..');
const MARCA_INFORME = 'INFORME_DE_PAQUETE';

/**
 * Las reglas. Cada una dice qué busca y POR QUÉ no puede viajar: un mensaje
 * que solo dice «prohibido» obliga a quien lo lea dentro de un año a averiguar
 * de nuevo lo que ya se averiguó.
 *
 * Las rutas que devuelve `asar list` empiezan con `/` y usan `/` siempre, en
 * cualquier sistema operativo.
 */
const REGLAS = [
  {
    nombre: 'credenciales (.env)',
    porque:
      'un archivo .env puede traer contraseñas de verdad —.env.nube-pruebas trae las de los tres ' +
      'usuarios de Supabase— y ninguna tiene por qué existir en la máquina de la tienda',
    coincide: (ruta) => /(^|\/)\.env($|[^/]*)/.test(ruta),
  },
  {
    nombre: 'código fuente sin compilar (src/)',
    porque: 'la aplicación corre desde dist-electron; src/ es TypeScript que nadie ejecuta en la tienda',
    // Anclada en la raíz del asar a propósito: `node_modules/zod/src` es otra
    // cosa y la cubre la regla de las dependencias.
    coincide: (ruta) => ruta.startsWith('/src/') || ruta === '/src',
  },
  {
    nombre: 'carpetas del repositorio (docs/, scripts/, supabase/)',
    porque:
      'son documentación, herramientas de desarrollo y migraciones de la nube: viven en git, no en el ' +
      'disco de Jimmy',
    coincide: (ruta) => /^\/(docs|scripts|supabase)(\/|$)/.test(ruta),
  },
  {
    nombre: 'carpetas de prueba',
    porque: 'las pruebas no se ejecutan en producción y solo agregan peso al instalador',
    coincide: (ruta) => /(^|\/)(__tests__|__mocks__|tests?|spec)\//i.test(ruta),
  },
  {
    nombre: 'archivos de prueba (.test / .spec)',
    porque: 'lo mismo: no se ejecutan en producción',
    coincide: (ruta) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(ruta),
  },
];

/** Una ruta de `asar list` que no es de node_modules no la mira la regla de dependencias. */
const SEGMENTO_DE_PAQUETE = /node_modules\/(@[^/]+\/[^/]+|[^/]+)/g;

function anotar(mensaje) {
  console.info(mensaje);
}

// ---------------------------------------------------------------------------
// Las dependencias de producción REALES
// ---------------------------------------------------------------------------

/**
 * El cierre transitivo de `dependencies` a partir del `package.json` del
 * proyecto, leyendo el árbol instalado.
 *
 * **No alcanza con la lista de `dependencies`**: `better-sqlite3` necesita
 * `node-addon-api` y `react-dom` necesita `scheduler`, y los dos tienen que
 * poder viajar. Lo que no puede viajar es una devDependency, que es donde
 * estaría el problema: `playwright-core`, `vitest`, `electron-builder`.
 *
 * Se siguen también las `optionalDependencies`, porque si están instaladas el
 * paquete puede cargarlas en tiempo de ejecución.
 */
function dependenciasDeProduccion() {
  const raizPaquete = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
  const pendientes = [
    ...Object.keys(raizPaquete.dependencies ?? {}),
    ...Object.keys(raizPaquete.optionalDependencies ?? {}),
  ];
  const vistos = new Set();

  while (pendientes.length > 0) {
    const nombre = pendientes.pop();
    if (nombre === undefined || vistos.has(nombre)) {
      continue;
    }
    vistos.add(nombre);
    const suPaquete = join(RAIZ, 'node_modules', nombre, 'package.json');
    if (!existsSync(suPaquete)) {
      // No está instalado: no puede haber viajado, así que no hace falta
      // seguirlo. Si igual apareciera en el asar, la regla lo va a marcar.
      continue;
    }
    let leido;
    try {
      leido = JSON.parse(readFileSync(suPaquete, 'utf8'));
    } catch {
      continue;
    }
    pendientes.push(...Object.keys(leido.dependencies ?? {}));
    pendientes.push(...Object.keys(leido.optionalDependencies ?? {}));
  }
  return vistos;
}

// ---------------------------------------------------------------------------
// La revisión
// ---------------------------------------------------------------------------

/** Lee el listado del asar sin depender de que `asar` esté en el PATH. */
function listarAsar(rutaDelAsar) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- se carga acá para que el guion falle con un mensaje claro si falta.
  const asar = require('@electron/asar');
  return asar
    .listPackage(rutaDelAsar)
    .map((ruta) => ruta.replace(/\\/g, '/'))
    .filter((ruta) => ruta !== '');
}

/**
 * Revisa una LISTA DE RUTAS contra las reglas. Separada de `revisarPaquete`
 * para que se pueda probar sin armar un paquete: lo que hay que poder
 * falsificar es que cada regla muerda, y para eso no hace falta un `.asar`
 * de 100 MB. La prueba vive en
 * `src/main/__tests__/verificacion-de-paquete.test.ts` y carga ESTE archivo,
 * no una copia, igual que la del seguro de `proyectos-de-prueba.cjs`.
 *
 * Devuelve un hallazgo `{ regla, porque, ruta }` por cada archivo que no
 * debería estar, con su nombre exacto: es lo que hace falta para corregir el
 * patrón que lo dejó pasar, sin adivinar.
 */
function revisarRutas(rutas, dependenciasAdmitidas) {
  const hallazgos = [];
  const produccion = dependenciasAdmitidas;

  for (const ruta of rutas) {
    for (const regla of REGLAS) {
      if (regla.coincide(ruta)) {
        hallazgos.push({ regla: regla.nombre, porque: regla.porque, ruta });
      }
    }

    // Las dependencias: cada segmento `node_modules/<paquete>` de la ruta
    // —puede haber más de uno si hay anidamiento— tiene que estar en el cierre
    // de producción.
    for (const coincidencia of ruta.matchAll(SEGMENTO_DE_PAQUETE)) {
      const paquete = coincidencia[1];
      if (paquete !== undefined && !produccion.has(paquete)) {
        hallazgos.push({
          regla: 'dependencia que no es de producción',
          porque: `«${paquete}» no está en el cierre transitivo de dependencies del proyecto`,
          ruta,
        });
        break;
      }
    }
  }

  return hallazgos;
}

/**
 * A QUÉ PROYECTO DE SUPABASE APUNTA EL PAQUETE, leído del bundle.
 *
 * No es una regla que pueda fallar —apuntar al real puede ser exactamente lo
 * que se quiere el día de la puesta en marcha— pero **tiene que estar a la
 * vista**: un instalador que apunta a un proyecto y no lo dice es la confusión
 * de §4.37, esa vez entre el de pruebas y el real. Se informa siempre, y
 * cuando es el real se dice con todas las letras.
 *
 * Devuelve la referencia del proyecto, o `null` si el paquete se compiló sin
 * nube, que también es un resultado válido y también se informa.
 */
function proyectoDelPaquete(rutaDelAsar) {
  const asar = require('@electron/asar');
  let bundle;
  try {
    bundle = asar.extractFile(rutaDelAsar, 'dist-electron/main/index.js').toString('utf8');
  } catch {
    return null;
  }
  const encontrada = /https:\/\/([a-z0-9-]+)\.supabase\.co/.exec(bundle);
  return encontrada?.[1] ?? null;
}

/** La referencia del proyecto REAL, para poder nombrarlo cuando aparezca. */
const PROYECTO_REAL = require('./proyectos-de-prueba.cjs').PROYECTO_REAL;

/** Revisa un asar de verdad: lista sus rutas y les aplica las reglas. */
function revisarPaquete(rutaDelAsar) {
  const rutas = listarAsar(rutaDelAsar);
  const produccion = dependenciasDeProduccion();
  return {
    rutas,
    hallazgos: revisarRutas(rutas, produccion),
    produccion,
    proyecto: proyectoDelPaquete(rutaDelAsar),
  };
}

/** Imprime el informe y devuelve el código de salida que corresponde. */
function informar(rutaDelAsar, resultado) {
  const { rutas, hallazgos, produccion, proyecto } = resultado;
  anotar(`Revisión del paquete: ${rutaDelAsar}`);
  anotar(`  ${String(rutas.length)} entradas en el asar`);
  if (proyecto === null) {
    anotar('  APUNTA A: ningún proyecto de nube (las pantallas van a decir «sin configurar»)');
  } else if (proyecto === PROYECTO_REAL) {
    anotar(`  APUNTA A: ${proyecto} — ***EL PROYECTO REAL, pos-jimmy-cano***. Lo que esta copia`);
    anotar('            suba va a quedar en la base de la tienda, y `auditoria_log` es inmutable.');
  } else {
    anotar(`  APUNTA A: ${proyecto} (proyecto de pruebas)`);
  }
  anotar(`  dependencias de producción admitidas (${String(produccion.size)}): ${[...produccion].sort().join(', ')}`);

  if (hallazgos.length === 0) {
    for (const regla of REGLAS) {
      anotar(`  OK   sin ${regla.nombre}`);
    }
    anotar('  OK   sin dependencias que no sean de producción');
    anotar(`\nEl paquete está limpio: nada de lo que no debe viajar está adentro.`);
    console.info(`${MARCA_INFORME}${JSON.stringify({ asar: rutaDelAsar, entradas: rutas.length, hallazgos: 0, revisadoEn: new Date().toISOString() })}`);
    return 0;
  }

  // Agrupado por regla, con el nombre EXACTO de cada archivo: lo que hace
  // falta para corregir el patrón que lo dejó pasar.
  const porRegla = new Map();
  for (const hallazgo of hallazgos) {
    const lista = porRegla.get(hallazgo.regla) ?? [];
    lista.push(hallazgo);
    porRegla.set(hallazgo.regla, lista);
  }

  anotar(`\nEL PAQUETE TIENE ${String(hallazgos.length)} ARCHIVO(S) QUE NO DEBERÍAN VIAJAR:\n`);
  for (const [regla, lista] of porRegla) {
    anotar(`  FALLA ${regla} — ${String(lista.length)} archivo(s)`);
    anotar(`        por qué: ${lista[0].porque}`);
    for (const hallazgo of lista) {
      anotar(`        · ${hallazgo.ruta}`);
    }
    anotar('');
  }
  anotar('Se corrige con los patrones `files` de electron-builder.yml. OJO: `files` no es una');
  anotar('lista blanca —hay que excluir por nombre— y `win.files` REEMPLAZA a `files`, así que');
  anotar('la lista va completa bajo `win:` (§4.37 de CLAUDE.md).');
  console.info(
    `${MARCA_INFORME}${JSON.stringify({
      asar: rutaDelAsar,
      entradas: rutas.length,
      hallazgos: hallazgos.length,
      porRegla: Object.fromEntries([...porRegla].map(([r, l]) => [r, l.length])),
      archivos: hallazgos.map((h) => h.ruta),
      revisadoEn: new Date().toISOString(),
    })}`,
  );
  return 1;
}

/** Borra el instalador que hubiera quedado de una corrida anterior. */
function borrarInstaladoresDe(carpeta) {
  if (!existsSync(carpeta)) {
    return [];
  }
  const borrados = [];
  for (const entrada of readdirSync(carpeta)) {
    if (/\.(exe|dmg|zip|blockmap|msi)$/i.test(entrada)) {
      rmSync(join(carpeta, entrada), { force: true });
      borrados.push(entrada);
    }
  }
  return borrados;
}

// ---------------------------------------------------------------------------
// Entrada 1: el hook de electron-builder (lo normal)
// ---------------------------------------------------------------------------

/**
 * `afterPack`: la aplicación ya está empaquetada, el instalador todavía no
 * existe. Lanzar acá aborta el empaquetado, y el `.exe` no llega a crearse.
 */
module.exports = function verificarDespuesDeEmpaquetar(contexto) {
  const { appOutDir, electronPlatformName, packager } = contexto;
  const rutaDelAsar =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app.asar')
      : join(appOutDir, 'resources', 'app.asar');

  anotar(`\n=== ${MARCA_INFORME}: revisando antes de armar el instalador ===`);
  if (!existsSync(rutaDelAsar)) {
    throw new Error(
      `No se encontró el asar en ${rutaDelAsar}. Sin poder revisarlo, el empaquetado se detiene: ` +
        'es preferible no entregar nada a entregar algo sin revisar.',
    );
  }

  const resultado = revisarPaquete(rutaDelAsar);
  if (informar(rutaDelAsar, resultado) !== 0) {
    // La carpeta de salida es la de arriba de `win-unpacked`.
    const carpetaDeSalida = dirname(appOutDir);
    const borrados = borrarInstaladoresDe(carpetaDeSalida);
    if (borrados.length > 0) {
      anotar(`\nSe borraron los instaladores viejos de ${carpetaDeSalida}: ${borrados.join(', ')}`);
      anotar('Estaban de una corrida anterior, y dejarlos ahí después de una revisión fallida');
      anotar('sería dejar a mano un .exe que alguien podría tomar por bueno.');
    }
    throw new Error(
      `El paquete tiene ${String(resultado.hallazgos.length)} archivo(s) que no deberían viajar. ` +
        'El instalador NO se generó. La lista completa está arriba.',
    );
  }
  return Promise.resolve();
};

// ---------------------------------------------------------------------------
// Entrada 2: a mano, contra un paquete ya armado
// ---------------------------------------------------------------------------

/** El asar más reciente bajo `release/`, para poder correrlo sin argumentos. */
function buscarAsarMasReciente() {
  const release = join(RAIZ, 'release');
  if (!existsSync(release)) {
    return null;
  }
  const candidatos = [];
  const recorrer = (carpeta, profundidad) => {
    if (profundidad > 4) {
      return;
    }
    for (const entrada of readdirSync(carpeta)) {
      const ruta = join(carpeta, entrada);
      let info;
      try {
        info = statSync(ruta);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        recorrer(ruta, profundidad + 1);
      } else if (entrada === 'app.asar') {
        candidatos.push({ ruta, cuando: info.mtimeMs });
      }
    }
  };
  recorrer(release, 0);
  candidatos.sort((a, b) => b.cuando - a.cuando);
  return candidatos[0]?.ruta ?? null;
}

if (require.main === module) {
  const pedido = process.argv[2];
  const rutaDelAsar = pedido ?? buscarAsarMasReciente();
  if (rutaDelAsar === null || rutaDelAsar === undefined) {
    console.error(
      'No hay ningún app.asar bajo release/. Armá el paquete primero (`npm run dist:win`) o pasá la ruta:\n' +
        '  npm run verify:paquete -- ruta/al/app.asar',
    );
    process.exit(2);
  }
  if (!existsSync(rutaDelAsar)) {
    console.error(`No existe ${rutaDelAsar}.`);
    process.exit(2);
  }
  try {
    process.exit(informar(rutaDelAsar, revisarPaquete(rutaDelAsar)));
  } catch (error) {
    console.error(`No se pudo revisar el paquete: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

module.exports.revisarPaquete = revisarPaquete;
module.exports.revisarRutas = revisarRutas;
module.exports.dependenciasDeProduccion = dependenciasDeProduccion;
module.exports.REGLAS = REGLAS;
