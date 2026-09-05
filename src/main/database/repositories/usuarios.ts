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
  readonly activo: number;
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
    activo: desdeColumnaBooleana(fila.activo, 'usuarios.activo'),
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

  public actualizarPinHash(id: string, pinHash: string): void {
    this.ejecutar(() => {
      this.base
        .prepare('UPDATE usuarios SET pin_hash = ?, actualizado_en = ? WHERE id = ?')
        .run(pinHash, ahora(), id);
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
