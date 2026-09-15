/**
 * Canales de la impresora térmica de esta terminal (§4.43).
 *
 * LOS SEIS EXIGEN ROL ADMINISTRATIVO. Elegir la impresora cambia a dónde van los
 * recibos de toda la tienda, y el ticket de prueba gasta papel. Esconder el
 * botón es comodidad; quien rechaza es `requiereRol`, en cada canal.
 *
 * Todas las respuestas pasan por `ejecutarConRespuesta`, que desde §4.42
 * comprueba que se puedan copiar al cruzar el puente IPC.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaConfirmacionDePrueba,
  esquemaNombreDeImpresora,
  type ConfirmacionDePruebaRegistradaIpc,
  type EstadoDeImpresoraIpc,
  type ImpresoraDelSistemaIpc,
  type RespuestaIpc,
  type ResultadoDePruebaDeImpresoraIpc,
} from '@shared/types/ipc';
import { requiereRol, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeImpresora } from '@main/impresora/servicio-de-impresora';
import { ejecutarConRespuesta } from './respuesta';

export interface DependenciasDeImpresoraIpc {
  readonly sesion: SesionActual;
  readonly impresora: ServicioDeImpresora;
}

export function registrarManejadoresDeImpresora(dependencias: DependenciasDeImpresoraIpc): void {
  const { sesion, impresora } = dependencias;

  ipcMain.handle(
    CANALES_IPC.impresoraEstado,
    async (): Promise<RespuestaIpc<EstadoDeImpresoraIpc>> =>
      ejecutarConRespuesta('IMPRESORA_ESTADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => impresora.estado()),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.impresoraListar,
    async (): Promise<RespuestaIpc<readonly ImpresoraDelSistemaIpc[]>> =>
      ejecutarConRespuesta('IMPRESORAS_LISTADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => impresora.listar()),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.impresoraGuardar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<EstadoDeImpresoraIpc>> =>
      ejecutarConRespuesta('IMPRESORA_GUARDADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => impresora.guardar(esquemaNombreDeImpresora.parse(payload).nombre)),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.impresoraQuitar,
    async (): Promise<RespuestaIpc<EstadoDeImpresoraIpc>> =>
      ejecutarConRespuesta('IMPRESORA_QUITAR_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => impresora.quitar()),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.impresoraImprimirPrueba,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResultadoDePruebaDeImpresoraIpc>> =>
      ejecutarConRespuesta('IMPRESORA_PRUEBA_FALLIDA', () =>
        requiereRol(sesion, 'administrativo', () =>
          impresora.imprimirPrueba(esquemaNombreDeImpresora.parse(payload).nombre),
        ),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.impresoraConfirmarPrueba,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ConfirmacionDePruebaRegistradaIpc>> =>
      ejecutarConRespuesta('IMPRESORA_CONFIRMACION_FALLIDA', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaConfirmacionDePrueba.parse(payload);
          return impresora.confirmarPrueba(datos.pruebaId, datos.resultado);
        }),
      ),
  );
}
