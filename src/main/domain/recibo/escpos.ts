/**
 * ESC/POS: el recibo convertido en los bytes que entiende una térmica.
 *
 * ES UNA FUNCIÓN PURA, y esa es la decisión de diseño que importa acá. Entra el
 * texto del recibo, salen bytes. No abre puertos, no busca impresoras y no toca
 * el sistema de archivos, así que se puede probar byte por byte sin tener una
 * impresora enfrente. Quien habla con el dispositivo es el adaptador
 * (`escpos-printer.ts`), que se limita a escribir lo que esta función devuelve.
 *
 * QUÉ ES ESC/POS. Es el juego de comandos que Epson definió para sus
 * impresoras de punto de venta y que copió casi toda la industria: los modelos
 * genéricos económicos, que son los que se consiguen en Guatemala, lo hablan
 * con pocas variaciones. Un comando es una secuencia corta que empieza con ESC
 * (0x1B) o GS (0x1D); todo lo que no sea comando se imprime tal cual.
 *
 * > **PENDIENTE: EL MODELO REAL DE JIMMY NO ESTÁ CONFIRMADO.** Esto está
 * > escrito contra el estándar más común, no contra su impresora, porque
 * > todavía no se sabe cuál es —llega el jueves—. Los comandos que se usan son
 * > los del núcleo del estándar, los que soporta prácticamente cualquier
 * > modelo; se evitaron a propósito los de código de barras, imagen y cajón de
 * > dinero, que son donde los fabricantes se apartan. Aun así, **esto no está
 * > verificado contra hardware real** y hay que confirmarlo. Ver CLAUDE.md.
 *
 * LA CODIFICACIÓN ES EL PUNTO FRÁGIL. El texto lleva acentos y «ñ», y las
 * térmicas no usan UTF-8: usan páginas de códigos de un byte. Se selecciona
 * CP850, que es la que traen casi todas de fábrica y cubre el español, y el
 * texto se convierte a esa página. Un carácter que no exista en CP850 se
 * reemplaza por su equivalente sin acento antes que imprimir basura.
 */

/** Comandos ESC/POS que se usan. Solo los del núcleo del estándar. */
const ESC = 0x1b;
const GS = 0x1d;

/** Reinicia la impresora a su estado por omisión. */
const INICIALIZAR = Uint8Array.from([ESC, 0x40]);

/** Selecciona la página de códigos CP850 (multilingüe latino). */
const PAGINA_CP850 = Uint8Array.from([ESC, 0x74, 0x02]);

/** Avanza tres líneas, para que el corte no se coma el pie del recibo. */
const AVANZAR = Uint8Array.from([ESC, 0x64, 0x03]);

/**
 * Corte parcial del papel.
 *
 * Se usa el PARCIAL y no el total: deja el papel unido por un punto, así que la
 * hoja no se cae al piso mientras el cajero atiende. Es el comportamiento
 * habitual en un mostrador.
 */
const CORTAR = Uint8Array.from([GS, 0x56, 0x42, 0x00]);

/**
 * Equivalencias para caracteres que CP850 no tiene.
 *
 * Antes que imprimir un símbolo cualquiera —que es lo que hace la impresora con
 * un byte que no reconoce— se prefiere la versión sin adorno: «Q» en vez de un
 * signo raro, comillas rectas en vez de tipográficas. Un recibo con un carácter
 * equivocado en el nombre de un producto se lee mal, pero uno con basura en
 * medio de un monto no se puede defender.
 */
const EQUIVALENCIAS: ReadonlyMap<string, string> = new Map([
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  ['–', '-'],
  ['—', '-'],
  ['…', '...'],
  ['×', 'x'],
  ['€', 'EUR'],
]);

/**
 * Tabla de CP850 para los caracteres del español que no son ASCII.
 *
 * Se escribe a mano y no se usa `Buffer.from(texto, 'latin1')` porque latin1 no
 * es CP850: coinciden en los primeros 128 bytes y se separan justo en las
 * vocales acentuadas, que es todo lo que hace falta que salga bien.
 */
const CP850: ReadonlyMap<string, number> = new Map([
  ['á', 0xa0], ['é', 0x82], ['í', 0xa1], ['ó', 0xa2], ['ú', 0xa3],
  ['Á', 0xb5], ['É', 0x90], ['Í', 0xd6], ['Ó', 0xe0], ['Ú', 0xe9],
  ['ñ', 0xa4], ['Ñ', 0xa5],
  ['ü', 0x81], ['Ü', 0x9a],
  ['¿', 0xa8], ['¡', 0xad],
  ['º', 0xa7], ['ª', 0xa6],
  ['°', 0xf8],
]);

/** Lo que se imprime cuando un carácter no existe en CP850 ni tiene equivalente. */
const SUSTITUTO = 0x3f; // '?'

/** Convierte una cadena a los bytes de CP850. */
export function aCp850(texto: string): Uint8Array {
  const bytes: number[] = [];

  for (const caracter of texto) {
    const equivalente = EQUIVALENCIAS.get(caracter);
    const aConvertir = equivalente ?? caracter;

    for (const parte of aConvertir) {
      const codigo = parte.codePointAt(0) ?? SUSTITUTO;
      if (codigo < 0x80) {
        bytes.push(codigo);
        continue;
      }
      bytes.push(CP850.get(parte) ?? SUSTITUTO);
    }
  }

  return Uint8Array.from(bytes);
}

/** Une varios tramos de bytes en uno solo. */
function unir(tramos: readonly Uint8Array[]): Uint8Array {
  const total = tramos.reduce((suma, tramo) => suma + tramo.length, 0);
  const resultado = new Uint8Array(total);
  let posicion = 0;
  for (const tramo of tramos) {
    resultado.set(tramo, posicion);
    posicion += tramo.length;
  }
  return resultado;
}

/**
 * El recibo completo, listo para escribir en el dispositivo.
 *
 * La estructura es siempre la misma: inicializar, fijar la página de códigos,
 * el texto, avanzar y cortar. No se usan negrita ni tamaños dobles a propósito:
 * son de los comandos donde los modelos genéricos más se apartan del estándar,
 * y el recibo ya se lee bien sin ellos. Cuando se confirme el modelo de Jimmy
 * se podrá decidir si conviene resaltar el total.
 */
export function reciboComoEscPos(texto: string): Uint8Array {
  // Cada línea termina en salto: la térmica imprime por línea, no por página.
  const cuerpo = aCp850(`${texto}\n`);
  return unir([INICIALIZAR, PAGINA_CP850, cuerpo, AVANZAR, CORTAR]);
}
