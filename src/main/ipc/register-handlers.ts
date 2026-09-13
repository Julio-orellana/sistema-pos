/**
 * Registro de manejadores IPC.
 *
 * Cada manejador sigue el mismo patrón, y es deliberado:
 *   1. valida el payload con zod (el renderer se trata como no confiable),
 *   2. ejecuta la operación,
 *   3. devuelve siempre un `RespuestaIpc`, nunca lanza a través del puente.
 *
 * Cuando se agregue un módulo de negocio, sus manejadores viven en su propio
 * archivo dentro de src/main/ipc/ y se registran desde aquí.
 */

import { BrowserWindow, app, ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaConfirmacionDeSalida,
  esquemaAperturaDeCaja,
  esquemaCierreDeCaja,
  esquemaIntentoDeIngreso,
  esquemaPinRemoto,
  esquemaPrimerAdministrador,
  esquemaSolicitudDiagnostico,
  type DiagnosticoAplicacion,
  type DiagnosticoBaseDeDatos,
  type EstadoDeCaja,
  type EstadoDeSesion,
  type RespuestaIpc,
  type ResultadoDeCierreIpc,
  type TurnoAbierto,
  type ResultadoDeIngreso,
  type ResultadoIntentoDeSalida,
  type SesionIniciada,
  type UsuarioParaIngreso,
} from '@shared/types/ipc';
import {
  crearReceiptPrinterProvider,
  crearSyncProvider,
  leerConfiguracionAdaptadoresDelEntorno,
} from '@shared/adapters';
import { ejecutarDiagnostico } from '@main/database/connection';
import { ErrorDeNegocio } from '@main/database/errores';
import type { ControladorDeSalidaControlada } from '@main/windows/controlled-exit';
import type { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { requiereRol, requiereSesion, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import type { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import type { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import type { ServicioDeConfiguracionDeNegocio } from '@main/domain/negocio/servicio-de-configuracion';
import type { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import type { ServicioDeReportes } from '@main/domain/reportes/servicio-de-reportes';
import type { ServicioDeLimitesDeDescuento } from '@main/domain/venta/servicio-de-limites-de-descuento';
import type { RepositorioDeRecibos } from '@main/database/repositories/recibos';
import type { RepositorioDePreciosEspeciales } from '@main/database/repositories/precios-especiales';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import type { SesionDeNube } from '@main/sincronizacion/sesion-de-nube';
import { generarHashDePin } from '@shared/auth';
import { montoACadena } from '@shared/money';
import { ejecutarConRespuesta } from './respuesta';
import {
  registrarManejadoresDeCatalogo,
  type DependenciasDeCatalogo,
} from './catalogo';
import { registrarManejadoresDeVenta } from './venta';
import { registrarManejadoresDeUsuarios } from './usuarios';
import { registrarManejadoresDeNube } from './nube';
import { registrarManejadoresDeRecibos } from './recibos';
import { registrarManejadoresDeReportes } from './reportes';

/** Dependencias que los manejadores necesitan del resto del proceso principal. */
export interface DependenciasDeIpc {
  /** Coordina la salida controlada del modo kiosko. */
  readonly controladorDeSalida: ControladorDeSalidaControlada;
  /** Única verificación de PIN del sistema. */
  readonly autenticacion: ServicioDeAutenticacion;
  /** Quién está usando la caja ahora mismo. */
  readonly sesion: SesionActual;
  /** Acceso a los usuarios, para la pantalla de ingreso. */
  readonly usuarios: RepositorioDeUsuarios;
  /** Apertura y cierre del turno de caja. */
  readonly caja: ServicioDeCaja;
  /** Catálogo: categorías, productos y fotos. */
  readonly catalogo: Omit<DependenciasDeCatalogo, 'sesion'>;
  /** Registro de la venta: la transacción que descuenta inventario y cobra. */
  readonly venta: ServicioDeVenta;
  /** Alta, edición, cambio de PIN y baja de usuarios. Todo con rol administrativo. */
  readonly gestionDeUsuarios: ServicioDeUsuarios;
  /** Datos de la tienda que encabezan el recibo. */
  readonly negocio: ServicioDeConfiguracionDeNegocio;
  /** Emisión, historial y reimpresión de recibos. */
  readonly recibos: ServicioDeRecibos;
  /** Acceso a las filas de recibos, para armar el historial. */
  readonly repositorioDeRecibos: RepositorioDeRecibos;
  /** Precios especiales vigentes, para resolver el precio efectivo. */
  readonly preciosEspeciales: RepositorioDePreciosEspeciales;
  /** Los tres reportes: resumen de ventas, por producto e inventario. */
  readonly reportes: ServicioDeReportes;
  /** Topes de descuento por rol, ya configurables desde la aplicación. */
  readonly limitesDeDescuento: ServicioDeLimitesDeDescuento;
  /**
   * La sesión de la terminal contra Supabase Auth (fase 3.a).
   *
   * **Opcional a propósito.** Los modos semilla y la verificación de arranque
   * construyen los manejadores sin nube: no tienen a quién conectarse y no
   * deberían tocar credenciales. Cuando falta, los dos canales no se
   * registran y la pantalla lo dice, en vez de fingir que existen.
   */
  readonly nube?: SesionDeNube | undefined;
}

/** Milisegundos que tiene un segundo. */
const MILISEGUNDOS_POR_SEGUNDO = 1000;

/** Registra todos los manejadores IPC de la aplicación. */
export function registrarManejadoresIpc(dependencias: DependenciasDeIpc): void {
  // Los del catálogo viven en su propio archivo, como manda la convención de
  // este módulo, y comparten la misma sesión y el mismo envoltorio de respuesta.
  registrarManejadoresDeCatalogo({ sesion: dependencias.sesion, ...dependencias.catalogo });
  // La venta comparte los servicios del catálogo y de la caja, pero su canal
  // exige solo sesión: lo usa un cajero, no un administrador.
  registrarManejadoresDeVenta({
    sesion: dependencias.sesion,
    caja: dependencias.caja,
    categorias: dependencias.catalogo.categorias,
    productos: dependencias.catalogo.productos,
    venta: dependencias.venta,
    autenticacion: dependencias.autenticacion,
    preciosEspeciales: dependencias.preciosEspeciales,
    usuarios: dependencias.usuarios,
    recibos: dependencias.recibos,
  });
  // La gestión de usuarios vive en su propio archivo y exige rol
  // administrativo en cada canal, igual que el catálogo.
  registrarManejadoresDeUsuarios({
    sesion: dependencias.sesion,
    usuarios: dependencias.gestionDeUsuarios,
    repositorioDeUsuarios: dependencias.usuarios,
  });
  // Configuración del negocio y recibos. Los dos niveles de permiso conviven
  // en ese módulo: configurar exige administrativo, reimprimir solo sesión.
  registrarManejadoresDeRecibos({
    sesion: dependencias.sesion,
    negocio: dependencias.negocio,
    recibos: dependencias.recibos,
    repositorioDeRecibos: dependencias.repositorioDeRecibos,
  });
  // Reportes y topes de descuento: los cinco canales exigen rol
  // administrativo. Cuánto entró a la tienda y cuánto puede rebajar cada rol
  // son las dos cosas que un cajero no tiene por qué ver ni cambiar.
  registrarManejadoresDeReportes({
    sesion: dependencias.sesion,
    reportes: dependencias.reportes,
    limites: dependencias.limitesDeDescuento,
  });
  // Conexión con la nube: los dos canales exigen rol administrativo. Solo se
  // registran si hay sesión de nube construida; ver el comentario del campo.
  if (dependencias.nube !== undefined) {
    registrarManejadoresDeNube({ sesion: dependencias.sesion, nube: dependencias.nube });
  }

  ipcMain.handle(
    CANALES_IPC.diagnosticoBaseDeDatos,
    async (_evento, payload: unknown): Promise<RespuestaIpc<DiagnosticoBaseDeDatos>> =>
      ejecutarConRespuesta('DIAGNOSTICO_BASE_DE_DATOS_FALLIDO', () => {
        const solicitud = esquemaSolicitudDiagnostico.parse(payload ?? {});
        return ejecutarDiagnostico(solicitud);
      }),
  );

  ipcMain.handle(
    CANALES_IPC.diagnosticoAplicacion,
    async (): Promise<RespuestaIpc<DiagnosticoAplicacion>> =>
      ejecutarConRespuesta('DIAGNOSTICO_APLICACION_FALLIDO', async () => {
        const configuracion = leerConfiguracionAdaptadoresDelEntorno(process.env);
        const impresora = crearReceiptPrinterProvider(configuracion);
        const sincronizador = crearSyncProvider(configuracion);
        const estadoSincronizacion = await sincronizador.consultarEstado();

        const diagnostico: DiagnosticoAplicacion = {
          nombreAplicacion: app.getName(),
          version: app.getVersion(),
          entorno: app.isPackaged ? 'produccion' : 'desarrollo',
          versionElectron: process.versions.electron,
          versionNode: process.versions.node,
          versionChrome: process.versions.chrome,
          plataforma: process.platform,
          adaptadorImpresion: impresora.nombre,
          adaptadorSincronizacion: sincronizador.nombre,
          sincronizacionSimulada: estadoSincronizacion.simulado,
        };
        return diagnostico;
      }),
  );

  ipcMain.handle(
    CANALES_IPC.solicitarSalidaControlada,
    async (evento): Promise<RespuestaIpc<boolean>> =>
      ejecutarConRespuesta('SOLICITUD_DE_SALIDA_FALLIDA', () => {
        // Se resuelve la ventana desde el propio evento: así el botón no puede
        // pedir la salida de una ventana que no es la suya.
        const ventana = BrowserWindow.fromWebContents(evento.sender);
        if (ventana === null) {
          throw new Error('No se pudo identificar la ventana que pidió la salida.');
        }
        dependencias.controladorDeSalida.solicitarPin(ventana, 'boton_de_interfaz');
        return true;
      }),
  );

  ipcMain.handle(
    CANALES_IPC.confirmarSalidaControlada,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResultadoIntentoDeSalida>> =>
      ejecutarConRespuesta('SALIDA_CONTROLADA_FALLIDA', () => {
        // El PIN se valida en la frontera antes de llegar a la comparación
        // criptográfica: un payload deforme no debe consumir un intento.
        const confirmacion = esquemaConfirmacionDeSalida.parse(payload);
        return dependencias.controladorDeSalida.confirmarSalida(confirmacion.pin);
      }),
  );

  // -------------------------------------------------------------------------
  // Sesión, usuarios y primer arranque
  // -------------------------------------------------------------------------

  ipcMain.handle(
    CANALES_IPC.estadoDeSesion,
    async (): Promise<RespuestaIpc<EstadoDeSesion>> =>
      ejecutarConRespuesta('ESTADO_DE_SESION_FALLIDO', () => {
        const estado: EstadoDeSesion = {
          requiereConfiguracionInicial: dependencias.autenticacion.requiereConfiguracionInicial(),
          sesion: dependencias.sesion.obtener(),
        };
        return estado;
      }),
  );

  ipcMain.handle(
    CANALES_IPC.listarUsuariosParaIngreso,
    async (): Promise<RespuestaIpc<readonly UsuarioParaIngreso[]>> =>
      ejecutarConRespuesta('LISTADO_DE_USUARIOS_FALLIDO', () => {
        const instante = Date.now();
        return dependencias.usuarios.listarActivos().map((usuario) => {
          const restanteMs =
            usuario.bloqueadoHasta === null ? 0 : Date.parse(usuario.bloqueadoHasta) - instante;
          const bloqueado = restanteMs > 0;
          return {
            id: usuario.id,
            nombre: usuario.nombre,
            rol: usuario.rol,
            bloqueado,
            // Se informa el tiempo restante, nunca los intentos que le quedan.
            segundosParaReintentar: bloqueado
              ? Math.ceil(restanteMs / MILISEGUNDOS_POR_SEGUNDO)
              : null,
          };
        });
      }),
  );

  ipcMain.handle(
    CANALES_IPC.iniciarSesion,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResultadoDeIngreso>> =>
      ejecutarConRespuesta('INGRESO_FALLIDO', () => {
        const intento = esquemaIntentoDeIngreso.parse(payload);
        const resultado = dependencias.autenticacion.autenticar(intento.usuarioId, intento.pin);

        const sesion =
          resultado.autenticado && resultado.usuario !== null
            ? dependencias.sesion.iniciar(resultado.usuario)
            : null;

        const respuesta: ResultadoDeIngreso = {
          autenticado: resultado.autenticado,
          codigo: resultado.codigo,
          mensaje: resultado.mensaje,
          sesion,
          segundosParaReintentar: resultado.segundosParaReintentar,
        };
        return respuesta;
      }),
  );

  ipcMain.handle(
    CANALES_IPC.cerrarSesion,
    async (): Promise<RespuestaIpc<boolean>> =>
      ejecutarConRespuesta('CIERRE_DE_SESION_FALLIDO', () => {
        dependencias.sesion.cerrar();
        return true;
      }),
  );

  ipcMain.handle(
    CANALES_IPC.crearPrimerAdministrador,
    async (_evento, payload: unknown): Promise<RespuestaIpc<SesionIniciada>> =>
      ejecutarConRespuesta('CREACION_DE_ADMINISTRADOR_FALLIDA', () => {
        const datos = esquemaPrimerAdministrador.parse(payload);
        // El servicio vuelve a comprobar que la instalación esté vacía: sin esa
        // condición, este canal sería una puerta para crearse un administrador
        // en cualquier momento desde la interfaz.
        const creado = dependencias.autenticacion.crearPrimerAdministrador(
          datos.nombre.trim(),
          generarHashDePin(datos.pin),
        );
        return dependencias.sesion.iniciar(creado);
      }),
  );

  ipcMain.handle(
    CANALES_IPC.configurarPinRemoto,
    async (_evento, payload: unknown): Promise<RespuestaIpc<boolean>> =>
      ejecutarConRespuesta('CONFIGURACION_DE_PIN_REMOTO_FALLIDA', () =>
        // Solo un administrador, y solo sobre SU PROPIO PIN: el id sale de la
        // sesión, nunca del payload.
        requiereRol(dependencias.sesion, 'administrativo', () => {
          const datos = esquemaPinRemoto.parse(payload);
          const enSesion = dependencias.sesion.obtener();
          if (enSesion === null) {
            throw new Error('No hay sesión iniciada.');
          }
          // Solo sobre SU PROPIO PIN: el id sale de la sesión, nunca del
          // payload. La regla de que debe diferir del PIN normal vive en el
          // servicio, no aquí: una validación en la frontera se saltaría
          // llamando al servicio desde otro lugar.
          dependencias.autenticacion.configurarPinRemoto(enSesion.id, datos.pin);
          return true;
        }),
      ),
  );

  // -------------------------------------------------------------------------
  // Caja
  // -------------------------------------------------------------------------

  ipcMain.handle(
    CANALES_IPC.estadoDeCaja,
    async (): Promise<RespuestaIpc<EstadoDeCaja>> =>
      ejecutarConRespuesta('ESTADO_DE_CAJA_FALLIDO', () =>
        requiereSesion(dependencias.sesion, () => {
          const enSesion = dependencias.sesion.obtener();
          // EL turno del sistema, no el del usuario en sesión: la caja física
          // es una sola y puede haberla abierto otra persona.
          const turno = dependencias.caja.sesionAbierta();
          const quienAbrio =
            turno === null ? null : dependencias.usuarios.obtenerPorId(turno.usuarioId);

          const estado: EstadoDeCaja = {
            turnoAbierto:
              turno === null
                ? null
                : {
                    id: turno.id,
                    montoInicial: montoACadena(turno.montoInicial),
                    abiertaEn: turno.abiertaEn,
                    abiertaPorId: turno.usuarioId,
                    abiertaPorNombre: quienAbrio?.nombre ?? '(usuario eliminado)',
                    esDeOtroUsuario:
                      enSesion !== null && turno.usuarioId !== enSesion.id,
                  },
            denominaciones: dependencias.caja.listarDenominaciones().map((d) => ({
              id: d.id,
              valor: montoACadena(d.valor),
              tipo: d.tipo,
              orden: d.orden,
            })),
          };
          return estado;
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.abrirCaja,
    async (_evento, payload: unknown): Promise<RespuestaIpc<TurnoAbierto>> =>
      ejecutarConRespuesta('APERTURA_DE_CAJA_FALLIDA', () =>
        // Cualquier rol puede abrir SU turno. El id sale de la sesión: nadie
        // abre caja en nombre de otro.
        requiereSesion(dependencias.sesion, () => {
          const datos = esquemaAperturaDeCaja.parse(payload);
          const enSesion = dependencias.sesion.obtener();
          if (enSesion === null) {
            throw new Error('No hay sesión iniciada.');
          }
          const turno = dependencias.caja.abrir(enSesion.id, datos.efectivo);
          const abierto: TurnoAbierto = {
            id: turno.id,
            montoInicial: montoACadena(turno.montoInicial),
            abiertaEn: turno.abiertaEn,
            abiertaPorId: turno.usuarioId,
            abiertaPorNombre: enSesion.nombre,
            // Recién abierto por quien está en sesión: nunca es de otro.
            esDeOtroUsuario: false,
          };
          return abierto;
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.cerrarCaja,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResultadoDeCierreIpc>> =>
      ejecutarConRespuesta('CIERRE_DE_CAJA_FALLIDO', () =>
        requiereSesion(dependencias.sesion, () => {
          const datos = esquemaCierreDeCaja.parse(payload);
          const enSesion = dependencias.sesion.obtener();
          if (enSesion === null) {
            throw new Error('No hay sesión iniciada.');
          }
          const turno = dependencias.caja.sesionAbierta();
          if (turno === null) {
            throw new ErrorDeNegocio(
              'DATO_INVALIDO',
              'No hay ninguna caja abierta en el sistema.',
              'Se intentó cerrar sin ninguna sesión de caja abierta.',
            );
          }

          // ---- Autorización 1: ¿la caja es de otra persona? ----------------
          // Se resuelve ANTES de contar el efectivo. Es una superficie propia,
          // con su propio candado, y NO acepta el PIN remoto: ese se pidió
          // para autorizar diferencias por teléfono y nada más (CLAUDE.md §4.9).
          let autorizacionDeCajaAjena: { readonly autorizadaPor: string } | undefined;

          if (dependencias.caja.requiereAutorizacionDeCajaAjena(turno, enSesion.id)) {
            if (datos.pinCajaAjena === undefined) {
              const aviso = dependencias.caja.intentarCerrar(turno.id, datos.efectivo, {
                usuarioQueCierra: enSesion.id,
              });
              return { ...aviso, autorizadaVia: null, segundosParaReintentar: null };
            }

            const permiso = dependencias.autenticacion.autorizarComoAdministrador(
              datos.pinCajaAjena,
              'cierre_de_caja_ajena',
);
            if (!permiso.autenticado || permiso.usuario === null) {
              return {
                cerrada: false,
                codigo: permiso.codigo,
                mensaje: permiso.mensaje,
                diferencia: '0.00',
                montoEsperado: montoACadena(turno.montoInicial),
                montoReal: '0.00',
                autorizadaVia: null,
                segundosParaReintentar: permiso.segundosParaReintentar,
              };
            }
            autorizacionDeCajaAjena = { autorizadaPor: permiso.usuario.id };
          }

          // ---- Autorización 2: ¿la caja cuadra? ----------------------------
          // Sin PIN, solo se calcula. Si hay diferencia, no cierra y devuelve
          // el monto para que la interfaz lo muestre antes de pedir el código.
          const tentativo = dependencias.caja.intentarCerrar(turno.id, datos.efectivo, {
            usuarioQueCierra: enSesion.id,
            autorizacionDeCajaAjena,
          });
          if (tentativo.cerrada || datos.pin === undefined) {
            return {
              ...tentativo,
              autorizadaVia: null,
              segundosParaReintentar: null,
            };
          }

          // Segundo paso: con PIN. Acepta el PIN normal (presencial) o el
          // remoto (por teléfono), y el sistema determina cuál fue.
          const autorizacion = dependencias.autenticacion.autorizarComoAdministrador(
            datos.pin,
            'cierre_con_diferencia',
);

          if (!autorizacion.autenticado || autorizacion.usuario === null) {
            return {
              cerrada: false,
              codigo: autorizacion.codigo,
              mensaje: autorizacion.mensaje,
              diferencia: tentativo.diferencia,
              montoEsperado: tentativo.montoEsperado,
              montoReal: tentativo.montoReal,
              autorizadaVia: null,
              segundosParaReintentar: autorizacion.segundosParaReintentar,
            };
          }

          const via = autorizacion.viaDeAutorizacion ?? 'presencial';
          const cerrado = dependencias.caja.intentarCerrar(turno.id, datos.efectivo, {
            usuarioQueCierra: enSesion.id,
            autorizacionDeCajaAjena,
            autorizacion: { autorizadaPor: autorizacion.usuario.id, via },
          });
          return { ...cerrado, autorizadaVia: via, segundosParaReintentar: null };
        }),
      ),
  );
}

/** Quita los manejadores al cerrar, para no dejar canales colgados. */
export function quitarManejadoresIpc(): void {
  for (const canal of Object.values(CANALES_IPC)) {
    ipcMain.removeHandler(canal);
  }
}
