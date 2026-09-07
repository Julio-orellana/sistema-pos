/**
 * Manejadores IPC del catálogo: categorías y productos.
 *
 * TODOS exigen rol administrativo, y lo hace cumplir `requiereRol` en el
 * proceso principal. Que la interfaz esconda los botones es comodidad, no
 * control: un renderer comprometido invoca el canal igual, y ahí es donde el
 * guard tiene que estar.
 *
 * Aquí NO hay reglas de negocio. La coherencia entre tipo de medida y unidad,
 * los topes de los importes y la prohibición de bajar inventario viven en los
 * servicios de dominio, no en la frontera: una regla escrita en la frontera se
 * saltaría llamando al servicio desde otro lugar.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaAjusteDeInventario,
  esquemaCategoriaEditada,
  esquemaCategoriaNueva,
  esquemaFijarActivo,
  esquemaProductoEditado,
  esquemaProductoNuevo,
  type CategoriaIpc,
  type FotoElegidaIpc,
  type ProductoIpc,
  type RespuestaIpc,
  type ResultadoDeAjusteIpc,
} from '@shared/types/ipc';
import { cantidadACadena, montoACadena } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import type { Categoria, Producto } from '@main/database/repositories/entidades';
import { requiereRol, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import type { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import {
  EXTENSIONES_DE_IMAGEN,
  urlDeFoto,
  type AlmacenDeFotos,
} from '@main/domain/catalogo/almacen-de-fotos';
import { ejecutarConRespuesta } from './respuesta';

/** Dependencias que necesitan los manejadores del catálogo. */
export interface DependenciasDeCatalogo {
  readonly sesion: SesionActual;
  readonly categorias: ServicioDeCategorias;
  readonly productos: ServicioDeProductos;
  readonly fotos: AlmacenDeFotos;
}

/** Id del usuario en sesión, o falla. El guard ya comprobó que hay uno. */
function usuarioEnSesion(sesion: SesionActual): string {
  const enSesion = sesion.obtener();
  if (enSesion === null) {
    throw new ErrorDeNegocio(
      'PERMISO_DENEGADO',
      'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
      'Se llegó a un manejador de catálogo sin sesión.',
    );
  }
  return enSesion.id;
}

/** Convierte una categoría del dominio al DTO que ve la pantalla. */
function aCategoriaIpc(
  categoria: Categoria,
  servicio: ServicioDeCategorias,
): CategoriaIpc {
  return {
    id: categoria.id,
    nombre: categoria.nombre,
    orden: categoria.orden,
    activo: categoria.activo,
    productosAsociados: servicio.contarProductos(categoria.id),
  };
}

/**
 * Convierte un producto del dominio al DTO que ve la pantalla.
 *
 * Los decimales salen como CADENA canónica, nunca como `number`: un `number`
 * en un precio es exactamente lo que money.ts existe para evitar, y perdería
 * dígitos al cruzar el puente.
 */
function aProductoIpc(producto: Producto, nombreDeCategoria: string): ProductoIpc {
  return {
    id: producto.id,
    nombre: producto.nombre,
    categoriaId: producto.categoriaId,
    categoriaNombre: nombreDeCategoria,
    tipoMedida: producto.tipoMedida,
    unidadPeso: producto.unidadPeso,
    cantidadPredefinidaIcono: cantidadACadena(producto.cantidadPredefinidaIcono),
    precioBase: montoACadena(producto.precioBase),
    inventarioDisponible: cantidadACadena(producto.inventarioDisponible),
    fotoPath: producto.fotoPath,
    fotoUrl: producto.fotoPath === null ? null : urlDeFoto(producto.fotoPath),
    activo: producto.activo,
    contadorVentas: producto.contadorVentas,
  };
}

/** Registra los canales del catálogo. */
export function registrarManejadoresDeCatalogo(dependencias: DependenciasDeCatalogo): void {
  const { sesion, categorias, productos, fotos } = dependencias;

  /** Nombre de cada categoría por id, para resolverlo sin consultar N veces. */
  const nombresDeCategorias = (): Map<string, string> =>
    new Map(categorias.listarTodas().map((categoria) => [categoria.id, categoria.nombre]));

  /** Vuelve a leer un producto y lo convierte, con su categoría resuelta. */
  const productoConCategoria = (producto: Producto): ProductoIpc =>
    aProductoIpc(
      producto,
      nombresDeCategorias().get(producto.categoriaId) ?? '(categoría desconocida)',
    );

  // -------------------------------------------------------------------------
  // Categorías
  // -------------------------------------------------------------------------

  ipcMain.handle(
    CANALES_IPC.categoriasListar,
    async (): Promise<RespuestaIpc<readonly CategoriaIpc[]>> =>
      ejecutarConRespuesta('CATEGORIAS_LISTADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () =>
          categorias.listarTodas().map((categoria) => aCategoriaIpc(categoria, categorias)),
        ),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.categoriasCrear,
    async (_evento, payload: unknown): Promise<RespuestaIpc<CategoriaIpc>> =>
      ejecutarConRespuesta('CATEGORIA_CREACION_FALLIDA', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaCategoriaNueva.parse(payload);
          const creada = categorias.crear(usuarioEnSesion(sesion), datos);
          return aCategoriaIpc(creada, categorias);
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.categoriasEditar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<CategoriaIpc>> =>
      ejecutarConRespuesta('CATEGORIA_EDICION_FALLIDA', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaCategoriaEditada.parse(payload);
          const editada = categorias.editar(usuarioEnSesion(sesion), datos.id, {
            nombre: datos.nombre,
            orden: datos.orden,
          });
          return aCategoriaIpc(editada, categorias);
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.categoriasFijarActivo,
    async (_evento, payload: unknown): Promise<RespuestaIpc<CategoriaIpc>> =>
      ejecutarConRespuesta('CATEGORIA_CAMBIO_DE_ESTADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaFijarActivo.parse(payload);
          const actualizada = categorias.fijarActivo(
            usuarioEnSesion(sesion),
            datos.id,
            datos.activo,
          );
          return aCategoriaIpc(actualizada, categorias);
        }),
      ),
  );

  // -------------------------------------------------------------------------
  // Productos
  // -------------------------------------------------------------------------

  ipcMain.handle(
    CANALES_IPC.productosListar,
    async (): Promise<RespuestaIpc<readonly ProductoIpc[]>> =>
      ejecutarConRespuesta('PRODUCTOS_LISTADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const nombres = nombresDeCategorias();
          return productos
            .listarTodos()
            .map((producto) =>
              aProductoIpc(
                producto,
                nombres.get(producto.categoriaId) ?? '(categoría desconocida)',
              ),
            );
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.productosCrear,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProductoIpc>> =>
      ejecutarConRespuesta('PRODUCTO_CREACION_FALLIDA', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaProductoNuevo.parse(payload);
          return productoConCategoria(productos.crear(usuarioEnSesion(sesion), datos));
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.productosEditar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProductoIpc>> =>
      ejecutarConRespuesta('PRODUCTO_EDICION_FALLIDA', () =>
        requiereRol(sesion, 'administrativo', () => {
          const { id, ...cambios } = esquemaProductoEditado.parse(payload);
          return productoConCategoria(productos.editar(usuarioEnSesion(sesion), id, cambios));
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.productosFijarActivo,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProductoIpc>> =>
      ejecutarConRespuesta('PRODUCTO_CAMBIO_DE_ESTADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaFijarActivo.parse(payload);
          return productoConCategoria(
            productos.fijarActivo(usuarioEnSesion(sesion), datos.id, datos.activo),
          );
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.productosAjustarInventario,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResultadoDeAjusteIpc>> =>
      ejecutarConRespuesta('AJUSTE_DE_INVENTARIO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaAjusteDeInventario.parse(payload);
          const resultado = productos.ajustarInventario(usuarioEnSesion(sesion), datos);
          const respuesta: ResultadoDeAjusteIpc = {
            producto: productoConCategoria(resultado.producto),
            cantidadAnterior: resultado.cantidadAnterior,
            cantidadAgregada: resultado.cantidadAgregada,
            cantidadNueva: resultado.cantidadNueva,
          };
          return respuesta;
        }),
      ),
  );

  // -------------------------------------------------------------------------
  // Foto del producto
  // -------------------------------------------------------------------------

  ipcMain.handle(
    CANALES_IPC.productosElegirFoto,
    async (evento): Promise<RespuestaIpc<FotoElegidaIpc>> =>
      ejecutarConRespuesta('SELECCION_DE_FOTO_FALLIDA', async () =>
        requiereRol(sesion, 'administrativo', async () => {
          const ventana = BrowserWindow.fromWebContents(evento.sender);
          if (ventana === null) {
            throw new Error('No se pudo identificar la ventana que pidió elegir la foto.');
          }

          const seleccion = await dialog.showOpenDialog(ventana, {
            title: 'Elegí la foto del producto',
            properties: ['openFile'],
            filters: [{ name: 'Imágenes', extensions: [...EXTENSIONES_DE_IMAGEN] }],
          });

          const [rutaElegida] = seleccion.filePaths;
          if (seleccion.canceled || rutaElegida === undefined) {
            const cancelada: FotoElegidaIpc = { elegida: false, fotoPath: null, fotoUrl: null };
            return cancelada;
          }

          // El filtro del diálogo es una comodidad, no un control: en varios
          // sistemas se puede escribir el nombre de un archivo que no cumple.
          // La validación de verdad —extensión, tamaño y firma binaria— la
          // hace el almacén.
          const fotoPath = fotos.guardar(rutaElegida);
          const elegida: FotoElegidaIpc = {
            elegida: true,
            fotoPath,
            fotoUrl: urlDeFoto(fotoPath),
          };
          return elegida;
        }),
      ),
  );
}
