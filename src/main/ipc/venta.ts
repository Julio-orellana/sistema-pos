/**
 * Manejador IPC de la pantalla de venta.
 *
 * SOLO LECTURA. Este canal arma lo que la pantalla necesita para dibujarse y
 * nada más: no registra ventas, no descuenta inventario y no toca la caja. El
 * registro de la venta llega en su propio módulo, con su propia transacción.
 *
 * ES UN CANAL APARTE DE LOS DEL CATÁLOGO, y la razón importa: los de catálogo
 * exigen rol administrativo porque sirven para editar el catálogo, y vender lo
 * hace un cajero. Este exige solo que haya sesión, y a cambio devuelve
 * únicamente productos ACTIVOS y ningún dato de administración.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  type CategoriaDeVenta,
  type EstadoDeVenta,
  type ProductoParaVender,
  type RespuestaIpc,
  type TurnoAbierto,
} from '@shared/types/ipc';
import { cantidadACadena, montoACadena } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { requiereSesion, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import type { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import type { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import { urlDeFoto } from '@main/domain/catalogo/almacen-de-fotos';
import { ejecutarConRespuesta } from './respuesta';

/** Dependencias que necesita el manejador de venta. */
export interface DependenciasDeVenta {
  readonly sesion: SesionActual;
  readonly caja: ServicioDeCaja;
  readonly categorias: ServicioDeCategorias;
  readonly productos: ServicioDeProductos;
  readonly usuarios: RepositorioDeUsuarios;
}

/** Registra el canal de la pantalla de venta. */
export function registrarManejadoresDeVenta(dependencias: DependenciasDeVenta): void {
  const { sesion, caja, categorias, productos, usuarios } = dependencias;

  ipcMain.handle(
    CANALES_IPC.ventaEstado,
    async (): Promise<RespuestaIpc<EstadoDeVenta>> =>
      ejecutarConRespuesta('ESTADO_DE_VENTA_FALLIDO', () =>
        requiereSesion(sesion, () => {
          const enSesion = sesion.obtener();
          if (enSesion === null) {
            throw new ErrorDeNegocio(
              'PERMISO_DENEGADO',
              'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
              'Se llegó al canal de venta sin sesión.',
            );
          }

          const estado = caja.estadoParaVender(enSesion.id);

          /** El turno del sistema, con quién lo abrió ya resuelto. */
          const turnoAbierto: TurnoAbierto | null = estado.puede
            ? {
                id: estado.turno.id,
                montoInicial: montoACadena(estado.turno.montoInicial),
                abiertaEn: estado.turno.abiertaEn,
                abiertaPorId: estado.turno.usuarioId,
                abiertaPorNombre: enSesion.nombre,
                esDeOtroUsuario: false,
              }
            : estado.motivo === 'CAJA_DE_OTRO_USUARIO'
              ? {
                  id: estado.turno.id,
                  montoInicial: montoACadena(estado.turno.montoInicial),
                  abiertaEn: estado.turno.abiertaEn,
                  abiertaPorId: estado.turno.usuarioId,
                  abiertaPorNombre:
                    usuarios.obtenerPorId(estado.turno.usuarioId)?.nombre ??
                    '(usuario eliminado)',
                  esDeOtroUsuario: true,
                }
              : null;

          // Sin caja propia no se manda catálogo. No es solo ahorro: la
          // pantalla no debe poder dibujar la cuadrícula "por si acaso" ni
          // dejar productos a la vista de un turno que no es de quien mira.
          if (!estado.puede) {
            const bloqueado: EstadoDeVenta = {
              puedeVender: false,
              motivo: estado.motivo,
              turnoAbierto,
              categorias: [],
              productos: [],
            };
            return bloqueado;
          }

          const activos = productos.listarParaVenta();
          const nombresDeCategorias = new Map(
            categorias.listarTodas().map((categoria) => [categoria.id, categoria.nombre]),
          );

          /** Cuántos productos activos tiene cada categoría, ya contados. */
          const productosPorCategoria = new Map<string, number>();
          for (const producto of activos) {
            productosPorCategoria.set(
              producto.categoriaId,
              (productosPorCategoria.get(producto.categoriaId) ?? 0) + 1,
            );
          }

          // Solo se ofrecen las categorías ACTIVAS que además tienen algo que
          // vender: una pestaña vacía es un toque que no lleva a ninguna parte.
          const paraLaBarra: CategoriaDeVenta[] = categorias
            .listarActivas()
            .filter((categoria) => (productosPorCategoria.get(categoria.id) ?? 0) > 0)
            .map((categoria) => ({
              id: categoria.id,
              nombre: categoria.nombre,
              productos: productosPorCategoria.get(categoria.id) ?? 0,
            }));

          const paraLaCuadricula: ProductoParaVender[] = activos.map((producto) => ({
            id: producto.id,
            nombre: producto.nombre,
            categoriaId: producto.categoriaId,
            categoriaNombre:
              nombresDeCategorias.get(producto.categoriaId) ?? '(categoría desconocida)',
            tipoMedida: producto.tipoMedida,
            unidadPeso: producto.unidadPeso,
            cantidadPredefinidaIcono: cantidadACadena(producto.cantidadPredefinidaIcono),
            precioBase: montoACadena(producto.precioBase),
            inventarioDisponible: cantidadACadena(producto.inventarioDisponible),
            fotoUrl: producto.fotoPath === null ? null : urlDeFoto(producto.fotoPath),
            contadorVentas: producto.contadorVentas,
          }));

          const listo: EstadoDeVenta = {
            puedeVender: true,
            motivo: null,
            turnoAbierto,
            categorias: paraLaBarra,
            productos: paraLaCuadricula,
          };
          return listo;
        }),
      ),
  );
}
