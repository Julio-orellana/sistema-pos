/**
 * verificacion-de-arranque-sin-respuesta-de-red.cjs — La aplicación REAL
 * arranca y muestra su primera pantalla aunque la red nunca conteste.
 *
 * Nace del primer hallazgo en la tienda de Jimmy (2026-09-17): con la red del
 * local conectada, la aplicación no llegaba a mostrar ninguna pantalla, con
 * CPU y disco en 0 %; sin red, abría normal. La hipótesis es una petición de
 * red que nunca se resuelve ni se rechaza porque algo en esa red descarta los
 * paquetes en silencio.
 *
 * Este guion no puede reproducir la red de la tienda. Reproduce las formas de
 * «nunca contesta» que sí se pueden fabricar en esta máquina, y en cada una
 * mide lo que Jimmy vería:
 *
 *   A. NUBE MUDA: un servidor local que acepta la conexión TCP y nunca manda
 *      un byte. Con credencial guardada y filas pendientes, así que el arranque
 *      intenta renovar la sesión de verdad.
 *   B. PAQUETES DESCARTADOS: la nube apunta a https://10.255.255.1, una
 *      dirección privada a la que el SYN sale y nunca vuelve nada.
 *   C. AUTH CONTESTA, LA SUBIDA NO: un servidor que entrega un token (falso,
 *      sin firma válida) y contesta el health de Auth como lo firma Supabase
 *      (200, `sb-project-ref`, cuerpo de GoTrue), y se calla en todo lo demás.
 *      El primer ciclo del trabajador manda un lote a una nube que nunca
 *      responde. HAY CONEXIÓN: la barra tiene que decir «problema al
 *      sincronizar», nunca «sin conexión» (§4.51).
 *   E. AUTH DIO EL TOKEN Y DESPUÉS LA NUBE CALLA ENTERA: el mismo servidor de
 *      C pero SIN contestar el health. Hay token en memoria, como cuando la red
 *      se cae a mitad del día, y la subida no contesta. NO hay conexión: la
 *      barra tiene que decir «sin conexión», nunca «problema al sincronizar».
 *      Es el caso que mirar solo el token confundiría.
 *   D. NUBE REAL (solo con --con-nube-de-pruebas): `pos-pruebas-descartable`,
 *      con la credencial de terminal de `.env.nube-pruebas` y SIN filas
 *      pendientes, así que no se sube ni una fila. Es el caso normal: se tiene
 *      que conectar sin demora perceptible.
 *
 * En cada escenario hay dos arranques sobre la misma carpeta de datos TEMPORAL.
 * El primero prepara (primer administrador y credencial cifrada con el
 * `safeStorage` real). El segundo es el que se mide:
 *
 *   - cuándo el proceso principal llamó a `show()`, leído del renglón
 *     «[arranque] ventana mostrada a los N ms» de la bitácora. ES EL DATO QUE
 *     CUENTA: en macOS, una ventana creada con `show: false` y
 *     `fullscreen: true` se vuelve visible SOLA (medido el 2026-09-17, sonda
 *     con Electron 44.2.0: `isVisible()` pasa a `true` entre los 200 ms y 1 s
 *     sin ningún `show()`), así que `isVisible()` no prueba nada en esta Mac.
 *     En Windows el constructor solo guarda el estado de pantalla completa y
 *     la ventana sigue escondida hasta `show()` (leído en
 *     `shell/browser/native_window_views.cc` de la v44.2.0, no medido);
 *   - cuánto tarda la ventana en estar visible según `isVisible()`, con la
 *     salvedad de arriba;
 *   - cuánto tarda la primera pantalla (la de ingreso) en dibujarse;
 *   - si el proceso principal contesta el IPC, al principio y mientras la
 *     petición de red sigue colgada;
 *   - qué dejó la bitácora técnica, con la hora de cada renglón;
 *   - qué dijo la barra de estado durante toda la espera (se lee cada 250 ms y
 *     se anota cada cambio con su hora) y qué dice al final. La barra se
 *     refresca sola cada 20 s, así que en C y en E se espera a que aparezca el
 *     texto esperado, con un tope, en vez de leerla una sola vez a ciegas.
 *
 * Código 0 si todo pasa, 1 si alguna comprobación falla, 2 si faltó algo.
 */

const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const netNode = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const rutaDeElectron = require('electron');

const { exigirProyectoDePrueba } = require('./proyectos-de-prueba.cjs');

const PROYECTO = join(__dirname, '..');
const PIN = '2468';
const ARCHIVO_DE_CREDENCIAL = 'sincronizacion.credencial';
const ARCHIVO_DE_LOG = 'log-tecnico.log';

/** Lo máximo que se tolera para que la ventana aparezca. En macOS sano tarda menos de 2 s. */
const VENTANA_VISIBLE_EN_MENOS_DE_MS = 10_000;
/**
 * Lo máximo, contado desde el inicio del proceso, para que la bitácora diga
 * que se llamó a `show()`: los 10 s del respaldo de `mostrar-ventana.ts` más
 * un segundo de margen, así el camino «nunca llegó ready-to-show» también pasa.
 */
const MOSTRADA_EN_BITACORA_EN_MENOS_DE_MS = 11_000;
/** Lo máximo para que la primera pantalla esté dibujada. */
const PRIMERA_PANTALLA_EN_MENOS_DE_MS = 12_000;
/** Lo máximo que puede tardar el proceso principal en contestar un IPC trivial. */
const IPC_EN_MENOS_DE_MS = 1_000;
/** El texto que la barra tiene que mostrar en C, exacto (§4.51). */
const TEXTO_DE_C = 'Nube: problema al sincronizar — 2 pendientes';
/**
 * Hasta cuándo, contado desde el lanzamiento, se espera el texto de la barra en
 * C y en E: primer ciclo a los 30 s de mostrar la ventana, 30 s de límite de la
 * subida, hasta 8 s del health y hasta 20 s del sondeo de la barra, con margen.
 */
const TOPE_PARA_LA_BARRA_MS = 115_000;

const comprobaciones = [];
const INICIO = Date.now();

function anotar(texto) {
  console.info(`${new Date().toISOString()}  ${texto}`);
}

function comprobar(nombre, esperado, real, paso) {
  comprobaciones.push({ nombre, paso });
  console.info(`${new Date().toISOString()}  ${paso ? 'OK   ' : 'FALLA'} ${nombre}`);
  if (!paso) {
    console.info(`           esperado: ${String(esperado)}`);
    console.info(`           real    : ${String(real)}`);
  }
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// ---------------------------------------------------------------------------
// Las «nubes» que nunca contestan
// ---------------------------------------------------------------------------

/** Acepta la conexión TCP y no manda nunca nada. */
async function levantarNubeMuda() {
  const sockets = new Set();
  const servidor = netNode.createServer((socket) => {
    sockets.add(socket);
    // Se lee lo que llega (y se descarta): un socket en pausa nunca emite
    // 'end', así que un cliente que cerró seguiría contándose como abierto.
    // Medido el 2026-09-17: sin esto la cuenta daba una conexión «abierta» por
    // cada petición cortada; leyendo, cero.
    socket.resume();
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  return {
    url: `http://127.0.0.1:${String(servidor.address().port)}`,
    conexiones: () => sockets.size,
    cerrar: () => {
      for (const socket of sockets) socket.destroy();
      servidor.close();
    },
  };
}

function base64url(objeto) {
  return Buffer.from(JSON.stringify(objeto)).toString('base64url');
}

/** Un access token con la forma de uno de Supabase. NO tiene firma válida: nadie lo verifica acá. */
function tokenFalso() {
  const ahora = Math.floor(Date.now() / 1000);
  const VIDA_S = 900;
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({
      iat: ahora,
      exp: ahora + VIDA_S,
      email: 'terminal-de-verificacion@local.invalid',
      is_anonymous: false,
      app_metadata: { rol: 'terminal' },
    }),
    'firma-falsa',
  ].join('.');
}

/**
 * La referencia del proyecto que la aplicación espera en `sb-project-ref`. La
 * saca del primer pedazo del host (`index.ts`), así que para
 * `http://127.0.0.1:PUERTO` es «127».
 */
const REFERENCIA_DEL_SERVIDOR_LOCAL = '127';

/**
 * Contesta el refresco de Auth con un token y se calla en todo lo demás.
 *
 * Con `contestaSalud`, contesta además `GET /auth/v1/health` como lo contesta
 * Supabase: 200, `sb-project-ref` con la referencia que la aplicación espera y
 * el cuerpo de GoTrue (medido en §4.24). Es lo que la capa 2 de §5.2 exige para
 * creer que se llega a la nube de este proyecto.
 */
async function levantarNubeQueContestaAuth({ contestaSalud }) {
  const colgadas = new Set();
  const peticiones = [];
  const servidor = http.createServer((pedido, respuesta) => {
    peticiones.push(`${new Date().toISOString()} ${pedido.method} ${pedido.url}`);
    if (pedido.method === 'POST' && pedido.url.startsWith('/auth/v1/token')) {
      pedido.resume();
      pedido.on('end', () => {
        respuesta.writeHead(200, { 'Content-Type': 'application/json' });
        respuesta.end(JSON.stringify({ access_token: tokenFalso(), refresh_token: 'refresco-rotado', expires_in: 900 }));
      });
      return;
    }
    if (contestaSalud && pedido.method === 'GET' && pedido.url.startsWith('/auth/v1/health')) {
      pedido.resume();
      respuesta.writeHead(200, {
        'Content-Type': 'application/json',
        'sb-project-ref': REFERENCIA_DEL_SERVIDOR_LOCAL,
      });
      respuesta.end(JSON.stringify({ version: 'v2.196.0', name: 'GoTrue', description: 'GoTrue is a user registration and authentication API' }));
      return;
    }
    // Todo lo demás: se lee el pedido y no se contesta nunca.
    pedido.resume();
    colgadas.add(respuesta);
  });
  const sockets = new Set();
  servidor.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  return {
    url: `http://127.0.0.1:${String(servidor.address().port)}`,
    peticiones,
    cerrar: () => {
      for (const socket of sockets) socket.destroy();
      servidor.close();
    },
  };
}

// ---------------------------------------------------------------------------
// La aplicación
// ---------------------------------------------------------------------------

async function lanzar(datos, entornoDeNube) {
  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
    env: { ...process.env, ...entornoDeNube },
  });
  let salida = '';
  app.process().stdout?.on('data', (trozo) => {
    salida += trozo.toString();
  });
  app.process().stderr?.on('data', (trozo) => {
    salida += trozo.toString();
  });
  return { app, salida: () => salida };
}

async function salir(app) {
  try {
    await app.evaluate(({ app: aplicacion }) => {
      aplicacion.exit(0);
    });
  } catch {
    // El proceso ya se fue: es lo esperado.
  }
  await esperar(500);
}

/** Primer arranque: primer administrador (deja filas en la cola) y credencial cifrada. */
async function preparar(datos, entornoDeNube, { tokenDeRefresco, conPendientes }) {
  const { app } = await lanzar(datos, entornoDeNube);
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  if (conPendientes) {
    await ventana.locator('[data-prueba="pantalla-de-configuracion-inicial"]').waitFor({ timeout: 20_000 });
    const creado = await ventana.evaluate(
      ([pin]) => window.pos.sesion.crearPrimerAdministrador('Jimmy de verificación', pin),
      [PIN],
    );
    if (!creado.ok) {
      throw new Error(`No se pudo crear el primer administrador: ${JSON.stringify(creado)}`);
    }
  }
  // Se cifra con el `safeStorage` REAL de esta identidad de aplicación, que es
  // la que va a descifrarlo en el segundo arranque. El token no se imprime.
  const cifradoEnBase64 = await app.evaluate(
    ({ safeStorage }, token) => safeStorage.encryptString(token).toString('base64'),
    tokenDeRefresco,
  );
  await salir(app);
  writeFileSync(join(datos, ARCHIVO_DE_CREDENCIAL), Buffer.from(cifradoEnBase64, 'base64'), { mode: 0o600 });
}

/** Segundo arranque: el que se mide. */
async function medirArranque(
  nombre,
  datos,
  entornoDeNube,
  { esperaDespuesMs, conPendientes, barraEsperada = null, barraHastaMs = 0 },
) {
  anotar(`--- ${nombre}: arranque medido ---`);
  const lanzadoEn = Date.now();
  const { app, salida } = await lanzar(datos, entornoDeNube);

  // La ventana VISIBLE, no solo creada: `firstWindow()` resuelve con la ventana
  // escondida, y lo que vería Jimmy es si se muestra.
  let visibleEnMs = null;
  while (Date.now() - lanzadoEn < VENTANA_VISIBLE_EN_MENOS_DE_MS * 3) {
    let visible = false;
    try {
      visible = await app.evaluate(({ BrowserWindow }) => {
        const [ventanaPrincipal] = BrowserWindow.getAllWindows();
        return ventanaPrincipal !== undefined && ventanaPrincipal.isVisible();
      });
    } catch {
      visible = false;
    }
    if (visible) {
      visibleEnMs = Date.now() - lanzadoEn;
      break;
    }
    await esperar(50);
  }
  anotar(`${nombre}: ventana visible a los ${visibleEnMs === null ? 'NUNCA (30 s)' : `${String(visibleEnMs)} ms`}`);
  comprobar(
    `${nombre}: la ventana está VISIBLE en menos de ${String(VENTANA_VISIBLE_EN_MENOS_DE_MS / 1000)} s`,
    `< ${String(VENTANA_VISIBLE_EN_MENOS_DE_MS)} ms`,
    visibleEnMs,
    visibleEnMs !== null && visibleEnMs < VENTANA_VISIBLE_EN_MENOS_DE_MS,
  );

  const ventana = await app.firstWindow();

  /*
    TODO lo que la barra de nube dijo, con la hora de cada cambio. Se lee cada
    250 ms desde que existe la ventana hasta que se va a salir: así «nunca dijo
    X» se comprueba sobre toda la espera, no sobre una sola lectura al final.
  */
  const barrasVistas = [];
  let muestreando = true;
  const muestreo = (async () => {
    while (muestreando) {
      const texto = await ventana
        .locator('[data-prueba="barra-nube"]')
        .innerText({ timeout: 250 })
        .catch(() => null);
      if (texto !== null && barrasVistas.at(-1)?.texto !== texto) {
        barrasVistas.push({ ms: Date.now() - lanzadoEn, texto });
        anotar(`${nombre}: la barra cambió a los ${String(Date.now() - lanzadoEn)} ms: «${texto}»`);
      }
      await esperar(250);
    }
  })();

  const pantallaEsperada = conPendientes ? 'pantalla-de-ingreso' : 'pantalla-de-configuracion-inicial';
  let pantallaEnMs = null;
  try {
    await ventana.locator(`[data-prueba="${pantallaEsperada}"]`).waitFor({ timeout: PRIMERA_PANTALLA_EN_MENOS_DE_MS * 2 });
    pantallaEnMs = Date.now() - lanzadoEn;
  } catch {
    pantallaEnMs = null;
  }
  anotar(`${nombre}: «${pantallaEsperada}» dibujada a los ${pantallaEnMs === null ? 'NUNCA' : `${String(pantallaEnMs)} ms`}`);
  comprobar(
    `${nombre}: la primera pantalla (${pantallaEsperada}) está dibujada en menos de ${String(PRIMERA_PANTALLA_EN_MENOS_DE_MS / 1000)} s`,
    `< ${String(PRIMERA_PANTALLA_EN_MENOS_DE_MS)} ms`,
    pantallaEnMs,
    pantallaEnMs !== null && pantallaEnMs < PRIMERA_PANTALLA_EN_MENOS_DE_MS,
  );

  const medirIpc = async () => {
    const antes = Date.now();
    const respuesta = await ventana.evaluate(() => window.pos.sesion.estado());
    return { ms: Date.now() - antes, ok: respuesta.ok };
  };
  const ipcAlPrincipio = await medirIpc();
  anotar(`${nombre}: IPC sesion.estado() a los ${String(Date.now() - lanzadoEn)} ms contestó en ${String(ipcAlPrincipio.ms)} ms (ok=${String(ipcAlPrincipio.ok)})`);
  comprobar(
    `${nombre}: el proceso principal contesta el IPC en seguida, al principio`,
    `ok en < ${String(IPC_EN_MENOS_DE_MS)} ms`,
    JSON.stringify(ipcAlPrincipio),
    ipcAlPrincipio.ok && ipcAlPrincipio.ms < IPC_EN_MENOS_DE_MS,
  );

  // Mientras la petición de red sigue colgada, el proceso tiene que seguir
  // atendiendo: se mide a mitad de la espera.
  await esperar(Math.floor(esperaDespuesMs / 2));
  const ipcAMitad = await medirIpc();
  anotar(`${nombre}: IPC sesion.estado() a los ${String(Date.now() - lanzadoEn)} ms contestó en ${String(ipcAMitad.ms)} ms (ok=${String(ipcAMitad.ok)})`);
  comprobar(
    `${nombre}: el proceso principal contesta el IPC a mitad de la espera (en A, B y C, con la petición de red todavía colgada)`,
    `ok en < ${String(IPC_EN_MENOS_DE_MS)} ms`,
    JSON.stringify(ipcAMitad),
    ipcAMitad.ok && ipcAMitad.ms < IPC_EN_MENOS_DE_MS,
  );
  await esperar(esperaDespuesMs - Math.floor(esperaDespuesMs / 2));

  // Si se espera un texto, se espera a que la barra lo diga AHORA (se refresca
  // cada 20 s), con un tope contado desde el lanzamiento. Se mira el ÚLTIMO
  // texto y no «alguno de los vistos»: la primera versión de este guion miraba
  // cualquiera, y en E dio por bueno un «sin conexión» de los primeros 510 ms
  // aunque a los 75 s la barra decía «Nube: 2 pendientes» (corrida del
  // 2026-09-17, 13:59 UTC). Una comprobación que pasa en falso es peor que
  // ninguna.
  if (barraEsperada !== null) {
    while (
      Date.now() - lanzadoEn < barraHastaMs &&
      !(barrasVistas.at(-1)?.texto ?? '').includes(barraEsperada)
    ) {
      await esperar(250);
    }
  }
  muestreando = false;
  await muestreo;

  const barra = await ventana
    .locator('[data-prueba="barra-nube"]')
    .innerText({ timeout: 2_000 })
    .catch(() => '(no se encontró el indicador)');
  anotar(`${nombre}: barra de estado a los ${String(Date.now() - lanzadoEn)} ms: «${barra}»`);

  const rutaDeLog = join(datos, ARCHIVO_DE_LOG);
  const log = existsSync(rutaDeLog) ? readFileSync(rutaDeLog, 'utf8') : '';
  const lineasDeEsteArranque = log
    .split('\n')
    .filter((linea) => linea !== '' && Date.parse(linea.slice(0, 24)) >= lanzadoEn);
  for (const linea of lineasDeEsteArranque) {
    const instante = Date.parse(linea.slice(0, 24));
    console.info(`    log-tecnico +${String(instante - lanzadoEn).padStart(6)} ms: ${linea.slice(25)}`);
  }
  // El ORDEN, leído de la bitácora: la ventana se mostró ANTES de que arrancara
  // cualquier cosa que usa la red. Es lo que la compuerta del arranque garantiza
  // por construcción, visto en la aplicación de verdad.
  const indiceDe = (texto) => lineasDeEsteArranque.findIndex((linea) => linea.includes(texto));
  const mostrada = indiceDe('[arranque] ventana mostrada');
  const primeraDeRed = lineasDeEsteArranque.findIndex(
    (linea) =>
      linea.includes('[arranque] arranca lo que usa la red') ||
      linea.includes('trabajador en marcha') ||
      linea.includes('Auth ') ||
      linea.includes('access token renovado'),
  );
  // Cuándo se llamó a `show()`, según el propio proceso principal: en macOS
  // `isVisible()` no lo distingue (ver la cabecera).
  const renglonMostrada = mostrada === -1 ? '' : lineasDeEsteArranque[mostrada];
  const coincidencia = /ventana mostrada a los (\d+) ms del inicio del proceso/.exec(renglonMostrada);
  const mostradaALosMs = coincidencia === null ? null : Number(coincidencia[1]);
  comprobar(
    `${nombre}: según la bitácora, show() se llamó a más tardar a los ${String(MOSTRADA_EN_BITACORA_EN_MENOS_DE_MS / 1000)} s del inicio del proceso`,
    `renglón «ventana mostrada a los N ms», con N ≤ ${String(MOSTRADA_EN_BITACORA_EN_MENOS_DE_MS)}`,
    renglonMostrada === '' ? '(no hay renglón «ventana mostrada»)' : renglonMostrada,
    mostradaALosMs !== null && mostradaALosMs <= MOSTRADA_EN_BITACORA_EN_MENOS_DE_MS,
  );
  comprobar(
    `${nombre}: en la bitácora, «ventana mostrada» está ANTES que todo renglón de red`,
    'índice de «ventana mostrada» < índice del primer renglón de red',
    `ventana mostrada en el renglón ${String(mostrada)}; primer renglón de red en el ${String(primeraDeRed)}`,
    mostrada !== -1 && primeraDeRed !== -1 && mostrada < primeraDeRed,
  );

  await salir(app);
  return { visibleEnMs, pantallaEnMs, barra, barrasVistas, lineas: lineasDeEsteArranque, salida: salida(), lanzadoEn };
}

/** Todos los textos que mostró la barra, en orden, para la salida cruda. */
function barrasEnUnRenglon(medido) {
  return medido.barrasVistas.map((vista) => `+${String(vista.ms)} ms «${vista.texto}»`).join(' → ');
}

function lineaCon(lineas, texto) {
  return lineas.find((linea) => linea.includes(texto)) ?? null;
}

function msDesde(linea, lanzadoEn) {
  return linea === null ? null : Date.parse(linea.slice(0, 24)) - lanzadoEn;
}

function leerEntornoDePruebas() {
  const ruta = join(PROYECTO, '.env.nube-pruebas');
  if (!existsSync(ruta)) {
    console.error(`Falta ${ruta}: el escenario D necesita las credenciales del proyecto de PRUEBAS.`);
    process.exit(2);
  }
  const valores = {};
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (limpia === '' || limpia.startsWith('#')) continue;
    const separador = limpia.indexOf('=');
    if (separador <= 0) continue;
    valores[limpia.slice(0, separador).trim()] = limpia.slice(separador + 1).trim();
  }
  return valores;
}

async function main() {
  const conNubeDePruebas = process.argv.includes('--con-nube-de-pruebas');
  const soloEscenario = process.argv.find((argumento) => argumento.startsWith('--solo='))?.slice('--solo='.length) ?? '';
  const correr = (letra) => soloEscenario === '' || soloEscenario.includes(letra);

  // ----- A. Nube muda -------------------------------------------------------
  if (correr('A')) {
    const muda = await levantarNubeMuda();
    const datos = mkdtempSync(join(tmpdir(), 'pos-arranque-muda-'));
    anotar(`A. NUBE MUDA en ${muda.url} (acepta TCP y nunca contesta); datos en ${datos}`);
    const entorno = { POS_NUBE_URL: muda.url, POS_NUBE_LLAVE_PUBLICABLE: 'llave-de-verificacion', POS_SYNC_PROVIDER: 'supabase' };
    await preparar(datos, entorno, { tokenDeRefresco: 'refresco-de-verificacion', conPendientes: true });
    const medido = await medirArranque('A', datos, entorno, {
      esperaDespuesMs: 40_000,
      conPendientes: true,
      barraEsperada: 'sin conexión',
      barraHastaMs: TOPE_PARA_LA_BARRA_MS,
    });
    anotar(`A: conexiones abiertas contra la nube muda al final: ${String(muda.conexiones())}`);
    const agotada = lineaCon(medido.lineas, 'Auth no contestó a la renovación de la sesión');
    comprobar(
      'A: la renovación contra la nube muda TERMINA sola, como «no contestó», y queda en la bitácora',
      'un renglón «Auth no contestó a la renovación…»',
      agotada ?? '(ningún renglón)',
      agotada !== null,
    );
    anotar(`A: ese renglón quedó a los ${String(msDesde(agotada, medido.lanzadoEn))} ms del lanzamiento`);
    comprobar(
      'A: la barra de estado dice «sin conexión», no se queda esperando',
      '«Nube: sin conexión — N pendientes»',
      medido.barra,
      medido.barra.includes('sin conexión'),
    );
    comprobar(
      'A: sin conexión, la barra NUNCA dijo «problema al sincronizar» en toda la espera',
      'ningún texto con «problema al sincronizar»',
      barrasEnUnRenglon(medido),
      !medido.barrasVistas.some((vista) => vista.texto.includes('problema al sincronizar')),
    );
    muda.cerrar();
  }

  // ----- B. Paquetes descartados ----------------------------------------------
  if (correr('B')) {
    const datos = mkdtempSync(join(tmpdir(), 'pos-arranque-descartada-'));
    const url = 'https://10.255.255.1';
    anotar(`B. PAQUETES DESCARTADOS: la nube apunta a ${url}; datos en ${datos}`);
    const entorno = { POS_NUBE_URL: url, POS_NUBE_LLAVE_PUBLICABLE: 'llave-de-verificacion', POS_SYNC_PROVIDER: 'supabase' };
    await preparar(datos, entorno, { tokenDeRefresco: 'refresco-de-verificacion', conPendientes: true });
    const medido = await medirArranque('B', datos, entorno, {
      esperaDespuesMs: 40_000,
      conPendientes: true,
      barraEsperada: 'sin conexión',
      barraHastaMs: TOPE_PARA_LA_BARRA_MS,
    });
    const agotada = lineaCon(medido.lineas, 'Auth no contestó a la renovación de la sesión');
    comprobar(
      'B: la renovación hacia una dirección que descarta paquetes TERMINA sola y queda en la bitácora',
      'un renglón «Auth no contestó a la renovación…»',
      agotada ?? '(ningún renglón)',
      agotada !== null,
    );
    anotar(`B: ese renglón quedó a los ${String(msDesde(agotada, medido.lanzadoEn))} ms del lanzamiento`);
    comprobar(
      'B: la barra de estado dice «sin conexión»',
      '«Nube: sin conexión — N pendientes»',
      medido.barra,
      medido.barra.includes('sin conexión'),
    );
    comprobar(
      'B: SIN CONEXIÓN REAL la barra NUNCA dijo «problema al sincronizar» en toda la espera (lo que la distingue de C)',
      'ningún texto con «problema al sincronizar»',
      barrasEnUnRenglon(medido),
      !medido.barrasVistas.some((vista) => vista.texto.includes('problema al sincronizar')),
    );
  }

  // ----- C. Auth contesta, la subida no ----------------------------------------
  if (correr('C')) {
    const nube = await levantarNubeQueContestaAuth({ contestaSalud: true });
    const datos = mkdtempSync(join(tmpdir(), 'pos-arranque-subida-muda-'));
    anotar(`C. AUTH CONTESTA (token y health) Y LA SUBIDA NO, en ${nube.url}; datos en ${datos}`);
    const entorno = { POS_NUBE_URL: nube.url, POS_NUBE_LLAVE_PUBLICABLE: 'llave-de-verificacion', POS_SYNC_PROVIDER: 'supabase' };
    await preparar(datos, entorno, { tokenDeRefresco: 'refresco-de-verificacion', conPendientes: true });
    const medido = await medirArranque('C', datos, entorno, {
      esperaDespuesMs: 75_000,
      conPendientes: true,
      barraEsperada: TEXTO_DE_C,
      barraHastaMs: TOPE_PARA_LA_BARRA_MS,
    });
    for (const peticion of nube.peticiones) {
      console.info(`    nube de mentira recibió: ${peticion}`);
    }
    const renovada = lineaCon(medido.lineas, 'access token renovado');
    comprobar('C: la sesión se renovó contra la nube de mentira', 'renglón «access token renovado»', renovada ?? '(ninguno)', renovada !== null);
    const noContesto = lineaCon(medido.lineas, 'no contestó en');
    comprobar(
      'C: el lote mandado a una nube que nunca contesta TERMINA como «no contestó» y el trabajador sigue',
      'renglón «… no contestó en N s.»',
      noContesto ?? '(ninguno)',
      noContesto !== null,
    );
    anotar(`C: ese renglón quedó a los ${String(msDesde(noContesto, medido.lanzadoEn))} ms del lanzamiento`);
    const medida = lineaCon(medido.lineas, 'después del fallo, la nube de este proyecto SÍ contesta');
    comprobar(
      'C: después del fallo, el trabajador comprobó la capa 2 y la nube SÍ contestó',
      'renglón «después del fallo, la nube de este proyecto SÍ contesta…»',
      medida ?? '(ninguno)',
      medida !== null,
    );
    comprobar(
      `C: al final, la barra dice EXACTAMENTE «${TEXTO_DE_C}»`,
      `«${TEXTO_DE_C}» antes de los ${String(TOPE_PARA_LA_BARRA_MS / 1000)} s`,
      `final «${medido.barra}»; recorrido: ${barrasEnUnRenglon(medido)}`,
      medido.barra === TEXTO_DE_C,
    );
    comprobar(
      'C: CON CONEXIÓN la barra NUNCA dijo «sin conexión» en toda la espera (lo que la distingue de B)',
      'ningún texto con «sin conexión»',
      barrasEnUnRenglon(medido),
      !medido.barrasVistas.some((vista) => vista.texto.includes('sin conexión')),
    );
    nube.cerrar();
  }

  // ----- E. Auth dio el token y después la nube calla entera ----------------------
  if (correr('E')) {
    const nube = await levantarNubeQueContestaAuth({ contestaSalud: false });
    const datos = mkdtempSync(join(tmpdir(), 'pos-arranque-nube-que-calla-'));
    anotar(`E. AUTH DA EL TOKEN, DESPUÉS NI EL HEALTH NI LA SUBIDA CONTESTAN, en ${nube.url}; datos en ${datos}`);
    const entorno = { POS_NUBE_URL: nube.url, POS_NUBE_LLAVE_PUBLICABLE: 'llave-de-verificacion', POS_SYNC_PROVIDER: 'supabase' };
    await preparar(datos, entorno, { tokenDeRefresco: 'refresco-de-verificacion', conPendientes: true });
    const medido = await medirArranque('E', datos, entorno, {
      esperaDespuesMs: 75_000,
      conPendientes: true,
      barraEsperada: 'sin conexión',
      barraHastaMs: TOPE_PARA_LA_BARRA_MS,
    });
    for (const peticion of nube.peticiones) {
      console.info(`    nube de mentira recibió: ${peticion}`);
    }
    const renovada = lineaCon(medido.lineas, 'access token renovado');
    comprobar('E: la sesión se renovó (hay token en memoria)', 'renglón «access token renovado»', renovada ?? '(ninguno)', renovada !== null);
    const medida = lineaCon(medido.lineas, 'después del fallo, no se llega a la nube');
    comprobar(
      'E: después del fallo, el trabajador comprobó la capa 2 y NO se llegó a la nube',
      'renglón «después del fallo, no se llega a la nube: …»',
      medida ?? '(ninguno)',
      medida !== null,
    );
    comprobar(
      'E: con token pero sin nube, al final la barra dice «sin conexión»',
      '«Nube: sin conexión — 2 pendientes»',
      `final «${medido.barra}»; recorrido: ${barrasEnUnRenglon(medido)}`,
      medido.barra === 'Nube: sin conexión — 2 pendientes',
    );
    comprobar(
      'E: con token pero sin nube, la barra NUNCA dijo «problema al sincronizar» (mirar solo el token la habría confundido)',
      'ningún texto con «problema al sincronizar»',
      barrasEnUnRenglon(medido),
      !medido.barrasVistas.some((vista) => vista.texto.includes('problema al sincronizar')),
    );
    nube.cerrar();
  }

  // ----- D. La nube de pruebas de verdad ---------------------------------------
  if (conNubeDePruebas && correr('D')) {
    const entornoDePruebas = leerEntornoDePruebas();
    exigirProyectoDePrueba(entornoDePruebas.POS_NUBE_PROYECTO, entornoDePruebas.POS_NUBE_URL);
    const datos = mkdtempSync(join(tmpdir(), 'pos-arranque-nube-de-pruebas-'));
    anotar(`D. NUBE REAL DE PRUEBAS (${entornoDePruebas.POS_NUBE_PROYECTO}), sin filas pendientes; datos en ${datos}`);
    // El token de refresco se consigue por fuera y NUNCA se imprime.
    const antes = Date.now();
    const ingreso = await fetch(`${entornoDePruebas.POS_NUBE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: entornoDePruebas.POS_NUBE_LLAVE_PUBLICABLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: entornoDePruebas.POS_NUBE_TERMINAL_CORREO, password: entornoDePruebas.POS_NUBE_TERMINAL_CLAVE }),
    });
    const cuerpo = await ingreso.json();
    anotar(`D: POST /auth/v1/token?grant_type=password (desde el guion) -> HTTP ${String(ingreso.status)} en ${String(Date.now() - antes)} ms`);
    if (!ingreso.ok || typeof cuerpo.refresh_token !== 'string') {
      console.error('D: no se pudo obtener la credencial de terminal del proyecto de pruebas.');
      process.exit(2);
    }
    const entorno = {
      POS_NUBE_URL: entornoDePruebas.POS_NUBE_URL,
      POS_NUBE_LLAVE_PUBLICABLE: entornoDePruebas.POS_NUBE_LLAVE_PUBLICABLE,
      POS_SYNC_PROVIDER: 'supabase',
    };
    // Sin primer administrador: la cola queda VACÍA y no se sube nada.
    await preparar(datos, entorno, { tokenDeRefresco: cuerpo.refresh_token, conPendientes: false });
    const medido = await medirArranque('D', datos, entorno, { esperaDespuesMs: 8_000, conPendientes: false });
    const renovada = lineaCon(medido.lineas, 'access token renovado');
    const renovadaEnMs = msDesde(renovada, medido.lanzadoEn);
    comprobar('D: con la nube de verdad, la sesión se renueva', 'renglón «access token renovado»', renovada ?? '(ninguno)', renovada !== null);
    anotar(`D: renovada a los ${String(renovadaEnMs)} ms del lanzamiento; ventana visible a los ${String(medido.visibleEnMs)} ms`);
    comprobar(
      'D: con la nube de verdad, la barra dice «al día»',
      '«Nube: al día»',
      medido.barra,
      medido.barra.includes('al día'),
    );
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(`\n${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas (${String(Math.round((Date.now() - INICIO) / 1000))} s en total).`);
  for (const falla of fallidas) {
    console.info(`  - ${falla.nombre}`);
  }
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
