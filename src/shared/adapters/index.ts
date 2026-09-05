/**
 * Fábrica de adaptadores.
 *
 * Este archivo es el ÚNICO lugar donde se decide qué implementación concreta
 * se usa. El dominio pide una interfaz; la configuración decide quién la
 * cumple. Activar la impresora real o Supabase se hace aquí y en el .env,
 * nunca tocando la lógica de negocio.
 */

import { NullPrinterProvider, type ReceiptPrinterProvider } from './receipt-printer';
import { SimulatedSyncProvider, type SyncProvider } from './sync-provider';

export * from './receipt-printer';
export * from './sync-provider';

/** Implementaciones de impresión disponibles. */
export type NombreAdaptadorImpresion = 'nulo' | 'escpos';

/** Implementaciones de sincronización disponibles. */
export type NombreAdaptadorSincronizacion = 'simulado' | 'supabase';

/** Configuración de adaptadores, normalmente derivada de variables de entorno. */
export interface ConfiguracionAdaptadores {
  readonly impresion: NombreAdaptadorImpresion;
  readonly sincronizacion: NombreAdaptadorSincronizacion;
}

/**
 * Valores por defecto SEGUROS: sin impresión física y sin red.
 * Cualquier ejecución que no configure nada explícitamente cae aquí, que es lo
 * que queremos mientras Supabase esté en plan gratuito.
 */
export const CONFIGURACION_ADAPTADORES_POR_DEFECTO: ConfiguracionAdaptadores = {
  impresion: 'nulo',
  sincronizacion: 'simulado',
};

/**
 * Construye el proveedor de impresión indicado.
 *
 * `escpos` todavía no existe: se implementará cuando Jimmy defina el modelo de
 * impresora térmica. Mientras tanto se cae al adaptador nulo con una
 * advertencia, en vez de reventar, porque quedarse sin poder cobrar por una
 * impresora mal configurada sería peor que cobrar sin imprimir.
 */
export function crearReceiptPrinterProvider(
  configuracion: ConfiguracionAdaptadores = CONFIGURACION_ADAPTADORES_POR_DEFECTO,
): ReceiptPrinterProvider {
  switch (configuracion.impresion) {
    case 'nulo':
      return new NullPrinterProvider();
    case 'escpos':
      // TODO(impresion): implementar EscPosPrinterProvider cuando se conozca el
      // modelo de impresora del cliente. Ver docs/INTEGRACIONES.md.
      console.warn(
        '[adaptadores] El adaptador ESC/POS aún no está implementado; se usa NullPrinterProvider.',
      );
      return new NullPrinterProvider();
    default:
      return new NullPrinterProvider();
  }
}

/**
 * Construye el proveedor de sincronización indicado.
 *
 * `supabase` todavía no existe: llega con el módulo de sincronización. Se cae
 * al simulado para que ninguna sesión de desarrollo consuma cuota del plan
 * gratuito por accidente.
 */
export function crearSyncProvider(
  configuracion: ConfiguracionAdaptadores = CONFIGURACION_ADAPTADORES_POR_DEFECTO,
): SyncProvider {
  switch (configuracion.sincronizacion) {
    case 'simulado':
      return new SimulatedSyncProvider();
    case 'supabase':
      // TODO(sincronizacion): implementar SupabaseSyncProvider en el prompt del
      // módulo de sincronización. Ver docs/INTEGRACIONES.md.
      console.warn(
        '[adaptadores] El adaptador de Supabase aún no está implementado; se usa SimulatedSyncProvider.',
      );
      return new SimulatedSyncProvider();
    default:
      return new SimulatedSyncProvider();
  }
}

/**
 * Lee la configuración de adaptadores desde variables de entorno.
 * Cualquier valor desconocido o ausente cae al adaptador seguro.
 */
export function leerConfiguracionAdaptadoresDelEntorno(
  entorno: Readonly<Record<string, string | undefined>>,
): ConfiguracionAdaptadores {
  const impresionSolicitada = entorno.POS_PRINTER_PROVIDER;
  const sincronizacionSolicitada = entorno.POS_SYNC_PROVIDER;

  return {
    impresion: impresionSolicitada === 'escpos' ? 'escpos' : 'nulo',
    sincronizacion: sincronizacionSolicitada === 'supabase' ? 'supabase' : 'simulado',
  };
}
