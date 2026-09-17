/**
 * verificacion-de-historial-de-recibos.cjs — EL FILTRO POR MÉTODO DE PAGO, LOS
 * TOTALES Y EL VOUCHER, en la aplicación REAL.
 *
 * ===========================================================================
 * QUÉ COMPRUEBA QUE NINGUNA PRUEBA DE VITEST PUEDE COMPROBAR
 * ===========================================================================
 *
 *   · Que el «Resumen de ventas por período» YA mostraba bien el desglose de
 *     efectivo contra tarjeta con su total general, antes y después de que una
 *     anulación cambie los números.
 *   · Que el filtro de la pantalla de recibos **vuelve a pedirle la lista al
 *     proceso principal**, y que los totales que se ven son los del conjunto
 *     que se está viendo y no los de todo el historial.
 *   · Que los montos salen **exactos** en un caso que el punto flotante
 *     arruina: las ventas están elegidas para que sumarlas con `Number` diera
 *     `7.700000000000001` y `12.099999999999998`.
 *   · Que una venta con tarjeta **ya anulada** dice «Anulado» con su fecha, y
 *     que deja de contar en los totales sin desaparecer de la lista.
 *   · Que el botón «Anular» sigue funcionando **con el filtro puesto**, de
 *     punta a punta: motivo, voucher, vista previa, PIN y confirmación.
 *   · Que el rol VENTA ve las filas y el voucher y **no ve ningún total**, que
 *     es la regla de §4.15 y §4.40: cuánto entró es información de dueño.
 *
 * El escenario lo arma Jimmy, que es administrativo: es quien puede ver los
 * totales. Ana entra al final, solo para el control del rol.
 *
 * Códigos de salida: 0 todo bien, 1 alguna comprobación falló.
 */

const { mkdirSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

const PROYECTO = join(__dirname, '..');
const PIN_JIMMY = '2468';
const PIN_ANA = '1357';
const MOTIVO = 'el cliente devolvió el producto';
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;

/**
 * Los vouchers de las tres ventas con tarjeta. El de `B-0002` es el que se
 * anula por la interfaz.
 */
const VOUCHERS = { tresUnidades: 'B-0003', seisUnidades: 'B-0006', queSeAnula: 'B-0002' };

const comprobaciones = [];

function comprobar(nombre, esperado, real, paso) {
  comprobaciones.push({ nombre, esperado, real, paso });
  console.log(`  ${paso ? ' OK  ' : 'FALLA'} ${nombre}`);
  if (!paso) {
    console.log(`        esperado: ${esperado}`);
    console.log(`        real    : ${real}`);
  }
}

function anotar(texto) {
  console.log(`${new Date().toISOString()} ${texto}`);
}

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-recibos-'));
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
      ventana.setSize(1200, 950);
    }
  });
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');

  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const texto = async (nombre) =>
    (await prueba(nombre).count()) === 0 ? '(no está)' : (await prueba(nombre).innerText()).trim();
  const capturar = async (nombre) => {
    await new Promise((r) => {
      setTimeout(r, 500);
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
  /** La fila del historial de un número de recibo. */
  const filaDelRecibo = (numero) =>
    ventana.locator('[data-prueba="fila-de-recibo"]', { hasText: `Recibo No. ${String(numero)}` });
  /** Pone el filtro y espera a que la lista se haya vuelto a pedir. */
  const filtrar = async (cual) => {
    await prueba(`filtro-${cual}`).click();
    await ventana
      .locator(`[data-prueba="filtro-${cual}"].opcion--activa`)
      .waitFor({ timeout: ESPERA_CORTA });
    // El canal es asincrónico: se espera a que la lista termine de redibujarse.
    await new Promise((r) => {
      setTimeout(r, 400);
    });
  };
  /** Los tres totales que se ven, o `(no están)`. */
  const totalesEnPantalla = async () => ({
    efectivo: await texto('totales-efectivo'),
    tarjeta: await texto('totales-tarjeta'),
    general: await texto('totales-general'),
    anulado: await texto('totales-anulado'),
  });
  /** El «Volver» de una pantalla concreta: los dos se llaman igual. */
  const volverDe = async (pantalla) => {
    await ventana
      .locator(`[data-prueba="${pantalla}"] button`, { hasText: 'Volver' })
      .first()
      .click();
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
  };
  const abrirRecibos = async () => {
    await prueba('ir-a-recibos').click();
    await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA });
  };

  try {
    // =======================================================================
    // 1. La instalación: Jimmy, Ana, el producto de decimales feos y 6 ventas.
    // =======================================================================
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Jimmy');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN_JIMMY);
    await teclearPin(PIN_JIMMY);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });

    const armado = await ventana.evaluate(
      async (p) => {
        const exigir = (respuesta, paso) => {
          if (!respuesta.ok) {
            throw new Error(`${paso}: ${respuesta.error.mensaje}`);
          }
          return respuesta.datos;
        };
        exigir(
          await window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pin: p.pinAna }),
          'crear Ana',
        );
        const categoria = exigir(await window.pos.catalogo.crearCategoria('Granos', 1), 'categoría');
        /*
          Q1.10 EL KILO, y el precio no es casual: todo múltiplo de 0.25 es
          exacto en binario, así que con el maíz a Q4.25 de los otros arneses
          sumar con `Number` daría el MISMO resultado que con Decimal y este
          arnés no distinguiría una implementación de la otra. Con Q1.10:
            1.1 + 2.2 + 4.4        = 7.700000000000001
            3.3 + 6.6 + 2.2        = 12.099999999999998
        */
        const azucar = exigir(
          await window.pos.catalogo.crearProducto({
            nombre: 'Azúcar',
            categoriaId: categoria.id,
            tipoMedida: 'unidad',
            unidadPeso: null,
            cantidadPredefinidaIcono: '1',
            precioBase: '1.10',
            precioCompra: null,
            fotoPath: null,
            inventarioInicial: '100',
          }),
          'producto',
        );
        exigir(await window.pos.caja.abrir({ modo: 'simple', monto: '500' }), 'abrir caja');

        const cobrar = async (cantidad, formaPago, numBoleta) =>
          exigir(
            await window.pos.venta.cobrar({
              lineas: [{ productoId: azucar.id, cantidad }],
              descuento: null,
              formaPago,
              numBoleta,
            }),
            `cobrar ${cantidad} con ${formaPago}`,
          );

        const uno = await cobrar('1', 'efectivo', null); // 1.10
        const dos = await cobrar('2', 'efectivo', null); // 2.20
        const cuatro = await cobrar('4', 'efectivo', null); // 4.40
        const tres = await cobrar('3', 'tarjeta', p.vouchers.tresUnidades); // 3.30
        const seis = await cobrar('6', 'tarjeta', p.vouchers.seisUnidades); // 6.60
        const queSeAnula = await cobrar('2', 'tarjeta', p.vouchers.queSeAnula); // 2.20

        const resumir = (venta) => ({
          ventaId: venta.ventaId,
          recibo: venta.recibo.numeroRecibo,
          total: venta.total,
        });
        return {
          efectivo: [uno, dos, cuatro].map(resumir),
          tarjeta: [tres, seis].map(resumir),
          queSeAnula: resumir(queSeAnula),
        };
      },
      { pinAna: PIN_ANA, vouchers: VOUCHERS },
    );
    anotar(`armado: ${JSON.stringify(armado)}`);

    // =======================================================================
    // 2. EL PUNTO 1 DEL PEDIDO: el resumen de ventas ya trae su desglose.
    // =======================================================================
    await prueba('ir-a-reportes').click();
    await prueba('pantalla-de-reportes').waitFor({ timeout: ESPERA_CORTA });
    await prueba('periodo-hoy').click();
    await prueba('reporte-resumen').waitFor({ timeout: ESPERA_CORTA });
    await new Promise((r) => {
      setTimeout(r, 600);
    });
    await capturar('1-resumen-de-ventas');

    const resumen = {
      total: await texto('resumen-total'),
      cantidad: await texto('resumen-cantidad'),
      efectivo: await texto('resumen-efectivo'),
      tarjeta: await texto('resumen-tarjeta'),
    };
    anotar(`resumen de ventas en pantalla: ${JSON.stringify(resumen)}`);
    comprobar(
      'EL RESUMEN DE VENTAS trae el desglose efectivo/tarjeta y el total general',
      'efectivo Q7.70 · tarjeta Q12.10 · total Q19.80 · 6 ventas',
      `efectivo ${resumen.efectivo} · tarjeta ${resumen.tarjeta} · total ${resumen.total} · ${resumen.cantidad} ventas`,
      resumen.efectivo === 'Q7.70' &&
        resumen.tarjeta === 'Q12.10' &&
        resumen.total === 'Q19.80' &&
        resumen.cantidad === '6',
    );
    comprobar(
      'y esos montos son EXACTOS: sumados con Number darían 7.700000000000001 y 12.099999999999998',
      'Q7.70 y Q12.10, sin cola de decimales',
      `${resumen.efectivo} y ${resumen.tarjeta} (con Number: ${String(1.1 + 2.2 + 4.4)} y ${String(3.3 + 6.6 + 2.2)})`,
      !resumen.efectivo.includes('7.7000') && !resumen.tarjeta.includes('12.0999'),
    );

    await volverDe('pantalla-de-reportes');

    // =======================================================================
    // 3. El filtro por método de pago.
    // =======================================================================
    await abrirRecibos();
    await capturar('2-historial-todas');

    const filasVisibles = async () => ventana.locator('[data-prueba="fila-de-recibo"]').count();
    const formasVisibles = async () =>
      (await prueba('lista-de-recibos').innerText()).match(/Efectivo|Tarjeta/g) ?? [];

    comprobar(
      'CON «TODAS» se ven las seis ventas, de efectivo y de tarjeta',
      '6 filas',
      `${String(await filasVisibles())} filas`,
      (await filasVisibles()) === 6,
    );

    await filtrar('efectivo');
    await capturar('3-historial-efectivo');
    const conEfectivo = { filas: await filasVisibles(), formas: await formasVisibles() };
    comprobar(
      'CON «EFECTIVO» quedan las tres en efectivo y NINGUNA con tarjeta',
      '3 filas, ninguna dice «Tarjeta»',
      `${String(conEfectivo.filas)} filas, formas: ${conEfectivo.formas.join(', ')}`,
      conEfectivo.filas === 3 && !conEfectivo.formas.includes('Tarjeta'),
    );

    await filtrar('tarjeta');
    await capturar('4-historial-tarjeta');
    const conTarjeta = { filas: await filasVisibles(), formas: await formasVisibles() };
    comprobar(
      'CON «TARJETA» quedan las tres con tarjeta y NINGUNA en efectivo',
      '3 filas, ninguna dice «Efectivo»',
      `${String(conTarjeta.filas)} filas, formas: ${conTarjeta.formas.join(', ')}`,
      conTarjeta.filas === 3 && !conTarjeta.formas.includes('Efectivo'),
    );

    // =======================================================================
    // 4. El voucher y su estado.
    // =======================================================================
    const filaDeLaQueSeAnula = filaDelRecibo(armado.queSeAnula.recibo);
    const textoDeEsaFila = (await filaDeLaQueSeAnula.innerText()).replace(/\n/g, ' · ');
    anotar(`fila de la venta que se va a anular: ${textoDeEsaFila}`);
    comprobar(
      'CADA VENTA CON TARJETA MUESTRA SU VOUCHER y dice «Activo»',
      `Voucher ${VOUCHERS.queSeAnula} · Activo`,
      textoDeEsaFila,
      textoDeEsaFila.includes(VOUCHERS.queSeAnula) && textoDeEsaFila.includes('Activo'),
    );

    const conEfectivoAhora = await (async () => {
      await filtrar('efectivo');
      const hayVoucher = await prueba('recibo-voucher').count();
      await filtrar('tarjeta');
      return hayVoucher;
    })();
    comprobar(
      'NINGUNA VENTA EN EFECTIVO dibuja línea de voucher',
      '0 líneas de voucher',
      `${String(conEfectivoAhora)} líneas de voucher`,
      conEfectivoAhora === 0,
    );

    // =======================================================================
    // 5. Los totales, del conjunto filtrado y con decimales feos.
    // =======================================================================
    const totalesConTarjeta = await totalesEnPantalla();
    anotar(`totales con el filtro en TARJETA: ${JSON.stringify(totalesConTarjeta)}`);
    comprobar(
      'LOS TOTALES SON DEL CONJUNTO FILTRADO: con «Tarjeta», el efectivo es cero',
      'efectivo Q0.00 · tarjeta Q12.10 · general Q12.10',
      `efectivo ${totalesConTarjeta.efectivo} · tarjeta ${totalesConTarjeta.tarjeta} · general ${totalesConTarjeta.general}`,
      totalesConTarjeta.efectivo === 'Q0.00' &&
        totalesConTarjeta.tarjeta === 'Q12.10' &&
        totalesConTarjeta.general === 'Q12.10',
    );

    await filtrar('todas');
    const totalesDeTodas = await totalesEnPantalla();
    anotar(`totales con el filtro en TODAS: ${JSON.stringify(totalesDeTodas)}`);
    comprobar(
      'CON «TODAS», efectivo + tarjeta da EXACTAMENTE el general, con decimales feos',
      'Q7.70 + Q12.10 = Q19.80',
      `${totalesDeTodas.efectivo} + ${totalesDeTodas.tarjeta} = ${totalesDeTodas.general}`,
      totalesDeTodas.efectivo === 'Q7.70' &&
        totalesDeTodas.tarjeta === 'Q12.10' &&
        totalesDeTodas.general === 'Q19.80',
    );
    comprobar(
      'y el historial dice LO MISMO que el resumen de ventas: una sola función suma los dos',
      `resumen ${resumen.efectivo}/${resumen.tarjeta}/${resumen.total}`,
      `historial ${totalesDeTodas.efectivo}/${totalesDeTodas.tarjeta}/${totalesDeTodas.general}`,
      totalesDeTodas.efectivo === resumen.efectivo &&
        totalesDeTodas.tarjeta === resumen.tarjeta &&
        totalesDeTodas.general === resumen.total,
    );
    comprobar(
      'sin ninguna venta anulada, el renglón de anuladas NO se dibuja',
      '(no está)',
      totalesDeTodas.anulado,
      totalesDeTodas.anulado === '(no está)',
    );

    // =======================================================================
    // 6. ANULAR CON EL FILTRO PUESTO: el botón sigue intacto.
    // =======================================================================
    await filtrar('tarjeta');
    comprobar(
      'EL BOTÓN «ANULAR» SIGUE APARECIENDO con el filtro en «Tarjeta»',
      '1 botón en la fila de esa venta',
      `${String(await filaDeLaQueSeAnula.locator('[data-prueba="recibo-anular"]').count())} botón(es)`,
      (await filaDeLaQueSeAnula.locator('[data-prueba="recibo-anular"]').count()) === 1,
    );

    await filaDeLaQueSeAnula.locator('[data-prueba="recibo-anular"]').click();
    await prueba('modal-de-anulacion').waitFor({ timeout: ESPERA_CORTA });
    await prueba('anulacion-voucher').click();
    await prueba('anulacion-voucher').fill(VOUCHERS.queSeAnula);
    await prueba('anulacion-motivo').click();
    await prueba('anulacion-motivo').fill(MOTIVO);
    await capturar('5-modal-formulario');
    await prueba('anulacion-continuar').click();
    await ventana
      .locator('[data-prueba="modal-de-anulacion"][data-paso="vista-previa"]')
      .waitFor({ timeout: ESPERA_CORTA });
    await capturar('6-modal-vista-previa');
    await prueba('anulacion-autorizar').click();
    await teclearPin(PIN_JIMMY);
    await ventana
      .locator('[data-prueba="modal-de-anulacion"][data-paso="confirmacion"]')
      .waitFor({ timeout: ESPERA_CORTA });
    await capturar('7-modal-confirmacion');
    anotar(`confirmación de la anulación: ${(await texto('anulacion-mensaje')).replace(/\n/g, ' ')}`);
    await prueba('anulacion-listo').click();
    await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA });
    await new Promise((r) => {
      setTimeout(r, 600);
    });

    comprobar(
      'DESPUÉS DE ANULAR, el filtro elegido SE CONSERVA: no vuelve a «Todas»',
      'filtro-tarjeta sigue activo',
      (await prueba('filtro-tarjeta').getAttribute('class')) ?? '(sin clase)',
      ((await prueba('filtro-tarjeta').getAttribute('class')) ?? '').includes('opcion--activa'),
    );

    // =======================================================================
    // 7. La venta anulada: «Anulado» con su fecha, y fuera de los totales.
    // =======================================================================
    await capturar('8-historial-con-la-anulada');
    const textoAnulada = (await filaDelRecibo(armado.queSeAnula.recibo).innerText()).replace(
      /\n/g,
      ' · ',
    );
    anotar(`fila de la venta anulada: ${textoAnulada}`);
    const enLaBase = leerBase(
      `SELECT v.estado, v.num_boleta, a.fecha AS anulada_en
         FROM ventas v LEFT JOIN anulaciones_de_venta a ON a.venta_id = v.id
        WHERE v.id = ?`,
      armado.queSeAnula.ventaId,
    )[0];
    anotar(`esa venta en la base: ${JSON.stringify(enLaBase)}`);
    /*
      EL DÍA, COMO LO ESCRIBE LA APLICACIÓN: dos dígitos de día y de mes. La
      primera versión de este arnés usaba `toLocaleDateString` a secas, que da
      «17/9/2026», y marcaba como falla una fila que decía «17/09/2026». El
      defecto era del arnés; queda escrito para que nadie lo reintroduzca.
    */
    const diaDeLaAnulacion = new Date(enLaBase.anulada_en).toLocaleDateString('es-GT', {
      timeZone: 'America/Guatemala',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    comprobar(
      'LA VENTA CON TARJETA ANULADA dice «Anulado» CON SU FECHA, y conserva su voucher',
      `Voucher ${VOUCHERS.queSeAnula} · Anulado el ${diaDeLaAnulacion}`,
      textoAnulada,
      textoAnulada.includes(VOUCHERS.queSeAnula) &&
        textoAnulada.includes('Anulado el') &&
        textoAnulada.includes(diaDeLaAnulacion),
    );
    comprobar(
      'el estado NO se guardó en ningún lado: `ventas.estado` sigue en «completada» (§1.3)',
      "estado='completada' y una fila en anulaciones_de_venta",
      `estado='${enLaBase.estado}', anulada_en=${String(enLaBase.anulada_en)}`,
      enLaBase.estado === 'completada' && enLaBase.anulada_en !== null,
    );
    comprobar(
      'LA FILA NO DESAPARECE de la lista: siguen las tres con tarjeta',
      '3 filas',
      `${String(await filasVisibles())} filas`,
      (await filasVisibles()) === 3,
    );

    const tarjetaDespues = await totalesEnPantalla();
    anotar(`totales con TARJETA, ya anulada una: ${JSON.stringify(tarjetaDespues)}`);
    comprobar(
      'PERO DEJA DE CONTAR: el total con tarjeta baja de Q12.10 a Q9.90',
      'tarjeta Q9.90 · general Q9.90',
      `tarjeta ${tarjetaDespues.tarjeta} · general ${tarjetaDespues.general}`,
      tarjetaDespues.tarjeta === 'Q9.90' && tarjetaDespues.general === 'Q9.90',
    );
    comprobar(
      'y lo anulado SE INFORMA APARTE, no se esconde',
      'Q2.20',
      tarjetaDespues.anulado,
      tarjetaDespues.anulado === 'Q2.20',
    );

    await filtrar('todas');
    const todasDespues = await totalesEnPantalla();
    anotar(`totales con TODAS, ya anulada una: ${JSON.stringify(todasDespues)}`);
    comprobar(
      'CON «TODAS» el general queda en Q17.60, que es 7.70 + 9.90 exacto',
      'efectivo Q7.70 · tarjeta Q9.90 · general Q17.60',
      `efectivo ${todasDespues.efectivo} · tarjeta ${todasDespues.tarjeta} · general ${todasDespues.general}`,
      todasDespues.efectivo === 'Q7.70' &&
        todasDespues.tarjeta === 'Q9.90' &&
        todasDespues.general === 'Q17.60',
    );

    // Y el reporte tiene que haber bajado igual: las dos pantallas suman con la
    // misma función y excluyen lo anulado con el mismo criterio.
    await volverDe('pantalla-de-recibos');
    await prueba('ir-a-reportes').click();
    await prueba('periodo-hoy').click();
    await prueba('reporte-resumen').waitFor({ timeout: ESPERA_CORTA });
    await new Promise((r) => {
      setTimeout(r, 600);
    });
    const resumenDespues = {
      total: await texto('resumen-total'),
      efectivo: await texto('resumen-efectivo'),
      tarjeta: await texto('resumen-tarjeta'),
    };
    anotar(`resumen de ventas DESPUÉS de anular: ${JSON.stringify(resumenDespues)}`);
    comprobar(
      'EL RESUMEN DE VENTAS Y EL HISTORIAL SIGUEN DICIENDO LO MISMO después de anular',
      `historial ${todasDespues.efectivo}/${todasDespues.tarjeta}/${todasDespues.general}`,
      `resumen ${resumenDespues.efectivo}/${resumenDespues.tarjeta}/${resumenDespues.total}`,
      resumenDespues.efectivo === todasDespues.efectivo &&
        resumenDespues.tarjeta === todasDespues.tarjeta &&
        resumenDespues.total === todasDespues.general,
    );
    await volverDe('pantalla-de-reportes');

    // =======================================================================
    // 8. EL ROL VENTA: ve las filas y el voucher, y NINGÚN total.
    // =======================================================================
    await ventana.locator('button', { hasText: 'Cerrar sesión' }).click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    await ventana.locator('[data-prueba="usuario-para-ingreso"]', { hasText: 'Ana' }).click();
    await prueba('pantalla-de-pin').waitFor({ timeout: ESPERA_CORTA });
    await teclearPin(PIN_ANA);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    anotar(`usuario en sesión ahora: ${await texto('usuario-en-sesion')}`);

    await abrirRecibos();
    await new Promise((r) => {
      setTimeout(r, 400);
    });
    await capturar('9-historial-de-la-cajera');
    const comoAna = {
      filas: await filasVisibles(),
      totales: await prueba('totales-del-historial').count(),
      vouchers: await prueba('recibo-voucher').count(),
      textoEntero: await prueba('pantalla-de-recibos').innerText(),
    };
    anotar(
      `la cajera ve: ${String(comoAna.filas)} filas, ${String(comoAna.vouchers)} vouchers, ${String(comoAna.totales)} líneas de totales`,
    );
    comprobar(
      'LA CAJERA VE LAS FILAS Y LOS VOUCHERS, como siempre',
      '6 filas y 3 vouchers',
      `${String(comoAna.filas)} filas y ${String(comoAna.vouchers)} vouchers`,
      comoAna.filas === 6 && comoAna.vouchers === 3,
    );
    comprobar(
      'PERO NO VE NINGÚN TOTAL: cuánto entró es información de dueño (§4.15, §4.40)',
      '0 líneas de totales, y ni «17.60» ni «7.70» en toda la pantalla',
      `${String(comoAna.totales)} líneas; ¿dice 17.60? ${String(comoAna.textoEntero.includes('17.60'))}; ¿dice 7.70? ${String(comoAna.textoEntero.includes('7.70'))}`,
      comoAna.totales === 0 &&
        !comoAna.textoEntero.includes('17.60') &&
        !comoAna.textoEntero.includes('7.70'),
    );

    const totalesPorElCanal = await ventana.evaluate(async () => {
      const respuesta = await window.pos.recibos.listar('todas');
      return respuesta.ok ? respuesta.datos.totales : respuesta.error;
    });
    anotar(`window.pos.recibos.listar('todas') con la sesión de la CAJERA: ${JSON.stringify(totalesPorElCanal)}`);
    comprobar(
      'Y EL CANAL TAMPOCO SE LOS MANDA: llamado desde la consola, `totales` viene en null',
      'null',
      JSON.stringify(totalesPorElCanal),
      totalesPorElCanal === null,
    );

    await filtrar('tarjeta');
    comprobar(
      'la cajera también puede filtrar, y el botón «Anular» sigue ahí',
      '3 filas con tarjeta y al menos un botón «Anular»',
      `${String(await filasVisibles())} filas, ${String(await prueba('recibo-anular').count())} botones`,
      (await filasVisibles()) === 3 && (await prueba('recibo-anular').count()) >= 1,
    );
  } catch (error) {
    comprobar('el arnés llegó al final sin errores', 'sin excepciones', String(error), false);
    console.log(String(error?.stack ?? error));
  } finally {
    const fallidas = comprobaciones.filter((una) => !una.paso);
    console.log('');
    console.log(
      `${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`,
    );
    for (const una of fallidas) {
      console.log(`  - ${una.nombre}`);
    }
    console.log(`carpeta de datos de esta corrida: ${datos}`);
    await Promise.race([
      app.close(),
      new Promise((r) => {
        setTimeout(r, 15000);
      }),
    ]);
    process.exit(fallidas.length === 0 ? 0 : 1);
  }
}

void main();
