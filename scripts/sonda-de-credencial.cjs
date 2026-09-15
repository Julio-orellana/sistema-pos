/**
 * Sonda: ¿el `safeStorage` REAL de este sistema operativo cifra de verdad la
 * credencial de la nube?
 *
 * ===========================================================================
 * POR QUÉ ESTE GUION EXISTE, Y QUÉ MIDE QUE `npm test` NO PUEDA MEDIR
 * ===========================================================================
 *
 * Las pruebas de `credencial.test.ts` corren en Node puro, sin Electron, con
 * un cifrado de mentira inyectado. Prueban **el contrato del almacén** —que
 * siempre pase por el cifrado, que se niegue a guardar si no hay— y son las
 * que muerden si alguien mete un respaldo en texto plano.
 *
 * **Lo que NO pueden probar es que DPAPI o el llavero cifren de verdad**, que
 * es justamente lo que protege el token de refresco en la máquina de la
 * tienda. Eso depende de Electron y del sistema operativo, y solo se puede
 * medir corriendo Electron. Esta sonda hace exactamente eso y nada más:
 * escribe una credencial de mentira con el cifrado REAL, lee los bytes del
 * disco y comprueba que el token no esté ahí en claro.
 *
 * > **HAY QUE CORRERLA EN WINDOWS, que es la plataforma de producción.** En
 * > macOS el respaldo es el llavero y en Windows es DPAPI: son dos mecanismos
 * > distintos, y que uno funcione no dice nada del otro. Un resultado en macOS
 * > es una señal útil durante el desarrollo, nunca una verificación (§4 de
 * > CLAUDE.md).
 *
 * No toca la carpeta de datos de la aplicación: trabaja en una carpeta
 * temporal que borra al terminar, así que correrla no puede desconectar una
 * terminal ya conectada.
 *
 *   npm run diagnostico:credencial
 *
 * Sale con código 0 si el token quedó cifrado, 1 si quedó legible —que sería
 * grave— y 2 si el sistema no ofrece cifrado, que no es un fallo de este
 * proyecto pero sí impide guardar la credencial.
 */

const { app, safeStorage } = require('electron');
const { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

/** Un token de mentira, distintivo para poder buscarlo byte a byte. */
const TOKEN_DE_MENTIRA = 'v1.TOKEN-DE-REFRESCO-DISTINTIVO-PARA-LA-SONDA-9xQ';

/** Los mismos permisos que usa `AlmacenDeCredencial`. */
const SOLO_EL_DUENO = 0o600;

const SALIDA = { bien: 0, tokenLegible: 1, sinCifrado: 2 };

/**
 * Descifra sin dejar que una excepción tumbe la sonda.
 *
 * `decryptString` LANZA si los bytes no son un blob suyo, y eso pasa
 * exactamente en el caso que esta sonda existe para detectar: el archivo
 * escrito en claro. Sin este envoltorio, la sonda moría con una excepción
 * dentro de `whenReady`, **el proceso quedaba vivo sin ventana y sin imprimir
 * nada**, y quien la corriera no vería ni el problema ni un error: vería la
 * terminal colgada. Un guion que se cuelga en vez de reportar es peor que uno
 * que falla, que es la misma regla de §4.11 de CLAUDE.md.
 */
function descifrarSinRomper(bytes) {
  try {
    return { ok: true, texto: safeStorage.decryptString(bytes) };
  } catch (error) {
    return { ok: false, texto: null, motivo: error instanceof Error ? error.message : String(error) };
  }
}

app.whenReady().then(() => {
  try {
    correrSonda();
  } catch (error) {
    // Última red: cualquier cosa inesperada se reporta y el proceso SALE.
    console.error(`SONDA_DE_CREDENCIAL falló de forma inesperada: ${String(error)}`);
    app.exit(SALIDA.tokenLegible);
  }
});

function correrSonda() {
  const informe = { plataforma: process.platform, electron: process.versions.electron };
  let codigo = SALIDA.bien;

  informe.cifradoDisponible = safeStorage.isEncryptionAvailable();

  if (!informe.cifradoDisponible) {
    /*
      No es un defecto del proyecto: pasa en Linux sin llavero. Pero sí
      significa que en ESTA máquina la aplicación se va a negar a guardar la
      credencial, que es el comportamiento correcto y conviene saberlo antes
      de instalarla en la tienda.
    */
    informe.conclusion =
      'Este sistema no ofrece almacenamiento cifrado, así que la aplicación se NEGARÁ a guardar la credencial.';
    codigo = SALIDA.sinCifrado;
  } else {
    const carpeta = mkdtempSync(join(tmpdir(), 'sonda-credencial-'));
    const ruta = join(carpeta, 'sincronizacion.credencial');
    try {
      const cifrado = safeStorage.encryptString(TOKEN_DE_MENTIRA);
      writeFileSync(ruta, cifrado, { mode: SOLO_EL_DUENO });

      const crudo = readFileSync(ruta);
      informe.bytesEscritos = crudo.length;
      informe.tokenEnClaroEnElArchivo =
        crudo.toString('utf8').includes(TOKEN_DE_MENTIRA) ||
        crudo.toString('latin1').includes(TOKEN_DE_MENTIRA) ||
        crudo.includes(Buffer.from(TOKEN_DE_MENTIRA, 'utf8'));
      const devuelta = descifrarSinRomper(crudo);
      informe.descifraIgual = devuelta.ok && devuelta.texto === TOKEN_DE_MENTIRA;
      if (!devuelta.ok) {
        informe.motivoDelFalloAlDescifrar = devuelta.motivo;
      }
      informe.modoDelArchivo = (statSync(ruta).mode & 0o777).toString(8);

      if (informe.tokenEnClaroEnElArchivo) {
        informe.conclusion = 'EL TOKEN QUEDÓ LEGIBLE EN EL DISCO. Esto es grave: revisar antes de instalar.';
        codigo = SALIDA.tokenLegible;
      } else if (!informe.descifraIgual) {
        informe.conclusion = 'El token quedó cifrado pero NO descifra igual: la credencial sería inservible.';
        codigo = SALIDA.tokenLegible;
      } else {
        informe.conclusion = 'El token quedó cifrado y descifra igual.';
      }
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  }

  console.log(`SONDA_DE_CREDENCIAL${JSON.stringify(informe)}`);
  console.log('');
  console.log(`Plataforma            : ${informe.plataforma}`);
  console.log(`Cifrado disponible    : ${informe.cifradoDisponible ? 'sí' : 'NO'}`);
  if (informe.cifradoDisponible) {
    console.log(`Bytes en el archivo   : ${informe.bytesEscritos}`);
    console.log(`Token legible en él   : ${informe.tokenEnClaroEnElArchivo ? 'SÍ — GRAVE' : 'no'}`);
    console.log(`Descifra igual        : ${informe.descifraIgual ? 'sí' : 'NO'}`);
    console.log(`Permisos del archivo  : ${informe.modoDelArchivo}`);
  }
  console.log(informe.conclusion);
  if (informe.plataforma !== 'win32') {
    console.log('');
    console.log('AVISO: esto se midió fuera de Windows, que es la plataforma de producción.');
    console.log('       En Windows el respaldo es DPAPI y hay que volver a correrlo allá.');
  }

  app.exit(codigo);
}
