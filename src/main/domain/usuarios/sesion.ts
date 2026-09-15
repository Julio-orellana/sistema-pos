/**
 * Sesión en memoria y control de permisos por rol.
 *
 * LA SESIÓN NO SE PERSISTE, a propósito. Esta es una terminal compartida en un
 * mostrador: si la sesión sobreviviera al reinicio, el primero que encienda la
 * computadora por la mañana quedaría actuando con la identidad de quien la
 * apagó anoche, y la auditoría atribuiría sus ventas a otra persona. Cada
 * arranque exige ingresar de nuevo.
 */

import { ErrorDeNegocio } from '@main/database/errores';
import type { Rol, Usuario } from '@main/database/repositories/entidades';

/** Quién está usando la caja en este momento. */
export interface UsuarioEnSesion {
  readonly id: string;
  readonly nombre: string;
  readonly rol: Rol;
  /** Momento (ISO-8601 UTC) en que ingresó. */
  readonly desde: string;
}

/**
 * Estado de sesión del proceso principal.
 *
 * Vive solo aquí. El renderer nunca decide quién está autenticado: pregunta, y
 * el proceso principal responde. Una interfaz comprometida no puede inventarse
 * una sesión de administrador.
 */
export class SesionActual {
  private usuario: UsuarioEnSesion | null = null;
  private readonly ahora: () => number;

  public constructor(ahora: () => number = () => Date.now()) {
    this.ahora = ahora;
  }

  /** Abre sesión para un usuario ya autenticado. */
  public iniciar(usuario: Usuario): UsuarioEnSesion {
    this.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      desde: new Date(this.ahora()).toISOString(),
    };
    return this.usuario;
  }

  /** Cierra la sesión. */
  public cerrar(): void {
    this.usuario = null;
  }

  /** Quién está en sesión, o `null` si no hay nadie. */
  public obtener(): UsuarioEnSesion | null {
    return this.usuario;
  }

  /** ¿Hay alguien autenticado? */
  public haySesion(): boolean {
    return this.usuario !== null;
  }
}

/**
 * Guard de permisos para los canales IPC.
 *
 * CÓMO SE USA EN UN MÓDULO FUTURO: se envuelve la operación del manejador,
 * nunca se comprueba el rol a mano dentro de la operación. Así la comprobación
 * es imposible de olvidar y de escribir distinto en cada módulo.
 *
 *     ipcMain.handle(CANALES_IPC.cajaAbrir, async (_evento, payload) =>
 *       ejecutarConRespuesta('CAJA_APERTURA_FALLIDA', () =>
 *         requiereRol(sesion, 'administrativo', () => {
 *           const datos = esquemaAperturaDeCaja.parse(payload);
 *           return servicioDeCaja.abrir(datos);
 *         }),
 *       ),
 *     );
 *
 * Si el usuario en sesión no cumple, lanza `ErrorDeNegocio` con código
 * `PERMISO_DENEGADO` y la operación NO se ejecuta. Nunca falla en silencio ni
 * deja pasar la acción.
 */
export function requiereRol<T>(sesion: SesionActual, rol: Rol, operacion: () => T): T {
  const usuario = sesion.obtener();

  if (usuario === null) {
    throw new ErrorDeNegocio(
      'PERMISO_DENEGADO',
      'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
      'Se intentó ejecutar una acción protegida sin sesión.',
    );
  }

  if (usuario.rol !== rol) {
    throw new ErrorDeNegocio(
      'PERMISO_DENEGADO',
      `Esta acción requiere el rol "${rol}" y tu usuario tiene el rol "${usuario.rol}".`,
      `Usuario ${usuario.id} con rol ${usuario.rol} intentó una acción que exige ${rol}.`,
    );
  }

  return operacion();
}

/**
 * Variante que solo exige que haya alguien autenticado, sin importar el rol.
 * Es el mínimo para cualquier acción que no sea el propio ingreso.
 */
export function requiereSesion<T>(sesion: SesionActual, operacion: () => T): T {
  if (sesion.obtener() === null) {
    throw new ErrorDeNegocio(
      'PERMISO_DENEGADO',
      'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
      'Se intentó ejecutar una acción protegida sin sesión.',
    );
  }
  return operacion();
}
