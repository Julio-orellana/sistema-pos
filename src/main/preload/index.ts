/**
 * Preload: el único puente entre el renderer y el proceso principal.
 *
 * Expone en `window.pos` una API tipada y cerrada. El renderer no recibe
 * `ipcRenderer`, ni `require`, ni acceso al sistema de archivos: si mañana un
 * componente de React quisiera leer la base de datos directamente, no tendría
 * con qué hacerlo. Eso es intencional.
 */

import { contextBridge, ipcRenderer } from 'electron';

import {
  CANALES_IPC,
  type ApiPos,
  type CategoriaIpc,
  type DiagnosticoAplicacion,
  type DiagnosticoBaseDeDatos,
  type EfectivoDeclaradoIpc,
  type EstadoDeCaja,
  type EstadoDeSesion,
  type EstadoDeVenta,
  type FotoElegidaIpc,
  type ProductoEditadoIpc,
  type ProductoIpc,
  type ProductoNuevoIpc,
  type RespuestaIpc,
  type ResultadoDeAjusteIpc,
  type ResultadoDeCierreIpc,
  type TurnoAbierto,
  type ResultadoDeIngreso,
  type ResultadoIntentoDeSalida,
  type SesionIniciada,
  type SolicitudDiagnostico,
  type UsuarioParaIngreso,
} from '@shared/types/ipc';
import { instalarBloqueosDeKioskoEnDom } from './kiosk-dom-guards';

/** Implementación concreta de la API que ve React. */
const apiPos: ApiPos = {
  diagnostico: {
    baseDeDatos: (
      solicitud: Partial<SolicitudDiagnostico> = {},
    ): Promise<RespuestaIpc<DiagnosticoBaseDeDatos>> =>
      ipcRenderer.invoke(CANALES_IPC.diagnosticoBaseDeDatos, solicitud) as Promise<
        RespuestaIpc<DiagnosticoBaseDeDatos>
      >,

    aplicacion: (): Promise<RespuestaIpc<DiagnosticoAplicacion>> =>
      ipcRenderer.invoke(CANALES_IPC.diagnosticoAplicacion) as Promise<
        RespuestaIpc<DiagnosticoAplicacion>
      >,
  },

  sesion: {
    estado: (): Promise<RespuestaIpc<EstadoDeSesion>> =>
      ipcRenderer.invoke(CANALES_IPC.estadoDeSesion) as Promise<RespuestaIpc<EstadoDeSesion>>,

    listarUsuarios: (): Promise<RespuestaIpc<readonly UsuarioParaIngreso[]>> =>
      ipcRenderer.invoke(CANALES_IPC.listarUsuariosParaIngreso) as Promise<
        RespuestaIpc<readonly UsuarioParaIngreso[]>
      >,

    iniciar: (usuarioId: string, pin: string): Promise<RespuestaIpc<ResultadoDeIngreso>> =>
      ipcRenderer.invoke(CANALES_IPC.iniciarSesion, { usuarioId, pin }) as Promise<
        RespuestaIpc<ResultadoDeIngreso>
      >,

    cerrar: (): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.cerrarSesion) as Promise<RespuestaIpc<boolean>>,

    crearPrimerAdministrador: (
      nombre: string,
      pin: string,
    ): Promise<RespuestaIpc<SesionIniciada>> =>
      ipcRenderer.invoke(CANALES_IPC.crearPrimerAdministrador, { nombre, pin }) as Promise<
        RespuestaIpc<SesionIniciada>
      >,

    configurarPinRemoto: (pin: string): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.configurarPinRemoto, { pin }) as Promise<
        RespuestaIpc<boolean>
      >,
  },

  caja: {
    estado: (): Promise<RespuestaIpc<EstadoDeCaja>> =>
      ipcRenderer.invoke(CANALES_IPC.estadoDeCaja) as Promise<RespuestaIpc<EstadoDeCaja>>,

    abrir: (efectivo: EfectivoDeclaradoIpc): Promise<RespuestaIpc<TurnoAbierto>> =>
      ipcRenderer.invoke(CANALES_IPC.abrirCaja, { efectivo }) as Promise<
        RespuestaIpc<TurnoAbierto>
      >,

    cerrar: (
      efectivo: EfectivoDeclaradoIpc,
      pin?: string,
      pinCajaAjena?: string,
    ): Promise<RespuestaIpc<ResultadoDeCierreIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.cerrarCaja, { efectivo, pin, pinCajaAjena }) as Promise<
        RespuestaIpc<ResultadoDeCierreIpc>
      >,
  },

  catalogo: {
    listarCategorias: (): Promise<RespuestaIpc<readonly CategoriaIpc[]>> =>
      ipcRenderer.invoke(CANALES_IPC.categoriasListar) as Promise<
        RespuestaIpc<readonly CategoriaIpc[]>
      >,

    crearCategoria: (nombre: string, orden: number): Promise<RespuestaIpc<CategoriaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.categoriasCrear, { nombre, orden }) as Promise<
        RespuestaIpc<CategoriaIpc>
      >,

    editarCategoria: (
      id: string,
      nombre: string,
      orden: number,
    ): Promise<RespuestaIpc<CategoriaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.categoriasEditar, { id, nombre, orden }) as Promise<
        RespuestaIpc<CategoriaIpc>
      >,

    fijarActivoCategoria: (id: string, activo: boolean): Promise<RespuestaIpc<CategoriaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.categoriasFijarActivo, { id, activo }) as Promise<
        RespuestaIpc<CategoriaIpc>
      >,

    listarProductos: (): Promise<RespuestaIpc<readonly ProductoIpc[]>> =>
      ipcRenderer.invoke(CANALES_IPC.productosListar) as Promise<
        RespuestaIpc<readonly ProductoIpc[]>
      >,

    crearProducto: (datos: ProductoNuevoIpc): Promise<RespuestaIpc<ProductoIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.productosCrear, datos) as Promise<RespuestaIpc<ProductoIpc>>,

    editarProducto: (datos: ProductoEditadoIpc): Promise<RespuestaIpc<ProductoIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.productosEditar, datos) as Promise<RespuestaIpc<ProductoIpc>>,

    fijarActivoProducto: (id: string, activo: boolean): Promise<RespuestaIpc<ProductoIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.productosFijarActivo, { id, activo }) as Promise<
        RespuestaIpc<ProductoIpc>
      >,

    ajustarInventario: (
      productoId: string,
      cantidad: string,
      motivo: string | null,
    ): Promise<RespuestaIpc<ResultadoDeAjusteIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.productosAjustarInventario, {
        productoId,
        cantidad,
        motivo,
      }) as Promise<RespuestaIpc<ResultadoDeAjusteIpc>>,

    elegirFoto: (): Promise<RespuestaIpc<FotoElegidaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.productosElegirFoto) as Promise<
        RespuestaIpc<FotoElegidaIpc>
      >,
  },

  venta: {
    estado: (): Promise<RespuestaIpc<EstadoDeVenta>> =>
      ipcRenderer.invoke(CANALES_IPC.ventaEstado) as Promise<RespuestaIpc<EstadoDeVenta>>,
  },

  kiosko: {
    /**
     * El proceso principal avisa que se presionó el atajo del administrador.
     * Se entrega un callback sin datos a propósito: el renderer solo necesita
     * saber que hay que pedir el PIN, nada más.
     */
    alSolicitarSalida: (alRecibir: () => void): (() => void) => {
      const manejador = (): void => {
        alRecibir();
      };
      ipcRenderer.on(CANALES_IPC.solicitudDeSalidaControlada, manejador);
      return (): void => {
        ipcRenderer.removeListener(CANALES_IPC.solicitudDeSalidaControlada, manejador);
      };
    },

    solicitarSalida: (): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.solicitarSalidaControlada) as Promise<RespuestaIpc<boolean>>,

    confirmarSalida: (pin: string): Promise<RespuestaIpc<ResultadoIntentoDeSalida>> =>
      ipcRenderer.invoke(CANALES_IPC.confirmarSalidaControlada, { pin }) as Promise<
        RespuestaIpc<ResultadoIntentoDeSalida>
      >,
  },
};

contextBridge.exposeInMainWorld('pos', apiPos);

// Refuerzo del modo kiosko del lado del DOM. Las reglas y su prueba están en
// ./kiosk-dom-guards.ts, que se verifica con un navegador simulado.
instalarBloqueosDeKioskoEnDom(window);
