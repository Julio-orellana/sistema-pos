/**
 * verificacion-de-caja-y-teclado.cjs — Lo que Jimmy encontró en el equipo real,
 * comprobado manejando la aplicación REAL (CLAUDE.md §4.39).
 *
 * Cinco cosas, en el orden del pedido:
 *
 *   1. El teclado en pantalla aparece donde faltaba: el alfanumérico en los
 *      formularios de categorías y productos, y el numérico al contar el
 *      efectivo (modo simple y modo por denominación).
 *   2. Con la caja abierta se ve el efectivo teórico, y se actualiza solo.
 *   3. El cierre termina en una confirmación con los tres montos.
 *   4. EL ESCENARIO DE JIMMY: contar de menos, ver la diferencia, volver y
 *      corregir a un número que cuadra. Tiene que pedir el PIN de un
 *      administrador, y en la base tienen que quedar LOS DOS conteos.
 *   5. El margen del reporte por producto: con costo, el número; sin costo,
 *      «sin dato».
 *
 * Y lo que se agregó el mismo día (§4.40):
 *
 *   6. EL ESCENARIO DEL ADMINISTRATIVO: ve el teórico en el resumen de la caja,
 *      pero al pasar a CONTAR para cerrar el teórico no está en la pantalla.
 *   7. Un usuario de VENTA no ve el teórico ni en la pantalla ni llamando al
 *      canal desde la consola (`window.pos.caja.estado()`,
 *      `window.pos.venta.estado()`), y lo ve recién en la confirmación.
 *   8. El margen usa la FOTO del costo de cada venta: cambiar el precio de
 *      compra después no mueve el margen de una venta ya hecha.
 *   9. La cajera que cuenta de menos ve que hace falta autorización, y NO el
 *      esperado; al recontar el número exacto ve el mismo diálogo.
 *  10. LA CAJA AJENA (2026-09-15): la abre la cajera, la cierra un
 *      administrador distinto; el aviso lo dice y el botón abre el diálogo.
 *  11. La salida controlada acepta el PIN REMOTO de un administrador, y el
 *      asiento lo registra como «remoto». Va al final: cierra la aplicación.
 *
 * Por qué es un guion aparte y no más pasos de `verify:pantallas`: aquel
 * recorre la tienda entera y tarda; este existe para mostrar, con capturas y
 * con la base leída al final, el escenario puntual que se pidió ver.
 *
 * Igual que `verify:pantallas`: carpeta de datos TEMPORAL, compilación SIN
 * proyecto de nube, `playwright-core` en modo Electron. Las capturas quedan en
 * la carpeta que imprime al final (no se borra: es la evidencia).
 *
 * Salida: cada comprobación con lo esperado y lo real, y código 1 si alguna falla.
 */

const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

const PROYECTO = join(__dirname, '..');
const PIN = '2468';
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;

const comprobaciones = [];

/** Anota una comprobación, con la hora, para que el informe se pueda auditar. */
function comprobar(nombre, esperado, real, paso) {
  comprobaciones.push({ nombre, esperado, real, paso });
  console.info(`${new Date().toISOString()}  ${paso ? 'OK   ' : 'FALLA'} ${nombre}`);
  if (!paso) {
    console.info(`           esperado: ${String(esperado)}`);
    console.info(`           real    : ${String(real)}`);
  }
}

/** Anota un hecho medido que no es una comprobación: la salida cruda. */
function anotar(texto) {
  console.info(`${new Date().toISOString()}  ${texto}`);
}

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-caja-'));
  const capturas = join(datos, 'capturas');
  mkdirSync(capturas);
  const rutaDeLaBase = join(datos, 'pos-agricola.db');

  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
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
  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const texto = async (nombre) => ((await prueba(nombre).first().textContent()) ?? '').trim();
  const capturar = async (nombre) => {
    const ruta = join(capturas, `${nombre}.png`);
    await ventana.screenshot({ path: ruta });
    anotar(`captura: ${ruta}`);
  };
  const volver = async () => {
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
  };
  const teclearPin = async (pin) => {
    for (const digito of pin) {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('tecla-confirmar').click();
  };
  /** Toca teclas del teclado en pantalla, una por una, como un dedo. */
  const tocarTeclas = async (...teclas) => {
    for (const tecla of teclas) {
      await prueba(`tp-${tecla}`).click();
    }
  };
  /** Lee la base de ESTA corrida con una conexión aparte y de solo lectura. */
  const leerBase = (consulta, ...parametros) => {
    const conexion = new DatabaseConstructor(rutaDeLaBase, { readonly: true });
    try {
      return conexion.prepare(consulta).all(...parametros);
    } finally {
      conexion.close();
    }
  };

  try {
    // ---- Preparación: el primer administrador ------------------------------
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Jimmy de verificación');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN);
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    const [{ id: idAdministrador }] = leerBase('SELECT id FROM usuarios');

    // =======================================================================
    // TAREA 1a — Teclado alfanumérico en el formulario de CATEGORÍAS
    // =======================================================================
    await prueba('ir-a-categorias').click();
    const tecladosAntes = await prueba('teclado-en-pantalla').count();
    comprobar('antes de tocar un campo, no hay teclado en pantalla', '0', String(tecladosAntes), tecladosAntes === 0);

    await prueba('categoria-nombre').click();
    await prueba('teclado-en-pantalla').waitFor({ timeout: ESPERA_CORTA });
    const disposicionDeCategoria = await prueba('teclado-en-pantalla').getAttribute('data-disposicion');
    comprobar(
      'TOCAR el nombre de la categoría abre el teclado de TEXTO',
      'texto',
      disposicionDeCategoria,
      disposicionDeCategoria === 'texto',
    );
    await tocarTeclas('g', 'r', 'a', 'n', 'o', 's');
    const nombreDeCategoria = await prueba('categoria-nombre').inputValue();
    comprobar(
      'tocando teclas se escribe el nombre en el campo (la primera, en mayúscula)',
      'Granos',
      nombreDeCategoria,
      nombreDeCategoria === 'Granos',
    );
    await capturar('1a-teclado-en-categorias');

    await prueba('categoria-orden').click();
    const disposicionDeOrden = await prueba('teclado-en-pantalla').getAttribute('data-disposicion');
    comprobar('el ORDEN abre el teclado de solo enteros', 'entero', disposicionDeOrden, disposicionDeOrden === 'entero');
    await tocarTeclas('borrar', 'borrar', '1');
    await prueba('categoria-guardar').click();
    await ventana.locator('[data-prueba="lista-de-categorias"] li').first().waitFor({ timeout: ESPERA_CORTA });
    const tecladoTrasGuardar = await prueba('teclado-en-pantalla').count();
    comprobar(
      'tocar «Guardar» cierra el teclado Y guarda (el botón no se mueve debajo del dedo)',
      'categoría guardada, 0 teclados',
      `${String(leerBase("SELECT count(*) n FROM categorias WHERE nombre = 'Granos'")[0].n)} categoría, ${String(tecladoTrasGuardar)} teclados`,
      leerBase("SELECT count(*) n FROM categorias WHERE nombre = 'Granos'")[0].n === 1 && tecladoTrasGuardar === 0,
    );
    await volver();

    // =======================================================================
    // TAREA 1b + 5 — Teclado en el formulario de PRODUCTOS, y el precio de compra
    // =======================================================================
    await prueba('ir-a-productos').click();
    await prueba('productos-nuevo').click();
    await prueba('formulario-de-producto').waitFor({ timeout: ESPERA_CORTA });

    await prueba('producto-nombre').click();
    await tocarTeclas('m', 'a', 'í', 'z', 'espacio', 'b', 'l', 'a', 'n', 'c', 'o');
    const nombreDeProducto = await prueba('producto-nombre').inputValue();
    comprobar(
      'el nombre del producto, con tilde y espacio, se escribe con el teclado en pantalla',
      'Maíz blanco',
      nombreDeProducto,
      nombreDeProducto === 'Maíz blanco',
    );

    await prueba('producto-precio').click();
    const disposicionDePrecio = await prueba('teclado-en-pantalla').getAttribute('data-disposicion');
    const letrasEnPrecio = await prueba('tp-a').count();
    comprobar(
      'el PRECIO abre el teclado decimal, sin letras',
      'decimal, 0 teclas de letra',
      `${disposicionDePrecio}, ${String(letrasEnPrecio)} teclas de letra`,
      disposicionDePrecio === 'decimal' && letrasEnPrecio === 0,
    );
    await tocarTeclas('borrar', 'borrar', 'borrar', 'borrar', '4', '.', '2', '5');

    await prueba('producto-inventario-inicial').click();
    await tocarTeclas('borrar', '1', '0', '0');

    await prueba('producto-precio-compra').click();
    await tocarTeclas('3', '.', '0', '0');
    await capturar('1b-teclado-en-productos-precio-de-compra');
    const valoresDelFormulario = {
      precio: await prueba('producto-precio').inputValue(),
      inventario: await prueba('producto-inventario-inicial').inputValue(),
      compra: await prueba('producto-precio-compra').inputValue(),
    };
    comprobar(
      'precio, inventario y precio de compra quedan escritos con el teclado',
      '4.25 / 100 / 3.00',
      `${valoresDelFormulario.precio} / ${valoresDelFormulario.inventario} / ${valoresDelFormulario.compra}`,
      valoresDelFormulario.precio === '4.25' &&
        valoresDelFormulario.inventario === '100' &&
        valoresDelFormulario.compra === '3.00',
    );
    await tocarTeclas('listo');
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });

    // Un segundo producto SIN precio de compra, para el «sin dato» del reporte.
    await prueba('productos-nuevo').click();
    await prueba('producto-nombre').fill('Frijol negro');
    await prueba('producto-precio').fill('9.00');
    await prueba('producto-inventario-inicial').fill('50');
    await prueba('producto-guardar').click();
    await ventana.getByText('Frijol negro').first().waitFor({ timeout: ESPERA_CORTA });

    const costos = leerBase('SELECT nombre, precio_base, precio_compra FROM productos ORDER BY nombre');
    anotar(`productos en la base: ${JSON.stringify(costos)}`);
    comprobar(
      'en la base: el maíz con precio_compra 3.00 y el frijol SIN costo (NULL, no 0.00)',
      'Frijol negro=null, Maíz blanco=3.00',
      costos.map((f) => `${f.nombre}=${String(f.precio_compra)}`).join(', '),
      costos.length === 2 && costos[0].precio_compra === null && costos[1].precio_compra === '3.00',
    );
    await volver();

    // =======================================================================
    // TAREA 1c + 2 — Abrir la caja con el teclado numérico; el teórico
    // =======================================================================
    await prueba('ir-a-caja').click();
    await prueba('pantalla-de-caja').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    const tecladoNumericoEnSimple = await prueba('tecla-5').count();
    comprobar(
      'el modo «Escribir el total» trae el teclado numérico en pantalla',
      '1 teclado',
      `${String(tecladoNumericoEnSimple)} teclados`,
      tecladoNumericoEnSimple === 1,
    );
    for (const digito of '500') {
      await prueba(`tecla-${digito}`).click();
    }
    const montoEnPantalla = (
      (await prueba('cantidad-ingresada').locator('.teclado__numero').textContent()) ?? ''
    ).trim();
    comprobar('el monto tecleado se ve en grande', '500', montoEnPantalla, montoEnPantalla === '500');
    await prueba('confirmar-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });

    const teoricoAlAbrir = await texto('monto-teorico');
    comprobar(
      'recién abierta, el efectivo teórico es el fondo',
      'Q500.00',
      teoricoAlAbrir,
      teoricoAlAbrir.includes('500.00'),
    );
    await volver();

    // Una venta en efectivo de verdad: 2 maíz (Q8.50) + 1 frijol (Q9.00).
    await prueba('ir-a-venta').click();
    await prueba('cuadricula-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await prueba('icono-producto').filter({ hasText: 'Maíz blanco' }).click();
    await prueba('icono-producto').filter({ hasText: 'Maíz blanco' }).click();
    await prueba('icono-producto').filter({ hasText: 'Frijol negro' }).click();
    await prueba('cobrar').click();
    await prueba('dialogo-de-cobro').waitFor({ timeout: ESPERA_CORTA });
    await prueba('cobro-continuar').click();
    await prueba('cobro-confirmar').click();
    await prueba('cobro-listo').waitFor({ timeout: ESPERA_CORTA });
    const cobrado = await texto('cobro-total-cobrado');
    anotar(`venta cobrada en la pantalla: ${cobrado}`);
    await prueba('cobro-siguiente-venta').click();
    await volver();

    await prueba('ir-a-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    const teoricoTrasVender = await texto('monto-teorico');
    const ventasEnEfectivo = await texto('ventas-en-efectivo');
    comprobar(
      'con la caja abierta, el teórico suma la venta en efectivo: 500 + 17.50',
      'Q517.50 (ventas Q17.50)',
      `${teoricoTrasVender} (ventas ${ventasEnEfectivo})`,
      teoricoTrasVender.includes('517.50') && ventasEnEfectivo.includes('17.50'),
    );

    // EN VIVO: una venta que entra mientras la pantalla de caja está abierta,
    // sin salir ni volver a entrar. Se inserta directo en la base temporal
    // con otra conexión (SQLite en WAL lo admite), como si otra pantalla
    // hubiera cobrado Q10.00.
    const [turno] = leerBase("SELECT id FROM caja_sesiones WHERE estado = 'abierta'");
    const conexion = new DatabaseConstructor(rutaDeLaBase);
    const momento = new Date().toISOString();
    try {
      conexion
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total, forma_pago,
                               estado, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '10.00', '10.00', 'efectivo', 'completada', ?, ?)`,
        )
        .run(randomUUID(), turno.id, idAdministrador, momento, momento, momento);
    } finally {
      conexion.close();
    }
    anotar('se insertó en la base una venta en efectivo de Q10.00, sin tocar la pantalla');
    const inicioDeLaEspera = Date.now();
    await ventana.waitForFunction(
      () => (document.querySelector('[data-prueba="monto-teorico"]')?.textContent ?? '').includes('527.50'),
      undefined,
      { timeout: 15000 },
    );
    const segundosHastaVerla = ((Date.now() - inicioDeLaEspera) / 1000).toFixed(1);
    comprobar(
      'EN TIEMPO REAL: el teórico se actualiza solo, sin salir de la pantalla',
      'Q527.50 en menos de 15 s',
      `${await texto('monto-teorico')} a los ${segundosHastaVerla} s`,
      true,
    );
    await capturar('2-teorico-en-vivo');

    // =======================================================================
    // §4.40 — EL ESCENARIO DEL ADMINISTRATIVO: el teórico está en el resumen,
    // y al pasar a contar para cerrar NO está.
    // =======================================================================
    anotar('--- escenario del administrativo: resumen con teórico → pantalla de conteo sin teórico ---');
    const estadoParaElAdmin = await ventana.evaluate(async () => window.pos.caja.estado());
    anotar(`window.pos.caja.estado() con la sesión del ADMINISTRATIVO: ${JSON.stringify(estadoParaElAdmin.datos.turnoAbierto)}`);
    comprobar(
      'al administrativo el canal SÍ le manda el teórico, para consultarlo durante el día',
      'montoTeorico 527.50, ventasEnEfectivo 27.50',
      `montoTeorico ${String(estadoParaElAdmin.datos.turnoAbierto.montoTeorico)}, ventasEnEfectivo ${String(estadoParaElAdmin.datos.turnoAbierto.ventasEnEfectivo)}`,
      estadoParaElAdmin.datos.turnoAbierto.montoTeorico === '527.50' &&
        estadoParaElAdmin.datos.turnoAbierto.ventasEnEfectivo === '27.50',
    );
    const filasEnElResumen = await prueba('monto-teorico').count();
    await prueba('ir-a-contar').click();
    await prueba('paso-de-conteo').waitFor({ timeout: ESPERA_CORTA });
    const cuerpoAlContar = await ventana.locator('body').innerText();
    const filasAlContar = {
      teorico: await prueba('monto-teorico').count(),
      ventas: await prueba('ventas-en-efectivo').count(),
    };
    anotar(`texto visible de la pantalla de conteo del administrativo: ${JSON.stringify(cuerpoAlContar)}`);
    comprobar(
      'EL ADMINISTRATIVO, EN LA PANTALLA DE CONTEO: ni la fila del teórico ni la de ventas, y ni «527.50» ni «teórico» en todo el texto visible',
      'resumen: 1 fila de teórico; conteo: 0 filas, sin 527.50, sin 27.50, sin «teórico»',
      `resumen: ${String(filasEnElResumen)} fila de teórico; conteo: ${String(filasAlContar.teorico)} de teórico y ${String(filasAlContar.ventas)} de ventas; ` +
        `527.50 ${cuerpoAlContar.includes('527.50') ? 'PRESENTE' : 'ausente'}, 27.50 ${cuerpoAlContar.includes('27.50') ? 'PRESENTE' : 'ausente'}, «teórico» ${/teórico/i.test(cuerpoAlContar) ? 'PRESENTE' : 'ausente'}`,
      filasEnElResumen === 1 &&
        filasAlContar.teorico === 0 &&
        filasAlContar.ventas === 0 &&
        !cuerpoAlContar.includes('527.50') &&
        !cuerpoAlContar.includes('27.50') &&
        !/teórico/i.test(cuerpoAlContar),
    );
    await capturar('6-administrativo-contando-sin-teorico');

    // =======================================================================
    // TAREA 1d — El teclado numérico en el conteo POR DENOMINACIÓN
    // =======================================================================
    await prueba('modo-detallado').click();
    await prueba('cantidad-100.00').click();
    await prueba('teclado-de-100.00').waitFor({ timeout: ESPERA_CORTA });
    await prueba('tecla-3').click();
    await capturar('1d-teclado-por-denominacion');
    await prueba('tecla-confirmar').click();
    const piezas = await texto('cantidad-100.00');
    const totalContado = await texto('total-contado');
    comprobar(
      'tocar la cantidad de una denominación abre el teclado y escribe el número de piezas',
      '3 piezas, total Q300.00',
      `${piezas} piezas, ${totalContado}`,
      piezas === '3' && totalContado.includes('300.00'),
    );
    const sellosAntesDeConfirmar = leerBase(
      "SELECT count(*) n FROM auditoria_log WHERE accion = 'conteo_de_cierre_sellado'",
    )[0].n;
    comprobar(
      'AJUSTAR el conteo antes de confirmarlo no deja ningún registro',
      '0 conteos sellados',
      `${String(sellosAntesDeConfirmar)} conteos sellados`,
      sellosAntesDeConfirmar === 0,
    );

    // =======================================================================
    // TAREA 4 — EL ESCENARIO DE JIMMY
    // =======================================================================
    anotar('--- escenario de Jimmy: teórico Q527.50; se cuenta de menos (Q500), se ve la diferencia, se corrige a Q527.50 ---');
    await prueba('modo-simple').click();
    for (const digito of '500') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('autorizacion-de-diferencia').waitFor({ timeout: ESPERA_CORTA });
    const diferenciaMostrada = await texto('diferencia');
    comprobar(
      'contar Q500 contra Q527.50 muestra la diferencia y pide autorización',
      'faltante de Q27.50',
      diferenciaMostrada,
      diferenciaMostrada.includes('27.50'),
    );
    await capturar('4a-primer-conteo-con-diferencia');
    const sellosTrasElPrimero = leerBase(
      "SELECT fecha, valor_nuevo FROM auditoria_log WHERE accion = 'conteo_de_cierre_sellado'",
    );
    anotar(`auditoria_log tras el primer conteo: ${JSON.stringify(sellosTrasElPrimero)}`);
    comprobar(
      'ese primer conteo QUEDÓ SELLADO en la bitácora en cuanto se confirmó',
      '1 asiento con montoReal 500.00 y diferencia -27.50',
      sellosTrasElPrimero.map((f) => f.valor_nuevo).join(' | '),
      sellosTrasElPrimero.length === 1 &&
        JSON.parse(sellosTrasElPrimero[0].valor_nuevo).montoReal === '500.00' &&
        JSON.parse(sellosTrasElPrimero[0].valor_nuevo).diferencia === '-27.50',
    );

    await ventana.getByRole('button', { name: 'Volver a contar' }).click();
    await prueba('aviso-de-conteo-sellado').waitFor({ timeout: ESPERA_CORTA });
    const avisoDeSello = await texto('aviso-de-conteo-sellado');
    const cuerpoAlRecontar = await ventana.locator('body').innerText();
    comprobar(
      'al volver a contar, la pantalla avisa que el conteo quedó registrado y que cambiarlo pide autorización, SIN el teórico ni la diferencia',
      'menciona Q500.00 y autorización; sin 527.50, sin 27.50, sin «faltante»; en el paso de conteo',
      `«${avisoDeSello}»; paso de conteo: ${String(await prueba('paso-de-conteo').count())}`,
      avisoDeSello.includes('500.00') &&
        /autorizaci/.test(avisoDeSello) &&
        !cuerpoAlRecontar.includes('527.50') &&
        !cuerpoAlRecontar.includes('27.50') &&
        !/faltante/i.test(cuerpoAlRecontar) &&
        (await prueba('paso-de-conteo').count()) === 1,
    );
    await capturar('4a2-volver-a-contar-sin-teorico');

    await prueba('modo-simple').click();
    for (const tecla of ['5', '2', '7', 'punto', '5', '0']) {
      await prueba(`tecla-${tecla}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('autorizacion-de-reconteo').waitFor({ timeout: ESPERA_CORTA });
    const primeroMostrado = await texto('reconteo-primer-conteo');
    const actualMostrado = await texto('reconteo-conteo-actual');
    comprobar(
      'CORREGIR A UN NÚMERO QUE CUADRA NO CIERRA: pide el PIN y muestra los dos conteos',
      'primer conteo Q500.00; ahora Q527.50 (sin diferencia)',
      `primer conteo ${primeroMostrado}; ahora ${actualMostrado}`,
      primeroMostrado.includes('500.00') && actualMostrado.includes('527.50') && /sin diferencia/.test(actualMostrado),
    );
    await capturar('4b-reconteo-que-cuadra-pide-pin');
    const cajaSigueAbierta = leerBase("SELECT estado FROM caja_sesiones WHERE id = ?", turno.id)[0].estado;
    comprobar('la caja SIGUE ABIERTA mientras no se autoriza', 'abierta', cajaSigueAbierta, cajaSigueAbierta === 'abierta');

    // Un PIN equivocado: el candado de intentos es el de cierre_con_diferencia.
    await teclearPin('9999');
    await prueba('mensaje-de-caja').waitFor({ timeout: ESPERA_CORTA });
    const rechazoDelPin = await texto('mensaje-de-caja');
    const candado = leerBase(
      "SELECT superficie, intentos_fallidos FROM bloqueos_de_autorizacion WHERE superficie = 'cierre_con_diferencia'",
    );
    anotar(`bloqueos_de_autorizacion tras el PIN equivocado: ${JSON.stringify(candado)}`);
    comprobar(
      'un PIN equivocado no autoriza, y cuenta en el MISMO candado que cualquier diferencia',
      'mensaje de PIN incorrecto; cierre_con_diferencia con 1 intento',
      `«${rechazoDelPin}»; ${JSON.stringify(candado)}`,
      rechazoDelPin.length > 0 && candado.length === 1 && candado[0].intentos_fallidos === 1,
    );

    await teclearPin(PIN);
    // §4.40.5: el PIN correcto NO cierra. Revela y espera la confirmación.
    await prueba('revelacion-de-autorizacion').waitFor({ timeout: ESPERA_CORTA });
    const estadoTrasElPinDeJimmy = leerBase('SELECT estado FROM caja_sesiones WHERE id = ?', turno.id)[0].estado;
    const reveladoAJimmy = {
      esperado: await texto('revelacion-esperado'),
      diferencia: await texto('revelacion-diferencia'),
      confirmaciones: await prueba('confirmacion-de-cierre').count(),
    };
    comprobar(
      'EL PIN CORRECTO NO CIERRA: revela lo autorizado (esperado Q527.50, sin diferencia) y la caja SIGUE ABIERTA en la base',
      'abierta; Q527.50; sin diferencia; 0 confirmaciones',
      `${estadoTrasElPinDeJimmy}; ${reveladoAJimmy.esperado}; ${reveladoAJimmy.diferencia}; ${String(reveladoAJimmy.confirmaciones)} confirmaciones`,
      estadoTrasElPinDeJimmy === 'abierta' &&
        reveladoAJimmy.esperado.includes('527.50') &&
        /sin diferencia/.test(reveladoAJimmy.diferencia) &&
        reveladoAJimmy.confirmaciones === 0,
    );
    await capturar('4c-pin-correcto-revela-y-espera');
    await prueba('confirmar-cierre-autorizado').click();
    await prueba('confirmacion-de-cierre').waitFor({ timeout: ESPERA_CORTA });

    // =======================================================================
    // TAREA 3 — La confirmación con los tres montos
    // =======================================================================
    const inicial = await texto('cierre-efectivo-inicial');
    const teorico = await texto('cierre-efectivo-teorico');
    const final = await texto('cierre-efectivo-final');
    const renglonesDeDiferencia = await prueba('cierre-diferencia').count();
    comprobar(
      'LA CONFIRMACIÓN dice «Caja cerrada con éxito» con inicial, teórico y final',
      'Q500.00 / Q527.50 / Q527.50, sin renglón de diferencia',
      `${inicial} / ${teorico} / ${final}, ${String(renglonesDeDiferencia)} renglones de diferencia`,
      (await texto('confirmacion-de-cierre')).includes('Caja cerrada con éxito') &&
        inicial.includes('500.00') &&
        teorico.includes('527.50') &&
        final.includes('527.50') &&
        renglonesDeDiferencia === 0,
    );
    await capturar('3-confirmacion-de-cierre');

    // La evidencia de fondo: la bitácora, tal cual quedó.
    const bitacora = leerBase(
      `SELECT accion, usuario_id, valor_anterior, valor_nuevo FROM auditoria_log
        WHERE entidad_tipo = 'caja_sesiones' AND entidad_id = ? ORDER BY fecha, rowid`,
      turno.id,
    );
    for (const asiento of bitacora) {
      anotar(`auditoria_log: ${asiento.accion} | anterior=${String(asiento.valor_anterior)} | nuevo=${String(asiento.valor_nuevo)}`);
    }
    const reconteo = bitacora.find((a) => a.accion === 'reconteo_de_cierre_autorizado');
    const reconteoNuevo = reconteo ? JSON.parse(reconteo.valor_nuevo) : null;
    const reconteoAnterior = reconteo ? JSON.parse(reconteo.valor_anterior) : null;
    comprobar(
      'EN LA BITÁCORA QUEDAN LOS DOS CONTEOS y quién autorizó la corrección',
      `sellado 500.00 (-27.50) → final 527.50 (0.00), autorizado por ${idAdministrador}, presencial`,
      reconteo
        ? `sellado ${reconteoAnterior.conteosSellados.map((c) => `${c.montoReal} (${c.diferencia})`).join(', ')} → final ${reconteoNuevo.montoReal} (${reconteoNuevo.diferencia}), autorizado por ${reconteoNuevo.autorizadaPor}, ${reconteoNuevo.autorizadaVia}`
        : 'NO HAY ASIENTO DE RECONTEO (mal)',
      reconteo !== undefined &&
        reconteoAnterior.conteosSellados.length === 1 &&
        reconteoAnterior.conteosSellados[0].montoReal === '500.00' &&
        reconteoNuevo.montoReal === '527.50' &&
        reconteoNuevo.autorizadaPor === idAdministrador &&
        reconteoNuevo.autorizadaVia === 'presencial',
    );
    const [sesionCerrada] = leerBase(
      'SELECT estado, monto_esperado, monto_real, diferencia, diferencia_autorizada_por FROM caja_sesiones WHERE id = ?',
      turno.id,
    );
    anotar(`caja_sesiones: ${JSON.stringify(sesionCerrada)}`);
    const encolados = leerBase(
      `SELECT a.accion FROM sync_cola c JOIN auditoria_log a ON a.id = c.entidad_id
        WHERE c.entidad_tipo = 'auditoria_log' AND a.entidad_id = ? ORDER BY c.rowid`,
      turno.id,
    ).map((f) => f.accion);
    comprobar(
      'los asientos del sello y del reconteo están en la cola para subir a la nube',
      'caja_abierta, conteo_de_cierre_sellado, caja_cerrada, reconteo_de_cierre_autorizado',
      encolados.join(', '),
      encolados.join(',') === 'caja_abierta,conteo_de_cierre_sellado,caja_cerrada,reconteo_de_cierre_autorizado',
    );

    // =======================================================================
    // TAREA 4 — El caso común NO se vuelve tedioso
    // =======================================================================
    await prueba('aceptar-confirmacion-de-cierre').click();
    await prueba('estado-sin-caja').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    for (const digito of '100') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    await prueba('ir-a-contar').click();
    await prueba('modo-simple').click();
    for (const digito of '100') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('confirmacion-de-cierre').waitFor({ timeout: ESPERA_CORTA });
    const pidioPin =
      (await prueba('autorizacion-de-diferencia').count()) + (await prueba('autorizacion-de-reconteo').count());
    comprobar(
      'EL CASO COMÚN: contar bien a la primera cierra directo, sin ver ningún PIN',
      'confirmación directa, 0 diálogos de autorización',
      `${String(pidioPin)} diálogos de autorización`,
      pidioPin === 0,
    );
    await prueba('aceptar-confirmacion-de-cierre').click();

    // =======================================================================
    // CORREGIDO EL 2026-09-15 — CAMBIA EL ESPERADO, NO LO CONTADO.
    // Sobrante sellado (Q520 contra Q500), una venta en efectivo de Q20 entra
    // en el medio, y se confirma OTRA VEZ Q520, que ahora cuadra. Antes del
    // arreglo el cierre pedía el PIN y cerraba sin dejar escrito quién autorizó.
    // =======================================================================
    anotar('--- cambia el esperado: sobrante Q520 contra Q500, venta de Q20 en el medio, se reconfirma Q520 ---');
    await prueba('estado-sin-caja').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    for (const digito of '500') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    const [turnoDelEsperado] = leerBase("SELECT id FROM caja_sesiones WHERE estado = 'abierta'");
    await prueba('ir-a-contar').click();
    await prueba('modo-simple').click();
    for (const digito of '520') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('autorizacion-de-diferencia').waitFor({ timeout: ESPERA_CORTA });
    anotar(`primer conteo: diferencia mostrada ${await texto('diferencia')}`);

    const conexionDelEsperado = new DatabaseConstructor(rutaDeLaBase);
    const momentoDelEsperado = new Date().toISOString();
    try {
      conexionDelEsperado
        .prepare(
          `INSERT INTO ventas (id, caja_sesion_id, usuario_id, fecha, subtotal, total, forma_pago,
                               estado, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, '20.00', '20.00', 'efectivo', 'completada', ?, ?)`,
        )
        .run(randomUUID(), turnoDelEsperado.id, idAdministrador, momentoDelEsperado, momentoDelEsperado, momentoDelEsperado);
    } finally {
      conexionDelEsperado.close();
    }
    anotar('se insertó en la base una venta en efectivo de Q20.00 en ese turno, entre el sello y la reconfirmación');

    await ventana.getByRole('button', { name: 'Volver a contar' }).click();
    await prueba('paso-de-conteo').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    for (const digito of '520') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('autorizacion-de-reconteo').waitFor({ timeout: ESPERA_CORTA });
    const dialogoDelEsperado = await texto('autorizacion-de-reconteo');
    const motivoDelEsperado = await texto('reconteo-motivo');
    anotar(`texto del diálogo de reconteo: ${JSON.stringify(dialogoDelEsperado)}`);
    comprobar(
      'EL DIÁLOGO DICE QUE CAMBIÓ LO ESPERADO, no que se corrigió el conteo: esperado entonces Q500.00, ahora Q520.00',
      '«Lo contado no cambió… era Q500.00 y ahora es Q520.00»; sin «El conteo cambió» ni «Corregir un conteo»',
      `motivo «${motivoDelEsperado}»; esperado entonces ${await texto('reconteo-esperado-entonces')}; ahora ${await texto('reconteo-esperado-ahora')}`,
      motivoDelEsperado.includes('Lo contado no cambió') &&
        motivoDelEsperado.includes('era Q500.00 y ahora es Q520.00') &&
        (await texto('reconteo-esperado-entonces')).includes('500.00') &&
        (await texto('reconteo-esperado-ahora')).includes('520.00') &&
        !dialogoDelEsperado.includes('El conteo cambió') &&
        !dialogoDelEsperado.includes('Corregir un conteo'),
    );
    await capturar('4d-cambio-el-esperado-pide-pin');
    await teclearPin(PIN);
    await prueba('revelacion-de-autorizacion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('confirmar-cierre-autorizado').click();
    await prueba('confirmacion-de-cierre').waitFor({ timeout: ESPERA_CORTA });

    const bitacoraDelEsperado = leerBase(
      `SELECT accion, usuario_id, valor_anterior, valor_nuevo FROM auditoria_log
        WHERE entidad_tipo = 'caja_sesiones' AND entidad_id = ? ORDER BY fecha, rowid`,
      turnoDelEsperado.id,
    );
    for (const asiento of bitacoraDelEsperado) {
      anotar(`auditoria_log: ${asiento.accion} | anterior=${String(asiento.valor_anterior)} | nuevo=${String(asiento.valor_nuevo)}`);
    }
    anotar(`caja_sesiones: ${JSON.stringify(leerBase('SELECT estado, monto_esperado, monto_real, diferencia, diferencia_autorizada_por, diferencia_autorizada_via FROM caja_sesiones WHERE id = ?', turnoDelEsperado.id)[0])}`);
    const reconteoDelEsperado = bitacoraDelEsperado.find((a) => a.accion === 'reconteo_de_cierre_autorizado');
    const nuevoDelEsperado = reconteoDelEsperado ? JSON.parse(reconteoDelEsperado.valor_nuevo) : null;
    comprobar(
      'QUIÉN AUTORIZÓ QUEDA ESCRITO aunque el número contado sea el mismo que el sellado',
      `reconteo con autorizadaPor ${idAdministrador}, presencial, cambioElConteo false, cambioElEsperado true`,
      nuevoDelEsperado
        ? `reconteo con autorizadaPor ${String(nuevoDelEsperado.autorizadaPor)}, ${String(nuevoDelEsperado.autorizadaVia)}, cambioElConteo ${String(nuevoDelEsperado.cambioElConteo)}, cambioElEsperado ${String(nuevoDelEsperado.cambioElEsperado)}`
        : 'NO HAY ASIENTO DE RECONTEO (el defecto)',
      nuevoDelEsperado !== null &&
        nuevoDelEsperado.autorizadaPor === idAdministrador &&
        nuevoDelEsperado.autorizadaVia === 'presencial' &&
        nuevoDelEsperado.cambioElConteo === false &&
        nuevoDelEsperado.cambioElEsperado === true,
    );
    await prueba('aceptar-confirmacion-de-cierre').click();
    await volver();

    // =======================================================================
    // §4.40 TAREA 3 — El costo de la venta es una FOTO. Se cambia el precio de
    // compra del maíz DESPUÉS de haberlo vendido, desde la pantalla.
    // =======================================================================
    await prueba('ir-a-productos').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await ventana.locator('.lista__fila', { hasText: 'Maíz blanco' }).getByRole('button', { name: 'Editar' }).click();
    await prueba('producto-precio-compra').fill('5.00');
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    const costoDespues = leerBase("SELECT precio_compra FROM productos WHERE nombre = 'Maíz blanco'")[0].precio_compra;
    const lineas = leerBase(
      `SELECT d.producto_nombre_snap, d.cantidad, d.subtotal_impreso, d.costo_unitario_snap
         FROM venta_detalle d ORDER BY d.producto_nombre_snap`,
    );
    anotar(`productos.precio_compra del maíz tras editarlo: ${String(costoDespues)}`);
    anotar(`venta_detalle en la base: ${JSON.stringify(lineas)}`);
    const lineaMaiz = lineas.find((l) => l.producto_nombre_snap === 'Maíz blanco');
    const lineaFrijol = lineas.find((l) => l.producto_nombre_snap === 'Frijol negro');
    comprobar(
      'la venta guardó la FOTO del costo: el maíz sigue con 3.00 aunque hoy cueste 5.00; el frijol, sin costo, con NULL',
      'catálogo 5.00; snap del maíz 3.00; snap del frijol null',
      `catálogo ${String(costoDespues)}; snap del maíz ${String(lineaMaiz?.costo_unitario_snap)}; snap del frijol ${String(lineaFrijol?.costo_unitario_snap)}`,
      costoDespues === '5.00' && lineaMaiz?.costo_unitario_snap === '3.00' && lineaFrijol?.costo_unitario_snap === null,
    );
    await volver();

    // =======================================================================
    // TAREA 5 — El margen en el reporte por producto
    // =======================================================================
    await prueba('ir-a-reportes').click();
    await prueba('solapa-productos').click();
    await prueba('reporte-por-producto').waitFor({ timeout: ESPERA_CORTA });
    const filas = await prueba('fila-de-producto').allTextContents();
    anotar(`filas del reporte por producto: ${JSON.stringify(filas)}`);
    const filaMaiz = filas.find((f) => f.includes('Maíz blanco')) ?? '';
    const filaFrijol = filas.find((f) => f.includes('Frijol negro')) ?? '';
    comprobar(
      'con precio de compra, el margen es (4.25 − 3.00) × 2 = Q2.50 — con el costo de la VENTA, no con los 5.00 de hoy (que darían −Q1.50)',
      'Margen: Q2.50',
      filaMaiz,
      filaMaiz.includes('Margen: Q2.50'),
    );
    comprobar(
      'SIN precio de compra, el margen dice «sin dato», no Q0.00, y cuenta la línea sin costo',
      'Margen: sin dato (1 línea sin dato de costo)',
      filaFrijol,
      filaFrijol.includes('Margen: sin dato') &&
        filaFrijol.includes('1 línea sin dato de costo') &&
        !filaFrijol.includes('Margen: Q0.00'),
    );
    const margenTotal = await texto('margen-total');
    comprobar('el margen del período suma solo lo que tiene costo', 'Q2.50', margenTotal, margenTotal.includes('2.50'));
    const sinCosto = await texto('lineas-sin-costo');
    comprobar(
      'el reporte dice cuántas líneas quedaron fuera del margen por no tener costo, y cuánto se cobró en ellas',
      '1 · Q9.00',
      sinCosto,
      sinCosto.includes('1') && sinCosto.includes('9.00'),
    );
    await capturar('5-margen-por-producto');
    await volver();

    // =======================================================================
    // §4.40 — UN USUARIO DE VENTA no ve el teórico: ni en pantalla, ni por el
    // canal, ni al contar. Lo ve recién en la confirmación.
    // =======================================================================
    anotar('--- escenario del usuario de venta ---');
    await prueba('ir-a-usuarios').click();
    await prueba('lista-de-usuarios').waitFor({ timeout: ESPERA_CORTA });
    await prueba('usuario-nombre').fill('Cajera de verificación');
    await prueba('usuario-rol').selectOption('venta');
    await prueba('usuario-pin').fill('1357');
    await prueba('usuario-guardar').click();
    await prueba('usuarios-aviso').waitFor({ timeout: ESPERA_CORTA });
    await volver();
    await ventana.getByRole('button', { name: 'Cerrar sesión' }).click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    await prueba('usuario-para-ingreso').filter({ hasText: 'Cajera de verificación' }).click();
    await teclearPin('1357');
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    anotar(`en sesión: ${await texto('usuario-en-sesion')}`);

    // Abre SU caja con Q200 y vende un maíz en efectivo (Q4.25): teórico Q204.25.
    await prueba('ir-a-caja').click();
    await prueba('estado-sin-caja').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    for (const digito of '200') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    await volver();
    await prueba('ir-a-venta').click();
    await prueba('cuadricula-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await prueba('icono-producto').filter({ hasText: 'Maíz blanco' }).click();
    await prueba('cobrar').click();
    await prueba('dialogo-de-cobro').waitFor({ timeout: ESPERA_CORTA });
    await prueba('cobro-continuar').click();
    await prueba('cobro-confirmar').click();
    await prueba('cobro-listo').waitFor({ timeout: ESPERA_CORTA });
    anotar(`venta de la cajera cobrada: ${await texto('cobro-total-cobrado')}`);

    // Por el canal, desde la consola de la ventana, con la sesión de la cajera.
    const estadoDeVentaCajera = await ventana.evaluate(async () => window.pos.venta.estado());
    await prueba('cobro-siguiente-venta').click();
    await volver();

    await prueba('ir-a-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    const estadoDeCajaCajera = await ventana.evaluate(async () => window.pos.caja.estado());
    anotar(`window.pos.caja.estado() con la sesión de la CAJERA: ${JSON.stringify(estadoDeCajaCajera.datos.turnoAbierto)}`);
    anotar(`window.pos.venta.estado().turnoAbierto con la sesión de la CAJERA: ${JSON.stringify(estadoDeVentaCajera.datos.turnoAbierto)}`);
    const turnoCajera = estadoDeCajaCajera.datos.turnoAbierto;
    const turnoVentaCajera = estadoDeVentaCajera.datos.turnoAbierto;
    comprobar(
      'POR EL CANAL: a la cajera `window.pos.caja.estado()` y `window.pos.venta.estado()` le devuelven el teórico, las ventas y su cantidad en null, y ni 204.25 ni 4.25 en toda la respuesta',
      'caja: null/null/null; venta: null/null/null; sin 204.25 ni 4.25',
      `caja: ${String(turnoCajera.montoTeorico)}/${String(turnoCajera.ventasEnEfectivo)}/${String(turnoCajera.cantidadDeVentasEnEfectivo)}; ` +
        `venta: ${String(turnoVentaCajera.montoTeorico)}/${String(turnoVentaCajera.ventasEnEfectivo)}/${String(turnoVentaCajera.cantidadDeVentasEnEfectivo)}; ` +
        `204.25 ${JSON.stringify([estadoDeCajaCajera, turnoVentaCajera]).includes('204.25') ? 'PRESENTE' : 'ausente'}`,
      turnoCajera.montoTeorico === null &&
        turnoCajera.ventasEnEfectivo === null &&
        turnoCajera.cantidadDeVentasEnEfectivo === null &&
        turnoVentaCajera.montoTeorico === null &&
        turnoVentaCajera.ventasEnEfectivo === null &&
        turnoVentaCajera.cantidadDeVentasEnEfectivo === null &&
        !JSON.stringify(turnoCajera).includes('204.25') &&
        !JSON.stringify(turnoVentaCajera).includes('204.25'),
    );

    const cuerpoResumenCajera = await ventana.locator('body').innerText();
    anotar(`texto visible del resumen de caja de la CAJERA: ${JSON.stringify(cuerpoResumenCajera)}`);
    comprobar(
      'EN PANTALLA: el resumen de caja de la cajera no tiene la fila del teórico ni la de ventas, ni «teórico», ni 204.25',
      '0 filas; sin «teórico»; sin 204.25',
      `${String(await prueba('monto-teorico').count())} de teórico, ${String(await prueba('ventas-en-efectivo').count())} de ventas; ` +
        `«teórico» ${/teórico/i.test(cuerpoResumenCajera) ? 'PRESENTE' : 'ausente'}; 204.25 ${cuerpoResumenCajera.includes('204.25') ? 'PRESENTE' : 'ausente'}`,
      (await prueba('monto-teorico').count()) === 0 &&
        (await prueba('ventas-en-efectivo').count()) === 0 &&
        !/teórico/i.test(cuerpoResumenCajera) &&
        !cuerpoResumenCajera.includes('204.25'),
    );
    await capturar('7a-cajera-resumen-sin-teorico');

    await prueba('ir-a-contar').click();
    await prueba('paso-de-conteo').waitFor({ timeout: ESPERA_CORTA });
    const cuerpoConteoCajera = await ventana.locator('body').innerText();
    comprobar(
      'la cajera tampoco lo ve al contar',
      '0 filas; sin «teórico»; sin 204.25',
      `${String(await prueba('monto-teorico').count())} de teórico; «teórico» ${/teórico/i.test(cuerpoConteoCajera) ? 'PRESENTE' : 'ausente'}; 204.25 ${cuerpoConteoCajera.includes('204.25') ? 'PRESENTE' : 'ausente'}`,
      (await prueba('monto-teorico').count()) === 0 &&
        !/teórico/i.test(cuerpoConteoCajera) &&
        !cuerpoConteoCajera.includes('204.25'),
    );
    await capturar('7b-cajera-contando-sin-teorico');

    // La cajera cuenta DE MENOS (Q200.00 contra Q204.25): el diálogo de
    // diferencia no le puede decir cuánto se esperaba (§4.40).
    await prueba('modo-simple').click();
    for (const digito of '200') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('autorizacion-de-diferencia').waitFor({ timeout: ESPERA_CORTA });
    const cuerpoDiferenciaCajera = await ventana.locator('body').innerText();
    anotar(`texto visible del diálogo de diferencia de la CAJERA: ${JSON.stringify(cuerpoDiferenciaCajera)}`);
    comprobar(
      'LA CAJERA EN EL DIÁLOGO DE DIFERENCIA: ve que hay que autorizar, y NO el esperado, ni la diferencia, ni si falta o sobra',
      'aviso de autorización; sin 204.25, sin Q4.25, sin «Debería haber», sin faltante/sobrante, sin fila de diferencia',
      `aviso ${String(await prueba('diferencia-sin-monto').count())}; fila de diferencia ${String(await prueba('diferencia').count())}; ` +
        `204.25 ${cuerpoDiferenciaCajera.includes('204.25') ? 'PRESENTE' : 'ausente'}; Q4.25 ${cuerpoDiferenciaCajera.includes('Q4.25') ? 'PRESENTE' : 'ausente'}; ` +
        `«Debería haber» ${cuerpoDiferenciaCajera.includes('Debería haber') ? 'PRESENTE' : 'ausente'}; ` +
        `faltante/sobrante ${/faltante|sobrante/i.test(cuerpoDiferenciaCajera) ? 'PRESENTE' : 'ausente'}`,
      (await prueba('diferencia-sin-monto').count()) === 1 &&
        (await prueba('diferencia').count()) === 0 &&
        /autorizar/.test(cuerpoDiferenciaCajera) &&
        !cuerpoDiferenciaCajera.includes('204.25') &&
        !cuerpoDiferenciaCajera.includes('Q4.25') &&
        !cuerpoDiferenciaCajera.includes('Debería haber') &&
        !/faltante|sobrante/i.test(cuerpoDiferenciaCajera),
    );
    await capturar('7b2-cajera-dialogo-de-diferencia-sin-esperado');

    // Un PIN EQUIVOCADO en ese diálogo: nunca llega a mostrar ningún monto.
    await teclearPin('9999');
    await prueba('mensaje-de-caja').waitFor({ timeout: ESPERA_CORTA });
    const cuerpoPinMaloCajera = await ventana.locator('body').innerText();
    comprobar(
      'UN PIN INCORRECTO NUNCA MUESTRA NINGÚN MONTO: sigue el diálogo, sin revelación, sin 204.25 ni «Debería haber»',
      'aviso de PIN; 0 revelaciones; sin 204.25; sin «Debería haber»',
      `«${await texto('mensaje-de-caja')}»; ${String(await prueba('revelacion-de-autorizacion').count())} revelaciones; ` +
        `204.25 ${cuerpoPinMaloCajera.includes('204.25') ? 'PRESENTE' : 'ausente'}; «Debería haber» ${cuerpoPinMaloCajera.includes('Debería haber') ? 'PRESENTE' : 'ausente'}`,
      (await prueba('revelacion-de-autorizacion').count()) === 0 &&
        !cuerpoPinMaloCajera.includes('204.25') &&
        !cuerpoPinMaloCajera.includes('Debería haber'),
    );

    // Por el canal, con la sesión de la cajera y el MISMO conteo (el mismo par
    // no vuelve a sellar): la respuesta cruda del proceso principal.
    const crudoDiferencia = await ventana.evaluate(async () =>
      window.pos.caja.cerrar({ modo: 'simple', monto: '200.00' }),
    );
    anotar(`window.pos.caja.cerrar(Q200.00) con la sesión de la CAJERA: ${JSON.stringify(crudoDiferencia)}`);
    const sellosDeLaCajera = leerBase(
      "SELECT valor_nuevo FROM auditoria_log WHERE accion = 'conteo_de_cierre_sellado' ORDER BY fecha, rowid",
    ).map((f) => f.valor_nuevo);
    anotar(`auditoria_log, sellos de todo el recorrido: ${JSON.stringify(sellosDeLaCajera)}`);
    comprobar(
      'POR EL CANAL: a la cajera el cierre le devuelve esperado y diferencia en null, y el mensaje sin montos; la bitácora SÍ guarda el esperado',
      'montoEsperado null, diferencia null, sin 204.25 en la respuesta; sello con montoEsperado 204.25 y un solo sello por el par',
      `montoEsperado ${String(crudoDiferencia.datos.montoEsperado)}, diferencia ${String(crudoDiferencia.datos.diferencia)}, «${crudoDiferencia.datos.mensaje}»; ` +
        `sellos con 204.25: ${String(sellosDeLaCajera.filter((v) => v.includes('"montoEsperado":"204.25"')).length)}`,
      crudoDiferencia.datos.montoEsperado === null &&
        crudoDiferencia.datos.diferencia === null &&
        !JSON.stringify(crudoDiferencia).includes('204.25') &&
        sellosDeLaCajera.filter((v) => v.includes('"montoEsperado":"204.25"')).length === 1,
    );

    // Vuelve a contar y ahora teclea EXACTAMENTE el esperado. El servicio
    // contesta «reconteo»; a la cajera tiene que llegarle igual que una
    // diferencia, o el cambio de diálogo le diría que acertó.
    await ventana.getByRole('button', { name: 'Volver a contar' }).click();
    await prueba('paso-de-conteo').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    for (const tecla of ['2', '0', '4', 'punto', '2', '5']) {
      await prueba(`tecla-${tecla}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('autorizacion-de-diferencia').waitFor({ timeout: ESPERA_CORTA });
    const cuerpoReconteoCajera = await ventana.locator('body').innerText();
    anotar(`texto visible tras recontar Q204.25 (CAJERA): ${JSON.stringify(cuerpoReconteoCajera)}`);
    const crudoReconteo = await ventana.evaluate(async () =>
      window.pos.caja.cerrar({ modo: 'simple', monto: '204.25' }),
    );
    anotar(`window.pos.caja.cerrar(Q204.25) con la sesión de la CAJERA: ${JSON.stringify(crudoReconteo)}`);
    comprobar(
      'AL ACERTAR EL ESPERADO, la cajera ve el MISMO diálogo que con diferencia: nada dice que ahora cuadra',
      'diálogo de diferencia (no el de reconteo); código REQUIERE_AUTORIZACION; sin «cuadra», «sin diferencia» ni «Debería haber»',
      `diferencia ${String(await prueba('autorizacion-de-diferencia').count())}, reconteo ${String(await prueba('autorizacion-de-reconteo').count())}; ` +
        `código ${crudoReconteo.datos.codigo}; «cuadra» ${/cuadra/i.test(cuerpoReconteoCajera) ? 'PRESENTE' : 'ausente'}; ` +
        `«sin diferencia» ${/sin diferencia/i.test(cuerpoReconteoCajera) ? 'PRESENTE' : 'ausente'}`,
      (await prueba('autorizacion-de-diferencia').count()) === 1 &&
        (await prueba('autorizacion-de-reconteo').count()) === 0 &&
        crudoReconteo.datos.codigo === 'REQUIERE_AUTORIZACION' &&
        crudoReconteo.datos.montoEsperado === null &&
        !/cuadra|sin diferencia|Debería haber/i.test(cuerpoReconteoCajera),
    );
    await capturar('7b3-cajera-reconteo-igual-que-diferencia');

    // Autoriza un administrador con su PIN, en la sesión de la cajera. El PIN
    // correcto REVELA lo autorizado y espera (§4.40.5).
    const [filaDelTurnoCajera] = leerBase("SELECT id FROM caja_sesiones WHERE estado = 'abierta'");
    await teclearPin(PIN);
    await prueba('revelacion-de-autorizacion').waitFor({ timeout: ESPERA_CORTA });
    const reveladoALaCajera = {
      esperado: await texto('revelacion-esperado'),
      quien: await texto('revelacion-quien-autoriza'),
      estado: leerBase('SELECT estado FROM caja_sesiones WHERE id = ?', filaDelTurnoCajera.id)[0].estado,
    };
    anotar(`revelación en la sesión de la CAJERA tras el PIN del administrador: ${JSON.stringify(reveladoALaCajera)}`);
    comprobar(
      'EN LA SESIÓN DE LA CAJERA, el PIN del administrador revela el esperado para que vea qué aprueba, y la caja sigue abierta',
      'Q204.25; quién autoriza; abierta',
      `${reveladoALaCajera.esperado}; «${reveladoALaCajera.quien}»; ${reveladoALaCajera.estado}`,
      reveladoALaCajera.esperado.includes('204.25') &&
        reveladoALaCajera.quien.includes('Jimmy de verificación') &&
        reveladoALaCajera.estado === 'abierta',
    );
    await capturar('7b4-cajera-revelacion-tras-pin-del-administrador');

    // CANCELAR: no cierra, y la autorización muere en el proceso principal.
    await prueba('cancelar-cierre-autorizado').click();
    await prueba('autorizacion-de-diferencia').waitFor({ timeout: ESPERA_CORTA });
    const confirmarDesdeLaConsola = await ventana.evaluate(async () =>
      window.pos.caja.confirmarCierreAutorizado({ modo: 'simple', monto: '204.25' }),
    );
    anotar(`tras CANCELAR, window.pos.caja.confirmarCierreAutorizado(Q204.25) desde la consola: ${JSON.stringify(confirmarDesdeLaConsola)}`);
    const estadoTrasCancelar = leerBase('SELECT estado FROM caja_sesiones WHERE id = ?', filaDelTurnoCajera.id)[0].estado;
    comprobar(
      'CANCELAR no cierra y retira la autorización: confirmar desde la consola después no cierra nada',
      'vuelve al diálogo; AUTORIZACION_NO_VIGENTE; cerrada=false; caja abierta en la base',
      `diálogo ${String(await prueba('autorizacion-de-diferencia').count())}; ${confirmarDesdeLaConsola.datos.codigo}; cerrada=${String(confirmarDesdeLaConsola.datos.cerrada)}; ${estadoTrasCancelar}`,
      (await prueba('autorizacion-de-diferencia').count()) === 1 &&
        confirmarDesdeLaConsola.datos.codigo === 'AUTORIZACION_NO_VIGENTE' &&
        confirmarDesdeLaConsola.datos.cerrada === false &&
        estadoTrasCancelar === 'abierta',
    );

    // Otra vez el PIN, y esta vez sí: «Sí, cerrar la caja».
    await teclearPin(PIN);
    await prueba('revelacion-de-autorizacion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('confirmar-cierre-autorizado').click();
    await prueba('confirmacion-de-cierre').waitFor({ timeout: ESPERA_CORTA });
    const teoricoParaLaCajera = await texto('cierre-efectivo-teorico');
    comprobar(
      'LA CONFIRMACIÓN SÍ le muestra el teórico a la cajera, una vez registrado el conteo',
      'Q204.25',
      teoricoParaLaCajera,
      teoricoParaLaCajera.includes('204.25'),
    );
    await capturar('7c-cajera-confirmacion-con-teorico');

    // =======================================================================
    // 2026-09-15 — LA CAJA QUE ABRIÓ OTRA PERSONA, cerrada por un administrador
    // DISTINTO. Jimmy no encontró cómo hacerlo en `v1.0.0-prueba.1`: el botón
    // «Cerrar turno (requiere autorización)» no hacía nada, porque la respuesta
    // del proceso principal no se podía clonar y la llamada quedaba pendiente
    // para siempre. Ningún recorrido de la app real pasaba por acá.
    // =======================================================================
    anotar('--- caja ajena: la abre la cajera y la cierra el administrador ---');
    await prueba('aceptar-confirmacion-de-cierre').click();
    await prueba('estado-sin-caja').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    for (const digito of '150') {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('confirmar-caja').click();
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });
    const [filaDelTurnoAjeno] = leerBase("SELECT id FROM caja_sesiones WHERE estado = 'abierta'");
    await volver();
    await ventana.getByRole('button', { name: 'Cerrar sesión' }).click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    await prueba('usuario-para-ingreso').filter({ hasText: 'Jimmy de verificación' }).click();
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('ir-a-caja').click();
    await prueba('estado-caja-ajena').waitFor({ timeout: ESPERA_CORTA });
    const avisoDeCajaAjena = await texto('aviso-de-caja-ajena');
    anotar(`aviso de caja ajena: ${JSON.stringify(avisoDeCajaAjena)}`);
    comprobar(
      'EL ADMINISTRADOR ve, sin ambigüedad, quién abrió la caja y que va a necesitar PIN de administrador',
      'Esta caja la abrió Cajera de verificación. Vas a necesitar el PIN de un administrador para cerrarla.',
      avisoDeCajaAjena,
      avisoDeCajaAjena.includes('Esta caja la abrió Cajera de verificación.') &&
        avisoDeCajaAjena.includes('Vas a necesitar el PIN de un administrador para cerrarla.') &&
        avisoDeCajaAjena.includes('Primero contás el efectivo'),
    );
    await capturar('7d-administrador-frente-a-caja-ajena');
    await prueba('ir-a-contar').click();
    await prueba('modo-simple').click();
    for (const digito of '150') {
      await prueba(`tecla-${digito}`).click();
    }
    const antesDelClic = Date.now();
    await prueba('confirmar-caja').click();
    const aparecioElDialogo = await prueba('autorizacion-de-caja-ajena')
      .waitFor({ timeout: ESPERA_CORTA })
      .then(() => true, () => false);
    comprobar(
      'TOCAR «Cerrar turno (requiere autorización)» abre el diálogo del PIN (en v1.0.0-prueba.1 no pasaba nada)',
      'diálogo visible',
      aparecioElDialogo ? `diálogo visible a los ${Date.now() - antesDelClic} ms` : `sin diálogo; mensaje: ${await prueba('mensaje-de-caja').count() ? await texto('mensaje-de-caja') : '(ninguno)'}`,
      aparecioElDialogo,
    );
    if (!aparecioElDialogo) {
      throw new Error('El diálogo de caja ajena no apareció.');
    }
    await capturar('7e-dialogo-de-caja-ajena');
    await teclearPin(PIN);
    await prueba('confirmacion-de-cierre').waitFor({ timeout: ESPERA_CORTA });
    const [cierreAjeno] = leerBase(
      'SELECT estado, usuario_id, cerrada_por, monto_real FROM caja_sesiones WHERE id = ?',
      filaDelTurnoAjeno.id,
    );
    anotar(`caja_sesiones del turno ajeno: ${JSON.stringify(cierreAjeno)}`);
    comprobar(
      'con el PIN la caja ajena queda CERRADA en la base, con el administrador como quien cerró',
      `cerrada; cerrada_por=${idAdministrador}; Q150.00`,
      `${cierreAjeno.estado}; cerrada_por=${cierreAjeno.cerrada_por}; Q${cierreAjeno.monto_real}`,
      cierreAjeno.estado === 'cerrada' &&
        cierreAjeno.cerrada_por === idAdministrador &&
        cierreAjeno.usuario_id !== idAdministrador &&
        cierreAjeno.monto_real === '150.00',
    );

    // =======================================================================
    // PROMPT #2 — LA SALIDA CONTROLADA CON EL PIN REMOTO (ampliada el
    // 2026-09-15). Va AL FINAL: si funciona, la aplicación se cierra sola.
    // =======================================================================
    anotar('--- salida controlada con el PIN REMOTO de un administrador ---');
    const PIN_REMOTO = '8642';
    await prueba('aceptar-confirmacion-de-cierre').click();
    await volver();
    await ventana.getByRole('button', { name: 'Cerrar sesión' }).click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    await prueba('usuario-para-ingreso').filter({ hasText: 'Jimmy de verificación' }).click();
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('ir-a-pin-remoto').click();
    await prueba('pantalla-de-pin-remoto').waitFor({ timeout: ESPERA_CORTA });
    await teclearPin(PIN_REMOTO);
    await teclearPin(PIN_REMOTO);
    await prueba('pin-remoto-guardado').waitFor({ timeout: ESPERA_CORTA });
    await volver();
    // El botón de salida está en todas las pantallas, también en el ingreso.
    // Se cierra la sesión del administrador para salir desde ahí, como al final
    // del día sin ningún administrador presente.
    await ventana.getByRole('button', { name: 'Cerrar sesión' }).click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });

    await prueba('boton-salida').click();
    await prueba('dialogo-salida').waitFor({ timeout: ESPERA_CORTA });
    const textoDelDialogoDeSalida = await texto('dialogo-salida');
    anotar(`texto del diálogo de salida: ${JSON.stringify(textoDelDialogoDeSalida)}`);
    // Desde el 2026-09-15 el PIN de salida se toca en el teclado numérico del
    // diálogo: ya no hay ningún campo nativo que llenar (§4.46).
    for (const digito of PIN_REMOTO) {
      await prueba('dialogo-salida').locator(`[data-prueba="tecla-${digito}"]`).click();
    }
    await capturar('8-salida-con-pin-remoto');
    const procesoTerminado = new Promise((resolver) => {
      app.process().once('exit', (codigo) => {
        resolver(codigo);
      });
    });
    const inicioDeLaSalida = Date.now();
    await prueba('dialogo-salida').getByRole('button', { name: 'Cerrar aplicación' }).click();
    const codigoDeSalida = await Promise.race([
      procesoTerminado,
      new Promise((resolver) => {
        setTimeout(() => {
          resolver('NO SE CERRÓ en 15 s');
        }, 15000);
      }),
    ]);
    anotar(`el proceso de Electron terminó con ${String(codigoDeSalida)} a los ${String(Date.now() - inicioDeLaSalida)} ms`);
    const asientoDeSalida = leerBase(
      `SELECT accion, usuario_id, valor_nuevo FROM auditoria_log
        WHERE accion IN ('salida_controlada_autorizada', 'salida_controlada_rechazada') ORDER BY fecha, rowid`,
    );
    anotar(`auditoria_log de la salida: ${JSON.stringify(asientoDeSalida)}`);
    const autorizada = asientoDeSalida.find((f) => f.accion === 'salida_controlada_autorizada');
    const datosDeLaSalida = autorizada ? JSON.parse(autorizada.valor_nuevo) : null;
    comprobar(
      'LA SALIDA CONTROLADA CON EL PIN REMOTO cierra la aplicación, y el asiento dice «remoto» con el administrador real',
      `el proceso termina; salida_controlada_autorizada; boton_de_interfaz; remoto; usuario ${idAdministrador}`,
      `proceso: ${String(codigoDeSalida)}; ${autorizada ? autorizada.accion : 'SIN ASIENTO'}; ` +
        `${String(datosDeLaSalida?.origen)}; ${String(datosDeLaSalida?.autorizadaVia)}; usuario ${String(autorizada?.usuario_id)}`,
      codigoDeSalida !== 'NO SE CERRÓ en 15 s' &&
        autorizada !== undefined &&
        datosDeLaSalida.origen === 'boton_de_interfaz' &&
        datosDeLaSalida.autorizadaVia === 'remoto' &&
        autorizada.usuario_id === idAdministrador,
    );
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
    await ventana.screenshot({ path: join(capturas, 'error.png') }).catch(() => undefined);
  } finally {
    app.process().kill('SIGKILL');
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(`\n${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
  console.info(`Capturas: ${capturas}`);
  if (process.env.POS_BORRAR_CARPETA === '1') {
    rmSync(datos, { recursive: true, force: true });
  }
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verificacion-de-caja-y-teclado] Falló antes de poder comprobar nada: ${error.message}`);
  process.exit(1);
});
