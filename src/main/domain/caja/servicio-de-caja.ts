/**
 * Módulo de caja: apertura y cierre del turno.
 *
 * DOS MODOS DE CAPTURAR EFECTIVO, MUTUAMENTE EXCLUYENTES:
 *
 *   · Simple:    el cajero escribe el total y listo.
 *   · Detallado: el cajero cuenta cuántas piezas hay de cada denominación y
 *                el SISTEMA suma. Nunca se le pide además el total: si se le
 *                pidieran las dos cosas, tarde o temprano no coincidirían y
 *                habría que decidir a cuál creerle.
 *
 * Nunca se aceptan los dos a la vez. La suma del modo detallado se hace con
 * Decimal.js, como todo el dinero del proyecto.
 */

import Decimal from 'decimal.js';

import { CERO, montoACadena, multiplicar, sumar } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import type {
  CajaSesion,
  Denominacion,
  LineaDeDesglose,
  MomentoDeArqueo,
  ViaDeAutorizacion,
} from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeCajaSesiones } from '@main/database/repositories/caja-sesiones';
import type {
  RepositorioDeDenominaciones,
  RepositorioDeDesgloseDeCaja,
} from '@main/database/repositories/denominaciones';

/** Acciones de caja que quedan en la bitácora de auditoría. */
export const ACCIONES_DE_CAJA = {
  aperturaDeCaja: 'caja_abierta',
  cierreDeCaja: 'caja_cerrada',
} as const;

/** Cómo se capturó el efectivo. */
export type ModoDeCaptura = 'simple' | 'detallado';

/**
 * Efectivo declarado, en uno de los dos modos.
 *
 * Es una unión discriminada a propósito: hace IMPOSIBLE construir un valor con
 * los dos modos a la vez, en vez de tener que validarlo a mano.
 */
export type EfectivoDeclarado =
  | { readonly modo: 'simple'; readonly monto: string }
  | { readonly modo: 'detallado'; readonly lineas: readonly LineaDeDesglose[] };

/** Resultado de cerrar, o el motivo por el que no se pudo. */
export interface ResultadoDeCierre {
  readonly cerrada: boolean;
  readonly codigo: 'CIERRE_CORRECTO' | 'REQUIERE_AUTORIZACION';
  readonly mensaje: string;
  readonly sesion: CajaSesion | null;
  /** Diferencia calculada, como cadena canónica, para mostrarla al autorizar. */
  readonly diferencia: string;
  readonly montoEsperado: string;
  readonly montoReal: string;
}

/** Dependencias del servicio. */
export interface DependenciasDeCaja {
  readonly cajaSesiones: RepositorioDeCajaSesiones;
  readonly denominaciones: RepositorioDeDenominaciones;
  readonly desglose: RepositorioDeDesgloseDeCaja;
  readonly auditoria: RepositorioDeAuditoria;
  readonly ahora?: () => number;
}

export class ServicioDeCaja {
  private readonly cajaSesiones: RepositorioDeCajaSesiones;
  private readonly denominaciones: RepositorioDeDenominaciones;
  private readonly desglose: RepositorioDeDesgloseDeCaja;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeCaja) {
    this.cajaSesiones = dependencias.cajaSesiones;
    this.denominaciones = dependencias.denominaciones;
    this.desglose = dependencias.desglose;
    this.auditoria = dependencias.auditoria;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * Suma un desglose con Decimal.js: cantidad × valor de cada denominación.
   *
   * Se redondea una sola vez al final, como manda la política de redondeo del
   * proyecto: las multiplicaciones intermedias quedan exactas.
   */
  public totalDelDesglose(lineas: readonly LineaDeDesglose[]): Decimal {
    const porId = new Map(this.denominaciones.listarActivas().map((d) => [d.id, d]));

    const subtotales = lineas.map((linea) => {
      const denominacion = porId.get(linea.denominacionId);
      if (denominacion === undefined) {
        throw new ErrorDeNegocio(
          'DATO_INVALIDO',
          'Se contó una denominación que no existe o está desactivada.',
          `denominacion_id desconocido: ${linea.denominacionId}`,
        );
      }
      if (!Number.isInteger(linea.cantidad) || linea.cantidad < 0) {
        throw new ErrorDeNegocio(
          'DATO_INVALIDO',
          'La cantidad de piezas debe ser un número entero y no negativa.',
          `cantidad inválida: ${String(linea.cantidad)}`,
        );
      }
      return multiplicar(denominacion.valor, linea.cantidad);
    });

    return subtotales.length === 0 ? CERO : sumar(...subtotales);
  }

  /** Resuelve el monto de un efectivo declarado, sea cual sea el modo. */
  public montoDeclarado(efectivo: EfectivoDeclarado): Decimal {
    if (efectivo.modo === 'simple') {
      return new Decimal(montoACadena(efectivo.monto));
    }
    return this.totalDelDesglose(efectivo.lineas);
  }

  /** Denominaciones activas, para armar la pantalla de conteo. */
  public listarDenominaciones(): Denominacion[] {
    return this.denominaciones.listarActivas();
  }

  /** El turno abierto de un usuario, si tiene alguno. */
  public sesionAbiertaDe(usuarioId: string): CajaSesion | null {
    return this.cajaSesiones.obtenerAbiertaDeUsuario(usuarioId);
  }

  /**
   * Abre un turno de caja PARA EL USUARIO INDICADO.
   *
   * Quien llama debe pasar el id del usuario en sesión, nunca uno que venga de
   * la interfaz: nadie abre caja en nombre de otro.
   */
  public abrir(usuarioId: string, efectivo: EfectivoDeclarado): CajaSesion {
    // Se valida también desde la aplicación y no solo con el índice único de
    // la base, para poder dar un mensaje que el cajero entienda.
    if (this.cajaSesiones.obtenerAbiertaDeUsuario(usuarioId) !== null) {
      throw new ErrorDeNegocio(
        'CAJA_YA_ABIERTA',
        'Ya tenés un turno de caja abierto. Cerralo antes de abrir otro.',
        `El usuario ${usuarioId} ya tiene una sesión de caja abierta.`,
      );
    }

    const montoInicial = this.montoDeclarado(efectivo);
    const sesion = this.cajaSesiones.abrir({ usuarioId, montoInicial });

    if (efectivo.modo === 'detallado') {
      this.desglose.guardar(sesion.id, 'apertura', efectivo.lineas);
    }

    this.auditoria.registrar({
      usuarioId,
      accion: ACCIONES_DE_CAJA.aperturaDeCaja,
      entidadTipo: 'caja_sesiones',
      entidadId: sesion.id,
      valorNuevo: {
        montoInicial: montoACadena(montoInicial),
        modo: efectivo.modo,
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return sesion;
  }

  /**
   * Calcula lo que DEBERÍA haber en la caja al cerrar.
   *
   * TODO(ventas): hoy devuelve el monto inicial, que equivale a asumir cero
   * ventas en efectivo. Es correcto solo mientras no exista el módulo de
   * ventas. En cuanto exista, esto DEBE pasar a ser
   * `monto_inicial + suma de las ventas en efectivo de esta sesión`.
   * Ver CLAUDE.md §4.10. No se inventa una lógica de ventas parcial para
   * rellenarlo: quedaría enterrada y nadie la encontraría después.
   */
  public montoEsperadoDe(sesion: CajaSesion): Decimal {
    return sesion.montoInicial;
  }

  /**
   * Intenta cerrar un turno.
   *
   * Si la diferencia es cero, cierra directo. Si no, NO cierra: devuelve
   * `REQUIERE_AUTORIZACION` con la diferencia calculada, para que la interfaz
   * muestre exactamente qué se está por autorizar antes de pedir el código.
   */
  public intentarCerrar(
    cajaSesionId: string,
    efectivo: EfectivoDeclarado,
    autorizacion?: { readonly autorizadaPor: string; readonly via: ViaDeAutorizacion },
  ): ResultadoDeCierre {
    const sesion = this.obtenerSesionAbierta(cajaSesionId);

    const montoEsperado = this.montoEsperadoDe(sesion);
    const montoReal = this.montoDeclarado(efectivo);
    // Con Decimal, nunca con aritmética nativa.
    const diferencia = montoReal.minus(montoEsperado);

    const diferenciaTexto = montoACadena(diferencia);
    const hayDiferencia = !diferencia.isZero();

    if (hayDiferencia && autorizacion === undefined) {
      return {
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION',
        mensaje: this.describirDiferencia(diferencia),
        sesion: null,
        diferencia: diferenciaTexto,
        montoEsperado: montoACadena(montoEsperado),
        montoReal: montoACadena(montoReal),
      };
    }

    if (efectivo.modo === 'detallado') {
      this.desglose.guardar(sesion.id, 'cierre', efectivo.lineas);
    }

    const cerrada = this.cajaSesiones.cerrar(sesion.id, {
      montoEsperado,
      montoReal,
      diferencia,
      autorizadaPor: hayDiferencia ? (autorizacion?.autorizadaPor ?? null) : null,
      autorizadaVia: hayDiferencia ? (autorizacion?.via ?? null) : null,
    });

    this.auditoria.registrar({
      usuarioId: sesion.usuarioId,
      accion: ACCIONES_DE_CAJA.cierreDeCaja,
      entidadTipo: 'caja_sesiones',
      entidadId: sesion.id,
      valorNuevo: {
        montoEsperado: montoACadena(montoEsperado),
        montoReal: montoACadena(montoReal),
        diferencia: diferenciaTexto,
        modo: efectivo.modo,
        autorizadaPor: hayDiferencia ? (autorizacion?.autorizadaPor ?? null) : null,
        autorizadaVia: hayDiferencia ? (autorizacion?.via ?? null) : null,
      },
      fecha: new Date(this.ahora()).toISOString(),
    });

    return {
      cerrada: true,
      codigo: 'CIERRE_CORRECTO',
      mensaje: hayDiferencia
        ? `Turno cerrado con ${this.describirDiferencia(diferencia)}`
        : 'Turno cerrado. La caja cuadra exactamente.',
      sesion: cerrada,
      diferencia: diferenciaTexto,
      montoEsperado: montoACadena(montoEsperado),
      montoReal: montoACadena(montoReal),
    };
  }

  /** Texto que ve quien autoriza: cuánto y de qué signo. */
  public describirDiferencia(diferencia: Decimal): string {
    if (diferencia.isZero()) {
      return 'sin diferencia';
    }
    const magnitud = montoACadena(diferencia.absoluteValue());
    return diferencia.isNegative()
      ? `un FALTANTE de Q${magnitud}`
      : `un SOBRANTE de Q${magnitud}`;
  }

  /** Momentos de arqueo guardados de una sesión. */
  public desgloseDe(cajaSesionId: string, momento: MomentoDeArqueo): readonly LineaDeDesglose[] {
    return this.desglose.listarPorSesion(cajaSesionId, momento).map((fila) => ({
      denominacionId: fila.denominacionId,
      cantidad: fila.cantidad,
    }));
  }

  private obtenerSesionAbierta(cajaSesionId: string): CajaSesion {
    const sesion = this.cajaSesiones.obtenerPorId(cajaSesionId);
    if (sesion === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'No se encontró el turno de caja que se quiere cerrar.',
        `caja_sesion_id inexistente: ${cajaSesionId}`,
      );
    }
    if (sesion.estado !== 'abierta') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Ese turno de caja ya está cerrado.',
        `caja_sesion_id ${cajaSesionId} en estado ${sesion.estado}.`,
      );
    }
    return sesion;
  }
}
