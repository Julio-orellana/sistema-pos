/**
 * Canales del historial de cajas (§4.44).
 *
 * LOS DOS EXIGEN ROL ADMINISTRATIVO. El historial dice cuánto se contó, cuánto
 * faltó y quién autorizó cada corrección: es la herramienta con la que el dueño
 * audita a sus cajeros, y un cajero no tiene por qué ver el corte de los demás.
 * El menú solo muestra el botón a un administrador, pero eso es comodidad:
 * quien rechaza es `requiereRol`, en cada canal.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaFiltroDeHistorialDeCajas,
  esquemaIdDeSesionDeCaja,
  type DetalleDeSesionDeCajaIpc,
  type HistorialDeCajasIpc,
  type RespuestaIpc,
} from '@shared/types/ipc';
import { requiereRol, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeHistorialDeCajas } from '@main/domain/caja/historial-de-cajas';
import { ejecutarConRespuesta } from './respuesta';

export interface DependenciasDeHistorialDeCajasIpc {
  readonly sesion: SesionActual;
  readonly historial: ServicioDeHistorialDeCajas;
}

export function registrarManejadoresDeHistorialDeCajas(dependencias: DependenciasDeHistorialDeCajasIpc): void {
  const { sesion, historial } = dependencias;

  ipcMain.handle(
    CANALES_IPC.cajasHistorial,
    async (_evento, payload: unknown): Promise<RespuestaIpc<HistorialDeCajasIpc>> =>
      ejecutarConRespuesta('HISTORIAL_DE_CAJAS_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => historial.listar(esquemaFiltroDeHistorialDeCajas.parse(payload))),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.cajasDetalle,
    async (_evento, payload: unknown): Promise<RespuestaIpc<DetalleDeSesionDeCajaIpc>> =>
      ejecutarConRespuesta('DETALLE_DE_CAJA_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => historial.detalle(esquemaIdDeSesionDeCaja.parse(payload).id)),
      ),
  );
}
