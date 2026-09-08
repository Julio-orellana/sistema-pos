/**
 * verificacion-de-pantallas.cjs — Maneja la aplicación REAL y comprueba lo que
 * las pruebas automatizadas no pueden ver: qué texto llega efectivamente a la
 * pantalla, y si quien lo provocó puede leerlo sin buscarlo.
 *
 * POR QUÉ EXISTE. Las pruebas de Vitest comprueban que el servicio devuelve el
 * mensaje correcto y que el envoltorio IPC lo deja pasar. Ninguna de las dos
 * puede decir si ese mensaje aparece de verdad en la ventana, ni si quedó
 * fuera de la vista. Los dos defectos que este guion habría atrapado —y que se
 * encontraron a mano— son exactamente de esa clase:
 *
 *   1. un ErrorDeNegocio se perdía detrás de "La operación no pudo
 *      completarse", así que el cajero no sabía qué corregir;
 *   2. el aviso salía en la cabecera de un formulario más alto que la
 *      pantalla, y al pulsar el botón —abajo— quedaba fuera de la vista.
 *
 * CÓMO TRABAJA. Arranca el mismo `electron .` del desarrollo, contra una
 * carpeta de datos TEMPORAL —nunca la de la tienda—, crea el primer
 * administrador, carga una categoría y recorre la pantalla de productos con
 * los mismos clics que haría una persona.
 *
 * SOBRE PLAYWRIGHT: se usa `playwright-core` y su modo de Electron
 * (`_electron.launch`), que maneja el binario de Electron que el proyecto YA
 * tiene. No descarga ningún navegador: `playwright-core` no trae guiones de
 * instalación ni dependencias, a diferencia del paquete `playwright`. Es
 * devDependency, así que no viaja en el instalador de Jimmy.
 *
 * Salida: un informe JSON en una sola línea y código 1 si algo falla.
 */

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const rutaDeElectron = require('electron');

/** Raíz del proyecto: este guion vive en scripts/. */
const PROYECTO = join(__dirname, '..');

/** Marca que la consola busca para extraer el informe. */
const MARCA_INFORME = 'INFORME_DE_PANTALLAS';

/** PIN del administrador de prueba. Solo vive en la base temporal. */
const PIN = '2468';

/** Milisegundos de espera para que la ventana aparezca. */
const ESPERA_LARGA = 25000;

/** Milisegundos de espera para un cambio de pantalla ya en marcha. */
const ESPERA_CORTA = 10000;

/** Ancho y alto de la ventana durante la verificación. */
const ANCHO = 1100;
const ALTO = 800;

/**
 * El mensaje genérico. Que ESTE aparezca en vez del específico es el defecto
 * que este guion vigila, así que se escribe una sola vez y aquí.
 */
const MENSAJE_GENERICO = 'La operación no pudo completarse.';

/** Comprobaciones hechas, con lo esperado y lo realmente encontrado. */
const comprobaciones = [];

/** Anota una comprobación. `paso` es lo que decide el código de salida. */
function comprobar(nombre, esperado, real, paso) {
  comprobaciones.push({ nombre, esperado, real, paso });
}

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-pantallas-'));

  const app = await electron.launch({
    executablePath: rutaDeElectron,
    // La carpeta de datos temporal hace dos cosas: no toca la base de la
    // tienda, y le da a esta corrida su propio candado de instancia única, así
    // que funciona aunque el punto de venta esté abierto.
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
  });

  // La ventana arranca a pantalla completa. Se la baja a un tamaño fijo para
  // que la verificación no dependa del monitor de quien la corre, y para no
  // taparle la pantalla a nadie mientras trabaja.
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

  try {
    // ---- Preparación: administrador y una categoría ------------------------
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Administrador de verificación');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN);
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });

    await prueba('ir-a-categorias').click();
    await prueba('categoria-nombre').fill('Granos');
    await prueba('categoria-guardar').click();
    await ventana.locator('[data-prueba="lista-de-categorias"] li').first().waitFor();
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();

    // =======================================================================
    // 1. Un precio negativo muestra el mensaje ESPECÍFICO, no el genérico.
    // =======================================================================
    await prueba('ir-a-productos').click();
    await prueba('productos-nuevo').click();
    await prueba('formulario-de-producto').waitFor({ timeout: ESPERA_CORTA });

    await prueba('producto-nombre').fill('Producto de verificación');
    await prueba('producto-precio').fill('-5.00');
    await prueba('producto-inventario-inicial').fill('10');

    const botonGuardar = prueba('producto-guardar');
    comprobar(
      'el formulario deja intentar guardar un precio negativo (la regla es del servicio, no de la pantalla)',
      'habilitado',
      (await botonGuardar.isDisabled()) ? 'deshabilitado' : 'habilitado',
      !(await botonGuardar.isDisabled()),
    );

    await botonGuardar.click();
    const avisoDeError = prueba('producto-error');
    await avisoDeError.waitFor({ timeout: ESPERA_CORTA });
    const textoDelError = (await avisoDeError.textContent())?.trim() ?? '';

    comprobar(
      'el precio negativo se rechaza con un mensaje de negocio, no con el genérico',
      `algo distinto de "${MENSAJE_GENERICO}"`,
      textoDelError,
      textoDelError !== MENSAJE_GENERICO && textoDelError.length > 0,
    );

    comprobar(
      'ese mensaje nombra el problema concreto: el precio',
      'menciona "precio" y "negativo"',
      textoDelError,
      /precio/i.test(textoDelError) && /negativ/i.test(textoDelError),
    );

    // El defecto de ubicación: el aviso tiene que estar A LA VISTA sin que
    // nadie tenga que desplazarse a buscarlo.
    const caja = await avisoDeError.boundingBox();
    const dentroDeLaVista =
      caja !== null && caja.y >= 0 && caja.y + caja.height <= ALTO;
    comprobar(
      'el aviso queda dentro de la pantalla sin tener que desplazarse',
      `entre 0 y ${String(ALTO)} px`,
      caja === null ? '(no se pudo medir)' : `de ${String(Math.round(caja.y))} a ${String(Math.round(caja.y + caja.height))} px`,
      dentroDeLaVista,
    );

    // Y no se guardó nada.
    await ventana.getByRole('button', { name: 'Cancelar' }).click();
    await prueba('pantalla-de-productos').waitFor();
    const cuerpo = (await ventana.locator('body').textContent()) ?? '';
    comprobar(
      'el producto rechazado NO queda guardado',
      'ausente del listado',
      cuerpo.includes('Producto de verificación') ? 'presente (mal)' : 'ausente',
      !cuerpo.includes('Producto de verificación'),
    );

    // =======================================================================
    // 2. Un producto sin foto muestra un marcador, no un hueco.
    // =======================================================================
    await prueba('productos-nuevo').click();
    await prueba('formulario-de-producto').waitFor();
    await prueba('producto-nombre').fill('Maíz blanco');
    await prueba('producto-precio').fill('4.25');
    await prueba('producto-inventario-inicial').fill('100');
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });

    const marcador = prueba('miniatura-sin-foto').first();
    const hayMarcador = (await marcador.count()) > 0;
    const textoDelMarcador = hayMarcador ? ((await marcador.textContent()) ?? '').trim() : '';
    comprobar(
      'un producto sin foto muestra sus iniciales, no un recuadro vacío',
      'MB',
      hayMarcador ? textoDelMarcador : '(no hay marcador)',
      textoDelMarcador === 'MB',
    );

    const etiquetaAccesible = hayMarcador ? await marcador.getAttribute('aria-label') : null;
    comprobar(
      'el marcador se le anuncia a un lector de pantalla',
      'una etiqueta que diga que falta la foto',
      etiquetaAccesible ?? '(sin etiqueta)',
      typeof etiquetaAccesible === 'string' && /sin foto/i.test(etiquetaAccesible),
    );
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
  } finally {
    // NO se usa app.close(): llama a app.quit(), que el kiosko intercepta para
    // pedir el PIN de salida controlada, y la aplicación no cerraría nunca.
    app.process().kill('SIGKILL');
    rmSync(datos, { recursive: true, force: true });
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);

  for (const c of comprobaciones) {
    console.info(`  ${c.paso ? 'OK   ' : 'FALLA'} ${c.nombre}`);
    if (!c.paso) {
      console.info(`         esperado: ${String(c.esperado)}`);
      console.info(`         real    : ${String(c.real)}`);
    }
  }

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
  console.error(`[verificacion-de-pantallas] Falló antes de poder comprobar nada: ${error.message}`);
  process.exit(1);
});
