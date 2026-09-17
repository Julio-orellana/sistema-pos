/**
 * verificacion-de-anulacion.cjs — Anular una venta en la aplicación REAL,
 * desde el historial de recibos (docs/ANULACION-DE-VENTA.md §10.2).
 *
 * El escenario se arma por los canales REALES de la ventana —usuarios,
 * catálogo, caja y cobro— y la anulación se maneja **con clics**, que es lo que
 * ninguna prueba de Vitest puede ver:
 *
 *   1. Ana abre la caja y cobra dos ventas: una en efectivo y una con tarjeta.
 *   2. En el historial, las dos ofrecen «Anular».
 *   3. Se pide anular la de efectivo, se ve la vista previa y **se cancela**:
 *      la base queda como estaba, sin una sola fila nueva.
 *   4. Se reintenta. Un PIN equivocado deja su asiento y no anula nada.
 *   5. Con el PIN de Jimmy se anula, y la confirmación muestra los montos ya
 *      ajustados: lo que deja de contar la caja y el inventario repuesto. **El
 *      PDF del disco ya está marcado en ese mismo momento**, sin que nadie lo
 *      haya reimpreso: se abre el archivo y se lee lo que dice adentro.
 *   6. La fila pasa a decir «Anulada» y pierde su botón; el recibo reimpreso
 *      lleva la marca con las mismas cifras.
 *   7. Con la de tarjeta, un voucher equivocado se rechaza **sin llegar al
 *      teclado del PIN** y sin tocar el candado ni la base.
 *   8. Con el voucher correcto sí se anula.
 *   9. Cerrada la caja, ningún recibo ofrece «Anular» y el canal se niega.
 *
 * Al final lee la base con otra conexión y guarda capturas.
 *
 * Salida: cada comprobación con lo esperado y lo real, y código 1 si alguna falla.
 */

const { createHash } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { textoDelPdf } = require('./texto-de-pdf.cjs');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

const PROYECTO = join(__dirname, '..');
const PIN_JIMMY = '2468';
const PIN_ANA = '1357';
const PIN_MALO = '0000';
const VOUCHER = 'B-7741';
const VOUCHER_EQUIVOCADO = 'B-9999';
const MOTIVO = 'el cliente devolvió el producto';
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

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-anulacion-'));
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
  const capturar = async (nombre) => {
    await new Promise((r) => {
      setTimeout(r, 600);
    });
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
  /**
   * El PDF del recibo de una venta, TAL COMO ESTÁ EN EL DISCO.
   *
   * La fila guarda la ruta relativa; la absoluta se arma con la carpeta de
   * datos de esta corrida, que es la misma que usa la aplicación.
   */
  const pdfDeLaVenta = (ventaId) => {
    const [fila] = leerBase('SELECT pdf_path FROM recibos WHERE venta_id = ?', ventaId);
    if (fila === undefined) {
      throw new Error(`La venta ${ventaId} no tiene recibo.`);
    }
    const ruta = join(datos, fila.pdf_path);
    const bytes = readFileSync(ruta);
    return {
      ruta,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      modificado: statSync(ruta).mtimeMs,
      // Lo que el archivo DICE, traducido de sus glifos (ver texto-de-pdf.cjs).
      texto: textoDelPdf(ruta),
    };
  };

  /** Una foto de todo lo que una anulación escribiría. */
  const fotoDeLaBase = () =>
    JSON.stringify({
      anulaciones: leerBase('SELECT count(*) AS n FROM anulaciones_de_venta')[0].n,
      asientos: leerBase('SELECT count(*) AS n FROM auditoria_log')[0].n,
      cola: leerBase('SELECT count(*) AS n FROM sync_cola')[0].n,
      candado: leerBase('SELECT superficie, intentos_fallidos FROM bloqueos_de_autorizacion ORDER BY superficie'),
      inventario: leerBase("SELECT inventario_disponible AS s FROM productos")[0].s,
    });
  const pos = (codigo, argumento) => ventana.evaluate(codigo, argumento);
  /** La fila del historial de un número de recibo. */
  const filaDelRecibo = (numero) =>
    ventana.locator('[data-prueba="fila-de-recibo"]', { hasText: `Recibo No. ${String(numero)}` });
  /** Vuelve al menú y entra de nuevo a Recibos, para releer el historial. */
  const abrirRecibos = async () => {
    await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA }).catch(async () => {
      await prueba('ir-a-recibos').click();
      await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA });
    });
  };

  try {
    // =======================================================================
    // 1. La instalación: Jimmy, Ana, el catálogo, la caja y las dos ventas.
    // =======================================================================
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Jimmy');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN_JIMMY);
    await teclearPin(PIN_JIMMY);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });

    const armado = await pos(
      async (p) => {
        const exigir = (respuesta, paso) => {
          if (!respuesta.ok) throw new Error(`${paso}: ${respuesta.error.mensaje}`);
          return respuesta.datos;
        };
        const ana = exigir(
          await window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pin: p.ana }),
          'crear Ana',
        );
        const categoria = exigir(await window.pos.catalogo.crearCategoria('Granos', 1), 'categoría');
        const maiz = exigir(
          await window.pos.catalogo.crearProducto({
            nombre: 'Maíz blanco',
            categoriaId: categoria.id,
            tipoMedida: 'peso',
            unidadPeso: 'lb',
            cantidadPredefinidaIcono: '1',
            precioBase: '4.25',
            precioCompra: null,
            fotoPath: null,
            inventarioInicial: '100',
          }),
          'producto',
        );

        exigir(await window.pos.sesion.cerrar(), 'cerrar sesión de Jimmy');
        const ingreso = exigir(await window.pos.sesion.iniciar(ana.id, p.ana), 'ingresar Ana');
        if (!ingreso.autenticado) throw new Error('Ana no entró');
        exigir(await window.pos.caja.abrir({ modo: 'simple', monto: '500' }), 'abrir caja');

        const enEfectivo = exigir(
          await window.pos.venta.cobrar({
            lineas: [{ productoId: maiz.id, cantidad: '2' }],
            descuento: null,
            formaPago: 'efectivo',
            numBoleta: null,
          }),
          'cobrar en efectivo',
        );
        const conTarjeta = exigir(
          await window.pos.venta.cobrar({
            lineas: [{ productoId: maiz.id, cantidad: '1' }],
            descuento: null,
            formaPago: 'tarjeta',
            numBoleta: p.voucher,
          }),
          'cobrar con tarjeta',
        );
        /*
          UNA TERCERA VENTA QUE NO SE VA A ANULAR, y no es de adorno: sin ella,
          al final del recorrido todas las ventas estarían anuladas y no se
          podría distinguir «no se ofrece porque la caja se cerró» de «no se
          ofrece porque ya está anulada». Se comprobó: con esa confusión, una
          pantalla que ignorara la caja pasaba el arnés entero.
        */
        const queSigueEnPie = exigir(
          await window.pos.venta.cobrar({
            lineas: [{ productoId: maiz.id, cantidad: '1' }],
            descuento: null,
            formaPago: 'efectivo',
            numBoleta: null,
          }),
          'cobrar la que sigue en pie',
        );
        // El número de recibo viaja DENTRO de la venta, en `recibo`: el cajero
        // tiene que verlo en el mismo aviso del cobro.
        return {
          maiz: maiz.id,
          enEfectivo: { ventaId: enEfectivo.ventaId, recibo: enEfectivo.recibo.numeroRecibo },
          conTarjeta: { ventaId: conTarjeta.ventaId, recibo: conTarjeta.recibo.numeroRecibo },
          queSigueEnPie: {
            ventaId: queSigueEnPie.ventaId,
            recibo: queSigueEnPie.recibo.numeroRecibo,
          },
        };
      },
      { ana: PIN_ANA, voucher: VOUCHER },
    );
    anotar(`armado: ${JSON.stringify(armado)}`);

    await prueba('ir-a-recibos').click();
    await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA });

    // =======================================================================
    // 2. Las dos ventas de la caja abierta ofrecen «Anular».
    // =======================================================================
    comprobar(
      'las TRES ventas de la caja abierta ofrecen «Anular»',
      '3 botones',
      `${String(await prueba('recibo-anular').count())} botones`,
      (await prueba('recibo-anular').count()) === 3,
    );
    comprobar(
      'ninguna fila está marcada como anulada todavía',
      '0 etiquetas',
      `${String(await prueba('recibo-anulada').count())} etiquetas`,
      (await prueba('recibo-anulada').count()) === 0,
    );
    await capturar('1-historial-con-anular');

    /*
      EL PDF DEL DISCO, ANTES DE ANULAR. Es el control de las dos comprobaciones
      que vienen después: si el lector no encontrara nunca nada, «no dice VENTA
      ANULADA» pasaría igual con un archivo vacío.
    */
    const pdfAntes = pdfDeLaVenta(armado.enEfectivo.ventaId);
    anotar(`PDF antes de anular: ${pdfAntes.ruta.split('/').pop()} · ${String(pdfAntes.bytes)} bytes · sha256 ${pdfAntes.sha256}`);
    comprobar(
      'el lector abre el PDF del disco y lee lo que dice: es el recibo de esta venta',
      'dice «RECIBO DE VENTA» y su total',
      pdfAntes.texto.includes('RECIBO DE VENTA') ? 'lo dice' : 'NO lo dice (el lector no sirve)',
      pdfAntes.texto.includes('RECIBO DE VENTA') && pdfAntes.texto.includes('8.50'),
    );
    comprobar(
      'y todavía NO dice que esté anulada',
      'sin la marca',
      pdfAntes.texto.includes('VENTA ANULADA') ? 'YA la tiene (mal)' : 'sin marca',
      !pdfAntes.texto.includes('VENTA ANULADA'),
    );

    // =======================================================================
    // 3. Se pide la anulación, se ve la vista previa y SE CANCELA.
    // =======================================================================
    const antesDeCancelar = fotoDeLaBase();
    await filaDelRecibo(armado.enEfectivo.recibo).locator('[data-prueba="recibo-anular"]').click();
    await prueba('modal-de-anulacion').waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'una venta EN EFECTIVO no pide voucher',
      'sin campo de voucher',
      `${String(await prueba('anulacion-voucher').count())} campos`,
      (await prueba('anulacion-voucher').count()) === 0,
    );

    await prueba('anulacion-motivo').fill(MOTIVO);
    await prueba('anulacion-continuar').click();
    await prueba('anulacion-aviso-devolucion').waitFor({ timeout: ESPERA_CORTA });

    const aviso = ((await prueba('anulacion-aviso-devolucion').textContent()) ?? '').trim();
    comprobar(
      'LA VISTA PREVIA dice cuánto hay que devolverle al cliente',
      'Hay que devolverle Q8.50 al cliente.',
      aviso,
      aviso === 'Hay que devolverle Q8.50 al cliente.',
    );
    const lineas = ((await prueba('anulacion-lineas').textContent()) ?? '').trim();
    comprobar(
      'LA VISTA PREVIA dice qué producto y cuánto vuelve al inventario',
      'Maíz blanco, 2.000 lb',
      lineas,
      lineas.includes('Maíz blanco') && lineas.includes('2.000') && lineas.includes('lb'),
    );
    const textoDeLaVistaPrevia = ((await prueba('modal-de-anulacion').textContent()) ?? '');
    comprobar(
      'LA VISTA PREVIA no muestra el efectivo teórico de la caja',
      'ni «teórico» ni «esperado»',
      textoDeLaVistaPrevia.toLowerCase().includes('teórico') ? 'dice «teórico» (mal)' : 'no lo dice',
      !/te[óo]rico|esperado/i.test(textoDeLaVistaPrevia),
    );
    await capturar('2-vista-previa');

    await prueba('anulacion-cancelar').first().click();
    await prueba('modal-de-anulacion').waitFor({ state: 'detached', timeout: ESPERA_CORTA });
    comprobar(
      'CANCELAR ANTES DEL PIN no deja rastro: la base queda idéntica',
      antesDeCancelar,
      fotoDeLaBase(),
      fotoDeLaBase() === antesDeCancelar,
    );

    // =======================================================================
    // 4. Se reintenta. Un PIN equivocado no anula nada.
    // =======================================================================
    await filaDelRecibo(armado.enEfectivo.recibo).locator('[data-prueba="recibo-anular"]').click();
    await prueba('modal-de-anulacion').waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'AL REINTENTAR, el diálogo vuelve a abrirse vacío, en el primer paso',
      'paso=formulario y motivo vacío',
      `paso=${String(await prueba('modal-de-anulacion').getAttribute('data-paso'))} motivo="${String(await prueba('anulacion-motivo').inputValue())}"`,
      (await prueba('modal-de-anulacion').getAttribute('data-paso')) === 'formulario' &&
        (await prueba('anulacion-motivo').inputValue()) === '',
    );

    await prueba('anulacion-motivo').fill(MOTIVO);
    await prueba('anulacion-continuar').click();
    await prueba('anulacion-autorizar').click();
    await teclearPin(PIN_MALO);
    await prueba('anulacion-mensaje').waitFor({ timeout: ESPERA_CORTA });

    const mensajeDelPin = ((await prueba('anulacion-mensaje').textContent()) ?? '').trim();
    comprobar(
      'UN PIN EQUIVOCADO lo dice y se queda en el teclado, sin anular',
      'PIN incorrecto. y paso=pin',
      `${mensajeDelPin} · paso=${String(await prueba('modal-de-anulacion').getAttribute('data-paso'))}`,
      mensajeDelPin === 'PIN incorrecto.' &&
        (await prueba('modal-de-anulacion').getAttribute('data-paso')) === 'pin',
    );
    const rechazos = leerBase(
      "SELECT count(*) AS n FROM auditoria_log WHERE accion = 'anulacion_de_venta_rechazada'",
    )[0].n;
    const candadoTrasElPinMalo = leerBase(
      "SELECT intentos_fallidos AS n FROM bloqueos_de_autorizacion WHERE superficie = 'anulacion_de_venta'",
    );
    comprobar(
      'el PIN equivocado SÍ deja su asiento y suma un intento: es evidencia, a propósito (§6.1)',
      '1 asiento de rechazo y 1 intento',
      `${String(rechazos)} asientos, ${JSON.stringify(candadoTrasElPinMalo)}`,
      rechazos === 1 && candadoTrasElPinMalo[0]?.n === 1,
    );
    comprobar(
      'y NO anuló nada',
      '0 anulaciones',
      `${String(leerBase('SELECT count(*) AS n FROM anulaciones_de_venta')[0].n)} anulaciones`,
      leerBase('SELECT count(*) AS n FROM anulaciones_de_venta')[0].n === 0,
    );

    // =======================================================================
    // 5. Con el PIN de Jimmy se anula, y la confirmación muestra los montos.
    // =======================================================================
    await teclearPin(PIN_JIMMY);
    await prueba('anulacion-confirmacion').waitFor({ timeout: ESPERA_CORTA });
    const total = ((await prueba('anulacion-hecha-total').textContent()) ?? '').trim();
    const efectivo = ((await prueba('anulacion-efectivo').textContent()) ?? '').trim();
    const repuestos = ((await prueba('anulacion-repuestos').textContent()) ?? '').trim();
    comprobar(
      'LA CONFIRMACIÓN muestra el total anulado y lo que deja de contar la caja',
      'Q8.50 y Q8.50',
      `${total} · ${efectivo}`,
      total === 'Q8.50' && efectivo === 'Q8.50',
    );
    comprobar(
      'LA CONFIRMACIÓN muestra el inventario repuesto, con el saldo de antes y el de ahora',
      '96.000 → 98.000 lb',
      repuestos,
      repuestos.includes('96.000') && repuestos.includes('98.000'),
    );
    await capturar('3-confirmacion');

    await prueba('anulacion-listo').click();
    await prueba('modal-de-anulacion').waitFor({ state: 'detached', timeout: ESPERA_CORTA });

    /*
      ===================================================================
      EL PUNTO 46: EL ARCHIVO DEL DISCO YA ESTÁ MARCADO
      ===================================================================
      Acá NADIE reimprimió nada: la única acción fue confirmar la anulación. Se
      abre el PDF que quedó en la carpeta de recibos y se lee lo que dice
      adentro, sin pasar por la pantalla.
    */
    const pdfDespues = pdfDeLaVenta(armado.enEfectivo.ventaId);
    anotar(`PDF después de anular: ${String(pdfDespues.bytes)} bytes · sha256 ${pdfDespues.sha256}`);
    anotar(
      `lo que dice el PDF del disco: ${JSON.stringify(
        pdfDespues.texto
          .split('\n')
          .map((linea) => linea.match(/\*\* VENTA ANULADA \*\*.{0,80}/))
          .filter((encontrado) => encontrado !== null)
          .map((encontrado) => encontrado[0])
          .slice(0, 2),
      )}`,
    );
    comprobar(
      'EL PDF DEL DISCO YA DICE «VENTA ANULADA» sin que nadie lo haya reimpreso',
      'la marca dentro del archivo',
      pdfDespues.texto.includes('** VENTA ANULADA **') ? 'la tiene' : 'NO la tiene (mal)',
      pdfDespues.texto.includes('** VENTA ANULADA **'),
    );
    comprobar(
      'y dice también quién autorizó y por qué',
      `«Autorizó: Jimmy» y «${MOTIVO}»`,
      `autorizó=${String(pdfDespues.texto.includes('Autorizó: Jimmy'))} motivo=${String(pdfDespues.texto.includes(MOTIVO))}`,
      pdfDespues.texto.includes('Autorizó: Jimmy') && pdfDespues.texto.includes(MOTIVO),
    );
    comprobar(
      'el archivo es OTRO: se reescribió encima del mismo, en el momento de anular',
      `sha256 distinto de ${pdfAntes.sha256}, y más reciente`,
      `sha256 ${pdfDespues.sha256} · ${String(pdfDespues.modificado - pdfAntes.modificado)} ms después`,
      pdfDespues.sha256 !== pdfAntes.sha256 && pdfDespues.modificado > pdfAntes.modificado,
    );
    comprobar(
      'NO dice «REIMPRESIÓN»: es el recibo original marcado, no una reimpresión',
      'sin la leyenda de reimpresión',
      pdfDespues.texto.includes('REIMPRESI') ? 'dice REIMPRESIÓN (mal)' : 'no la dice',
      !pdfDespues.texto.includes('REIMPRESI'),
    );
    comprobar(
      'y CONSERVA las cifras del recibo original',
      'el mismo total, Q8.50',
      pdfDespues.texto.includes('8.50') ? 'lo conserva' : 'lo perdió (mal)',
      pdfDespues.texto.includes('8.50'),
    );

    const avisoDelHistorial = ((await prueba('recibos-aviso').textContent()) ?? '').trim();
    comprobar(
      'el historial avisa que la venta quedó anulada',
      `menciona el recibo ${String(armado.enEfectivo.recibo)} y Q8.50`,
      avisoDelHistorial,
      avisoDelHistorial.includes(String(armado.enEfectivo.recibo)) &&
        avisoDelHistorial.includes('8.50'),
    );

    // =======================================================================
    // 6. La fila cambia, y el recibo reimpreso lleva la marca.
    // =======================================================================
    const filaAnulada = filaDelRecibo(armado.enEfectivo.recibo);
    await filaAnulada.locator('[data-prueba="recibo-anulada"]').waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'LA FILA ANULADA se marca y PIERDE su botón «Anular»',
      'etiqueta Anulada y 0 botones en esa fila',
      `etiqueta=${String(await filaAnulada.locator('[data-prueba="recibo-anulada"]').count())} botones=${String(await filaAnulada.locator('[data-prueba="recibo-anular"]').count())}`,
      (await filaAnulada.locator('[data-prueba="recibo-anulada"]').count()) === 1 &&
        (await filaAnulada.locator('[data-prueba="recibo-anular"]').count()) === 0,
    );
    const detalleDeLaFila = (
      (await filaAnulada.locator('[data-prueba="recibo-anulacion-detalle"]').textContent()) ?? ''
    ).trim();
    comprobar(
      'la fila dice cuándo se anuló, quién autorizó y por qué',
      `menciona a Jimmy y «${MOTIVO}»`,
      detalleDeLaFila,
      detalleDeLaFila.includes('Jimmy') && detalleDeLaFila.includes(MOTIVO),
    );
    await capturar('4-fila-anulada');

    await filaAnulada.locator('[data-prueba="recibo-reimprimir"]').click();
    await prueba('vista-de-recibo').waitFor({ timeout: ESPERA_CORTA });
    const papel = ((await prueba('recibo-texto').textContent()) ?? '');
    anotar(`recibo reimpreso:\n${papel}`);
    comprobar(
      'EL RECIBO REIMPRESO dice «VENTA ANULADA», con la fecha, quién autorizó y el motivo',
      '** VENTA ANULADA **, Anulada: …, Autorizó: Jimmy, Motivo: …',
      papel.split('\n').filter((linea) => /ANULADA|Anulada:|Autorizó:|Motivo:/.test(linea)).join(' | '),
      papel.includes('** VENTA ANULADA **') &&
        /Anulada: \d{2}\/\d{2}\/\d{4}/.test(papel) &&
        papel.includes('Autorizó: Jimmy') &&
        papel.includes(`Motivo: ${MOTIVO}`),
    );
    comprobar(
      'y CONSERVA las cifras originales: el mismo número de recibo y el mismo total',
      `Recibo No. ${String(armado.enEfectivo.recibo)} y TOTAL 8.50`,
      papel.split('\n').filter((linea) => /Recibo No\.|TOTAL/.test(linea)).join(' | '),
      papel.includes(`Recibo No.`) && /TOTAL\s+8\.50/.test(papel),
    );
    await capturar('5-recibo-marcado');
    await prueba('cerrar-vista-de-recibo').click();

    // =======================================================================
    // 7. Con tarjeta: un voucher equivocado no llega al PIN.
    // =======================================================================
    const antesDelVoucher = fotoDeLaBase();
    await filaDelRecibo(armado.conTarjeta.recibo).locator('[data-prueba="recibo-anular"]').click();
    await prueba('modal-de-anulacion').waitFor({ timeout: ESPERA_CORTA });
    comprobar(
      'una venta CON TARJETA pide el número de voucher',
      '1 campo de voucher',
      `${String(await prueba('anulacion-voucher').count())} campos`,
      (await prueba('anulacion-voucher').count()) === 1,
    );

    await prueba('anulacion-voucher').fill(VOUCHER_EQUIVOCADO);
    await prueba('anulacion-motivo').fill(MOTIVO);
    await prueba('anulacion-continuar').click();
    await prueba('anulacion-mensaje').waitFor({ timeout: ESPERA_CORTA });

    const mensajeDelVoucher = ((await prueba('anulacion-mensaje').textContent()) ?? '').trim();
    comprobar(
      'UN VOUCHER EQUIVOCADO se rechaza con su mensaje',
      'El voucher no coincide con el de la venta original.',
      mensajeDelVoucher,
      mensajeDelVoucher === 'El voucher no coincide con el de la venta original.',
    );
    comprobar(
      'y NO aparece el teclado del PIN',
      '0 teclas de confirmar',
      `${String(await prueba('tecla-confirmar').count())} teclas`,
      (await prueba('tecla-confirmar').count()) === 0,
    );
    comprobar(
      'no toca el candado ni escribe nada: la base queda idéntica',
      antesDelVoucher,
      fotoDeLaBase(),
      fotoDeLaBase() === antesDelVoucher,
    );
    await capturar('6-voucher-equivocado');

    // =======================================================================
    // 8. Con el voucher correcto sí se anula.
    // =======================================================================
    await prueba('anulacion-voucher').fill(VOUCHER);
    await prueba('anulacion-continuar').click();
    await prueba('anulacion-aviso-devolucion').waitFor({ timeout: ESPERA_CORTA });
    const avisoDeTarjeta = ((await prueba('anulacion-aviso-devolucion').textContent()) ?? '').trim();
    comprobar(
      'CON TARJETA la vista previa dice que la devolución se hace en el banco',
      'La devolución se hace en la terminal del banco.',
      avisoDeTarjeta,
      avisoDeTarjeta === 'La devolución se hace en la terminal del banco.',
    );

    await prueba('anulacion-autorizar').click();
    await teclearPin(PIN_JIMMY);
    await prueba('anulacion-confirmacion').waitFor({ timeout: ESPERA_CORTA });
    const efectivoDeTarjeta = ((await prueba('anulacion-efectivo').textContent()) ?? '').trim();
    comprobar(
      'una venta CON TARJETA anulada no cambia el efectivo de la caja',
      'Q0.00',
      efectivoDeTarjeta,
      efectivoDeTarjeta === 'Q0.00',
    );
    await prueba('anulacion-listo').click();
    await prueba('modal-de-anulacion').waitFor({ state: 'detached', timeout: ESPERA_CORTA });

    // =======================================================================
    // 9. Con la caja cerrada, ya no se ofrece anular, y el canal se niega.
    // =======================================================================
    const cierre = await pos(async () => {
      const exigir = (respuesta, paso) => {
        if (!respuesta.ok) throw new Error(`${paso}: ${respuesta.error.mensaje}`);
        return respuesta.datos;
      };
      // Quedan los 500 del fondo más la venta en efectivo que NO se anuló
      // (Q4.25): las dos anuladas salieron del esperado. Se cuenta exacto para
      // que no haga falta autorizar nada.
      return exigir(await window.pos.caja.cerrar({ modo: 'simple', monto: '504.25' }), 'cerrar caja');
    });
    anotar(`cierre de la caja: ${JSON.stringify(cierre)}`);
    comprobar(
      'la caja cierra CUADRADA con 504.25: las dos anulaciones salieron del esperado y la otra venta no',
      'cerrada=true',
      `cerrada=${String(cierre.cerrada)} codigo=${String(cierre.codigo)}`,
      cierre.cerrada === true,
    );

    // Se vuelve a entrar al historial para releerlo.
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('ir-a-recibos').click();
    await abrirRecibos();

    comprobar(
      'CON LA CAJA CERRADA ningún recibo ofrece «Anular»',
      '0 botones',
      `${String(await prueba('recibo-anular').count())} botones`,
      (await prueba('recibo-anular').count()) === 0,
    );
    /*
      Y la comprobación que de verdad separa las dos reglas: la venta que NUNCA
      se anuló TAMPOCO ofrece el botón, porque su caja se cerró. Sin esta fila,
      una pantalla que solo mirara «ya está anulada» pasaba el arnés entero
      —medido—, porque al final todas las demás estaban anuladas.
    */
    const laQueSigueEnPie = filaDelRecibo(armado.queSigueEnPie.recibo);
    comprobar(
      'la venta que NO se anuló tampoco ofrece «Anular»: lo que la saca es la CAJA CERRADA',
      '0 botones y ninguna etiqueta de anulada en esa fila',
      `botones=${String(await laQueSigueEnPie.locator('[data-prueba="recibo-anular"]').count())} anulada=${String(await laQueSigueEnPie.locator('[data-prueba="recibo-anulada"]').count())}`,
      (await laQueSigueEnPie.locator('[data-prueba="recibo-anular"]').count()) === 0 &&
        (await laQueSigueEnPie.locator('[data-prueba="recibo-anulada"]').count()) === 0,
    );
    await capturar('7-caja-cerrada');

    const negado = await pos(
      async (ventaId) =>
        window.pos.venta.anular({ ventaId, motivo: 'probando', voucher: null, pin: null }),
      armado.enEfectivo.ventaId,
    );
    anotar(`el canal, con la caja cerrada: ${JSON.stringify(negado)}`);
    comprobar(
      'y el CANAL también se niega, no solo la pantalla',
      'ok=false con VENTA_YA_ANULADA o CAJA_DE_LA_VENTA_CERRADA',
      `ok=${String(negado.ok)} codigo=${String(negado.ok ? '' : negado.error.codigo)}`,
      negado.ok === false &&
        ['VENTA_YA_ANULADA', 'CAJA_DE_LA_VENTA_CERRADA'].includes(negado.error.codigo),
    );

    // =======================================================================
    // 10. La base, leída con otra conexión.
    // =======================================================================
    const anulaciones = leerBase(
      'SELECT venta_id, autorizada_via, motivo FROM anulaciones_de_venta ORDER BY fecha',
    );
    const inventario = leerBase('SELECT nombre, inventario_disponible, contador_ventas, cantidad_vendida FROM productos');
    const ventas = leerBase('SELECT estado, forma_pago, total FROM ventas ORDER BY fecha');
    anotar(`anulaciones: ${JSON.stringify(anulaciones)}`);
    anotar(`productos: ${JSON.stringify(inventario)}`);
    anotar(`ventas: ${JSON.stringify(ventas)}`);

    comprobar(
      'quedaron las DOS anulaciones, las dos presenciales',
      '2 filas, autorizada_via=presencial',
      JSON.stringify(anulaciones.map((fila) => fila.autorizada_via)),
      anulaciones.length === 2 && anulaciones.every((fila) => fila.autorizada_via === 'presencial'),
    );
    comprobar(
      'el inventario y los contadores quedaron con SOLO la venta que sigue en pie',
      '99.000 lb, 1 venta, 1.000 vendidas',
      JSON.stringify(inventario),
      inventario[0]?.inventario_disponible === '99.000' &&
        inventario[0]?.contador_ventas === 1 &&
        inventario[0]?.cantidad_vendida === '1.000',
    );
    comprobar(
      'las filas de `ventas` NO se tocaron: las TRES siguen diciendo «completada» (§1.1)',
      'las tres completada',
      JSON.stringify(ventas),
      ventas.length === 3 && ventas.every((fila) => fila.estado === 'completada'),
    );
  } catch (error) {
    // SE IMPRIME ACÁ Y NO AL FINAL, a propósito: la aplicación intercepta el
    // cierre para pedir el PIN (§4.5), así que `app.close()` puede demorar o
    // no volver, y el motivo del fallo se perdería. Primero se dice qué pasó.
    console.error(`ERROR EN EL ARNÉS: ${error instanceof Error ? error.message : String(error)}`);
    await capturar('error');
    comprobar('el arnés llegó al final sin errores', 'sin excepciones', String(error), false);
  } finally {
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise((resolver) => {
        setTimeout(resolver, 15000);
      }),
    ]);
  }

  const fallidas = comprobaciones.filter((comprobacion) => !comprobacion.paso);
  console.info('');
  console.info(
    `${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`,
  );
  for (const fallida of fallidas) {
    console.info(`  - ${fallida.nombre}`);
  }
  console.info(`capturas y base en: ${datos}`);
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
