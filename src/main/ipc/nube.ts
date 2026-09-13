/**
 * Los dos canales de la conexión con la nube. **Los dos exigen rol
 * administrativo.**
 *
 * Conectar la terminal es el aprovisionamiento de §1.3 del diseño: se teclea
 * una vez el correo y la contraseña del usuario de terminal, y a partir de ahí
 * la máquina se mantiene sola. Es una acción de dueño, no de mostrador, por
 * dos razones distintas:
 *
 *   · **Conectar** entrega a esta terminal la capacidad de escribir en la nube.
 *     Un cajero que pudiera hacerlo podría apuntar la tienda a otro proyecto.
 *   · **Leer el estado** dice con qué usuario está conectada y cómo va la
 *     renovación. No es un secreto, pero tampoco es información de mostrador.
 *
 * Hay una prueba que CUENTA los `ipcMain.handle` de este archivo y exige que
 * haya tantos guards como canales, igual que en usuarios y en reportes: el
 * riesgo real no es que el guard esté mal escrito, es que alguien agregue un
 * canal el año que viene y se olvide de envolverlo.
 *
 * ===========================================================================
 * POR ESTE ARCHIVO PASA UNA CONTRASEÑA, Y NO SE QUEDA EN NINGÚN LADO
 * ===========================================================================
 *
 * `nubeConectar` recibe la contraseña del usuario de terminal en su payload.
 * Se valida, se le pasa a `SesionDeNube.conectar` y se termina. **No se
 * registra, no se guarda y no vuelve en la respuesta.** Y en particular: el
 * `catch` de `ejecutarConRespuesta` no ve el payload, así que un error
 * inesperado tampoco puede arrastrarla hasta la ventana.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaConexionDeNube,
  type EstadoDeNubeIpc,
  type RespuestaIpc,
  type ResumenDeConexionIpc,
} from '@shared/types/ipc';
import { requiereRol, type SesionActual } from '@main/domain/usuarios/sesion';
import type { SesionDeNube } from '@main/sincronizacion/sesion-de-nube';
import { ejecutarConRespuesta } from './respuesta';

/** Dependencias de estos manejadores. */
export interface DependenciasDeNubeIpc {
  readonly sesion: SesionActual;
  readonly nube: SesionDeNube;
}

/** Registra los canales de conexión con la nube. */
export function registrarManejadoresDeNube(dependencias: DependenciasDeNubeIpc): void {
  const { sesion, nube } = dependencias;

  ipcMain.handle(
    CANALES_IPC.nubeEstado,
    async (): Promise<RespuestaIpc<EstadoDeNubeIpc>> =>
      ejecutarConRespuesta('NUBE_ESTADO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => nube.estado()),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.nubeConectar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResumenDeConexionIpc>> =>
      ejecutarConRespuesta('NUBE_CONEXION_FALLIDA', () =>
        requiereRol(sesion, 'administrativo', async () => {
          const datos = esquemaConexionDeNube.parse(payload);
          return nube.conectar(datos.correo, datos.contrasena);
        }),
      ),
  );
}
