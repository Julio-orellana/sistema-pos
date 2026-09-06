/** Acceso a datos de usuarios. Sin lógica de negocio. */

import type { NuevoUsuario, Rol, Usuario } from './entidades';
import { RepositorioBase, ahora, nuevoId } from './base';
import { aColumnaBooleana, desdeColumnaBooleana } from '../decimal-columns';

/** Fila cruda de la tabla `usuarios`. */
interface FilaUsuario {
  readonly id: string;
  readonly nombre: string;
  readonly rol: Rol;
  readonly pin_hash: string;
  readonly pin_remoto_hash: string | null;
  readonly activo: number;
  readonly intentos_fallidos: number;
  readonly bloqueado_hasta: string | null;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

/** Traduce una fila de SQLite a la entidad del dominio. */
function aEntidad(fila: FilaUsuario): Usuario {
  return {
    id: fila.id,
    nombre: fila.nombre,
    rol: fila.rol,
    pinHash: fila.pin_hash,
    pinRemotoHash: fila.pin_remoto_hash,
    activo: desdeColumnaBooleana(fila.activo, 'usuarios.activo'),
    intentosFallidos: fila.intentos_fallidos,
    bloqueadoHasta: fila.bloqueado_hasta,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export class RepositorioDeUsuarios extends RepositorioBase {
  public crear(datos: NuevoUsuario): Usuario {
    const id = nuevoId();
    const momento = ahora();

    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO usuarios (id, nombre, rol, pin_hash, activo, creado_en, actualizado_en)
           VALUES (@id, @nombre, @rol, @pin_hash, @activo, @creado_en, @actualizado_en)`,
        )
        .run({
          id,
          nombre: datos.nombre,
          rol: datos.rol,
          pin_hash: datos.pinHash,
          activo: aColumnaBooleana(datos.activo ?? true),
          creado_en: momento,
          actualizado_en: momento,
        });
    });

    return this.obtenerPorIdOFallar(id);
  }

  public obtenerPorId(id: string): Usuario | null {
    const fila = this.base.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) as
      | FilaUsuario
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public obtenerPorNombre(nombre: string): Usuario | null {
    const fila = this.base.prepare('SELECT * FROM usuarios WHERE nombre = ?').get(nombre) as
      | FilaUsuario
      | undefined;
    return fila === undefined ? null : aEntidad(fila);
  }

  public listarActivos(): Usuario[] {
    const filas = this.base
      .prepare('SELECT * FROM usuarios WHERE activo = 1 ORDER BY nombre')
      .all() as FilaUsuario[];
    return filas.map(aEntidad);
  }

  public listarPorRol(rol: Rol): Usuario[] {
    const filas = this.base
      .prepare('SELECT * FROM usuarios WHERE rol = ? AND activo = 1 ORDER BY nombre')
      .all(rol) as FilaUsuario[];
    return filas.map(aEntidad);
  }

  /** Baja lógica: nunca se borra un usuario, porque sus ventas lo referencian. */
  public desactivar(id: string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE usuarios SET activo = 0, actualizado_en = ? WHERE id = ?')
        .run(ahora(), id);
    });
  }

  /**
   * Fija el hash del PIN de autorización remota. `null` lo desconfigura.
   * Es una columna aparte de `pin_hash` a propósito: ver CLAUDE.md §4.9.
   */
  public actualizarPinRemotoHash(id: string, pinRemotoHash: string | null): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE usuarios SET pin_remoto_hash = ?, actualizado_en = ? WHERE id = ?')
        .run(pinRemotoHash, ahora(), id);
    });
  }

  public actualizarPinHash(id: string, pinHash: string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE usuarios SET pin_hash = ?, actualizado_en = ? WHERE id = ?')
        .run(pinHash, ahora(), id);
    });
  }

  /** ¿Hay algún usuario en la tabla? Decide si toca el primer arranque. */
  public estaVacia(): boolean {
    const fila = this.base.prepare('SELECT COUNT(*) AS total FROM usuarios').get() as {
      readonly total: number;
    };
    return fila.total === 0;
  }

  /** Cuántos administradores activos hay. Se usa para no quedarse sin ninguno. */
  public contarAdministradoresActivos(): number {
    const fila = this.base
      .prepare("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'administrativo' AND activo = 1")
      .get() as { readonly total: number };
    return fila.total;
  }

  /**
   * Guarda el estado del limitador de intentos de un usuario.
   *
   * Se escriben los dos campos juntos y en una sola operación porque siempre
   * cambian juntos: no tiene sentido un contador en 3 sin bloqueo, ni un
   * bloqueo con el contador en 0.
   */
  public fijarEstadoDeBloqueo(
    id: string,
    intentosFallidos: number,
    bloqueadoHasta: string | null,
  ): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE usuarios
              SET intentos_fallidos = ?, bloqueado_hasta = ?, actualizado_en = ?
            WHERE id = ?`,
        )
        .run(intentosFallidos, bloqueadoHasta, ahora(), id);
    });
  }

  private obtenerPorIdOFallar(id: string): Usuario {
    const usuario = this.obtenerPorId(id);
    if (usuario === null) {
      throw new Error(`No se encontró el usuario recién creado con id ${id}.`);
    }
    return usuario;
  }
}
