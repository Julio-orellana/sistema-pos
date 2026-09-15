/**
 * Los nueve canales de la restauración desde la nube (fase 4.b).
 *
 * ===========================================================================
 * NINGUNO LLEVA GUARD DE SESIÓN NI DE ROL, Y HAY QUE DECIR POR QUÉ
 * ===========================================================================
 *
 * Todos los demás módulos administrativos envuelven sus canales en
 * `requiereRol(sesion, 'administrativo', …)`. Acá no se puede: la restauración
 * corre sobre una instalación VACÍA, antes de que exista ningún usuario local
 * y por lo tanto antes de que pueda haber sesión (§6.1 del diseño). Exigirla
 * la haría imposible.
 *
 * La autorización viene de otro lado, y es más fuerte, no más débil:
 *
 *   · **La nube.** `restauracionIniciar` y `restauracionRetomar` exigen el
 *     correo y la contraseña del usuario con rol `restauracion` —el del dueño—
 *     y GoTrue es quien los verifica. Sin esa sesión, ninguna lectura sale.
 *   · **El estado de la base.** El servicio se niega a iniciar si hay una sola
 *     fila de negocio, y se niega a retomar si el puesto de control es de otro
 *     proyecto. Un renderer comprometido no puede usar estos canales para
 *     pisar una base con datos: lo máximo que consigue es lo mismo que la
 *     pantalla de configuración inicial, que tampoco pide sesión.
 *   · **Nada sensible vuelve.** El progreso lleva conteos, nombres de tabla y
 *     nombres de usuario; nunca tokens, contraseñas ni hashes.
 *
 * Hay una prueba que cuenta los canales de este archivo, comprueba que cada
 * uno delega en el servicio —que es quien hace cumplir el estado— y que la
 * contraseña no se registra en ninguna bitácora desde acá.
 *
 * ===========================================================================
 * POR ESTE ARCHIVO PASA UNA CONTRASEÑA, Y NO SE QUEDA EN NINGÚN LADO
 * ===========================================================================
 *
 * Igual que en `nube.ts`: se valida, se le pasa al servicio, y se termina. No
 * se registra, no se guarda y no vuelve en la respuesta. El `catch` de
 * `ejecutarConRespuesta` no ve el payload, así que un error inesperado
 * tampoco puede arrastrarla hasta la ventana.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaFilaExcluida,
  esquemaInicioDeRestauracion,
  esquemaPinDeRestauracion,
  esquemaRetomaDeRestauracion,
  esquemaRevisionDeUsuario,
  type ProgresoDeRestauracionIpc,
  type RespuestaIpc,
} from '@shared/types/ipc';
import type { ServicioDeRestauracion } from '@main/restauracion/servicio-de-restauracion';
import { ejecutarConRespuesta } from './respuesta';

export interface DependenciasDeRestauracionIpc {
  readonly servicio: ServicioDeRestauracion;
}

/** Registra los nueve canales de la restauración. */
export function registrarManejadoresDeRestauracion(dependencias: DependenciasDeRestauracionIpc): void {
  const { servicio } = dependencias;

  ipcMain.handle(
    CANALES_IPC.restauracionEstado,
    async (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_ESTADO_FALLIDO', () => servicio.progreso()),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionIniciar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_INICIO_FALLIDO', async () => {
        const datos = esquemaInicioDeRestauracion.parse(payload);
        return servicio.iniciar({
          correo: datos.correo.trim(),
          contrasena: datos.contrasena,
          motivo: datos.motivo,
          fechaDelRobo: datos.fechaDelRobo,
        });
      }),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionRetomar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_RETOMA_FALLIDA', async () => {
        const datos = esquemaRetomaDeRestauracion.parse(payload);
        return servicio.retomar({ correo: datos.correo.trim(), contrasena: datos.contrasena });
      }),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionProgreso,
    async (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_PROGRESO_FALLIDO', () => servicio.progreso()),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionCancelar,
    async (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_CANCELACION_FALLIDA', () => servicio.cancelar()),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionAceptarExcluida,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_ACEPTACION_FALLIDA', async () => {
        const datos = esquemaFilaExcluida.parse(payload);
        return servicio.aceptarExcluida(datos.tabla, datos.id);
      }),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionRevisarUsuario,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_REVISION_FALLIDA', () => {
        const datos = esquemaRevisionDeUsuario.parse(payload);
        return servicio.revisarUsuario(datos.id, { rol: datos.rol, activo: datos.activo });
      }),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionAsignarPin,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_PIN_FALLIDO', () => {
        const datos = esquemaPinDeRestauracion.parse(payload);
        return servicio.asignarPin(datos.id, datos.pin);
      }),
  );

  ipcMain.handle(
    CANALES_IPC.restauracionTerminar,
    async (): Promise<RespuestaIpc<ProgresoDeRestauracionIpc>> =>
      ejecutarConRespuesta('RESTAURACION_CIERRE_FALLIDO', () => servicio.terminar()),
  );
}
