/**
 * Redimensionado de fotos de producto AL GUARDAR.
 *
 * ===========================================================================
 * POR QUÉ SE REDIMENSIONA, CON EL NÚMERO QUE LO JUSTIFICA
 * ===========================================================================
 *
 * CLAUDE.md §4.11 decía «no se redimensiona ni se comprime; si hace falta, es
 * una mejora futura». **Hace falta**, y §2.5.3 del diseño lo midió: un catálogo
 * de 200 productos con fotos de teléfono sin comprimir son **unos 600 MB**, el
 * 60 % del gigabyte del plan gratuito **de una sola vez**. Las mismas 200 fotos
 * a 800 píxeles de lado mayor pesan **unos 30 MB**.
 *
 * Se hace **al guardar y no solo al subir**, que es lo que el diseño propone:
 * así el disco de la terminal también se cuida, y la foto que la cuadrícula de
 * venta dibuja es la chica. A 800 px una foto se ve igual en una tarjeta de la
 * cuadrícula, que es el único lugar donde se muestra.
 *
 * ===========================================================================
 * SE USA `nativeImage` DE ELECTRON, NO UNA LIBRERÍA NUEVA
 * ===========================================================================
 *
 * Es exactamente el mismo criterio con el que el PDF del recibo sale de
 * Chromium y no de `pdfkit` (§5): **Electron ya empaqueta los códecs de imagen**,
 * así que agregar `sharp` sumaría un módulo NATIVO que habría que recompilar
 * para Electron y para Windows, y `jimp` sumaría megabytes de JavaScript para
 * hacer lo que el proceso principal ya sabe hacer.
 *
 * Por eso este módulo **no importa Electron**: define la aritmética —que es
 * pura y se prueba sin abrir nada— y el CONTRATO del redimensionador. Quien
 * pone los píxeles se inyecta. Es la misma separación que ya tiene el resto de
 * `almacen-de-fotos.ts`, que recibe la carpeta base por parámetro para poder
 * probarse contra archivos reales sin arrancar la aplicación.
 *
 * ===========================================================================
 * EL FORMATO NO SE CAMBIA, Y ES DELIBERADO
 * ===========================================================================
 *
 * Un PNG se re-encoda como PNG y un JPEG como JPEG. Convertir los PNG a JPEG
 * bajaría más el peso, y **pierde la transparencia y cambia la extensión** que
 * la fila ya guardó. Cuál de las dos cosas le conviene a la tienda es una
 * definición que Jimmy no dio, y este proyecto no las inventa: se reduce el
 * tamaño, que es lo que el número pedía, sin tocar nada más.
 */

/**
 * Lado mayor, en píxeles, al que se reduce una foto.
 *
 * Sale de §2.5.3 del diseño, decisión 7. No es un número redondo elegido al
 * azar: es lo que baja un catálogo de 200 fotos de 600 MB a unos 30 MB
 * conservando una imagen que en la cuadrícula se ve igual.
 */
export const LADO_MAYOR_MAXIMO_PX = 800;

/**
 * Calidad de re-encodado para JPEG, de 0 a 100.
 *
 * 80 es la que §2.5.3 usó para estimar los 150 KB por foto. Por debajo de 70
 * los artefactos se ven en una pantalla táctil a medio metro; por encima de 90
 * el archivo crece sin que se note.
 */
export const CALIDAD_JPEG = 80;

/** Alto y ancho de una imagen, en píxeles. */
export interface Dimensiones {
  readonly ancho: number;
  readonly alto: number;
}

/**
 * A qué tamaño hay que llevar una imagen, o `null` si ya está bien.
 *
 * **NUNCA AGRANDA.** Una foto de 300 px se guarda tal cual: estirarla no
 * agrega información, pesa más y se ve peor. Por eso devuelve `null` cuando el
 * lado mayor ya cabe, y quien llama copia el archivo original sin tocarlo.
 *
 * Conserva la proporción y redondea hacia arriba el lado menor, con un piso de
 * 1 px: una imagen de 4000 × 3 no puede terminar con alto 0, que no es una
 * imagen.
 */
export function dimensionesDestino(origen: Dimensiones): Dimensiones | null {
  const ladoMayor = Math.max(origen.ancho, origen.alto);

  if (ladoMayor <= LADO_MAYOR_MAXIMO_PX) {
    return null;
  }

  const factor = LADO_MAYOR_MAXIMO_PX / ladoMayor;
  return {
    ancho: Math.max(1, Math.round(origen.ancho * factor)),
    alto: Math.max(1, Math.round(origen.alto * factor)),
  };
}

/** Los dos formatos que el almacén acepta, y que se conservan al reducir. */
export type FormatoDeImagen = 'jpeg' | 'png';

/**
 * Quien pone los píxeles. La implementación real usa `nativeImage` de Electron
 * y vive en `src/main/adapters/`; las pruebas inyectan la suya.
 *
 * Devuelve `null` cuando NO hizo falta reducir —la imagen ya cabía— para que
 * quien llama copie el archivo original en vez de re-encodarlo por gusto: un
 * re-encodado innecesario degrada una foto que ya estaba bien.
 */
export interface RedimensionadorDeImagen {
  /**
   * Reduce la imagen del archivo indicado y devuelve los bytes del resultado,
   * o `null` si su lado mayor ya cabía en {@link LADO_MAYOR_MAXIMO_PX}.
   *
   * **No lanza por una imagen ilegible**: eso ya lo atrapó la comprobación de
   * firma binaria de `almacen-de-fotos.ts`, que corre antes.
   */
  reducir(rutaOrigen: string, formato: FormatoDeImagen): Buffer | null;
}
