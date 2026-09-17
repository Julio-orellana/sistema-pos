/**
 * Sistema de migraciones del esquema local.
 *
 * Principios:
 *   - Las migraciones son archivos .sql numerados y se aplican en orden.
 *   - Una migración YA APLICADA nunca se edita: se agrega otra. El migrador
 *     guarda el checksum de cada una y se niega a arrancar si el contenido de
 *     una migración aplicada cambió, porque eso significa que la base de la
 *     tienda y el código dejaron de coincidir.
 *   - Es idempotente: correrlo dos veces no falla ni duplica nada.
 *   - Cada migración corre dentro de una transacción. Si falla a la mitad, no
 *     deja el esquema en un estado intermedio.
 */

import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';

import sqlEsquemaInicial from './migrations/001_esquema_inicial.sql?raw';
import sqlBloqueoDeUsuarios from './migrations/002_bloqueo_de_usuarios.sql?raw';
import sqlBloqueosDeAutorizacion from './migrations/003_bloqueos_de_autorizacion.sql?raw';
import sqlDenominaciones from './migrations/004_denominaciones_y_desglose.sql?raw';
import sqlPinRemoto from './migrations/005_pin_remoto.sql?raw';
import sqlSuperficieCierre from './migrations/006_superficie_cierre_con_diferencia.sql?raw';
import sqlAutorizacionDeDiferencia from './migrations/007_autorizacion_de_diferencia.sql?raw';
import sqlAutorizacionSoloConDiferencia from './migrations/008_autorizacion_solo_con_diferencia.sql?raw';
import sqlCategoriasActivo from './migrations/009_categorias_activo.sql?raw';
import sqlUnaCajaPorSistema from './migrations/010_una_caja_por_sistema.sql?raw';
import sqlSuperficieCajaAjena from './migrations/011_superficie_cierre_de_caja_ajena.sql?raw';
import sqlCajaCerradaPor from './migrations/012_caja_cerrada_por.sql?raw';
import sqlSuperficieDescuento from './migrations/013_superficie_descuento_excedente.sql?raw';
import sqlBoletaSoloConTarjeta from './migrations/014_boleta_solo_con_tarjeta.sql?raw';
import sqlCantidadVendida from './migrations/015_cantidad_vendida.sql?raw';
import sqlConfiguracionNegocio from './migrations/016_configuracion_negocio.sql?raw';
import sqlDescuentoAutorizadoVia from './migrations/017_descuento_autorizado_via.sql?raw';
import sqlSyncColaLotes from './migrations/018_sync_cola_lotes.sql?raw';
/*
  Salta de la 018 a la 028 a propósito: los números 019 a 027 los usaron
  migraciones que solo existen del lado de la nube, y el espacio de numeración
  es UNO SOLO para las dos carpetas. Ver `supabase/migrations/README.md`.
*/
import sqlLimitesIdDeterminista from './migrations/028_limites_descuento_id_determinista.sql?raw';
import sqlSaltarLoteDeSincronizacion from './migrations/029_saltar_lote_de_sincronizacion.sql?raw';
import sqlRecibosPdfPathRelativo from './migrations/030_recibos_pdf_path_relativo.sql?raw';
import sqlProductosPrecioCompra from './migrations/031_productos_precio_compra.sql?raw';
import sqlCostoUnitarioSnap from './migrations/032_venta_detalle_costo_unitario_snap.sql?raw';
import sqlAnulacionesDeVenta from './migrations/033_anulaciones_de_venta.sql?raw';
import sqlSuperficieAnulacionDeVenta from './migrations/034_superficie_anulacion_de_venta.sql?raw';
import sqlTotpDeAutorizacionRemota from './migrations/036_totp_de_autorizacion_remota.sql?raw';
import sqlQuitarPinRemotoHash from './migrations/037_quitar_pin_remoto_hash.sql?raw';
import sqlAnulacionSoloPresencial from './migrations/038_anulacion_solo_presencial.sql?raw';

/** Una migración del esquema. */
export interface Migracion {
  /** Número de orden. Determina la secuencia de aplicación. */
  readonly orden: number;
  /** Nombre del archivo sin extensión. Identifica la migración. */
  readonly nombre: string;
  /** Contenido SQL. */
  readonly sql: string;
}

/**
 * Registro explícito de migraciones, en orden.
 *
 * Se declara a mano en vez de descubrir archivos automáticamente para que
 * agregar una migración sea un cambio visible en el historial de git y no algo
 * que aparece por el solo hecho de crear un archivo.
 */
export const MIGRACIONES: readonly Migracion[] = [
  { orden: 1, nombre: '001_esquema_inicial', sql: sqlEsquemaInicial },
  { orden: 2, nombre: '002_bloqueo_de_usuarios', sql: sqlBloqueoDeUsuarios },
  { orden: 3, nombre: '003_bloqueos_de_autorizacion', sql: sqlBloqueosDeAutorizacion },
  { orden: 4, nombre: '004_denominaciones_y_desglose', sql: sqlDenominaciones },
  { orden: 5, nombre: '005_pin_remoto', sql: sqlPinRemoto },
  { orden: 6, nombre: '006_superficie_cierre_con_diferencia', sql: sqlSuperficieCierre },
  { orden: 7, nombre: '007_autorizacion_de_diferencia', sql: sqlAutorizacionDeDiferencia },
  {
    orden: 8,
    nombre: '008_autorizacion_solo_con_diferencia',
    sql: sqlAutorizacionSoloConDiferencia,
  },
  { orden: 9, nombre: '009_categorias_activo', sql: sqlCategoriasActivo },
  { orden: 10, nombre: '010_una_caja_por_sistema', sql: sqlUnaCajaPorSistema },
  {
    orden: 11,
    nombre: '011_superficie_cierre_de_caja_ajena',
    sql: sqlSuperficieCajaAjena,
  },
  { orden: 12, nombre: '012_caja_cerrada_por', sql: sqlCajaCerradaPor },
  {
    orden: 13,
    nombre: '013_superficie_descuento_excedente',
    sql: sqlSuperficieDescuento,
  },
  { orden: 14, nombre: '014_boleta_solo_con_tarjeta', sql: sqlBoletaSoloConTarjeta },
  { orden: 15, nombre: '015_cantidad_vendida', sql: sqlCantidadVendida },
  { orden: 16, nombre: '016_configuracion_negocio', sql: sqlConfiguracionNegocio },
  {
    orden: 17,
    nombre: '017_descuento_autorizado_via',
    sql: sqlDescuentoAutorizadoVia,
  },
  { orden: 18, nombre: '018_sync_cola_lotes', sql: sqlSyncColaLotes },
  {
    orden: 28,
    nombre: '028_limites_descuento_id_determinista',
    sql: sqlLimitesIdDeterminista,
  },
  {
    orden: 29,
    nombre: '029_saltar_lote_de_sincronizacion',
    sql: sqlSaltarLoteDeSincronizacion,
  },
  // Sin espejo en la nube: cambia el VALOR de `recibos.pdf_path` (de absoluta
  // a relativa), no el esquema. El 0030 queda reservado del otro lado.
  {
    orden: 30,
    nombre: '030_recibos_pdf_path_relativo',
    sql: sqlRecibosPdfPathRelativo,
  },
  // Con espejo en la nube (`0031_productos_precio_compra`): es dato de negocio
  // y viaja en el payload de `productos`.
  {
    orden: 31,
    nombre: '031_productos_precio_compra',
    sql: sqlProductosPrecioCompra,
  },
  // Con espejo en la nube (`0032_venta_detalle_costo_unitario_snap`): es parte
  // del detalle de la venta, igual que las demás columnas `*_snap`.
  {
    orden: 32,
    nombre: '032_venta_detalle_costo_unitario_snap',
    sql: sqlCostoUnitarioSnap,
  },
  // Con espejo en la nube, la `0033`, que TODAVÍA NO EXISTE: la sincronización
  // de la anulación es un prompt aparte (docs/ANULACION-DE-VENTA.md §7).
  {
    orden: 33,
    nombre: '033_anulaciones_de_venta',
    sql: sqlAnulacionesDeVenta,
  },
  // Sin espejo: amplía `bloqueos_de_autorizacion`, que no se espeja. El 0034
  // queda reservado del otro lado.
  {
    orden: 34,
    nombre: '034_superficie_anulacion_de_venta',
    sql: sqlSuperficieAnulacionDeVenta,
  },
  // El 035 local queda reservado: el diseño de anulación usa el `0035` en la
  // nube para su función de sincronización.
  //
  // Sin espejo, y NUNCA lo va a tener: el secreto de TOTP no sale de esta
  // terminal. El 0036 queda reservado del otro lado.
  {
    orden: 36,
    nombre: '036_totp_de_autorizacion_remota',
    sql: sqlTotpDeAutorizacionRemota,
  },
  // Sin espejo: en Postgres `pin_remoto_hash` no existe desde la `0021`.
  {
    orden: 37,
    nombre: '037_quitar_pin_remoto_hash',
    sql: sqlQuitarPinRemotoHash,
  },
  // Espejo: `0038_anulacion_solo_presencial`, con el mismo nombre de restricción.
  {
    orden: 38,
    nombre: '038_anulacion_solo_presencial',
    sql: sqlAnulacionSoloPresencial,
  },
];

/** Tabla de control. La crea el propio migrador antes que nada. */
const TABLA_DE_CONTROL = 'migraciones_aplicadas';

/** Fila de la tabla de control. */
interface FilaMigracionAplicada {
  readonly orden: number;
  readonly nombre: string;
  readonly checksum: string;
  readonly aplicada_en: string;
}

/** Informe de lo que hizo el migrador. */
export interface ResultadoMigraciones {
  /** Migraciones que se aplicaron en esta corrida. */
  readonly aplicadasAhora: readonly string[];
  /** Migraciones que ya estaban aplicadas de antes. */
  readonly yaAplicadas: readonly string[];
  /** Cuántas migraciones conoce el sistema en total. */
  readonly totalConocidas: number;
  /** Nombre de la última migración aplicada, o `null` si no hay ninguna. */
  readonly ultimaAplicada: string | null;
}

/** Error de migración, para distinguirlo de un fallo cualquiera de SQLite. */
export class ErrorDeMigracion extends Error {
  public readonly migracion: string;

  public constructor(migracion: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeMigracion';
    this.migracion = migracion;
  }
}

/** Huella del contenido de una migración, para detectar ediciones posteriores. */
export function calcularChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Crea la tabla de control si no existe. */
function asegurarTablaDeControl(base: Database): void {
  base.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLA_DE_CONTROL} (
      orden       INTEGER PRIMARY KEY,
      nombre      TEXT    NOT NULL UNIQUE,
      checksum    TEXT    NOT NULL,
      aplicada_en TEXT    NOT NULL
    );
  `);
}

/** Lee qué migraciones ya se aplicaron, indexadas por nombre. */
function leerAplicadas(base: Database): Map<string, FilaMigracionAplicada> {
  const filas = base
    .prepare(`SELECT orden, nombre, checksum, aplicada_en FROM ${TABLA_DE_CONTROL} ORDER BY orden`)
    .all() as FilaMigracionAplicada[];

  return new Map(filas.map((fila) => [fila.nombre, fila]));
}

/**
 * Aplica todas las migraciones pendientes.
 *
 * Se puede llamar en cada arranque: si no hay nada pendiente, no hace nada.
 */
export function aplicarMigraciones(
  base: Database,
  migraciones: readonly Migracion[] = MIGRACIONES,
): ResultadoMigraciones {
  asegurarTablaDeControl(base);

  const aplicadas = leerAplicadas(base);
  const aplicadasAhora: string[] = [];
  const yaAplicadas: string[] = [];

  const enOrden = [...migraciones].sort((a, b) => a.orden - b.orden);

  for (const migracion of enOrden) {
    const checksum = calcularChecksum(migracion.sql);
    const registro = aplicadas.get(migracion.nombre);

    if (registro !== undefined) {
      if (registro.checksum !== checksum) {
        throw new ErrorDeMigracion(
          migracion.nombre,
          `La migración "${migracion.nombre}" ya se aplicó en esta base pero su contenido cambió desde entonces. ` +
            'Una migración aplicada no se edita: hay que agregar una migración nueva que haga el cambio.',
        );
      }
      yaAplicadas.push(migracion.nombre);
      continue;
    }

    const aplicarUna = base.transaction((): void => {
      base.exec(migracion.sql);
      base
        .prepare(
          `INSERT INTO ${TABLA_DE_CONTROL} (orden, nombre, checksum, aplicada_en) VALUES (?, ?, ?, ?)`,
        )
        .run(migracion.orden, migracion.nombre, checksum, new Date().toISOString());
    });

    try {
      aplicarUna();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      throw new ErrorDeMigracion(
        migracion.nombre,
        `Falló la migración "${migracion.nombre}" y se revirtió por completo: ${detalle}`,
      );
    }

    aplicadasAhora.push(migracion.nombre);
  }

  const todas = [...yaAplicadas, ...aplicadasAhora];

  return {
    aplicadasAhora,
    yaAplicadas,
    totalConocidas: enOrden.length,
    ultimaAplicada: todas.length === 0 ? null : (enOrden[enOrden.length - 1]?.nombre ?? null),
  };
}

/** Cuántas migraciones tiene registradas la base. */
export function contarMigracionesAplicadas(base: Database): number {
  asegurarTablaDeControl(base);
  const fila = base.prepare(`SELECT COUNT(*) AS total FROM ${TABLA_DE_CONTROL}`).get() as {
    readonly total: number;
  };
  return fila.total;
}

/** Nombre de la última migración aplicada, o `null` si la base está virgen. */
export function obtenerUltimaMigracion(base: Database): string | null {
  asegurarTablaDeControl(base);
  const fila = base
    .prepare(`SELECT nombre FROM ${TABLA_DE_CONTROL} ORDER BY orden DESC LIMIT 1`)
    .get() as { readonly nombre: string } | undefined;
  return fila?.nombre ?? null;
}
