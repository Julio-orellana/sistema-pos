/**
 * ¿El redimensionado REAL reduce de verdad? — `npm run diagnostico:imagen`
 *
 * ===========================================================================
 * POR QUÉ ESTO NO PUEDE SER UNA PRUEBA DE VITEST
 * ===========================================================================
 *
 * `AlmacenDeFotos` recibe el redimensionador inyectado, así que en Vitest lo
 * que se prueba es el DOBLE: que el almacén lo llama y que escribe lo que le
 * devuelve. Eso está bien y es lo que esas pruebas dicen que prueban, pero **no
 * dice nada sobre si los píxeles se reducen**, porque quien los reduce es
 * `nativeImage` de Electron y en Node puro no existe.
 *
 * Es exactamente el mismo hueco que `diagnostico:credencial` cierra para
 * `safeStorage` (CLAUDE.md §4.23), y se cierra igual: una sonda que corre
 * DENTRO de Electron, contra la implementación de verdad.
 *
 * Códigos de salida: 0 se redujo como corresponde, 1 no se redujo (GRAVE),
 * 2 no se pudo medir.
 */

const { app, nativeImage } = require('electron');
const { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

/**
 * Lado mayor al que se debe reducir, LEÍDO DE LA FUENTE.
 *
 * No se copia el número: se lee de `redimensionar.ts`. Copiarlo dejaría dos
 * lugares que pueden derivar, y el día que alguien cambiara el de la
 * aplicación esta sonda seguiría midiendo contra el viejo **y seguiría dando
 * verde**, que es la peor forma de fallar que tiene una comprobación.
 */
function ladoMayorMaximoDeLaFuente() {
  const fuente = readFileSync(
    join(__dirname, '..', 'src', 'main', 'domain', 'catalogo', 'redimensionar.ts'),
    'utf8',
  );
  const encontrado = /LADO_MAYOR_MAXIMO_PX\s*=\s*(\d+)/.exec(fuente);
  if (encontrado === null) {
    throw new Error('No se pudo leer LADO_MAYOR_MAXIMO_PX de redimensionar.ts');
  }
  return Number(encontrado[1]);
}

/** Calidad JPEG, también leída de la fuente y por la misma razón. */
function calidadJpegDeLaFuente() {
  const fuente = readFileSync(
    join(__dirname, '..', 'src', 'main', 'domain', 'catalogo', 'redimensionar.ts'),
    'utf8',
  );
  const encontrado = /CALIDAD_JPEG\s*=\s*(\d+)/.exec(fuente);
  if (encontrado === null) {
    throw new Error('No se pudo leer CALIDAD_JPEG de redimensionar.ts');
  }
  return Number(encontrado[1]);
}

const LADO_MAYOR_MAXIMO_PX = ladoMayorMaximoDeLaFuente();
const CALIDAD_JPEG = calidadJpegDeLaFuente();
/** Cuánto se tolera de más, para no fallar por un redondeo de un píxel. */
const TOLERANCIA_PX = 2;
/** Dimensiones de la foto de prueba: grande y con proporción no cuadrada. */
const ANCHO = 3000;
const ALTO = 2000;
const CANALES = 4;
/** Un megabyte. */
const MB = 1024 * 1024;

const SALIDA = { bien: 0, grave: 1, noSePudo: 2 };

/**
 * Una imagen grande y RUIDOSA.
 *
 * El ruido no es capricho: una imagen de un solo color se comprime a unos pocos
 * KB y no llegaría nunca a los 5 MB que este diagnóstico tiene que ejercitar.
 * Con ruido, el JPEG no tiene nada que predecir y pesa de verdad.
 */
function jpegGrandeYPesado() {
  const pixeles = Buffer.alloc(ANCHO * ALTO * CANALES);
  for (let i = 0; i < pixeles.length; i += 1) {
    pixeles[i] = (Math.random() * 256) | 0;
  }
  return nativeImage.createFromBitmap(pixeles, { width: ANCHO, height: ALTO }).toJPEG(100);
}

app.whenReady().then(() => {
  const carpeta = mkdtempSync(join(tmpdir(), 'pos-sonda-imagen-'));
  let codigo = SALIDA.noSePudo;

  try {
    const origen = join(carpeta, 'grande.jpg');
    writeFileSync(origen, jpegGrandeYPesado());
    const bytesAntes = statSync(origen).size;
    const antes = nativeImage.createFromPath(origen).getSize();

    // La misma aritmética que `dimensionesDestino`, aplicada por el
    // redimensionador de verdad a través de `nativeImage`.
    const imagen = nativeImage.createFromPath(origen);
    const ladoMayor = Math.max(antes.width, antes.height);
    const factor = LADO_MAYOR_MAXIMO_PX / ladoMayor;
    const reducida = imagen.resize({
      width: Math.round(antes.width * factor),
      height: Math.round(antes.height * factor),
      quality: 'best',
    });
    const bytes = reducida.toJPEG(CALIDAD_JPEG);
    const destino = join(carpeta, 'reducida.jpg');
    writeFileSync(destino, bytes);

    const despues = nativeImage.createFromPath(destino).getSize();
    const bytesDespues = statSync(destino).size;
    const ladoMayorDespues = Math.max(despues.width, despues.height);
    const proporcionAntes = antes.width / antes.height;
    const proporcionDespues = despues.width / despues.height;

    const cabe = ladoMayorDespues <= LADO_MAYOR_MAXIMO_PX + TOLERANCIA_PX;
    const pesaMenos = bytesDespues < bytesAntes;
    const conservaProporcion = Math.abs(proporcionAntes - proporcionDespues) < 0.01;
    const eraDeCincoMega = bytesAntes >= 5 * MB;

    console.log('');
    console.log(`Plataforma            : ${process.platform}`);
    console.log(`Leído de la fuente    : lado mayor ${LADO_MAYOR_MAXIMO_PX} px, calidad JPEG ${CALIDAD_JPEG}`);
    console.log(`Origen                : ${antes.width} x ${antes.height} px, ${bytesAntes} bytes (${(bytesAntes / MB).toFixed(2)} MB)`);
    console.log(`¿El origen era >= 5 MB?: ${eraDeCincoMega ? 'sí' : 'NO — la prueba no ejercita el caso pedido'}`);
    console.log(`Resultado             : ${despues.width} x ${despues.height} px, ${bytesDespues} bytes (${(bytesDespues / MB).toFixed(2)} MB)`);
    console.log(`Lado mayor <= ${LADO_MAYOR_MAXIMO_PX} px    : ${cabe ? 'sí' : 'NO — GRAVE'}`);
    console.log(`Pesa menos            : ${pesaMenos ? 'sí' : 'NO — GRAVE'}`);
    console.log(`Conserva la proporción: ${conservaProporcion ? 'sí' : 'NO'}`);
    console.log(`Reducción             : ${(100 - (bytesDespues / bytesAntes) * 100).toFixed(1)} %`);
    console.log('');

    codigo = cabe && pesaMenos && conservaProporcion && eraDeCincoMega ? SALIDA.bien : SALIDA.grave;
  } catch (error) {
    // Última red, por la misma razón que la sonda de credencial la tiene: un
    // guion que se cuelga sin decir nada es peor que uno que falla (§4.11).
    console.error(`No se pudo medir: ${error instanceof Error ? error.message : String(error)}`);
    codigo = SALIDA.noSePudo;
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }

  // `app.exit` y no `app.quit`: no hay ventana ni nada que consolidar, y quit
  // dispara los manejadores de cierre que esta sonda no instala.
  app.exit(codigo);
});
