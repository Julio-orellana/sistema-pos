/**
 * verificacion-de-restauracion-en-pantalla.cjs — LA RESTAURACIÓN DESDE LA NUBE,
 * manejando la aplicación REAL de punta a punta contra `pos-pruebas-descartable`.
 *
 * `npm run verify:pantallas:restauracion`. Es la contraparte CON RED de
 * `verify:pantallas`, que corre sin `POS_NUBE_URL` a propósito y por eso solo
 * puede comprobar que la pantalla de restauración diga «sin configurar». Acá
 * se le da a la aplicación el proyecto de PRUEBAS y se recorre con clics, como
 * lo haría una persona, el camino feliz completo de la fase 4.b (CLAUDE.md
 * §4.35), incluidas las dos cosas que Julio pidió ver en la ventana y no solo
 * en el servicio:
 *
 *   · la pantalla de «hay usuarios sin PIN» BLOQUEANDO el cierre, hasta que
 *     cada usuario activo recibe su PIN nuevo;
 *   · retomar después de MATAR el proceso de Electron a la fuerza —no
 *     cancelar desde la propia aplicación— en un arranque nuevo y limpio.
 *
 * DOS INSTALACIONES, DOS CARPETAS DE DATOS TEMPORALES, UNA MISMA NUBE:
 *
 *   FASE A — la terminal de ORIGEN, por la ventana. Crea el primer
 *     administrador, conecta la terminal con la nube («Conectar con la nube»,
 *     con la credencial de TERMINAL), carga una categoría, un producto y una
 *     cajera, abre la caja y cobra una venta, que emite su recibo. Espera a que
 *     la cola suba entera —es el trabajador de la fase 1.b y el proveedor de la
 *     3.b, los de la aplicación— y anota los ids de la base A.
 *
 *   FASE B — la RESTAURACIÓN, por la ventana, con el proceso MATADO a mitad.
 *     En una instalación nueva elige «Restaurar desde la nube», inicia sesión
 *     con la credencial de RESTAURACIÓN y, en cuanto el puesto de control
 *     muestra dos tablas terminadas y la transferencia sin completar, le manda
 *     SIGKILL al proceso principal. Vuelve a arrancar la aplicación sobre la
 *     misma carpeta: tiene que abrir directo en la pantalla de restauración,
 *     ofreciendo RETOMAR. Retoma, llega a la revisión, intenta terminar sin
 *     PIN (se lo niega nombrando a los usuarios), asigna los dos PIN, termina,
 *     entra con el PIN NUEVO (el viejo no entra) y compara la base B con la A
 *     id por id, más el `pdf_path` del recibo byte a byte.
 *
 * SOBRE LAS CREDENCIALES: salen de `.env.nube-pruebas` (ignorado por git) y son
 * las de los usuarios de Auth del proyecto DESCARTABLE, los mismos de
 * `verify:nube` y `verify:restauracion`. El seguro de `proyectos-de-prueba.cjs`
 * se comprueba antes de la primera petición. Las contraseñas se teclean en los
 * campos de la aplicación y no se imprimen.
 *
 * ANTES DE CORRER: las once tablas de negocio del proyecto de pruebas tienen
 * que estar VACÍAS (por SQL). Con filas viejas, `usuarios.nombre` UNIQUE
 * detendría la cola de la fase A por el 23505 del punto 19 de §6.2, que es
 * otro problema. El guion lo comprueba y sale con código 2 si no es así.
 *
 * Salida: cada paso con su hora, el puesto de control tal como quedó al matar
 * el proceso, los conteos de los dos lados, un informe JSON en una línea, y
 * código 0 si todo pasa, 1 si algo falla, 2 si falta algo para poder
 * verificar, 3 si el seguro se niega.
 */

const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');
const { terminarAplicacion } = require('./terminar-aplicacion.cjs');

const { exigirProyectoDePrueba, ProyectoNoAdmitido } = require('./proyectos-de-prueba.cjs');

const PROYECTO = join(__dirname, '..');
const MARCA_INFORME = 'INFORME_DE_RESTAURACION_EN_PANTALLA';

/** Los PIN de la terminal de origen, y los NUEVOS que se asignan al restaurar. Solo viven en bases temporales. */
const PIN_DE_JIMMY = '2468';
const PIN_DE_LA_CAJERA = '1357';
const PIN_NUEVO_DE_JIMMY = '9753';
const PIN_NUEVO_DE_LA_CAJERA = '8642';

const NOMBRE_DEL_ADMINISTRADOR = 'Jimmy Cano';
const NOMBRE_DE_LA_CAJERA = 'Cajera de verificación';

const ESPERA_LARGA = 25_000;
const ESPERA_CORTA = 10_000;
/** Cuánto se espera a la nube: subir la cola entera, o bajar y verificar la restauración. */
const ESPERA_DE_NUBE = 180_000;
/** Cuánto se espera a que el puesto de control muestre la transferencia a mitad, antes de matar. */
const ESPERA_PARA_MATAR = 60_000;
const SONDEO_MS = 15;
/** Cuántas tablas tienen que estar listas para considerar que la transferencia va «a mitad». */
const TABLAS_LISTAS_PARA_MATAR = 2;

const ANCHO = 1100;
const ALTO = 800;

/** Las doce tablas que la restauración trae, en el orden de §6.3. */
const TABLAS = [
  'usuarios',
  'categorias',
  'configuracion_negocio',
  'productos',
  'precios_especiales',
  'limites_descuento',
  'caja_sesiones',
  'caja_sesion_denominaciones',
  'ventas',
  'venta_detalle',
  'recibos',
  'auditoria_log',
];

/** Los asientos que la PROPIA restauración escribe (no vienen de la nube; viajan hacia ella). */
const ACCIONES_PROPIAS_DE_LA_RESTAURACION = [
  'restauracion_completada',
  'pin_asignado_en_restauracion',
  'usuario_revisado_en_restauracion',
  'fila_excluida_restaurada_a_mano',
];

const ARCHIVO_DEL_PUESTO_DE_CONTROL = 'restauracion.json';
const ARCHIVO_DE_LA_BASE = 'pos-agricola.db';

const comprobaciones = [];
function comprobar(nombre, esperado, real, paso) {
  comprobaciones.push({ nombre, esperado, real, paso });
  console.info(`  ${paso ? 'OK   ' : 'FALLA'} ${nombre}`);
  if (!paso) {
    console.info(`         esperado: ${String(esperado)}`);
    console.info(`         real    : ${String(real)}`);
  }
}

function anotar(mensaje) {
  console.info(`${new Date().toISOString()} ${mensaje}`);
}

function dormir(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

// ---------------------------------------------------------------------------
// Entorno, seguro y nube
// ---------------------------------------------------------------------------

function leerEntorno() {
  const ruta = join(PROYECTO, '.env.nube-pruebas');
  if (!existsSync(ruta)) {
    console.error(`Falta ${ruta}: sin las credenciales del proyecto de PRUEBAS no se puede verificar (ver .env.nube-pruebas.ejemplo).`);
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
  for (const clave of [
    'POS_NUBE_PROYECTO',
    'POS_NUBE_URL',
    'POS_NUBE_LLAVE_PUBLICABLE',
    'POS_NUBE_TERMINAL_CORREO',
    'POS_NUBE_TERMINAL_CLAVE',
    'POS_NUBE_RESTAURACION_CORREO',
    'POS_NUBE_RESTAURACION_CLAVE',
  ]) {
    if (!valores[clave]) {
      console.error(`Falta ${clave} en .env.nube-pruebas.`);
      process.exit(2);
    }
  }
  return valores;
}

/** Cuántas filas tiene cada tabla en la nube, leído con la credencial de RESTAURACIÓN. Cada petición queda anotada. */
async function contarEnLaNube(entorno) {
  const cabeceras = { apikey: entorno.POS_NUBE_LLAVE_PUBLICABLE, 'Content-Type': 'application/json' };
  const ingreso = await fetch(`${entorno.POS_NUBE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({ email: entorno.POS_NUBE_RESTAURACION_CORREO, password: entorno.POS_NUBE_RESTAURACION_CLAVE }),
  });
  anotar(`POST /auth/v1/token?grant_type=password (restauracion) -> HTTP ${String(ingreso.status)}`);
  if (!ingreso.ok) {
    throw new Error(`la nube rechazó la credencial de restauración: HTTP ${String(ingreso.status)}`);
  }
  const { access_token: token } = await ingreso.json();
  const conteos = {};
  for (const tabla of TABLAS) {
    const respuesta = await fetch(`${entorno.POS_NUBE_URL}/rest/v1/${tabla}?select=id&limit=1`, {
      headers: { ...cabeceras, Authorization: `Bearer ${token}`, Prefer: 'count=exact' },
    });
    await respuesta.text();
    const rango = respuesta.headers.get('content-range') ?? '';
    anotar(`GET /rest/v1/${tabla}?select=id&limit=1 -> HTTP ${String(respuesta.status)} content-range: ${rango}`);
    conteos[tabla] = Number(rango.split('/')[1]);
  }
  const salida = await fetch(`${entorno.POS_NUBE_URL}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: { apikey: entorno.POS_NUBE_LLAVE_PUBLICABLE, Authorization: `Bearer ${token}` },
  });
  anotar(`POST /auth/v1/logout?scope=local -> HTTP ${String(salida.status)}`);
  return conteos;
}

// ---------------------------------------------------------------------------
// La aplicación real
// ---------------------------------------------------------------------------

async function lanzarAplicacion(datos, entorno) {
  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
    env: {
      ...process.env,
      POS_NUBE_URL: entorno.POS_NUBE_URL,
      POS_NUBE_LLAVE_PUBLICABLE: entorno.POS_NUBE_LLAVE_PUBLICABLE,
      /*
        SIN ESTO EL TRABAJADOR CORRE CON EL SIMULADO, y se midió: la primera
        corrida de este guion pasaba `POS_NUBE_URL` y nada más; la pantalla
        «Conectar con la nube» conectó de verdad, la cola se marcó como subida
        en 3,5 s… y la nube seguía vacía. `log-tecnico.log` lo decía en su
        segunda línea: «trabajador en marcha con SimulatedSyncProvider». El
        proveedor real lo elige `POS_SYNC_PROVIDER=supabase` (la fábrica de
        `src/shared/adapters/index.ts`, que sin esa variable cae al simulado a
        propósito para que ninguna sesión de desarrollo gaste cuota). Por eso
        la fase A comprueba además, leyendo la bitácora técnica, con QUÉ
        proveedor arrancó el trabajador: una cola «vacía» no prueba nada sola.
      */
      POS_SYNC_PROVIDER: 'supabase',
    },
  });
  // El proceso se guarda AHORA, con la aplicación viva: después de que se
  // cierre, `app.process()` lanza (§6.2, punto 49; ver terminar-aplicacion.cjs).
  const procesoDeLaAplicacion = app.process();
  await app.evaluate(async ({ BrowserWindow }) => {
    const [ventana] = BrowserWindow.getAllWindows();
    if (ventana) {
      ventana.setFullScreen(false);
      ventana.setSize(1100, 800);
    }
  });
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const teclearPin = async (pin) => {
    for (const digito of pin) {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('tecla-confirmar').click();
  };
  const volverAlMenu = async () => {
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
  };
  return { app, procesoDeLaAplicacion, ventana, prueba, teclearPin, volverAlMenu };
}

/** Las líneas de sincronización y restauración de la bitácora técnica de una app, tal cual. */
function volcarBitacora(datos, etiqueta) {
  const ruta = join(datos, 'log-tecnico.log');
  const texto = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
  for (const linea of texto.split('\n').filter((l) => l.includes('[sincronizacion]') || l.includes('[restauracion]'))) {
    anotar(`${etiqueta}: log-tecnico: ${linea}`);
  }
  return texto;
}

/** El pid del proceso terminado. Ver terminar-aplicacion.cjs (§6.2, punto 49). */
function matar(procesoDeLaAplicacion) {
  return terminarAplicacion(procesoDeLaAplicacion).pid;
}

// ---------------------------------------------------------------------------
// Lecturas directas de las bases temporales (conexiones aparte, de solo lectura)
// ---------------------------------------------------------------------------

function abrirSoloLectura(datos) {
  return new DatabaseConstructor(join(datos, ARCHIVO_DE_LA_BASE), { readonly: true });
}

function idsDe(conexion, tabla) {
  return conexion.prepare(`SELECT id FROM ${tabla} ORDER BY id`).all().map((f) => f.id);
}

/** Espera a que la cola de A se vacíe. Un lote bloqueante hace fallar de inmediato, con su error. */
async function esperarColaVacia(datos) {
  const inicio = Date.now();
  for (;;) {
    const conexion = abrirSoloLectura(datos);
    let pendientes;
    let bloqueante;
    try {
      pendientes = conexion.prepare('SELECT count(*) AS n FROM sync_cola WHERE sincronizado_en IS NULL').get().n;
      bloqueante = conexion.prepare('SELECT error FROM sync_cola WHERE bloqueante = 1 LIMIT 1').get();
    } finally {
      conexion.close();
    }
    if (bloqueante) {
      throw new Error(`la cola de la terminal de origen se detuvo: ${String(bloqueante.error)}`);
    }
    if (pendientes === 0) {
      return Date.now() - inicio;
    }
    if (Date.now() - inicio > ESPERA_DE_NUBE) {
      throw new Error(`la cola de la terminal de origen no se vació en ${String(ESPERA_DE_NUBE)} ms: quedan ${String(pendientes)} filas`);
    }
    await dormir(500);
  }
}

/** Espera a que el puesto de control muestre la transferencia A MITAD, y devuelve la instantánea. */
async function esperarTransferenciaAMitad(datos) {
  const archivo = join(datos, ARCHIVO_DEL_PUESTO_DE_CONTROL);
  const inicio = Date.now();
  while (Date.now() - inicio < ESPERA_PARA_MATAR) {
    if (existsSync(archivo)) {
      let puesto = null;
      try {
        puesto = JSON.parse(readFileSync(archivo, 'utf8'));
      } catch {
        // Se escribe a un temporal y se renombra, así que esto no debería
        // pasar; si pasa, se vuelve a leer en el próximo sondeo.
      }
      if (puesto !== null) {
        const listas = Object.values(puesto.tablas).filter((t) => t.lista).length;
        if (puesto.transferenciaCompleta || listas >= TABLAS_LISTAS_PARA_MATAR) {
          return puesto;
        }
      }
    }
    await dormir(SONDEO_MS);
  }
  return null;
}

// ---------------------------------------------------------------------------
// FASE A — la terminal de origen
// ---------------------------------------------------------------------------

async function faseA(datosA, entorno) {
  anotar('=== FASE A: la terminal de ORIGEN, por la ventana ===');
  const { app, procesoDeLaAplicacion, ventana, prueba, teclearPin, volverAlMenu } = await lanzarAplicacion(datosA, entorno);
  try {
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill(NOMBRE_DEL_ADMINISTRADOR);
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN_DE_JIMMY);
    await teclearPin(PIN_DE_JIMMY);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    anotar('A: primer administrador creado');

    // Conectar la terminal con la nube, con la credencial de TERMINAL.
    await prueba('ir-a-nube').click();
    await prueba('pantalla-de-nube').waitFor({ timeout: ESPERA_CORTA });
    await prueba('nube-correo-entrada').fill(entorno.POS_NUBE_TERMINAL_CORREO);
    await prueba('nube-contrasena-entrada').fill(entorno.POS_NUBE_TERMINAL_CLAVE);
    await prueba('nube-conectar').click();
    await prueba('nube-conectada-aviso').waitFor({ timeout: ESPERA_DE_NUBE });
    const avisoDeConexion = ((await prueba('nube-conectada-aviso').textContent()) ?? '').trim();
    anotar(`A: ${avisoDeConexion}`);
    comprobar(
      'A: la terminal de origen se conecta con la nube, con rol terminal',
      'el aviso nombra el rol terminal',
      avisoDeConexion,
      /rol terminal/.test(avisoDeConexion),
    );
    const contrasenaEnPantalla = await prueba('nube-contrasena-entrada').inputValue();
    comprobar('A: la contraseña de la terminal no queda en pantalla tras conectar', '""', JSON.stringify(contrasenaEnPantalla), contrasenaEnPantalla === '');
    await volverAlMenu();

    await prueba('ir-a-categorias').click();
    await prueba('categoria-nombre').fill('Granos');
    await prueba('categoria-guardar').click();
    await ventana.locator('[data-prueba="lista-de-categorias"] li').first().waitFor({ timeout: ESPERA_CORTA });
    await volverAlMenu();

    await prueba('ir-a-productos').click();
    await prueba('productos-nuevo').click();
    await prueba('formulario-de-producto').waitFor({ timeout: ESPERA_CORTA });
    await prueba('producto-nombre').fill('Maíz blanco');
    await prueba('producto-precio').fill('4.25');
    await prueba('producto-inventario-inicial').fill('100');
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await volverAlMenu();

    await prueba('ir-a-usuarios').click();
    await prueba('lista-de-usuarios').waitFor({ timeout: ESPERA_CORTA });
    await prueba('usuario-nombre').fill(NOMBRE_DE_LA_CAJERA);
    await prueba('usuario-rol').selectOption('venta');
    await prueba('usuario-pin').fill(PIN_DE_LA_CAJERA);
    await prueba('usuario-guardar').click();
    await prueba('usuarios-aviso').waitFor({ timeout: ESPERA_CORTA });
    await volverAlMenu();

    await prueba('ir-a-caja').click();
    await prueba('pantalla-de-caja').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    await prueba('campo-monto').fill('500');
    await prueba('confirmar-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    await volverAlMenu();

    await prueba('ir-a-venta').click();
    await prueba('cuadricula-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await prueba('icono-producto').first().click();
    await prueba('icono-producto').first().click();
    await prueba('cobrar').click();
    await prueba('dialogo-de-cobro').waitFor({ timeout: ESPERA_CORTA });
    await prueba('cobro-continuar').click();
    await prueba('cobro-confirmar').click();
    await prueba('cobro-listo').waitFor({ timeout: ESPERA_LARGA });
    const estadoDelRecibo = ((await prueba('cobro-estado-del-recibo').textContent()) ?? '').trim();
    anotar(`A: venta cobrada; ${estadoDelRecibo}`);
    await prueba('cobro-siguiente-venta').click();
    await prueba('ticket-vacio').waitFor({ timeout: ESPERA_CORTA });
    await volverAlMenu();

    anotar('A: esperando a que el trabajador suba la cola entera…');
    const tardo = await esperarColaVacia(datosA);
    anotar(`A: cola vacía a los ${String(tardo)} ms`);

    // La bitácora técnica de la app de origen: con qué proveedor arrancó el
    // trabajador y qué dijo cada ciclo. Es la evidencia de que la cola subió
    // a la NUBE y no al simulado.
    const bitacoraDeA = volcarBitacora(datosA, 'A');
    comprobar(
      'A: el trabajador de la app de origen arrancó con SupabaseSyncProvider, no con el simulado',
      'la bitácora técnica dice «trabajador en marcha con SupabaseSyncProvider»',
      /trabajador en marcha con (\w+)/.exec(bitacoraDeA)?.[1] ?? '(no se encontró la línea del trabajador)',
      /trabajador en marcha con SupabaseSyncProvider/.test(bitacoraDeA),
    );

    // Lo que la base A tiene, para comparar después con la B.
    const conexion = abrirSoloLectura(datosA);
    let origen;
    try {
      const ids = Object.fromEntries(TABLAS.map((tabla) => [tabla, idsDe(conexion, tabla)]));
      const recibos = conexion.prepare('SELECT id, numero_recibo, pdf_path FROM recibos ORDER BY id').all();
      const lotesSubidos = conexion.prepare('SELECT count(DISTINCT lote_id) AS n FROM sync_cola WHERE sincronizado_en IS NOT NULL').get().n;
      origen = { ids, recibos, lotesSubidos };
    } finally {
      conexion.close();
    }
    anotar(`A: ${String(origen.lotesSubidos)} lotes subidos; filas por tabla: ${TABLAS.map((t) => `${t}=${String(origen.ids[t].length)}`).join(' ')}`);
    comprobar(
      'A: el recibo emitido por la aplicación REAL guarda pdf_path RELATIVA (recibos/<nombre>.pdf), que es lo que viajó a la nube',
      'empieza por recibos/',
      origen.recibos.map((r) => r.pdf_path).join(' | '),
      origen.recibos.length === 1 && /^recibos\/recibo-000001-.*\.pdf$/.test(origen.recibos[0].pdf_path),
    );
    return origen;
  } finally {
    const pid = matar(procesoDeLaAplicacion);
    anotar(`A: proceso ${String(pid)} terminado con SIGKILL`);
  }
}

// ---------------------------------------------------------------------------
// FASE B — la restauración, con el proceso matado a mitad
// ---------------------------------------------------------------------------

async function iniciarOretomar(prueba, entorno, retomar) {
  await prueba('restauracion-correo').fill(entorno.POS_NUBE_RESTAURACION_CORREO);
  await prueba('restauracion-contrasena').fill(entorno.POS_NUBE_RESTAURACION_CLAVE);
  const boton = prueba('restauracion-iniciar');
  const texto = ((await boton.textContent()) ?? '').trim();
  comprobar(
    retomar ? 'B: tras el arranque limpio el botón ofrece RETOMAR, no iniciar de cero' : 'B: en una instalación vacía el botón ofrece INICIAR',
    retomar ? 'Retomar la restauración' : 'Iniciar la restauración',
    texto,
    retomar ? /Retomar/.test(texto) : /Iniciar/.test(texto),
  );
  await boton.click();
}

async function faseB(datosB, entorno, origen) {
  anotar('=== FASE B: la RESTAURACIÓN, por la ventana, con el proceso matado a mitad ===');

  // --- B.1: iniciar, y matar el proceso a mitad de la transferencia ---------
  let primera = await lanzarAplicacion(datosB, entorno);
  let instantanea;
  try {
    const { prueba } = primera;
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('ir-a-restauracion').click();
    await prueba('pantalla-de-restauracion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('restauracion-iniciar').waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'B: con proyecto configurado la pantalla NO dice «sin configurar» y SÍ ofrece iniciar',
      '0 avisos de sin configurar, 1 botón de iniciar',
      `${String(await prueba('restauracion-sin-configurar').count())} avisos, ${String(await prueba('restauracion-iniciar').count())} botones`,
      (await prueba('restauracion-sin-configurar').count()) === 0 && (await prueba('restauracion-iniciar').count()) === 1,
    );
    await iniciarOretomar(prueba, entorno, false);
    await prueba('restauracion-progreso').waitFor({ timeout: ESPERA_DE_NUBE });
    anotar('B: la restauración arrancó; sondeando el puesto de control para matar el proceso a mitad…');
    instantanea = await esperarTransferenciaAMitad(datosB);
  } finally {
    const pid = matar(primera.procesoDeLaAplicacion);
    anotar(`B: SIGKILL al proceso principal ${String(pid)} de Electron`);
  }

  const listasAlMatar = instantanea === null ? [] : Object.entries(instantanea.tablas).filter(([, t]) => t.lista).map(([tabla]) => tabla);
  const bajandoAlMatar = instantanea === null ? [] : Object.entries(instantanea.tablas).filter(([, t]) => !t.lista).map(([tabla]) => tabla);
  anotar(
    `B: puesto de control al matar: ${instantanea === null ? 'NO EXISTÍA' : `transferenciaCompleta=${String(instantanea.transferenciaCompleta)}; listas=[${listasAlMatar.join(', ')}]; a medias=[${bajandoAlMatar.join(', ')}]`}`,
  );
  comprobar(
    'B: el proceso se mató A MITAD de la transferencia de tablas (ni antes de la primera ni después de la última)',
    `entre ${String(TABLAS_LISTAS_PARA_MATAR)} y ${String(TABLAS.length - 1)} tablas listas, transferencia sin completar`,
    instantanea === null ? 'sin puesto de control' : `${String(listasAlMatar.length)} listas, transferenciaCompleta=${String(instantanea.transferenciaCompleta)}`,
    instantanea !== null && !instantanea.transferenciaCompleta && listasAlMatar.length >= TABLAS_LISTAS_PARA_MATAR && listasAlMatar.length < TABLAS.length,
  );
  comprobar(
    'B: después del SIGKILL, restauracion.json sigue en el disco',
    'existe',
    existsSync(join(datosB, ARCHIVO_DEL_PUESTO_DE_CONTROL)) ? 'existe' : 'no existe',
    existsSync(join(datosB, ARCHIVO_DEL_PUESTO_DE_CONTROL)),
  );
  const conexionParcial = abrirSoloLectura(datosB);
  let parciales;
  try {
    parciales = Object.fromEntries(TABLAS.map((tabla) => [tabla, idsDe(conexionParcial, tabla).length]));
  } finally {
    conexionParcial.close();
  }
  anotar(`B: filas en la base B tras el SIGKILL: ${TABLAS.map((t) => `${t}=${String(parciales[t])}`).join(' ')}`);
  comprobar(
    'B: la base quedó consistente con el puesto de control: cada tabla LISTA tiene todas sus filas, cada tabla no empezada ninguna',
    'listas completas, no empezadas en cero',
    TABLAS.map((t) => `${t}=${String(parciales[t])}/${String(origen.ids[t].length)}`).join(' '),
    listasAlMatar.every((t) => t === 'configuracion_negocio' || parciales[t] === origen.ids[t].length) &&
      TABLAS.filter((t) => instantanea !== null && instantanea.tablas[t] === undefined).every((t) => t === 'configuracion_negocio' || parciales[t] === 0),
  );

  // --- B.2: arranque limpio, retomar, revisión y PIN -----------------------
  anotar('B: arranque NUEVO de la aplicación sobre la misma carpeta de datos');
  const segunda = await lanzarAplicacion(datosB, entorno);
  const { ventana, prueba, teclearPin } = segunda;
  try {
    await prueba('pantalla-de-restauracion').waitFor({ timeout: ESPERA_LARGA });
    await prueba('restauracion-incompleta').waitFor({ timeout: ESPERA_CORTA });
    const avisoIncompleta = ((await prueba('restauracion-incompleta').textContent()) ?? '').trim();
    anotar(`B: ${avisoIncompleta}`);
    comprobar(
      'B: el arranque limpio abre DIRECTO en la restauración incompleta: ni configuración inicial ni ingreso',
      'restauración incompleta a la vista; 0 pantallas de configuración inicial; 0 de ingreso',
      `${String(await prueba('pantalla-de-configuracion-inicial').count())} de configuración inicial, ${String(await prueba('pantalla-de-ingreso').count())} de ingreso`,
      (await prueba('pantalla-de-configuracion-inicial').count()) === 0 && (await prueba('pantalla-de-ingreso').count()) === 0,
    );
    comprobar(
      'B: el aviso dice quién la empezó (el correo del puesto de control)',
      `menciona ${entorno.POS_NUBE_RESTAURACION_CORREO}`,
      avisoIncompleta,
      avisoIncompleta.includes(entorno.POS_NUBE_RESTAURACION_CORREO),
    );

    await iniciarOretomar(prueba, entorno, true);
    /*
      La transferencia puede DETENERSE por un fallo transitorio de la nube —en
      la segunda corrida de este guion el proyecto de pruebas contestó dos
      `504 Gateway Timeout` durante la subida— y entonces la pantalla vuelve
      al formulario con el motivo («La restauración se detuvo: …»). Eso no es
      un defecto del arnés ni de la aplicación: es retomable, y una persona
      volvería a pulsar «Retomar». Acá se hace lo mismo, hasta tres veces,
      anotando cada motivo; lo que se comprueba es que se llegue a la revisión.
    */
    const INTENTOS_DE_RETOMA = 3;
    const motivosDeDetencion = [];
    for (let intento = 1; ; intento += 1) {
      await ventana
        .locator('[data-prueba="restauracion-verificacion"], [data-prueba="restauracion-detenida"], [data-prueba="restauracion-error"]')
        .first()
        .waitFor({ timeout: ESPERA_DE_NUBE });
      if ((await prueba('restauracion-verificacion').count()) === 1) {
        break;
      }
      const detenida = ((await prueba('restauracion-detenida').textContent().catch(() => '')) ?? '').trim();
      const error = ((await prueba('restauracion-error').textContent().catch(() => '')) ?? '').trim();
      motivosDeDetencion.push(detenida || error);
      anotar(`B: la retoma ${String(intento)} se detuvo: ${detenida || error}`);
      volcarBitacora(datosB, 'B');
      if (intento >= INTENTOS_DE_RETOMA) {
        throw new Error(`la restauración no llegó a la revisión en ${String(INTENTOS_DE_RETOMA)} retomas: ${motivosDeDetencion.join(' | ')}`);
      }
      await prueba('restauracion-correo').fill(entorno.POS_NUBE_RESTAURACION_CORREO);
      await prueba('restauracion-contrasena').fill(entorno.POS_NUBE_RESTAURACION_CLAVE);
      await prueba('restauracion-iniciar').click();
    }
    comprobar(
      'B: la retoma llega a la revisión (si la nube falló a mitad, volver a retomar sigue desde donde quedó)',
      'revisión a la vista',
      motivosDeDetencion.length === 0 ? 'a la primera' : `tras ${String(motivosDeDetencion.length)} detención(es): ${motivosDeDetencion.join(' | ')}`,
      true,
    );
    const contrasenaEnPantalla = await prueba('restauracion-contrasena').count();
    comprobar('B: al llegar a la revisión el campo de contraseña ya no está en pantalla', '0 campos', `${String(contrasenaEnPantalla)} campos`, contrasenaEnPantalla === 0);

    const tituloDeVerificacion = ((await ventana.locator('[data-prueba="restauracion-verificacion"] h2').first().textContent()) ?? '').trim();
    const textoDeVerificacion = ((await prueba('restauracion-verificacion').textContent()) ?? '').trim();
    anotar(`B: verificación: ${textoDeVerificacion.replace(/\s+/g, ' ')}`);
    comprobar(
      'B: la verificación CUADRA en pantalla: conteos nube = acá y ventas por mes al centavo, sin ninguna ✗',
      '«Verificación · cuadra», sin ✗',
      tituloDeVerificacion,
      /cuadra/.test(tituloDeVerificacion) && !/NO cuadra/.test(tituloDeVerificacion) && !textoDeVerificacion.includes('✗'),
    );

    const filasDeUsuario = await prueba('restauracion-usuario').allTextContents();
    anotar(`B: usuarios en la revisión: ${filasDeUsuario.map((t) => t.replace(/\s+/g, ' ').trim()).join(' || ')}`);
    comprobar(
      'B: los dos usuarios de la terminal de origen aparecen, y los dos SIN PIN',
      '2 usuarios, ambos «SIN PIN»',
      `${String(filasDeUsuario.length)} usuarios; sin PIN: ${String(filasDeUsuario.filter((t) => t.includes('SIN PIN')).length)}`,
      filasDeUsuario.length === 2 && filasDeUsuario.every((t) => t.includes('SIN PIN')),
    );

    // Terminar SIN PIN: se tiene que negar nombrando a los dos.
    await prueba('restauracion-terminar').click();
    await prueba('restauracion-error').waitFor({ timeout: ESPERA_CORTA });
    const negativa = ((await prueba('restauracion-error').textContent()) ?? '').trim();
    anotar(`B: al intentar terminar sin PIN: ${negativa}`);
    comprobar(
      'B: «Terminar» con usuarios sin PIN se NIEGA, y el aviso nombra a los dos usuarios',
      'menciona «falta asignar PIN», a Jimmy Cano y a la cajera',
      negativa,
      /falta asignar PIN/.test(negativa) && negativa.includes(NOMBRE_DEL_ADMINISTRADOR) && negativa.includes(NOMBRE_DE_LA_CAJERA),
    );
    comprobar(
      'B: y la restauración NO pasó a terminada: sigue en la revisión',
      '0 avisos de terminada, la lista de usuarios a la vista',
      `${String(await prueba('restauracion-terminada').count())} terminada, ${String(await prueba('restauracion-usuarios').count())} revisión`,
      (await prueba('restauracion-terminada').count()) === 0 && (await prueba('restauracion-usuarios').count()) === 1,
    );

    // PIN nuevo para cada usuario, por la ventana.
    const asignarPinA = async (nombre, pin) => {
      const fila = prueba('restauracion-usuario').filter({ hasText: nombre });
      await fila.locator('[data-prueba="restauracion-asignar-pin"]').click();
      await prueba('restauracion-pin').waitFor({ timeout: ESPERA_CORTA });
      await teclearPin(pin);
      await fila.filter({ hasText: 'PIN asignado' }).waitFor({ timeout: ESPERA_CORTA });
    };
    await asignarPinA(NOMBRE_DEL_ADMINISTRADOR, PIN_NUEVO_DE_JIMMY);
    await prueba('restauracion-terminar').click();
    await prueba('restauracion-error').waitFor({ timeout: ESPERA_CORTA });
    const negativaConUno = ((await prueba('restauracion-error').textContent()) ?? '').trim();
    comprobar(
      'B: con UN PIN asignado, terminar sigue negándose y ya solo nombra a quien falta',
      `menciona a la cajera y no a ${NOMBRE_DEL_ADMINISTRADOR}`,
      negativaConUno,
      /falta asignar PIN a 1 usuario/.test(negativaConUno) && negativaConUno.includes(NOMBRE_DE_LA_CAJERA) && !negativaConUno.includes(NOMBRE_DEL_ADMINISTRADOR),
    );
    await asignarPinA(NOMBRE_DE_LA_CAJERA, PIN_NUEVO_DE_LA_CAJERA);
    const filasConPin = await prueba('restauracion-usuario').allTextContents();
    comprobar(
      'B: los dos usuarios muestran «PIN asignado»',
      '2 de 2',
      `${String(filasConPin.filter((t) => t.includes('PIN asignado')).length)} de ${String(filasConPin.length)}`,
      filasConPin.length === 2 && filasConPin.every((t) => t.includes('PIN asignado')),
    );

    await prueba('restauracion-terminar').click();
    await prueba('restauracion-terminada').waitFor({ timeout: ESPERA_DE_NUBE });
    const resumenFinal = ((await prueba('restauracion-terminada').textContent()) ?? '').trim();
    anotar(`B: ${resumenFinal}`);
    comprobar('B: con los dos PIN asignados, «Terminar» llega al resumen final', 'Restauración terminada', resumenFinal, /Restauración terminada/.test(resumenFinal));
    comprobar(
      'B: al terminar, restauracion.json desaparece del disco',
      'no existe',
      existsSync(join(datosB, ARCHIVO_DEL_PUESTO_DE_CONTROL)) ? 'existe (mal)' : 'no existe',
      !existsSync(join(datosB, ARCHIVO_DEL_PUESTO_DE_CONTROL)),
    );

    /*
      La comparación contra el origen se hace AHORA, antes del ingreso: iniciar
      sesión escribe sus propios asientos (`ingreso_fallido` con el PIN viejo,
      `ingreso_correcto` con el nuevo) y los encola, y eso es correcto —una
      terminal restaurada sigue auditando (§4.26)—, pero no vino de la nube.
      La primera versión de este guion comparaba después del ingreso y contaba
      esos dos asientos como «de más».
    */
    compararConElOrigen(datosB, origen);

    // --- B.3: al ingreso, con el PIN nuevo (el viejo no entra) --------------
    await prueba('restauracion-ir-al-ingreso').click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    const ofrecidos = await prueba('usuario-para-ingreso').allTextContents();
    comprobar(
      'B: la pantalla de ingreso ofrece a los dos usuarios restaurados, ninguno marcado «Sin PIN asignado»',
      '2 usuarios, 0 sin PIN',
      `${String(ofrecidos.length)} usuarios, ${String(await prueba('usuario-sin-pin').count())} sin PIN`,
      ofrecidos.length === 2 && (await prueba('usuario-sin-pin').count()) === 0,
    );
    await prueba('usuario-para-ingreso').filter({ hasText: NOMBRE_DEL_ADMINISTRADOR }).click();
    await prueba('pantalla-de-pin').waitFor({ timeout: ESPERA_CORTA });
    await teclearPin(PIN_DE_JIMMY);
    await prueba('mensaje-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    const rechazoDelPinViejo = ((await prueba('mensaje-de-ingreso').textContent()) ?? '').trim();
    comprobar(
      'B: el PIN VIEJO de la terminal de origen NO entra (el hash nunca viajó a la nube)',
      'un rechazo, sin sesión',
      `${rechazoDelPinViejo} · pantallas de sesión: ${String(await prueba('pantalla-de-sesion').count())}`,
      rechazoDelPinViejo !== '' && (await prueba('pantalla-de-sesion').count()) === 0,
    );
    await teclearPin(PIN_NUEVO_DE_JIMMY);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    comprobar('B: el PIN NUEVO asignado en la restauración SÍ entra', 'pantalla de sesión', 'pantalla de sesión', true);
  } finally {
    const pid = matar(segunda.procesoDeLaAplicacion);
    anotar(`B: proceso ${String(pid)} terminado con SIGKILL`);
    volcarBitacora(datosB, 'B');
  }

  // --- B.4: lo que se lee DESPUÉS del ingreso: los asientos y la cola ---------
  const conexion = abrirSoloLectura(datosB);
  try {
    const ingresos = conexion
      .prepare("SELECT accion, count(*) AS n FROM auditoria_log WHERE accion IN ('ingreso_fallido', 'ingreso_correcto') GROUP BY accion ORDER BY accion")
      .all();
    comprobar(
      'B: la terminal restaurada sigue auditando: el PIN viejo dejó un ingreso_fallido y el nuevo un ingreso_correcto',
      'ingreso_correcto=1, ingreso_fallido=1',
      ingresos.map((f) => `${f.accion}=${String(f.n)}`).join(', '),
      ingresos.length === 2 && ingresos.every((f) => f.n === 1),
    );
    const propios = conexion
      .prepare(`SELECT accion, count(*) AS n FROM auditoria_log WHERE accion IN (${ACCIONES_PROPIAS_DE_LA_RESTAURACION.map(() => '?').join(', ')}) GROUP BY accion ORDER BY accion`)
      .all(...ACCIONES_PROPIAS_DE_LA_RESTAURACION);
    anotar(`B: asientos propios de la restauración: ${propios.map((p) => `${p.accion}=${String(p.n)}`).join(', ')}`);
    comprobar(
      'B: quedaron los asientos de la restauración: dos PIN asignados y una restauración completada',
      'pin_asignado_en_restauracion=2, restauracion_completada=1',
      propios.map((p) => `${p.accion}=${String(p.n)}`).join(', '),
      propios.some((p) => p.accion === 'pin_asignado_en_restauracion' && p.n === 2) && propios.some((p) => p.accion === 'restauracion_completada' && p.n === 1),
    );
    const enLaCola = conexion.prepare('SELECT entidad_tipo, count(*) AS n FROM sync_cola GROUP BY entidad_tipo ORDER BY entidad_tipo').all();
    anotar(`B: sync_cola de la restaurada: ${enLaCola.map((f) => `${f.entidad_tipo}=${String(f.n)}`).join(', ')}`);
    comprobar(
      'B: lo DECIDIDO se encoló (los dos usuarios con PIN nuevo, los tres asientos de la restauración y los dos del ingreso) y lo RESTAURADO no (ninguna venta, recibo ni producto en la cola)',
      'usuarios=2, auditoria_log=5, y nada más',
      enLaCola.map((f) => `${f.entidad_tipo}=${String(f.n)}`).join(', '),
      enLaCola.length === 2 &&
        enLaCola.some((f) => f.entidad_tipo === 'usuarios' && f.n === 2) &&
        enLaCola.some((f) => f.entidad_tipo === 'auditoria_log' && f.n === 5),
    );
  } finally {
    conexion.close();
  }
}

/** La base B contra la A, id por id, con la app de B todavía abierta (WAL admite la conexión de solo lectura). */
function compararConElOrigen(datosB, origen) {
  const conexion = abrirSoloLectura(datosB);
  try {
    for (const tabla of TABLAS) {
      let locales = idsDe(conexion, tabla);
      if (tabla === 'auditoria_log') {
        const marcadores = ACCIONES_PROPIAS_DE_LA_RESTAURACION.map(() => '?').join(', ');
        locales = conexion
          .prepare(`SELECT id FROM auditoria_log WHERE accion NOT IN (${marcadores}) ORDER BY id`)
          .all(...ACCIONES_PROPIAS_DE_LA_RESTAURACION)
          .map((f) => f.id);
      }
      const iguales = JSON.stringify(locales) === JSON.stringify(origen.ids[tabla]);
      comprobar(
        `B: ${tabla}: los ids de la base restaurada son EXACTAMENTE los de la terminal de origen (ni duplicados ni perdidos tras el SIGKILL)`,
        `${String(origen.ids[tabla].length)} ids iguales`,
        iguales ? `${String(locales.length)} ids iguales` : `origen ${String(origen.ids[tabla].length)}, restaurada ${String(locales.length)}`,
        iguales,
      );
    }
    const recibos = conexion.prepare('SELECT id, numero_recibo, pdf_path, impreso FROM recibos ORDER BY id').all();
    const pdfIgual = recibos.length === 1 && origen.recibos.length === 1 && recibos[0].pdf_path === origen.recibos[0].pdf_path;
    comprobar(
      'B: recibos.pdf_path llega IDÉNTICA byte a byte a la del origen, relativa, sin re-enraizar nada',
      origen.recibos.map((r) => r.pdf_path).join(' | '),
      recibos.map((r) => r.pdf_path).join(' | '),
      pdfIgual,
    );
    const configuracion = conexion.prepare("SELECT actualizado_en FROM configuracion_negocio WHERE id = 'unica'").get();
    comprobar(
      'B: configuracion_negocio.actualizado_en llegó con los microsegundos con que la sembró SQL en la nube (la fila que ninguna terminal guardó), y el CHECK local la admitió',
      'más de tres decimales de segundo, con Z',
      String(configuracion?.actualizado_en),
      /\.\d{4,}Z$/.test(String(configuracion?.actualizado_en)),
    );
    const usuarios = conexion.prepare('SELECT nombre, pin_hash, activo FROM usuarios ORDER BY nombre').all();
    comprobar(
      'B: en la base, los dos usuarios tienen un hash scrypt real y ninguno el centinela sin-pin',
      '2 hashes scrypt',
      usuarios.map((u) => `${u.nombre}: ${u.pin_hash.slice(0, 7)}…`).join(' | '),
      usuarios.length === 2 && usuarios.every((u) => u.pin_hash.startsWith('scrypt$')),
    );
  } finally {
    conexion.close();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const entorno = leerEntorno();
  try {
    exigirProyectoDePrueba(entorno.POS_NUBE_PROYECTO, entorno.POS_NUBE_URL);
  } catch (error) {
    if (error instanceof ProyectoNoAdmitido) {
      console.error(`[seguro] ${error.message}`);
      process.exit(3);
    }
    throw error;
  }
  anotar(`Proyecto de pruebas ${entorno.POS_NUBE_PROYECTO} (seguro conforme)`);

  const antes = await contarEnLaNube(entorno);
  const conFilas = TABLAS.filter((t) => t !== 'configuracion_negocio' && antes[t] > 0);
  if (conFilas.length > 0) {
    console.error(`La nube NO está vacía (${conFilas.map((t) => `${t}=${String(antes[t])}`).join(', ')}). Vaciá las once tablas por SQL y volvé a correr.`);
    process.exit(2);
  }
  anotar('la nube está vacía: se puede sembrar');

  const datosA = mkdtempSync(join(tmpdir(), 'pos-restauracion-pantalla-origen-'));
  const datosB = mkdtempSync(join(tmpdir(), 'pos-restauracion-pantalla-destino-'));
  try {
    const origen = await faseA(datosA, entorno);
    const enLaNube = await contarEnLaNube(entorno);
    comprobar(
      'la nube tiene, tabla por tabla, exactamente las filas que la terminal de origen subió',
      TABLAS.map((t) => `${t}=${String(origen.ids[t].length)}`).join(' '),
      TABLAS.map((t) => `${t}=${String(enLaNube[t])}`).join(' '),
      TABLAS.every((t) => enLaNube[t] === origen.ids[t].length),
    );
    await faseB(datosB, entorno, origen);
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
  } finally {
    rmSync(datosA, { recursive: true, force: true });
    rmSync(datosB, { recursive: true, force: true });
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(
    `${MARCA_INFORME}${JSON.stringify({
      plataforma: process.platform,
      total: comprobaciones.length,
      fallidas: fallidas.length,
      comprobaciones,
      verificadoEn: new Date().toISOString(),
    })}`,
  );
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verificacion-de-restauracion-en-pantalla] Falló antes de poder comprobar nada: ${error.message}`);
  process.exit(1);
});
