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
    comprobar(
      'al volver a contar, la pantalla avisa que el conteo quedó registrado y que cambiarlo pide autorización',
      'menciona Q500.00 y autorización',
      avisoDeSello,
      avisoDeSello.includes('500.00') && /autorizaci/.test(avisoDeSello),
    );

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
      'con precio de compra, el margen es (4.25 − 3.00) × 2 = Q2.50',
      'Margen: Q2.50',
      filaMaiz,
      filaMaiz.includes('Margen: Q2.50'),
    );
    comprobar(
      'SIN precio de compra, el margen dice «sin dato», no Q0.00',
      'Margen: sin dato',
      filaFrijol,
      filaFrijol.includes('Margen: sin dato') && !filaFrijol.includes('Margen: Q0.00'),
    );
    const margenTotal = await texto('margen-total');
    comprobar('el margen del período suma solo lo que tiene costo', 'Q2.50', margenTotal, margenTotal.includes('2.50'));
    await capturar('5-margen-por-producto');
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
