/**
 * Manejadores IPC de la gestión de usuarios.
 *
 * TODOS exigen rol administrativo, y lo hace cumplir `requiereRol` en el
 * proceso principal. Que la pantalla esconda el botón es comodidad, no control:
 * un renderer comprometido invoca el canal igual, y ahí es donde el guard tiene
 * que estar. Es la misma regla que ya rige para el catálogo.
 *
 * QUÉ NO CRUZA HACIA LA VENTANA: ni `pin_hash` ni `pin_remoto_hash`. El hash no
 * le sirve de nada a la interfaz y exponerlo pondría al alcance de un renderer
 * comprometido el material con el que atacar los PIN fuera de línea. Lo que sí
 * viaja es si el PIN remoto está configurado, que es un sí o un no.
 *
 * QUIÉN ES EL ACTOR sale SIEMPRE de la sesión del proceso principal, nunca del
 * payload: si viniera del mensaje, cualquiera podría firmar sus cambios con el
 * nombre de otro administrador en la auditoría.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaCambioDePin,
  esquemaFijarActivo,
  esquemaUsuarioEditado,
  esquemaUsuarioNuevo,
  type RespuestaIpc,
  type UsuarioIpc,
} from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';
import type { Usuario } from '@main/database/repositories/entidades';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import { requiereRol, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import { ejecutarConRespuesta } from './respuesta';

/** Dependencias que necesitan los manejadores de usuarios. */
export interface DependenciasDeUsuariosIpc {
  readonly sesion: SesionActual;
  readonly usuarios: ServicioDeUsuarios;
  /** Solo para contar administradores activos, que es un dato de la vista. */
  readonly repositorioDeUsuarios: RepositorioDeUsuarios;
  readonly ahora?: () => number;
}

/** Id del usuario en sesión, o falla. El guard ya comprobó que hay uno. */
function actorEnSesion(sesion: SesionActual): string {
  const enSesion = sesion.obtener();
  if (enSesion === null) {
    throw new ErrorDeNegocio(
      'PERMISO_DENEGADO',
      'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
      'Se llegó a un manejador de usuarios sin sesión.',
    );
  }
  return enSesion.id;
}

/** Registra los canales de gestión de usuarios. */
export function registrarManejadoresDeUsuarios(
  dependencias: DependenciasDeUsuariosIpc,
): void {
  const { sesion, usuarios, repositorioDeUsuarios } = dependencias;
  const ahora = dependencias.ahora ?? ((): number => Date.now());

  /** Traduce la entidad al DTO, sin hashes y con lo que la pantalla necesita. */
  function aDto(usuario: Usuario, actorId: string, administradoresActivos: number): UsuarioIpc {
    const bloqueado =
      usuario.bloqueadoHasta !== null && Date.parse(usuario.bloqueadoHasta) > ahora();

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      activo: usuario.activo,
      tienePinRemoto: usuario.pinRemotoHash !== null,
      bloqueado,
      esUnoMismo: usuario.id === actorId,
      // Se calcula acá y no en la pantalla porque depende de contar filas de la
      // base. La pantalla lo usa para EXPLICAR por qué no se puede dar de baja,
      // en vez de dejar que el intento falle con un mensaje que llega tarde.
      esElUnicoAdministrador:
        usuario.rol === 'administrativo' && usuario.activo && administradoresActivos <= 1,
      creadoEn: usuario.creadoEn,
    };
  }

  /** El usuario ya traducido, con el conteo recién leído. */
  function traducir(usuario: Usuario, actorId: string): UsuarioIpc {
    return aDto(usuario, actorId, repositorioDeUsuarios.contarAdministradoresActivos());
  }

  ipcMain.handle(
    CANALES_IPC.usuariosListar,
    async (): Promise<RespuestaIpc<readonly UsuarioIpc[]>> =>
      ejecutarConRespuesta('USUARIOS_LISTAR_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const actorId = actorEnSesion(sesion);
          // Se cuenta UNA vez para toda la lista, y no una por fila.
          const administradores = repositorioDeUsuarios.contarAdministradoresActivos();
          return usuarios.listar().map((usuario) => aDto(usuario, actorId, administradores));
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.usuariosCrear,
    async (_evento, payload: unknown): Promise<RespuestaIpc<UsuarioIpc>> =>
      ejecutarConRespuesta('USUARIO_CREAR_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaUsuarioNuevo.parse(payload);
          const actorId = actorEnSesion(sesion);
          return traducir(usuarios.crear(actorId, datos), actorId);
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.usuariosEditar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<UsuarioIpc>> =>
      ejecutarConRespuesta('USUARIO_EDITAR_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaUsuarioEditado.parse(payload);
          const actorId = actorEnSesion(sesion);
          const editado = usuarios.editar(actorId, datos.id, {
            nombre: datos.nombre,
            rol: datos.rol,
          });
          return traducir(editado, actorId);
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.usuariosCambiarPin,
    async (_evento, payload: unknown): Promise<RespuestaIpc<UsuarioIpc>> =>
      ejecutarConRespuesta('USUARIO_CAMBIAR_PIN_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaCambioDePin.parse(payload);
          const actorId = actorEnSesion(sesion);
          return traducir(usuarios.cambiarPin(actorId, datos.id, datos.pin), actorId);
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.usuariosFijarActivo,
    async (_evento, payload: unknown): Promise<RespuestaIpc<UsuarioIpc>> =>
      ejecutarConRespuesta('USUARIO_FIJAR_ACTIVO_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaFijarActivo.parse(payload);
          const actorId = actorEnSesion(sesion);
          return traducir(usuarios.fijarActivo(actorId, datos.id, datos.activo), actorId);
        }),
      ),
  );
}
