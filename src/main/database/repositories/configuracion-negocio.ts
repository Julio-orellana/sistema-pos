/** Acceso a datos de la configuración del negocio. Fila única. */

import type { ConfiguracionNegocio, CambiosDeConfiguracion } from './entidades';
import { RepositorioBase, ahora } from './base';

/**
 * La única fila posible.
 *
 * No es un UUID: la tabla tiene un CHECK que exige exactamente esta constante,
 * y como además es la llave primaria, no puede haber dos filas. Ver la cabecera
 * de la migración 016.
 */
const ID_UNICO = 'unica';

/** Fila cruda de la tabla. Las cuatro columnas de datos pueden ser NULL. */
interface FilaConfiguracion {
  readonly id: string;
  readonly nombre_comercial: string | null;
  readonly direccion: string | null;
  readonly telefono: string | null;
  readonly nit: string | null;
  readonly actualizado_en: string;
}

function aEntidad(fila: FilaConfiguracion): ConfiguracionNegocio {
  return {
    nombreComercial: fila.nombre_comercial,
    direccion: fila.direccion,
    telefono: fila.telefono,
    nit: fila.nit,
    actualizadoEn: fila.actualizado_en,
  };
}

/** Configuración vacía, para una base que todavía no corrió la migración 016. */
const VACIA: ConfiguracionNegocio = {
  nombreComercial: null,
  direccion: null,
  telefono: null,
  nit: null,
  actualizadoEn: '',
};

export class RepositorioDeConfiguracionDeNegocio extends RepositorioBase {
  /**
   * La configuración actual. NUNCA devuelve `null`.
   *
   * La migración siembra la fila vacía, así que siempre hay algo que leer. Y si
   * por lo que fuera no estuviera, se devuelve una configuración vacía en vez
   * de `null`: para el recibo «no hay fila» y «la fila está vacía» son el mismo
   * estado del negocio —no está configurado— y obligar a cada llamador a
   * distinguirlos solo abriría la puerta a que alguno se olvide.
   */
  public obtener(): ConfiguracionNegocio {
    const fila = this.base
      .prepare('SELECT * FROM configuracion_negocio WHERE id = ?')
      .get(ID_UNICO) as FilaConfiguracion | undefined;
    return fila === undefined ? VACIA : aEntidad(fila);
  }

  /**
   * Guarda los cuatro campos de una sola vez.
   *
   * Se escriben SIEMPRE los cuatro, y no solo los que cambiaron: la pantalla
   * muestra el formulario completo, así que borrar un campo es una edición
   * legítima y tiene que poder guardarse como NULL.
   *
   * `INSERT ... ON CONFLICT` en vez de un `UPDATE` a secas para que funcione
   * igual si la fila sembrada por la migración no estuviera.
   */
  public guardar(cambios: CambiosDeConfiguracion): ConfiguracionNegocio {
    this.ejecutar(() => {
      this.base
        .prepare(
          `INSERT INTO configuracion_negocio
             (id, nombre_comercial, direccion, telefono, nit, actualizado_en)
           VALUES (@id, @nombre_comercial, @direccion, @telefono, @nit, @actualizado_en)
           ON CONFLICT (id) DO UPDATE SET
             nombre_comercial = excluded.nombre_comercial,
             direccion        = excluded.direccion,
             telefono         = excluded.telefono,
             nit              = excluded.nit,
             actualizado_en   = excluded.actualizado_en`,
        )
        .run({
          id: ID_UNICO,
          nombre_comercial: cambios.nombreComercial,
          direccion: cambios.direccion,
          telefono: cambios.telefono,
          nit: cambios.nit,
          actualizado_en: ahora(),
        });
    });

    return this.obtener();
  }
}
