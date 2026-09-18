/**
 * verificacion-de-copias-del-recibo.cjs — Las DOS copias impresas del recibo,
 * manejando la aplicación REAL (spec/features/001-recibo-copia-tienda-cliente).
 *
 * EN ESTA MAC NO HAY WINDOWS NI UNA TÉRMICA. La aplicación arranca con
 * `POS_IMPRESORAS_SIMULADAS=<carpeta>` y la impresora simulada escribe en un
 * archivo los BYTES que recibiría la térmica. El arnés los lee, los parte por
 * el comando de corte (GS V B 0), los decodifica de CP850 y **muestra el texto
 * completo de cada copia tal cual salió**. Lo que NO puede contestar: cómo se
 * ve en la 3nStar RPT004 de la tienda, ni si corta bien entre una copia y la
 * otra (spec §9, pregunta 3).
 *
 * El recorrido:
 *   1. Jimmy crea el primer usuario con clics. Por los canales reales de la
 *      ventana fija el tope del rol venta, crea a Ana y el catálogo, y elige la
 *      impresora simulada.
 *   2. Ana abre la caja y cobra la venta del ejemplo de la spec: 10 lb de maíz
 *      a Q6.69, 30 % de descuento que pasa el tope, autorizado con el PIN de
 *      Jimmy, pagada con tarjeta.
 *   3. Los bytes: UN trabajo, DOS copias, cliente primero. Se imprime el texto
 *      de cada una y se compara renglón por renglón contra la spec §4.3.
 *   4. La pantalla «Ver» muestra la versión completa, que es la de la tienda sin
 *      su encabezado. De paso, esto verifica el decodificador CP850 del arnés.
 *   5. El PDF del disco lleva el autorizante y la boleta, sin encabezado.
 *   6. Reimprimir TOCANDO el botón del historial: dos copias con REIMPRESIÓN,
 *      y el aviso de la pantalla nombra las dos.
 *   7. Una venta en efectivo sin descuento: las copias difieren solo en el
 *      encabezado.
 *   8. Se anula la venta con tarjeta: NO sale nada por la térmica. Después se
 *      reimprime, y se muestra cómo sale la copia del cliente de una venta
 *      anulada (spec §9, pregunta 1).
 *
 * La ventana se fija a 1024×768 EXACTOS por CDP antes de cada captura y de cada
 * clic, como en `verify:pantallas:1024`.
 *
 * Salida: cada comprobación con lo esperado y lo real, el texto de las copias,
 * y código 1 si alguna falla.
 */

'use strict';

const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const DatabaseConstructor = require('better-sqlite3');
const rutaDeElectron = require('electron');

const { terminarAplicacion } = require('./terminar-aplicacion.cjs');
const { textoDelPdf } = require('./texto-de-pdf.cjs');

const PROYECTO = join(__dirname, '..');
const PIN_JIMMY = '2468';
const PIN_ANA = '1357';
const VOUCHER = '004512';
const MOTIVO = 'el cliente devolvió el producto';
const RECIBE = 'Termica-simulada';
const ANCHO = 1024;
const ALTO = 768;
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;

/** ESC @ + ESC t 2: así empieza cada copia. */
const INICIO_DE_COPIA = [0x1b, 0x40, 0x1b, 0x74, 0x02];
/** ESC d 3 + GS V B 0: así termina cada copia. */
const FIN_DE_COPIA = [0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x00];
const CORTE = [0x1d, 0x56, 0x42, 0x00];

/**
 * CP850 → texto, para los bytes que no son ASCII. Es la tabla de `escpos.ts`
 * al revés. Si esta copia se desviara de aquella, la comprobación del paso 4
 * (la copia de la tienda contra la pantalla, que llega en UTF-8) fallaría.
 */
const DESDE_CP850 = new Map([
  [0xa0, 'á'], [0x82, 'é'], [0xa1, 'í'], [0xa2, 'ó'], [0xa3, 'ú'],
  [0xb5, 'Á'], [0x90, 'É'], [0xd6, 'Í'], [0xe0, 'Ó'], [0xe9, 'Ú'],
  [0xa4, 'ñ'], [0xa5, 'Ñ'], [0x81, 'ü'], [0x9a, 'Ü'],
  [0xa8, '¿'], [0xad, '¡'], [0xa7, 'º'], [0xa6, 'ª'], [0xf8, '°'],
]);

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

function espera(ms) {
  return new Promise((resolver) => {
    setTimeout(resolver, ms);
  });
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** Dónde aparece una secuencia de bytes. */
function posiciones(bytes, secuencia) {
  const encontradas = [];
  for (let i = 0; i + secuencia.length <= bytes.length; i += 1) {
    if (secuencia.every((b, j) => bytes[i + j] === b)) {
      encontradas.push(i);
    }
  }
  return encontradas;
}

/**
 * Parte lo que recibió la impresora en copias, y decodifica cada una.
 * Devuelve también lo que no calzó con la estructura, para informarlo.
 */
function copiasDe(bytes) {
  const cortes = posiciones(bytes, CORTE);
  const copias = [];
  const problemas = [];
  let desde = 0;
  for (const corte of cortes) {
    const tramo = bytes.subarray(desde, corte + CORTE.length);
    desde = corte + CORTE.length;
    const empieza = INICIO_DE_COPIA.every((b, i) => tramo[i] === b);
    const termina = FIN_DE_COPIA.every((b, i) => tramo[tramo.length - FIN_DE_COPIA.length + i] === b);
    if (!empieza || !termina) {
      problemas.push(`copia ${String(copias.length + 1)}: empieza=${String(empieza)} termina=${String(termina)}`);
    }
    // El cuerpo: entre la página de códigos y el avance, sin el salto final.
    const cuerpo = tramo.subarray(INICIO_DE_COPIA.length, tramo.length - FIN_DE_COPIA.length);
    let texto = '';
    for (const byte of cuerpo) {
      if (byte < 0x80) {
        texto += String.fromCharCode(byte);
      } else if (DESDE_CP850.has(byte)) {
        texto += DESDE_CP850.get(byte);
      } else {
        problemas.push(`copia ${String(copias.length + 1)}: byte 0x${byte.toString(16)} sin traducción`);
        texto += '?';
      }
    }
    copias.push(texto.endsWith('\n') ? texto.slice(0, -1) : texto);
  }
  if (desde !== bytes.length) {
    problemas.push(`quedaron ${String(bytes.length - desde)} bytes después del último corte`);
  }
  return { copias, cortes: cortes.length, problemas };
}

/** Las dos copias del ejemplo de la spec §4.3, con la fecha y la hora de la corrida. */
function esperadoDeLaSpec(fechaYHora, copia) {
  const fecha = `Fecha${' '.repeat(48 - 5 - fechaYHora.length)}${fechaYHora}`;
  const comunes = [
    '              [Nombre del negocio]',
    '                  [Dirección]',
    '                Tel. [Teléfono]',
    '                   NIT [NIT]',
    '',
    '                RECIBO DE VENTA',
    '    Proforma, no válido como factura fiscal',
  ];
  const encabezado =
    copia === 'cliente'
      ? ['               COPIA DEL CLIENTE']
      : ['               COPIA DE LA TIENDA', '   Control interno. No se entrega al cliente.'];
  return [
    ...comunes,
    ...encabezado,
    '------------------------------------------------',
    'Recibo No.                                     1',
    fecha,
    'Cajero                                       Ana',
    '------------------------------------------------',
    'Maíz blanco',
    '  10 lb x 4.68                             46.83',
    '------------------------------------------------',
    '  Precios e importes ya incluyen el descuento.',
    'Descuento 30 %                            -20.07',
    ...(copia === 'tienda' ? ['Autorizado por: Jimmy'] : []),
    'TOTAL                                      46.83',
    '',
    'Forma de pago                            Tarjeta',
    ...(copia === 'tienda' ? ['Boleta                                    004512'] : []),
    '',
    '            ¡Gracias por su compra!',
  ].join('\n');
}

/** Imprime una copia tal cual, con un marco para que se vea dónde empieza y termina. */
function mostrarCopia(titulo, texto) {
  console.info(`\n┌── ${titulo} ${'─'.repeat(Math.max(0, 44 - titulo.length))}`);
  for (const renglon of texto.split('\n')) {
    console.info(`│${renglon}`);
  }
  console.info(`└${'─'.repeat(48)}\n`);
}

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-copias-'));
  const simuladas = join(datos, 'impresoras-simuladas');
  const capturas = join(datos, 'capturas');
  mkdirSync(simuladas);
  mkdirSync(capturas);
  const archivoDeLaTermica = join(simuladas, `${RECIBE}.bin`);
  const rutaDeLaBase = join(datos, 'pos-agricola.db');

  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
    env: { ...process.env, POS_IMPRESORAS_SIMULADAS: simuladas },
  });
  // El proceso se guarda AHORA, con la aplicación viva (§6.2, punto 49).
  const procesoDeLaAplicacion = app.process();
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  const cdp = await ventana.context().newCDPSession(ventana);

  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const pos = (codigo, argumento) => ventana.evaluate(codigo, argumento);
  /**
   * Cobra y ESPERA EL PAPEL. Desde que el cobro no espera a la impresora
   * (CLAUDE.md §4.64, llegado de develop el 2026-09-18), la respuesta del cobro
   * trae la impresión EN CURSO («Enviando el recibo a la impresora…») y el
   * resultado del papel llega después, por `recibos:impresion-terminada`. Se
   * escucha ese aviso ANTES de cobrar, para no perderlo, y se espera hasta 15 s
   * antes de leer los bytes de la térmica.
   */
  const cobrarYEsperarElPapel = (pedido) =>
    ventana.evaluate(async (p) => {
      let quitar = () => undefined;
      const aviso = new Promise((resolver) => {
        quitar = window.pos.recibos.alTerminarImpresion((a) => resolver(a));
      });
      const respuesta = await window.pos.venta.cobrar(p);
      if (!respuesta.ok || !respuesta.datos.registrada || !respuesta.datos.recibo.impresionPendiente) {
        quitar();
        return { respuesta, aviso: null };
      }
      const llegado = await Promise.race([aviso, new Promise((r) => setTimeout(() => r(null), 15000))]);
      quitar();
      return { respuesta, aviso: llegado };
    }, pedido);
  /** 1024×768 EXACTOS. Se vuelve a poner antes de cada clic y cada captura (ver verify:pantallas:1024). */
  const fijarVentana = async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: ANCHO, height: ALTO, deviceScaleFactor: 1, mobile: false });
    await espera(300);
    const real = await ventana.evaluate(() => [innerWidth, innerHeight]);
    if (real[0] !== ANCHO || real[1] !== ALTO) {
      throw new Error(`la ventana mide ${real.join('×')} y se pidió ${String(ANCHO)}×${String(ALTO)}: no se mide`);
    }
    return real;
  };
  const capturar = async (nombre) => {
    await fijarVentana();
    await espera(400);
    const ruta = join(capturas, `${nombre}.png`);
    await ventana.screenshot({ path: ruta });
    anotar(`captura (1024×768): ${ruta}`);
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
  const bytesDeLaTermica = () => (existsSync(archivoDeLaTermica) ? readFileSync(archivoDeLaTermica) : Buffer.alloc(0));
  /** La fila del historial de un número de recibo, sin confundir el 1 con el 10. */
  const filaDelRecibo = (numero) =>
    ventana.locator('[data-prueba="fila-de-recibo"]', { hasText: new RegExp(`Recibo No\\. ${String(numero)}(?!\\d)`) });

  try {
    // =======================================================================
    // 1. La instalación
    // =======================================================================
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    const medida = await fijarVentana();
    anotar(`ventana: ${medida.join('×')}`);
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
        exigir(await window.pos.limites.fijar({ rol: 'venta', porcentaje: '10', montoFijo: '20' }), 'tope del rol venta');
        exigir(await window.pos.impresora.guardar(p.impresora), 'elegir la impresora');
        const ana = exigir(await window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pin: p.ana }), 'crear Ana');
        const categoria = exigir(await window.pos.catalogo.crearCategoria('Granos', 1), 'categoría');
        const maiz = exigir(
          await window.pos.catalogo.crearProducto({
            nombre: 'Maíz blanco',
            categoriaId: categoria.id,
            tipoMedida: 'peso',
            unidadPeso: 'lb',
            cantidadPredefinidaIcono: '1',
            precioBase: '6.69',
            precioCompra: null,
            fotoPath: null,
            inventarioInicial: '100',
          }),
          'producto',
        );
        const estadoDeLaImpresora = exigir(await window.pos.impresora.estado(), 'estado de la impresora');
        exigir(await window.pos.sesion.cerrar(), 'cerrar sesión de Jimmy');
        const ingreso = exigir(await window.pos.sesion.iniciar(ana.id, p.ana), 'ingresar Ana');
        if (!ingreso.autenticado) throw new Error('Ana no entró');
        exigir(await window.pos.caja.abrir({ modo: 'simple', monto: '500' }), 'abrir caja');
        return { maiz: maiz.id, impresora: estadoDeLaImpresora.descripcion };
      },
      { ana: PIN_ANA, impresora: RECIBE },
    );
    anotar(`armado: ${JSON.stringify(armado)}`);

    // =======================================================================
    // 2. La venta del ejemplo de la spec
    // =======================================================================
    const pedido = {
      lineas: [{ productoId: armado.maiz, cantidad: '10' }],
      descuento: { tipo: 'porcentaje', valor: '30' },
      formaPago: 'tarjeta',
      numBoleta: VOUCHER,
    };
    const sinPin = await pos((p) => window.pos.venta.cobrar(p), pedido);
    anotar(`cobro SIN PIN: ${JSON.stringify(sinPin.ok ? { registrada: sinPin.datos.registrada, codigo: sinPin.datos.codigo, requiereAutorizacion: sinPin.datos.requiereAutorizacion, tope: sinPin.datos.tope, exceso: sinPin.datos.exceso } : sinPin)}`);
    comprobar(
      'el descuento de 30 % PASA el tope del rol venta y pide autorización (así el recibo tiene autorizante)',
      'registrada=false; requiereAutorizacion=true; nada impreso',
      `registrada=${String(sinPin.ok && sinPin.datos.registrada)}; requiereAutorizacion=${String(sinPin.ok && sinPin.datos.requiereAutorizacion)}; impreso=${existsSync(archivoDeLaTermica) ? 'sí' : 'no'}`,
      sinPin.ok && sinPin.datos.registrada === false && sinPin.datos.requiereAutorizacion === true && !existsSync(archivoDeLaTermica),
    );
    const { respuesta: cobro, aviso: avisoDelPapel } = await cobrarYEsperarElPapel({ ...pedido, pinDescuento: PIN_JIMMY });
    anotar(`aviso de fin de impresión (recibos:impresion-terminada): ${JSON.stringify(avisoDelPapel)}`);
    if (!cobro.ok || !cobro.datos.registrada) {
      throw new Error(`el cobro con el PIN de Jimmy no se registró: ${JSON.stringify(cobro)}`);
    }
    const venta1 = cobro.datos;
    anotar(`cobro CON el PIN de Jimmy: ${JSON.stringify({ ventaId: venta1.ventaId, total: venta1.total, descuentoAplicado: venta1.descuentoAplicado, formaPago: venta1.formaPago, numBoleta: venta1.numBoleta, recibo: venta1.recibo })}`);

    // =======================================================================
    // 3. Lo que recibió la térmica
    // =======================================================================
    const bytesDeLaVenta = bytesDeLaTermica();
    const venta1Impresa = copiasDe(bytesDeLaVenta);
    anotar(`la térmica recibió ${String(bytesDeLaVenta.length)} bytes (sha256 ${sha(bytesDeLaVenta)}); cortes: ${String(venta1Impresa.cortes)}; primeros 8: ${bytesDeLaVenta.subarray(0, 8).toString('hex')}; últimos 8: ${bytesDeLaVenta.subarray(-8).toString('hex')}`);
    const [clienteImpresa = '', tiendaImpresa = ''] = venta1Impresa.copias;
    mostrarCopia('COPIA 1 (primera en salir)', clienteImpresa);
    mostrarCopia('COPIA 2 (segunda en salir)', tiendaImpresa);

    const logTecnico = existsSync(join(datos, 'log-tecnico.log')) ? readFileSync(join(datos, 'log-tecnico.log'), 'utf8') : '';
    for (const linea of logTecnico.split('\n').filter((l) => l.includes('[impresion]'))) {
      anotar(`log-tecnico: ${linea}`);
    }
    comprobar(
      'UN solo trabajo con DOS copias: dos cortes, cada copia empieza con ESC @ + CP850 y termina con avance + corte, y nada suelto',
      '2 copias; 2 cortes; sin problemas de estructura; 1 envío en la bitácora',
      `${String(venta1Impresa.copias.length)} copias; ${String(venta1Impresa.cortes)} cortes; problemas: ${JSON.stringify(venta1Impresa.problemas)}; envíos: ${String(logTecnico.split('\n').filter((l) => l.includes('en un solo trabajo')).length)}`,
      venta1Impresa.copias.length === 2 && venta1Impresa.cortes === 2 && venta1Impresa.problemas.length === 0 &&
        logTecnico.split('\n').filter((l) => l.includes('2 copia(s) en un solo trabajo')).length === 1,
    );
    comprobar(
      'LA PRIMERA en salir es la del CLIENTE y la segunda la de la TIENDA',
      'copia 1 dice «COPIA DEL CLIENTE»; copia 2 dice «COPIA DE LA TIENDA» y «Control interno. No se entrega al cliente.»',
      `copia 1: ${clienteImpresa.includes('COPIA DEL CLIENTE')}/${clienteImpresa.includes('COPIA DE LA TIENDA')}; copia 2: ${tiendaImpresa.includes('COPIA DE LA TIENDA')}/${tiendaImpresa.includes('Control interno. No se entrega al cliente.')}`,
      clienteImpresa.includes('COPIA DEL CLIENTE') && !clienteImpresa.includes('COPIA DE LA TIENDA') &&
        tiendaImpresa.includes('COPIA DE LA TIENDA') && tiendaImpresa.includes('Control interno. No se entrega al cliente.'),
    );
    comprobar(
      'LA DEL CLIENTE no dice quién autorizó el descuento ni el número de boleta, en NINGÚN renglón',
      'sin «Autorizado por», sin «Jimmy», sin «Boleta», sin 004512',
      ['Autorizado por', 'Jimmy', 'Boleta', VOUCHER].filter((t) => clienteImpresa.includes(t)).join(', ') || 'ninguno',
      !['Autorizado por', 'Jimmy', 'Boleta', VOUCHER].some((t) => clienteImpresa.includes(t)),
    );
    comprobar(
      'LA DEL CLIENTE sí dice el descuento, el total y que se pagó con tarjeta',
      'Descuento 30 % -20.07; TOTAL 46.83; Forma de pago Tarjeta',
      clienteImpresa.split('\n').filter((l) => /^(Descuento|TOTAL|Forma de pago)/.test(l)).join(' | '),
      /^Descuento 30 % +-20\.07$/m.test(clienteImpresa) && /^TOTAL +46\.83$/m.test(clienteImpresa) && /^Forma de pago +Tarjeta$/m.test(clienteImpresa),
    );
    comprobar(
      'LA DE LA TIENDA dice quién autorizó el descuento y el número de boleta',
      'Autorizado por: Jimmy; Boleta 004512',
      tiendaImpresa.split('\n').filter((l) => /^(Autorizado por|Boleta)/.test(l)).join(' | '),
      tiendaImpresa.includes('Autorizado por: Jimmy') && /^Boleta +004512$/m.test(tiendaImpresa),
    );
    const fechaYHora = (tiendaImpresa.split('\n').find((l) => l.startsWith('Fecha')) ?? '').replace(/^Fecha +/, '');
    for (const copia of ['cliente', 'tienda']) {
      const impresa = copia === 'cliente' ? clienteImpresa : tiendaImpresa;
      const esperada = esperadoDeLaSpec(fechaYHora, copia);
      const distintos = esperada
        .split('\n')
        .map((renglon, i) => ({ i, esperado: renglon, real: impresa.split('\n')[i] }))
        .filter(({ esperado, real }) => esperado !== real);
      comprobar(
        `LA COPIA ${copia === 'cliente' ? 'DEL CLIENTE' : 'DE LA TIENDA'} ES, RENGLÓN POR RENGLÓN, LA QUE PREDIJO LA SPEC (§4.3), salvo la fecha y la hora de la corrida`,
        `${String(esperada.split('\n').length)} renglones iguales`,
        distintos.length === 0 && esperada.split('\n').length === impresa.split('\n').length
          ? 'iguales'
          : `${String(impresa.split('\n').length)} renglones; distintos: ${JSON.stringify(distintos.slice(0, 4))}`,
        distintos.length === 0 && esperada.split('\n').length === impresa.split('\n').length,
      );
    }
    /*
      CAMBIÓ AL UNIR develop (2026-09-18): antes esta comprobación leía
      `impreso=true` y el mensaje de las dos copias en la RESPUESTA del cobro.
      Con el cobro que no espera a la impresora (§4.64), la respuesta dice que
      la impresión sigue en curso y el resultado llega en el aviso aparte.
    */
    comprobar(
      'EL COBRO responde sin esperar el papel (PDF generado, impresión en curso) y EL AVISO posterior dice impreso y nombra las dos copias',
      'respuesta: pdfGenerado=true, impresionPendiente=true; aviso: impreso=true, «Recibo enviado a la impresora: copia del cliente y copia de la tienda.»',
      `respuesta: pdfGenerado=${String(venta1.recibo.pdfGenerado)}, impresionPendiente=${String(venta1.recibo.impresionPendiente)}; aviso: ${avisoDelPapel === null ? 'NO LLEGÓ' : `impreso=${String(avisoDelPapel.impreso)}, «${avisoDelPapel.mensaje}», recibo ${avisoDelPapel.reciboId === venta1.recibo.id ? 'el de esta venta' : 'OTRO'}`}`,
      venta1.recibo.pdfGenerado === true && venta1.recibo.impresionPendiente === true && avisoDelPapel !== null &&
        avisoDelPapel.reciboId === venta1.recibo.id && avisoDelPapel.impreso === true &&
        avisoDelPapel.mensaje === 'Recibo enviado a la impresora: copia del cliente y copia de la tienda.',
    );
    const filaDelReciboEnLaBase = leerBase('SELECT numero_recibo, impreso, pdf_path FROM recibos WHERE venta_id = ?', venta1.ventaId)[0];
    anotar(`recibos en la base: ${JSON.stringify(filaDelReciboEnLaBase)}`);
    comprobar('la base marca el recibo como impreso, con UN solo número', 'numero_recibo=1; impreso=1', `numero_recibo=${String(filaDelReciboEnLaBase?.numero_recibo)}; impreso=${String(filaDelReciboEnLaBase?.impreso)}`, filaDelReciboEnLaBase?.numero_recibo === 1 && filaDelReciboEnLaBase?.impreso === 1);

    // =======================================================================
    // 4. La pantalla «Ver» y 5. el PDF del disco
    // =======================================================================
    await fijarVentana();
    await prueba('ir-a-recibos').click();
    await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA });
    await fijarVentana();
    await filaDelRecibo(1).locator('[data-prueba="recibo-ver"]').click();
    await prueba('vista-de-recibo').waitFor({ timeout: ESPERA_CORTA });
    const enPantalla = (await prueba('recibo-texto').textContent()) ?? '';
    await capturar('1-ver-recibo-version-completa');
    const tiendaSinEncabezado = tiendaImpresa
      .split('\n')
      .filter((l) => !['COPIA DE LA TIENDA', 'Control interno. No se entrega al cliente.'].includes(l.trim()))
      .join('\n');
    comprobar(
      'LA PANTALLA «Ver» muestra la versión COMPLETA: es la copia de la tienda sin su encabezado, carácter por carácter (esto verifica también el decodificador CP850 del arnés)',
      'idénticas',
      enPantalla === tiendaSinEncabezado ? 'idénticas' : `distintas: pantalla ${String(enPantalla.length)} caracteres, tienda sin encabezado ${String(tiendaSinEncabezado.length)}`,
      enPantalla === tiendaSinEncabezado,
    );
    comprobar(
      'la pantalla NO lleva encabezado de copia',
      'sin «COPIA DEL CLIENTE» ni «COPIA DE LA TIENDA»',
      `${String(enPantalla.includes('COPIA DEL CLIENTE'))}/${String(enPantalla.includes('COPIA DE LA TIENDA'))}`,
      !enPantalla.includes('COPIA DEL CLIENTE') && !enPantalla.includes('COPIA DE LA TIENDA'),
    );
    await prueba('cerrar-vista-de-recibo').click();

    const textoDelPdfDeLaVenta = textoDelPdf(venta1.recibo.rutaPdf);
    anotar(`PDF ${venta1.recibo.rutaPdf}: ${String(readFileSync(venta1.recibo.rutaPdf).length)} bytes`);
    comprobar(
      'EL PDF DEL DISCO es la versión completa: lleva el autorizante y la boleta, y NINGÚN encabezado de copia',
      'Autorizado por: Jimmy; 004512; sin COPIA DEL CLIENTE ni COPIA DE LA TIENDA',
      `autorizante=${String(textoDelPdfDeLaVenta.includes('Autorizado por: Jimmy') || textoDelPdfDeLaVenta.includes('Autorizadopor:Jimmy'))}; boleta=${String(textoDelPdfDeLaVenta.includes(VOUCHER))}; COPIA=${String(textoDelPdfDeLaVenta.includes('COPIA'))}`,
      (textoDelPdfDeLaVenta.includes('Autorizado por: Jimmy') || textoDelPdfDeLaVenta.includes('Autorizadopor:Jimmy')) &&
        textoDelPdfDeLaVenta.includes(VOUCHER) && !textoDelPdfDeLaVenta.includes('COPIA'),
    );

    // =======================================================================
    // 6. Reimprimir TOCANDO el botón del historial
    // =======================================================================
    await fijarVentana();
    await filaDelRecibo(1).locator('[data-prueba="recibo-reimprimir"]').click();
    await prueba('vista-de-recibo').waitFor({ timeout: ESPERA_CORTA });
    await prueba('recibos-aviso').waitFor({ timeout: ESPERA_CORTA });
    const aviso = ((await prueba('recibos-aviso').textContent()) ?? '').trim();
    anotar(`aviso de la pantalla tras reimprimir: «${aviso}»`);
    await capturar('2-reimpreso-con-aviso');
    await prueba('cerrar-vista-de-recibo').click();
    await capturar('3-historial-tras-reimprimir');
    const reimpresa = copiasDe(bytesDeLaTermica());
    mostrarCopia('REIMPRESIÓN — COPIA 1', reimpresa.copias[0] ?? '');
    mostrarCopia('REIMPRESIÓN — COPIA 2', reimpresa.copias[1] ?? '');
    comprobar(
      'REIMPRIMIR desde el historial saca las DOS copias, las dos con «** REIMPRESIÓN **», cliente primero',
      '2 copias; las 2 con REIMPRESIÓN; copia 1 del cliente sin autorizante ni boleta',
      `${String(reimpresa.copias.length)} copias; REIMPRESIÓN: ${reimpresa.copias.map((c) => c.includes('** REIMPRESIÓN **')).join('/')}; copia 1: ${String((reimpresa.copias[0] ?? '').includes('COPIA DEL CLIENTE'))}, autorizante ${String((reimpresa.copias[0] ?? '').includes('Autorizado por'))}, boleta ${String((reimpresa.copias[0] ?? '').includes(VOUCHER))}`,
      reimpresa.copias.length === 2 && reimpresa.problemas.length === 0 &&
        reimpresa.copias.every((c) => c.includes('** REIMPRESIÓN **')) &&
        (reimpresa.copias[0] ?? '').includes('COPIA DEL CLIENTE') &&
        !(reimpresa.copias[0] ?? '').includes('Autorizado por') && !(reimpresa.copias[0] ?? '').includes(VOUCHER) &&
        (reimpresa.copias[1] ?? '').includes('Autorizado por: Jimmy') && (reimpresa.copias[1] ?? '').includes(VOUCHER),
    );
    comprobar(
      'el AVISO de la pantalla nombra las dos copias',
      '«Recibo 1 vuelto a emitir. Recibo enviado a la impresora: copia del cliente y copia de la tienda.»',
      aviso,
      aviso === 'Recibo 1 vuelto a emitir. Recibo enviado a la impresora: copia del cliente y copia de la tienda.',
    );

    // =======================================================================
    // 7. Una venta en efectivo sin descuento
    // =======================================================================
    const { respuesta: cobroEnEfectivo, aviso: avisoEnEfectivo } = await cobrarYEsperarElPapel({
      lineas: [{ productoId: armado.maiz, cantidad: '2' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });
    anotar(`aviso de fin de impresión de la venta en efectivo: ${JSON.stringify(avisoEnEfectivo)}`);
    if (!cobroEnEfectivo.ok || !cobroEnEfectivo.datos.registrada) {
      throw new Error(`la venta en efectivo no se registró: ${JSON.stringify(cobroEnEfectivo)}`);
    }
    const enEfectivo = copiasDe(bytesDeLaTermica());
    const sinEncabezado = (texto) =>
      texto.split('\n').filter((l) => !['COPIA DEL CLIENTE', 'COPIA DE LA TIENDA', 'Control interno. No se entrega al cliente.'].includes(l.trim())).join('\n');
    mostrarCopia('EFECTIVO SIN DESCUENTO — COPIA 1', enEfectivo.copias[0] ?? '');
    mostrarCopia('EFECTIVO SIN DESCUENTO — COPIA 2', enEfectivo.copias[1] ?? '');
    comprobar(
      'EN EFECTIVO Y SIN DESCUENTO las dos copias difieren SOLO en el encabezado',
      '2 copias, iguales sin su encabezado',
      `${String(enEfectivo.copias.length)} copias; ${sinEncabezado(enEfectivo.copias[0] ?? 'x') === sinEncabezado(enEfectivo.copias[1] ?? 'y') ? 'iguales sin encabezado' : 'distintas'}`,
      enEfectivo.copias.length === 2 && sinEncabezado(enEfectivo.copias[0] ?? 'x') === sinEncabezado(enEfectivo.copias[1] ?? 'y'),
    );

    // =======================================================================
    // 8. Anular la venta con tarjeta: no imprime; y cómo sale después
    // =======================================================================
    const antesDeAnular = bytesDeLaTermica();
    const vista = await pos((p) => window.pos.venta.anular({ ventaId: p.ventaId, motivo: p.motivo, voucher: p.voucher, pin: null }), { ventaId: venta1.ventaId, motivo: MOTIVO, voucher: VOUCHER });
    const anulacion = await pos((p) => window.pos.venta.anular({ ventaId: p.ventaId, motivo: p.motivo, voucher: p.voucher, pin: p.pin }), { ventaId: venta1.ventaId, motivo: MOTIVO, voucher: VOUCHER, pin: PIN_JIMMY });
    anotar(`anulación: vista previa ok=${String(vista.ok)} codigo=${vista.ok ? vista.datos.codigo : vista.error.codigo}; con PIN ok=${String(anulacion.ok)} anulada=${String(anulacion.ok && anulacion.datos.anulada)}`);
    const despuesDeAnular = bytesDeLaTermica();
    comprobar(
      'ANULAR no saca nada por la térmica (el archivo de la impresora simulada no cambió)',
      `sha256 ${sha(antesDeAnular)}`,
      `anulada=${String(anulacion.ok && anulacion.datos.anulada)}; sha256 ${sha(despuesDeAnular)}`,
      anulacion.ok && anulacion.datos.anulada === true && sha(antesDeAnular) === sha(despuesDeAnular),
    );
    await fijarVentana();
    // Se vuelve a entrar para releer la lista: la fila pasa a decir «Anulada».
    await prueba('pantalla-de-recibos').locator('button', { hasText: 'Volver' }).click();
    await prueba('ir-a-recibos').click();
    await prueba('lista-de-recibos').waitFor({ timeout: ESPERA_CORTA });
    await fijarVentana();
    await filaDelRecibo(1).locator('[data-prueba="recibo-reimprimir"]').click();
    await prueba('vista-de-recibo').waitFor({ timeout: ESPERA_CORTA });
    await prueba('cerrar-vista-de-recibo').click();
    const anuladaReimpresa = copiasDe(bytesDeLaTermica());
    mostrarCopia('VENTA ANULADA REIMPRESA — COPIA 1', anuladaReimpresa.copias[0] ?? '');
    mostrarCopia('VENTA ANULADA REIMPRESA — COPIA 2', anuladaReimpresa.copias[1] ?? '');
    const clienteAnulada = anuladaReimpresa.copias[0] ?? '';
    const tiendaAnulada = anuladaReimpresa.copias[1] ?? '';
    /*
      CAMBIÓ EL 2026-09-18 (spec 001, pregunta 1, decidida por Julio): antes esta
      comprobación exigía «Autorizó: Jimmy» en la copia del cliente. Ahora la
      copia del cliente conserva la marca, la fecha y el motivo, y NO dice quién
      autorizó la anulación; la de la tienda sí.
    */
    comprobar(
      'LA COPIA DEL CLIENTE de una venta anulada lleva la marca y el motivo, pero NO quién autorizó la anulación, ni el autorizante del descuento ni la boleta (spec §9, pregunta 1)',
      '** VENTA ANULADA **; Motivo: …; sin «Autorizó»; sin «Autorizado por»; sin 004512',
      `marca ${String(clienteAnulada.includes('** VENTA ANULADA **'))}; motivo ${String(clienteAnulada.includes(`Motivo: ${MOTIVO}`))}; «Autorizó» ${String(clienteAnulada.includes('Autorizó'))}; autorizante del descuento ${String(clienteAnulada.includes('Autorizado por'))}; boleta ${String(clienteAnulada.includes(VOUCHER))}`,
      clienteAnulada.includes('** VENTA ANULADA **') && clienteAnulada.includes(`Motivo: ${MOTIVO}`) &&
        !clienteAnulada.includes('Autorizó') && !clienteAnulada.includes('Autorizado por') && !clienteAnulada.includes(VOUCHER),
    );
    comprobar(
      'LA COPIA DE LA TIENDA de la venta anulada SÍ dice quién autorizó la anulación',
      'Autorizó: Jimmy',
      `«Autorizó: Jimmy» ${String(tiendaAnulada.includes('Autorizó: Jimmy'))}`,
      tiendaAnulada.includes('Autorizó: Jimmy'),
    );
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
    await ventana.screenshot({ path: join(capturas, 'error.png') }).catch(() => undefined);
  } finally {
    terminarAplicacion(procesoDeLaAplicacion);
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(`\n${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
  console.info(`Carpeta de la corrida (capturas, base, log-tecnico.log, bytes de la impresora): ${datos}`);
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verificacion-de-copias-del-recibo] Falló antes de poder comprobar nada: ${error.message}`);
  process.exit(1);
});
