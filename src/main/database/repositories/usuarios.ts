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
  readonly totp_secreto_cifrado: Buffer | null;
  readonly totp_ultimo_paso: number | null;
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
    totpSecretoCifrado: fila.totp_secreto_cifrado,
    totpUltimoPaso: fila.totp_ultimo_paso,
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

  /**
   * TODOS los usuarios, activos e inactivos, con los activos primero.
   *
   * Es la vista de la pantalla de administración, la única que necesita ver a
   * los inactivos: `listarActivos` sigue siendo lo que usa la pantalla de
   * ingreso, que no debe ofrecer a nadie dado de baja.
   */
  public listarTodos(): Usuario[] {
    const filas = this.base
      .prepare('SELECT * FROM usuarios ORDER BY activo DESC, nombre')
      .all() as FilaUsuario[];
    return filas.map(aEntidad);
  }

  /**
   * Cambia el nombre y el rol.
   *
   * NO toca el PIN, y no es un olvido: cambiarlo es una acción aparte
   * (`actualizarPinHash`), con su propio flujo en la pantalla, porque es
   * información sensible y no un campo más del formulario.
   */
  public actualizar(id: string, cambios: { readonly nombre: string; readonly rol: Rol }): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          'UPDATE usuarios SET nombre = @nombre, rol = @rol, actualizado_en = @actualizado_en WHERE id = @id',
        )
        .run({ id, nombre: cambios.nombre, rol: cambios.rol, actualizado_en: ahora() });
    });
  }

  /**
   * Baja o alta lógica. Nunca se borra un usuario, porque sus ventas y sus
   * asientos de auditoría lo referencian.
   *
   * Al REACTIVAR se limpia el bloqueo por intentos: si alguien quedó bloqueado
   * y después se lo dio de baja, volver a habilitarlo con el candado todavía
   * puesto lo dejaría sin poder entrar por una razón que ya nadie recuerda.
   */
  public fijarActivo(id: string, activo: boolean): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE usuarios
              SET activo = @activo,
                  intentos_fallidos = CASE WHEN @activo = 1 THEN 0 ELSE intentos_fallidos END,
                  bloqueado_hasta   = CASE WHEN @activo = 1 THEN NULL ELSE bloqueado_hasta END,
                  actualizado_en = @actualizado_en
            WHERE id = @id`,
        )
        .run({ id, activo: aColumnaBooleana(activo), actualizado_en: ahora() });
    });
  }

  /** Baja lógica: nunca se borra un usuario, porque sus ventas lo referencian. */
  public desactivar(id: string): void {
    this.fijarActivo(id, false);
  }

  /**
   * Guarda el secreto de TOTP YA CIFRADO de una persona, y reinicia su último
   * paso usado: un secreto nuevo empieza sin códigos consumidos.
   *
   * Recibe bytes cifrados y nunca el secreto en claro: este repositorio no sabe
   * cifrar ni tiene por qué ver el secreto. Reemplazar uno anterior es escribir
   * encima; el viejo deja de existir.
   */
  public fijarTotpCifrado(id: string, cifrado: Buffer): void {
    this.ejecutar(() => {
      this.base
        .prepare(
          `UPDATE usuarios
              SET totp_secreto_cifrado = ?, totp_ultimo_paso = NULL, actualizado_en = ?
            WHERE id = ?`,
        )
        .run(cifrado, ahora(), id);
    });
  }

  /**
   * Consume un paso de TOTP: lo anota como el último usado SOLO si es posterior
   * al último anotado. Es un comparar-y-cambiar: dos autorizaciones con el
   * mismo código no pueden pasar las dos.
   *
   * No toca `actualizado_en`: es estado operativo de esta terminal, como el
   * contador de intentos, y no un cambio del usuario.
   *
   * Devuelve `false` si ese paso (o uno posterior) ya se había usado.
   */
  public consumirPasoTotp(id: string, paso: number): boolean {
    return this.ejecutar(() => {
      const resultado = this.base
        .prepare(
          `UPDATE usuarios
              SET totp_ultimo_paso = @paso
            WHERE id = @id
              AND totp_secreto_cifrado IS NOT NULL
              AND (totp_ultimo_paso IS NULL OR totp_ultimo_paso < @paso)`,
        )
        .run({ id, paso });
      return resultado.changes === 1;
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
