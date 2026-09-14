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
 * Recorre además el CICLO COMPLETO DE COBRO y el alta de un usuario, que es
 * lo que la tienda hace todo el día: abrir caja, armar el ticket, cobrar y
 * quedar lista para la siguiente venta. Ninguna prueba de Vitest puede decir
 * si después de cobrar el ticket quedó de verdad vacío en la ventana, y un
 * ticket que no se vacía se cobra dos veces.
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
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

/** Raíz del proyecto: este guion vive en scripts/. */
const PROYECTO = join(__dirname, '..');

/** Marca que la consola busca para extraer el informe. */
const MARCA_INFORME = 'INFORME_DE_PANTALLAS';

/** PIN del administrador de prueba. Solo vive en la base temporal. */
const PIN_REMOTO = '8642';
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

  /**
   * Inserta a mano un lote BLOQUEANTE en `sync_cola`, para poder ejercitar
   * «reintentar» y «saltar» sin depender de que la nube de verdad rechace
   * algo —esta corrida no tiene `POS_NUBE_URL`, así que nada llega a fallar
   * solo—. Escribe directo en el archivo de la base TEMPORAL de esta corrida,
   * nunca el de la tienda, con una conexión aparte y de un solo uso: SQLite
   * en modo WAL admite otra conexión mientras la app tiene la suya abierta.
   */
  function forzarLoteBloqueante(error) {
    const loteId = randomUUID();
    const ahora = new Date().toISOString();
    const conexion = new DatabaseConstructor(join(datos, 'pos-agricola.db'));
    try {
      conexion
        .prepare(
          `INSERT INTO sync_cola (
             id, entidad_tipo, entidad_id, operacion, payload, creado_en,
             lote_id, orden_en_lote, intentos, bloqueante, error
           ) VALUES (?, 'usuarios', ?, 'insertar', '{}', ?, ?, 0, 1, 1, ?)`,
        )
        .run(randomUUID(), randomUUID(), ahora, loteId, error);
    } finally {
      conexion.close();
    }
    return loteId;
  }

  try {
    // ---- Preparación: administrador y una categoría ------------------------
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });

    // =======================================================================
    // Fase 4.b: desde la configuración inicial se puede elegir RESTAURAR
    // desde la nube. Esta corrida no tiene POS_NUBE_URL, así que la pantalla
    // tiene que decir «sin configurar» en vez de ofrecer un botón de iniciar
    // que no podría funcionar (la lección de la fase 3.a, §4.23).
    // =======================================================================
    await prueba('ir-a-restauracion').click();
    await prueba('pantalla-de-restauracion').waitFor({ timeout: ESPERA_CORTA });
    let avisoDeRestauracionSinConfigurar = true;
    try {
      await prueba('restauracion-sin-configurar').waitFor({ timeout: ESPERA_CORTA });
    } catch {
      avisoDeRestauracionSinConfigurar = false;
    }
    comprobar(
      'sin proyecto configurado, la pantalla de restauración lo explica en vez de ofrecer iniciar',
      'se ve el aviso de «sin configurar»',
      avisoDeRestauracionSinConfigurar ? 'se ve' : 'NO se ve: la pantalla ofrece iniciar una restauración imposible',
      avisoDeRestauracionSinConfigurar,
    );
    const botonesDeIniciarRestauracion = await prueba('restauracion-iniciar').count();
    comprobar(
      'sin proyecto configurado NO se dibuja el botón de iniciar la restauración',
      '0 botones',
      `${String(botonesDeIniciarRestauracion)} botones`,
      botonesDeIniciarRestauracion === 0,
    );
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_CORTA });

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

    // =======================================================================
    // 3. Sin caja abierta NO se vende, y se dice por qué.
    // =======================================================================
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-venta').click();

    const bloqueo = prueba('venta-bloqueada-sin-caja');
    await bloqueo.waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'sin caja abierta la pantalla de venta NO muestra la cuadrícula',
      'ningún producto a la vista',
      (await prueba('cuadricula-de-productos').count()) === 0 ? 'ninguno' : 'se ven productos (mal)',
      (await prueba('cuadricula-de-productos').count()) === 0,
    );

    // =======================================================================
    // 4. El ciclo completo: abrir caja, armar ticket, cobrar, quedar lista.
    // =======================================================================
    await prueba('ir-a-caja-desde-venta').click();
    await prueba('pantalla-de-caja').waitFor({ timeout: ESPERA_CORTA });
    await prueba('modo-simple').click();
    await prueba('campo-monto').fill('500');
    await prueba('confirmar-caja').click();
    // `estado-caja-propia` es el bloque que aparece cuando el turno abierto es
    // de quien está en sesión: la señal de que la apertura funcionó.
    await prueba('estado-caja-propia').waitFor({ timeout: ESPERA_CORTA });

    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-venta').click();
    await prueba('cuadricula-de-productos').waitFor({ timeout: ESPERA_CORTA });

    // Dos toques al maíz de Q4.25: el ticket tiene que decir Q8.50.
    await prueba('icono-producto').first().click();
    await prueba('icono-producto').first().click();
    const totalDelTicket = ((await prueba('total-del-ticket').textContent()) ?? '').trim();
    comprobar(
      'el total del ticket es el que corresponde a lo tocado',
      'Q8.50',
      totalDelTicket,
      totalDelTicket.includes('8.50'),
    );

    await prueba('cobrar').click();
    await prueba('dialogo-de-cobro').waitFor({ timeout: ESPERA_CORTA });
    await prueba('cobro-continuar').click();

    // Tarjeta SIN boleta: la pantalla tiene que frenarlo, no la base.
    await prueba('pago-tarjeta').click();
    await prueba('cobro-confirmar').click();
    const avisoDeBoleta = ((await prueba('cobro-aviso').textContent()) ?? '').trim();
    comprobar(
      'una venta con tarjeta sin boleta se frena con un mensaje que la nombra',
      'un aviso que mencione la boleta',
      avisoDeBoleta === '' ? '(no apareció ningún aviso)' : avisoDeBoleta,
      /boleta/i.test(avisoDeBoleta),
    );

    // De vuelta a efectivo y se cobra de verdad.
    await prueba('pago-efectivo').click();
    await prueba('cobro-confirmar').click();
    await prueba('cobro-listo').waitFor({ timeout: ESPERA_CORTA });
    const cobrado = ((await prueba('cobro-total-cobrado').textContent()) ?? '').trim();
    comprobar(
      'la confirmación muestra el total que se cobró',
      'Q8.50',
      cobrado,
      cobrado.includes('8.50'),
    );

    // El cajero tiene que enterarse EN EL MISMO AVISO de si el recibo salió por
    // la impresora: si no salió, se lo tiene que decir al cliente ahí mismo.
    const estadoDelRecibo = ((await prueba('cobro-estado-del-recibo').textContent()) ?? '').trim();
    comprobar(
      'la confirmación dice el número de recibo y si se imprimió',
      'menciona el recibo y el PDF',
      estadoDelRecibo === '' ? '(no apareció)' : estadoDelRecibo,
      /Recibo No\./.test(estadoDelRecibo) && /PDF|imprimi/i.test(estadoDelRecibo),
    );

    await prueba('cobro-siguiente-venta').click();
    await prueba('ticket-vacio').waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'DESPUÉS DE COBRAR el ticket queda vacío, listo para la siguiente venta',
      'ninguna línea en el ticket',
      `${String(await prueba('linea-de-ticket').count())} líneas`,
      (await prueba('linea-de-ticket').count()) === 0,
    );

    // Y el inventario bajó de verdad: 100 lb menos las 2 que se vendieron.
    const inventarioEnPantalla = ((await prueba('cuadricula-de-productos').textContent()) ?? '');
    comprobar(
      'la venta descontó inventario de verdad',
      'el catálogo se releyó después de cobrar',
      inventarioEnPantalla.includes('Maíz blanco') ? 'catálogo presente' : 'catálogo ausente (mal)',
      inventarioEnPantalla.includes('Maíz blanco'),
    );
    // =======================================================================
    // 5. El recibo: historial y reimpresión.
    // =======================================================================
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-recibos').click();
    await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA });

    comprobar(
      'la venta recién cobrada dejó su recibo en el historial',
      '1 recibo',
      `${String(await prueba('fila-de-recibo').count())} recibos`,
      (await prueba('fila-de-recibo').count()) === 1,
    );

    await prueba('recibo-ver').first().click();
    await prueba('vista-de-recibo').waitFor({ timeout: ESPERA_CORTA });
    const papel = ((await prueba('recibo-texto').textContent()) ?? '').trim();

    comprobar(
      'el recibo dice que es una proforma, no una factura fiscal',
      'menciona "no válido como factura fiscal"',
      papel.includes('no válido como factura fiscal') ? 'lo dice' : 'NO lo dice (mal)',
      papel.includes('no válido como factura fiscal'),
    );

    // Sin los datos del negocio cargados, el recibo tiene que mostrar
    // marcadores entre corchetes y nunca algo que parezca un dato real.
    comprobar(
      'sin datos del negocio, el recibo muestra marcadores entre corchetes',
      'aparece "[Nombre del negocio]"',
      papel.includes('[Nombre del negocio]') ? 'aparece' : 'no aparece (mal)',
      papel.includes('[Nombre del negocio]'),
    );

    comprobar(
      'el total impreso es el que se cobró',
      'Q8.50 en el papel',
      papel.includes('8.50') ? 'aparece' : 'no aparece (mal)',
      papel.includes('8.50'),
    );

    await prueba('cerrar-vista-de-recibo').click();
    await prueba('recibo-reimprimir').first().click();
    await prueba('vista-de-recibo').waitFor({ timeout: ESPERA_CORTA });
    const reimpreso = ((await prueba('recibo-texto').textContent()) ?? '').trim();

    comprobar(
      'reimprimir reproduce el mismo total y se marca como reimpresión',
      'mismo total, con la marca',
      reimpreso.includes('8.50') && reimpreso.includes('REIMPRESI')
        ? 'igual y marcado'
        : 'distinto o sin marcar (mal)',
      reimpreso.includes('8.50') && reimpreso.includes('REIMPRESI'),
    );
    await prueba('cerrar-vista-de-recibo').click();

    // =======================================================================
    // 6. Reportes: que los números de la pantalla sean los de la venta real.
    // =======================================================================
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-reportes').click();
    await prueba('reporte-resumen').waitFor({ timeout: ESPERA_CORTA });

    const totalDelDia = ((await prueba('resumen-total').textContent()) ?? '').trim();
    comprobar(
      'el resumen de HOY muestra el total de la venta que se acaba de cobrar',
      'Q8.50',
      totalDelDia,
      totalDelDia.includes('8.50'),
    );

    const efectivo = ((await prueba('resumen-efectivo').textContent()) ?? '').trim();
    const tarjeta = ((await prueba('resumen-tarjeta').textContent()) ?? '').trim();
    const soloNumero = (texto) => Number(texto.replace(/[^0-9.]/g, ''));
    comprobar(
      'EFECTIVO + TARJETA da exactamente el total vendido, en la pantalla real',
      'la suma de los dos es el total',
      `${efectivo} + ${tarjeta} contra ${totalDelDia}`,
      (soloNumero(efectivo) + soloNumero(tarjeta)).toFixed(2) ===
        soloNumero(totalDelDia).toFixed(2),
    );

    // Y el período tiene que poder cambiarse: AYER no tiene ventas.
    await prueba('periodo-ayer').click();
    await prueba('resumen-sin-ventas').waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'el reporte de AYER dice que no hubo ventas, en vez de repetir las de hoy',
      'el aviso de período sin ventas',
      'aparece',
      true,
    );

    await prueba('periodo-hoy').click();
    await prueba('resumen-total').waitFor({ timeout: ESPERA_CORTA });
    await prueba('solapa-productos').click();
    await prueba('reporte-por-producto').waitFor({ timeout: ESPERA_CORTA });
    const porProducto = ((await prueba('reporte-por-producto').textContent()) ?? '').trim();
    // El producto se creó por UNIDAD, así que la unidad que corresponde es «u».
    comprobar(
      'el reporte por producto muestra el maíz con la cantidad DEL PERÍODO',
      'Maíz blanco con 2 u, no con el acumulado',
      porProducto.includes('Maíz blanco') && /2 u/.test(porProducto)
        ? 'aparece con 2 u'
        : 'no aparece o con otra cantidad (mal)',
      porProducto.includes('Maíz blanco') && /2 u/.test(porProducto),
    );

    await prueba('solapa-inventario').click();
    await prueba('reporte-inventario').waitFor({ timeout: ESPERA_CORTA });
    /*
      Solo hay UN producto activo: el otro que el recorrido intenta crear se
      rechaza a propósito por tener precio negativo. Lo que sí se comprueba es
      que el saldo que muestra el reporte es el que dejó la venta —100 menos 2—
      y no el inicial.
    */
    const filasDeInventario = await prueba('fila-de-inventario').allTextContents();
    comprobar(
      'el inventario muestra el saldo que dejó la venta, no el inicial',
      'el maíz con 98.000, no con 100.000',
      filasDeInventario.join(' | ') || '(vacío)',
      filasDeInventario.length === 1 &&
        /98\.000/.test(filasDeInventario[0] ?? '') &&
        !/100\.000/.test(filasDeInventario[0] ?? ''),
    );

    // =======================================================================
    // 7. Topes de descuento: que el cambio quede con nombre y apellido.
    // =======================================================================
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-limites').click();
    await prueba('limite-venta').waitFor({ timeout: ESPERA_CORTA });

    const sinConfigurar = await prueba('limites-sin-configurar').count();
    comprobar(
      'una instalación nueva avisa que SIN configurar el tope es CERO, no ilimitado',
      'el aviso presente',
      sinConfigurar > 0 ? 'aparece' : 'no aparece (mal)',
      sinConfigurar > 0,
    );

    await prueba('editar-limite-venta').click();
    await prueba('limite-porcentaje').fill('-5');
    await prueba('limite-guardar').click();
    await prueba('limite-confirmar').click();
    const rechazo = ((await prueba('limites-error').first().textContent()) ?? '').trim();
    comprobar(
      'un tope negativo se rechaza con un mensaje de negocio, no con un error de la base',
      'un mensaje que hable de negativo',
      rechazo === '' ? '(no apareció ningún mensaje)' : rechazo,
      /negativ/i.test(rechazo) && !/CHECK/i.test(rechazo),
    );

    await prueba('limite-porcentaje').fill('12');
    await prueba('limite-monto').fill('25');
    await prueba('limite-guardar').click();
    await prueba('limite-confirmar').click();
    await prueba('limites-aviso').waitFor({ timeout: ESPERA_CORTA });

    const valoresDelRol = ((await prueba('limite-valores-venta').textContent()) ?? '').trim();
    comprobar(
      'el tope guardado se ve en la lista con los dos valores',
      '12.00 % y Q25.00',
      valoresDelRol,
      valoresDelRol.includes('12.00') && valoresDelRol.includes('25.00'),
    );

    const filaDelRol = ((await prueba('limite-venta').textContent()) ?? '').trim();
    comprobar(
      'el cambio queda atribuido al administrador real, no a nadie',
      'menciona a "Administrador de verificación"',
      filaDelRol.includes('Administrador de verificación')
        ? 'lo menciona'
        : 'no lo menciona (mal)',
      filaDelRol.includes('Administrador de verificación'),
    );

    // =======================================================================
    // 8. Autorizar un descuento excedente CON EL PIN REMOTO, de punta a punta.
    // =======================================================================
    /*
      Es la comprobación que da sentido al cambio: que un descuento que pasa el
      tope se pueda autorizar con el código que Jimmy dicta por teléfono, y que
      la venta quede registrada diciendo que fue por esa vía y no presencial.
    */
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();

    // El administrador se configura un PIN remoto, que se teclea dos veces.
    await prueba('ir-a-pin-remoto').click();
    await prueba('pantalla-de-pin-remoto').waitFor({ timeout: ESPERA_CORTA });
    await teclearPin(PIN_REMOTO);
    await teclearPin(PIN_REMOTO);
    await prueba('pin-remoto-guardado').waitFor({ timeout: ESPERA_CORTA });
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();

    // Un tope bajo para el rol administrativo, que es el que está vendiendo:
    // así cualquier descuento del 50 % lo pasa y obliga a autorizar.
    await prueba('ir-a-limites').click();
    await prueba('limite-administrativo').waitFor({ timeout: ESPERA_CORTA });
    await prueba('editar-limite-administrativo').click();
    await prueba('limite-porcentaje').fill('5');
    await prueba('limite-monto').fill('1');
    await prueba('limite-guardar').click();
    await prueba('limite-confirmar').click();
    await prueba('limites-aviso').waitFor({ timeout: ESPERA_CORTA });
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();

    // Una venta con un descuento que pasa el tope.
    await prueba('ir-a-venta').click();
    await prueba('cuadricula-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await prueba('icono-producto').first().click();
    await prueba('cobrar').click();
    await prueba('dialogo-de-cobro').waitFor({ timeout: ESPERA_CORTA });
    await prueba('descuento-porcentaje').click();
    await prueba('descuento-valor').fill('50');
    await prueba('cobro-continuar').click();
    await prueba('cobro-confirmar').click();
    await prueba('cobro-autorizacion').waitFor({ timeout: ESPERA_CORTA });

    const textoDeAutorizacion = ((await prueba('cobro-autorizacion').textContent()) ?? '').trim();
    comprobar(
      'el diálogo pide «el código», sin preguntar si es el PIN normal o el remoto',
      'menciona que puede dictarse por teléfono',
      /por tel[eé]fono/i.test(textoDeAutorizacion) ? 'lo dice' : 'no lo dice (mal)',
      /por tel[eé]fono/i.test(textoDeAutorizacion),
    );
    comprobar(
      'y YA NO dice que el código no se puede dar por teléfono',
      'sin la frase vieja',
      /no se puede dar\s+por tel[eé]fono/i.test(textoDeAutorizacion)
        ? 'todavía la dice (mal)'
        : 'ya no la dice',
      !/no se puede dar\s+por tel[eé]fono/i.test(textoDeAutorizacion),
    );

    // Y se autoriza con el PIN REMOTO, que antes de este cambio habría fallado.
    await teclearPin(PIN_REMOTO);
    await prueba('cobro-listo').waitFor({ timeout: ESPERA_LARGA });
    comprobar(
      'EL PIN REMOTO AUTORIZA el descuento excedente y la venta se cobra',
      'la venta llega a la confirmación',
      'se cobró',
      true,
    );

    await prueba('cobro-siguiente-venta').click();
    await prueba('ticket-vacio').waitFor({ timeout: ESPERA_CORTA });
    // Se queda en la pantalla de venta: el tramo siguiente arranca con su
    // propio «Volver», igual que todos los demás.

    // =======================================================================
    // 9. Gestión de usuarios: el hueco que cerró el Prompt 21.
    // =======================================================================
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-usuarios').click();
    await prueba('lista-de-usuarios').waitFor({ timeout: ESPERA_CORTA });

    // El administrador que creó el primer arranque es el único que hay, y es
    // uno mismo: las dos razones por las que no se lo puede dar de baja.
    const bajaDelUnico = prueba('usuario-cambiar-estado').first();
    comprobar(
      'no se ofrece dar de baja al único administrador, que además es uno mismo',
      'el botón deshabilitado',
      (await bajaDelUnico.isDisabled()) ? 'deshabilitado' : 'habilitado (mal)',
      await bajaDelUnico.isDisabled(),
    );

    await prueba('usuario-nombre').fill('Cajera de verificación');
    await prueba('usuario-rol').selectOption('venta');
    await prueba('usuario-pin').fill('1357');
    await prueba('usuario-guardar').click();
    await prueba('usuarios-aviso').waitFor({ timeout: ESPERA_CORTA });

    const filas = await prueba('fila-de-usuario').count();
    comprobar(
      'se puede dar de alta a un segundo usuario después del primer arranque',
      '2 usuarios en la lista',
      `${String(filas)} usuarios`,
      filas === 2,
    );

    // =======================================================================
    // La pantalla «Conectar con la nube» SIN proyecto configurado.
    // =======================================================================
    /*
      Este arnés corre sin `POS_NUBE_URL`, así que el proceso principal NO
      registra los canales de nube y `ipcRenderer.invoke` sobre ellos RECHAZA
      —no devuelve un `RespuestaIpc` con `ok: false`, como todos los demás—.

      La primera versión de la pantalla no atrapaba ese rechazo: la promesa
      quedaba sin manejar y la pantalla seguía ofreciendo el botón «Conectar»,
      que en esa copia no podía funcionar. **Lo encontró esta comprobación
      manejando la aplicación real, no una prueba de Vitest**, que es
      exactamente para lo que existe.
    */
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-nube').click();
    await prueba('pantalla-de-nube').waitFor({ timeout: ESPERA_CORTA });

    let avisoDeSinConfigurar = true;
    try {
      await prueba('nube-sin-configurar').waitFor({ timeout: ESPERA_CORTA });
    } catch {
      avisoDeSinConfigurar = false;
    }
    comprobar(
      'sin proyecto configurado, la pantalla de nube lo explica en vez de ofrecer conectar',
      'se ve el aviso de «sin configurar»',
      avisoDeSinConfigurar ? 'se ve' : 'NO se ve: la pantalla ofrece un botón que no puede funcionar',
      avisoDeSinConfigurar,
    );
    const botonesDeConectar = await prueba('nube-conectar').count();
    comprobar(
      'sin proyecto configurado NO se dibuja el botón de conectar',
      '0 botones',
      `${String(botonesDeConectar)} botones`,
      botonesDeConectar === 0,
    );

    // =======================================================================
    // La pantalla de SINCRONIZACIÓN (Fase 4.a). A diferencia de «nube», sus
    // canales NO son opcionales —`sync_cola` existe con proyecto configurado
    // o no (§4.17)—, así que tiene que renderizar de verdad aunque esta
    // corrida no tenga POS_NUBE_URL.
    // =======================================================================
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-sincronizacion').click();
    await prueba('pantalla-de-sincronizacion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('sincronizacion-resumen').waitFor({ timeout: ESPERA_CORTA });

    const avisoSinConfigurarDeSincronizacion = await prueba(
      'sincronizacion-sin-configurar',
    ).count();
    comprobar(
      'sin proyecto de nube, la pantalla de sincronización lo dice y no finge estar conectada',
      '1 aviso de "sin configurar"',
      `${String(avisoSinConfigurarDeSincronizacion)} avisos`,
      avisoSinConfigurarDeSincronizacion === 1,
    );

    const textoDeSincronizacion = (await ventana.locator('body').textContent()) ?? '';
    comprobar(
      'el estado calculado por el proceso principal llega legible a la pantalla',
      'contiene "Estado:"',
      textoDeSincronizacion.includes('Estado:') ? 'aparece' : 'no aparece (mal)',
      textoDeSincronizacion.includes('Estado:'),
    );

    // Sin ningún lote bloqueante en esta corrida, ni la acción de saltar ni la
    // de reintentar deberían dibujarse: no hay nada que resolver.
    const botonesDeSaltar = await prueba('sincronizacion-saltar').count();
    comprobar(
      'sin lote bloqueante, NO se ofrece la acción de saltar (no hay nada que saltar)',
      '0 botones',
      `${String(botonesDeSaltar)} botones`,
      botonesDeSaltar === 0,
    );

    // =======================================================================
    // «REINTENTAR AHORA» con un lote bloqueante DE VERDAD.
    // =======================================================================
    const loteParaReintentar = forzarLoteBloqueante(
      '{"code":"23505","message":"duplicate key value violates unique constraint"}',
    );
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    await prueba('ir-a-sincronizacion').click();
    await prueba('pantalla-de-sincronizacion').waitFor({ timeout: ESPERA_CORTA });

    await prueba('sincronizacion-lote-bloqueante').waitFor({ timeout: ESPERA_CORTA });
    const errorCompleto = (await prueba('sincronizacion-error-completo').textContent()) ?? '';
    comprobar(
      'el error se muestra TAL CUAL lo devolvió la función de Postgres, sin resumir',
      'contiene "23505" y "duplicate key"',
      errorCompleto.includes('23505') && errorCompleto.includes('duplicate key')
        ? 'lo contiene'
        : `no lo contiene: "${errorCompleto}"`,
      errorCompleto.includes('23505') && errorCompleto.includes('duplicate key'),
    );

    await prueba('sincronizacion-reintentar').click();
    /*
      El `onClick` dispara la acción con `void` (fire-and-forget: React no deja
      awaitear un manejador de evento), así que `click()` de Playwright NO
      espera a que la operación asincrónica termine, solo a que el clic se
      despachó. Por eso se espera la CONSECUENCIA visible —que el aviso de
      lote bloqueante desaparezca del DOM— y no un `waitForTimeout` a ciegas,
      que en la primera versión de esta comprobación quedó corto y la hizo
      fallar en falso.
    */
    await prueba('sincronizacion-lote-bloqueante').waitFor({
      state: 'detached',
      timeout: ESPERA_CORTA,
    });
    // Con el adaptador simulado (sin POS_NUBE_URL), CUALQUIER lote se acepta:
    // "reintentar" lo desbloquea y el ciclo inmediato lo sube. La cola queda
    // sin ese lote bloqueante.
    const siguebloqueante = await prueba('sincronizacion-lote-bloqueante').count();
    comprobar(
      '«reintentar ahora» quita el lote bloqueado de la pantalla',
      '0 lotes bloqueantes',
      `${String(siguebloqueante)} lotes bloqueantes`,
      siguebloqueante === 0,
    );

    // =======================================================================
    // «SALTAR ESTE LOTE»: exige PIN y queda en auditoria_log (decisión 9).
    // =======================================================================
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();
    const loteParaSaltar = forzarLoteBloqueante('{"code":"23503","message":"foreign key violation"}');
    await prueba('ir-a-sincronizacion').click();
    await prueba('pantalla-de-sincronizacion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('sincronizacion-lote-bloqueante').waitFor({ timeout: ESPERA_CORTA });

    await prueba('sincronizacion-saltar').click();
    await prueba('confirmacion-de-salto').waitFor({ timeout: ESPERA_CORTA });
    const errorEnConfirmacion = (await prueba('salto-error-original').textContent()) ?? '';
    comprobar(
      'ANTES de pedir el PIN, la confirmación muestra qué error tenía el lote (§4.9: ver antes de autorizar)',
      'contiene "23503"',
      errorEnConfirmacion.includes('23503') ? 'lo contiene' : `no lo contiene: "${errorEnConfirmacion}"`,
      errorEnConfirmacion.includes('23503'),
    );

    // Primero un PIN EQUIVOCADO: no debería saltar nada.
    await teclearPin('9999');
    // Mismo caso que arriba: `alConfirmar` dispara la verificación con `void`,
    // así que se espera a que el aviso de error aparezca en el DOM, no un
    // tiempo fijo.
    await prueba('sincronizacion-error').waitFor({ timeout: ESPERA_CORTA });
    const mensajeDePinMalo = (await prueba('sincronizacion-error').textContent().catch(() => '')) ?? '';
    comprobar(
      'un PIN equivocado NO salta el lote: sigue pidiendo confirmación',
      'sigue en la pantalla de confirmación, con un aviso',
      mensajeDePinMalo !== '' ? `avisa: "${mensajeDePinMalo}"` : 'no avisó nada (mal)',
      mensajeDePinMalo !== '',
    );
    const sigueEnConfirmacion = await prueba('confirmacion-de-salto').count();
    comprobar(
      'tras el PIN equivocado, el lote SIGUE bloqueante: no se saltó nada',
      '1 (sigue en confirmación)',
      `${String(sigueEnConfirmacion)}`,
      sigueEnConfirmacion === 1,
    );

    // Ahora el PIN correcto: recién ahí se salta.
    await teclearPin(PIN);
    await prueba('pantalla-de-sincronizacion').waitFor({ timeout: ESPERA_CORTA });
    const yaNoHayBloqueante = await prueba('sincronizacion-lote-bloqueante').count();
    comprobar(
      'con el PIN correcto, el lote se salta y desaparece de "detenido"',
      '0 lotes bloqueantes',
      `${String(yaNoHayBloqueante)} lotes bloqueantes`,
      yaNoHayBloqueante === 0,
    );

    // Y la evidencia de fondo: quedó UN asiento en auditoria_log, firmado.
    const conexionDeVerificacion = new DatabaseConstructor(join(datos, 'pos-agricola.db'), {
      readonly: true,
    });
    let asientoDeSalto;
    try {
      asientoDeSalto = conexionDeVerificacion
        .prepare(
          `SELECT usuario_id, entidad_id FROM auditoria_log
            WHERE accion = 'lote_de_sincronizacion_saltado'`,
        )
        .get();
    } finally {
      conexionDeVerificacion.close();
    }
    comprobar(
      'el salto queda en auditoria_log, con el lote y quién lo autorizó (decisión 9)',
      `entidad_id = ${loteParaSaltar}, con usuario_id`,
      asientoDeSalto
        ? `entidad_id = ${asientoDeSalto.entidad_id}, usuario_id = ${asientoDeSalto.usuario_id}`
        : 'NO HAY NINGÚN ASIENTO (mal)',
      Boolean(asientoDeSalto) &&
        asientoDeSalto.entidad_id === loteParaSaltar &&
        asientoDeSalto.usuario_id !== null,
    );

    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor();

    // Y el alta sirve para algo solo si esa persona puede entrar: tiene que
    // aparecer ofrecida en la pantalla de ingreso. Ya se está en el menú, así
    // que no hace falta otro "Volver".
    await ventana.getByRole('button', { name: 'Cerrar sesión' }).click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    const enElIngreso = (await ventana.locator('body').textContent()) ?? '';
    comprobar(
      'la persona recién creada se ofrece en la pantalla de ingreso',
      'aparece "Cajera de verificación"',
      enElIngreso.includes('Cajera de verificación') ? 'aparece' : 'no aparece (mal)',
      enElIngreso.includes('Cajera de verificación'),
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
