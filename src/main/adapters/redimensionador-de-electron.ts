/**
 * El redimensionador REAL, con los códecs de imagen que Electron ya trae.
 *
 * Está separado de `domain/catalogo/redimensionar.ts` por la misma razón por la
 * que `almacen-de-fotos.ts` recibe la carpeta base por parámetro: **el dominio
 * no importa Electron**, así se prueba contra archivos reales sin arrancar la
 * aplicación. Acá vive lo único que necesita a Electron de verdad.
 *
 * Y por eso el número que importa —que una foto de 5 MB termine en 800 px— NO
 * se puede probar con Vitest: un doble inyectado probaría el doble. Se mide con
 * `npm run diagnostico:imagen`, que corre DENTRO de Electron con
 * `nativeImage` de verdad, igual que `diagnostico:credencial` hace con
 * `safeStorage` (§4.23).
 */

import { nativeImage } from 'electron';

import {
  CALIDAD_JPEG,
  dimensionesDestino,
  type FormatoDeImagen,
  type RedimensionadorDeImagen,
} from '@main/domain/catalogo/redimensionar';

/** Reduce imágenes con `nativeImage`, sin dependencias nuevas. */
export class RedimensionadorDeElectron implements RedimensionadorDeImagen {
  public reducir(rutaOrigen: string, formato: FormatoDeImagen): Buffer | null {
    const imagen = nativeImage.createFromPath(rutaOrigen);

    /*
      `createFromPath` NO lanza con un archivo que no sabe leer: devuelve una
      imagen vacía. Sin esta comprobación, `getSize()` daría 0 × 0, el destino
      sería `null` y la foto se copiaría entera sin reducir —en silencio—, que
      es la forma más cara de fallar: nadie se entera hasta que el gigabyte de
      Storage está lleno. Se devuelve `null` y quien llama copia el original,
      que es lo mismo que hacía antes de esta fase.
    */
    if (imagen.isEmpty()) {
      return null;
    }

    // `nativeImage` habla en inglés (`width`/`height`) y el dominio en español.
    // La traducción va acá, en el adaptador, que es su lugar.
    const { width, height } = imagen.getSize();
    const destino = dimensionesDestino({ ancho: width, alto: height });
    if (destino === null) {
      return null;
    }

    // `quality: 'best'` es el remuestreo de Chromium, no la compresión: es la
    // diferencia entre una miniatura con bordes dentados y una legible.
    const reducida = imagen.resize({
      width: destino.ancho,
      height: destino.alto,
      quality: 'best',
    });

    return formato === 'png' ? reducida.toPNG() : reducida.toJPEG(CALIDAD_JPEG);
  }
}
