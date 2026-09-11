/**
 * Gestión de usuarios: crear, editar, cambiar el PIN y dar de baja.
 *
 * POR QUÉ EXISTE ESTE MÓDULO. Desde el Prompt 3 el sistema sabía crear UN
 * usuario: el primer administrador, en el primer arranque, y solo mientras la
 * tabla estuviera completamente vacía. Después de eso no había forma de agregar
 * a nadie. El requerimiento pedía «usuario de venta y usuario administrativo»,
 * así que la tienda no podía siquiera dar de alta a su cajero. Este módulo
 * cierra ese hueco. Ver CLAUDE.md §4.7.
 *
 * EL HASH DEL PIN NO SE REIMPLEMENTA. Se usa `@shared/auth`, el mismo módulo
 * scrypt que ya usaban el primer arranque y el ingreso. Dos implementaciones de
 * hash en el mismo proyecto es la forma más segura de terminar con usuarios que
 * no pueden entrar porque su PIN se guardó con el otro formato.
 *
 * DOS INVARIANTES QUE ESTE SERVICIO ES EL ÚNICO QUE PUEDE PROTEGER, porque el
 * esquema no los ve:
 *
 *   1. **Siempre tiene que quedar un administrador activo.** Sin eso la tienda
 *      se queda sin poder abrir caja, cargar catálogo ni gestionar usuarios, y
 *      **no hay vuelta atrás**: el primer arranque solo se ofrece cuando la
 *      tabla está VACÍA, y dar de baja no la vacía.
 *   2. **Nadie se cambia a sí mismo el rol ni se da de baja.** Es un pie en el
 *      que dispararse sin uso legítimo: quien quiera irse lo da de baja otro
 *      administrador. Además dejaría la sesión viva con una identidad que ya no
 *      corresponde a lo que dice la base.
 *   3. **Dos usuarios activos no pueden tener el mismo PIN.** La regla vive en
 *      `colision-de-pin.ts`, compartida con el servicio de autenticación, que
 *      la necesita para el PIN remoto. Allí está explicado por qué el daño no
 *      está donde parece.
 */

import type { Database } from 'better-sqlite3';

import { ErrorDeNegocio } from '@main/database/errores';
import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import { generarHashDePin } from '@shared/auth';
import { tieneFormatoDePinValido } from '@shared/pin';
import type { Rol, Usuario } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import { exigirPinNoUsado } from './colision-de-pin';

/** Acciones de usuario que quedan en la bitácora de auditoría. */
export const ACCIONES_DE_USUARIO = {
  creado: 'usuario_creado',
  editado: 'usuario_editado',
  /** Se le cambió el PIN. NUNCA se registra el PIN ni su hash. */
  pinCambiado: 'usuario_pin_cambiado',
  desactivado: 'usuario_desactivado',
  reactivado: 'usuario_reactivado',
} as const;

/** Largo máximo del nombre de un usuario. */
const LARGO_MAXIMO_DEL_NOMBRE = 60;

/** Los dos roles que existen hoy. */
const ROLES_VALIDOS: readonly Rol[] = ['venta', 'administrativo'];

/** Datos para dar de alta a alguien. */
export interface DatosDeUsuarioNuevo {
  readonly nombre: string;
  readonly rol: Rol;
  /** PIN en claro, elegido en el momento. Se hashea acá y no se guarda nunca. */
  readonly pin: string;
}

/** Lo que se puede editar sin tocar el PIN. */
export interface CambiosDeUsuario {
  readonly nombre: string;
  readonly rol: Rol;
}

/** Dependencias del servicio. */
export interface DependenciasDeUsuarios {
  /**
   * La conexión, para poder envolver la escritura en UNA transacción.
   *
   * **Este servicio no la tenía hasta la Fase 1.a de la sincronización**, y por
   * eso escribía su fila y su asiento de auditoría sueltos: un cierre forzado
   * entre los dos dejaba el hecho sin su rastro. Ahora van juntos, y con ellos
   * la entrada de la bandeja de salida (`docs/SINCRONIZACION.md` §2.4).
   */
  readonly base: Database;
  readonly usuarios: RepositorioDeUsuarios;
  readonly auditoria: RepositorioDeAuditoria;
  readonly ahora?: () => number;
}

export class ServicioDeUsuarios {
  private readonly base: Database;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeUsuarios) {
    this.base = dependencias.base;
    this.usuarios = dependencias.usuarios;
    this.auditoria = dependencias.auditoria;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /** Todos los usuarios, activos e inactivos, para la pantalla de gestión. */
  public listar(): readonly Usuario[] {
    return this.usuarios.listarTodos();
  }

  /**
   * Da de alta a alguien con el PIN que eligió en el momento.
   *
   * El PIN viaja en claro hasta acá y de acá no sale: se convierte en hash y lo
   * que se guarda es el hash. No se devuelve, no se registra en la auditoría y
   * no vuelve por IPC.
   */
  public crear(actorId: string, datos: DatosDeUsuarioNuevo): Usuario {
    const nombre = this.validarNombre(datos.nombre);
    const rol = this.validarRol(datos.rol);
    this.validarPin(datos.pin);
    exigirPinNoUsado(this.usuarios, datos.pin, null);

    return conBandejaDeSalida(this.base, () => {
      const creado = this.usuarios.crear({
        nombre,
        rol,
        pinHash: generarHashDePin(datos.pin),
      });

      const asiento = this.auditoria.registrar({
        usuarioId: actorId,
        accion: ACCIONES_DE_USUARIO.creado,
        entidadTipo: 'usuarios',
        entidadId: creado.id,
        valorNuevo: { nombre: creado.nombre, rol: creado.rol, activo: creado.activo },
        fecha: new Date(this.ahora()).toISOString(),
      });

      return {
        resultado: creado,
        entradas: [
          { tabla: 'usuarios', id: creado.id, operacion: 'insertar' },
          { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
        ],
      };
    });
  }

  /**
   * Cambia el nombre y el rol. NUNCA el PIN: eso es `cambiarPin`.
   *
   * Quitarle el rol administrativo al último administrador activo es la misma
   * catástrofe que darlo de baja, así que se bloquea igual.
   */
  public editar(actorId: string, id: string, cambios: CambiosDeUsuario): Usuario {
    const usuario = this.exigirUsuario(id);
    const nombre = this.validarNombre(cambios.nombre);
    const rol = this.validarRol(cambios.rol);

    if (rol !== usuario.rol) {
      this.exigirQueNoSeaUnoMismo(
        actorId,
        id,
        'No podés cambiarte el rol a vos mismo. Pedíselo a otro administrador.',
      );
      if (usuario.rol === 'administrativo') {
        this.exigirQueQuedeUnAdministrador(
          usuario,
          'Es el único administrador activo. Si le quitás el rol, nadie va a poder ' +
            'abrir caja, cargar productos ni crear usuarios, y no hay forma de volver atrás.',
        );
      }
    }

    return conBandejaDeSalida(this.base, () => {
      this.usuarios.actualizar(id, { nombre, rol });
      const actualizado = this.exigirUsuario(id);

      const asiento = this.auditoria.registrar({
        usuarioId: actorId,
        accion: ACCIONES_DE_USUARIO.editado,
        entidadTipo: 'usuarios',
        entidadId: id,
        valorAnterior: { nombre: usuario.nombre, rol: usuario.rol },
        valorNuevo: { nombre: actualizado.nombre, rol: actualizado.rol },
        fecha: new Date(this.ahora()).toISOString(),
      });

      return {
        resultado: actualizado,
        entradas: [
          { tabla: 'usuarios', id, operacion: 'actualizar' },
          { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
        ],
      };
    });
  }

  /**
   * Le pone un PIN nuevo a un usuario.
   *
   * NO SE PIDE EL PIN ANTERIOR, y es deliberado: el caso que hace falta
   * resolver es justamente el del cajero que lo olvidó. Exigir el viejo dejaría
   * a esa persona sin forma de volver a entrar, que es el problema que esta
   * operación existe para arreglar. Quien la ejecuta ya es un administrador con
   * sesión iniciada, y eso es lo que la autoriza.
   *
   * El PIN nuevo no se registra en la auditoría, ni en claro ni hasheado. Lo que
   * queda es el hecho: a quién se le cambió, quién lo cambió y cuándo.
   */
  public cambiarPin(actorId: string, id: string, pinNuevo: string): Usuario {
    const usuario = this.exigirUsuario(id);
    this.validarPin(pinNuevo);
    // Se excluye a la propia persona: volver a ponerle el PIN que ya tenía no
    // es una colisión, es una operación que no cambia nada, y rechazarla con
    // «ese PIN ya está en uso» sería desconcertante.
    exigirPinNoUsado(this.usuarios, pinNuevo, id);

    return conBandejaDeSalida(this.base, () => {
      this.usuarios.actualizarPinHash(id, generarHashDePin(pinNuevo));

      const asiento = this.auditoria.registrar({
        usuarioId: actorId,
        accion: ACCIONES_DE_USUARIO.pinCambiado,
        entidadTipo: 'usuarios',
        entidadId: id,
        valorNuevo: { nombre: usuario.nombre, cambiadoPorOtraPersona: actorId !== id },
        fecha: new Date(this.ahora()).toISOString(),
      });

      return {
        resultado: this.exigirUsuario(id),
        entradas: [
          { tabla: 'usuarios', id, operacion: 'actualizar' },
          { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
        ],
      };
    });
  }

  /**
   * Da de baja o vuelve a habilitar a alguien. NUNCA se borra.
   *
   * Un usuario inactivo no aparece en la pantalla de ingreso y no puede entrar
   * aunque acierte el PIN, pero sus ventas y sus asientos de auditoría quedan
   * intactos: son el historial de la tienda y no le pertenecen a la cuenta.
   */
  public fijarActivo(actorId: string, id: string, activo: boolean): Usuario {
    const usuario = this.exigirUsuario(id);

    if (usuario.activo === activo) {
      return usuario;
    }

    if (!activo) {
      this.exigirQueNoSeaUnoMismo(
        actorId,
        id,
        'No podés darte de baja a vos mismo. Pedíselo a otro administrador.',
      );
      this.exigirQueQuedeUnAdministrador(
        usuario,
        'Es el único administrador activo. Si lo das de baja, nadie va a poder abrir ' +
          'caja, cargar productos ni crear usuarios, y no hay forma de volver atrás.',
      );
    }

    return conBandejaDeSalida(this.base, () => {
      this.usuarios.fijarActivo(id, activo);

      const asiento = this.auditoria.registrar({
        usuarioId: actorId,
        accion: activo ? ACCIONES_DE_USUARIO.reactivado : ACCIONES_DE_USUARIO.desactivado,
        entidadTipo: 'usuarios',
        entidadId: id,
        valorAnterior: { activo: usuario.activo },
        valorNuevo: { nombre: usuario.nombre, rol: usuario.rol, activo },
        fecha: new Date(this.ahora()).toISOString(),
      });

      return {
        resultado: this.exigirUsuario(id),
        entradas: [
          { tabla: 'usuarios', id, operacion: 'actualizar' },
          { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
        ],
      };
    });
  }

  // -------------------------------------------------------------------------
  // Validaciones
  // -------------------------------------------------------------------------

  /**
   * Normaliza y valida el nombre ANTES de tocar la base.
   *
   * Que no se repita lo hace cumplir el UNIQUE del esquema, y su error ya se
   * traduce a `REGISTRO_DUPLICADO`. Acá se comprueba lo que la base no puede
   * decir con un mensaje legible: que no venga vacío ni absurdamente largo.
   */
  private validarNombre(nombre: string): string {
    const limpio = nombre.trim();

    if (limpio === '') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El usuario necesita un nombre.',
        'Nombre de usuario vacío.',
      );
    }
    if (limpio.length > LARGO_MAXIMO_DEL_NOMBRE) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El nombre no puede pasar de ${String(LARGO_MAXIMO_DEL_NOMBRE)} caracteres.`,
        `Nombre de ${String(limpio.length)} caracteres.`,
      );
    }
    return limpio;
  }

  private validarRol(rol: Rol): Rol {
    if (!ROLES_VALIDOS.includes(rol)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El rol tiene que ser «venta» o «administrativo».',
        `Rol desconocido: ${rol}`,
      );
    }
    return rol;
  }

  /**
   * El PIN usa las MISMAS reglas de formato que el resto del sistema
   * (`@shared/pin`), no unas propias: un PIN que se pudiera crear acá y que
   * después la pantalla de ingreso no aceptara dejaría a esa persona afuera.
   */
  private validarPin(pin: string): void {
    if (!tieneFormatoDePinValido(pin)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El PIN tiene que ser de cuatro dígitos.',
        'Formato de PIN inválido.',
      );
    }
  }

  private exigirUsuario(id: string): Usuario {
    const usuario = this.usuarios.obtenerPorId(id);
    if (usuario === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'No se encontró el usuario.',
        `usuario_id inexistente: ${id}`,
      );
    }
    return usuario;
  }

  private exigirQueNoSeaUnoMismo(actorId: string, id: string, mensaje: string): void {
    if (actorId === id) {
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        mensaje,
        `El usuario ${id} intentó cambiarse a sí mismo el rol o su estado.`,
      );
    }
  }

  /**
   * Impide dejar la instalación sin ningún administrador activo.
   *
   * Es el invariante que ninguna otra capa puede proteger: el esquema no sabe
   * contar administradores, y la pantalla se puede saltar llamando al canal.
   */
  private exigirQueQuedeUnAdministrador(usuario: Usuario, mensaje: string): void {
    if (usuario.rol !== 'administrativo' || !usuario.activo) {
      return;
    }
    if (this.usuarios.contarAdministradoresActivos() <= 1) {
      throw new ErrorDeNegocio('PERMISO_DENEGADO', mensaje, 'Quedaría cero administradores activos.');
    }
  }
}
