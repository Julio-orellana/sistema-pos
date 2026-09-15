#!/usr/bin/env node
/**
 * ENSAYO DE RESTAURACIÓN por la ventana, contra el proyecto de nube que diga
 * el archivo de entorno, sobre una carpeta de datos NUEVA y DESCARTABLE.
 *
 * Es la forma de contestar la pregunta que un respaldo tiene que poder
 * contestar antes del día en que haga falta: ¿lo que hay en la nube se puede
 * restaurar? Y contestarla sin tocar la terminal de la tienda ni escribir
 * nada en la nube:
 *
 *   · Abre la aplicación REAL —el mismo `electron .` de siempre— con
 *     `--user-data-dir` en una carpeta temporal recién creada, y la lleva a
 *     la pantalla «Restaurar desde la nube».
 *   · LA CONTRASEÑA LA TECLEA UNA PERSONA EN LA VENTANA. Este guion no la
 *     conoce, no la pide y no la lee: espera a que la restauración arranque.
 *     Contra un proyecto de PRUEBAS (los que admite `proyectos-de-prueba.cjs`)
 *     puede llenar el formulario solo, con `POS_NUBE_RESTAURACION_CORREO` y
 *     `POS_NUBE_RESTAURACION_CLAVE` del archivo de entorno; contra cualquier
 *     otro proyecto esas dos variables se IGNORAN aunque estén: la credencial
 *     del dueño no pasa por un guion.
 *   · Sigue la transferencia tabla por tabla, anota la verificación, intenta
 *     «Terminar» —que se tiene que NEGAR, porque ningún usuario restaurado
 *     tiene PIN y este guion no asigna ninguno—, deja la restauración «para
 *     después» (eso revoca la sesión de la nube) y lee la base restaurada con
 *     una conexión aparte, de solo lectura.
 *   · Vuelca la bitácora técnica de la corrida: cada petición HTTP de la
 *     restauración con su método, su ruta y su código (nunca el token).
 *
 * QUÉ ESCRIBE EN LA NUBE: NADA. La restauración es solo lectura (SELECT por
 * PostgREST, dos funciones de solo lectura y Storage; CLAUDE.md §4.35). Lo
 * único que la nube registra es la sesión de Auth que la persona abre con su
 * contraseña, y que se revoca al dejar la restauración (`logout?scope=local`).
 * La terminal nunca se conecta con su propia credencial en este ensayo, así
 * que la cola local no sube nada. Por eso este guion NO pasa por el seguro de
 * `proyectos-de-prueba.cjs` para negarse: lo consulta solo para decidir si
 * puede llenar el formulario por su cuenta.
 *
 * Uso:
 *   npm run ensayo:restauracion -- --entorno=.env.nube-real
 *   (sin `--entorno`, usa `.env.nube-pruebas`)
 *   --carpeta=<ruta>   RETOMA sobre una carpeta de ensayo que ya existe, en vez
 *                      de crear una nueva. Es para una corrida que se
 *                      interrumpió DESPUÉS de que la restauración arrancara:
 *                      esa carpeta tiene `restauracion.json` con el progreso, y
 *                      la pantalla ofrece «Retomar». Si la carpeta NO tiene
 *                      puesto de control y su base ya tiene filas, el guion se
 *                      niega a arrancar y dice por qué: la restauración exige
 *                      una base vacía, así que esa ventana no podría restaurar.
 *
 * CÓMO TERMINAR UN ENSAYO A MANO: la aplicación NO se puede cerrar desde
 * adentro en una instalación vacía. La salida controlada pide el PIN de un
 * administrador (§4.1) y en una terminal recién restaurada todavía no hay
 * ninguno, así que el botón de la barra de estado contesta «No hay ningún
 * administrador configurado» y deja un asiento `salida_controlada_rechazada`.
 * Para cortar el ensayo, Ctrl+C en esta terminal: el guion mata el proceso de
 * Electron y vuelca igual la evidencia.
 *
 * Códigos de salida: 0 la restauración llegó a la revisión con la
 * verificación cuadrando y todo lo demás en su sitio; 1 llegó pero algo no
 * cuadró, o no llegó; 2 faltó algo para poder ensayar (entorno, build, o nadie
 * inició la restauración en la ventana dentro del plazo).
 *
 * LA CARPETA DE DATOS DEL ENSAYO NO SE BORRA: es la evidencia, y se imprime
 * su ruta al principio y al final.
 */
'use strict';

const { existsSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

const { exigirProyectoDePrueba, ProyectoNoAdmitido } = require('./proyectos-de-prueba.cjs');

const PROYECTO = join(__dirname, '..');
const MARCA_INFORME = 'INFORME_DE_ENSAYO_DE_RESTAURACION';
const ARCHIVO_DEL_PUESTO_DE_CONTROL = 'restauracion.json';
const ARCHIVO_DE_LA_BASE = 'pos-agricola.db';
/** El centinela de «este usuario no tiene PIN» (src/shared/auth.ts, HASH_SIN_PIN). */
const HASH_SIN_PIN = 'sin-pin';
const DENOMINACIONES_DEL_QUETZAL = 11;

const ESPERA_CORTA = 10_000;
const ESPERA_LARGA = 25_000;
/** Cuánto se espera a que una PERSONA teclee la contraseña y pulse «Iniciar» o «Retomar»: 30 min, o `POS_ENSAYO_ESPERA_MIN`. */
const ESPERA_A_LA_PERSONA = (Number(process.env.POS_ENSAYO_ESPERA_MIN) || 30) * 60_000;
/** Cuánto se espera a que la nube entregue todo: una tienda con años de ventas y una conexión de casa. */
const ESPERA_DE_NUBE = 60 * 60_000;
const LATIDO_MS = 60_000;
const SONDEO_MS = 1_000;
const RETOMAS_AUTOMATICAS = 3;

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

/** Las que la restauración exige VACÍAS para dejarse empezar: las doce menos la de fila fija (§6.2). */
const TABLAS_QUE_DEBEN_ESTAR_VACIAS = TABLAS.filter((tabla) => tabla !== 'configuracion_negocio');

/** Un instante ISO con `Z` y cualquier cantidad de decimales, que es lo que el CHECK local admite. */
const FORMA_DE_FECHA_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** La ventana se cerró antes de tiempo. No es un fallo del producto: es que no hay a quién preguntarle nada más. */
class VentanaCerrada extends Error {
  constructor() {
    super('la ventana de la aplicación se cerró antes de que el ensayo terminara');
    this.name = 'VentanaCerrada';
  }
}

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

function unaLinea(texto) {
  return (texto ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Entorno
// ---------------------------------------------------------------------------

function argumento(nombre, porOmision) {
  const prefijo = `--${nombre}=`;
  const encontrado = process.argv.slice(2).find((a) => a.startsWith(prefijo));
  return encontrado === undefined ? porOmision : encontrado.slice(prefijo.length);
}

function leerEntorno(rutaRelativa) {
  const ruta = join(PROYECTO, rutaRelativa);
  if (!existsSync(ruta)) {
    console.error(`Falta ${ruta}: hace falta un archivo de entorno con POS_NUBE_PROYECTO, POS_NUBE_URL y POS_NUBE_LLAVE_PUBLICABLE.`);
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
  for (const clave of ['POS_NUBE_PROYECTO', 'POS_NUBE_URL', 'POS_NUBE_LLAVE_PUBLICABLE']) {
    if (!valores[clave]) {
      console.error(`Falta ${clave} en ${rutaRelativa}.`);
      process.exit(2);
    }
  }
  let anfitrion;
  try {
    anfitrion = new URL(valores.POS_NUBE_URL).hostname;
  } catch {
    console.error(`POS_NUBE_URL no es una URL: ${valores.POS_NUBE_URL}`);
    process.exit(2);
  }
  if (anfitrion.split('.')[0] !== valores.POS_NUBE_PROYECTO) {
    console.error(`POS_NUBE_URL (${anfitrion}) no es la del proyecto ${valores.POS_NUBE_PROYECTO}.`);
    process.exit(2);
  }
  return valores;
}

/** Solo contra un proyecto de PRUEBAS el guion llena el formulario por su cuenta. */
function puedeLlenarElFormulario(entorno) {
  try {
    exigirProyectoDePrueba(entorno.POS_NUBE_PROYECTO, entorno.POS_NUBE_URL);
  } catch (error) {
    if (error instanceof ProyectoNoAdmitido) {
      return false;
    }
    throw error;
  }
  return Boolean(entorno.POS_NUBE_RESTAURACION_CORREO && entorno.POS_NUBE_RESTAURACION_CLAVE);
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
      // Sin esto el trabajador corre con el simulado y marcaría como «subida»
      // cualquier cosa que quedara en la cola (CLAUDE.md §4.35). Con el
      // proveedor real y SIN credencial de terminal, no sube nada: que es
      // exactamente lo que un ensayo tiene que hacer.
      POS_SYNC_PROVIDER: 'supabase',
    },
  });
  await app.evaluate(async ({ BrowserWindow }) => {
    const [ventana] = BrowserWindow.getAllWindows();
    if (ventana) {
      ventana.setFullScreen(false);
      ventana.setSize(1100, 800);
    }
  });
  // Si la persona cierra la ventana, todo lo que se le pregunte a Playwright
  // falla con un error interno ilegible («Cannot read properties of undefined»).
  // Se anota el cierre y se lo trata como lo que es: no hay a quién preguntar.
  let cerrada = false;
  app.on('close', () => {
    cerrada = true;
  });
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  return { app, ventana, prueba, estaCerrada: () => cerrada };
}

/** NO se usa app.close(): llama a app.quit(), que el kiosko intercepta para pedir el PIN. */
function matar(app) {
  try {
    const proceso = app.process();
    proceso.kill('SIGKILL');
    return proceso.pid;
  } catch {
    // Ya estaba muerto: la persona cerró la ventana.
    return null;
  }
}

/** Las líneas de sincronización y restauración de la bitácora técnica, tal cual. */
function volcarBitacora(datos) {
  const ruta = join(datos, 'log-tecnico.log');
  const texto = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
  const lineas = texto.split('\n').filter((l) => l.includes('[sincronizacion]') || l.includes('[restauracion]'));
  for (const linea of lineas) {
    console.info(`    log-tecnico: ${linea}`);
  }
  return lineas;
}

// ---------------------------------------------------------------------------
// Esperas con latido: una persona tarda lo que tarda, y la nube también
// ---------------------------------------------------------------------------

/**
 * Espera a que aparezca alguno de los elementos, sondeando cada segundo y
 * avisando cada minuto que sigue esperando. Devuelve el nombre del que
 * apareció, o `null` si venció el plazo. `alSondear` se llama en cada vuelta
 * con la ventana, para anotar lo que cambia mientras tanto.
 */
async function esperarAlguno(prueba, nombres, plazoMs, mensajeDeLatido, alSondear) {
  const inicio = Date.now();
  let ultimoLatido = inicio;
  for (;;) {
    if (verificarCierre()) {
      throw new VentanaCerrada();
    }
    try {
      for (const nombre of nombres) {
        if ((await prueba(nombre).count()) > 0) {
          return nombre;
        }
      }
      if (alSondear !== undefined) {
        await alSondear();
      }
    } catch (error) {
      // Con la ventana cerrada, Playwright falla con un error interno que no
      // dice nada. Lo que pasó es que no hay ventana.
      if (verificarCierre()) {
        throw new VentanaCerrada();
      }
      throw error;
    }
    const ahora = Date.now();
    if (ahora - inicio > plazoMs) {
      return null;
    }
    if (ahora - ultimoLatido >= LATIDO_MS) {
      ultimoLatido = ahora;
      anotar(`${mensajeDeLatido} (${String(Math.round((ahora - inicio) / LATIDO_MS))} min)`);
    }
    await dormir(SONDEO_MS);
  }
}

/** Si la ventana ya se cerró. Lo fija `ensayar` con lo que devuelve `lanzarAplicacion`. */
let verificarCierre = () => false;

/** Anota el avance tabla por tabla cada vez que cambia lo que la pantalla muestra. */
function observadorDeAvance(prueba) {
  let ultimo = '';
  return async () => {
    if ((await prueba('restauracion-progreso').count()) === 0) {
      return;
    }
    const titulo = unaLinea(await prueba('restauracion-progreso').locator('h2').first().textContent().catch(() => ''));
    const filas = await prueba('restauracion-tabla').evaluateAll((elementos) =>
      elementos.map((e) => `${e.getAttribute('data-tabla')}: ${(e.querySelector('.lista__detalle')?.textContent ?? '').trim()}`),
    );
    const resumen = `${titulo} | ${filas.join(' · ')}`;
    if (resumen !== ultimo) {
      ultimo = resumen;
      anotar(`avance: ${resumen}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Lecturas directas de la base restaurada (conexión aparte, de solo lectura)
// ---------------------------------------------------------------------------

function leerBaseRestaurada(datos) {
  const conexion = new DatabaseConstructor(join(datos, ARCHIVO_DE_LA_BASE), { readonly: true });
  try {
    const filas = Object.fromEntries(TABLAS.map((tabla) => [tabla, conexion.prepare(`SELECT count(*) AS n FROM ${tabla}`).get().n]));
    const denominaciones = conexion.prepare('SELECT count(*) AS n FROM denominaciones').get().n;
    const configuracion = conexion.prepare('SELECT id, nombre_comercial, direccion, telefono, nit, actualizado_en FROM configuracion_negocio').get();
    const usuarios = conexion
      .prepare('SELECT nombre, rol, activo, pin_hash = ? AS sin_pin, pin_remoto_hash IS NULL AS sin_pin_remoto, intentos_fallidos, bloqueado_hasta FROM usuarios ORDER BY nombre')
      .all(HASH_SIN_PIN);
    const cola = conexion
      .prepare('SELECT entidad_tipo, operacion, sincronizado_en IS NULL AS pendiente, count(*) AS n FROM sync_cola GROUP BY 1, 2, 3 ORDER BY 1, 2, 3')
      .all();
    const migraciones = conexion.prepare('SELECT count(*) AS n, max(nombre) AS ultima FROM migraciones_aplicadas').get();
    return { filas, denominaciones, configuracion, usuarios, cola, migraciones };
  } finally {
    conexion.close();
  }
}

// ---------------------------------------------------------------------------

async function ensayar(datos, entorno, automatico) {
  const { app, ventana, prueba, estaCerrada } = await lanzarAplicacion(datos, entorno);
  verificarCierre = estaCerrada;
  const observarAvance = observadorDeAvance(prueba);
  try {
    // --- Hasta la pantalla de restauración ---------------------------------
    /*
      DOS ENTRADAS, y hay que admitir las dos. Con un puesto de control en la
      carpeta —una restauración a medias— la aplicación arranca DIRECTO en la
      pantalla de restauración: ni configuración inicial ni ingreso (§4.35, y
      §8: «si existe restauracion.json, la aplicación arranca en la pantalla de
      restauración»). Sin él, se entra desde la configuración inicial. La
      primera versión de este guion esperaba SIEMPRE la configuración inicial y
      se quedó 25 s mirando una pantalla que no iba a llegar; lo encontró la
      primera corrida con --carpeta sobre una carpeta con progreso.
    */
    const entrada = await esperarAlguno(
      prueba,
      ['pantalla-de-restauracion', 'pantalla-de-configuracion-inicial'],
      ESPERA_LARGA,
      'esperando a que la aplicación abra',
    );
    if (entrada === null) {
      comprobar('la aplicación abrió en la restauración o en la configuración inicial', 'una de las dos', 'ninguna', false);
      return;
    }
    if (entrada === 'pantalla-de-configuracion-inicial') {
      await prueba('ir-a-restauracion').click();
      await prueba('pantalla-de-restauracion').waitFor({ timeout: ESPERA_CORTA });
    }
    /*
      Y hay que esperar la CONSECUENCIA visible, no el contenedor. La pantalla
      se dibuja antes de saber en qué estado está: mientras la consulta IPC
      viaja muestra «Consultando…» con el mismo `pantalla-de-restauracion` y sin
      ningún botón, así que contar ahí da 0 botones y 0 avisos. Es la misma
      lección que el `waitForTimeout` fijo de §4.34: medir la consecuencia.
    */
    const estadoALaVista = await esperarAlguno(
      prueba,
      ['restauracion-iniciar', 'restauracion-sin-configurar'],
      ESPERA_CORTA,
      'esperando a que la pantalla de restauración diga en qué estado está',
    );
    if (estadoALaVista === null) {
      comprobar('la pantalla de restauración dijo en qué estado está', 'un botón de iniciar, o el aviso de «sin configurar»', 'ninguno de los dos', false);
      return;
    }
    /*
      A QUÉ PROYECTO DICE QUE SE VA A CONECTAR (fase 4.c, punto 6). Se
      comprueba ANTES de que nadie escriba nada, que es cuando sirve: el
      2026-09-14 se tecleó la credencial del proyecto de pruebas contra el
      real, y la pantalla no daba ninguna pista de contra cuál estaba.
    */
    const avisoDelProyecto = unaLinea(await prueba('restauracion-proyecto').textContent().catch(() => ''));
    anotar(`la pantalla dice de qué proyecto restaura: ${avisoDelProyecto}`);
    comprobar(
      'la pantalla nombra el proyecto de Supabase ANTES de pedir la contraseña',
      `menciona ${entorno.POS_NUBE_PROYECTO}`,
      avisoDelProyecto || '(no dice nada)',
      avisoDelProyecto.includes(entorno.POS_NUBE_PROYECTO),
    );

    const retomando = (await prueba('restauracion-incompleta').count()) > 0;
    const sinConfigurar = await prueba('restauracion-sin-configurar').count();
    const iniciar = await prueba('restauracion-iniciar').count();
    const textoDelBoton = iniciar === 1 ? unaLinea(await prueba('restauracion-iniciar').textContent()) : '(no hay botón)';
    comprobar(
      retomando
        ? 'la aplicación abrió DIRECTO en la restauración incompleta, y el botón ofrece RETOMAR'
        : 'la pantalla ofrece iniciar: proyecto configurado, instalación vacía',
      retomando ? 'entrada directa, aviso de restauración incompleta y botón «Retomar la restauración»' : '0 avisos de «sin configurar», 1 botón de iniciar',
      retomando ? `entrada=${entrada}, botón «${textoDelBoton}»` : `${String(sinConfigurar)} avisos, ${String(iniciar)} botones`,
      retomando
        ? entrada === 'pantalla-de-restauracion' && /Retomar/.test(textoDelBoton)
        : sinConfigurar === 0 && iniciar === 1,
    );
    if (sinConfigurar !== 0 || iniciar !== 1) {
      return;
    }

    // --- Iniciar: el guion (solo contra pruebas) o una persona ---------------
    if (automatico) {
      await prueba('restauracion-correo').fill(entorno.POS_NUBE_RESTAURACION_CORREO);
      await prueba('restauracion-contrasena').fill(entorno.POS_NUBE_RESTAURACION_CLAVE);
      await prueba('restauracion-iniciar').click();
      anotar('formulario llenado por el guion (proyecto de PRUEBAS) y «Iniciar» pulsado');
    } else {
      anotar('ESPERANDO A UNA PERSONA: en la ventana, escribí el correo y la contraseña del usuario de restauración,');
      anotar(
        retomando
          ? `  y pulsá «Retomar la restauración» (sigue por donde quedó; no hay motivo que elegir). Plazo: ${String(ESPERA_A_LA_PERSONA / 60_000)} min.`
          : `  dejá el motivo en «Falla o reemplazo del equipo» y pulsá «Iniciar la restauración». Plazo: ${String(ESPERA_A_LA_PERSONA / 60_000)} min.`,
      );
      anotar('  Para CORTAR el ensayo: Ctrl+C acá. La aplicación no se puede cerrar desde adentro mientras no haya');
      anotar('  ningún administrador: la salida controlada pide su PIN, y en una instalación vacía no existe.');
    }

    // Un rechazo del ingreso (contraseña equivocada) deja la pantalla en el
    // formulario con un aviso; se anota una vez y se sigue esperando: la
    // persona puede volver a intentar.
    let ultimoAviso = '';
    const anotarAvisos = async () => {
      if ((await prueba('restauracion-error').count()) > 0) {
        const aviso = unaLinea(await prueba('restauracion-error').first().textContent().catch(() => ''));
        if (aviso !== '' && aviso !== ultimoAviso) {
          ultimoAviso = aviso;
          anotar(`aviso en pantalla: ${aviso}`);
        }
      }
      await observarAvance();
    };

    let retomas = 0;
    const motivosDeDetencion = [];
    for (;;) {
      const arrancada = await esperarAlguno(
        prueba,
        ['restauracion-progreso', 'restauracion-verificacion'],
        automatico ? ESPERA_DE_NUBE : ESPERA_A_LA_PERSONA,
        'sigo esperando a que la restauración arranque en la ventana',
        anotarAvisos,
      );
      if (arrancada === null) {
        comprobar('la restauración arrancó (alguien inició sesión en la ventana)', 'progreso a la vista', `nadie la inició en ${String(ESPERA_A_LA_PERSONA / 60_000)} min`, false);
        process.exitCode = 2;
        return;
      }
      if (retomas === 0) {
        comprobar('la restauración arrancó (alguien inició sesión en la ventana)', 'progreso a la vista', arrancada, true);
      }

      // --- La transferencia, hasta la revisión o hasta que se detenga --------
      const desenlace = await esperarAlguno(
        prueba,
        ['restauracion-verificacion', 'restauracion-detenida'],
        ESPERA_DE_NUBE,
        'la nube sigue entregando',
        observarAvance,
      );
      if (desenlace === 'restauracion-verificacion') {
        break;
      }
      const motivo = desenlace === null ? `no llegó a la revisión en ${String(ESPERA_DE_NUBE / 60_000)} min` : unaLinea(await prueba('restauracion-detenida').textContent().catch(() => ''));
      motivosDeDetencion.push(motivo);
      anotar(`la restauración se detuvo: ${motivo}`);
      volcarBitacora(datos);
      if (desenlace === null || (automatico && retomas >= RETOMAS_AUTOMATICAS)) {
        comprobar('la transferencia llegó a la revisión', 'revisión a la vista', motivosDeDetencion.join(' | '), false);
        return;
      }
      retomas += 1;
      if (automatico) {
        await prueba('restauracion-correo').fill(entorno.POS_NUBE_RESTAURACION_CORREO);
        await prueba('restauracion-contrasena').fill(entorno.POS_NUBE_RESTAURACION_CLAVE);
        await prueba('restauracion-iniciar').click();
        anotar(`retoma ${String(retomas)} pedida por el guion`);
      } else {
        anotar('ESPERANDO A UNA PERSONA: volvé a escribir la contraseña y pulsá «Retomar la restauración» en la ventana.');
      }
    }
    comprobar(
      'la transferencia llegó a la revisión (si la nube falló a mitad, retomar sigue desde donde quedó)',
      'revisión a la vista',
      motivosDeDetencion.length === 0 ? 'a la primera' : `tras ${String(motivosDeDetencion.length)} detención(es): ${motivosDeDetencion.join(' | ')}`,
      true,
    );

    // --- La revisión: verificación, usuarios, anomalías ----------------------
    const tituloDeVerificacion = unaLinea(await ventana.locator('[data-prueba="restauracion-verificacion"] h2').first().textContent());
    const textoDeVerificacion = unaLinea(await prueba('restauracion-verificacion').textContent());
    const renglonesDeVerificacion = await ventana.locator('[data-prueba="restauracion-verificacion"] .dato').evaluateAll((elementos) =>
      elementos.map((e) => `${(e.querySelector('.dato__etiqueta')?.textContent ?? '').trim()}: ${(e.querySelector('.dato__valor')?.textContent ?? '').trim()}`),
    );
    anotar(`verificación en pantalla: ${tituloDeVerificacion} — ${renglonesDeVerificacion.join(' · ')}`);
    if ((await prueba('restauracion-ventas-por-mes').count()) > 0) {
      anotar(`ventas por mes en pantalla: ${unaLinea(await prueba('restauracion-ventas-por-mes').textContent())}`);
    }
    comprobar(
      'la verificación CUADRA en pantalla: conteos nube = acá, y ventas por mes al centavo, sin ninguna ✗',
      '«Verificación · cuadra», sin ✗',
      tituloDeVerificacion,
      /cuadra/.test(tituloDeVerificacion) && !/NO cuadra/.test(tituloDeVerificacion) && !textoDeVerificacion.includes('✗'),
    );
    const usuariosEnPantalla = (await prueba('restauracion-usuario').allTextContents()).map(unaLinea);
    anotar(`usuarios en la revisión (${String(usuariosEnPantalla.length)}): ${usuariosEnPantalla.join(' || ') || '(ninguno: la nube no tiene usuarios)'}`);
    comprobar(
      'ningún usuario restaurado conserva PIN: todos aparecen «SIN PIN»',
      'todos SIN PIN',
      usuariosEnPantalla.length === 0 ? 'sin usuarios' : `${String(usuariosEnPantalla.filter((t) => t.includes('SIN PIN')).length)} de ${String(usuariosEnPantalla.length)}`,
      usuariosEnPantalla.every((t) => t.includes('SIN PIN')),
    );
    if ((await prueba('restauracion-anomalias').count()) > 0) {
      anotar(`anomalías en pantalla: ${unaLinea(await prueba('restauracion-anomalias').textContent())}`);
    }
    if ((await prueba('restauracion-fotos-faltantes').count()) > 0) {
      anotar(`fotos faltantes: ${unaLinea(await prueba('restauracion-fotos-faltantes').textContent())}`);
    }

    // --- «Terminar» se tiene que NEGAR: nadie tiene PIN y el guion no asigna --
    await prueba('restauracion-terminar').click();
    const respuestaATerminar = await esperarAlguno(prueba, ['restauracion-error', 'restauracion-terminada'], ESPERA_CORTA, 'esperando la respuesta a «Terminar»');
    const negativa = respuestaATerminar === 'restauracion-error' ? unaLinea(await prueba('restauracion-error').first().textContent()) : '';
    anotar(`al pulsar «Terminar»: ${respuestaATerminar === 'restauracion-error' ? negativa : respuestaATerminar === null ? 'sin respuesta' : 'TERMINÓ'}`);
    comprobar(
      '«Terminar» se NIEGA con el motivo (sin PIN asignado o sin administrador activo): un ensayo nunca termina una restauración',
      'un aviso que empieza por «Todavía no se puede dar por terminada»',
      negativa || (respuestaATerminar ?? 'sin respuesta'),
      /Todavía no se puede dar por terminada/.test(negativa),
    );

    // --- «Dejarla para después»: cierra la sesión de la nube ----------------
    await ventana.getByRole('button', { name: 'Dejarla para después' }).click();
    const dejada = await esperarAlguno(prueba, ['restauracion-incompleta'], ESPERA_CORTA, 'esperando a que se deje para después');
    comprobar(
      'al dejarla para después, la pantalla vuelve al formulario ofreciendo RETOMAR (lo bajado queda guardado)',
      'aviso de restauración incompleta',
      dejada ?? 'no apareció',
      dejada === 'restauracion-incompleta',
    );
    // La sesión se revoca en la nube en cuanto se deja: dale un momento a la petición.
    await dormir(2_000);
  } finally {
    const pid = matar(app);
    anotar(
      pid === null
        ? 'el proceso de Electron ya no estaba: la ventana se había cerrado'
        : `proceso ${String(pid)} de Electron terminado con SIGKILL (la base queda consolidada en su WAL: retomar la lee igual)`,
    );
  }
}

// ---------------------------------------------------------------------------

/**
 * La carpeta del ensayo: una nueva, o la que se pidió con `--carpeta`.
 *
 * Al reusar una hay que decir en qué estado está, porque «retomar» solo existe
 * si esa carpeta tiene `restauracion.json`: eso lo escribe el servicio cuando
 * la restauración YA arrancó, no cuando la ventana se abrió. Y si no lo tiene
 * y su base ya quedó escrita —basta un asiento de auditoría—, la restauración
 * se niega a empezar, porque exige una base vacía: abrir esa ventana sería
 * hacerle perder el tiempo a quien la mire.
 */
function prepararCarpeta(rutaPedida) {
  if (rutaPedida === null) {
    const nueva = mkdtempSync(join(tmpdir(), 'pos-ensayo-restauracion-'));
    anotar(`carpeta de datos NUEVA y descartable: ${nueva}`);
    return nueva;
  }
  const datos = resolve(rutaPedida);
  if (!existsSync(datos)) {
    console.error(`La carpeta ${datos} no existe. Sin --carpeta el guion crea una nueva.`);
    process.exit(2);
  }
  anotar(`carpeta de datos REUSADA (--carpeta): ${datos}`);
  if (existsSync(join(datos, ARCHIVO_DEL_PUESTO_DE_CONTROL))) {
    const puesto = JSON.parse(readFileSync(join(datos, ARCHIVO_DEL_PUESTO_DE_CONTROL), 'utf8'));
    const listas = Object.entries(puesto.tablas ?? {}).filter(([, t]) => t.lista).length;
    anotar(`tiene puesto de control: ${String(listas)} tabla(s) ya listas, proyecto ${String(puesto.proyecto)}, la empezó ${String(puesto.correo)}`);
    anotar('la pantalla va a ofrecer RETOMAR: sigue por la tabla y la página donde quedó');
    return datos;
  }
  anotar('NO tiene puesto de control (restauracion.json): en esa carpeta la restauración nunca llegó a arrancar');
  let conFilas = [];
  try {
    const base = leerBaseRestaurada(datos);
    conFilas = TABLAS_QUE_DEBEN_ESTAR_VACIAS.filter((tabla) => base.filas[tabla] > 0);
    anotar(`filas en su base: ${TABLAS.map((t) => `${t}=${String(base.filas[t])}`).join(' ')}`);
  } catch (error) {
    anotar(`no se pudo leer su base (${error.message}); se abre igual y decide la aplicación`);
    return datos;
  }
  if (conFilas.length > 0) {
    console.error(
      `Esa carpeta no sirve para restaurar: su base ya tiene filas (${conFilas.map((t) => `${t}`).join(', ')}) y no hay puesto de control.\n` +
        'La restauración solo corre sobre una base VACÍA, así que la pantalla iba a mostrar «Esta instalación ya tiene datos»\n' +
        'con el botón de iniciar deshabilitado. Corré el ensayo sin --carpeta para que cree una nueva.',
    );
    process.exit(2);
  }
  anotar('su base está vacía: la pantalla va a ofrecer INICIAR (no hay progreso que retomar)');
  return datos;
}

async function main() {
  const rutaDelEntorno = argumento('entorno', '.env.nube-pruebas');
  const entorno = leerEntorno(rutaDelEntorno);
  const automatico = puedeLlenarElFormulario(entorno);
  const compilado = join(PROYECTO, require(join(PROYECTO, 'package.json')).main);
  if (!existsSync(compilado)) {
    console.error(`Falta la aplicación compilada (${compilado}). Corré «npm run build» primero, o usá «npm run ensayo:restauracion».`);
    process.exit(2);
  }
  anotar(`ENSAYO DE RESTAURACIÓN contra el proyecto ${entorno.POS_NUBE_PROYECTO} (${entorno.POS_NUBE_URL}), entorno ${rutaDelEntorno}`);
  const datos = prepararCarpeta(argumento('carpeta', null));
  anotar(automatico ? 'proyecto de PRUEBAS con credenciales en el entorno: el guion llena el formulario solo' : 'la contraseña la teclea una persona en la ventana; este guion no la conoce');
  anotar('este ensayo NO escribe nada en la nube: solo lee, y abre y cierra una sesión de Auth');

  try {
    await ensayar(datos, entorno, automatico);
  } catch (error) {
    if (error instanceof VentanaCerrada) {
      comprobar('la ventana siguió abierta hasta que el ensayo terminó', 'abierta', 'se cerró antes: el ensayo no pudo seguir', false);
      process.exitCode = 2;
    } else {
      comprobar('el ensayo llegó hasta el final', 'sin errores', error.message, false);
    }
  }

  // --- Lo que quedó en el disco --------------------------------------------
  anotar('=== bitácora técnica de la corrida (cada petición con su método, su ruta y su código) ===');
  const bitacora = volcarBitacora(datos);
  if (existsSync(join(datos, ARCHIVO_DEL_PUESTO_DE_CONTROL))) {
    const puesto = JSON.parse(readFileSync(join(datos, ARCHIVO_DEL_PUESTO_DE_CONTROL), 'utf8'));
    anotar(`puesto de control (restauracion.json): ${JSON.stringify(puesto)}`);
  } else {
    anotar('no quedó puesto de control (restauracion.json)');
  }
  if (existsSync(join(datos, ARCHIVO_DE_LA_BASE))) {
    const base = leerBaseRestaurada(datos);
    anotar(`migraciones en la base del ensayo: ${String(base.migraciones.n)}, última ${base.migraciones.ultima}`);
    anotar(`filas restauradas por tabla: ${TABLAS.map((t) => `${t}=${String(base.filas[t])}`).join(' ')}`);
    anotar(`configuracion_negocio en la base del ensayo: ${JSON.stringify(base.configuracion)}`);
    anotar(`usuarios en la base del ensayo: ${JSON.stringify(base.usuarios)}`);
    anotar(`sync_cola de la base del ensayo: ${JSON.stringify(base.cola)}`);
    comprobar(
      'configuracion_negocio.actualizado_en llegó con TODOS sus decimales y en la forma local (Z)',
      'YYYY-MM-DDTHH:MM:SS[.decimales]Z, tal como lo tiene la nube',
      String(base.configuracion?.actualizado_en),
      base.configuracion !== undefined && FORMA_DE_FECHA_LOCAL.test(String(base.configuracion.actualizado_en)),
    );
    comprobar(
      'las 11 denominaciones del quetzal están (las siembra la migración; la restauración solo las coteja)',
      String(DENOMINACIONES_DEL_QUETZAL),
      String(base.denominaciones),
      base.denominaciones === DENOMINACIONES_DEL_QUETZAL,
    );
    comprobar(
      'en la base, todo usuario restaurado tiene el centinela «sin PIN» y ningún PIN remoto',
      'todos con pin_hash = sin-pin y pin_remoto_hash NULL',
      base.usuarios.length === 0 ? 'sin usuarios' : base.usuarios.map((u) => `${u.nombre}: sin_pin=${String(u.sin_pin)} sin_remoto=${String(u.sin_pin_remoto)}`).join('; '),
      base.usuarios.every((u) => u.sin_pin === 1 && u.sin_pin_remoto === 1),
    );
    if (bitacora.some((l) => l.includes('sesión de restauración iniciada'))) {
      comprobar(
        'la sesión de la nube se cerró al dejar la restauración (logout con scope=local, en la bitácora)',
        'una línea «sesión de restauración cerrada (HTTP 204)»',
        bitacora.filter((l) => l.includes('sesión de restauración cerrada')).join(' | ') || 'no hay línea de cierre',
        bitacora.some((l) => l.includes('sesión de restauración cerrada (HTTP 204)')),
      );
    } else {
      anotar('no se abrió ninguna sesión de restauración en esta corrida: no hay cierre que comprobar');
    }
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  anotar(`la carpeta del ensayo queda en ${datos} (no se borra: es la evidencia)`);
  console.info(
    `${MARCA_INFORME}${JSON.stringify({
      proyecto: entorno.POS_NUBE_PROYECTO,
      plataforma: process.platform,
      carpeta: datos,
      total: comprobaciones.length,
      fallidas: fallidas.length,
      comprobaciones,
      ensayadoEn: new Date().toISOString(),
    })}`,
  );
  process.exit(process.exitCode === 2 ? 2 : fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[ensayo-de-restauracion] Falló antes de poder comprobar nada: ${error.message}`);
  process.exit(1);
});
