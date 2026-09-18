/**
 * verificacion-de-precio-mayorista.cjs — El precio mayorista por cantidad
 * mínima (spec 002), manejando la aplicación REAL a 1024×768 exactos.
 *
 * Las pruebas de Vitest comprueban la regla, el servicio y la pantalla por
 * separado. Lo que ninguna de ellas puede ver es si, en la ventana de verdad,
 * con los dedos, la casilla aparece y desaparece, el teclado que abre cada
 * campo es el que corresponde, y el precio de la línea cambia solo cuando la
 * cantidad cruza el umbral. Eso es lo que recorre este guion.
 *
 * Qué comprueba, tocando la pantalla como una persona:
 *
 *   EL FORMULARIO (CA-20, F1 a F8)
 *     · La casilla «¿Aplica precio mayorista?» nace desmarcada y los dos campos
 *       NO EXISTEN en la pantalla.
 *     · Marcarla muestra los dos campos vacíos, con la unidad del producto en
 *       la etiqueta; pasar el producto a «por unidad» cambia las etiquetas y el
 *       teclado de la cantidad mínima.
 *     · Las reglas se avisan mientras se escribe, con el mismo texto que daría
 *       el servicio, y el botón de guardar queda deshabilitado.
 *     · Desmarcarla borra los valores; volver a marcarla los muestra vacíos.
 *     · Se guarda, y la fila de la base, el asiento y la cola lo dicen.
 *     · Al editar, la casilla aparece marcada y con sus valores.
 *
 *   LA DECISIÓN 1 (CA-24): bajar el precio de lista hasta el mayorista o por
 *   debajo se rechaza en las TRES capas: el formulario, el servicio (llamado
 *   por el canal, como lo haría una pantalla que se lo salteara) y la base
 *   (con una conexión aparte, como una consulta a mano).
 *
 *   LA VENTA (CA-12, CA-25): la línea cruza el umbral EN VIVO, hacia arriba
 *   tocando otra vez el ícono, hacia abajo con el teclado y otra vez hacia
 *   arriba con el teclado. El precio, la marca, el subtotal y el total cambian
 *   solos. Se cobra, y la base guarda el precio mayorista en
 *   `precio_unitario_snap`, con el origen en el asiento y en el recibo.
 *
 *   QUITARLO (F4): guardar con la casilla desmarcada deja las dos columnas en
 *   NULL, y la venta vuelve a cobrar el precio de lista.
 *
 * No hay precio especial en este recorrido: la aplicación no tiene pantalla
 * para crearlo (CLAUDE.md §6.2, punto 18). Los tres escenarios de precedencia
 * y el caso de seguridad están en Vitest, sobre la misma función que usa esta
 * pantalla.
 *
 * Salida: cada comprobación con lo esperado y lo real, con la hora, y las
 * capturas en la carpeta de la corrida. Código 1 si alguna falla.
 */

const { mkdirSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { _electron: electron } = require('playwright-core');
const rutaDeElectron = require('electron');
const DatabaseConstructor = require('better-sqlite3');
const { terminarAplicacion } = require('./terminar-aplicacion.cjs');

const PROYECTO = join(__dirname, '..');
const PIN = '2468';
const ESPERA_LARGA = 25000;
const ESPERA_CORTA = 10000;
/** Cuánto se espera a que la pantalla muestre lo que tiene que mostrar. */
const ESPERA_DE_LA_PANTALLA = 4000;
const ANCHO = 1024;
const ALTO = 768;

/** Los textos de la regla, tal como los escribe `src/shared/precio-mayorista.ts`. */
const FALTA_EL_PRECIO = 'Falta el precio mayorista.';
const CANTIDAD_NO_POSITIVA = 'La cantidad mínima para el precio mayorista tiene que ser mayor que cero.';
const noMenorQueLaLista = (precio, lista) =>
  `El precio mayorista (${precio}) tiene que ser menor que el precio de lista (${lista}). Bajá el precio mayorista o quitalo.`;
const listaPorDebajoDelMayorista = (precio) =>
  `No podés bajar el precio de lista por debajo del precio mayorista de ${precio}: ajustá el mayorista primero, o quitalo.`;
const PRECIO_NO_POSITIVO = 'El precio mayorista tiene que ser mayor que cero.';
const AVISO_DE_UNIDAD_CAMBIADA =
  'Al cambiar cómo se vende este producto se quita su precio mayorista (Q5.50 desde 50.000 lb). ' +
  'Guardá el producto y después cargalo de nuevo en la unidad nueva.';
/** Lo que NUNCA puede leer quien usa la pantalla: el idioma de SQLite. */
const JERGA_DE_LA_BASE = /productos_mayorista|CHECK constraint|SQLITE_|constraint failed/i;
const MARCA_DEL_MAYORISTA = 'Precio mayorista · desde 50 lb · antes Q6.00';

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

const espera = (ms) =>
  new Promise((resolver) => {
    setTimeout(resolver, ms);
  });

/** Espera a que se cumpla la condición; devuelve si se cumplió, nunca lanza. */
async function esperarQue(condicion, ms = ESPERA_DE_LA_PANTALLA) {
  const limite = Date.now() + ms;
  for (;;) {
    try {
      if (await condicion()) {
        return true;
      }
    } catch {
      // La pantalla puede estar redibujándose: se vuelve a mirar.
    }
    if (Date.now() >= limite) {
      return false;
    }
    await espera(100);
  }
}

const sinEspaciosDeMas = (texto) => (texto ?? '').replace(/\s+/g, ' ').trim();

async function main() {
  const datos = mkdtempSync(join(tmpdir(), 'pos-verificacion-precio-mayorista-'));
  const capturas = join(datos, 'capturas');
  mkdirSync(capturas);
  const rutaDeLaBase = join(datos, 'pos-agricola.db');

  const app = await electron.launch({
    executablePath: rutaDeElectron,
    args: [PROYECTO, `--user-data-dir=${datos}`],
    cwd: PROYECTO,
    env: { ...process.env },
  });
  const procesoDeLaAplicacion = app.process();
  const ventana = await app.firstWindow();
  await ventana.waitForLoadState('domcontentloaded');
  const cdp = await ventana.context().newCDPSession(ventana);

  const prueba = (nombre) => ventana.locator(`[data-prueba="${nombre}"]`);
  const texto = async (nombre) => sinEspaciosDeMas(await prueba(nombre).first().textContent());
  const capturar = async (nombre) => {
    const ruta = join(capturas, `${nombre}.png`);
    await ventana.screenshot({ path: ruta });
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
  /** Intenta una escritura con una conexión APARTE, como una consulta a mano. */
  const intentarEnLaBase = (sentencia, ...parametros) => {
    const conexion = new DatabaseConstructor(rutaDeLaBase);
    try {
      const resultado = conexion.prepare(sentencia).run(...parametros);
      return `ACEPTADA (changes=${String(resultado.changes)})`;
    } catch (error) {
      return `rechazada: ${String(error.code)} ${String(error.message)}`;
    } finally {
      conexion.close();
    }
  };
  /** 1024×768 EXACTOS, comprobado: si no mide eso, no se mide nada (§4.62). */
  const fijarVentana = async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: ANCHO, height: ALTO, deviceScaleFactor: 1, mobile: false });
    await espera(400);
    const real = await ventana.evaluate(() => [innerWidth, innerHeight]);
    if (real[0] !== ANCHO || real[1] !== ALTO) {
      throw new Error(`la ventana mide ${real.join('×')} y se pidió ${String(ANCHO)}×${String(ALTO)}: no se mide`);
    }
    anotar(`ventana fijada en ${real.join('×')}`);
  };
  const volver = async () => {
    await ventana.getByRole('button', { name: 'Volver' }).click();
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
  };

  // ---- El formulario ---------------------------------------------------------
  /** Toca teclas del teclado en pantalla, una por una, como un dedo. */
  const tocarTeclas = async (...teclas) => {
    for (const tecla of teclas) {
      await prueba(`tp-${tecla}`).click();
    }
  };
  /** Toca el campo, borra lo que tenga y escribe con el teclado en pantalla. */
  const escribirConElTeclado = async (campo, valor) => {
    await prueba(campo).click();
    await prueba('teclado-en-pantalla').waitFor({ timeout: ESPERA_CORTA });
    const actual = await prueba(campo).inputValue();
    for (let vez = 0; vez < Array.from(actual).length; vez += 1) {
      await prueba('tp-borrar').click();
    }
    await tocarTeclas(...Array.from(valor));
    return prueba(campo).inputValue();
  };
  const cerrarElTeclado = async () => {
    if ((await prueba('teclado-en-pantalla').count()) > 0) {
      await prueba('tp-listo').click();
      await prueba('teclado-en-pantalla').waitFor({ state: 'detached', timeout: ESPERA_CORTA });
    }
  };
  const disposicionDelTeclado = async () => prueba('teclado-en-pantalla').getAttribute('data-disposicion');
  const etiquetaDe = async (campo) =>
    sinEspaciosDeMas(
      await ventana.locator('label.campo', { has: prueba(campo) }).locator('.campo__etiqueta').textContent(),
    );
  const impedimento = async () =>
    (await prueba('producto-impedimento').count()) === 0 ? null : texto('producto-impedimento');
  const camposDelMayorista = async () =>
    (await prueba('producto-precio-mayorista').count()) + (await prueba('producto-cantidad-minima-mayorista').count());
  const estadoDelFormulario = async () => ({
    casilla: await prueba('producto-aplica-mayorista').isChecked(),
    campos: await camposDelMayorista(),
    precio: (await prueba('producto-precio-mayorista').count()) > 0 ? await prueba('producto-precio-mayorista').inputValue() : null,
    cantidad:
      (await prueba('producto-cantidad-minima-mayorista').count()) > 0
        ? await prueba('producto-cantidad-minima-mayorista').inputValue()
        : null,
    impedimento: await impedimento(),
    guardar: (await prueba('producto-guardar').isEnabled()) ? 'habilitado' : 'deshabilitado',
  });
  const describirFormulario = (e) =>
    `casilla=${e.casilla ? 'marcada' : 'desmarcada'}; campos=${String(e.campos)}; precio=${JSON.stringify(e.precio)}; ` +
    `cantidad=${JSON.stringify(e.cantidad)}; impedimento=${JSON.stringify(e.impedimento)}; guardar ${e.guardar}`;
  const editar = async (nombre) => {
    await ventana
      .locator('[data-prueba="lista-de-productos"] li', { hasText: nombre })
      .getByRole('button', { name: 'Editar' })
      .click();
    await prueba('formulario-de-producto').waitFor({ timeout: ESPERA_CORTA });
  };

  // ---- La venta ----------------------------------------------------------------
  const lineaDe = (productoId) => ventana.locator(`[data-prueba="linea-de-ticket"][data-producto="${productoId}"]`);
  const estadoDeLaLinea = async (productoId) => {
    const linea = lineaDe(productoId);
    if ((await linea.count()) !== 1) {
      return { detalle: '(sin línea)', subtotal: '', marca: null, especiales: 0, total: await texto('total-del-ticket') };
    }
    const marcas = linea.locator('[data-prueba="precio-mayorista"]');
    return {
      detalle: sinEspaciosDeMas(await linea.locator('.ticket__detalle').textContent()),
      subtotal: sinEspaciosDeMas(await linea.locator('[data-prueba="subtotal-de-linea"]').textContent()),
      marca: (await marcas.count()) === 1 ? sinEspaciosDeMas(await marcas.textContent()) : null,
      especiales: await linea.locator('[data-prueba="precio-especial"]').count(),
      total: await texto('total-del-ticket'),
    };
  };
  const describirLinea = (e) =>
    `«${e.detalle}»; subtotal ${e.subtotal}; marca ${e.marca === null ? '(ninguna)' : `«${e.marca}»`}; ` +
    `marcas de especial ${String(e.especiales)}; total del ticket ${e.total}`;
  const coincide = (e, esperado) =>
    e.detalle === esperado.detalle &&
    e.subtotal === esperado.subtotal &&
    e.marca === esperado.marca &&
    e.especiales === 0 &&
    e.total === esperado.total;
  /** Espera a que la línea muestre lo esperado y lo compara; anota lo que se vio. */
  const comprobarLinea = async (nombre, productoId, esperado) => {
    await esperarQue(async () => coincide(await estadoDeLaLinea(productoId), esperado));
    const real = await estadoDeLaLinea(productoId);
    anotar(`línea del ticket: ${describirLinea(real)}`);
    comprobar(nombre, describirLinea({ ...esperado, especiales: 0 }), describirLinea(real), coincide(real, esperado));
  };
  /** Toca la línea y escribe la cantidad con el teclado numérico de la venta. */
  const cambiarCantidad = async (productoId, cantidad) => {
    await lineaDe(productoId).locator('[data-prueba="tocar-linea"]').click();
    await prueba('editar-cantidad').waitFor({ timeout: ESPERA_CORTA });
    for (const caracter of Array.from(cantidad)) {
      await prueba(caracter === '.' ? 'tecla-punto' : `tecla-${caracter}`).click();
    }
    const tecleada = await texto('cantidad-ingresada');
    anotar(`teclado de la venta: se tecleó ${JSON.stringify(cantidad)}, el teclado muestra ${JSON.stringify(tecleada)}`);
    await prueba('tecla-confirmar').click();
    await prueba('editar-cantidad').waitFor({ state: 'detached', timeout: ESPERA_CORTA });
  };

  try {
    // ==========================================================================
    // Preparación: el primer administrador, una categoría y la caja abierta
    // ==========================================================================
    await prueba('pantalla-de-configuracion-inicial').waitFor({ timeout: ESPERA_LARGA });
    await prueba('campo-nombre').fill('Jimmy de verificación');
    await prueba('continuar-al-pin').click();
    await teclearPin(PIN);
    await teclearPin(PIN);
    await prueba('pantalla-de-sesion').waitFor({ timeout: ESPERA_CORTA });
    await ventana.evaluate(async () => {
      const categoria = await window.pos.catalogo.crearCategoria('Granos');
      if (!categoria.ok) throw new Error(categoria.error.mensaje);
      const caja = await window.pos.caja.abrir({ modo: 'simple', monto: '100.00' });
      if (!caja.ok) throw new Error(caja.error.mensaje);
    });
    await fijarVentana();

    // ==========================================================================
    // EL FORMULARIO: crear «Maíz blanco» por libra con precio mayorista
    // ==========================================================================
    await prueba('ir-a-productos').click();
    await prueba('productos-nuevo').click();
    await prueba('formulario-de-producto').waitFor({ timeout: ESPERA_CORTA });
    await fijarVentana();

    let estado = await estadoDelFormulario();
    anotar(`formulario nuevo: ${describirFormulario(estado)}`);
    comprobar(
      'F1/F2 · la casilla nace DESMARCADA y los dos campos NO EXISTEN en la pantalla',
      'desmarcada, 0 campos',
      `${estado.casilla ? 'marcada' : 'desmarcada'}, ${String(estado.campos)} campos`,
      !estado.casilla && estado.campos === 0,
    );

    await prueba('producto-nombre').click();
    await tocarTeclas('m', 'a', 'í', 'z', 'espacio', 'b', 'l', 'a', 'n', 'c', 'o');
    await cerrarElTeclado();
    await prueba('producto-tipo-peso').click();
    const icono = await escribirConElTeclado('producto-cantidad-icono', '25');
    const lista = await escribirConElTeclado('producto-precio', '6.00');
    const inventario = await escribirConElTeclado('producto-inventario-inicial', '200');
    await cerrarElTeclado();
    anotar(
      `escrito con el teclado en pantalla: nombre=${JSON.stringify(await prueba('producto-nombre').inputValue())}, ` +
        `unidad=${JSON.stringify(await prueba('producto-unidad-peso').inputValue())}, ícono=${icono}, lista=${lista}, inventario=${inventario}`,
    );

    await prueba('producto-aplica-mayorista').click();
    estado = await estadoDelFormulario();
    const etiquetasEnLibras = [await etiquetaDe('producto-precio-mayorista'), await etiquetaDe('producto-cantidad-minima-mayorista')];
    anotar(`al marcar la casilla: ${describirFormulario(estado)}`);
    anotar(`etiquetas: ${JSON.stringify(etiquetasEnLibras)}`);
    await capturar('1-casilla-marcada-campos-vacios');
    comprobar(
      'F3 · al marcarla aparecen los DOS campos, VACÍOS',
      'marcada, 2 campos, "" y ""',
      `${estado.casilla ? 'marcada' : 'desmarcada'}, ${String(estado.campos)} campos, ${JSON.stringify(estado.precio)} y ${JSON.stringify(estado.cantidad)}`,
      estado.casilla && estado.campos === 2 && estado.precio === '' && estado.cantidad === '',
    );
    comprobar(
      'F8 · las etiquetas dicen la unidad del producto (lb)',
      '"… (por lb)" y "… (en lb)"',
      JSON.stringify(etiquetasEnLibras),
      etiquetasEnLibras[0] === 'Precio mayorista en quetzales (por lb)' &&
        etiquetasEnLibras[1] === 'Cantidad mínima para el precio mayorista (en lb)',
    );
    comprobar(
      'F6 · con la casilla marcada y los campos vacíos, el aviso lo dice y NO se puede guardar',
      `${JSON.stringify(FALTA_EL_PRECIO)}; guardar deshabilitado`,
      `${JSON.stringify(estado.impedimento)}; guardar ${estado.guardar}`,
      estado.impedimento === FALTA_EL_PRECIO && estado.guardar === 'deshabilitado',
    );

    // F7: el teclado de cada campo.
    await prueba('producto-precio-mayorista').click();
    const tecladoDelPrecio = await disposicionDelTeclado();
    const letrasEnElPrecio = await prueba('tp-a').count();
    await tocarTeclas('6', '.', '0', '0');
    await prueba('producto-cantidad-minima-mayorista').click();
    const tecladoDeLaCantidadPorPeso = await disposicionDelTeclado();
    const puntoEnLaCantidadPorPeso = await prueba('tp-.').count();
    await tocarTeclas('0');
    anotar(
      `teclados: precio mayorista=${String(tecladoDelPrecio)} (${String(letrasEnElPrecio)} teclas de letra); ` +
        `cantidad mínima (por peso)=${String(tecladoDeLaCantidadPorPeso)} (tecla del punto: ${String(puntoEnLaCantidadPorPeso)})`,
    );
    comprobar(
      'F7 · el precio mayorista abre el teclado DECIMAL, sin letras; la cantidad mínima de un producto por peso, también el decimal',
      'decimal (0 letras) / decimal (con punto)',
      `${String(tecladoDelPrecio)} (${String(letrasEnElPrecio)} letras) / ${String(tecladoDeLaCantidadPorPeso)} (punto: ${String(puntoEnLaCantidadPorPeso)})`,
      tecladoDelPrecio === 'decimal' && letrasEnElPrecio === 0 && tecladoDeLaCantidadPorPeso === 'decimal' && puntoEnLaCantidadPorPeso === 1,
    );

    estado = await estadoDelFormulario();
    anotar(`mayorista 6.00 (igual a la lista) y cantidad 0: ${describirFormulario(estado)}`);
    comprobar(
      'F6 · R4 mientras se escribe: una cantidad mínima de CERO se avisa y no se puede guardar',
      `${JSON.stringify(CANTIDAD_NO_POSITIVA)}; guardar deshabilitado`,
      `${JSON.stringify(estado.impedimento)}; guardar ${estado.guardar}`,
      estado.impedimento === CANTIDAD_NO_POSITIVA && estado.guardar === 'deshabilitado',
    );

    await tocarTeclas('borrar', '5', '0');
    estado = await estadoDelFormulario();
    anotar(`mayorista 6.00 (igual a la lista) y cantidad 50: ${describirFormulario(estado)}`);
    await capturar('2-mayorista-igual-a-la-lista');
    comprobar(
      'F6 · R3 mientras se escribe: un mayorista IGUAL a la lista se avisa con el texto del servicio y no se puede guardar',
      `${JSON.stringify(noMenorQueLaLista('Q6.00', 'Q6.00'))}; guardar deshabilitado`,
      `${JSON.stringify(estado.impedimento)}; guardar ${estado.guardar}`,
      estado.impedimento === noMenorQueLaLista('Q6.00', 'Q6.00') && estado.guardar === 'deshabilitado',
    );

    // F4: desmarcar borra; volver a marcar muestra vacío.
    await cerrarElTeclado();
    await prueba('producto-aplica-mayorista').click();
    const alDesmarcar = await estadoDelFormulario();
    await prueba('producto-aplica-mayorista').click();
    const alVolverAMarcar = await estadoDelFormulario();
    anotar(`al DESMARCAR: ${describirFormulario(alDesmarcar)}`);
    anotar(`al volver a MARCAR: ${describirFormulario(alVolverAMarcar)}`);
    comprobar(
      'F4 · al desmarcar, los campos desaparecen y el formulario se puede guardar sin mayorista',
      'desmarcada, 0 campos, sin aviso, guardar habilitado',
      describirFormulario(alDesmarcar),
      !alDesmarcar.casilla && alDesmarcar.campos === 0 && alDesmarcar.impedimento === null && alDesmarcar.guardar === 'habilitado',
    );
    comprobar(
      'F4 · al volver a marcar, los campos aparecen VACÍOS: el 6.00 y el 50 no vuelven',
      'marcada, "" y ""',
      describirFormulario(alVolverAMarcar),
      alVolverAMarcar.casilla && alVolverAMarcar.precio === '' && alVolverAMarcar.cantidad === '',
    );

    // F7 y F8 con el producto por unidad.
    await prueba('producto-tipo-unidad').click();
    const etiquetasPorUnidad = [await etiquetaDe('producto-precio-mayorista'), await etiquetaDe('producto-cantidad-minima-mayorista')];
    await prueba('producto-cantidad-minima-mayorista').click();
    const tecladoDeLaCantidadPorUnidad = await disposicionDelTeclado();
    const puntoEnLaCantidadPorUnidad = await prueba('tp-.').count();
    await cerrarElTeclado();
    anotar(`por unidad: etiquetas ${JSON.stringify(etiquetasPorUnidad)}; teclado de la cantidad mínima=${String(tecladoDeLaCantidadPorUnidad)} (tecla del punto: ${String(puntoEnLaCantidadPorUnidad)})`);
    comprobar(
      'F7/F8 · por unidad: las etiquetas dicen «unidad» y la cantidad mínima abre el teclado de ENTEROS',
      '"… (por unidad)", "… (en unidades)"; entero, sin punto',
      `${JSON.stringify(etiquetasPorUnidad)}; ${String(tecladoDeLaCantidadPorUnidad)}, punto: ${String(puntoEnLaCantidadPorUnidad)}`,
      etiquetasPorUnidad[0] === 'Precio mayorista en quetzales (por unidad)' &&
        etiquetasPorUnidad[1] === 'Cantidad mínima para el precio mayorista (en unidades)' &&
        tecladoDeLaCantidadPorUnidad === 'entero' &&
        puntoEnLaCantidadPorUnidad === 0,
    );
    await prueba('producto-tipo-peso').click();

    // La configuración válida, y guardar.
    const precioMayorista = await escribirConElTeclado('producto-precio-mayorista', '5.50');
    const cantidadMinima = await escribirConElTeclado('producto-cantidad-minima-mayorista', '50');
    await cerrarElTeclado();
    estado = await estadoDelFormulario();
    anotar(`mayorista ${precioMayorista} desde ${cantidadMinima} lb: ${describirFormulario(estado)}`);
    await capturar('3-mayorista-valido');
    comprobar(
      'con un mayorista válido (Q5.50 desde 50 lb, lista Q6.00) no hay aviso y se puede guardar',
      'sin aviso; guardar habilitado',
      `${JSON.stringify(estado.impedimento)}; guardar ${estado.guardar}`,
      estado.impedimento === null && estado.guardar === 'habilitado',
    );
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });

    const [fila] = leerBase(
      `SELECT id, nombre, tipo_medida, unidad_peso, cantidad_predefinida_icono, precio_base,
              precio_mayorista, cantidad_minima_mayorista, inventario_disponible
         FROM productos WHERE nombre = 'Maíz blanco'`,
    );
    anotar(`fila de productos: ${JSON.stringify(fila)}`);
    comprobar(
      'LA BASE guarda el mayorista con su forma canónica (Q5.50 desde 50.000 lb) junto a la lista Q6.00',
      'peso lb, ícono 25.000, lista 6.00, mayorista 5.50 desde 50.000, inventario 200.000',
      fila === undefined
        ? '(no se guardó)'
        : `${fila.tipo_medida} ${String(fila.unidad_peso)}, ícono ${fila.cantidad_predefinida_icono}, lista ${fila.precio_base}, ` +
          `mayorista ${String(fila.precio_mayorista)} desde ${String(fila.cantidad_minima_mayorista)}, inventario ${fila.inventario_disponible}`,
      fila !== undefined &&
        fila.tipo_medida === 'peso' &&
        fila.unidad_peso === 'lb' &&
        fila.cantidad_predefinida_icono === '25.000' &&
        fila.precio_base === '6.00' &&
        fila.precio_mayorista === '5.50' &&
        fila.cantidad_minima_mayorista === '50.000' &&
        fila.inventario_disponible === '200.000',
    );
    const maizId = fila?.id ?? '';
    const asientosDelProducto = leerBase(
      'SELECT accion, valor_nuevo FROM auditoria_log WHERE entidad_id = ? ORDER BY fecha',
      maizId,
    );
    const colaDelProducto = leerBase(
      "SELECT payload FROM sync_cola WHERE entidad_tipo = 'productos' AND entidad_id = ? ORDER BY rowid",
      maizId,
    );
    for (const asiento of asientosDelProducto) {
      anotar(`auditoria_log: ${asiento.accion} | ${asiento.valor_nuevo}`);
    }
    const payload = colaDelProducto.length > 0 ? JSON.parse(colaDelProducto[colaDelProducto.length - 1].payload) : {};
    anotar(
      `sync_cola (productos, último payload): precio_base=${JSON.stringify(payload.precio_base)} ` +
        `precio_mayorista=${JSON.stringify(payload.precio_mayorista)} cantidad_minima_mayorista=${JSON.stringify(payload.cantidad_minima_mayorista)}`,
    );
    const creado = asientosDelProducto.find((a) => a.accion === 'producto_creado');
    const valorCreado = creado === undefined ? {} : JSON.parse(creado.valor_nuevo);
    comprobar(
      'el asiento del alta y el payload de la cola llevan el mayorista',
      'asiento 5.50 / 50.000; payload 5.50 / 50.000',
      `asiento ${String(valorCreado.precioMayorista)} / ${String(valorCreado.cantidadMinimaMayorista)}; ` +
        `payload ${String(payload.precio_mayorista)} / ${String(payload.cantidad_minima_mayorista)}`,
      valorCreado.precioMayorista === '5.50' &&
        valorCreado.cantidadMinimaMayorista === '50.000' &&
        payload.precio_mayorista === '5.50' &&
        payload.cantidad_minima_mayorista === '50.000',
    );

    // F5: al editar, marcada y con sus valores.
    await editar('Maíz blanco');
    await fijarVentana();
    estado = await estadoDelFormulario();
    anotar(`al EDITAR el maíz: ${describirFormulario(estado)}`);
    comprobar(
      'F5 · al editar un producto que YA tiene mayorista, la casilla aparece marcada y con sus valores',
      'marcada, "5.50" y "50.000"',
      describirFormulario(estado),
      estado.casilla && estado.precio === '5.50' && estado.cantidad === '50.000',
    );

    // ==========================================================================
    // LA DECISIÓN 1 (CA-24): bajar la lista hasta el mayorista, en las tres capas
    // ==========================================================================
    //   Desde el 2026-09-18 el aviso dice que lo que se movió fue la LISTA (pedido
    //   de Julio). Antes decía «El precio mayorista (Q5.50) tiene que ser menor
    //   que el precio de lista (Q5.00). Bajá el precio mayorista o quitalo.»
    await escribirConElTeclado('producto-precio', '5.50');
    const listaIgual = await estadoDelFormulario();
    await escribirConElTeclado('producto-precio', '5.00');
    const listaMenor = await estadoDelFormulario();
    await cerrarElTeclado();
    anotar(`lista 5.50: ${describirFormulario(listaIgual)}`);
    anotar(`lista 5.00: ${describirFormulario(listaMenor)}`);
    await capturar('4-lista-por-debajo-del-mayorista');
    comprobar(
      'CA-24 · FORMULARIO: bajar la lista a Q5.50 o a Q5.00 dice que no se puede bajar la lista por debajo del mayorista, y no deja guardar',
      `${JSON.stringify(listaPorDebajoDelMayorista('Q5.50'))} dos veces; deshabilitado`,
      `${JSON.stringify(listaIgual.impedimento)} (${listaIgual.guardar}) / ${JSON.stringify(listaMenor.impedimento)} (${listaMenor.guardar})`,
      listaIgual.impedimento === listaPorDebajoDelMayorista('Q5.50') &&
        listaIgual.guardar === 'deshabilitado' &&
        listaMenor.impedimento === listaPorDebajoDelMayorista('Q5.50') &&
        listaMenor.guardar === 'deshabilitado',
    );
    // Tocar «Guardar» igual: está deshabilitado y no manda nada. Lo que queda en
    // la pantalla, entero, no puede tener ni una palabra de SQLite.
    const edicionesAntes = leerBase(
      "SELECT count(*) AS n FROM auditoria_log WHERE accion = 'producto_editado' AND entidad_id = ?",
      maizId,
    )[0]?.n;
    await prueba('producto-guardar').click({ force: true });
    await espera(600);
    const pantallaEntera = sinEspaciosDeMas(await ventana.locator('body').innerText());
    const edicionesDespues = leerBase(
      "SELECT count(*) AS n FROM auditoria_log WHERE accion = 'producto_editado' AND entidad_id = ?",
      maizId,
    )[0]?.n;
    const listaGuardada = leerBase('SELECT precio_base FROM productos WHERE id = ?', maizId)[0]?.precio_base;
    anotar(`texto visible de la pantalla con la lista en 5.00, después de tocar «Guardar»: ${JSON.stringify(pantallaEntera)}`);
    anotar(`asientos producto_editado del maíz antes/después del toque: ${String(edicionesAntes)}/${String(edicionesDespues)}; lista guardada ${String(listaGuardada)}`);
    comprobar(
      'CA-24 · LO QUE VE JIMMY: tocar «Guardar» no guarda nada, y en toda la pantalla no aparece el nombre de la restricción ni el idioma de SQLite',
      'sin jerga de la base; el aviso de la lista a la vista; 0 ediciones nuevas; lista 6.00',
      `jerga: ${JSON.stringify(pantallaEntera.match(JERGA_DE_LA_BASE)?.[0] ?? null)}; aviso a la vista: ${String(pantallaEntera.includes(listaPorDebajoDelMayorista('Q5.50')))}; ediciones nuevas: ${String(Number(edicionesDespues) - Number(edicionesAntes))}; lista ${String(listaGuardada)}`,
      !JERGA_DE_LA_BASE.test(pantallaEntera) &&
        pantallaEntera.includes(listaPorDebajoDelMayorista('Q5.50')) &&
        edicionesDespues === edicionesAntes &&
        listaGuardada === '6.00',
    );

    // Q0.00 como precio mayorista (punto 55): el formulario lo frena antes de
    // llegar al servicio y a la base.
    await escribirConElTeclado('producto-precio', '6.00');
    await escribirConElTeclado('producto-precio-mayorista', '0.00');
    const mayoristaCero = await estadoDelFormulario();
    await cerrarElTeclado();
    anotar(`mayorista 0.00 con lista 6.00: ${describirFormulario(mayoristaCero)}`);
    await capturar('4b-mayorista-en-cero');
    comprobar(
      'PUNTO 55 · FORMULARIO: un precio mayorista de Q0.00 se avisa y no deja guardar',
      `${JSON.stringify(PRECIO_NO_POSITIVO)}; deshabilitado`,
      `${JSON.stringify(mayoristaCero.impedimento)}; ${mayoristaCero.guardar}`,
      mayoristaCero.impedimento === PRECIO_NO_POSITIVO && mayoristaCero.guardar === 'deshabilitado',
    );
    await prueba('formulario-de-producto').getByRole('button', { name: 'Cancelar' }).click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });

    const categoriaDelMaiz = leerBase('SELECT categoria_id FROM productos WHERE id = ?', maizId)[0]?.categoria_id ?? '';
    const porElCanal = await ventana.evaluate(async ({ id, categoriaId }) => {
      const respuesta = await window.pos.catalogo.editarProducto({
        id,
        nombre: 'Maíz blanco',
        categoriaId,
        tipoMedida: 'peso',
        unidadPeso: 'lb',
        cantidadPredefinidaIcono: '25',
        precioBase: '5.00',
        precioCompra: null,
        precioMayorista: '5.50',
        cantidadMinimaMayorista: '50',
        fotoPath: null,
      });
      return respuesta.ok ? { ok: true } : { ok: false, codigo: respuesta.error.codigo, mensaje: respuesta.error.mensaje };
    }, { id: maizId, categoriaId: categoriaDelMaiz });
    anotar(`window.pos.catalogo.editarProducto(lista 5.00, mayorista 5.50) → ${JSON.stringify(porElCanal)}`);
    const enLaBase = intentarEnLaBase("UPDATE productos SET precio_base = '5.00' WHERE id = ?", maizId);
    anotar(`UPDATE productos SET precio_base = '5.00' (conexión aparte) → ${enLaBase}`);
    const listaDespues = leerBase('SELECT precio_base, precio_mayorista FROM productos WHERE id = ?', maizId)[0];
    anotar(`la fila después de los dos intentos: ${JSON.stringify(listaDespues)}`);
    comprobar(
      'CA-24 · SERVICIO (por el canal): se rechaza con el mensaje que dice qué hacer',
      `ok=false, ${JSON.stringify(listaPorDebajoDelMayorista('Q5.50'))}`,
      JSON.stringify(porElCanal),
      porElCanal.ok === false && porElCanal.mensaje === listaPorDebajoDelMayorista('Q5.50'),
    );
    const cerosPorElCanal = await ventana.evaluate(async ({ id, categoriaId }) => {
      const respuesta = await window.pos.catalogo.editarProducto({
        id,
        nombre: 'Maíz blanco',
        categoriaId,
        tipoMedida: 'peso',
        unidadPeso: 'lb',
        cantidadPredefinidaIcono: '25',
        precioBase: '6.00',
        precioCompra: null,
        precioMayorista: '0.00',
        cantidadMinimaMayorista: '50',
        fotoPath: null,
      });
      return respuesta.ok ? { ok: true } : { ok: false, codigo: respuesta.error.codigo, mensaje: respuesta.error.mensaje };
    }, { id: maizId, categoriaId: categoriaDelMaiz });
    const ceroEnLaBase = intentarEnLaBase("UPDATE productos SET precio_mayorista = '0.00' WHERE id = ?", maizId);
    anotar(`window.pos.catalogo.editarProducto(mayorista 0.00) → ${JSON.stringify(cerosPorElCanal)}`);
    anotar(`UPDATE productos SET precio_mayorista = '0.00' (conexión aparte) → ${ceroEnLaBase}`);
    comprobar(
      'PUNTO 55 · SERVICIO Y BASE: Q0.00 se rechaza por el canal con su mensaje, y la base lo rechaza por productos_precio_mayorista_canonico',
      `ok=false, ${JSON.stringify(PRECIO_NO_POSITIVO)}; productos_precio_mayorista_canonico`,
      `${JSON.stringify(cerosPorElCanal)}; ${ceroEnLaBase}`,
      cerosPorElCanal.ok === false &&
        cerosPorElCanal.mensaje === PRECIO_NO_POSITIVO &&
        ceroEnLaBase.includes('productos_precio_mayorista_canonico'),
    );
    comprobar(
      'CA-24 · BASE (una consulta a mano): la restricción productos_mayorista_menor_que_lista la rechaza, y la lista sigue en Q6.00',
      'rechazada por productos_mayorista_menor_que_lista; lista 6.00',
      `${enLaBase}; lista ${String(listaDespues?.precio_base)}`,
      enLaBase.includes('productos_mayorista_menor_que_lista') && listaDespues?.precio_base === '6.00',
    );
    await volver();

    // ==========================================================================
    // LA VENTA: cruzar el umbral en vivo, y cobrar
    // ==========================================================================
    await prueba('ir-a-venta').click();
    await prueba('cobrar').waitFor({ timeout: ESPERA_CORTA });
    await fijarVentana();
    const icono25 = ventana.locator(`[data-prueba="icono-producto"][data-producto="${maizId}"]`);

    await icono25.click();
    await comprobarLinea('CA-12 · 25 lb (un toque del ícono): precio de LISTA, sin marca', maizId, {
      detalle: '25 lb · Q6.00 c/u',
      subtotal: 'Q150.00',
      marca: null,
      total: 'Q150.00',
    });
    await capturar('5-venta-25-lb-lista');

    await icono25.click();
    await comprobarLinea(
      'CA-12 · 50 lb (SEGUNDO toque del ícono, justo en el umbral): pasa solo al precio MAYORISTA, con su marca',
      maizId,
      { detalle: '50 lb · Q5.50 c/u', subtotal: 'Q275.00', marca: MARCA_DEL_MAYORISTA, total: 'Q275.00' },
    );
    await capturar('6-venta-50-lb-mayorista');

    await cambiarCantidad(maizId, '49.999');
    await comprobarLinea(
      'CA-12 · 49.999 lb (con el TECLADO, una milésima por debajo): vuelve solo al precio de LISTA y la marca se va',
      maizId,
      { detalle: '49.999 lb · Q6.00 c/u', subtotal: 'Q299.99', marca: null, total: 'Q299.99' },
    );
    await capturar('7-venta-49.999-lb-lista');

    // La subida con el teclado empieza desde una línea NUEVA a precio de lista,
    // puesta por el ícono. Si empezara desde la bajada anterior, un teclado que
    // no recalculara pasaría esta comprobación por casualidad: la línea ya
    // tendría el precio mayorista de antes (se vio falsificando).
    await lineaDe(maizId).locator('[data-prueba="quitar-linea"]').click();
    await lineaDe(maizId).waitFor({ state: 'detached', timeout: ESPERA_CORTA });
    await icono25.click();
    await comprobarLinea('la línea se quita y se vuelve a agregar: 25 lb, otra vez a precio de LISTA', maizId, {
      detalle: '25 lb · Q6.00 c/u',
      subtotal: 'Q150.00',
      marca: null,
      total: 'Q150.00',
    });
    await cambiarCantidad(maizId, '60');
    await comprobarLinea(
      'CA-12 · 60 lb (con el TECLADO, por encima del umbral): vuelve al precio MAYORISTA, con su marca',
      maizId,
      { detalle: '60 lb · Q5.50 c/u', subtotal: 'Q330.00', marca: MARCA_DEL_MAYORISTA, total: 'Q330.00' },
    );
    await capturar('8-venta-60-lb-mayorista');

    // Lo que la cajera le dice al cliente sale de la PANTALLA (el ticket y el
    // diálogo de cobro); lo que se cobra lo decide el proceso principal. Se
    // anotan los dos lados para compararlos.
    const totalEnElTicket = await texto('total-del-ticket');
    await prueba('cobrar').click();
    await prueba('cobro-total').waitFor({ timeout: ESPERA_CORTA });
    const totalEnElDialogo = await texto('cobro-total');
    await prueba('cobro-continuar').click();
    await prueba('cobro-confirmar').click();
    await prueba('cobro-listo').waitFor({ timeout: ESPERA_LARGA });
    const totalCobrado = await texto('cobro-total-cobrado');
    anotar(`antes de cobrar: total del ticket ${totalEnElTicket}; total en el diálogo de cobro ${totalEnElDialogo}`);
    anotar(`«Venta registrada»: total cobrado en pantalla ${totalCobrado}`);
    await capturar('9-venta-registrada');

    const [venta] = leerBase('SELECT id, subtotal, total, descuento_tipo FROM ventas ORDER BY fecha DESC LIMIT 1');
    const detalle = leerBase(
      `SELECT producto_nombre_snap, cantidad, precio_unitario_snap, subtotal_exacto, subtotal_impreso
         FROM venta_detalle WHERE venta_id = ? ORDER BY orden_linea`,
      venta?.id ?? '',
    );
    const [asientoDeLaVenta] = leerBase(
      "SELECT valor_nuevo FROM auditoria_log WHERE accion = 'venta_registrada' AND entidad_id = ?",
      venta?.id ?? '',
    );
    const lineaAuditada = asientoDeLaVenta === undefined ? {} : (JSON.parse(asientoDeLaVenta.valor_nuevo).lineas?.[0] ?? {});
    const inventarioDespues = leerBase('SELECT inventario_disponible FROM productos WHERE id = ?', maizId)[0]?.inventario_disponible;
    anotar(`ventas: ${JSON.stringify(venta)}`);
    anotar(`venta_detalle: ${JSON.stringify(detalle)}`);
    anotar(
      `asiento venta_registrada, línea 1: ${JSON.stringify({
        cantidad: lineaAuditada.cantidad,
        precioBase: lineaAuditada.precioBase,
        precioUnitario: lineaAuditada.precioUnitario,
        origenDelPrecio: lineaAuditada.origenDelPrecio,
        precioEspecialId: lineaAuditada.precioEspecialId,
        mayorista: lineaAuditada.mayorista,
      })}`,
    );
    anotar(`inventario del maíz después: ${String(inventarioDespues)}`);
    comprobar(
      'CA-13/CA-25 · SE COBRÓ LO QUE LA PANTALLA MOSTRABA: el ticket y el diálogo decían Q330.00, y eso cobró el proceso principal',
      'ticket Q330.00 = diálogo Q330.00 = «Venta registrada» Q330.00 = ventas.total 330.00',
      `ticket ${totalEnElTicket} = diálogo ${totalEnElDialogo} = «Venta registrada» ${totalCobrado} = ventas.total ${String(venta?.total)}`,
      totalEnElTicket === 'Q330.00' &&
        totalEnElDialogo === 'Q330.00' &&
        totalCobrado === 'Q330.00' &&
        venta?.total === '330.00' &&
        venta?.subtotal === '330.00',
    );
    comprobar(
      'CA-14/CA-25 · precio_unitario_snap CONGELA el precio mayorista: 60.000 lb × 5.50 = 330.00',
      '1 línea: 60.000 × 5.50, impreso 330.00',
      detalle.map((d) => `${d.cantidad} × ${d.precio_unitario_snap}, exacto ${d.subtotal_exacto}, impreso ${d.subtotal_impreso}`).join(' | '),
      detalle.length === 1 &&
        detalle[0].cantidad === '60.000' &&
        detalle[0].precio_unitario_snap === '5.50' &&
        detalle[0].subtotal_impreso === '330.00',
    );
    comprobar(
      'CA-23 · el asiento de la venta dice POR QUÉ: origen mayorista, con la configuración del producto',
      'origen mayorista; lista 6.00; cobrado 5.50; mayorista 5.50 desde 50.000; sin precio especial',
      `origen ${String(lineaAuditada.origenDelPrecio)}; lista ${String(lineaAuditada.precioBase)}; cobrado ${String(lineaAuditada.precioUnitario)}; ` +
        `mayorista ${JSON.stringify(lineaAuditada.mayorista)}; especial ${String(lineaAuditada.precioEspecialId)}`,
      lineaAuditada.origenDelPrecio === 'mayorista' &&
        lineaAuditada.precioBase === '6.00' &&
        lineaAuditada.precioUnitario === '5.50' &&
        lineaAuditada.mayorista?.precio === '5.50' &&
        lineaAuditada.mayorista?.cantidadMinima === '50.000' &&
        lineaAuditada.precioEspecialId === null,
    );

    const [recibo] = leerBase('SELECT id FROM recibos WHERE venta_id = ?', venta?.id ?? '');
    const textoDelRecibo = await ventana.evaluate(async (id) => {
      const respuesta = await window.pos.recibos.ver(id);
      return respuesta.ok ? respuesta.datos.texto : `ERROR ${respuesta.error.mensaje}`;
    }, recibo?.id ?? '');
    const renglonesDelRecibo = textoDelRecibo.split('\n').filter((r) => r.includes('Maíz blanco') || r.includes(' x ') || r.startsWith('TOTAL'));
    for (const renglon of renglonesDelRecibo) {
      anotar(`recibo: ${renglon}`);
    }
    comprobar(
      'el recibo dice el precio que se cobró: «60 lb x 5.50» y TOTAL 330.00',
      'un renglón «60 lb x 5.50 … 330.00» y «TOTAL … 330.00»',
      JSON.stringify(renglonesDelRecibo),
      renglonesDelRecibo.some((r) => r.includes('60 lb x 5.50') && r.trimEnd().endsWith('330.00')) &&
        renglonesDelRecibo.some((r) => r.startsWith('TOTAL') && r.trimEnd().endsWith('330.00')),
    );

    // ==========================================================================
    // QUITARLO (F4): guardar con la casilla desmarcada
    // ==========================================================================
    await prueba('cobro-siguiente-venta').click();
    await volver();
    await prueba('ir-a-productos').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await editar('Maíz blanco');
    await prueba('producto-aplica-mayorista').click();
    const antesDeQuitar = await estadoDelFormulario();
    anotar(`edición con la casilla DESMARCADA: ${describirFormulario(antesDeQuitar)}`);
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    const sinMayorista = leerBase('SELECT precio_base, precio_mayorista, cantidad_minima_mayorista FROM productos WHERE id = ?', maizId)[0];
    const [asientoDeLaEdicion] = leerBase(
      "SELECT valor_anterior, valor_nuevo FROM auditoria_log WHERE accion = 'producto_editado' AND entidad_id = ? ORDER BY fecha DESC LIMIT 1",
      maizId,
    );
    anotar(`la fila después de guardar sin mayorista: ${JSON.stringify(sinMayorista)}`);
    anotar(`asiento producto_editado: antes ${String(asientoDeLaEdicion?.valor_anterior)} | después ${String(asientoDeLaEdicion?.valor_nuevo)}`);
    comprobar(
      'F4 · guardar con la casilla desmarcada QUITA el precio mayorista: las dos columnas en NULL',
      'lista 6.00, mayorista null, cantidad mínima null',
      `lista ${String(sinMayorista?.precio_base)}, mayorista ${String(sinMayorista?.precio_mayorista)}, cantidad mínima ${String(sinMayorista?.cantidad_minima_mayorista)}`,
      sinMayorista?.precio_base === '6.00' && sinMayorista?.precio_mayorista === null && sinMayorista?.cantidad_minima_mayorista === null,
    );
    await volver();
    await prueba('ir-a-venta').click();
    await prueba('cobrar').waitFor({ timeout: ESPERA_CORTA });
    await fijarVentana();
    await icono25.click();
    await icono25.click();
    await comprobarLinea(
      'V4 · sin mayorista, 50 lb se cobran a precio de LISTA y la línea no lleva ninguna marca',
      maizId,
      { detalle: '50 lb · Q6.00 c/u', subtotal: 'Q300.00', marca: null, total: 'Q300.00' },
    );
    await capturar('10-sin-mayorista-50-lb-lista');

    // ==========================================================================
    // PUNTO 56: cambiar la unidad de un producto CON mayorista lo quita, en la
    // misma edición, y el asiento dice por qué
    // ==========================================================================
    await volver();
    await prueba('ir-a-productos').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    await editar('Maíz blanco');
    await prueba('producto-aplica-mayorista').click();
    await escribirConElTeclado('producto-precio-mayorista', '5.50');
    await escribirConElTeclado('producto-cantidad-minima-mayorista', '50');
    await cerrarElTeclado();
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    const conMayoristaOtraVez = leerBase(
      'SELECT unidad_peso, precio_mayorista, cantidad_minima_mayorista FROM productos WHERE id = ?',
      maizId,
    )[0];
    anotar(`el maíz con su mayorista otra vez: ${JSON.stringify(conMayoristaOtraVez)}`);

    await editar('Maíz blanco');
    await fijarVentana();
    await prueba('producto-unidad-peso').selectOption('kg');
    const aviso = (await prueba('producto-aviso-mayorista-quitado').count()) === 1
      ? await texto('producto-aviso-mayorista-quitado')
      : null;
    const quedaLaCasilla = await prueba('producto-aplica-mayorista').count();
    anotar(`al pasar el maíz a kilogramos: aviso ${JSON.stringify(aviso)}; casilla en pantalla: ${String(quedaLaCasilla)}; campos: ${String(await camposDelMayorista())}`);
    await capturar('11-cambio-de-unidad-quita-el-mayorista');
    comprobar(
      'PUNTO 56 · FORMULARIO: al pasar a kilogramos, la casilla y los campos se reemplazan por el aviso con lo que se va a quitar',
      JSON.stringify(AVISO_DE_UNIDAD_CAMBIADA),
      `${JSON.stringify(aviso)}; casilla ${String(quedaLaCasilla)}; campos ${String(await camposDelMayorista())}`,
      aviso === AVISO_DE_UNIDAD_CAMBIADA && quedaLaCasilla === 0 && (await camposDelMayorista()) === 0,
    );
    await prueba('producto-guardar').click();
    await prueba('lista-de-productos').waitFor({ timeout: ESPERA_CORTA });
    const despuesDeCambiar = leerBase(
      'SELECT unidad_peso, precio_mayorista, cantidad_minima_mayorista FROM productos WHERE id = ?',
      maizId,
    )[0];
    const [asientoDelCambio] = leerBase(
      "SELECT valor_anterior, valor_nuevo FROM auditoria_log WHERE accion = 'producto_editado' AND entidad_id = ? ORDER BY fecha DESC, rowid DESC LIMIT 1",
      maizId,
    );
    const [loteDelCambio] = leerBase(
      "SELECT payload FROM sync_cola WHERE entidad_tipo = 'productos' AND entidad_id = ? ORDER BY rowid DESC LIMIT 1",
      maizId,
    );
    anotar(`la fila después de guardar en kg: ${JSON.stringify(despuesDeCambiar)}`);
    anotar(`asiento producto_editado: antes ${String(asientoDelCambio?.valor_anterior)} | después ${String(asientoDelCambio?.valor_nuevo)}`);
    anotar(`payload encolado: ${String(loteDelCambio?.payload)}`);
    const nuevoDelAsiento = JSON.parse(asientoDelCambio?.valor_nuevo ?? '{}');
    const anteriorDelAsiento = JSON.parse(asientoDelCambio?.valor_anterior ?? '{}');
    comprobar(
      'PUNTO 56 · BASE Y ASIENTO: la unidad quedó en kg, las dos columnas en NULL, y el asiento dice «cambio_de_unidad» con los valores de antes',
      'kg, null, null; mayoristaQuitadoPor=cambio_de_unidad; antes 5.50 / 50.000 lb',
      `${String(despuesDeCambiar?.unidad_peso)}, ${String(despuesDeCambiar?.precio_mayorista)}, ${String(despuesDeCambiar?.cantidad_minima_mayorista)}; mayoristaQuitadoPor=${String(nuevoDelAsiento.mayoristaQuitadoPor)}; antes ${String(anteriorDelAsiento.precioMayorista)} / ${String(anteriorDelAsiento.cantidadMinimaMayorista)} ${String(anteriorDelAsiento.unidadPeso)}`,
      despuesDeCambiar?.unidad_peso === 'kg' &&
        despuesDeCambiar?.precio_mayorista === null &&
        despuesDeCambiar?.cantidad_minima_mayorista === null &&
        nuevoDelAsiento.mayoristaQuitadoPor === 'cambio_de_unidad' &&
        anteriorDelAsiento.precioMayorista === '5.50' &&
        anteriorDelAsiento.cantidadMinimaMayorista === '50.000' &&
        anteriorDelAsiento.unidadPeso === 'lb',
    );
  } catch (error) {
    comprobar('el recorrido llegó hasta el final', 'sin errores', error.message, false);
    await ventana.screenshot({ path: join(capturas, 'error.png') }).catch(() => undefined);
  } finally {
    terminarAplicacion(procesoDeLaAplicacion);
  }

  const fallidas = comprobaciones.filter((c) => !c.paso);
  console.info(`\n${String(comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.`);
  console.info(`Carpeta de la corrida (capturas, base, log-tecnico.log): ${datos}`);
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verificacion-de-precio-mayorista] Falló antes de poder comprobar nada: ${String(error?.message ?? error)}`);
  process.exit(1);
});
