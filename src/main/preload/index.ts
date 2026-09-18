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
  type PedidoDeCobro,
  type InscripcionRemotaIpc,
  type PedidoDeAnulacionIpc,
  type ResultadoDeAnulacionIpc,
  type ResultadoDeCobro,
  type ConfiguracionDeNegocioIpc,
  type FiltroDeFormaPagoIpc,
  type HistorialDeRecibosIpc,
  type ReciboVistoIpc,
  type PeriodoIpc,
  type ResumenDeVentasIpc,
  type ReporteDeVentasPorProductoIpc,
  type ReporteDeInventarioIpc,
  type LimiteDeDescuentoIpc,
  type ConexionDeNubeIpc,
  type DetalleDeSesionDeCajaIpc,
  type FiltroDeHistorialDeCajasIpc,
  type HistorialDeCajasIpc,
  type ConfirmacionDePruebaIpc,
  type ConfirmacionDePruebaRegistradaIpc,
  type EstadoDeImpresoraIpc,
  type ImpresoraDelSistemaIpc,
  type ResultadoDePruebaDeImpresoraIpc,
  type DetalleDeSincronizacionIpc,
  type EstadoDeNubeIpc,
  type LoteIdIpc,
  type ResultadoDeSaltoDeLoteIpc,
  type ResumenDeConexionIpc,
  type ResumenDeSincronizacionIpc,
  type SaltoDeLoteIpc,
  type CambioDeLimiteIpc,
  type FilaExcluidaIpc,
  type InicioDeRestauracionIpc,
  type PinDeRestauracionIpc,
  type ProgresoDeRestauracionIpc,
  type RetomaDeRestauracionIpc,
  type RevisionDeUsuarioIpc,
  type UsuarioEditadoIpc,
  type UsuarioIpc,
  type UsuarioNuevoIpc,
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

    iniciarAutorizacionRemota: (): Promise<RespuestaIpc<InscripcionRemotaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.iniciarAutorizacionRemota) as Promise<RespuestaIpc<InscripcionRemotaIpc>>,
    confirmarAutorizacionRemota: (codigo: string): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.confirmarAutorizacionRemota, { codigo }) as Promise<RespuestaIpc<boolean>>,
    cancelarAutorizacionRemota: (): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.cancelarAutorizacionRemota) as Promise<RespuestaIpc<boolean>>,
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

    /** Segundo paso: confirma el cierre que un PIN correcto dejó autorizado. */
    confirmarCierreAutorizado: (
      efectivo: EfectivoDeclaradoIpc,
    ): Promise<RespuestaIpc<ResultadoDeCierreIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.cerrarCaja, {
        efectivo,
        confirmarAutorizacion: true,
      }) as Promise<RespuestaIpc<ResultadoDeCierreIpc>>,

    /** Descarta esa autorización en el proceso principal. La caja sigue abierta. */
    cancelarAutorizacionDeCierre: (): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.cancelarAutorizacionDeCierre) as Promise<RespuestaIpc<boolean>>,
  },

  catalogo: {
    listarCategorias: (): Promise<RespuestaIpc<readonly CategoriaIpc[]>> =>
      ipcRenderer.invoke(CANALES_IPC.categoriasListar) as Promise<
        RespuestaIpc<readonly CategoriaIpc[]>
      >,

    crearCategoria: (nombre: string): Promise<RespuestaIpc<CategoriaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.categoriasCrear, { nombre }) as Promise<
        RespuestaIpc<CategoriaIpc>
      >,

    editarCategoria: (id: string, nombre: string): Promise<RespuestaIpc<CategoriaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.categoriasEditar, { id, nombre }) as Promise<
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
    cobrar: (pedido: PedidoDeCobro): Promise<RespuestaIpc<ResultadoDeCobro>> =>
      ipcRenderer.invoke(CANALES_IPC.ventaCobrar, pedido) as Promise<
        RespuestaIpc<ResultadoDeCobro>
      >,
    anular: (pedido: PedidoDeAnulacionIpc): Promise<RespuestaIpc<ResultadoDeAnulacionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.ventaAnular, pedido) as Promise<
        RespuestaIpc<ResultadoDeAnulacionIpc>
      >,
  },

  usuarios: {
    listar: (): Promise<RespuestaIpc<readonly UsuarioIpc[]>> =>
      ipcRenderer.invoke(CANALES_IPC.usuariosListar) as Promise<
        RespuestaIpc<readonly UsuarioIpc[]>
      >,
    crear: (datos: UsuarioNuevoIpc): Promise<RespuestaIpc<UsuarioIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.usuariosCrear, datos) as Promise<RespuestaIpc<UsuarioIpc>>,
    editar: (datos: UsuarioEditadoIpc): Promise<RespuestaIpc<UsuarioIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.usuariosEditar, datos) as Promise<RespuestaIpc<UsuarioIpc>>,
    cambiarPin: (id: string, pin: string): Promise<RespuestaIpc<UsuarioIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.usuariosCambiarPin, { id, pin }) as Promise<
        RespuestaIpc<UsuarioIpc>
      >,
    fijarActivo: (id: string, activo: boolean): Promise<RespuestaIpc<UsuarioIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.usuariosFijarActivo, { id, activo }) as Promise<
        RespuestaIpc<UsuarioIpc>
      >,
  },

  negocio: {
    obtener: (): Promise<RespuestaIpc<ConfiguracionDeNegocioIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.negocioObtener) as Promise<
        RespuestaIpc<ConfiguracionDeNegocioIpc>
      >,
    guardar: (datos: ConfiguracionDeNegocioIpc): Promise<RespuestaIpc<ConfiguracionDeNegocioIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.negocioGuardar, datos) as Promise<
        RespuestaIpc<ConfiguracionDeNegocioIpc>
      >,
  },

  recibos: {
    // El filtro por método de pago viaja al proceso principal, que es quien
    // filtra Y suma: la ventana no calcula nada (§4.15).
    listar: (filtro: FiltroDeFormaPagoIpc = 'todas'): Promise<RespuestaIpc<HistorialDeRecibosIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.recibosListar, { formaPago: filtro }) as Promise<
        RespuestaIpc<HistorialDeRecibosIpc>
      >,
    ver: (id: string): Promise<RespuestaIpc<ReciboVistoIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.recibosVer, { id }) as Promise<RespuestaIpc<ReciboVistoIpc>>,
    reimprimir: (id: string): Promise<RespuestaIpc<ReciboVistoIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.recibosReimprimir, { id }) as Promise<
        RespuestaIpc<ReciboVistoIpc>
      >,
  },

  reportes: {
    resumenDeVentas: (periodo: PeriodoIpc): Promise<RespuestaIpc<ResumenDeVentasIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.reportesResumenDeVentas, periodo) as Promise<
        RespuestaIpc<ResumenDeVentasIpc>
      >,
    ventasPorProducto: (
      periodo: PeriodoIpc,
    ): Promise<RespuestaIpc<ReporteDeVentasPorProductoIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.reportesVentasPorProducto, periodo) as Promise<
        RespuestaIpc<ReporteDeVentasPorProductoIpc>
      >,
    inventario: (orden: 'nombre' | 'cantidad'): Promise<RespuestaIpc<ReporteDeInventarioIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.reportesInventario, { orden }) as Promise<
        RespuestaIpc<ReporteDeInventarioIpc>
      >,
  },

  limites: {
    listar: (): Promise<RespuestaIpc<readonly LimiteDeDescuentoIpc[]>> =>
      ipcRenderer.invoke(CANALES_IPC.limitesListar) as Promise<
        RespuestaIpc<readonly LimiteDeDescuentoIpc[]>
      >,
    fijar: (cambio: CambioDeLimiteIpc): Promise<RespuestaIpc<LimiteDeDescuentoIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.limitesFijar, cambio) as Promise<
        RespuestaIpc<LimiteDeDescuentoIpc>
      >,
  },

  /*
    Conexión con la nube. Los dos canales exigen rol administrativo del lado
    del proceso principal; que la pantalla solo se ofrezca a un administrador
    es comodidad, no control.

    NOTA sobre `conectar`: la contraseña cruza este puente UNA vez, dentro del
    payload, y no se guarda de este lado. El preload no la registra ni la
    conserva; lo único que devuelve es el resumen, que no la incluye.
  */
  nube: {
    estado: (): Promise<RespuestaIpc<EstadoDeNubeIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.nubeEstado) as Promise<RespuestaIpc<EstadoDeNubeIpc>>,
    conectar: (datos: ConexionDeNubeIpc): Promise<RespuestaIpc<ResumenDeConexionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.nubeConectar, datos) as Promise<
        RespuestaIpc<ResumenDeConexionIpc>
      >,
  },

  historialDeCajas: {
    listar: (filtro: FiltroDeHistorialDeCajasIpc): Promise<RespuestaIpc<HistorialDeCajasIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.cajasHistorial, filtro) as Promise<RespuestaIpc<HistorialDeCajasIpc>>,
    detalle: (id: string): Promise<RespuestaIpc<DetalleDeSesionDeCajaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.cajasDetalle, { id }) as Promise<RespuestaIpc<DetalleDeSesionDeCajaIpc>>,
  },

  impresora: {
    estado: (): Promise<RespuestaIpc<EstadoDeImpresoraIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.impresoraEstado) as Promise<RespuestaIpc<EstadoDeImpresoraIpc>>,
    listar: (): Promise<RespuestaIpc<readonly ImpresoraDelSistemaIpc[]>> =>
      ipcRenderer.invoke(CANALES_IPC.impresoraListar) as Promise<RespuestaIpc<readonly ImpresoraDelSistemaIpc[]>>,
    guardar: (nombre: string): Promise<RespuestaIpc<EstadoDeImpresoraIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.impresoraGuardar, { nombre }) as Promise<RespuestaIpc<EstadoDeImpresoraIpc>>,
    quitar: (): Promise<RespuestaIpc<EstadoDeImpresoraIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.impresoraQuitar) as Promise<RespuestaIpc<EstadoDeImpresoraIpc>>,
    imprimirPrueba: (nombre: string): Promise<RespuestaIpc<ResultadoDePruebaDeImpresoraIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.impresoraImprimirPrueba, { nombre }) as Promise<
        RespuestaIpc<ResultadoDePruebaDeImpresoraIpc>
      >,
    confirmarPrueba: (datos: ConfirmacionDePruebaIpc): Promise<RespuestaIpc<ConfirmacionDePruebaRegistradaIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.impresoraConfirmarPrueba, datos) as Promise<
        RespuestaIpc<ConfirmacionDePruebaRegistradaIpc>
      >,
  },

  sincronizacion: {
    resumen: (): Promise<RespuestaIpc<ResumenDeSincronizacionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.sincronizacionResumen) as Promise<
        RespuestaIpc<ResumenDeSincronizacionIpc>
      >,
    detalle: (): Promise<RespuestaIpc<DetalleDeSincronizacionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.sincronizacionDetalle) as Promise<
        RespuestaIpc<DetalleDeSincronizacionIpc>
      >,
    reintentarLote: (datos: LoteIdIpc): Promise<RespuestaIpc<boolean>> =>
      ipcRenderer.invoke(CANALES_IPC.sincronizacionReintentarLote, datos) as Promise<
        RespuestaIpc<boolean>
      >,
    saltarLote: (datos: SaltoDeLoteIpc): Promise<RespuestaIpc<ResultadoDeSaltoDeLoteIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.sincronizacionSaltarLote, datos) as Promise<
        RespuestaIpc<ResultadoDeSaltoDeLoteIpc>
      >,
  },

  /*
    Restauración desde la nube (fase 4.b). Sin sesión local: corre sobre una
    instalación vacía. La contraseña del usuario de restauración cruza este
    puente UNA vez en `iniciar` o `retomar`, y de este lado no se guarda.
  */
  restauracion: {
    estado: (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionEstado) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    iniciar: (datos: InicioDeRestauracionIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionIniciar, datos) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    retomar: (datos: RetomaDeRestauracionIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionRetomar, datos) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    progreso: (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionProgreso) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    cancelar: (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionCancelar) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    aceptarExcluida: (datos: FilaExcluidaIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionAceptarExcluida, datos) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    revisarUsuario: (datos: RevisionDeUsuarioIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionRevisarUsuario, datos) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    asignarPin: (datos: PinDeRestauracionIpc): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionAsignarPin, datos) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
    terminar: (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ipcRenderer.invoke(CANALES_IPC.restauracionTerminar) as Promise<
        RespuestaIpc<ProgresoDeRestauracionIpc>
      >,
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
