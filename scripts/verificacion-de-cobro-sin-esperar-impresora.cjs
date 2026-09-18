/**
 * verificacion-de-cobro-sin-esperar-impresora.cjs — «Venta registrada» NO
 * espera a la impresora (CLAUDE.md §4.64), manejando la aplicación REAL.
 *
 * EL HALLAZGO DE LA TIENDA: en el i3, tocar «Cobrar» tardaba 5 a 10 segundos.
 * El canal de cobro esperaba el envío a la térmica, y cada envío lanza un
 * `powershell.exe` nuevo que compila su puente a `winspool` (Add-Type) y
 * además espera 1,5 s fijos para leer el estado del trabajo.
 *
 * CÓMO SE IMITA ACÁ: la impresora simulada «Termica-simulada» con
 * `POS_IMPRESORAS_SIMULADAS_DEMORA_MS` tarda lo que se le diga en contestar.
 * Esta Mac no tiene PowerShell: la demora es un número elegido, no una medición
 * del i3. Lo que se comprueba es el MECANISMO: que la confirmación no depende
 * de cuánto tarde la impresora.
 *
 * Qué comprueba, a 1024×768 exactos (la pantalla de la tienda), tocando la
 * pantalla como una cajera:
 *   1. Con una impresora que tarda 6 s, «Venta registrada» aparece mucho antes,
 *      con el renglón del papel en «Enviando…» y sin que el ticket haya llegado.
 *   2. El PDF ya está en el disco en ese momento.
 *   3. Cuando la impresora termina, el renglón pasa solo a «Se imprimió.», los
 *      bytes llegaron y la fila del recibo dice impreso.
 *   4. Con una impresora que reporta un problema, la cajera que ya tocó
 *      «Siguiente venta» igual ve el aviso en la pantalla de venta.
 *   5. Nada de la impresión escribió en auditoria_log.
 *
 * Salida: cada comprobación con lo esperado y lo real, con las horas; código 1
 * si alguna falla.
 */

const { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const rutaDeElectron = require('electron');
const DatabaseConstructor = require('better-sqlite3');
const { terminarAplicacion } = require('./terminar-aplicacion.cjs');

const PROYECTO = join(__dirname, '..');
const PIN = '2468';
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;
const RECIBE = 'Termica-simulada';
const DESCONECTADA = 'Termica-simulada-desconectada';
/** Lo que tarda la impresora simulada. Elegido, no medido: ver la cabecera. */
const DEMORA_DE_LA_IMPRESORA_MS = 6000;
const ANCHO = 1024;
const ALTO = 768;

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

const espera = (ms) =>
  new Promise((resolver) => {
    setTimeout(resolver, ms);
  });

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-cobro-impresora-'));
  const simuladas = join(datos, 'impresoras-simuladas');
  const capturas = join(datos, 'capturas');
  mkdirSync(simuladas);
  mkdirSync(capturas);
  const archivoDeImpresora = join(datos, 'impresora.json');
  const archivoDelTicket = join(simuladas, `${RECIBE}.bin`);
  const rutaDeLaBase = join(datos, 'pos-agricola.db');
  // La impresora se deja configurada ANTES de arrancar, como en la tienda.
  writeFileSync(archivoDeImpresora, JSON.stringify({ impresora: RECIBE }));

  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
    env: {
      ...process.env,
      POS_IMPRESORAS_SIMULADAS: simuladas,
      POS_IMPRESORAS_SIMULADAS_DEMORA_MS: String(DEMORA_DE_LA_IMPRESORA_MS),
    },
  });
  const procesoDeLaAplicacion = app.process();
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  const cdp = await ventana.context().newCDPSession(ventana);

  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const texto = async (nombre) => ((await prueba(nombre).first().textContent()) ?? '').trim();
  const capturar = async (nombre) => {
    const ruta = join(capturas, `${nombre}.png`);
    await ventana.screenshot({ path: ruta });
    anotar(`captura: ${ruta}`);
  };
  const teclearPin = async (pin) => {
    for (const digito of pin) {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('tecla-confirmar').click();
  };
  const leerBase = (consulta, ...parametros) => {
    const conexion = new DatabaseConstructor(rutaDeLaBase, { readonly: true });
    try {
      return conexion.prepare(consulta).all(...parametros);
    } finally {
      conexion.close();
    }
  };
  /** 1024×768 EXACTOS, comprobado: si no mide eso, no se mide nada (§4.62). */
  const fijarVentana = async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: ANCHO, height: ALTO, deviceScaleFactor: 1, mobile: false });
    await espera(500);
    const real = await ventana.evaluate(() => [innerWidth, innerHeight]);
    if (real[0] !== ANCHO || real[1] !== ALTO) {
      throw new Error(`la ventana mide ${real.join('×')} y se pidió ${String(ANCHO)}×${String(ALTO)}: no se mide`);
    }
    anotar(`ventana fijada en ${real.join('×')}`);
  };
  /** Cobra el ticket con clics y devuelve cuánto tardó en verse «Venta registrada». */
  const cobrarConClics = async (productoId) => {
    await ventana.locator(`[data-prueba="icono-producto"][data-producto="${productoId}"]`).click();
    await prueba('cobrar').click();
    await prueba('cobro-continuar').click();
    const t0 = Date.now();
    await prueba('cobro-confirmar').click();
    await prueba('cobro-listo').waitFor({ timeout: ESPERA_LARGA });
    const t1 = Date.now();
    return { t0, t1 };
  };
  const estadoDelPapel = async () => prueba('cobro-estado-del-recibo').getAttribute('data-estado');

  try {
    // ---- Preparación --------------------------------------------------------
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Jimmy de verificación');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN);
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    const productoId = await ventana.evaluate(async () => {
      const categoria = await window.pos.catalogo.crearCategoria('Granos');
      if (!categoria.ok) throw new Error(categoria.error.mensaje);
      const producto = await window.pos.catalogo.crearProducto({
        nombre: 'Frijol negro', categoriaId: categoria.datos.id, tipoMedida: 'unidad', unidadPeso: null,
        cantidadPredefinidaIcono: '1', precioBase: '9.00', precioCompra: null, fotoPath: null, inventarioInicial: '50',
      });
      if (!producto.ok) throw new Error(producto.error.mensaje);
      const caja = await window.pos.caja.abrir({ modo: 'simple', monto: '100.00' });
      if (!caja.ok) throw new Error(caja.error.mensaje);
      return producto.datos.id;
    });
    anotar(`impresora.json: ${readFileSync(archivoDeImpresora, 'utf8')}; demora de la impresora simulada: ${String(DEMORA_DE_LA_IMPRESORA_MS)} ms`);
    const asientosAntes = leerBase('SELECT accion, count(*) AS n FROM auditoria_log GROUP BY accion ORDER BY accion');
    await fijarVentana();
    await prueba('ir-a-venta').click();
    await prueba('cobrar').waitFor({ timeout: ESPERA_CORTA });
    await fijarVentana();

    // ---- 1 y 2. La venta se confirma con la impresora sin contestar ---------
    const { t0, t1 } = await cobrarConClics(productoId);
    const estadoAlConfirmar = await estadoDelPapel();
    const textoAlConfirmar = await texto('cobro-estado-del-recibo');
    const ticketAlConfirmar = existsSync(archivoDelTicket);
    const recibos = leerBase('SELECT numero_recibo, pdf_path, impreso FROM recibos ORDER BY numero_recibo');
    const pdfAbsoluto = recibos[0] ? join(datos, recibos[0].pdf_path) : '';
    const pdfAlConfirmar = pdfAbsoluto !== '' && existsSync(pdfAbsoluto) ? statSync(pdfAbsoluto).size : 0;
    anotar(`clic en «Confirmar cobro» → «Venta registrada» visible: ${String(t1 - t0)} ms`);
    anotar(`renglón del papel al confirmar: data-estado=${String(estadoAlConfirmar)} texto=${JSON.stringify(textoAlConfirmar)}`);
    anotar(`al confirmar: ticket en la impresora=${ticketAlConfirmar ? 'sí' : 'no'}; recibos=${JSON.stringify(recibos)}; PDF=${String(pdfAlConfirmar)} bytes`);
    await capturar('1-venta-registrada-enviando');
    comprobar(
      '«VENTA REGISTRADA» aparece ANTES de que la impresora conteste',
      `menos de ${String(DEMORA_DE_LA_IMPRESORA_MS)} ms y el ticket todavía sin llegar`,
      `${String(t1 - t0)} ms; ticket=${ticketAlConfirmar ? 'llegó' : 'no llegó'}`,
      t1 - t0 < DEMORA_DE_LA_IMPRESORA_MS && !ticketAlConfirmar,
    );
    comprobar(
      'el renglón del papel dice que se está enviando',
      'data-estado=enviando; «Enviando el recibo a la impresora…»',
      `data-estado=${String(estadoAlConfirmar)}; ${textoAlConfirmar}`,
      estadoAlConfirmar === 'enviando' && textoAlConfirmar.includes('Enviando el recibo a la impresora'),
    );
    comprobar(
      'EL PDF YA ESTÁ EN EL DISCO cuando se confirma la venta',
      '1 recibo, PDF con bytes, impreso=0',
      `${String(recibos.length)} recibo(s), PDF=${String(pdfAlConfirmar)} bytes, impreso=${String(recibos[0]?.impreso)}`,
      recibos.length === 1 && pdfAlConfirmar > 0 && recibos[0].impreso === 0,
    );

    // ---- 3. La impresora termina sola --------------------------------------
    await ventana
      .locator('[data-prueba="cobro-estado-del-recibo"][data-estado="impreso"]')
      .waitFor({ timeout: DEMORA_DE_LA_IMPRESORA_MS + ESPERA_CORTA });
    const t2 = Date.now();
    const textoImpreso = await texto('cobro-estado-del-recibo');
    const bytes = existsSync(archivoDelTicket) ? readFileSync(archivoDelTicket).length : 0;
    const impresoEnLaBase = leerBase('SELECT impreso FROM recibos WHERE numero_recibo = 1')[0]?.impreso;
    anotar(`clic → «Se imprimió.»: ${String(t2 - t0)} ms; texto=${JSON.stringify(textoImpreso)}; bytes del ticket=${String(bytes)}; impreso en la base=${String(impresoEnLaBase)}`);
    await capturar('2-se-imprimio');
    comprobar(
      'CUANDO LA IMPRESORA TERMINA, el renglón pasa solo a «Se imprimió.»',
      `después de ${String(DEMORA_DE_LA_IMPRESORA_MS)} ms; bytes > 0; impreso=1`,
      `${String(t2 - t0)} ms; bytes=${String(bytes)}; impreso=${String(impresoEnLaBase)}`,
      t2 - t0 >= DEMORA_DE_LA_IMPRESORA_MS && textoImpreso.includes('Se imprimió.') && bytes > 0 && impresoEnLaBase === 1,
    );

    // ---- 4. Una impresora con problema, con la cajera ya en la siguiente ----
    await prueba('cobro-siguiente-venta').click();
    writeFileSync(archivoDeImpresora, JSON.stringify({ impresora: DESCONECTADA }));
    const segunda = await cobrarConClics(productoId);
    anotar(`segunda venta (impresora que reporta Offline): clic → «Venta registrada» ${String(segunda.t1 - segunda.t0)} ms`);
    await prueba('cobro-siguiente-venta').click();
    const avisoAntes = await prueba('venta-papel-del-recibo').count();
    await prueba('venta-papel-del-recibo').waitFor({ timeout: DEMORA_DE_LA_IMPRESORA_MS + ESPERA_CORTA });
    const t3 = Date.now();
    const aviso = await texto('venta-papel-del-recibo');
    anotar(`aviso en la pantalla de venta a los ${String(t3 - segunda.t0)} ms del clic: ${JSON.stringify(aviso)}`);
    await capturar('3-aviso-despues-de-seguir');
    comprobar(
      'la segunda venta también se confirma sin esperar',
      `menos de ${String(DEMORA_DE_LA_IMPRESORA_MS)} ms`,
      `${String(segunda.t1 - segunda.t0)} ms`,
      segunda.t1 - segunda.t0 < DEMORA_DE_LA_IMPRESORA_MS,
    );
    comprobar(
      'CON LA CAJERA YA EN LA SIGUIENTE VENTA, el papel que no salió se avisa igual',
      'sin aviso al tocar «Siguiente venta»; después «Recibo No. 2: …»',
      `aviso al seguir=${String(avisoAntes)}; después: ${aviso}`,
      avisoAntes === 0 && aviso.startsWith('Recibo No. 2:'),
    );

    // ---- 5. auditoria_log -------------------------------------------------
    const asientosDespues = leerBase('SELECT accion, count(*) AS n FROM auditoria_log GROUP BY accion ORDER BY accion');
    const deImpresion = leerBase("SELECT count(*) AS n FROM auditoria_log WHERE accion LIKE '%impres%'")[0].n;
    const log = existsSync(join(datos, 'log-tecnico.log')) ? readFileSync(join(datos, 'log-tecnico.log'), 'utf8') : '';
    const lineasDeImpresion = log.split('\n').filter((linea) => linea.includes('[impresion]'));
    anotar(`auditoria_log antes: ${JSON.stringify(asientosAntes)}`);
    anotar(`auditoria_log después: ${JSON.stringify(asientosDespues)}`);
    for (const linea of lineasDeImpresion) {
      anotar(`log-tecnico: ${linea}`);
    }
    comprobar(
      'NADA DE LA IMPRESIÓN escribió en auditoria_log (solo las dos ventas)',
      '0 asientos de impresión',
      `${String(deImpresion)} asientos de impresión`,
      deImpresion === 0,
    );
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
    await ventana.screenshot({ path: join(capturas, 'error.png') }).catch(() => undefined);
  } finally {
    terminarAplicacion(procesoDeLaAplicacion);
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(`\n${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
  console.info(`Carpeta de la corrida (capturas, impresora.json, log-tecnico.log): ${datos}`);
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verificacion-de-cobro-sin-esperar-impresora] Falló antes de poder comprobar nada: ${String(error?.message ?? error)}`);
  process.exit(1);
});
