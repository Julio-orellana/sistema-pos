/**
 * Los datos de la tienda que encabezan el recibo.
 *
 * Es la configuración más chica del sistema y aun así tiene servicio propio, no
 * porque la validación sea compleja sino porque **cambiarla cambia un documento
 * que se le entrega al cliente**, y eso tiene que quedar en la auditoría: quién
 * cambió el NIT del negocio y cuándo es exactamente la clase de pregunta que un
 * auditor hace.
 *
 * NORMALIZA A `null`, NUNCA A CADENA VACÍA. Un campo que se borra queda en
 * `null`, que es lo único que el esquema acepta como «sin configurar». Si
 * quedara como `''` habría dos formas de estar vacío y el recibo tendría que
 * conocer las dos para decidir si pone el marcador.
 */

import { ErrorDeNegocio } from '@main/database/errores';
import type {
  CambiosDeConfiguracion,
  ConfiguracionNegocio,
} from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeConfiguracionDeNegocio } from '@main/database/repositories/configuracion-negocio';

/** Acción de configuración que queda en la bitácora de auditoría. */
export const ACCIONES_DE_NEGOCIO = {
  configuracionEditada: 'configuracion_negocio_editada',
} as const;

/** Largo máximo de cada campo. */
const LARGOS_MAXIMOS = {
  nombreComercial: 80,
  direccion: 160,
  telefono: 40,
  nit: 20,
} as const;

/** Dependencias del servicio. */
export interface DependenciasDeConfiguracion {
  readonly configuracion: RepositorioDeConfiguracionDeNegocio;
  readonly auditoria: RepositorioDeAuditoria;
  readonly ahora?: () => number;
}

export class ServicioDeConfiguracionDeNegocio {
  private readonly configuracion: RepositorioDeConfiguracionDeNegocio;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeConfiguracion) {
    this.configuracion = dependencias.configuracion;
    this.auditoria = dependencias.auditoria;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  public obtener(): ConfiguracionNegocio {
    return this.configuracion.obtener();
  }

  /** Guarda los cuatro campos y deja el cambio en la auditoría. */
  public guardar(actorId: string, cambios: CambiosDeConfiguracion): ConfiguracionNegocio {
    const anterior = this.configuracion.obtener();

    const limpios: CambiosDeConfiguracion = {
      nombreComercial: this.normalizar(
        cambios.nombreComercial,
        LARGOS_MAXIMOS.nombreComercial,
        'El nombre del negocio',
      ),
      direccion: this.normalizar(cambios.direccion, LARGOS_MAXIMOS.direccion, 'La dirección'),
      telefono: this.normalizar(cambios.telefono, LARGOS_MAXIMOS.telefono, 'El teléfono'),
      nit: this.normalizar(cambios.nit, LARGOS_MAXIMOS.nit, 'El NIT'),
    };

    const guardada = this.configuracion.guardar(limpios);

    this.auditoria.registrar({
      usuarioId: actorId,
      accion: ACCIONES_DE_NEGOCIO.configuracionEditada,
      entidadTipo: 'configuracion_negocio',
      entidadId: null,
      valorAnterior: {
        nombreComercial: anterior.nombreComercial,
        direccion: anterior.direccion,
        telefono: anterior.telefono,
        nit: anterior.nit,
      },
      valorNuevo: {
        nombreComercial: guardada.nombreComercial,
        direccion: guardada.direccion,
        telefono: guardada.telefono,
        nit: guardada.nit,
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return guardada;
  }

  /**
   * Un campo limpio, o `null` si quedó vacío.
   *
   * Los cuatro campos son OPCIONALES a propósito: los datos reales de Jimmy
   * todavía no llegaron, y obligar a llenarlos para poder guardar el nombre
   * impediría cargar lo que sí se sabe. Lo que no se puede es guardar espacios.
   */
  private normalizar(valor: string | null, largoMaximo: number, comoSeLlama: string): string | null {
    const limpio = (valor ?? '').trim();
    if (limpio === '') {
      return null;
    }
    if (limpio.length > largoMaximo) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `${comoSeLlama} no puede pasar de ${String(largoMaximo)} caracteres.`,
        `Campo de ${String(limpio.length)} caracteres.`,
      );
    }
    return limpio;
  }
}
