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
 *   3. **Dos usuarios activos no pueden tener el mismo PIN.** Ver
 *      `exigirPinNoUsado`, que explica por qué el daño no está donde parece.
 */

import { ErrorDeNegocio } from '@main/database/errores';
import { generarHashDePin, verificarPin } from '@shared/auth';
import { tieneFormatoDePinValido } from '@shared/pin';
import type { Rol, Usuario } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';

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
  readonly usuarios: RepositorioDeUsuarios;
  readonly auditoria: RepositorioDeAuditoria;
  readonly ahora?: () => number;
}

export class ServicioDeUsuarios {
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeUsuarios) {
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
    this.exigirPinNoUsado(datos.pin, null);

    const creado = this.usuarios.crear({
      nombre,
      rol,
      pinHash: generarHashDePin(datos.pin),
    });

    this.auditoria.registrar({
      usuarioId: actorId,
      accion: ACCIONES_DE_USUARIO.creado,
      entidadTipo: 'usuarios',
      entidadId: creado.id,
      valorNuevo: { nombre: creado.nombre, rol: creado.rol, activo: creado.activo },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return creado;
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

    this.usuarios.actualizar(id, { nombre, rol });
    const actualizado = this.exigirUsuario(id);

    this.auditoria.registrar({
      usuarioId: actorId,
      accion: ACCIONES_DE_USUARIO.editado,
      entidadTipo: 'usuarios',
      entidadId: id,
      valorAnterior: { nombre: usuario.nombre, rol: usuario.rol },
      valorNuevo: { nombre: actualizado.nombre, rol: actualizado.rol },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return actualizado;
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
    this.exigirPinNoUsado(pinNuevo, id);

    this.usuarios.actualizarPinHash(id, generarHashDePin(pinNuevo));

    this.auditoria.registrar({
      usuarioId: actorId,
      accion: ACCIONES_DE_USUARIO.pinCambiado,
      entidadTipo: 'usuarios',
      entidadId: id,
      valorNuevo: { nombre: usuario.nombre, cambiadoPorOtraPersona: actorId !== id },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return this.exigirUsuario(id);
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

    this.usuarios.fijarActivo(id, activo);

    this.auditoria.registrar({
      usuarioId: actorId,
      accion: activo ? ACCIONES_DE_USUARIO.reactivado : ACCIONES_DE_USUARIO.desactivado,
      entidadTipo: 'usuarios',
      entidadId: id,
      valorAnterior: { activo: usuario.activo },
      valorNuevo: { nombre: usuario.nombre, rol: usuario.rol, activo },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return this.exigirUsuario(id);
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

  /**
   * Impide que dos usuarios ACTIVOS compartan el mismo PIN.
   *
   * DÓNDE ESTÁ EL DAÑO DE VERDAD, que no es donde parece. En el ingreso la
   * colisión es molesta pero acotada: primero se elige el nombre y después se
   * teclea, así que compartir PIN solo significa que una persona puede entrar
   * como otra si sabe que lo comparten. **El problema serio está en el diálogo
   * de autorización**, que prueba el PIN contra TODOS los administradores
   * activos y se queda con el primero que coincida (§4.9). Con dos PIN iguales,
   * `descuento_autorizado_por` y `diferencia_autorizada_por` terminan nombrando
   * a la persona equivocada, en silencio y sin forma de detectarlo después. En
   * un sistema cuyo valor es la auditoría, eso es peor que la suplantación.
   *
   * SE APLICA A LOS DOS ROLES aunque el riesgo esté concentrado en el
   * administrativo. Una sola regla general es más barata de mantener que dos
   * casos distintos, y un usuario de venta puede pasar a administrativo con una
   * edición: la excepción envejecería mal en cuanto alguien cambie de rol.
   *
   * SOLO CUENTAN LOS ACTIVOS. Alguien dado de baja no inicia sesión ni autoriza
   * nada, así que su PIN no puede provocar ninguna de las dos confusiones. Si
   * vuelve a habilitarse podría colisionar, pero exigir que el universo entero
   * de PIN históricos quede reservado para siempre iría achicando el espacio
   * disponible sin que nadie entienda por qué.
   *
   * SE COMPARA EL PIN EN CLARO CONTRA CADA HASH, uno por uno, porque dos hash
   * scrypt del mismo PIN son distintos: cada usuario tiene su propia sal, que
   * es justamente lo que impide deducir mirando la tabla quiénes lo comparten
   * (§4.7). Eso obliga a una verificación por usuario activo, y scrypt es lento
   * a propósito: con una decena de usuarios es cerca de un segundo. Es
   * aceptable acá —crear un usuario es una acción de administrador, no algo que
   * pase en el mostrador— y sería inaceptable en el ingreso.
   *
   * TAMBIÉN SE MIRA EL PIN REMOTO de cada uno, porque el diálogo de
   * autorización prueba los dos: un PIN nuevo que coincida con el PIN remoto de
   * un administrador produce exactamente la misma atribución equivocada.
   */
  private exigirPinNoUsado(pin: string, exceptoUsuarioId: string | null): void {
    const yaEstaEnUso = this.usuarios
      .listarActivos()
      .filter((otro) => otro.id !== exceptoUsuarioId)
      .some((otro) => this.coincideCon(pin, otro));

    if (yaEstaEnUso) {
      /*
        EL MENSAJE NO DICE DE QUIÉN ES, ni lo insinúa, y la causa técnica
        tampoco lleva el id. Decirlo convertiría este control en una forma de
        averiguar el PIN de otra persona por eliminación: bastaría probar
        combinaciones al crear usuarios y leer a quién nombra el rechazo.
      */
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Ese PIN ya está en uso. Elegí otro.',
        'El PIN coincide con el de otro usuario activo.',
      );
    }
  }

  /** ¿Este PIN es el de esta persona, por cualquiera de sus dos vías? */
  private coincideCon(pin: string, usuario: Usuario): boolean {
    try {
      if (verificarPin(pin, usuario.pinHash)) {
        return true;
      }
      return usuario.pinRemotoHash !== null && verificarPin(pin, usuario.pinRemotoHash);
    } catch {
      /*
        Un hash ilegible no se puede comparar, así que no se puede afirmar que
        haya colisión. Se lo trata como que no coincide en vez de tumbar el alta:
        una fila corrupta ya deja a ESA persona sin poder entrar —el ingreso
        falla igual—, y bloquear además la creación de cualquier usuario nuevo
        convertiría un problema de una fila en un sistema que no deja trabajar.
      */
      return false;
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
