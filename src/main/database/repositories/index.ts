/**
 * Punto de entrada de la capa de acceso a datos.
 *
 * `crearRepositorios(base)` arma de una sola vez todos los repositorios sobre
 * la misma conexión. El servicio de aplicación recibe este objeto y no
 * construye repositorios por su cuenta, para que todos compartan la conexión y
 * por lo tanto la misma transacción cuando la haya.
 */

import type { Database } from 'better-sqlite3';

import { RepositorioDeAuditoria } from './auditoria-log';
import { RepositorioDeBloqueosDeAutorizacion } from './bloqueos-de-autorizacion';
import { RepositorioDeCajaSesiones } from './caja-sesiones';
import { RepositorioDeCategorias } from './categorias';
import { RepositorioDeLimitesDescuento } from './limites-descuento';
import { RepositorioDePreciosEspeciales } from './precios-especiales';
import { RepositorioDeProductos } from './productos';
import { RepositorioDeRecibos } from './recibos';
import { RepositorioDeSyncCola } from './sync-cola';
import { RepositorioDeUsuarios } from './usuarios';
import { RepositorioDeVentaDetalle } from './venta-detalle';
import { RepositorioDeVentas } from './ventas';

export * from './entidades';
export { RepositorioBase, ahora, nuevoId } from './base';
export { RepositorioDeAuditoria } from './auditoria-log';
export {
  RepositorioDeBloqueosDeAutorizacion,
  type BloqueoDeAutorizacion,
  type SuperficieDeAutorizacion,
} from './bloqueos-de-autorizacion';
export { RepositorioDeCajaSesiones } from './caja-sesiones';
export { RepositorioDeCategorias } from './categorias';
export { RepositorioDeLimitesDescuento } from './limites-descuento';
export { RepositorioDePreciosEspeciales } from './precios-especiales';
export { RepositorioDeProductos } from './productos';
export { RepositorioDeRecibos } from './recibos';
export { RepositorioDeSyncCola } from './sync-cola';
export { RepositorioDeUsuarios } from './usuarios';
export { RepositorioDeVentaDetalle } from './venta-detalle';
export { RepositorioDeVentas } from './ventas';

/** Todos los repositorios del sistema, sobre una misma conexión. */
export interface Repositorios {
  readonly usuarios: RepositorioDeUsuarios;
  readonly categorias: RepositorioDeCategorias;
  readonly productos: RepositorioDeProductos;
  readonly preciosEspeciales: RepositorioDePreciosEspeciales;
  readonly limitesDescuento: RepositorioDeLimitesDescuento;
  readonly cajaSesiones: RepositorioDeCajaSesiones;
  readonly ventas: RepositorioDeVentas;
  readonly ventaDetalle: RepositorioDeVentaDetalle;
  readonly recibos: RepositorioDeRecibos;
  readonly auditoria: RepositorioDeAuditoria;
  readonly bloqueosDeAutorizacion: RepositorioDeBloqueosDeAutorizacion;
  readonly syncCola: RepositorioDeSyncCola;
}

/** Construye el conjunto completo de repositorios sobre una conexión. */
export function crearRepositorios(base: Database): Repositorios {
  return {
    usuarios: new RepositorioDeUsuarios(base),
    categorias: new RepositorioDeCategorias(base),
    productos: new RepositorioDeProductos(base),
    preciosEspeciales: new RepositorioDePreciosEspeciales(base),
    limitesDescuento: new RepositorioDeLimitesDescuento(base),
    cajaSesiones: new RepositorioDeCajaSesiones(base),
    ventas: new RepositorioDeVentas(base),
    ventaDetalle: new RepositorioDeVentaDetalle(base),
    recibos: new RepositorioDeRecibos(base),
    auditoria: new RepositorioDeAuditoria(base),
    bloqueosDeAutorizacion: new RepositorioDeBloqueosDeAutorizacion(base),
    syncCola: new RepositorioDeSyncCola(base),
  };
}
