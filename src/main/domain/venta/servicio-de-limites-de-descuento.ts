/**
 * Los topes de descuento por rol, configurables desde la aplicación.
 *
 * ## Qué cierra este servicio
 *
 * `limites_descuento` existe desde el Prompt 6 y el servicio de venta la
 * respeta desde el Prompt 19, pero hasta ahora **la única forma de llenarla era
 * `npm run seed:limites`**: un guion de desarrollo que se corre desde una
 * terminal, con valores fijos escritos en el código. Eso quería decir que Jimmy
 * no podía cambiar el tope de su cajero sin que alguien le tocara la
 * computadora. El guion sigue existiendo para montar un entorno nuevo de
 * desarrollo de una sola vez; ya no es la única puerta.
 *
 * ## `editado_por` ahora se llena de verdad
 *
 * Las filas que sembró el guion quedaron con `editado_por = NULL` **a
 * propósito**: no había ninguna persona detrás de ellas, y poner un usuario
 * inventado habría sido atribuirle a alguien una decisión que no tomó. Cuando
 * el cambio lo hace una persona desde la pantalla, la columna guarda su
 * `usuario_id` real y además queda el asiento en `auditoria_log`. Los dos
 * registros contestan preguntas distintas: la columna dice **quién lo dejó
 * así**, la bitácora dice **quién lo cambió y desde qué valor**.
 *
 * ## El tope cero no es un accidente
 *
 * Un rol sin fila tiene tope CERO, no «sin límite» (§4.13). Este servicio no
 * cambia eso: solo agrega la forma de poner un número distinto. Borrar el
 * límite de un rol sigue siendo una operación aparte, del guion de limpieza.
 */

import type Decimal from 'decimal.js';

import { BASE_PORCENTAJE, decimal, esNegativo, esMayorQue, montoACadena } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import type { Rol } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeLimitesDescuento } from '@main/database/repositories/limites-descuento';

/** Acción que queda en la bitácora de auditoría. */
export const ACCIONES_DE_LIMITE = {
  fijado: 'limite_descuento_fijado',
} as const;

/** Los dos roles que existen hoy. Ver el punto 6 de §6.2. */
const ROLES: readonly Rol[] = ['venta', 'administrativo'];

/** Cómo queda el tope de un rol, listo para mostrar. */
export interface LimiteDeUnRol {
  readonly rol: Rol;
  /** Porcentaje máximo, cadena canónica de dos decimales. */
  readonly porcentaje: string;
  /** Monto fijo máximo en quetzales, cadena canónica. */
  readonly montoFijo: string;
  /** `false` si el rol no tiene fila: tope CERO, no «sin límite». */
  readonly configurado: boolean;
  /** Nombre de quien lo dejó así, o `null` si lo sembró el guion. */
  readonly editadoPor: string | null;
  /** Cuándo se tocó por última vez, ISO, o `null` si no hay fila. */
  readonly actualizadoEn: string | null;
}

/** Lo que se pide al guardar. */
export interface CambioDeLimite {
  readonly rol: Rol;
  readonly porcentaje: string;
  readonly montoFijo: string;
}

/** Dependencias del servicio. */
export interface DependenciasDeLimites {
  readonly limites: RepositorioDeLimitesDescuento;
  readonly auditoria: RepositorioDeAuditoria;
  /** Para resolver el nombre de quien editó. Solo lectura. */
  readonly nombreDeUsuario: (usuarioId: string) => string | null;
  readonly ahora?: () => number;
}

export class ServicioDeLimitesDeDescuento {
  private readonly limites: RepositorioDeLimitesDescuento;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly nombreDeUsuario: (usuarioId: string) => string | null;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeLimites) {
    this.limites = dependencias.limites;
    this.auditoria = dependencias.auditoria;
    this.nombreDeUsuario = dependencias.nombreDeUsuario;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * El tope de CADA rol, haya fila o no.
   *
   * SE DEVUELVEN LOS DOS ROLES SIEMPRE, incluso el que no tiene fila, con sus
   * valores en cero y `configurado: false`. Si el que falta simplemente no
   * apareciera en la lista, la pantalla mostraría un hueco y quien la mire
   * podría leerlo como «este rol no tiene límite», que es exactamente lo
   * contrario de lo que significa.
   */
  public listar(): LimiteDeUnRol[] {
    return ROLES.map((rol) => {
      const fila = this.limites.obtenerPorRol(rol);
      if (fila === null) {
        return {
          rol,
          porcentaje: montoACadena(0),
          montoFijo: montoACadena(0),
          configurado: false,
          editadoPor: null,
          actualizadoEn: null,
        };
      }
      return {
        rol,
        porcentaje: montoACadena(fila.descuentoMaxPorcentaje),
        montoFijo: montoACadena(fila.descuentoMaxMontoFijo),
        configurado: true,
        editadoPor: fila.editadoPor === null ? null : this.nombreDeUsuario(fila.editadoPor),
        actualizadoEn: fila.actualizadoEn,
      };
    });
  }

  /**
   * Fija el tope de un rol y deja constancia de quién lo hizo.
   *
   * LA VALIDACIÓN VA ANTES QUE LA BASE, con un mensaje que una persona pueda
   * leer. El CHECK del esquema sigue ahí y sigue siendo la última red —atrapa a
   * un módulo futuro distraído o a una consulta hecha a mano—, pero
   * «CHECK constraint failed: limites_descuento_porcentaje» no se le muestra a
   * nadie. Es el mismo reparto de las tres capas de §4.11.
   */
  public fijar(actorId: string, cambio: CambioDeLimite): LimiteDeUnRol {
    if (!ROLES.includes(cambio.rol)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Ese rol no existe.',
        `Rol recibido: ${cambio.rol}`,
      );
    }

    const porcentaje = this.leerNumero(cambio.porcentaje, 'El porcentaje máximo');
    const montoFijo = this.leerNumero(cambio.montoFijo, 'El monto fijo máximo');

    const anterior = this.limites.obtenerPorRol(cambio.rol);

    const fijado = this.limites.fijar({
      rol: cambio.rol,
      descuentoMaxPorcentaje: porcentaje,
      descuentoMaxMontoFijo: montoFijo,
      editadoPor: actorId,
    });

    this.auditoria.registrar({
      usuarioId: actorId,
      accion: ACCIONES_DE_LIMITE.fijado,
      entidadTipo: 'limites_descuento',
      entidadId: fijado.id,
      valorAnterior:
        anterior === null
          ? null
          : {
              rol: anterior.rol,
              porcentaje: montoACadena(anterior.descuentoMaxPorcentaje),
              montoFijo: montoACadena(anterior.descuentoMaxMontoFijo),
              editadoPor: anterior.editadoPor,
            },
      valorNuevo: {
        rol: fijado.rol,
        porcentaje: montoACadena(fijado.descuentoMaxPorcentaje),
        montoFijo: montoACadena(fijado.descuentoMaxMontoFijo),
        editadoPor: fijado.editadoPor,
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return {
      rol: fijado.rol,
      porcentaje: montoACadena(fijado.descuentoMaxPorcentaje),
      montoFijo: montoACadena(fijado.descuentoMaxMontoFijo),
      configurado: true,
      editadoPor: fijado.editadoPor === null ? null : this.nombreDeUsuario(fijado.editadoPor),
      actualizadoEn: fijado.actualizadoEn,
    };
  }

  /**
   * Un valor tecleado, convertido a Decimal, o un rechazo legible.
   *
   * **SOLO SE EXIGE QUE NO SEA NEGATIVO**, que es lo que el esquema exige y lo
   * que se pidió. Un porcentaje mayor que 100 se ACEPTA: no autoriza nada más
   * que 100 —el total ya tiene piso en cero, ver `totalConDescuento`— y
   * rechazarlo sería inventar una regla de negocio que nadie confirmó. La
   * pantalla sí avisa que no sirve de nada, sin bloquear, con el mismo criterio
   * del aviso de inventario de §4.12. Queda como el punto 17 de §6.2.
   */
  private leerNumero(texto: string, comoSeLlama: string): Decimal {
    const limpio = texto.trim();
    if (limpio === '') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `${comoSeLlama} no puede quedar vacío. Poné 0 si ese rol no debe dar descuento.`,
        'Campo vacío.',
      );
    }

    let valor: Decimal;
    try {
      valor = decimal(limpio);
    } catch {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `${comoSeLlama} tiene que ser un número.`,
        `Valor recibido: ${limpio}`,
      );
    }

    if (!valor.isFinite()) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `${comoSeLlama} tiene que ser un número.`,
        `Valor no finito: ${limpio}`,
      );
    }
    if (esNegativo(valor)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `${comoSeLlama} no puede ser negativo. Poné 0 si ese rol no debe dar descuento.`,
        `Valor recibido: ${limpio}`,
      );
    }
    return valor;
  }
}

/**
 * `true` si un porcentaje pasa de 100, para el aviso de la pantalla.
 *
 * No bloquea nada: es información. Ver `leerNumero`.
 */
export function porcentajeSinEfectoExtra(porcentaje: string): boolean {
  try {
    return esMayorQue(decimal(porcentaje), BASE_PORCENTAJE);
  } catch {
    return false;
  }
}
