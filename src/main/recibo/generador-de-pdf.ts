/**
 * HTML a PDF, con lo que Electron ya trae.
 *
 * POR QUÉ NO SE AGREGÓ UNA LIBRERÍA DE PDF. Electron empaqueta Chromium, y
 * Chromium sabe imprimir a PDF: `webContents.printToPDF` produce el mismo
 * archivo que produciría «Guardar como PDF» en un navegador. Sumar `pdfkit` o
 * similar sería agregar una dependencia y un segundo motor de maquetación para
 * hacer algo que el que ya viaja en el instalador hace igual de bien. Y hay una
 * razón de fondo: maquetar con HTML y CSS deja el recibo legible y ajustable
 * por alguien que no sea programador, mientras que una librería de PDF lo
 * convierte en coordenadas.
 *
 * LA VENTANA ES INVISIBLE Y EFÍMERA. Se crea sin mostrarse, se carga el HTML,
 * se imprime y se destruye. No comparte sesión ni preload con la ventana del
 * punto de venta, y no tiene integración con Node: el HTML del recibo es
 * contenido que se renderiza, no código que se ejecuta.
 *
 * EL ALTO DEL PAPEL LO DECIDE EL CONTENIDO. Un recibo de dos líneas y otro de
 * treinta no pueden salir en la misma hoja: `preferCSSPageSize` deja que la
 * regla `@page` de la plantilla mande, y el resultado es una tira continua como
 * la que sale de una térmica, no una A4 con el recibo arriba y medio metro de
 * blanco debajo.
 */

import { writeFile } from 'node:fs/promises';
import { BrowserWindow } from 'electron';

/** Milímetros por pulgada, para traducir el ancho del papel a las unidades de Chromium. */
const MM_POR_PULGADA = 25.4;

/** Ancho del papel térmico, en milímetros. */
const ANCHO_MM = 80;

/**
 * Alto máximo de una tira. Es un tope de seguridad, no el alto real: con
 * `preferCSSPageSize` manda el `@page` de la plantilla.
 */
const ALTO_MAXIMO_MM = 3000;

/** Convierte el HTML del recibo en un PDF y lo guarda en `destino`. */
export async function generarPdfDesdeHtml(html: string, destino: string): Promise<void> {
  const ventana = new BrowserWindow({
    show: false,
    webPreferences: {
      // El HTML del recibo es CONTENIDO, no código: sin Node, sin preload y con
      // aislamiento de contexto, igual que la ventana principal.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try {
    /*
      Se carga por `data:` y no escribiendo un archivo temporal: así no queda un
      HTML con los datos de una venta dando vueltas en el disco, y no hay que
      acordarse de borrarlo si algo falla a la mitad.
    */
    await ventana.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const pdf = await ventana.webContents.printToPDF({
      pageSize: {
        width: ANCHO_MM / MM_POR_PULGADA,
        height: ALTO_MAXIMO_MM / MM_POR_PULGADA,
      },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: true,
    });

    await writeFile(destino, pdf);
  } finally {
    // Se destruye SIEMPRE, incluso si la impresión falló: una ventana invisible
    // que quedara viva sería un proceso de Chromium colgado que nadie ve.
    if (!ventana.isDestroyed()) {
      ventana.destroy();
    }
  }
}
