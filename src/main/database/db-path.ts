/**
 * Ubicación del archivo de base de datos en la máquina del cliente.
 *
 * Está separado de connection.ts a propósito: este módulo importa Electron y
 * connection.ts no. Así las pruebas pueden abrir bases de datos reales sin
 * arrancar Electron.
 */

import { join } from 'node:path';
import { app } from 'electron';

/** Nombre del archivo SQLite dentro de la carpeta de datos del usuario. */
const NOMBRE_ARCHIVO_BASE_DE_DATOS = 'pos-agricola.db';

/**
 * Ruta del archivo de base de datos.
 *
 * Vive en `userData` (Application Support en macOS, AppData en Windows) para
 * que sobreviva a las actualizaciones de la aplicación y no se pierda al
 * reinstalar: ahí están las ventas de la tienda.
 */
export function obtenerRutaBaseDeDatos(): string {
  return join(app.getPath('userData'), NOMBRE_ARCHIVO_BASE_DE_DATOS);
}
