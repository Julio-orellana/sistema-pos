/**
 * Guion de UNA SOLA VEZ: reduce las fotos que se guardaron antes de la fase 3.c.
 *
 * ===========================================================================
 * POR QUÉ ES UN GUION Y NO UNA MIGRACIÓN
 * ===========================================================================
 *
 * Una migración es historial permanente del esquema, se aplica una vez y no se
 * deshace, y **esto no toca el esquema**: cambia bytes de archivos en el disco
 * de una terminal. Es el mismo criterio por el que los datos de ejemplo no son
 * una migración (§4.11). Además una migración corre dentro de una transacción
 * de SQLite, y reducir 200 imágenes con Chromium adentro de una transacción
 * abierta es exactamente lo que §4.14 rechaza para el PDF y la impresión.
 *
 * ===========================================================================
 * TAMBIÉN ENCOLA, Y ESO NO ES UN AGREGADO GRATUITO
 * ===========================================================================
 *
 * Sin esto, **las fotos que ya existían no se subirían nunca**: solo se encola
 * una foto al crearla o al cambiarla (`servicio-de-productos.ts`), así que un
 * catálogo cargado antes de esta fase quedaría sin respaldo y nadie se
 * enteraría hasta el día que hiciera falta restaurarlo. Es justo la clase de
 * hueco silencioso que este proyecto trata como el peor de los errores.
 *
 * **No encola dos veces.** Si ya hay una entrada en `sync_cola` para esa ruta
 * —pendiente o ya subida— se la saltea. Correr el guion dos veces no duplica
 * nada, y eso importa porque un guion que hay que correr «exactamente una vez»
 * es un guion que alguien va a correr dos.
 *
 * ===========================================================================
 * EL ORDEN IMPORTA: PRIMERO REDUCIR, DESPUÉS ENCOLAR
 * ===========================================================================
 *
 * Al revés se subirían los bytes grandes y el `sha256` del payload sería el del
 * archivo viejo. Y como una foto en Storage es INMUTABLE —se sube sin
 * `x-upsert` y la terminal no tiene permiso de `UPDATE` (§2.5.2)— esos bytes
 * grandes se quedarían allá para siempre, que es exactamente el gasto que la
 * reducción viene a evitar.
 */

import { statSync, writeFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';

import { encolarFoto } from '@main/database/bandeja-de-salida';
import { enTransaccionDeNegocio } from '@main/database/transaccion-en-curso';
import type { AlmacenDeFotos } from './almacen-de-fotos';
import type { RedimensionadorDeImagen } from './redimensionar';

/** Qué hizo el guion, para poder imprimirlo y compararlo. */
export interface ResultadoDeReduccion {
  readonly productosConFoto: number;
  readonly reducidas: number;
  /** Ya cabían en 800 px: se dejaron intactas. */
  readonly yaEstabanBien: number;
  /** La fila dice que hay foto y el archivo no está. */
  readonly ausentes: number;
  readonly encoladas: number;
  readonly bytesAntes: number;
  readonly bytesDespues: number;
  /** Una línea por foto, para el informe. */
  readonly detalle: readonly string[];
}

/** Una foto del catálogo, tal como la ve este guion. */
interface FilaConFoto {
  readonly id: string;
  readonly nombre: string;
  readonly foto_path: string;
}

export function reducirFotosExistentes(
  base: Database,
  almacen: AlmacenDeFotos,
  redimensionador: RedimensionadorDeImagen,
): ResultadoDeReduccion {
  const filas = base
    .prepare(
      `SELECT id, nombre, foto_path FROM productos
        WHERE foto_path IS NOT NULL AND trim(foto_path) <> ''
        ORDER BY nombre`,
    )
    .all() as FilaConFoto[];

  const detalle: string[] = [];
  let reducidas = 0;
  let yaEstabanBien = 0;
  let ausentes = 0;
  let encoladas = 0;
  let bytesAntes = 0;
  let bytesDespues = 0;

  const yaEncolada = base.prepare(
    'SELECT 1 FROM sync_cola WHERE entidad_tipo LIKE ? AND entidad_id = ? LIMIT 1',
  );

  for (const fila of filas) {
    let absoluta: string;
    try {
      absoluta = almacen.rutaAbsolutaDe(fila.foto_path);
    } catch {
      // Una ruta que no cae dentro de la carpeta de fotos. No se toca nada: es
      // un dato corrupto y arreglarlo a ciegas sería peor.
      ausentes += 1;
      detalle.push(`RUTA INVÁLIDA  ${fila.nombre}: ${fila.foto_path}`);
      continue;
    }

    let tamanoAntes: number;
    try {
      tamanoAntes = statSync(absoluta).size;
    } catch {
      ausentes += 1;
      detalle.push(`AUSENTE        ${fila.nombre}: ${fila.foto_path}`);
      continue;
    }
    bytesAntes += tamanoAntes;

    const formato = fila.foto_path.toLocaleLowerCase('en').endsWith('.png') ? 'png' : 'jpeg';
    const reducida = redimensionador.reducir(absoluta, formato);

    if (reducida === null) {
      yaEstabanBien += 1;
      bytesDespues += tamanoAntes;
      detalle.push(`YA CABÍA       ${fila.nombre}: ${String(tamanoAntes)} bytes`);
    } else {
      writeFileSync(absoluta, reducida);
      reducidas += 1;
      bytesDespues += reducida.byteLength;
      detalle.push(
        `REDUCIDA       ${fila.nombre}: ${String(tamanoAntes)} -> ${String(reducida.byteLength)} bytes`,
      );
    }

    // Recién ahora, con los bytes definitivos en el disco, se encola.
    const existe = yaEncolada.get('archivo_%', fila.foto_path) !== undefined;
    if (!existe) {
      const archivo = almacen.describirParaSubir(fila.foto_path);
      if (archivo !== null) {
        enTransaccionDeNegocio(base, () => encolarFoto(base, archivo));
        encoladas += 1;
      }
    }
  }

  return {
    productosConFoto: filas.length,
    reducidas,
    yaEstabanBien,
    ausentes,
    encoladas,
    bytesAntes,
    bytesDespues,
    detalle,
  };
}
