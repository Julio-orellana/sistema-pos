/**
 * verificacion-de-historial-de-cajas.cjs — El historial de cajas en la
 * aplicación REAL (CLAUDE.md §4.44).
 *
 * Las sesiones se arman con los canales REALES de la ventana
 * (`window.pos.sesion`, `window.pos.caja`), con ingresos de verdad y PIN de
 * verdad, sin tocar la base: lo que el historial lee es lo que dejan los
 * cierres. La pantalla de caja ya tiene su propio arnés (§4.39 a §4.42); acá lo
 * que se maneja con clics es el HISTORIAL.
 *
 *   A. Ana abre 500, cuenta 480 y Jimmy autoriza la diferencia con su PIN REMOTO.
 *   B. Ana abre y cierra por denominación, exacto.
 *   C. Rosa abre 300 y Jimmy la cierra con su PIN (caja ajena).
 *   D. Ana abre 500, cuenta 480, corrige a 500 y Jimmy autoriza la corrección.
 *   E. Rosa abre 200, cuenta 150 y la deja abierta.
 *
 * Después: la cajera NO ve el botón y el canal la rechaza; Jimmy entra al
 * historial, ve los cinco casos distintos, filtra por persona y por fecha, y
 * abre los detalles. Todas las sesiones son de HOY: el filtro por días
 * distintos de Guatemala está probado en Vitest sobre SQLite real.
 *
 * Salida: cada comprobación con lo esperado y lo real, y código 1 si alguna falla.
 */

const { mkdirSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

const PROYECTO = join(__dirname, '..');
const PIN_JIMMY = '2468';
const PIN_REMOTO_JIMMY = '9753';
const PIN_ANA = '1357';
const PIN_ROSA = '8642';
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;

const comprobaciones = [];

function comprobar(nombre, esperado, real, paso) {
  comprobaciones.push({ nombre, paso });
  console.info(`${new Date().toISOString()}  ${paso ? 'OK   ' : 'FALLA'} ${nombre}`);
  if (!paso) {
    console.info(`           esperado: ${String(esperado)}`);
    console.info(`           real    : ${String(real)}`);
  }
}

function anotar(texto) {
  console.info(`${new Date().toISOString()}  ${texto}`);
}

/** `AAAA-MM-DD` de Guatemala, corrido `dias` días. */
function diaDeGuatemala(dias) {
  const instante = new Date(Date.now() + dias * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(instante);
}

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-historial-'));
  const capturas = join(datos, 'capturas');
  mkdirSync(capturas);
  const rutaDeLaBase = join(datos, 'pos-agricola.db');

  const app = await electron.launch({ executablePath: rutaDeElectron, args: [PROYECTO, `--user-data-dir=${datos}`], cwd: PROYECTO });
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
  const capturar = async (nombre) => {
    await new Promise((r) => { setTimeout(r, 800); });
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
  const leerBase = (consulta, ...parametros) => {
    const conexion = new DatabaseConstructor(rutaDeLaBase, { readonly: true });
    try {
      return conexion.prepare(consulta).all(...parametros);
    } finally {
      conexion.close();
    }
  };
  /** Llama a la API de la ventana y falla si la respuesta no es ok. */
  const pos = (codigo, argumento) => ventana.evaluate(codigo, argumento);

  try {
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Jimmy');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN_JIMMY);
    await teclearPin(PIN_JIMMY);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });

    // ---- Armar los cinco casos por los canales reales ------------------------
    const armado = await pos(
      async (p) => {
        const exigir = (respuesta, paso) => {
          if (!respuesta.ok) throw new Error(`${paso}: ${respuesta.error.mensaje}`);
          return respuesta.datos;
        };
        const pasos = [];
        const anotarPaso = (paso, datos) => pasos.push(`${paso}: ${JSON.stringify(datos === undefined ? null : { codigo: datos.codigo, cerrada: datos.cerrada })}`);
        exigir(await window.pos.sesion.configurarPinRemoto(p.remoto), 'PIN remoto');
        const ana = exigir(await window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pin: p.ana }), 'crear Ana');
        const rosa = exigir(await window.pos.usuarios.crear({ nombre: 'Rosa', rol: 'venta', pin: p.rosa }), 'crear Rosa');
        const jimmy = exigir(await window.pos.sesion.estado(), 'estado').sesion.id;
        const entrar = async (id, pin) => {
          exigir(await window.pos.sesion.cerrar(), 'cerrar sesión');
          const ingreso = exigir(await window.pos.sesion.iniciar(id, pin), 'ingresar');
          if (!ingreso.autenticado) throw new Error(`no entró ${id}`);
        };
        const simple = (monto) => ({ modo: 'simple', monto });

        // A
        await entrar(ana.id, p.ana);
        exigir(await window.pos.caja.abrir(simple('500')), 'A abrir');
        let r = exigir(await window.pos.caja.cerrar(simple('480')), 'A contar 480'); anotarPaso('A contar 480', r);
        r = exigir(await window.pos.caja.cerrar(simple('480'), p.remoto), 'A PIN remoto'); anotarPaso('A PIN remoto', r);
        r = exigir(await window.pos.caja.confirmarCierreAutorizado(simple('480')), 'A confirmar'); anotarPaso('A confirmar', r);

        // B
        await entrar(ana.id, p.ana);
        const denominaciones = exigir(await window.pos.caja.estado(), 'estado caja').denominaciones;
        const id = (valor) => denominaciones.find((d) => d.valor === valor).id;
        const quinientos = { modo: 'detallado', lineas: [{ denominacionId: id('200.00'), cantidad: 2 }, { denominacionId: id('100.00'), cantidad: 1 }] };
        exigir(await window.pos.caja.abrir(quinientos), 'B abrir');
        r = exigir(await window.pos.caja.cerrar(quinientos), 'B cerrar'); anotarPaso('B cerrar', r);

        // C
        await entrar(rosa.id, p.rosa);
        exigir(await window.pos.caja.abrir(simple('300')), 'C abrir');
        await entrar(jimmy, p.jimmy);
        r = exigir(await window.pos.caja.cerrar(simple('300')), 'C ajena sin PIN'); anotarPaso('C ajena sin PIN', r);
        r = exigir(await window.pos.caja.cerrar(simple('300'), undefined, p.jimmy), 'C ajena con PIN'); anotarPaso('C ajena con PIN', r);

        // D
        await entrar(ana.id, p.ana);
        exigir(await window.pos.caja.abrir(simple('500')), 'D abrir');
        r = exigir(await window.pos.caja.cerrar(simple('480')), 'D contar 480'); anotarPaso('D contar 480', r);
        r = exigir(await window.pos.caja.cerrar(simple('500')), 'D corregir a 500'); anotarPaso('D corregir a 500', r);
        r = exigir(await window.pos.caja.cerrar(simple('500'), p.jimmy), 'D PIN'); anotarPaso('D PIN', r);
        r = exigir(await window.pos.caja.confirmarCierreAutorizado(simple('500')), 'D confirmar'); anotarPaso('D confirmar', r);

        // E
        await entrar(rosa.id, p.rosa);
        exigir(await window.pos.caja.abrir(simple('200')), 'E abrir');
        r = exigir(await window.pos.caja.cerrar(simple('150')), 'E contar 150'); anotarPaso('E contar 150', r);

        return { pasos, ana: ana.id, rosa: rosa.id, jimmy };
      },
      { remoto: PIN_REMOTO_JIMMY, ana: PIN_ANA, rosa: PIN_ROSA, jimmy: PIN_JIMMY },
    );
    for (const paso of armado.pasos) anotar(`armado ${paso}`);

    const sesionesEnBase = leerBase(
      `SELECT c.estado, ua.nombre AS abrio, uc.nombre AS cerro, c.monto_inicial, c.monto_esperado, c.monto_real, c.diferencia,
              ud.nombre AS autorizo, c.diferencia_autorizada_via AS via
         FROM caja_sesiones c JOIN usuarios ua ON ua.id = c.usuario_id
         LEFT JOIN usuarios uc ON uc.id = c.cerrada_por LEFT JOIN usuarios ud ON ud.id = c.diferencia_autorizada_por
        ORDER BY c.abierta_en DESC, c.rowid DESC`,
    );
    anotar(`caja_sesiones en la base: ${JSON.stringify(sesionesEnBase)}`);
    anotar(`asientos de caja: ${JSON.stringify(leerBase("SELECT accion, count(*) n FROM auditoria_log WHERE entidad_tipo = 'caja_sesiones' GROUP BY accion ORDER BY accion"))}`);

    // ---- La cajera no llega --------------------------------------------------
    await ventana.reload();
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_LARGA });
    const botonesDeLaCajera = await prueba('ir-a-historial-de-cajas').count();
    const canalDeLaCajera = await pos(() => window.pos.historialDeCajas.listar({ desde: null, hasta: null, abiertaPor: null }));
    anotar(`window.pos.historialDeCajas.listar() con la sesión de ROSA (venta): ${JSON.stringify(canalDeLaCajera)}`);
    comprobar(
      'ROSA (VENTA): no ve el botón del historial y el canal la rechaza con PERMISO_DENEGADO',
      '0 botones; ok=false; PERMISO_DENEGADO',
      `${String(botonesDeLaCajera)} botones; ok=${String(canalDeLaCajera.ok)}; ${canalDeLaCajera.ok ? '' : canalDeLaCajera.error.codigo}`,
      botonesDeLaCajera === 0 && !canalDeLaCajera.ok && canalDeLaCajera.error.codigo === 'PERMISO_DENEGADO',
    );
    const detalleDeLaCajera = await pos((id) => window.pos.historialDeCajas.detalle(id), '00000000-0000-4000-8000-000000000000');
    comprobar('ROSA (VENTA): el detalle también la rechaza', 'PERMISO_DENEGADO', detalleDeLaCajera.ok ? 'ok' : detalleDeLaCajera.error.codigo, !detalleDeLaCajera.ok && detalleDeLaCajera.error.codigo === 'PERMISO_DENEGADO');

    // ---- Jimmy entra al historial --------------------------------------------
    await pos(async (p) => {
      await window.pos.sesion.cerrar();
      await window.pos.sesion.iniciar(p.id, p.pin);
    }, { id: armado.jimmy, pin: PIN_JIMMY });
    await ventana.reload();
    await prueba('ir-a-historial-de-cajas').waitFor({ timeout: ESPERA_LARGA });
    await prueba('ir-a-historial-de-cajas').click();
    await prueba('historial-lista').waitFor({ timeout: ESPERA_CORTA });

    const filas = await ventana.locator('[data-prueba="historial-fila"]').evaluateAll((nodos) =>
      nodos.map((n) => {
        const texto = n.innerText.replace(/\s+/g, ' ').trim();
        // Las etiquetas van en mayúsculas por CSS (text-transform) e innerText lo aplica:
        // se compara sin distinguir mayúsculas, y la fila se anota tal como se ve.
        return { estado: n.getAttribute('data-estado'), texto, bajo: texto.toLowerCase() };
      }),
    );
    for (const [i, f] of filas.entries()) anotar(`fila ${String(i + 1)}: [${f.estado}] ${f.texto}`);
    await capturar('1-lista');

    const [e, d, c, b, a] = filas;
    comprobar('LA LISTA trae las cinco sesiones, de la apertura más reciente a la más vieja', '5, E primero (abierta)', `${String(filas.length)}, primera ${e?.estado}`, filas.length === 5 && e?.estado === 'abierta');
    comprobar(
      'A · DIFERENCIA AUTORIZADA: faltante de Q20.00, autorizada por Jimmy por teléfono',
      'faltante de Q20.00 + «Diferencia autorizada por Jimmy, por teléfono (PIN remoto)»',
      a?.texto,
      Boolean(a?.bajo.includes('abrió ana') && a.bajo.includes('faltante de q20.00') && a.bajo.includes('diferencia autorizada por jimmy, por teléfono (pin remoto)') && !a.bajo.includes('recuento corregido')),
    );
    comprobar(
      'B · SIN DIFERENCIA: cuadra, sin autorización ni etiquetas',
      'cuadra, sin «autorizada», sin «otra persona», sin «Recuento»',
      b?.texto,
      Boolean(b?.bajo.includes('cuadra') && !b.bajo.includes('autorizada') && !b.bajo.includes('otra persona') && !b.bajo.includes('recuento')),
    );
    comprobar(
      'C · CERRADA POR OTRA PERSONA: abrió Rosa, cerró Jimmy, con la etiqueta',
      'Abrió Rosa + Cerró Jimmy (otra persona) + Cerrada por otra persona',
      c?.texto,
      Boolean(c?.bajo.includes('abrió rosa') && c.bajo.includes('cerró jimmy (otra persona)') && c.bajo.includes('cerrada por otra persona')),
    );
    comprobar(
      'D · RECUENTO SELLADO CORREGIDO: contó 480, cerró con 500, autorizó Jimmy en persona',
      'Recuento corregido: contó Q480.00, cerró con Q500.00 · autorizó Jimmy, en persona',
      d?.texto,
      Boolean(d?.bajo.includes('recuento corregido: contó q480.00, cerró con q500.00 · autorizó jimmy, en persona')),
    );
    comprobar(
      'E · ABIERTA con su conteo con diferencia registrado',
      'Abierta + «Tiene un conteo con diferencia ya registrado»',
      e?.texto,
      Boolean(e?.bajo.includes('abierta') && e.bajo.includes('tiene un conteo con diferencia ya registrado')),
    );

    // ---- Detalles ------------------------------------------------------------
    const abrirFila = async (indice) => {
      await ventana.locator('[data-prueba="historial-fila"]').nth(indice).locator('[data-prueba="historial-ver"]').click();
      await prueba('historial-detalle').waitFor({ timeout: ESPERA_CORTA });
      return (await prueba('historial-detalle').innerText()).replace(/\s+/g, ' ').trim();
    };
    const volver = async () => {
      await prueba('detalle-volver').click();
      await prueba('historial-lista').waitFor({ timeout: ESPERA_CORTA });
    };

    const detalleD = await abrirFila(1);
    anotar(`detalle D: ${detalleD}`);
    await capturar('2-detalle-reconteo');
    comprobar(
      'DETALLE D: el primer conteo, el final, quién autorizó la corrección y el conteo sellado',
      'Primer conteo: Q480.00 … diferencia −Q20.00 · Conteo final: Q500.00 · autorizó Jimmy, en persona',
      detalleD,
      detalleD.includes('La corrección la autorizó Jimmy, en persona') &&
        detalleD.includes('Primer conteo: Q480.00 contra Q500.00 teórico, diferencia −Q20.00') &&
        detalleD.includes('Conteo final: Q500.00 contra Q500.00 teórico, diferencia Q0.00'),
    );
    await volver();

    const detalleC = await abrirFila(2);
    anotar(`detalle C: ${detalleC}`);
    comprobar('DETALLE C: cerró Jimmy, otra persona, y autorizó el cierre ajeno', 'Jimmy — otra persona … Cierre ajeno autorizado por Jimmy', detalleC, detalleC.includes('Jimmy — otra persona, no quien abrió') && detalleC.includes('Cierre ajeno autorizado por Jimmy'));
    await volver();

    const detalleB = await abrirFila(3);
    anotar(`detalle B: ${detalleB}`);
    await capturar('3-detalle-desglose');
    comprobar(
      'DETALLE B: el desglose de apertura y de cierre por denominación, con total Q500.00',
      '2 × Q200.00 = Q400.00, 1 × Q100.00 = Q100.00, dos veces',
      detalleB,
      (detalleB.match(/2 × Q200\.00 = Q400\.00/g) ?? []).length === 2 && (detalleB.match(/1 × Q100\.00 = Q100\.00/g) ?? []).length === 2,
    );
    await volver();

    const detalleA = await abrirFila(4);
    anotar(`detalle A: ${detalleA}`);
    comprobar('DETALLE A: modo simple sin desglose, y el conteo sellado de 480', 'sin desglose + contó Q480.00', detalleA, detalleA.includes('sin desglose por denominación') && detalleA.includes('contó Q480.00'));
    await volver();

    // ---- Filtros -------------------------------------------------------------
    const idsVisibles = () => ventana.locator('[data-prueba="historial-fila"]').evaluateAll((n) => n.map((x) => x.getAttribute('data-id')));
    const todos = await idsVisibles();

    await prueba('historial-abierta-por').selectOption({ label: 'Rosa' });
    await prueba('historial-aplicar').click();
    await ventana.waitForFunction(() => document.querySelectorAll('[data-prueba="historial-fila"]').length === 2, null, { timeout: ESPERA_CORTA }).catch(() => undefined);
    const deRosa = await idsVisibles();
    anotar(`filtro Rosa: ${JSON.stringify(deRosa)}`);
    comprobar('FILTRO por quien abrió (Rosa): solo E y C, en ese orden', JSON.stringify([todos[0], todos[2]]), JSON.stringify(deRosa), JSON.stringify(deRosa) === JSON.stringify([todos[0], todos[2]]));

    await prueba('historial-abierta-por').selectOption({ label: 'Cualquier persona' });
    const hoy = diaDeGuatemala(0);
    const ayer = diaDeGuatemala(-1);
    await prueba('historial-desde').fill(hoy);
    await prueba('historial-hasta').fill(hoy);
    await prueba('historial-aplicar').click();
    await prueba('historial-periodo').waitFor({ timeout: ESPERA_CORTA });
    const deHoy = await idsVisibles();
    anotar(`filtro ${hoy} a ${hoy}: ${String(deHoy.length)} filas; período: ${await prueba('historial-periodo').innerText()}`);
    comprobar(`FILTRO por fecha HOY (${hoy}, Guatemala): las cinco`, '5', String(deHoy.length), deHoy.length === 5);

    await prueba('historial-desde').fill(ayer);
    await prueba('historial-hasta').fill(ayer);
    await prueba('historial-aplicar').click();
    await prueba('historial-vacio').waitFor({ timeout: ESPERA_CORTA });
    comprobar(`FILTRO por fecha AYER (${ayer}): ninguna, con el aviso`, 'No hay sesiones de caja con estos filtros.', await prueba('historial-vacio').innerText(), (await prueba('historial-vacio').innerText()) === 'No hay sesiones de caja con estos filtros.');

    await prueba('historial-desde').fill(hoy);
    await prueba('historial-hasta').fill('');
    await prueba('historial-aplicar').click();
    await prueba('historial-error').waitFor({ timeout: ESPERA_CORTA });
    const errorUnaFecha = await prueba('historial-error').innerText();
    anotar(`con una sola fecha: ${JSON.stringify(errorUnaFecha)}`);
    comprobar('una sola fecha: mensaje claro, no un error genérico', 'Elegí la fecha de fin del rango.', errorUnaFecha, errorUnaFecha === 'Elegí la fecha de fin del rango.');

    await prueba('historial-quitar-filtros').click();
    await ventana.waitForFunction(() => document.querySelectorAll('[data-prueba="historial-fila"]').length === 5, null, { timeout: ESPERA_CORTA });
    comprobar('«Quitar filtros» vuelve a las cinco', '5', String((await idsVisibles()).length), (await idsVisibles()).length === 5);
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
    await ventana.screenshot({ path: join(capturas, 'error.png') }).catch(() => undefined);
  } finally {
    app.process().kill('SIGKILL');
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(`\n${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
  console.info(`Carpeta de la corrida: ${datos}`);
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verificacion-de-historial-de-cajas] Falló antes de poder comprobar nada: ${error.message}`);
  process.exit(1);
});
