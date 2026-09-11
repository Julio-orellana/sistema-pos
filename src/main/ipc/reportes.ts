/**
 * Manejadores IPC de los reportes y de los topes de descuento.
 *
 * LOS CINCO CANALES EXIGEN ROL ADMINISTRATIVO, y los dos grupos por razones
 * distintas:
 *
 *   · **Los reportes** dicen cuánto entró a la tienda y qué hay en bodega. Es
 *     información del dueño, no del mostrador: un cajero necesita vender y
 *     reimprimir, no saber cuánto facturó el negocio este mes.
 *   · **Los topes de descuento** son la configuración que decide cuánto puede
 *     rebajar cada rol sin pedir permiso. Dejar que un usuario de venta la
 *     tocara sería dejar que se suba su propio límite, y todo el mecanismo de
 *     autorización por PIN quedaría en nada.
 *
 * Hay una prueba que CUENTA los `ipcMain.handle` de este archivo y exige que
 * haya tantos guards como canales, igual que en el módulo de usuarios: el
 * riesgo real no es que el guard esté mal escrito, es que alguien agregue un
 * canal el año que viene y se olvide de envolverlo.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaLimiteDeDescuento,
  esquemaOrdenDeInventario,
  esquemaPeriodo,
  type LimiteDeDescuentoIpc,
  type PeriodoResueltoIpc,
  type ReporteDeInventarioIpc,
  type ReporteDeVentasPorProductoIpc,
  type RespuestaIpc,
  type ResumenDeVentasIpc,
} from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';
import { requiereRol, type SesionActual } from '@main/domain/usuarios/sesion';
import type { PeriodoResuelto } from '@main/domain/reportes/periodo';
import type { ServicioDeReportes } from '@main/domain/reportes/servicio-de-reportes';
import type { ServicioDeLimitesDeDescuento } from '@main/domain/venta/servicio-de-limites-de-descuento';
import { ejecutarConRespuesta } from './respuesta';

/** Dependencias de estos manejadores. */
export interface DependenciasDeReportesIpc {
  readonly sesion: SesionActual;
  readonly reportes: ServicioDeReportes;
  readonly limites: ServicioDeLimitesDeDescuento;
}

/**
 * El período, recortado a lo que la ventana necesita.
 *
 * NO VIAJAN LOS INSTANTES ISO. La pantalla muestra días y una etiqueta; los
 * extremos exactos en UTC son un detalle de cómo se consultó la base, y
 * mandarlos invitaría a que alguna pantalla futura hiciera su propia
 * aritmética de fechas en vez de pedirle el período al proceso principal.
 */
function periodoParaLaVentana(periodo: PeriodoResuelto): PeriodoResueltoIpc {
  return {
    clase: periodo.clase,
    desdeDia: periodo.desdeDia,
    hastaDia: periodo.hastaDia,
    etiqueta: periodo.etiqueta,
  };
}

/** Id del usuario en sesión, o falla. El guard ya comprobó que hay uno. */
function actorEnSesion(sesion: SesionActual): string {
  const enSesion = sesion.obtener();
  if (enSesion === null) {
    throw new ErrorDeNegocio(
      'PERMISO_DENEGADO',
      'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
      'Se llegó a un manejador de reportes sin sesión.',
    );
  }
  return enSesion.id;
}

/** Registra los canales de reportes y de límites de descuento. */
export function registrarManejadoresDeReportes(dependencias: DependenciasDeReportesIpc): void {
  const { sesion, reportes, limites } = dependencias;

  // --- Reportes -------------------------------------------------------------
  ipcMain.handle(
    CANALES_IPC.reportesResumenDeVentas,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResumenDeVentasIpc>> =>
      ejecutarConRespuesta('REPORTE_RESUMEN_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const pedido = esquemaPeriodo.parse(payload);
          const resumen = reportes.resumenDeVentas(pedido);
          return { ...resumen, periodo: periodoParaLaVentana(resumen.periodo) };
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.reportesVentasPorProducto,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ReporteDeVentasPorProductoIpc>> =>
      ejecutarConRespuesta('REPORTE_POR_PRODUCTO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const pedido = esquemaPeriodo.parse(payload);
          const reporte = reportes.ventasPorProducto(pedido);
          return { ...reporte, periodo: periodoParaLaVentana(reporte.periodo) };
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.reportesInventario,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ReporteDeInventarioIpc>> =>
      ejecutarConRespuesta('REPORTE_INVENTARIO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const { orden } = esquemaOrdenDeInventario.parse(payload);
          return reportes.inventario(orden);
        }),
      ),
  );

  // --- Topes de descuento ---------------------------------------------------
  ipcMain.handle(
    CANALES_IPC.limitesListar,
    async (): Promise<RespuestaIpc<readonly LimiteDeDescuentoIpc[]>> =>
      ejecutarConRespuesta('LIMITES_LISTAR_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => limites.listar()),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.limitesFijar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<LimiteDeDescuentoIpc>> =>
      ejecutarConRespuesta('LIMITES_FIJAR_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const cambio = esquemaLimiteDeDescuento.parse(payload);
          return limites.fijar(actorEnSesion(sesion), cambio);
        }),
      ),
  );
}
