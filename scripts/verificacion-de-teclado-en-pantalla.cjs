/**
 * verificacion-de-teclado-en-pantalla.cjs — Todo campo donde se escribe abre
 * el teclado en pantalla, y la salida controlada sigue protegida igual que
 * antes. Manejando la aplicación REAL (CLAUDE.md §4.45, 2026-09-15).
 *
 * Nace de un hallazgo en la app: el diálogo «Salida de administrador» pedía el
 * PIN en un `<input>` nativo, y en la pantalla táctil de la tienda no había
 * cómo escribirlo. La auditoría de ese día encontró 22 campos en la misma
 * situación. Este guion los recorre UNO POR UNO, con un toque de dedo:
 *
 *   A. Cada campo abre el teclado en pantalla (o el calendario, si es una
 *      fecha) y escribir con sus teclas llena ESE campo.
 *   B. El diálogo de salida: el teclado numérico, sin ningún campo nativo, y
 *      cierra el alfanumérico si había un formulario a medio escribir.
 *   C. Los TRES caminos de salida siguen pidiendo PIN: el atajo, el cierre del
 *      sistema (Cmd+Q / Alt+F4, en sus dos puertas del proceso principal) y el
 *      botón. La aplicación sigue viva después de cada uno.
 *   D. El candado de intentos: tres PIN equivocados bloquean la superficie, un
 *      PIN CORRECTO durante el bloqueo no cierra nada, y pasado el bloqueo el
 *      PIN correcto cierra la aplicación de forma ordenada.
 *   E. macOS: la sonda de Presentation Options confirma que ni Forzar Salida
 *      ni Cmd+Tab quedaron apagados, con la app en pantalla completa y con el
 *      diálogo abierto.
 *
 * SIN NUBE DE VERDAD: las pantallas de nube y de restauración solo dibujan sus
 * campos con un proyecto configurado, así que se pasa `POS_NUBE_URL` apuntando
 * a `http://127.0.0.1:9`, un puerto local cerrado. Ninguna petición sale de
 * esta máquina y ningún proyecto de Supabase se toca. El proveedor de
 * sincronización queda en el simulado.
 *
 * Carpeta de datos TEMPORAL; las capturas quedan en la carpeta que imprime.
 * Código 1 si alguna comprobación falla.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

const PROYECTO = join(__dirname, '..');
const PIN = '2468';
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;
const RUTA_SONDA = join(PROYECTO, 'node_modules', '.tmp', 'sonda-presentacion');

const comprobaciones = [];

function comprobar(nombre, esperado, real, paso) {
  comprobaciones.push({ nombre, esperado, real, paso });
  console.info(`${new Date().toISOString()}  ${paso ? 'OK   ' : 'FALLA'} ${nombre}`);
  if (!paso) {
    console.info(`           esperado: ${String(esperado)}`);
    console.info(`           real    : ${String(real)}`);
  }
}

function anotar(texto) {
  console.info(`${new Date().toISOString()}  ${texto}`);
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Corre AppleScript y devuelve la salida cruda, o el error crudo. */
function applescript(guion) {
  const resultado = spawnSync('osascript', ['-e', guion], { encoding: 'utf8' });
  return { codigo: resultado.status, salida: (resultado.stdout ?? '').trim(), error: (resultado.stderr ?? '').trim() };
}

async function main() {
  if (process.platform !== 'darwin') {
    anotar('AVISO: este guion usa AppleScript y la sonda de macOS; en otra plataforma se saltan esas partes.');
  }
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-teclado-'));
  const capturas = join(datos, 'capturas');
  mkdirSync(capturas);
  const rutaDeLaBase = join(datos, 'pos-agricola.db');

  if (process.platform === 'darwin' && !existsSync(RUTA_SONDA)) {
    mkdirSync(join(PROYECTO, 'node_modules', '.tmp'), { recursive: true });
    execFileSync('swiftc', ['-O', join(PROYECTO, 'scripts', 'sonda-presentacion-macos.swift'), '-o', RUTA_SONDA]);
  }

  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
    env: {
      ...process.env,
      POS_NUBE_URL: 'http://127.0.0.1:9',
      POS_NUBE_LLAVE_PUBLICABLE: 'llave-de-verificacion-local',
      POS_SYNC_PROVIDER: '',
    },
  });
  const proceso = app.process();
  let salidaDelProceso = '';
  proceso.stdout?.on('data', (trozo) => {
    salidaDelProceso += trozo.toString();
  });
  proceso.stderr?.on('data', (trozo) => {
    salidaDelProceso += trozo.toString();
  });
  let codigoDeSalida = null;
  proceso.on('exit', (codigo) => {
    codigoDeSalida = codigo;
  });

  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const enSalida = (nombre) => prueba('dialogo-salida').locator(`[data-prueba="${nombre}"]`);
  const capturar = async (nombre) => {
    const ruta = join(capturas, `${nombre}.png`);
    await ventana.screenshot({ path: ruta });
    anotar(`captura: ${ruta}`);
  };
  const leerBase = (consulta, ...parametros) => {
    const conexion = new DatabaseConstructor(rutaDeLaBase, { readonly: true });
    try {
      return conexion.prepare(consulta).all(...parametros);
    } finally {
      conexion.close();
    }
  };
  const volver = async () => {
    await ventana.getByRole('button', { name: 'Volver' }).first().click();
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
  };
  const teclearPin = async (pin) => {
    for (const digito of pin) {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('tecla-confirmar').click();
  };
  const solicitudesEnElLog = (origen) =>
    salidaDelProceso.split('\n').filter((l) => l.includes(`Se solicitó la salida controlada (origen: ${origen})`)).length;

  /** Sonda de macOS con la ventana del POS al frente. */
  const medirPresentacion = (momento) => {
    if (process.platform !== 'darwin') {
      return;
    }
    const frente = applescript(
      `tell application "System Events" to set frontmost of (first process whose unix id is ${String(proceso.pid)}) to true`,
    );
    anotar(`AppleScript, traer el POS al frente: codigo=${String(frente.codigo)} ${frente.error}`);
    const quienEstaAlFrente = applescript(
      'tell application "System Events" to get unix id of (first process whose frontmost is true)',
    );
    const sonda = execFileSync(RUTA_SONDA).toString().trim();
    anotar(`SONDA [${momento}] con el proceso ${quienEstaAlFrente.salida} al frente (POS = ${String(proceso.pid)}): ${sonda}`);
    const json = JSON.parse(sonda);
    comprobar(
      `macOS [${momento}]: ni Forzar Salida ni Cmd+Tab apagados por el POS`,
      'bloqueaForceQuit=false, bloqueaCmdTab=false, con el POS al frente',
      `bloqueaForceQuit=${String(json.bloqueaForceQuit)}, bloqueaCmdTab=${String(json.bloqueaCmdTab)}, al frente ${quienEstaAlFrente.salida}`,
      json.bloqueaForceQuit === false && json.bloqueaCmdTab === false && quienEstaAlFrente.salida === String(proceso.pid),
    );
  };

  /**
   * EL PASO CENTRAL: toca el campo como un dedo, exige que se abra el teclado
   * con la disposición esperada, escribe tocando teclas y lee el campo.
   */
  const tocarYEscribir = async ({ campo, nombre, disposicion, teclas, esperado, oculto = false, yaAbierto = false }) => {
    const locator = prueba(campo);
    await locator.waitFor({ timeout: ESPERA_CORTA });
    await ventana.evaluate(() => {
      window.__eventos = [];
      if (window.__registroInstalado !== true) {
        window.__registroInstalado = true;
        for (const tipo of ['mousedown', 'focus', 'mouseup', 'click']) {
          document.addEventListener(
            tipo,
            (evento) => {
              const destino = evento.target;
              window.__eventos?.push(
                `${tipo}→${destino?.getAttribute?.('data-prueba') ?? destino?.tagName ?? '?'} scrollY=${String(Math.round(document.scrollingElement?.scrollTop ?? 0))}`,
              );
            },
            true,
          );
        }
      }
    });
    if (!yaAbierto) {
      await locator.click();
    }
    const teclado = prueba('teclado-en-pantalla');
    const abrio = await teclado.waitFor({ timeout: 3000 }).then(() => true, () => false);
    const disposicionReal = abrio ? await teclado.getAttribute('data-disposicion') : '(no se abrió)';
    if (!abrio) {
      const diagnostico = await ventana.evaluate(() => ({
        ventanaConFoco: document.hasFocus(),
        activo: document.activeElement?.getAttribute('data-prueba') ?? document.activeElement?.tagName,
        viewport: `${String(window.innerWidth)}x${String(window.innerHeight)}`,
        eventos: window.__eventos,
      }));
      anotar(`  ${nombre}: EL TECLADO NO SE ABRIÓ. Diagnóstico: ${JSON.stringify(diagnostico)}`);
      comprobar(`${nombre}: tocarlo abre el teclado ${disposicion}`, 'teclado abierto', 'no se abrió', false);
      return;
    }
    // Lo que el campo ya traía se borra con «←», como lo haría el cajero: el
    // teclado agrega siempre al final (`teclado/teclas.ts`).
    const previo = await locator.inputValue();
    for (let i = 0; i < Array.from(previo).length; i += 1) {
      await prueba('tp-borrar').click();
    }
    for (const tecla of teclas) {
      await prueba(`tp-${tecla}`).click();
    }
    const valor = await locator.inputValue();
    const vista = abrio ? ((await prueba('tp-vista').textContent()) ?? '') : '';
    const tipo = await locator.getAttribute('type');
    const modo = await locator.getAttribute('inputmode');
    anotar(
      `  ${nombre}: teclado=${abrio ? 'abierto' : 'NO'} disposición=${String(disposicionReal)} ` +
        `type=${String(tipo)} inputmode=${String(modo)} valor=${JSON.stringify(oculto ? '•'.repeat(valor.length) : valor)} vista=${JSON.stringify(vista)}`,
    );
    const vistaCorrecta = oculto ? vista === '•'.repeat(esperado.length) : vista === esperado;
    comprobar(
      `${nombre}: tocarlo abre el teclado ${disposicion} y escribir con él llena el campo`,
      `teclado ${disposicion}, valor ${JSON.stringify(oculto ? '(oculto)' : esperado)}${oculto ? ', type=password y vista con puntos' : ''}`,
      `teclado ${String(disposicionReal)}, valor ${oculto ? (valor === esperado ? '(coincide)' : '(no coincide)') : JSON.stringify(valor)}, type=${String(tipo)}, vista ${JSON.stringify(vista)}`,
      abrio &&
        disposicionReal === disposicion &&
        valor === esperado &&
        vistaCorrecta &&
        modo === 'none' &&
        (!oculto || tipo === 'password'),
    );
    if (abrio) {
      await prueba('tp-listo').click();
      await teclado.waitFor({ state: 'detached', timeout: 3000 });
    }
  };

  /** Una fecha: tocar el campo en el medio, no en el iconito, tiene que abrir el calendario. */
  const tocarFecha = async ({ campo, nombre, tipoEsperado }) => {
    await ventana.evaluate(() => {
      const estado = { llamadas: 0, errores: [] };
      window.__calendario = estado;
      const original = HTMLInputElement.prototype.showPicker;
      if (original.__envuelto === true) {
        return;
      }
      const envuelto = function envuelto() {
        window.__calendario.llamadas += 1;
        try {
          return original.call(this);
        } catch (error) {
          window.__calendario.errores.push(String(error));
          throw error;
        }
      };
      envuelto.__envuelto = true;
      HTMLInputElement.prototype.showPicker = envuelto;
    });
    const locator = prueba(campo);
    await locator.waitFor({ timeout: ESPERA_CORTA });
    const caja = await locator.boundingBox();
    // En el primer tercio: lejos del iconito del calendario, que va a la derecha.
    await locator.click({ position: { x: Math.max(8, Math.floor((caja?.width ?? 60) / 3)), y: Math.floor((caja?.height ?? 20) / 2) } });
    await esperar(300);
    const estado = await ventana.evaluate(() => window.__calendario);
    const tipo = await locator.getAttribute('type');
    const modo = await locator.getAttribute('inputmode');
    anotar(`  ${nombre}: type=${String(tipo)} inputmode=${String(modo)} showPicker llamadas=${String(estado.llamadas)} errores=${JSON.stringify(estado.errores)}`);
    comprobar(
      `${nombre}: tocar el campo (no el iconito) abre el calendario`,
      `type=${tipoEsperado}, inputmode=none, showPicker llamado 1 vez sin error`,
      `type=${String(tipo)}, inputmode=${String(modo)}, ${String(estado.llamadas)} llamada(s), errores ${JSON.stringify(estado.errores)}`,
      tipo === tipoEsperado && modo === 'none' && estado.llamadas === 1 && estado.errores.length === 0,
    );
    await ventana.keyboard.press('Escape');
    await esperar(200);
  };

  /** La app sigue viva (el proceso no terminó) y el diálogo de salida está a la vista. */
  const exigirDialogoYAppViva = async (camino, origen, antes) => {
    const aparecio = await prueba('dialogo-salida').waitFor({ timeout: ESPERA_CORTA }).then(() => true, () => false);
    await esperar(300);
    const nativos = aparecio ? await prueba('dialogo-salida').locator('input, textarea, [contenteditable]').count() : -1;
    const teclas = aparecio ? await enSalida('tecla-5').count() : 0;
    const despues = solicitudesEnElLog(origen);
    anotar(`  ${camino}: diálogo=${aparecio ? 'visible' : 'NO'} campos nativos=${String(nativos)} teclas del PIN=${String(teclas)} ` +
      `log «origen: ${origen}» antes=${String(antes)} después=${String(despues)} proceso vivo=${String(codigoDeSalida === null)}`);
    comprobar(
      `${camino}: pide el PIN (diálogo con teclado numérico, sin campo nativo) y la aplicación NO se cierra`,
      `diálogo visible, 0 campos nativos, teclado numérico, una solicitud más con origen ${origen}, proceso vivo`,
      `diálogo ${aparecio ? 'visible' : 'ausente'}, ${String(nativos)} campos nativos, ${String(teclas)} tecla 5, solicitudes ${String(antes)}→${String(despues)}, proceso ${codigoDeSalida === null ? 'vivo' : `terminó (${String(codigoDeSalida)})`}`,
      aparecio && nativos === 0 && teclas === 1 && despues === antes + 1 && codigoDeSalida === null,
    );
  };

  try {
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await esperar(1500);
    medirPresentacion('al arrancar, pantalla completa');
    await app.evaluate(async ({ BrowserWindow }) => {
      const [v] = BrowserWindow.getAllWindows();
      if (v) {
        v.setFullScreen(false);
        v.setSize(1100, 900);
      }
    });
    await esperar(1500);

    // =======================================================================
    // A. LOS 22 CAMPOS QUE NO TENÍAN TECLADO, uno por uno
    // =======================================================================
    anotar('--- A. restauración (instalación vacía) ---');
    await prueba('ir-a-restauracion').click();
    await prueba('restauracion-correo').waitFor({ timeout: ESPERA_CORTA });
    await tocarYEscribir({
      campo: 'restauracion-correo',
      nombre: '#16 Restauración · correo',
      disposicion: 'texto',
      // Sin Mayús inicial: la c sale minúscula. La arroba, por la capa de símbolos.
      teclas: ['c', 'a', 'j', 'a', 'simbolos', '@', 'simbolos', 'p', 'o', 's'],
      esperado: 'caja@pos',
    });
    await tocarYEscribir({
      campo: 'restauracion-contrasena',
      nombre: '#17 Restauración · contraseña',
      disposicion: 'texto',
      teclas: ['mayus', 'c', 'l', 'a', 'v', 'e', 'simbolos', '#', '1'],
      esperado: 'Clave#1',
      oculto: true,
    });
    await ventana.locator('input[type="radio"][value="robo"]').check();
    await tocarFecha({ campo: 'restauracion-fecha-del-robo', nombre: '#18 Restauración · fecha del robo', tipoEsperado: 'datetime-local' });
    await capturar('A1-restauracion');
    await ventana.getByRole('button', { name: 'Volver' }).first().click();

    anotar('--- A. configuración inicial ---');
    await prueba('campo-nombre').waitFor({ timeout: ESPERA_CORTA });
    await tocarYEscribir({
      campo: 'campo-nombre',
      nombre: '#2 Configuración inicial · nombre del administrador',
      disposicion: 'texto',
      teclas: ['j', 'i', 'm', 'm', 'y'],
      esperado: 'Jimmy',
    });
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN);
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });

    anotar('--- A. usuarios ---');
    await prueba('ir-a-usuarios').click();
    await tocarYEscribir({ campo: 'usuario-nombre', nombre: '#6 Usuarios · nombre', disposicion: 'texto', teclas: ['a', 'n', 'a'], esperado: 'Ana' });
    await tocarYEscribir({
      campo: 'usuario-pin',
      nombre: '#7 Usuarios · PIN del alta',
      disposicion: 'entero',
      teclas: ['1', '3', '5', '7', '9'],
      // El quinto dígito no entra: el campo tiene maxLength 4.
      esperado: '1357',
      oculto: true,
    });
    await volver();

    anotar('--- A. límites de descuento ---');
    await prueba('ir-a-limites').click();
    await prueba('editar-limite-venta').click();
    await tocarYEscribir({ campo: 'limite-porcentaje', nombre: '#8 Límites · porcentaje', disposicion: 'decimal', teclas: ['1', '2', '.', '5'], esperado: '12.5' });
    await tocarYEscribir({ campo: 'limite-monto', nombre: '#9 Límites · monto fijo', disposicion: 'decimal', teclas: ['2', '0'], esperado: '20' });
    await volver();

    anotar('--- A. datos del negocio ---');
    await prueba('ir-a-negocio').click();
    await tocarYEscribir({ campo: 'negocio-nombreComercial', nombre: '#10 Negocio · nombre comercial', disposicion: 'texto', teclas: ['a', 'g', 'r', 'o'], esperado: 'Agro' });
    await tocarYEscribir({ campo: 'negocio-direccion', nombre: '#11 Negocio · dirección', disposicion: 'texto', teclas: ['z', 'o', 'n', 'a', 'espacio', '1'], esperado: 'Zona 1' });
    await tocarYEscribir({ campo: 'negocio-telefono', nombre: '#12 Negocio · teléfono', disposicion: 'texto', teclas: ['5', '5', '5', '-', '1'], esperado: '555-1' });
    await tocarYEscribir({ campo: 'negocio-nit', nombre: '#13 Negocio · NIT', disposicion: 'texto', teclas: ['1', '2', '-', 'k'], esperado: '12-k' });
    await capturar('A2-negocio');

    // ---- B. con el teclado ALFANUMÉRICO abierto, se pide la salida --------
    anotar('--- B. el atajo con un formulario a medio escribir ---');
    await prueba('negocio-nit').click();
    await prueba('teclado-en-pantalla').waitFor({ timeout: 3000 });
    const antesDelAtajo = solicitudesEnElLog('atajo_de_teclado');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'q', modifiers: ['control', 'shift', 'alt'] });
    });
    await exigirDialogoYAppViva('C1 · atajo Ctrl+Shift+Alt+Q (sendInputEvent, pasa por before-input-event)', 'atajo_de_teclado', antesDelAtajo);
    const tecladoAlfanumerico = await prueba('teclado-en-pantalla').count();
    comprobar(
      'B · el diálogo de salida CIERRA el teclado alfanumérico del formulario, para no tapar las teclas del PIN',
      '0 teclados alfanuméricos a la vista',
      `${String(tecladoAlfanumerico)} teclado(s) alfanumérico(s)`,
      tecladoAlfanumerico === 0,
    );
    await enSalida('tecla-1').click();
    await enSalida('tecla-2').click();
    const puntos = await prueba('dialogo-salida').locator('.teclado__punto--lleno').count();
    const textoDelDialogo = (await prueba('dialogo-salida').innerText()).replace(/\n+/g, ' | ');
    anotar(`  texto del diálogo tras tocar 1 y 2: ${JSON.stringify(textoDelDialogo)}`);
    comprobar(
      'B · tocar teclas del teclado numérico del diálogo llena puntos, y el PIN no aparece en texto',
      '2 puntos llenos, sin «12» en el diálogo',
      `${String(puntos)} puntos, «12» ${textoDelDialogo.includes('12') ? 'PRESENTE' : 'ausente'}`,
      puntos === 2 && !textoDelDialogo.includes('12'),
    );
    await capturar('B-dialogo-de-salida-con-teclado');
    medirPresentacion('con el diálogo de salida abierto');
    await prueba('dialogo-salida').getByRole('button', { name: 'Cancelar' }).click();
    await prueba('dialogo-salida').waitFor({ state: 'detached', timeout: 3000 });

    // ---- C. los otros caminos ---------------------------------------------
    anotar('--- C. el atajo con una pulsación REAL del sistema operativo (AppleScript) ---');
    if (process.platform === 'darwin') {
      const antesReal = solicitudesEnElLog('atajo_de_teclado');
      const pulsacion = applescript(
        'tell application "System Events"\n' +
          `  set frontmost of (first process whose unix id is ${String(proceso.pid)}) to true\n` +
          '  delay 0.5\n' +
          `  if unix id of (first process whose frontmost is true) is ${String(proceso.pid)} then\n` +
          '    keystroke "q" using {control down, shift down, option down}\n' +
          '    return "enviada"\n' +
          '  else\n' +
          '    return "NO enviada: el POS no quedó al frente"\n' +
          '  end if\n' +
          'end tell',
      );
      anotar(`  AppleScript Ctrl+Shift+Option+Q: codigo=${String(pulsacion.codigo)} salida=${JSON.stringify(pulsacion.salida)} error=${JSON.stringify(pulsacion.error)}`);
      if (pulsacion.salida === 'enviada') {
        await exigirDialogoYAppViva('C1b · atajo Ctrl+Shift+Option+Q con una pulsación REAL de macOS', 'atajo_de_teclado', antesReal);
        await prueba('dialogo-salida').getByRole('button', { name: 'Cancelar' }).click();
        await prueba('dialogo-salida').waitFor({ state: 'detached', timeout: 3000 });
      } else {
        anotar('  NO SE PUDO mandar una pulsación real (sin permiso de Accesibilidad o el POS no quedó al frente): el atajo quedó verificado solo por sendInputEvent.');
      }

      anotar('--- C. Cmd+Q con una pulsación REAL de macOS ---');
      const antesCmdQ = solicitudesEnElLog('cierre_del_sistema');
      const cmdQ = applescript(
        'tell application "System Events"\n' +
          `  set frontmost of (first process whose unix id is ${String(proceso.pid)}) to true\n` +
          '  delay 0.5\n' +
          `  if unix id of (first process whose frontmost is true) is ${String(proceso.pid)} then\n` +
          '    keystroke "q" using {command down}\n' +
          '    return "enviada"\n' +
          '  else\n' +
          '    return "NO enviada: el POS no quedó al frente"\n' +
          '  end if\n' +
          'end tell',
      );
      anotar(`  AppleScript Cmd+Q: codigo=${String(cmdQ.codigo)} salida=${JSON.stringify(cmdQ.salida)} error=${JSON.stringify(cmdQ.error)}`);
      await esperar(1500);
      const dialogoTrasCmdQ = await prueba('dialogo-salida').count();
      anotar(`  tras Cmd+Q real: diálogo=${String(dialogoTrasCmdQ)} solicitudes cierre_del_sistema ${String(antesCmdQ)}→${String(solicitudesEnElLog('cierre_del_sistema'))} proceso vivo=${String(codigoDeSalida === null)}`);
      if (cmdQ.salida === 'enviada') {
        comprobar(
          'C2a · Cmd+Q real de macOS NO cierra la aplicación sin PIN',
          'proceso vivo',
          codigoDeSalida === null ? 'proceso vivo' : `terminó (${String(codigoDeSalida)})`,
          codigoDeSalida === null,
        );
      } else {
        anotar('  NO SE PUDO mandar Cmd+Q real: queda verificado solo por app.quit(), que es su misma puerta.');
      }
      if (dialogoTrasCmdQ > 0) {
        await prueba('dialogo-salida').getByRole('button', { name: 'Cancelar' }).click();
        await prueba('dialogo-salida').waitFor({ state: 'detached', timeout: 3000 });
      }
    }

    anotar('--- C. las dos puertas del cierre del sistema, llamadas desde el proceso principal ---');
    const antesQuit = solicitudesEnElLog('cierre_del_sistema');
    await app.evaluate(({ app: aplicacion }) => {
      aplicacion.quit();
    });
    await exigirDialogoYAppViva('C2 · app.quit() (lo que dispara Cmd+Q y el menú del Dock → before-quit)', 'cierre_del_sistema', antesQuit);
    await prueba('dialogo-salida').getByRole('button', { name: 'Cancelar' }).click();
    await prueba('dialogo-salida').waitFor({ state: 'detached', timeout: 3000 });

    const antesClose = solicitudesEnElLog('cierre_del_sistema');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    await exigirDialogoYAppViva('C3 · ventana.close() (lo que dispara Alt+F4 y el botón de cerrar en Windows → close)', 'cierre_del_sistema', antesClose);
    await prueba('dialogo-salida').getByRole('button', { name: 'Cancelar' }).click();
    await prueba('dialogo-salida').waitFor({ state: 'detached', timeout: 3000 });
    await volver();

    anotar('--- A. nube ---');
    await prueba('ir-a-nube').click();
    await tocarYEscribir({
      campo: 'nube-correo-entrada',
      nombre: '#14 Nube · correo',
      disposicion: 'texto',
      teclas: ['t', '1', 'simbolos', '@', 'simbolos', 'x'],
      esperado: 't1@x',
    });
    await tocarYEscribir({
      campo: 'nube-contrasena-entrada',
      nombre: '#15 Nube · contraseña',
      disposicion: 'texto',
      teclas: ['s', 'e', 'c', 'r', 'e', 't', 'o'],
      esperado: 'secreto',
      oculto: true,
    });
    await volver();

    anotar('--- A. reportes ---');
    await prueba('ir-a-reportes').click();
    await prueba('periodo-personalizado').click();
    await tocarFecha({ campo: 'rango-desde', nombre: '#19 Reportes · desde', tipoEsperado: 'date' });
    await tocarFecha({ campo: 'rango-hasta', nombre: '#20 Reportes · hasta', tipoEsperado: 'date' });
    await volver();

    anotar('--- A. historial de cajas ---');
    await prueba('ir-a-historial-de-cajas').click();
    await tocarFecha({ campo: 'historial-desde', nombre: '#21 Historial de cajas · desde', tipoEsperado: 'date' });
    await tocarFecha({ campo: 'historial-hasta', nombre: '#22 Historial de cajas · hasta', tipoEsperado: 'date' });
    await volver();

    anotar('--- A. venta y cobro (se prepara una categoría, un producto y la caja) ---');
    await prueba('ir-a-categorias').click();
    await prueba('categoria-nombre').fill('Granos');
    await prueba('categoria-guardar').click();
    await ventana.locator('[data-prueba="lista-de-categorias"] li').first().waitFor();
    await volver();
    await prueba('ir-a-productos').click();
    await prueba('productos-nuevo').click();
    await prueba('producto-nombre').fill('Maíz blanco');
    await prueba('producto-precio').fill('4.25');
    await prueba('producto-inventario-inicial').fill('100');
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await volver();
    await prueba('ir-a-caja').click();
    await prueba('modo-simple').click();
    for (const digito of '500') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    await volver();
    await prueba('ir-a-venta').click();
    await prueba('cuadricula-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await tocarYEscribir({ campo: 'venta-buscador', nombre: '#3 Venta · buscador de productos', disposicion: 'texto', teclas: ['m', 'a', 'í'], esperado: 'maí' });
    const iconosFiltrados = await prueba('icono-producto').count();
    anotar(`  productos a la vista con «maí»: ${String(iconosFiltrados)}`);
    await prueba('venta-buscador').click();
    for (let i = 0; i < 3; i += 1) {
      await prueba('tp-borrar').click();
    }
    await prueba('tp-listo').click();
    await prueba('icono-producto').first().click();
    await prueba('cobrar').click();
    await prueba('dialogo-de-cobro').waitFor({ timeout: ESPERA_CORTA });
    await prueba('descuento-porcentaje').click();
    // El campo tiene `autoFocus`: al aparecer, el teclado se abre SOLO.
    await tocarYEscribir({ campo: 'descuento-valor', nombre: '#4 Cobro · valor del descuento', disposicion: 'decimal', teclas: ['5'], esperado: '5', yaAbierto: true });
    await prueba('descuento-valor').click();
    await prueba('teclado-en-pantalla').waitFor({ timeout: 3000 });
    // Se DESPLAZA el diálogo hasta el botón, como haría el cajero con el dedo:
    // en una pantalla baja el diálogo es más alto que lo que el teclado deja.
    const desplazamiento = await ventana.evaluate(() => {
      const boton = document.querySelector('[data-prueba="cobro-continuar"]');
      const teclado = document.querySelector('[data-prueba="teclado-en-pantalla"]');
      const capa = boton?.closest('.capa-modal');
      if (!boton || !teclado || !capa) {
        return 'faltan elementos';
      }
      const falta = boton.getBoundingClientRect().bottom - teclado.getBoundingClientRect().top + 16;
      const antes = capa.scrollTop;
      capa.scrollTop = antes + Math.max(0, falta);
      return `capa ${capa.className}: scrollTop ${String(antes)}→${String(capa.scrollTop)} (hacían falta ${String(Math.round(falta))} px; scrollHeight ${String(capa.scrollHeight)}, clientHeight ${String(capa.clientHeight)})`;
    });
    anotar(`  desplazar el diálogo con el dedo: ${desplazamiento}`);
    const cajaContinuar = await prueba('cobro-continuar').boundingBox();
    const cajaTeclado = await prueba('teclado-en-pantalla').boundingBox();
    anotar(`  con el teclado abierto: botón «continuar» y=${String(cajaContinuar?.y)} alto=${String(cajaContinuar?.height)}; teclado y=${String(cajaTeclado?.y)}`);
    await capturar('A3-cobro-con-teclado');
    comprobar(
      'Cobro · con el teclado abierto, el botón para seguir se puede llevar por ENCIMA del teclado (el diálogo va arriba y se desplaza)',
      'borde inferior del botón < borde superior del teclado',
      `botón termina en ${String((cajaContinuar?.y ?? 0) + (cajaContinuar?.height ?? 0))}, teclado empieza en ${String(cajaTeclado?.y)}`,
      cajaContinuar !== null && cajaTeclado !== null && cajaContinuar.y + cajaContinuar.height < cajaTeclado.y,
    );
    await prueba('tp-listo').click();
    await prueba('descuento-ninguno').click();
    await prueba('cobro-continuar').click();
    await prueba('pago-tarjeta').click();
    await tocarYEscribir({ campo: 'pago-boleta', nombre: '#5 Cobro · número de boleta', disposicion: 'texto', teclas: ['a', '1', '2'], esperado: 'a12', yaAbierto: true });
    // En el paso de pago, «cancelar» vuelve al descuento; el segundo cancela.
    await prueba('cobro-cancelar').click();
    await prueba('cobro-cancelar').click();
    await prueba('dialogo-de-cobro').waitFor({ state: 'detached', timeout: ESPERA_CORTA });
    await volver();

    // =======================================================================
    // C4 y D. El botón, y el candado de intentos
    // =======================================================================
    anotar('--- C4 y D. el botón de la barra de estado, y el candado de intentos ---');
    const antesBoton = solicitudesEnElLog('boton_de_interfaz');
    await prueba('boton-salida').click();
    await exigirDialogoYAppViva('C4 · botón de la barra de estado', 'boton_de_interfaz', antesBoton);

    const tocarPinDeSalida = async (pin) => {
      for (const digito of pin) {
        await enSalida(`tecla-${digito}`).click();
      }
      await enSalida('tecla-confirmar').click();
      await ventana.waitForFunction(
        () => document.querySelectorAll('[data-prueba="dialogo-salida"] .teclado__punto--lleno').length === 0 ||
          document.querySelector('[data-prueba="dialogo-salida"]') === null,
        undefined,
        { timeout: ESPERA_CORTA },
      );
      await esperar(300);
    };
    const mensajes = [];
    for (const [numero, pin] of [[1, '1111'], [2, '2222'], [3, '3333']]) {
      await tocarPinDeSalida(pin);
      const mensaje = ((await prueba('mensaje-de-salida').textContent()) ?? '').trim();
      const fila = leerBase("SELECT intentos_fallidos, bloqueado_hasta FROM bloqueos_de_autorizacion WHERE superficie = 'salida_controlada'");
      anotar(`  intento ${String(numero)} con ${pin}: mensaje=${JSON.stringify(mensaje)} bloqueos_de_autorizacion=${JSON.stringify(fila)} proceso vivo=${String(codigoDeSalida === null)}`);
      mensajes.push({ mensaje, fila: fila[0] ?? null });
    }
    comprobar(
      'D · tres PIN equivocados, tecleados en pantalla: la superficie queda BLOQUEADA y la app sigue abierta',
      'intentos 1 y 2 sin bloqueo; el 3.º deja bloqueado_hasta; proceso vivo',
      mensajes.map((m) => `${JSON.stringify(m.mensaje)} ${JSON.stringify(m.fila)}`).join(' / '),
      mensajes[0].fila?.bloqueado_hasta === null &&
        mensajes[1].fila?.bloqueado_hasta === null &&
        typeof mensajes[2].fila?.bloqueado_hasta === 'string' &&
        codigoDeSalida === null,
    );
    await capturar('D1-bloqueada');

    await tocarPinDeSalida(PIN);
    const mensajeBloqueado = ((await prueba('mensaje-de-salida').textContent()) ?? '').trim();
    await esperar(1000);
    anotar(`  PIN CORRECTO durante el bloqueo: mensaje=${JSON.stringify(mensajeBloqueado)} proceso vivo=${String(codigoDeSalida === null)}`);
    comprobar(
      'D · el PIN CORRECTO durante el bloqueo NO cierra la aplicación',
      'proceso vivo, mensaje de bloqueo',
      `proceso ${codigoDeSalida === null ? 'vivo' : `terminó (${String(codigoDeSalida)})`}, ${JSON.stringify(mensajeBloqueado)}`,
      codigoDeSalida === null && mensajeBloqueado.length > 0,
    );

    const [{ bloqueado_hasta: hasta }] = leerBase("SELECT bloqueado_hasta FROM bloqueos_de_autorizacion WHERE superficie = 'salida_controlada'");
    const espera = Math.max(0, Date.parse(hasta) - Date.now()) + 1500;
    anotar(`  bloqueado hasta ${hasta}; se espera ${String(espera)} ms`);
    await esperar(espera);

    const asientosAntes = leerBase(
      "SELECT accion, usuario_id, valor_nuevo FROM auditoria_log WHERE accion LIKE 'salida_controlada%' OR accion = 'autorizacion_bloqueada' ORDER BY fecha, rowid",
    );
    await tocarPinDeSalida(PIN).catch(() => undefined);
    const inicio = Date.now();
    while (codigoDeSalida === null && Date.now() - inicio < 15000) {
      await esperar(100);
    }
    anotar(`  PIN correcto pasado el bloqueo: el proceso terminó con ${String(codigoDeSalida)} a los ${String(Date.now() - inicio)} ms`);
    comprobar(
      'D · pasado el bloqueo, el PIN correcto cierra la aplicación de forma ordenada',
      'código de salida 0',
      String(codigoDeSalida),
      codigoDeSalida === 0,
    );

    const asientos = leerBase(
      "SELECT accion, usuario_id, valor_nuevo FROM auditoria_log WHERE accion LIKE 'salida_controlada%' OR accion = 'autorizacion_bloqueada' ORDER BY fecha, rowid",
    );
    for (const asiento of asientos) {
      anotar(`  auditoria_log: ${asiento.accion} | usuario ${String(asiento.usuario_id)} | ${String(asiento.valor_nuevo)}`);
    }
    anotar(`  asientos antes del PIN correcto: ${String(asientosAntes.length)}; después: ${String(asientos.length)}`);
    const autorizada = asientos.filter((a) => a.accion === 'salida_controlada_autorizada');
    const rechazadas = asientos.filter((a) => a.accion === 'salida_controlada_rechazada');
    comprobar(
      'D · la auditoría registra los rechazos, el bloqueo y la salida autorizada con su origen y su vía',
      '≥4 rechazadas, 1 autorizacion_bloqueada, 1 autorizada con origen boton_de_interfaz y vía presencial',
      `${String(rechazadas.length)} rechazadas, ${String(asientos.filter((a) => a.accion === 'autorizacion_bloqueada').length)} bloqueo(s), ${String(autorizada.length)} autorizada(s): ${autorizada.map((a) => a.valor_nuevo).join(' ')}`,
      rechazadas.length >= 4 &&
        asientos.filter((a) => a.accion === 'autorizacion_bloqueada').length === 1 &&
        autorizada.length === 1 &&
        autorizada[0].valor_nuevo.includes('boton_de_interfaz') &&
        autorizada[0].valor_nuevo.includes('presencial'),
    );
    const lineasDelKiosko = salidaDelProceso.split('\n').filter((l) => l.includes('[kiosko]'));
    anotar('  líneas [kiosko] del proceso principal, crudas:');
    for (const linea of lineasDelKiosko) {
      anotar(`    ${linea}`);
    }
  } catch (error) {
    comprobar('el recorrido terminó sin error', 'sin excepción', String(error?.stack ?? error), false);
    await capturar('error').catch(() => undefined);
  } finally {
    // NO `app.close()`: esa vía pasa por la intercepción del cierre, pide el
    // PIN y deja colgado al guion. Se mide así la primera vez, sin quererlo.
    if (codigoDeSalida === null) {
      proceso.kill('SIGKILL');
    }
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info('');
  console.info(`carpeta de la corrida (capturas y base): ${datos}`);
  console.info(`${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
  process.exit(fallidas.length === 0 ? 0 : 1);
}

void main();
