/**
 * El recibo dibujado, en sus dos formas.
 *
 * SON DOS SALIDAS DEL MISMO MODELO, no dos recibos distintos: `reciboComoHtml`
 * es lo que se convierte en PDF, y `reciboComoTexto` es lo que va a la
 * impresora térmica. Las dos leen exactamente el mismo `ModeloDeRecibo`, así
 * que el papel y el PDF no pueden decir cifras distintas.
 *
 * LAS DOS SON FUNCIONES PURAS: entra un modelo, sale una cadena. No tocan la
 * base, no leen la hora ni el sistema de archivos, y por eso se pueden probar
 * comparando texto esperado contra texto real, sin Electron y sin PDF.
 *
 * ANCHO DE 80 mm. Es el formato que se acordó, y el más común en impresoras
 * térmicas económicas. En texto plano se traduce a 48 columnas, que es lo que
 * entra en 80 mm con la fuente A estándar (576 puntos, 12 por carácter).
 */

import type { LineaDeRecibo, ModeloDeRecibo } from './modelo-de-recibo';
import {
  AGRADECIMIENTO,
  LEYENDA_NO_FISCAL,
  MARCA_DE_VENTA_ANULADA,
  TITULO_DEL_RECIBO,
} from './modelo-de-recibo';

/** Columnas que entran en 80 mm con la fuente A estándar. */
export const COLUMNAS_80MM = 48;

/** Ancho del papel en el PDF. El alto lo decide el contenido. */
export const ANCHO_PAPEL_MM = 80;

/** Margen lateral del PDF, en milímetros. */
const MARGEN_MM = 4;

/** Cómo se lee cada forma de pago en el papel. */
const FORMAS_DE_PAGO_LEGIBLES = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
} as const;

// ===========================================================================
// Texto plano, para la impresora térmica
// ===========================================================================

/** Una línea con la etiqueta a la izquierda y el valor pegado a la derecha. */
function aDosColumnas(etiqueta: string, valor: string, ancho: number): string {
  const espacios = Math.max(1, ancho - etiqueta.length - valor.length);
  return `${etiqueta}${' '.repeat(espacios)}${valor}`;
}

/** Un texto centrado en el ancho del papel. */
function centrado(texto: string, ancho: number): string {
  if (texto.length >= ancho) {
    return texto;
  }
  // El sobrante se reparte a los dos lados, y solo se escribe el de la
  // izquierda: rellenar a la derecha gastaría papel sin cambiar cómo se ve.
  const MITADES = 2;
  return ' '.repeat(Math.floor((ancho - texto.length) / MITADES)) + texto;
}

/** Corta un texto largo en varias líneas, sin partir palabras al medio. */
function enVariasLineas(texto: string, ancho: number): string[] {
  const palabras = texto.split(/\s+/).filter((palabra) => palabra !== '');
  const lineas: string[] = [];
  let actual = '';

  for (const palabra of palabras) {
    const candidata = actual === '' ? palabra : `${actual} ${palabra}`;
    if (candidata.length <= ancho) {
      actual = candidata;
      continue;
    }
    if (actual !== '') {
      lineas.push(actual);
    }
    actual = palabra;
  }
  if (actual !== '') {
    lineas.push(actual);
  }
  return lineas.length === 0 ? [''] : lineas;
}

/**
 * Las dos filas de una línea de producto.
 *
 * VAN EN DOS RENGLONES a propósito. En 48 columnas, «[Ejemplo] Frijol negro
 * quebrado» más la cantidad, el precio y el subtotal no entran en uno solo, y
 * recortar el nombre dejaría al cliente sin saber qué compró. Arriba el nombre
 * completo; abajo, indentado, el desglose y el importe alineado a la derecha.
 */
function lineaDeProductoEnTexto(linea: LineaDeRecibo, ancho: number): string[] {
  const desglose = `  ${linea.cantidad} ${linea.unidad} x ${linea.precioUnitario}`;
  return [
    ...enVariasLineas(linea.producto, ancho),
    aDosColumnas(desglose, linea.subtotal, ancho),
  ];
}

/**
 * El recibo en texto plano, listo para una impresora térmica.
 *
 * Devuelve las líneas ya ajustadas al ancho. No lleva comandos de la impresora:
 * eso es trabajo de `escpos.ts`, que envuelve este texto. Separarlo permite
 * leer el recibo tal como va a salir sin decodificar bytes de control.
 */
export function reciboComoTexto(modelo: ModeloDeRecibo, ancho = COLUMNAS_80MM): string {
  const separador = '-'.repeat(ancho);
  const lineas: string[] = [];

  // ---- Encabezado del negocio ---------------------------------------------
  lineas.push(centrado(modelo.negocio.nombreComercial, ancho));
  for (const parte of enVariasLineas(modelo.negocio.direccion, ancho)) {
    lineas.push(centrado(parte, ancho));
  }
  lineas.push(centrado(`Tel. ${modelo.negocio.telefono}`, ancho));
  lineas.push(centrado(`NIT ${modelo.negocio.nit}`, ancho));
  lineas.push('');

  // ---- Título y advertencia legal -----------------------------------------
  lineas.push(centrado(TITULO_DEL_RECIBO, ancho));
  for (const parte of enVariasLineas(LEYENDA_NO_FISCAL, ancho)) {
    lineas.push(centrado(parte, ancho));
  }
  if (modelo.reimpresion) {
    lineas.push(centrado('** REIMPRESIÓN **', ancho));
  }
  /*
    LA MARCA DE ANULADA VA ARRIBA, antes de los datos de la venta, y el resto
    del papel queda EXACTAMENTE igual: mismas líneas, mismos precios, mismo
    descuento y mismo total (§5.1). No es un documento nuevo, es el original
    marcado, y por eso se lee en el orden en que pasaron las cosas: hubo una
    venta, se entregó este papel, y después se anuló, con fecha, responsable y
    motivo.
  */
  if (modelo.anulacion !== null) {
    lineas.push(centrado(MARCA_DE_VENTA_ANULADA, ancho));
    lineas.push(`Anulada: ${modelo.anulacion.fecha} ${modelo.anulacion.hora}`);
    for (const parte of enVariasLineas(`Autorizó: ${modelo.anulacion.autorizadaPor}`, ancho)) {
      lineas.push(parte);
    }
    for (const parte of enVariasLineas(`Motivo: ${modelo.anulacion.motivo}`, ancho)) {
      lineas.push(parte);
    }
  }
  lineas.push(separador);

  // ---- Datos de la venta ---------------------------------------------------
  lineas.push(aDosColumnas('Recibo No.', String(modelo.numeroRecibo), ancho));
  lineas.push(aDosColumnas('Fecha', `${modelo.fecha} ${modelo.hora}`, ancho));
  lineas.push(aDosColumnas('Cajero', modelo.cajero, ancho));
  lineas.push(separador);

  // ---- Líneas de producto --------------------------------------------------
  for (const linea of modelo.lineas) {
    lineas.push(...lineaDeProductoEnTexto(linea, ancho));
  }
  lineas.push(separador);

  /*
    ---- Totales -------------------------------------------------------------

    NO SE IMPRIME UN RENGLÓN «Subtotal» SEGUIDO DE «Descuento», y esto es una
    corrección: así estaba y el papel no cerraba. `subtotal_impreso` es la parte
    que le toca a cada línea DEL TOTAL YA DESCONTADO —es lo que garantiza que
    los importes sumen exactamente lo que el cliente paga, la regla «el total
    manda» del §5—, así que las líneas NO suman el subtotal. Mostrarlas encima
    de «Subtotal 21.75 / Descuento -1.63 / Total 20.12» daba un recibo donde
    14.80 + 5.32 no daba 21.75 y nadie podía cuadrarlo.

    La forma correcta con estos datos es: las líneas suman el TOTAL, y el
    descuento se informa como lo que es, un dato de la venta, no un paso de la
    resta. El monto rebajado sigue a la vista, y también quién lo autorizó.

    LA ACLARACIÓN SE CONSERVA, aunque desde que el precio unitario impreso es
    el EFECTIVO cada renglón ya multiplica solo. Se conserva por dos cosas que
    la aritmética de la línea no dice: que el renglón «Descuento -1.63» es un
    DATO y no un paso más de resta sobre el TOTAL de abajo —sin la aclaración,
    quien lo lea va a intentar restarlo otra vez—, y que el precio unitario que
    ve no es el precio de lista del producto. Cuesta un renglón de papel.
  */
  if (modelo.descuento !== null) {
    lineas.push(centrado('Precios e importes ya incluyen el descuento.', ancho));
    lineas.push(
      aDosColumnas(`Descuento ${modelo.descuento.descripcion}`, `-${modelo.descuento.rebaja}`, ancho),
    );
    if (modelo.descuento.autorizadoPor !== null) {
      // Quién autorizó va EN EL PAPEL, no solo en la auditoría: es la única
      // copia que se lleva el cliente, y un descuento sin responsable visible
      // es justo lo que el flujo de PIN existe para evitar.
      for (const parte of enVariasLineas(
        `Autorizado por: ${modelo.descuento.autorizadoPor}`,
        ancho,
      )) {
        lineas.push(parte);
      }
    }
  }
  lineas.push(aDosColumnas('TOTAL', modelo.total, ancho));
  lineas.push('');

  // ---- Forma de pago -------------------------------------------------------
  lineas.push(aDosColumnas('Forma de pago', FORMAS_DE_PAGO_LEGIBLES[modelo.formaPago], ancho));
  if (modelo.numBoleta !== null) {
    lineas.push(aDosColumnas('Boleta', modelo.numBoleta, ancho));
  }
  lineas.push('');

  // ---- Pie -----------------------------------------------------------------
  lineas.push(centrado(AGRADECIMIENTO, ancho));

  return lineas.join('\n');
}

// ===========================================================================
// HTML, para el PDF
// ===========================================================================

/** Escapa lo que va a HTML. Un nombre de producto puede traer `&` o `<`. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * El recibo como HTML, que es lo que se convierte en PDF.
 *
 * TODO VA EN LÍNEA: sin hojas de estilo externas, sin tipografías de la red y
 * sin imágenes. La política de seguridad de contenido prohíbe salir a la red
 * desde el renderer, y **la tienda tiene que funcionar sin internet**: un PDF
 * que dependiera de descargar una fuente saldría distinto el día que se corte.
 *
 * Se usa una tipografía MONOESPACIADA para que el PDF se parezca a lo que sale
 * por la térmica. No es capricho: si el papel y el PDF se vieran distintos,
 * cotejar uno contra otro en una auditoría dejaría de ser inmediato.
 */
export function reciboComoHtml(modelo: ModeloDeRecibo): string {
  const filas = modelo.lineas
    .map(
      (linea) => `
      <tr class="linea">
        <td colspan="2" class="producto">${escapar(linea.producto)}</td>
      </tr>
      <tr class="linea">
        <td class="desglose">${escapar(linea.cantidad)} ${escapar(linea.unidad)} &times; ${escapar(linea.precioUnitario)}</td>
        <td class="importe">${escapar(linea.subtotal)}</td>
      </tr>`,
    )
    .join('');

  // Ver la explicación en `reciboComoTexto`: las líneas suman el TOTAL, no el
  // subtotal, así que el descuento se informa y no se resta.
  const descuento =
    modelo.descuento === null
      ? ''
      : `
      <tr>
        <td colspan="2" class="aclaracion">Precios e importes ya incluyen el descuento.</td>
      </tr>
      <tr>
        <td>Descuento ${escapar(modelo.descuento.descripcion)}</td>
        <td class="importe">-${escapar(modelo.descuento.rebaja)}</td>
      </tr>${
        modelo.descuento.autorizadoPor === null
          ? ''
          : `
      <tr>
        <td colspan="2" class="autorizacion">Autorizado por: ${escapar(modelo.descuento.autorizadoPor)}</td>
      </tr>`
      }`;

  const boleta =
    modelo.numBoleta === null
      ? ''
      : `
      <tr>
        <td>Boleta</td>
        <td class="importe">${escapar(modelo.numBoleta)}</td>
      </tr>`;

  const reimpresion = modelo.reimpresion
    ? '<p class="reimpresion">** REIMPRESI&Oacute;N **</p>'
    : '';

  // La misma marca que el papel, con los mismos tres datos. Ver `reciboComoTexto`.
  const anulacion =
    modelo.anulacion === null
      ? ''
      : `
  <p class="anulada">${MARCA_DE_VENTA_ANULADA}</p>
  <p class="anulada-detalle">Anulada: ${escapar(modelo.anulacion.fecha)} ${escapar(modelo.anulacion.hora)}<br>
  Autoriz&oacute;: ${escapar(modelo.anulacion.autorizadaPor)}<br>
  Motivo: ${escapar(modelo.anulacion.motivo)}</p>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo ${String(modelo.numeroRecibo)}</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: ${String(MARGEN_MM)}mm;
    width: ${String(ANCHO_PAPEL_MM)}mm;
    font-family: 'Courier New', Courier, monospace;
    font-size: 10pt;
    line-height: 1.35;
    color: #000;
    background: #fff;
  }
  .centro { text-align: center; }
  .negocio { font-weight: bold; font-size: 12pt; }
  .titulo { font-weight: bold; margin-top: 3mm; }
  .leyenda { font-size: 8.5pt; }
  .reimpresion { font-weight: bold; text-align: center; margin: 1mm 0 0; }
  .anulada { font-weight: bold; text-align: center; margin: 1mm 0 0; }
  .anulada-detalle { margin: 0.5mm 0 0; font-size: 9pt; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0; vertical-align: top; }
  .importe { text-align: right; white-space: nowrap; }
  .producto { padding-top: 1mm; }
  .desglose { padding-left: 3mm; }
  .aclaracion { font-size: 8.5pt; text-align: center; padding-bottom: 1mm; }
  .autorizacion { font-size: 8.5pt; padding-bottom: 1mm; }
  .total td { font-weight: bold; font-size: 11.5pt; padding-top: 1mm; }
  .pie { margin-top: 4mm; text-align: center; }
</style>
</head>
<body>
  <div class="centro negocio">${escapar(modelo.negocio.nombreComercial)}</div>
  <div class="centro">${escapar(modelo.negocio.direccion)}</div>
  <div class="centro">Tel. ${escapar(modelo.negocio.telefono)}</div>
  <div class="centro">NIT ${escapar(modelo.negocio.nit)}</div>

  <div class="centro titulo">${TITULO_DEL_RECIBO}</div>
  <div class="centro leyenda">${LEYENDA_NO_FISCAL}</div>
  ${reimpresion}${anulacion}
  <hr>

  <table>
    <tr><td>Recibo No.</td><td class="importe">${String(modelo.numeroRecibo)}</td></tr>
    <tr><td>Fecha</td><td class="importe">${escapar(modelo.fecha)} ${escapar(modelo.hora)}</td></tr>
    <tr><td>Cajero</td><td class="importe">${escapar(modelo.cajero)}</td></tr>
  </table>
  <hr>

  <table>${filas}</table>
  <hr>

  <table>${descuento}
    <tr class="total"><td>TOTAL</td><td class="importe">${escapar(modelo.total)}</td></tr>
  </table>
  <hr>

  <table>
    <tr><td>Forma de pago</td><td class="importe">${FORMAS_DE_PAGO_LEGIBLES[modelo.formaPago]}</td></tr>${boleta}
  </table>

  <p class="pie">${AGRADECIMIENTO}</p>
</body>
</html>`;
}
