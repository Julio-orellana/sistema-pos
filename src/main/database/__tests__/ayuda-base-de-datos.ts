/**
 * Utilidades para las pruebas de base de datos.
 *
 * Las pruebas abren bases SQLite REALES en archivos temporales, no simuladas.
 * Es la única forma de comprobar que las restricciones CHECK, las llaves
 * foráneas y los triggers hacen lo que dicen: un doble en memoria no ejecuta
 * las restricciones del esquema, y son justamente ellas las que se prueban.
 *
 * Se usa un archivo y no `:memory:` porque una base en memoria no soporta el
 * modo WAL, y queremos probar la misma configuración que corre en la tienda.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';

import { abrirBaseDeDatosEn, configurarConexion } from '../connection';
import { aplicarMigraciones, type ResultadoMigraciones } from '../migrator';
import DatabaseConstructor from 'better-sqlite3';

/** Base de prueba con su carpeta temporal, para poder limpiarla al terminar. */
export interface BaseDePrueba {
  readonly base: Database;
  readonly ruta: string;
  readonly migraciones: ResultadoMigraciones;
  /** Cierra la conexión y borra la carpeta temporal. */
  readonly limpiar: () => void;
}

/** Crea una carpeta temporal aislada para una prueba. */
function crearCarpetaTemporal(): string {
  return mkdtempSync(join(tmpdir(), 'pos-agricola-prueba-'));
}

/** Abre una base nueva, vacía, con todas las migraciones aplicadas. */
export function crearBaseMigrada(): BaseDePrueba {
  const carpeta = crearCarpetaTemporal();
  const ruta = join(carpeta, 'prueba.db');
  const { base, migraciones } = abrirBaseDeDatosEn(ruta);

  return {
    base,
    ruta,
    migraciones,
    limpiar: (): void => {
      if (base.open) {
        base.close();
      }
      rmSync(carpeta, { recursive: true, force: true });
    },
  };
}

/** Abre una base nueva SIN migrar, para probar el migrador desde cero. */
export function crearBaseVacia(): { base: Database; ruta: string; limpiar: () => void } {
  const carpeta = crearCarpetaTemporal();
  const ruta = join(carpeta, 'vacia.db');
  const base = new DatabaseConstructor(ruta);
  configurarConexion(base);

  return {
    base,
    ruta,
    limpiar: (): void => {
      if (base.open) {
        base.close();
      }
      rmSync(carpeta, { recursive: true, force: true });
    },
  };
}

/** Aplica las migraciones sobre una base ya abierta. */
export function migrar(base: Database): ResultadoMigraciones {
  return aplicarMigraciones(base);
}

/** Fecha ISO fija, para que las pruebas no dependan del reloj. */
export const FECHA_DE_PRUEBA = '2026-09-05T12:00:00.000Z';

/** UUID fijos y válidos, para no depender de la generación aleatoria. */
export const IDS_DE_PRUEBA = {
  usuario: '11111111-1111-4111-8111-111111111111',
  usuarioAdmin: '22222222-2222-4222-8222-222222222222',
  categoria: '33333333-3333-4333-8333-333333333333',
  producto: '44444444-4444-4444-8444-444444444444',
  cajaSesion: '55555555-5555-4555-8555-555555555555',
  venta: '66666666-6666-4666-8666-666666666666',
  detalle: '77777777-7777-4777-8777-777777777777',
  generico: '88888888-8888-4888-8888-888888888888',
} as const;

/** Inserta un usuario mínimo válido y devuelve su id. */
export function sembrarUsuario(base: Database, id: string = IDS_DE_PRUEBA.usuario, rol = 'venta'): string {
  base
    .prepare(
      `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, creado_en, actualizado_en)
       VALUES (?, ?, ?, 'hash-de-prueba', 1, ?, ?)`,
    )
    .run(id, `Usuario ${id.slice(0, 8)}`, rol, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
  return id;
}

/** Inserta una categoría mínima válida y devuelve su id. */
export function sembrarCategoria(base: Database, id: string = IDS_DE_PRUEBA.categoria): string {
  base
    .prepare(
      `INSERT INTO categorias (id, nombre, orden, creado_en, actualizado_en)
       VALUES (?, ?, 0, ?, ?)`,
    )
    .run(id, `Categoria ${id.slice(0, 8)}`, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
  return id;
}

/** Inserta un producto mínimo válido y devuelve su id. */
export function sembrarProducto(
  base: Database,
  id: string = IDS_DE_PRUEBA.producto,
  categoriaId: string = IDS_DE_PRUEBA.categoria,
): string {
  base
    .prepare(
      `INSERT INTO productos (
         id, nombre, categoria_id, tipo_medida, unidad_peso,
         cantidad_predefinida_icono, precio_base, inventario_disponible,
         contador_ventas, activo, creado_en, actualizado_en
       ) VALUES (?, ?, ?, 'peso', 'lb', '1.000', '2.50', '60.000', 0, 1, ?, ?)`,
    )
    .run(id, `Producto ${id.slice(0, 8)}`, categoriaId, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
  return id;
}

/** Abre un turno de caja mínimo válido y devuelve su id. */
export function sembrarCajaSesion(
  base: Database,
  id: string = IDS_DE_PRUEBA.cajaSesion,
  usuarioId: string = IDS_DE_PRUEBA.usuario,
): string {
  base
    .prepare(
      `INSERT INTO caja_sesiones (
         id, usuario_id, monto_inicial, abierta_en, estado, creado_en, actualizado_en
       ) VALUES (?, ?, '500.00', ?, 'abierta', ?, ?)`,
    )
    .run(id, usuarioId, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA, FECHA_DE_PRUEBA);
  return id;
}
