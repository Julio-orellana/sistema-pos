/**
 * Dónde vive el PDF de un recibo: la ruta RELATIVA que se guarda en la base y
 * la ABSOLUTA que se usa en el disco.
 *
 * ===========================================================================
 * `recibos.pdf_path` ES UNA RUTA RELATIVA, IGUAL QUE `productos.foto_path`
 * ===========================================================================
 *
 * Hasta el 2026-09-14 `ServicioDeRecibos` guardaba la ruta ABSOLUTA de la
 * carpeta de recibos de la máquina que emitió (`/Users/…/recibos/recibo-….pdf`
 * en macOS, `C:\Users\…\recibos\recibo-….pdf` en Windows). Esa ruta viajaba a
 * la nube tal cual con cada recibo, y **no significa nada en ninguna otra
 * máquina**: al restaurar la terminal en una computadora nueva había que
 * re-enraizarla a mano, y cada recibo nuevo iba a seguir subiendo con el mismo
 * problema para siempre. Lo señaló Julio al revisar la fase 4.b.
 *
 * Desde la migración 030, lo que se guarda es `recibos/<nombre>.pdf`, relativa
 * a la carpeta de datos de la aplicación, que es exactamente lo que el diseño
 * suponía (`docs/SINCRONIZACION.md` §2.5.1) y lo que `foto_path` hace desde
 * que existe (§4.11 de CLAUDE.md): «la absoluta cambia entre máquinas y
 * rompería un respaldo restaurado en otra computadora».
 *
 * Las tres funciones de acá son puras y son las ÚNICAS que saben armar,
 * convertir y resolver esa ruta:
 *
 *   · `rutaRelativaDePdf(nombre)`: la forma canónica, para EMITIR.
 *   · `resolverRutaDePdf(carpetaBase, relativa)`: la absoluta, para ESCRIBIR o
 *     imprimir, con la misma barrera contra el recorrido de directorios que
 *     `resolverRutaDeFoto`.
 *   · `rutaRelativaDePdfDesde(cualquierRuta)`: COMPATIBILIDAD HACIA ATRÁS. De
 *     una ruta guardada con la convención vieja (absoluta, de macOS o de
 *     Windows) saca el nombre y devuelve la forma canónica. La usan la
 *     migración 030 —en SQL, con la misma regla— para las filas locales que ya
 *     existían, y la restauración para las filas que se subieron a la nube
 *     antes de este cambio y siguen allá con ruta absoluta. No es el
 *     comportamiento esperado de ninguna fila nueva.
 */

import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { ErrorDeNegocio } from '@main/database/errores';

/** La subcarpeta de `<userData>` donde viven los PDF. Es el prefijo de toda `pdf_path`. */
export const SUBCARPETA_DE_RECIBOS = 'recibos';

/** La ruta relativa que se guarda en `recibos.pdf_path` para un nombre de archivo. */
export function rutaRelativaDePdf(nombreDeArchivo: string): string {
  if (nombreDeArchivo === '' || /[\\/]/.test(nombreDeArchivo)) {
    throw new ErrorDeNegocio(
      'DATO_INVALIDO',
      'El nombre del archivo del recibo no es válido.',
      `nombre de PDF rechazado: «${nombreDeArchivo}»`,
    );
  }
  return `${SUBCARPETA_DE_RECIBOS}/${nombreDeArchivo}`;
}

/**
 * De una ruta guardada con CUALQUIER convención a la forma canónica.
 *
 * Es compatibilidad hacia atrás y nada más: una fila nueva ya viene canónica y
 * pasa por acá sin cambiar. Una vieja trae la ruta absoluta de la terminal que
 * la emitió —con barras de Unix o de Windows—, y lo único que sirve de ella es
 * el nombre del archivo, que la terminal generó con el número de recibo y el
 * momento de emisión. Se corta a mano por cualquiera de las dos barras porque
 * `path.basename` de macOS no parte una ruta de Windows.
 */
export function rutaRelativaDePdfDesde(rutaGuardada: string): string {
  const partes = rutaGuardada.split(/[\\/]/);
  const nombre = partes[partes.length - 1] ?? '';
  if (nombre === '') {
    throw new ErrorDeNegocio(
      'DATO_INVALIDO',
      'La ruta del PDF guardada no tiene nombre de archivo.',
      `pdf_path sin nombre: «${rutaGuardada}»`,
    );
  }
  return rutaRelativaDePdf(nombre);
}

/**
 * Resuelve la ruta absoluta de un PDF y comprueba que caiga DENTRO de la
 * carpeta de recibos. Misma barrera que `resolverRutaDeFoto`: un `pdf_path`
 * que dijera `../../algo` no puede hacer que la aplicación escriba fuera de su
 * carpeta, ni le pase a la impresora un archivo ajeno.
 */
export function resolverRutaDePdf(carpetaBase: string, rutaRelativa: string): string {
  const carpetaDeRecibos = resolve(join(carpetaBase, SUBCARPETA_DE_RECIBOS));

  if (isAbsolute(rutaRelativa)) {
    throw new ErrorDeNegocio(
      'DATO_INVALIDO',
      'La ruta del PDF del recibo no es válida.',
      `ruta absoluta rechazada: ${rutaRelativa}`,
    );
  }

  const candidata = resolve(join(carpetaBase, normalize(rutaRelativa)));
  if (candidata === carpetaDeRecibos || !candidata.startsWith(carpetaDeRecibos + sep)) {
    throw new ErrorDeNegocio(
      'DATO_INVALIDO',
      'La ruta del PDF del recibo no es válida.',
      `ruta fuera de la carpeta de recibos: ${rutaRelativa}`,
    );
  }
  return candidata;
}
