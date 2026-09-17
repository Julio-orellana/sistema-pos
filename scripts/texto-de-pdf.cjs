/**
 * texto-de-pdf.cjs — Leer lo que dice un PDF, abriendo el ARCHIVO del disco.
 *
 * POR QUÉ HACE FALTA. Para comprobar que el PDF de un recibo anulado quedó
 * marcado no alcanza con mirar la pantalla: lo que hay que abrir es el archivo,
 * que es lo que queda en la computadora de la tienda. Y un `grep` no sirve:
 * Chromium escribe el texto como **glifos de una tipografía incrustada**, con
 * los caracteres codificados en hexadecimal según el orden interno de cada
 * subconjunto. Medido sobre un recibo real de la aplicación:
 *
 *   BT /F4 16 Tf 1 0 0 -1 55.15625 29 Tm
 *   <003E003100520050004500550048000300470048004F000300510048004A00520046004C004F0040> Tj
 *
 * Eso dice «[Nombre del negocio]», y no hay forma de verlo sin deshacer el
 * camino que hace cualquier lector de PDF: inflar los streams, leer los mapas
 * `ToUnicode` que el propio archivo trae y traducir los glifos.
 *
 * QUÉ HACE, en ese orden:
 *
 *   1. Recorre los `stream … endstream` del archivo y los infla (zlib de Node;
 *      lo que no infla se lee tal cual, porque no todo stream está comprimido).
 *   2. De los que son un `ToUnicode` arma su diccionario glifo → carácter, con
 *      las dos formas del formato: `beginbfchar` y `beginbfrange`.
 *   3. De los que dibujan texto saca las cadenas hexadecimales de `Tj` y `TJ`.
 *   4. Las traduce con CADA diccionario y devuelve una línea por tipografía.
 *      Un recibo usa varias —normal, negrita, tamaños distintos—, cada una con
 *      su propio orden de glifos, así que una cadena traducida con el
 *      diccionario de otra sale ilegible; no molesta, porque lo que se busca
 *      aparece traducido por el diccionario que le corresponde.
 *
 * DE CADA TIPOGRAFÍA SALEN DOS LECTURAS, pegada y separada por espacios, y las
 * dos hacen falta. Chromium dibuja de dos maneras según el renglón, y se
 * midieron las dos en un recibo real:
 *
 *   · un glifo por `Tj`, moviendo el cursor con `Td` —así salen los renglones
 *     centrados, como la marca de anulada—:
 *     `/F6 13.33 Tf <0003> Tj 8.0 0 Td <0039> Tj …`
 *     Pegando las cadenas se lee «** VENTA ANULADA **»; separándolas con
 *     espacios se leería «* * V E N T A …», y la frase no se encontraría.
 *   · palabra por `Tj` —así salen los renglones alineados a la izquierda, como
 *     el motivo—: ahí es al revés, y pegar las cadenas daría
 *     «Motivo:elclientedevolvió…».
 *
 * Devolver las dos lecturas cuesta unas líneas y evita tener que adivinar cómo
 * dibujó Chromium cada renglón.
 *
 * LO QUE NO ES: un extractor de PDF de propósito general. No maneja
 * codificaciones distintas de la que escribe Chromium, ni texto sin
 * `ToUnicode`, ni respeta el orden de lectura de la página. Sirve para lo que
 * se usa: preguntarle a un archivo si adentro dice cierta frase.
 */

const { readFileSync } = require('node:fs');
const { inflateSync } = require('node:zlib');

/** Todos los `stream … endstream` del archivo, ya inflados cuando se puede. */
function streamsDe(bytes) {
  const inicio = Buffer.from('stream');
  const fin = Buffer.from('endstream');
  const encontrados = [];
  let posicion = 0;

  while ((posicion = bytes.indexOf(inicio, posicion)) !== -1) {
    let desde = posicion + inicio.length;
    // Después de la palabra `stream` va un salto de línea, que puede ser CRLF.
    if (bytes[desde] === 0x0d) desde += 1;
    if (bytes[desde] === 0x0a) desde += 1;

    const hasta = bytes.indexOf(fin, desde);
    if (hasta === -1) break;

    const crudo = bytes.subarray(desde, hasta);
    let texto;
    try {
      texto = inflateSync(crudo).toString('latin1');
    } catch {
      // No estaba comprimido, o no con zlib: se lee tal cual.
      texto = crudo.toString('latin1');
    }
    encontrados.push(texto);
    // Se salta el `endstream` ENTERO: avanzar un byte volvería a encontrar la
    // palabra `stream` dentro de `endstream` y correría todo el recorrido un
    // stream, que es cómo esta función se comió los mapas la primera vez.
    posicion = hasta + fin.length;
  }
  return encontrados;
}

/** Un código hexadecimal de PDF a su carácter. */
function aCaracter(hexadecimal) {
  const numero = Number.parseInt(hexadecimal, 16);
  return Number.isNaN(numero) ? '' : String.fromCodePoint(numero);
}

/**
 * El diccionario glifo → carácter de un stream `ToUnicode`, o `null` si ese
 * stream no lo es.
 */
function diccionarioDe(stream) {
  if (!stream.includes('beginbfchar') && !stream.includes('beginbfrange')) {
    return null;
  }
  const diccionario = new Map();

  for (const bloque of stream.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const par of bloque.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      diccionario.set(par[1].toLowerCase(), aCaracter(par[2]));
    }
  }

  for (const bloque of stream.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const tramo of bloque.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const desde = Number.parseInt(tramo[1], 16);
      const hasta = Number.parseInt(tramo[2], 16);
      const primero = Number.parseInt(tramo[3], 16);
      const LARGO_DEL_GLIFO = 4;
      for (let glifo = desde; glifo <= hasta; glifo += 1) {
        diccionario.set(
          glifo.toString(16).padStart(LARGO_DEL_GLIFO, '0'),
          String.fromCodePoint(primero + (glifo - desde)),
        );
      }
    }
  }
  return diccionario.size === 0 ? null : diccionario;
}

/** Las cadenas hexadecimales que el PDF manda dibujar con `Tj` o `TJ`. */
function cadenasDibujadas(streams) {
  const cadenas = [];
  for (const stream of streams) {
    if (!/\bBT\b/.test(stream)) continue;
    for (const encontrada of stream.matchAll(/<([0-9A-Fa-f]+)>\s*(?=Tj|TJ|\]|\s)/g)) {
      cadenas.push(encontrada[1].toLowerCase());
    }
  }
  return cadenas;
}

/** Traduce una cadena de glifos con un diccionario. */
function traducir(cadena, diccionario) {
  const LARGO_DEL_GLIFO = 4;
  let texto = '';
  for (let i = 0; i + LARGO_DEL_GLIFO <= cadena.length; i += LARGO_DEL_GLIFO) {
    texto += diccionario.get(cadena.slice(i, i + LARGO_DEL_GLIFO)) ?? '';
  }
  return texto;
}

/**
 * El texto que se puede leer dentro de un PDF: por cada tipografía, sus cadenas
 * en el orden en que el archivo las manda dibujar, pegadas y separadas por
 * espacios (ver la cabecera).
 */
function textoDelPdf(ruta) {
  const streams = streamsDe(readFileSync(ruta));
  const diccionarios = streams.map(diccionarioDe).filter((d) => d !== null);
  const cadenas = cadenasDibujadas(streams);

  const lecturas = [];
  for (const diccionario of diccionarios) {
    const traducidas = cadenas.map((cadena) => traducir(cadena, diccionario));
    lecturas.push(traducidas.join(''), traducidas.join(' '));
  }
  return lecturas.join('\n');
}

module.exports = { textoDelPdf };
