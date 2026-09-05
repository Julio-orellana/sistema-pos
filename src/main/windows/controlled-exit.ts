/**
 * Salida controlada del modo kiosko.
 *
 * PROBLEMA QUE RESUELVE: el modo kiosko bloquea correctamente las salidas
 * casuales, pero sin esta pieza no queda NINGUNA forma ordenada de cerrar la
 * aplicación, y hay que matar el proceso desde el Administrador de tareas. Eso
 * deja la base de datos sin consolidar y no registra nada en la auditoría.
 *
 * CÓMO FUNCIONA: el administrador presiona el atajo (ver ATAJO_SALIDA_CONTROLADA
 * en src/shared/kiosk-input.ts), el proceso principal le pide el PIN a la
 * interfaz, y solo si el PIN es correcto se cierra todo de forma ordenada.
 *
 * NO ES UNA FUNCIÓN DE LA INTERFAZ DE VENTA: no hay botón, ni menú, ni pista
 * visual. Es una salida de emergencia para el administrador.
 *
 * POR QUÉ `before-input-event` Y NO `globalShortcut`: un atajo global se
 * registra en todo el sistema operativo y le robaría la combinación a
 * cualquier otra aplicación abierta, incluida la del desarrollador. Aquí el
 * atajo solo existe mientras la ventana del POS tiene el foco, que es
 * exactamente el alcance que corresponde.
 */

import type { BrowserWindow } from 'electron';

import { CANALES_IPC, type ResultadoIntentoDeSalida } from '@shared/types/ipc';
import { esAtajoDeSalidaControlada } from '@shared/kiosk-input';
import type { VerificadorDePinAdministrador } from '@main/security/admin-pin';

/**
 * Cuánto vale una solicitud de salida antes de caducar, en milisegundos.
 *
 * Sin esta ventana de tiempo, la interfaz podría enviar PIN al proceso
 * principal en cualquier momento sin que nadie haya presionado el atajo, y el
 * limitador de intentos sería lo único que frenaría un ataque por fuerza bruta.
 * Con ella, solo se aceptan PIN inmediatamente después de un atajo real.
 */
const VALIDEZ_DE_LA_SOLICITUD_MS = 120_000;

/** Dependencias que el controlador necesita del resto de la aplicación. */
export interface DependenciasDeSalida {
  /** Verifica el PIN del administrador. */
  readonly verificador: VerificadorDePinAdministrador;
  /** Cierra la aplicación de forma ordenada. La provee el proceso principal. */
  readonly cerrarAplicacion: () => void;
  /** Reloj inyectable, para poder probar la caducidad sin esperar. */
  readonly ahora?: () => number;
}

/**
 * Coordina el atajo, la solicitud de PIN y el cierre ordenado.
 *
 * Se implementa como clase porque tiene estado que hay que proteger: si hay una
 * solicitud en curso y desde cuándo.
 */
export class ControladorDeSalidaControlada {
  private readonly verificador: VerificadorDePinAdministrador;
  private readonly cerrarAplicacion: () => void;
  private readonly ahora: () => number;

  /** Momento en que se presionó el atajo, o `null` si no hay solicitud viva. */
  private solicitadaEnMs: number | null = null;

  /** Cuántas veces se presionó el atajo. Solo para diagnóstico y auditoría. */
  private vecesSolicitada = 0;

  public constructor(dependencias: DependenciasDeSalida) {
    this.verificador = dependencias.verificador;
    this.cerrarAplicacion = dependencias.cerrarAplicacion;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * Conecta el atajo a una ventana. Al detectarlo, le pide el PIN a la interfaz.
   */
  public conectarVentana(ventana: BrowserWindow): void {
    ventana.webContents.on('before-input-event', (evento, entrada) => {
      if (!esAtajoDeSalidaControlada(entrada)) {
        return;
      }
      // Se consume el evento para que la combinación no llegue a la interfaz.
      evento.preventDefault();
      this.solicitarPin(ventana);
    });
  }

  /** Marca que hay una solicitud viva y le avisa a la interfaz. */
  public solicitarPin(ventana: BrowserWindow): void {
    this.solicitadaEnMs = this.ahora();
    this.vecesSolicitada += 1;
    // TODO(auditoria): registrar el intento de salida en el log de auditoría
    // cuando exista el módulo, con fecha, usuario en sesión y resultado.
    console.info('[kiosko] Se solicitó la salida controlada; se pide el PIN de administrador.');
    ventana.webContents.send(CANALES_IPC.solicitudDeSalidaControlada);
  }

  /** ¿Hay una solicitud de salida vigente y sin caducar? */
  public haySolicitudVigente(): boolean {
    if (this.solicitadaEnMs === null) {
      return false;
    }
    return this.ahora() - this.solicitadaEnMs <= VALIDEZ_DE_LA_SOLICITUD_MS;
  }

  /** Cuántas veces se presionó el atajo en esta sesión. */
  public solicitudesRecibidas(): number {
    return this.vecesSolicitada;
  }

  /** Cancela la solicitud en curso (por ejemplo, si el administrador se arrepiente). */
  public cancelarSolicitud(): void {
    this.solicitadaEnMs = null;
  }

  /**
   * Verifica el PIN y, si corresponde, cierra la aplicación de forma ordenada.
   */
  public confirmarSalida(pin: string): ResultadoIntentoDeSalida {
    if (!this.haySolicitudVigente()) {
      // Nadie presionó el atajo (o pasó demasiado tiempo). No se verifica el
      // PIN siquiera: así, aunque la interfaz estuviera comprometida, no puede
      // usarse como oráculo para adivinar el PIN a fuerza de intentos.
      return {
        autorizado: false,
        codigo: 'SIN_SOLICITUD_VIGENTE',
        mensaje:
          'No hay ninguna solicitud de salida en curso. Presioná de nuevo el atajo de administrador.',
        intentosRestantes: 0,
        bloqueadoHasta: null,
      };
    }

    const resultado = this.verificador.verificar(pin);

    if (!resultado.autorizado) {
      // TODO(auditoria): registrar el intento fallido con su código.
      console.warn(`[kiosko] Intento de salida rechazado: ${resultado.codigo}`);
      return {
        autorizado: false,
        codigo: resultado.codigo,
        mensaje: resultado.mensaje,
        intentosRestantes: resultado.intentosRestantes,
        bloqueadoHasta: resultado.bloqueadoHasta,
      };
    }

    this.solicitadaEnMs = null;
    // TODO(auditoria): registrar la salida autorizada con el administrador que
    // la autorizó, cuando el módulo de usuarios permita identificarlo.
    console.info('[kiosko] Salida autorizada. Cerrando la aplicación de forma ordenada.');
    this.cerrarAplicacion();

    return {
      autorizado: true,
      codigo: resultado.codigo,
      mensaje: 'Autorización correcta. Cerrando el punto de venta.',
      intentosRestantes: resultado.intentosRestantes,
      bloqueadoHasta: null,
    };
  }
}
