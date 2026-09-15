/**
 * verificacion-de-impresora.cjs — La pantalla «Impresora de recibos», manejando
 * la aplicación REAL (CLAUDE.md §4.43).
 *
 * EN ESTA MAC NO HAY WINDOWS NI UNA TÉRMICA. El arnés arranca la aplicación con
 * `POS_IMPRESORAS_SIMULADAS=<carpeta>`: el proceso principal lista dos
 * impresoras simuladas y el ticket se escribe como archivo en esa carpeta, para
 * leer los bytes ESC/POS. La variable solo se mira con la aplicación sin
 * empaquetar. Lo que este arnés NO puede contestar: si el ticket sale legible
 * en la impresora de Jimmy, y si PowerShell corre en su Windows.
 *
 * El recorrido:
 *   1. El estado dice «Sin impresora configurada…», no «NullPrinterProvider».
 *   2. «Imprimir recibo de prueba» sin elegir nada falla con un mensaje.
 *   3. La impresora desconectada: error visible, sin las tres preguntas.
 *   4. La que recibe: aparecen las tres preguntas; se contesta «símbolos raros»
 *      y queda guardado en impresora.json como señal.
 *   5. Guardar: impresora.json dice el nombre.
 *   6. REINICIO de la aplicación: la impresora sigue configurada.
 *   7. Una venta imprime por la impresora y genera el PDF.
 *   8. Quitar: vuelve a «solo PDF», y una venta nueva genera el PDF sin imprimir.
 *
 * Salida: cada comprobación con lo esperado y lo real, y código 1 si alguna falla.
 */

const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const rutaDeElectron = require('electron');

const PROYECTO = join(__dirname, '..');
const PIN = '2468';
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;
const RECIBE = 'Termica-simulada';
const DESCONECTADA = 'Termica-simulada-desconectada';

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

async function lanzar(datos, simuladas) {
  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
    env: { ...process.env, POS_IMPRESORAS_SIMULADAS: simuladas },
  });
  await app.evaluate(async ({ BrowserWindow }) => {
    const [ventana] = BrowserWindow.getAllWindows();
    if (ventana) {
      ventana.setFullScreen(false);
      ventana.setSize(1100, 900);
    }
  });
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  // macOS anima la salida de pantalla completa: una captura en medio sale en
  // mosaico. Se espera a que la ventana ya no esté en pantalla completa.
  for (let intento = 0; intento < 50; intento += 1) {
    const enPantallaCompleta = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false);
    if (!enPantallaCompleta) break;
    await new Promise((resolver) => { setTimeout(resolver, 100); });
  }
  await new Promise((resolver) => { setTimeout(resolver, 800); });
  return { app, ventana };
}

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-impresora-'));
  const simuladas = join(datos, 'impresoras-simuladas');
  const capturas = join(datos, 'capturas');
  mkdirSync(simuladas);
  mkdirSync(capturas);
  const archivoDeImpresora = join(datos, 'impresora.json');
  const archivoDelTicket = join(simuladas, `${RECIBE}.bin`);
  const leerImpresoraJson = () => (existsSync(archivoDeImpresora) ? readFileSync(archivoDeImpresora, 'utf8') : '(no existe)');

  let { app, ventana } = await lanzar(datos, simuladas);
  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const texto = async (nombre) => ((await prueba(nombre).first().textContent()) ?? '').trim();
  const capturar = async (nombre) => {
    const ruta = join(capturas, `${nombre}.png`);
    await ventana.screenshot({ path: ruta, fullPage: true });
    anotar(`captura: ${ruta}`);
  };
  const teclearPin = async (pin) => {
    for (const digito of pin) {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('tecla-confirmar').click();
  };
  const opcion = (nombre) => ventana.locator(`[data-prueba="impresora-opcion"][data-nombre="${nombre}"]`);
  const irAImpresora = async () => {
    await prueba('ir-a-impresora').click();
    await prueba('impresora-descripcion').waitFor({ timeout: ESPERA_CORTA });
    await opcion(RECIBE).waitFor({ timeout: ESPERA_CORTA });
  };
  /** Una venta de 1 unidad por el canal real, con la caja ya abierta. */
  const vender = async (productoId) =>
    ventana.evaluate(
      async (id) =>
        window.pos.venta.cobrar({ lineas: [{ productoId: id, cantidad: '1' }], descuento: null, formaPago: 'efectivo', numBoleta: null }),
      productoId,
    );

  try {
    // ---- Preparación -----------------------------------------------------
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Jimmy de verificación');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN);
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });

    // ---- 1. Estado inicial ------------------------------------------------
    await irAImpresora();
    const descripcionInicial = await texto('impresora-descripcion');
    comprobar(
      'SIN IMPRESORA el estado lo dice con palabras, sin nombres de clases',
      'Sin impresora configurada — los recibos solo se generan en PDF',
      descripcionInicial,
      descripcionInicial === 'Sin impresora configurada — los recibos solo se generan en PDF',
    );
    const textoDeLaPantalla = (await prueba('pantalla-de-impresora').textContent()) ?? '';
    comprobar(
      'la pantalla no muestra «NullPrinterProvider» en ningún lado',
      'sin «Provider»',
      textoDeLaPantalla.includes('Provider') ? 'aparece «Provider»' : 'sin «Provider»',
      !textoDeLaPantalla.includes('Provider'),
    );
    const opciones = await ventana.locator('[data-prueba="impresora-opcion"]').evaluateAll((n) => n.map((e) => e.getAttribute('data-nombre')));
    anotar(`impresoras listadas en la pantalla: ${JSON.stringify(opciones)}`);
    comprobar('lista las dos impresoras simuladas', JSON.stringify([RECIBE, DESCONECTADA]), JSON.stringify(opciones), JSON.stringify(opciones) === JSON.stringify([RECIBE, DESCONECTADA]));
    await capturar('1-sin-impresora');

    // ---- 2. Probar sin elegir --------------------------------------------
    await prueba('impresora-probar').click();
    await prueba('impresora-error').waitFor({ timeout: ESPERA_CORTA });
    const errorSinElegir = await texto('impresora-error');
    anotar(`mensaje al probar sin elegir: ${JSON.stringify(errorSinElegir)}`);
    comprobar(
      'PROBAR SIN IMPRESORA ELEGIDA falla con un mensaje claro, y no se escribe ningún ticket',
      'mensaje «Primero elegí…»; sin archivo de ticket',
      `${errorSinElegir}; archivo de ticket: ${existsSync(archivoDelTicket) ? 'sí' : 'no'}`,
      errorSinElegir.startsWith('Primero elegí una impresora') && !existsSync(archivoDelTicket),
    );

    // ---- 3. La desconectada ------------------------------------------------
    await opcion(DESCONECTADA).click();
    await prueba('impresora-probar').click();
    await prueba('impresora-resultado').waitFor({ timeout: ESPERA_LARGA });
    const claseDesconectada = await prueba('impresora-resultado').getAttribute('data-clase');
    const tituloDesconectada = await texto('impresora-resultado-titulo');
    const mensajeDesconectada = await texto('impresora-resultado-mensaje');
    anotar(`resultado de la desconectada: clase=${String(claseDesconectada)} titulo=${JSON.stringify(tituloDesconectada)} mensaje=${JSON.stringify(mensajeDesconectada)}`);
    comprobar(
      'la DESCONECTADA muestra el problema y NO pregunta cómo salió',
      'trabajo_con_error; sin preguntas',
      `${String(claseDesconectada)}; preguntas: ${String(await prueba('impresora-confirmacion').count())}`,
      claseDesconectada === 'trabajo_con_error' && (await prueba('impresora-confirmacion').count()) === 0,
    );
    await capturar('3-desconectada');

    // ---- 4. La que recibe, y la confirmación «ilegible» ---------------------
    await opcion(RECIBE).click();
    await prueba('impresora-probar').click();
    await prueba('impresora-confirmacion').waitFor({ timeout: ESPERA_LARGA });
    const tituloEnviado = await texto('impresora-resultado-titulo');
    const botones = [
      await texto('impresora-confirmar-bien'),
      await texto('impresora-confirmar-ilegible'),
      await texto('impresora-confirmar-nada'),
    ];
    anotar(`resultado de la que recibe: ${JSON.stringify(tituloEnviado)}; botones: ${JSON.stringify(botones)}`);
    comprobar(
      'la que RECIBE dice «Ticket de prueba enviado» y ofrece las tres respuestas',
      'Ticket de prueba enviado; Sí, salió bien / Salió con símbolos raros o sin cortar / No salió nada',
      `${tituloEnviado}; ${botones.join(' / ')}`,
      tituloEnviado === 'Ticket de prueba enviado' &&
        botones.join('|') === 'Sí, salió bien|Salió con símbolos raros o sin cortar|No salió nada',
    );
    const bytes = existsSync(archivoDelTicket) ? readFileSync(archivoDelTicket) : Buffer.alloc(0);
    anotar(`bytes del ticket de prueba (${String(bytes.length)}): primeros 8 = ${bytes.subarray(0, 8).toString('hex')}; últimos 8 = ${bytes.subarray(-8).toString('hex')}`);
    anotar(`texto del ticket (latin1): ${JSON.stringify(bytes.toString('latin1').replace(/[\x00-\x09\x0b-\x1f]/g, '·'))}`);
    comprobar(
      'los bytes son ESC/POS: empiezan con ESC @ (1b40) y terminan con el corte parcial (1d564200)',
      'inicio 1b40; fin 1d564200',
      `inicio ${bytes.subarray(0, 2).toString('hex')}; fin ${bytes.subarray(-4).toString('hex')}`,
      bytes.subarray(0, 2).toString('hex') === '1b40' && bytes.subarray(-4).toString('hex') === '1d564200',
    );
    await capturar('4-enviado-con-preguntas');

    await prueba('impresora-confirmar-ilegible').click();
    await prueba('impresora-aviso').waitFor({ timeout: ESPERA_CORTA });
    const avisoIlegible = await texto('impresora-aviso');
    anotar(`aviso tras «símbolos raros»: ${JSON.stringify(avisoIlegible)}`);
    anotar(`impresora.json tras confirmar: ${leerImpresoraJson()}`);
    const jsonTrasConfirmar = existsSync(archivoDeImpresora) ? JSON.parse(readFileSync(archivoDeImpresora, 'utf8')) : {};
    comprobar(
      '«SÍMBOLOS RAROS» queda en impresora.json como envío exitoso + confirmación «ilegible», y el aviso dice que no es conexión',
      'envio=enviado; confirmacion=ilegible; aviso con «no es un problema de conexión»',
      `envio=${String(jsonTrasConfirmar.ultimaPrueba?.envio)}; confirmacion=${String(jsonTrasConfirmar.ultimaPrueba?.confirmacion)}; aviso=${avisoIlegible.slice(0, 80)}`,
      jsonTrasConfirmar.ultimaPrueba?.envio === 'enviado' &&
        jsonTrasConfirmar.ultimaPrueba?.confirmacion === 'ilegible' &&
        avisoIlegible.includes('no es un problema de conexión'),
    );
    const bitacora = existsSync(join(datos, 'log-tecnico.log')) ? readFileSync(join(datos, 'log-tecnico.log'), 'utf8') : '';
    const lineasDeImpresion = bitacora.split('\n').filter((l) => l.includes('[impresion]'));
    for (const linea of lineasDeImpresion) {
      anotar(`log-tecnico: ${linea}`);
    }
    comprobar(
      'la bitácora técnica anota la SEÑAL de compatibilidad ESC/POS',
      'una línea con «SEÑAL»',
      String(lineasDeImpresion.filter((l) => l.includes('SEÑAL')).length),
      lineasDeImpresion.some((l) => l.includes('SEÑAL: el modelo podría no ser compatible')),
    );
    await capturar('4b-confirmado-ilegible');

    // ---- 5. Guardar -------------------------------------------------------
    await prueba('impresora-guardar').click();
    await ventana.locator('[data-prueba="impresora-descripcion"]', { hasText: `Impresora configurada: ${RECIBE}` }).waitFor({ timeout: ESPERA_CORTA });
    anotar(`impresora.json tras guardar: ${leerImpresoraJson()}`);
    const jsonGuardado = JSON.parse(readFileSync(archivoDeImpresora, 'utf8'));
    comprobar(
      'GUARDAR escribe el NOMBRE en impresora.json, con la clave «impresora» y sin «dispositivo»',
      `impresora=${RECIBE}; sin dispositivo`,
      `impresora=${String(jsonGuardado.impresora)}; dispositivo=${String(jsonGuardado.dispositivo)}`,
      jsonGuardado.impresora === RECIBE && jsonGuardado.dispositivo === undefined,
    );
    await capturar('5-guardada');

    // ---- 6. Reinicio --------------------------------------------------------
    app.process().kill('SIGKILL');
    await new Promise((resolver) => { setTimeout(resolver, 1000); });
    ({ app, ventana } = await lanzar(datos, simuladas));
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_LARGA });
    await prueba('usuario-para-ingreso').filter({ hasText: 'Jimmy de verificación' }).click();
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    const panel = (await prueba('pantalla-de-sesion').textContent()) ?? '';
    anotar(`panel de verificación tras reiniciar contiene «Impresora configurada: ${RECIBE}»: ${String(panel.includes(`Impresora configurada: ${RECIBE}`))}`);
    await irAImpresora();
    const descripcionTrasReiniciar = await texto('impresora-descripcion');
    const marcada = await opcion(RECIBE).getAttribute('aria-checked');
    comprobar(
      'TRAS REINICIAR la aplicación la impresora sigue configurada y marcada en la lista',
      `Impresora configurada: ${RECIBE}; marcada=true`,
      `${descripcionTrasReiniciar}; marcada=${String(marcada)}`,
      descripcionTrasReiniciar === `Impresora configurada: ${RECIBE}` && marcada === 'true',
    );
    const ultimaPrueba = await texto('impresora-ultima-prueba');
    anotar(`última prueba mostrada tras reiniciar: ${JSON.stringify(ultimaPrueba)}`);
    await capturar('6-tras-reiniciar');

    // ---- 7. Una venta imprime ------------------------------------------------
    const productoId = await ventana.evaluate(async () => {
      const categoria = await window.pos.catalogo.crearCategoria('Granos', 1);
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
    rmSync(archivoDelTicket, { force: true });
    const ventaConImpresora = await vender(productoId);
    anotar(`venta con impresora: ${JSON.stringify(ventaConImpresora.ok ? ventaConImpresora.datos.recibo : ventaConImpresora)}`);
    const reciboCon = ventaConImpresora.ok ? ventaConImpresora.datos.recibo : null;
    const bytesDelRecibo = existsSync(archivoDelTicket) ? readFileSync(archivoDelTicket) : Buffer.alloc(0);
    comprobar(
      'UNA VENTA con impresora: PDF generado, impreso=true, y los bytes del recibo llegaron a la impresora',
      'pdfGenerado=true; impreso=true; bytes > 0; PDF en disco',
      `pdfGenerado=${String(reciboCon?.pdfGenerado)}; impreso=${String(reciboCon?.impreso)}; bytes=${String(bytesDelRecibo.length)}; PDF=${String(reciboCon !== null && existsSync(reciboCon.rutaPdf))}`,
      reciboCon?.pdfGenerado === true && reciboCon.impreso === true && bytesDelRecibo.length > 0 && existsSync(reciboCon.rutaPdf),
    );

    // ---- 8. Quitar y vender otra vez -----------------------------------------
    await prueba('impresora-quitar').click();
    await ventana.locator('[data-prueba="impresora-descripcion"]', { hasText: 'Sin impresora configurada' }).waitFor({ timeout: ESPERA_CORTA });
    const descripcionTrasQuitar = await texto('impresora-descripcion');
    anotar(`impresora.json tras quitar: ${leerImpresoraJson()}`);
    const jsonTrasQuitar = JSON.parse(readFileSync(archivoDeImpresora, 'utf8'));
    comprobar(
      'QUITAR vuelve a «solo PDF»: el texto lo dice e impresora.json ya no tiene impresora (conserva la última prueba)',
      'Sin impresora configurada — los recibos solo se generan en PDF; sin clave impresora; ultimaPrueba presente',
      `${descripcionTrasQuitar}; impresora=${String(jsonTrasQuitar.impresora)}; ultimaPrueba=${jsonTrasQuitar.ultimaPrueba ? 'presente' : 'ausente'}`,
      descripcionTrasQuitar === 'Sin impresora configurada — los recibos solo se generan en PDF' &&
        jsonTrasQuitar.impresora === undefined &&
        jsonTrasQuitar.ultimaPrueba !== undefined,
    );
    await capturar('8-quitada');

    rmSync(archivoDelTicket, { force: true });
    const ventaSinImpresora = await vender(productoId);
    anotar(`venta sin impresora: ${JSON.stringify(ventaSinImpresora.ok ? ventaSinImpresora.datos.recibo : ventaSinImpresora)}`);
    const reciboSin = ventaSinImpresora.ok ? ventaSinImpresora.datos.recibo : null;
    comprobar(
      'UNA VENTA DESPUÉS DE QUITAR: el recibo se emite con su PDF, impreso=false, y NO se manda nada a la impresora',
      `pdfGenerado=true; impreso=false; número ${String((reciboCon?.numeroRecibo ?? 0) + 1)}; sin archivo de ticket; PDF en disco`,
      `pdfGenerado=${String(reciboSin?.pdfGenerado)}; impreso=${String(reciboSin?.impreso)}; número ${String(reciboSin?.numeroRecibo)}; ` +
        `ticket=${existsSync(archivoDelTicket) ? 'sí' : 'no'}; PDF=${String(reciboSin !== null && existsSync(reciboSin.rutaPdf) && statSync(reciboSin.rutaPdf).size > 0)}`,
      reciboSin?.pdfGenerado === true &&
        reciboSin.impreso === false &&
        reciboSin.numeroRecibo === (reciboCon?.numeroRecibo ?? 0) + 1 &&
        !existsSync(archivoDelTicket) &&
        existsSync(reciboSin.rutaPdf),
    );
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
    await ventana.screenshot({ path: join(capturas, 'error.png') }).catch(() => undefined);
  } finally {
    app.process().kill('SIGKILL');
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(`\n${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
  console.info(`Carpeta de la corrida (capturas, impresora.json, log-tecnico.log): ${datos}`);
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verificacion-de-impresora] Falló antes de poder comprobar nada: ${error.message}`);
  process.exit(1);
});
