/**
 * El cierre de caja tal como lo pide la ventana: la coreografía de los PIN.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO NO VIVE DENTRO DEL MANEJADOR IPC (CLAUDE.md §4.40)
 * ---------------------------------------------------------------------------
 * Vivía ahí, y no se podía probar sin Electron. Desde que el cierre autorizado
 * pasó a tener DOS pasos, la parte que importa —que un PIN correcto NO cierre,
 * y que un PIN incorrecto no revele nada— tiene que poder probarse contra una
 * base SQLite real, con los servicios reales. El manejador solo delega.
 *
 * ---------------------------------------------------------------------------
 * EL PIN PRIMERO, EL MONTO DESPUÉS, Y LA CONFIRMACIÓN AL FINAL
 * ---------------------------------------------------------------------------
 * A una cajera no le llega el esperado (§4.40.3). Pero quien autoriza tiene que
 * ver qué aprueba (§4.9). Las dos cosas se concilian invirtiendo el orden del
 * descuento excedente: allá se muestra el monto y después se pide el PIN; acá
 * el PIN prueba que quien mira es un administrador, y RECIÉN ENTONCES se revela
 * el monto. Un PIN correcto no cierra nada:
 *
 *   1. `intentar` con el PIN → si es correcto, guarda una AUTORIZACIÓN
 *      PENDIENTE y devuelve `AUTORIZACION_VALIDADA` con todos los montos. La
 *      caja sigue abierta.
 *   2. `confirmarAutorizacion` → consume la pendiente y cierra.
 *   3. `cancelarAutorizacion` → la descarta. La caja sigue abierta.
 *
 * La autorización pendiente vive en el PROCESO PRINCIPAL, no en la ventana. Si
 * cancelar solo cerrara el cuadro en pantalla, la autorización seguiría viva y
 * cualquiera con la sesión abierta podría cerrar llamando al canal desde la
 * consola, con un permiso que el administrador ya retiró.
 *
 * Está atada a cuatro cosas, y si cualquiera cambia deja de valer:
 *
 *   · el turno;
 *   · quien tiene la sesión;
 *   · el conteo EXACTO (modo, monto o desglose);
 *   · el esperado y la diferencia que se mostraron: si entre la revelación y la
 *     confirmación entrara una venta, lo autorizado ya no sería lo que se cierra.
 *
 * Vale dos minutos —lo mismo que la solicitud de salida controlada (§4.1)— y
 * un solo uso: se consume al intentar confirmar, salga bien o mal.
 */

import { montoACadena } from '@shared/money';
import type {
  ConteoSelladoIpc,
  EfectivoDeclaradoIpc,
  ResultadoDeCierreIpc,
} from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';
import type {
  ConteoSellado,
  ResultadoDeCierre,
  ServicioDeCaja,
} from '@main/domain/caja/servicio-de-caja';
import type { CajaSesion } from '@main/database/repositories/entidades';
import type { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import type { UsuarioEnSesion } from '@main/domain/usuarios/sesion';
import { CODIGO_AUTORIZACION_VALIDADA, resultadoDeCierreParaLaVentana } from './turno-para-la-ventana';

/**
 * Cuánto vale una autorización validada y no confirmada: dos minutos, lo mismo
 * que la solicitud viva de la salida controlada (§4.1).
 */
export const VIDA_DE_LA_AUTORIZACION_PENDIENTE_MS = 120_000;

/** El PIN fue correcto: se revelan los montos y se espera la confirmación. */
export { CODIGO_AUTORIZACION_VALIDADA };

/** No hay autorización que confirmar, o dejó de valer. */
export const CODIGO_AUTORIZACION_NO_VIGENTE = 'AUTORIZACION_NO_VIGENTE';

export interface DependenciasDelCierreDeCaja {
  readonly caja: Pick<
    ServicioDeCaja,
    'sesionAbierta' | 'requiereAutorizacionDeCajaAjena' | 'intentarCerrar'
  >;
  readonly autenticacion: Pick<ServicioDeAutenticacion, 'autorizarComoAdministrador'>;
  /** Reloj inyectable, para probar el vencimiento sin esperar. */
  readonly ahora?: () => number;
}

/** Lo que llega de la ventana para intentar cerrar. */
export interface PedidoDeCierre {
  readonly efectivo: EfectivoDeclaradoIpc;
  readonly pin?: string | undefined;
  readonly pinCajaAjena?: string | undefined;
}

interface AutorizacionPendiente {
  readonly turnoId: string;
  readonly usuarioEnSesionId: string;
  readonly firmaDelEfectivo: string;
  readonly montoEsperado: string;
  readonly diferencia: string;
  readonly autorizadaPor: string;
  readonly via: 'presencial' | 'remoto';
  readonly autorizacionDeCajaAjena: { readonly autorizadaPor: string } | undefined;
  readonly venceEnMs: number;
}

/**
 * Una forma única del conteo, para compararlo entre las dos llamadas.
 * El desglose se ordena: el mismo conteo en otro orden es el mismo conteo.
 */
export function firmaDelEfectivo(efectivo: EfectivoDeclaradoIpc): string {
  if (efectivo.modo === 'simple') {
    return `simple:${efectivo.monto}`;
  }
  const lineas = efectivo.lineas
    .filter((linea) => linea.cantidad > 0)
    .map((linea) => `${linea.denominacionId}=${String(linea.cantidad)}`)
    .sort();
  return `detallado:${lineas.join(',')}`;
}

function aConteoIpc(conteo: ConteoSellado | null): ConteoSelladoIpc | null {
  return conteo === null
    ? null
    : {
        fecha: conteo.fecha,
        montoEsperado: conteo.montoEsperado,
        montoReal: conteo.montoReal,
        diferencia: conteo.diferencia,
      };
}

export class FlujoDeCierreDeCaja {
  private pendiente: AutorizacionPendiente | null = null;
  private readonly ahora: () => number;

  public constructor(private readonly dependencias: DependenciasDelCierreDeCaja) {
    this.ahora = dependencias.ahora ?? Date.now;
  }

  /**
   * Intenta cerrar con lo que trae el pedido. Todo lo que devuelve pasa por
   * `resultadoDeCierreParaLaVentana`.
   *
   * Un intento nuevo DESCARTA cualquier autorización pendiente: si se volvió a
   * contar, lo que se había autorizado ya no es lo que se va a cerrar.
   */
  public intentar(pedido: PedidoDeCierre, enSesion: UsuarioEnSesion): ResultadoDeCierreIpc {
    this.pendiente = null;
    return resultadoDeCierreParaLaVentana(this.intentarSinFiltro(pedido, enSesion), enSesion);
  }

  /** Segundo paso: cierra con la autorización validada, si sigue valiendo. */
  public confirmarAutorizacion(
    efectivo: EfectivoDeclaradoIpc,
    enSesion: UsuarioEnSesion,
  ): ResultadoDeCierreIpc {
    // Un solo uso, pase lo que pase: una autorización que falló al confirmarse
    // no puede quedar esperando otro intento.
    const pendiente = this.pendiente;
    this.pendiente = null;

    const turno = this.turnoAbierto();
    const montoInicial = montoACadena(turno.montoInicial);

    const motivo =
      pendiente === null
        ? 'No hay ninguna autorización para confirmar. Tecleá el PIN de un administrador.'
        : this.ahora() > pendiente.venceEnMs
          ? 'La autorización venció. Tecleá el PIN de un administrador otra vez.'
          : pendiente.turnoId !== turno.id || pendiente.usuarioEnSesionId !== enSesion.id
            ? 'La autorización no corresponde a este cierre. Tecleá el PIN de un administrador otra vez.'
            : pendiente.firmaDelEfectivo !== firmaDelEfectivo(efectivo)
              ? 'El conteo cambió después de autorizarse. Tecleá el PIN de un administrador otra vez.'
              : null;

    if (pendiente === null || motivo !== null) {
      return resultadoDeCierreParaLaVentana(this.noVigente(motivo ?? '', montoInicial), enSesion);
    }

    // Se recalcula SIN cerrar, para comprobar que lo que se va a cerrar es lo
    // que se mostró. El mismo par esperado/contado no vuelve a sellar.
    const tentativo = this.dependencias.caja.intentarCerrar(turno.id, efectivo, {
      usuarioQueCierra: enSesion.id,
      autorizacionDeCajaAjena: pendiente.autorizacionDeCajaAjena,
    });
    if (
      tentativo.cerrada ||
      tentativo.montoEsperado !== pendiente.montoEsperado ||
      tentativo.diferencia !== pendiente.diferencia
    ) {
      return resultadoDeCierreParaLaVentana(
        tentativo.cerrada
          ? this.aIpc(tentativo, montoInicial, null)
          : this.noVigente(
              'El monto cambió después de autorizarse. Tecleá el PIN de un administrador otra vez.',
              montoInicial,
            ),
        enSesion,
      );
    }

    const cerrado = this.dependencias.caja.intentarCerrar(turno.id, efectivo, {
      usuarioQueCierra: enSesion.id,
      autorizacionDeCajaAjena: pendiente.autorizacionDeCajaAjena,
      autorizacion: { autorizadaPor: pendiente.autorizadaPor, via: pendiente.via },
    });
    return resultadoDeCierreParaLaVentana(this.aIpc(cerrado, montoInicial, pendiente.via), enSesion);
  }

  /** Descarta la autorización pendiente. La caja sigue abierta. */
  public cancelarAutorizacion(): void {
    this.pendiente = null;
  }

  /** ¿Hay una autorización esperando confirmación? Para las pruebas. */
  public hayAutorizacionPendiente(): boolean {
    return this.pendiente !== null;
  }

  // -------------------------------------------------------------------------

  private turnoAbierto(): CajaSesion {
    const turno = this.dependencias.caja.sesionAbierta();
    if (turno === null) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'No hay ninguna caja abierta en el sistema.',
        'Se intentó cerrar sin ninguna sesión de caja abierta.',
      );
    }
    return turno;
  }

  private intentarSinFiltro(pedido: PedidoDeCierre, enSesion: UsuarioEnSesion): ResultadoDeCierreIpc {
    const { caja, autenticacion } = this.dependencias;
    const turno = this.turnoAbierto();
    const montoInicial = montoACadena(turno.montoInicial);

    // ---- Autorización 1: ¿la caja es de otra persona? ----------------------
    // Se resuelve ANTES de contar. Superficie propia, sin PIN remoto (§4.9).
    let autorizacionDeCajaAjena: { readonly autorizadaPor: string } | undefined;

    if (caja.requiereAutorizacionDeCajaAjena(turno, enSesion.id)) {
      if (pedido.pinCajaAjena === undefined) {
        const aviso = caja.intentarCerrar(turno.id, pedido.efectivo, {
          usuarioQueCierra: enSesion.id,
        });
        return this.aIpc(aviso, montoInicial, null);
      }

      const permiso = autenticacion.autorizarComoAdministrador(
        pedido.pinCajaAjena,
        'cierre_de_caja_ajena',
      );
      if (!permiso.autenticado || permiso.usuario === null) {
        return {
          cerrada: false,
          codigo: permiso.codigo,
          mensaje: permiso.mensaje,
          diferencia: '0.00',
          // Todavía no se contó nada: el esperado no viaja (§4.40).
          montoEsperado: null,
          montoReal: '0.00',
          autorizadaVia: null,
          segundosParaReintentar: permiso.segundosParaReintentar,
          montoInicial,
          primerConteo: null,
        };
      }
      autorizacionDeCajaAjena = { autorizadaPor: permiso.usuario.id };
    }

    // ---- Autorización 2: ¿la caja cuadra? ----------------------------------
    // Sin PIN solo se calcula; si no cuadra, no cierra.
    const tentativo = caja.intentarCerrar(turno.id, pedido.efectivo, {
      usuarioQueCierra: enSesion.id,
      autorizacionDeCajaAjena,
    });
    if (tentativo.cerrada || pedido.pin === undefined) {
      return this.aIpc(tentativo, montoInicial, null);
    }

    // Con PIN: normal (presencial) o remoto (por teléfono). Si es correcto,
    // NO se cierra: se revela lo que se está autorizando y se espera.
    const autorizacion = autenticacion.autorizarComoAdministrador(
      pedido.pin,
      'cierre_con_diferencia',
    );
    if (!autorizacion.autenticado || autorizacion.usuario === null) {
      return {
        ...this.aIpc(tentativo, montoInicial, null),
        codigo: autorizacion.codigo,
        mensaje: autorizacion.mensaje,
        segundosParaReintentar: autorizacion.segundosParaReintentar,
      };
    }

    const via = autorizacion.viaDeAutorizacion ?? 'presencial';
    this.pendiente = {
      turnoId: turno.id,
      usuarioEnSesionId: enSesion.id,
      firmaDelEfectivo: firmaDelEfectivo(pedido.efectivo),
      montoEsperado: tentativo.montoEsperado,
      diferencia: tentativo.diferencia,
      autorizadaPor: autorizacion.usuario.id,
      via,
      autorizacionDeCajaAjena,
      venceEnMs: this.ahora() + VIDA_DE_LA_AUTORIZACION_PENDIENTE_MS,
    };

    return {
      ...this.aIpc(tentativo, montoInicial, via),
      codigo: CODIGO_AUTORIZACION_VALIDADA,
      mensaje:
        via === 'remoto'
          ? `${autorizacion.usuario.nombre} autorizó por teléfono. Revisá el monto y confirmá el cierre.`
          : `${autorizacion.usuario.nombre} autorizó en persona. Revisá el monto y confirmá el cierre.`,
    };
  }

  /** El resultado del servicio, sin la sesión de dominio y con el sello como DTO. */
  private aIpc(
    resultado: ResultadoDeCierre,
    montoInicial: string,
    autorizadaVia: 'presencial' | 'remoto' | null,
  ): ResultadoDeCierreIpc {
    return {
      cerrada: resultado.cerrada,
      codigo: resultado.codigo,
      mensaje: resultado.mensaje,
      diferencia: resultado.diferencia,
      // Antes de contar —el pedido de autorización de una caja ajena— el
      // esperado NO viaja (§4.40).
      montoEsperado:
        resultado.codigo === 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA' ? null : resultado.montoEsperado,
      montoReal: resultado.montoReal,
      montoInicial,
      primerConteo: aConteoIpc(resultado.primerConteo),
      autorizadaVia,
      segundosParaReintentar: null,
    };
  }

  private noVigente(mensaje: string, montoInicial: string): ResultadoDeCierreIpc {
    return {
      cerrada: false,
      codigo: CODIGO_AUTORIZACION_NO_VIGENTE,
      mensaje,
      diferencia: null,
      montoEsperado: null,
      montoReal: '0.00',
      autorizadaVia: null,
      segundosParaReintentar: null,
      montoInicial,
      primerConteo: null,
    };
  }
}
