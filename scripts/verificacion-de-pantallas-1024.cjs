/**
 * verificacion-de-pantallas-1024.cjs — LA PANTALLA DE LA TIENDA: 1024×768, con
 * el dedo, en la aplicación REAL (§4.62).
 *
 * ===========================================================================
 * POR QUÉ EXISTE
 * ===========================================================================
 * Julio probó el sistema en el equipo de la tienda —pantalla de 1024×768, un
 * i3 de 2011 con gráfico Intel HD 3000— y encontró dos cosas: el botón COBRAR
 * quedaba cortado en el borde derecho, y en las pantallas más altas que la
 * ventana no había forma de bajar con el dedo. Los arneses anteriores corrían
 * en una ventana de 1100×900 o más, que por casualidad escondía el primero.
 *
 * ===========================================================================
 * QUÉ COMPRUEBA
 * ===========================================================================
 *   · A 1024×768 EXACTOS —fijados por CDP antes de cada medición, y el arnés se
 *     niega a medir si la ventana no mide eso—, que en ningún estado de
 *     ninguna pantalla haya un control recortado, fuera de la ventana, o con
 *     el texto saliéndose de su botón.
 *   · Que la barra de 44 px aparece EXACTAMENTE en los estados más altos que
 *     la ventana, y en ningún otro.
 *   · Que COBRAR entra entero a 1024, 1280 y 1366, y que a 1920 se ve igual
 *     que antes.
 *   · Que en una pantalla larga real (el menú con el diagnóstico técnico) se
 *     puede bajar con un arrastre TÁCTIL, con un arrastre de MOUSE —lo que
 *     manda una pantalla táctil que Windows ve como mouse—, arrastrando el
 *     pulgar de la barra y tocando su flecha; y que arrastrar sobre un botón
 *     NO lo activa, mientras que tocarlo sí.
 *   · Que la barra y el teclado en pantalla no se tapan, y que con el teclado
 *     abierto se llega igual al botón «Guardar».
 *   · Que en la venta, la lista del ticket se desplaza con el arrastre sin
 *     quitar ninguna línea.
 *   · Que el diagnóstico técnico dice cómo llega el dedo: «touch» o «mouse».
 *
 * Códigos de salida: 0 todo bien, 1 alguna comprobación falló.
 */

'use strict';

const { mkdirSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const rutaDeElectron = require('electron');

const PROYECTO = join(__dirname, '..');
const PIN_JIMMY = '2468';
const ANCHO = 1024;
const ALTO = 768;
/** El ancho de la barra de la ventana, en `global.css`. */
const ANCHO_DE_LA_BARRA = 44;
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;

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

const espera = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

/**
 * Se evalúa DENTRO de la página. Devuelve todo control que no se pueda ver ni
 * alcanzar: recortado por un contenedor que no se desplaza, fuera de la
 * ventana, debajo de la ventana dentro de algo fijo, o con su texto saliéndose
 * del botón. Además, el ancho de la barra de la ventana.
 */
const AUDITAR_EN_LA_PAGINA = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const doc = document.scrollingElement;
  const desplazable = (el, eje) => {
    const cs = getComputedStyle(el);
    const ov = eje === 'y' ? cs.overflowY : cs.overflowX;
    const tam = eje === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
    return (ov === 'auto' || ov === 'scroll') && tam;
  };
  const nombre = (el) => {
    const dp = el.closest('[data-prueba]');
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + (dp ? '[' + dp.getAttribute('data-prueba') + ']' : '') + ' «' + t + '»';
  };
  const problemas = [];
  for (const el of document.querySelectorAll('button, input, select, textarea, a, [role="button"], h1, h2, [data-prueba]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let fijo = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ac = getComputedStyle(a);
      if (ac.position === 'fixed') fijo = true;
      const recortaX = ac.overflowX !== 'visible', recortaY = ac.overflowY !== 'visible';
      if (!recortaX && !recortaY) continue;
      const ar = a.getBoundingClientRect();
      if (recortaX && (r.right > ar.right + 1 || r.left < ar.left - 1) && !desplazable(a, 'x'))
        problemas.push({ tipo: 'recortado-horizontal', el: nombre(el), sobra: Math.round(Math.max(r.right - ar.right, ar.left - r.left)) });
      if (recortaY && (r.bottom > ar.bottom + 1 || r.top < ar.top - 1) && !desplazable(a, 'y'))
        problemas.push({ tipo: 'recortado-vertical', el: nombre(el), sobra: Math.round(Math.max(r.bottom - ar.bottom, ar.top - r.top)) });
      if (desplazable(a, 'y') || desplazable(a, 'x')) break;
    }
    if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1)
      problemas.push({ tipo: 'texto-desbordado-en-su-boton', el: nombre(el), sobra: el.scrollWidth - el.clientWidth });
    if (r.right > vw + 1 || r.left < -1)
      problemas.push({ tipo: 'fuera-de-la-ventana-horizontal', el: nombre(el), sobra: Math.round(Math.max(r.right - vw, -r.left)) });
    if (fijo && r.bottom > vh + 1)
      problemas.push({ tipo: 'fijo-debajo-de-la-ventana', el: nombre(el), sobra: Math.round(r.bottom - vh) });
  }
  const unicos = [...new Map(problemas.map((p) => [p.tipo + p.el, p])).values()];
  return {
    vw, vh,
    anchoDeBarra: innerWidth - document.documentElement.clientWidth,
    altoDelContenido: doc.scrollHeight,
    masAltoQueLaVentana: doc.scrollHeight > doc.clientHeight + 1,
    problemas: unicos,
  };
})()`;

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-1024-'));
  const capturas = join(datos, 'capturas');
  mkdirSync(capturas);

  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
  });
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  const cdp = await ventana.context().newCDPSession(ventana);

  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const teclearPin = async (pin) => {
    for (const digito of pin) {
      await prueba(`tecla-${digito}`).click();
    }
    await prueba('tecla-confirmar').click();
  };
  /**
   * La ventana a un tamaño EXACTO. MEDIDO: una emulación puesta antes de que
   * la ventana entre en pantalla completa se pierde, y la medición siguiente
   * sale a 1440×900. Por eso se vuelve a poner antes de cada medición y se
   * comprueba: si no mide lo pedido, el arnés no mide nada.
   */
  const fijarVentana = async (ancho, alto) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: ancho,
      height: alto,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await espera(500);
    const real = await ventana.evaluate(() => [innerWidth, innerHeight]);
    if (real[0] !== ancho || real[1] !== alto) {
      throw new Error(`la ventana mide ${real.join('×')} y se pidió ${String(ancho)}×${String(alto)}: no se mide`);
    }
  };
  const posicion = () => ventana.evaluate(() => Math.round(document.scrollingElement.scrollTop));
  const alInicio = () => ventana.evaluate(() => {
    document.scrollingElement.scrollTop = 0;
  });
  const raton = (type, x, y, buttons) =>
    cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  /** Un dedo que Windows entrega como MOUSE: bajar, moverse en pasos, soltar. */
  const arrastrarComoMouse = async (x, deY, aY) => {
    await raton('mousePressed', x, deY, 1);
    const pasos = 12;
    for (let paso = 1; paso <= pasos; paso++) {
      await raton('mouseMoved', x, deY + ((aY - deY) * paso) / pasos, 1);
      await espera(16);
    }
    await raton('mouseReleased', x, aY, 0);
    await espera(400);
  };
  /** Un dedo en una pantalla táctil de verdad. */
  const arrastrarConElDedo = async (x, deY, aY) => {
    const tocar = (type, y) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await tocar('touchStart', deY);
    const pasos = 12;
    for (let paso = 1; paso <= pasos; paso++) {
      await tocar('touchMove', deY + ((aY - deY) * paso) / pasos);
      await espera(16);
    }
    await tocar('touchEnd', aY);
    await espera(600);
  };

  /** Lo que devolvió la auditoría de cada estado, para el resumen del final. */
  const auditados = [];
  const auditar = async (estado) => {
    await fijarVentana(ANCHO, ALTO);
    await espera(300);
    await alInicio();
    const r = await ventana.evaluate(AUDITAR_EN_LA_PAGINA);
    await ventana.screenshot({
      path: join(capturas, `${String(auditados.length).padStart(2, '0')}-${estado}.png`),
    });
    auditados.push({ estado, ...r });
    anotar(
      `${estado}: ${String(r.vw)}×${String(r.vh)} · contenido de ${String(r.altoDelContenido)} px de alto · ` +
        `barra ${String(r.anchoDeBarra)} px · problemas ${JSON.stringify(r.problemas)}`,
    );
  };
  /** Vuelve al menú por los botones que vea una persona, tocando el primero que se pueda tocar. */
  const alMenu = async () => {
    for (let intento = 0; intento < 6; intento++) {
      if (await prueba('pantalla-de-sesion').isVisible().catch(() => false)) {
        return;
      }
      const botones = ventana.locator('button:visible', {
        hasText: /^(Atrás|Volver al ticket|Sí, vaciar el ticket|Cancelar|Cerrar|Volver)$/,
      });
      const cuantos = await botones.count();
      for (let k = cuantos - 1; k >= 0; k--) {
        const boton = botones.nth(k);
        const sePuede = await boton
          .click({ trial: true, timeout: 800 })
          .then(() => true)
          .catch(() => false);
        if (sePuede) {
          await boton.click();
          break;
        }
      }
      await espera(400);
    }
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
  };

  try {
    // =======================================================================
    // 1. La instalación, con un catálogo y ventas para que las listas se llenen.
    // =======================================================================
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await auditar('configuracion-inicial');
    await prueba('campo-nombre').fill('Jimmy');
    await prueba('continuar-al-pin').click();
    await auditar('configuracion-inicial-pin');
    await teclearPin(PIN_JIMMY);
    await teclearPin(PIN_JIMMY);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    await ventana.evaluate(async () => {
      const exigir = (respuesta) => {
        if (!respuesta.ok) {
          throw new Error(respuesta.error.mensaje);
        }
        return respuesta.datos;
      };
      exigir(await window.pos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pin: '1357' }));
      const categoria = exigir(await window.pos.catalogo.crearCategoria('Granos', 1));
      const nombres = ['Maíz blanco', 'Maíz amarillo', 'Frijol negro', 'Frijol rojo', 'Arroz', 'Azúcar',
        'Sal', 'Café en grano', 'Avena', 'Harina', 'Huevos', 'Aceite'];
      const productos = [];
      for (const [i, nombre] of nombres.entries()) {
        productos.push(exigir(await window.pos.catalogo.crearProducto({
          nombre, categoriaId: categoria.id, tipoMedida: i % 2 ? 'unidad' : 'peso', unidadPeso: i % 2 ? null : 'lb',
          cantidadPredefinidaIcono: '1', precioBase: '1234.50', precioCompra: '3.00', fotoPath: null, inventarioInicial: '100',
        })));
      }
      exigir(await window.pos.caja.abrir({ modo: 'simple', monto: '500' }));
      for (let k = 0; k < 6; k++) {
        exigir(await window.pos.venta.cobrar({
          lineas: [{ productoId: productos[k].id, cantidad: '2' }], descuento: null,
          formaPago: k % 2 ? 'tarjeta' : 'efectivo', numBoleta: k % 2 ? `B-${String(k)}` : null,
        }));
      }
    });

    // =======================================================================
    // 2. La auditoría de todas las pantallas a 1024×768.
    // =======================================================================
    await auditar('menu-con-diagnostico-tecnico');
    await prueba('ir-a-venta').click();
    await prueba('pantalla-de-venta').waitFor({ timeout: ESPERA_CORTA });
    await auditar('venta-ticket-vacio');
    for (let k = 0; k < 7; k++) {
      await prueba('icono-producto').nth(k).click();
    }
    await auditar('venta-ticket-con-7-lineas');
    await prueba('cobrar').click();
    await prueba('dialogo-de-cobro').waitFor({ timeout: ESPERA_CORTA });
    await auditar('venta-dialogo-de-cobro');
    await prueba('cobro-continuar').click();
    await prueba('pago-tarjeta').click();
    await auditar('venta-dialogo-de-cobro-forma-de-pago');
    await alMenu();
    await prueba('ir-a-caja').click();
    await prueba('pantalla-de-caja').waitFor({ timeout: ESPERA_CORTA });
    await auditar('caja-abierta');
    await prueba('ir-a-contar').click();
    await prueba('paso-de-conteo').waitFor({ timeout: ESPERA_CORTA });
    await auditar('caja-conteo-simple');
    await prueba('modo-detallado').click();
    await auditar('caja-conteo-por-denominacion');
    await alMenu();
    for (const nombre of ['recibos', 'productos', 'categorias', 'usuarios', 'historial-de-cajas', 'reportes',
      'limites', 'negocio', 'impresora', 'nube', 'sincronizacion', 'autorizacion-remota']) {
      await prueba(`ir-a-${nombre}`).click();
      await espera(900);
      await auditar(nombre);
      if (nombre === 'productos') {
        await prueba('productos-nuevo').click();
        await prueba('formulario-de-producto').waitFor({ timeout: ESPERA_CORTA });
        await auditar('productos-formulario');
        await prueba('producto-nombre').click();
        await auditar('productos-formulario-con-teclado');
      }
      if (nombre === 'reportes') {
        await prueba('periodo-hoy').click();
        await auditar('reportes-resumen');
        for (const texto of [/producto/i, /inventario/i]) {
          await ventana.locator('button:visible', { hasText: texto }).first().click();
          await auditar(`reportes-${texto.source}`);
        }
      }
      await alMenu();
    }
    await prueba('boton-salida').click();
    await espera(600);
    await auditar('dialogo-de-salida');
    await ventana.locator('button:visible', { hasText: 'Cancelar' }).first().click();
    await ventana.locator('button', { hasText: 'Cerrar sesión' }).first().click();
    await prueba('pantalla-de-ingreso').waitFor({ timeout: ESPERA_CORTA });
    await auditar('ingreso');
    await ventana.locator('[data-prueba="usuario-para-ingreso"]', { hasText: 'Jimmy' }).click();
    await prueba('pantalla-de-pin').waitFor({ timeout: ESPERA_CORTA });
    await auditar('ingreso-pin');

    const conProblemas = auditados.filter((a) => a.problemas.length > 0);
    comprobar(
      `A 1024×768, NINGUNO de los ${String(auditados.length)} estados tiene un control recortado, fuera de la ventana o con el texto saliéndose de su botón`,
      '0 estados con problemas',
      conProblemas.map((a) => `${a.estado}: ${JSON.stringify(a.problemas)}`).join(' | ') || '0',
      conProblemas.length === 0,
    );
    const altos = auditados.filter((a) => a.masAltoQueLaVentana);
    const barraMal = auditados.filter(
      (a) => a.anchoDeBarra !== (a.masAltoQueLaVentana ? ANCHO_DE_LA_BARRA : 0),
    );
    comprobar(
      `LA BARRA DE ${String(ANCHO_DE_LA_BARRA)} px aparece EXACTAMENTE en los estados más altos que la ventana (${String(altos.length)}) y en ningún otro`,
      `${String(ANCHO_DE_LA_BARRA)} px en: ${altos.map((a) => a.estado).join(', ')}; 0 px en los ${String(auditados.length - altos.length)} restantes`,
      barraMal.length === 0 ? 'así' : barraMal.map((a) => `${a.estado}: barra ${String(a.anchoDeBarra)} px, más alto: ${String(a.masAltoQueLaVentana)}`).join(' | '),
      barraMal.length === 0 && altos.length > 0 && altos.length < auditados.length,
    );

    // Se vuelve a entrar para lo que sigue.
    await teclearPin(PIN_JIMMY);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });

    // =======================================================================
    // 3. COBRAR en cuatro tamaños, con un total largo.
    // =======================================================================
    await prueba('ir-a-venta').click();
    await prueba('pantalla-de-venta').waitFor({ timeout: ESPERA_CORTA });
    for (let k = 0; k < 8; k++) {
      await prueba('icono-producto').first().click();
    }
    for (const [ancho, alto] of [[1024, 768], [1280, 800], [1366, 768], [1920, 1080]]) {
      await fijarVentana(ancho, alto);
      const medida = await ventana.evaluate(() => {
        const cobrar = document.querySelector('[data-prueba="cobrar"]');
        const ticket = document.querySelector('.ticket');
        const r = cobrar.getBoundingClientRect();
        const t = ticket.getBoundingClientRect();
        return {
          izquierda: Math.round(r.left),
          derecha: Math.round(r.right),
          ticketDerecha: Math.round(t.right),
          texto: cobrar.innerText.replace(/\s+/g, ' '),
          contenido: cobrar.scrollWidth,
          ancho: cobrar.clientWidth,
          direccion: getComputedStyle(cobrar).flexDirection,
        };
      });
      anotar(`COBRAR a ${String(ancho)}×${String(alto)}: ${JSON.stringify(medida)}`);
      comprobar(
        `COBRAR a ${String(ancho)}×${String(alto)} entra entero: dentro del ticket, de la ventana y con su texto adentro`,
        `derecha ≤ ${String(ancho)} y ≤ borde del ticket; contenido ≤ ancho`,
        `derecha ${String(medida.derecha)}, ticket ${String(medida.ticketDerecha)}, contenido ${String(medida.contenido)} en ${String(medida.ancho)} («${medida.texto}»)`,
        medida.derecha <= ancho && medida.derecha <= medida.ticketDerecha && medida.contenido <= medida.ancho + 1,
      );
      if (ancho === 1920) {
        comprobar(
          'a 1920 COBRAR se ve IGUAL que antes: texto y monto en una fila',
          'flex-direction: row',
          medida.direccion,
          medida.direccion === 'row',
        );
      }
    }
    await fijarVentana(ANCHO, ALTO);

    // =======================================================================
    // 4. En la venta, la lista del ticket se desplaza arrastrando.
    // =======================================================================
    for (let k = 1; k < 12; k++) {
      await prueba('icono-producto').nth(k).click();
    }
    const lista = await ventana.evaluate(() => {
      const l = document.querySelector('.ticket__lineas');
      const r = l.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), arriba: Math.round(r.top), abajo: Math.round(r.bottom), alto: l.scrollHeight, vista: l.clientHeight };
    });
    const lineasAntes = await prueba('linea-de-ticket').count();
    await arrastrarComoMouse(lista.x, lista.abajo - 30, lista.arriba + 30);
    const listaDespues = await ventana.evaluate(() => Math.round(document.querySelector('.ticket__lineas').scrollTop));
    const lineasDespues = await prueba('linea-de-ticket').count();
    anotar(`lista del ticket: ${JSON.stringify(lista)}; después de arrastrar como mouse: scrollTop ${String(listaDespues)}; líneas ${String(lineasAntes)} → ${String(lineasDespues)}`);
    comprobar(
      'EN LA VENTA, arrastrar la lista del ticket la desplaza, y no quita ninguna línea',
      `scrollTop > 0 y ${String(lineasAntes)} líneas`,
      `scrollTop ${String(listaDespues)} y ${String(lineasDespues)} líneas`,
      listaDespues > 0 && lineasDespues === lineasAntes,
    );
    await alMenu();

    // =======================================================================
    // 5. Una pantalla larga REAL: el menú con el diagnóstico técnico.
    // =======================================================================
    await fijarVentana(ANCHO, ALTO);
    const maximo = await ventana.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    anotar(`menú: se puede bajar hasta ${String(maximo)} px`);

    await alInicio();
    await arrastrarConElDedo(400, 600, 150);
    const conElDedo = await posicion();
    comprobar(
      'EL MENÚ SE BAJA CON UN ARRASTRE TÁCTIL (pantalla táctil de verdad)',
      '> 0',
      `scrollTop ${String(conElDedo)} de ${String(maximo)}`,
      conElDedo > 0,
    );

    await alInicio();
    const vender = await prueba('ir-a-venta').boundingBox();
    await arrastrarComoMouse(Math.round(vender.x + vender.width / 2), Math.round(vender.y + vender.height / 2) + 300, Math.round(vender.y + vender.height / 2));
    await alInicio();
    const caja = await prueba('ir-a-caja').boundingBox();
    const yDeCaja = Math.round(caja.y + caja.height / 2);
    await arrastrarComoMouse(Math.round(caja.x + caja.width / 2), yDeCaja, yDeCaja - 200);
    const comoMouse = await posicion();
    const sigueEnElMenu = await prueba('pantalla-de-sesion').isVisible();
    anotar(`arrastre de mouse empezando SOBRE «Caja»: scrollTop ${String(comoMouse)}; ¿sigue en el menú? ${String(sigueEnElMenu)}`);
    comprobar(
      'EL MENÚ SE BAJA CON UN ARRASTRE DE MOUSE, que es lo que manda una pantalla táctil que Windows ve como mouse',
      '≈ 200',
      `scrollTop ${String(comoMouse)}`,
      comoMouse >= 150,
    );
    comprobar(
      'y el arrastre, aunque empiece SOBRE el botón «Caja», NO lo activa',
      'sigue en el menú',
      sigueEnElMenu ? 'sigue en el menú' : 'se abrió otra pantalla',
      sigueEnElMenu,
    );

    await alInicio();
    const anchoUtil = await ventana.evaluate(() => document.documentElement.clientWidth);
    const xDeLaBarra = anchoUtil + ANCHO_DE_LA_BARRA / 2;
    await arrastrarComoMouse(xDeLaBarra, 100, 350);
    const conElPulgar = await posicion();
    comprobar(
      'ARRASTRAR EL PULGAR de la barra de 44 px baja el menú',
      '> 0',
      `scrollTop ${String(conElPulgar)} (barra en x ${String(anchoUtil)}–${String(ANCHO)})`,
      conElPulgar > 0,
    );

    await alInicio();
    await raton('mousePressed', xDeLaBarra, ALTO - ANCHO_DE_LA_BARRA / 2, 1);
    await raton('mouseReleased', xDeLaBarra, ALTO - ANCHO_DE_LA_BARRA / 2, 0);
    await espera(400);
    const conLaFlecha = await posicion();
    comprobar(
      'TOCAR LA FLECHA de abajo de la barra baja un paso',
      '> 0',
      `scrollTop ${String(conLaFlecha)}`,
      conLaFlecha > 0,
    );

    await alInicio();
    await prueba('ir-a-caja').click();
    const tocarAbre = await prueba('pantalla-de-caja').isVisible().catch(() => false);
    comprobar(
      'TOCAR un botón sin arrastrar sigue funcionando: «Caja» abre la caja',
      'se abre la pantalla de caja',
      tocarAbre ? 'se abrió' : 'no se abrió',
      tocarAbre,
    );
    await alMenu();

    // =======================================================================
    // 6. La barra y el teclado en pantalla no se tapan.
    // =======================================================================
    await prueba('ir-a-productos').click();
    await prueba('productos-nuevo').click();
    await prueba('formulario-de-producto').waitFor({ timeout: ESPERA_CORTA });
    await fijarVentana(ANCHO, ALTO);
    await prueba('producto-nombre').click();
    await prueba('teclado-en-pantalla').waitFor({ timeout: ESPERA_CORTA });
    const conTeclado = await ventana.evaluate(() => {
      const t = document.querySelector('[data-prueba="teclado-en-pantalla"]').getBoundingClientRect();
      return {
        anchoUtil: document.documentElement.clientWidth,
        barra: innerWidth - document.documentElement.clientWidth,
        tecladoIzquierda: Math.round(t.left),
        tecladoDerecha: Math.round(t.right),
        tecladoArriba: Math.round(t.top),
      };
    });
    anotar(`con el teclado abierto: ${JSON.stringify(conTeclado)}`);
    comprobar(
      'CON EL TECLADO ABIERTO la barra sigue ahí, y el teclado termina donde empieza la barra: ni la tapa ni queda debajo',
      `barra ${String(ANCHO_DE_LA_BARRA)} px; teclado de 0 a ${String(ANCHO - ANCHO_DE_LA_BARRA)}`,
      `barra ${String(conTeclado.barra)} px; teclado de ${String(conTeclado.tecladoIzquierda)} a ${String(conTeclado.tecladoDerecha)}`,
      conTeclado.barra === ANCHO_DE_LA_BARRA && conTeclado.tecladoDerecha <= conTeclado.anchoUtil,
    );
    await arrastrarComoMouse(conTeclado.anchoUtil + ANCHO_DE_LA_BARRA / 2, 100, ALTO - 60);
    const alFondo = await ventana.evaluate(() => {
      const g = document.querySelector('[data-prueba="producto-guardar"]').getBoundingClientRect();
      const t = document.querySelector('[data-prueba="teclado-en-pantalla"]');
      return {
        scrollTop: Math.round(document.scrollingElement.scrollTop),
        guardarAbajo: Math.round(g.bottom),
        tecladoArriba: t === null ? null : Math.round(t.getBoundingClientRect().top),
      };
    });
    anotar(`arrastrando el pulgar con el teclado abierto: ${JSON.stringify(alFondo)}`);
    comprobar(
      'con el teclado abierto se arrastra la barra hasta el fondo, el teclado NO se cierra, y «Guardar» queda por encima de él',
      'teclado abierto y guardar.abajo ≤ teclado.arriba',
      JSON.stringify(alFondo),
      alFondo.tecladoArriba !== null && alFondo.scrollTop > 0 && alFondo.guardarAbajo <= alFondo.tecladoArriba,
    );
    await alMenu();

    // =======================================================================
    // 7. El diagnóstico técnico dice cómo llega el dedo.
    // =======================================================================
    await fijarVentana(ANCHO, ALTO);
    const tarjeta = prueba('tarjeta-pantalla-y-entrada');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y: 60 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await espera(300);
    const trasUnToque = (await tarjeta.innerText()).replace(/\s+/g, ' ');
    await raton('mousePressed', 60, 60, 1);
    await raton('mouseReleased', 60, 60, 0);
    await espera(300);
    const trasUnClic = (await tarjeta.innerText()).replace(/\s+/g, ' ');
    anotar(`tarjeta tras un toque: «${trasUnToque}»`);
    anotar(`tarjeta tras un clic: «${trasUnClic}»`);
    comprobar(
      'EL DIAGNÓSTICO dice el tamaño de la ventana y cómo llegó el último toque: «touch» con el dedo, «mouse» con el mouse',
      '1024 × 768 · touch, después mouse',
      `${trasUnToque} → ${trasUnClic}`,
      trasUnToque.includes('1024 × 768') && trasUnToque.includes('touch') && trasUnClic.includes('mouse'),
    );
    const aceleracion = await ventana.evaluate(async () => (await window.pos.diagnostico.aplicacion()).datos.aceleracionGrafica);
    anotar(`diagnóstico, «Aceleración gráfica»: ${aceleracion}`);
    comprobar(
      'EL DIAGNÓSTICO dice qué tarjeta gráfica vio Chromium y qué aceleró',
      'GPU … · composición: … · rasterizado: …',
      aceleracion,
      /composición: \S+ · rasterizado: \S+/.test(aceleracion),
    );
  } catch (error) {
    comprobar('el arnés llegó al final sin errores', 'sin excepciones', String(error), false);
    console.log(String(error?.stack ?? error));
    await ventana.screenshot({ path: join(capturas, 'error.png') }).catch(() => undefined);
  } finally {
    const fallidas = comprobaciones.filter((una) => !una.paso);
    console.log('');
    console.log(`${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
    for (const una of fallidas) {
      console.log(`  - ${una.nombre}`);
    }
    console.log(`capturas de esta corrida: ${capturas}`);
    // La salida controlada pide PIN (§4.5): se termina el proceso de la prueba.
    app.process().kill('SIGKILL');
    process.exit(fallidas.length === 0 ? 0 : 1);
  }
}

void main();
