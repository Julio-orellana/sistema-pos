/**
 * La ruta del PDF de un recibo: relativa en la fila, absoluta en el disco, y
 * la conversión de compatibilidad para lo que quedó guardado con la
 * convención vieja.
 */

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolverRutaDePdf, rutaRelativaDePdf, rutaRelativaDePdfDesde, SUBCARPETA_DE_RECIBOS } from '../ruta-de-pdf';

const NOMBRE = 'recibo-000001-2026-09-11T19-09-34-701Z.pdf';

describe('rutaRelativaDePdf: la forma que se guarda en la fila', () => {
  it('es recibos/<nombre>.pdf, relativa a la carpeta de datos', () => {
    expect(rutaRelativaDePdf(NOMBRE)).toBe(`${SUBCARPETA_DE_RECIBOS}/${NOMBRE}`);
    expect(rutaRelativaDePdf(NOMBRE)).toBe('recibos/recibo-000001-2026-09-11T19-09-34-701Z.pdf');
  });

  it('rechaza un nombre vacío o con barras: el nombre es solo el archivo', () => {
    expect(() => rutaRelativaDePdf('')).toThrow(/no es válido/);
    expect(() => rutaRelativaDePdf('carpeta/archivo.pdf')).toThrow(/no es válido/);
    expect(() => rutaRelativaDePdf('carpeta\\archivo.pdf')).toThrow(/no es válido/);
  });
});

describe('rutaRelativaDePdfDesde: COMPATIBILIDAD con las rutas absolutas guardadas antes de la migración 030', () => {
  it('de una ruta absoluta de macOS conserva solo el nombre', () => {
    expect(
      rutaRelativaDePdfDesde(`/Users/jimmy/Library/Application Support/pos-agricola/recibos/${NOMBRE}`),
    ).toBe(`recibos/${NOMBRE}`);
  });

  it('de una ruta absoluta de Windows, con barras invertidas, también', () => {
    expect(rutaRelativaDePdfDesde(`C:\\Users\\Jimmy\\AppData\\Roaming\\pos-agricola\\recibos\\${NOMBRE}`)).toBe(
      `recibos/${NOMBRE}`,
    );
  });

  it('una ruta que YA es la canónica queda igual: la conversión es idempotente', () => {
    expect(rutaRelativaDePdfDesde(`recibos/${NOMBRE}`)).toBe(`recibos/${NOMBRE}`);
  });

  it('una ruta sin nombre de archivo se rechaza en vez de inventar uno', () => {
    expect(() => rutaRelativaDePdfDesde('/Users/jimmy/recibos/')).toThrow(/no tiene nombre/);
    expect(() => rutaRelativaDePdfDesde('')).toThrow(/no tiene nombre/);
  });
});

describe('resolverRutaDePdf: la absoluta de ESTA máquina, y la barrera contra salirse de la carpeta', () => {
  it('resuelve dentro de <carpeta de datos>/recibos', () => {
    expect(resolverRutaDePdf('/datos', `recibos/${NOMBRE}`)).toBe(resolve(`/datos/recibos/${NOMBRE}`));
  });

  it('rechaza una ruta absoluta: la fila no puede mandar a escribir en cualquier lado', () => {
    expect(() => resolverRutaDePdf('/datos', `/otro/lado/${NOMBRE}`)).toThrow(/no es válida/);
  });

  it('rechaza salirse de la carpeta de recibos con ../', () => {
    expect(() => resolverRutaDePdf('/datos', 'recibos/../../etc/passwd')).toThrow(/no es válida/);
    expect(() => resolverRutaDePdf('/datos', '../recibos/archivo.pdf')).toThrow(/no es válida/);
  });

  it('rechaza la carpeta misma y cualquier otra subcarpeta', () => {
    expect(() => resolverRutaDePdf('/datos', 'recibos')).toThrow(/no es válida/);
    expect(() => resolverRutaDePdf('/datos', 'recibos/')).toThrow(/no es válida/);
    expect(() => resolverRutaDePdf('/datos', `fotos-de-productos/${NOMBRE}`)).toThrow(/no es válida/);
  });
});
