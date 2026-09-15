/**
 * Los cuatro canales de la sincronización: barra de estado y pantalla
 * administrativa (Fase 4.a).
 *
 * ===========================================================================
 * UNO DE LOS CUATRO NO LLEVA GUARD DE ROL, Y ES DELIBERADO
 * ===========================================================================
 *
 * `sincronizacionResumen` es el único canal de todo el proyecto que la barra
 * de estado consulta, y la barra está montada SIEMPRE —incluso antes de que
 * haya sesión, en la pantalla de ingreso—. Exigirle rol dejaría a un cajero, o
 * a nadie todavía logueado, sin poder ver «Nube: al día» / «Nube: 12
 * pendientes», que el diseño (§3.3) pide visible siempre y sin estorbar la
 * venta. No es un descuido: la respuesta no lleva ningún dato sensible —ni
 * correo, ni el texto del error, ni nada de la credencial— solo un estado ya
 * calculado y un número.
 *
 * Los otros tres SÍ exigen el guard de rol administrativo (`requiereRol`), igual
 * que en `nube.ts`, `usuarios.ts` y `reportes.ts`: pendientes por tabla,
 * último éxito y el error completo de un lote bloqueante no son información
 * de mostrador, y las dos acciones cambian cómo se comporta la terminal.
 *
 * Hay una prueba que CUENTA los `ipcMain.handle` de este archivo y exige que
 * haya tantos guards de rol administrativo como canales MENOS UNO —el
 * resumen—, con el mismo criterio que las otras tres pruebas de guard: el
 * riesgo real no es que el guard esté mal escrito, es que alguien agregue un
 * canal el año que viene y se olvide de envolverlo.
 *
 * ===========================================================================
 * «SALTAR LOTE» PIDE PIN AUNQUE YA HAYA SESIÓN ADMINISTRATIVA, A PROPÓSITO
 * ===========================================================================
 *
 * El canal ya exige `requiereRol('administrativo')`, así que en principio solo
 * un administrador logueado puede siquiera llamarlo. Se le exige el PIN
 * IGUAL, con el mismo criterio que ya rige `cierre_con_diferencia` y
 * `cierre_de_caja_ajena`: teclear el PIN en el momento es la firma deliberada
 * que el diseño pide («tiene que quedar firmada»), no una comprobación de
 * permisos redundante con la sesión. Y quien queda registrado como
 * autorizante es a quien coincidió el PIN (`permiso.usuario`), no
 * necesariamente la sesión activa —el mismo criterio que usa
 * `descuento_excedente` en `venta.ts`—.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaLoteId,
  esquemaSaltoDeLote,
  type DetalleDeSincronizacionIpc,
  type ResultadoDeSaltoDeLoteIpc,
  type ResumenDeSincronizacionIpc,
  type RespuestaIpc,
} from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';
import { requiereRol, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import type { ServicioDeSincronizacion } from '@main/sincronizacion/servicio-de-sincronizacion';
import { ejecutarConRespuesta } from './respuesta';

/** Dependencias de estos manejadores. */
export interface DependenciasDeSincronizacionIpc {
  readonly sesion: SesionActual;
  readonly servicio: ServicioDeSincronizacion;
  /** Para verificar el PIN de «saltar lote». La misma verificación de siempre. */
  readonly autenticacion: ServicioDeAutenticacion;
}

/** Registra los cuatro canales de sincronización. */
export function registrarManejadoresDeSincronizacion(
  dependencias: DependenciasDeSincronizacionIpc,
): void {
  const { sesion, servicio, autenticacion } = dependencias;

  ipcMain.handle(
    CANALES_IPC.sincronizacionResumen,
    async (): Promise<RespuestaIpc<ResumenDeSincronizacionIpc>> =>
      ejecutarConRespuesta('SINCRONIZACION_RESUMEN_FALLIDO', () => servicio.resumen()),
  );

  ipcMain.handle(
    CANALES_IPC.sincronizacionDetalle,
    async (): Promise<RespuestaIpc<DetalleDeSincronizacionIpc>> =>
      ejecutarConRespuesta('SINCRONIZACION_DETALLE_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => servicio.detalle()),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.sincronizacionReintentarLote,
    async (_evento, payload: unknown): Promise<RespuestaIpc<boolean>> =>
      ejecutarConRespuesta('SINCRONIZACION_REINTENTO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', async () => {
          const datos = esquemaLoteId.parse(payload);
          await servicio.reintentarLote(datos.loteId);
          return true;
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.sincronizacionSaltarLote,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ResultadoDeSaltoDeLoteIpc>> =>
      ejecutarConRespuesta('SINCRONIZACION_SALTO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaSaltoDeLote.parse(payload);

          const permiso = autenticacion.autorizarComoAdministrador(
            datos.pin,
            'saltar_lote_de_sincronizacion',
          );

          if (!permiso.autenticado || permiso.usuario === null) {
            const rechazo: ResultadoDeSaltoDeLoteIpc = {
              saltado: false,
              mensaje: permiso.mensaje,
              segundosParaReintentar: permiso.segundosParaReintentar,
              lote: null,
            };
            return rechazo;
          }

          try {
            const lote = servicio.saltarLote(permiso.usuario.id, datos.loteId);
            const exito: ResultadoDeSaltoDeLoteIpc = {
              saltado: true,
              mensaje: `Lote saltado: ${lote.tablas.join(', ')} (${String(lote.filas)} fila(s)).`,
              segundosParaReintentar: null,
              lote,
            };
            return exito;
          } catch (error) {
            // El lote pudo dejar de existir entre que la pantalla lo mostró y
            // que se tecleó el PIN —otro ciclo lo subió, u otro administrador
            // ya lo saltó—. Es un caso de negocio, no un fallo del canal.
            if (error instanceof ErrorDeNegocio) {
              const rechazo: ResultadoDeSaltoDeLoteIpc = {
                saltado: false,
                mensaje: error.mensajeParaElUsuario,
                segundosParaReintentar: null,
                lote: null,
              };
              return rechazo;
            }
            throw error;
          }
        }),
      ),
  );
}
