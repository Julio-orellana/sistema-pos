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
 * NINGUNA VÍA CIERRA SIN PIN. Además del atajo, este controlador intercepta
 * los atajos de salida del sistema operativo (Cmd+Q en macOS, Alt+F4 en
 * Windows, el menú del Dock) y los redirige a este mismo flujo. Antes de eso,
 * Cmd+Q cerraba el punto de venta de inmediato, sin PIN, sin auditoría y sin
 * consolidar la base de datos: una puerta trasera al alcance de cualquiera.
 *
 * Hay una única salida visible en la interfaz —un control discreto en la barra
 * de estado— y dispara exactamente este mismo flujo, no uno paralelo.
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
import type {
  OrigenDeSalida,
  ServicioDeAutenticacion,
} from '@main/domain/usuarios/autenticacion';

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
  /**
   * Servicio de autenticación contra usuarios REALES.
   *
   * Es la única verificación de PIN del sistema. Las tres rutas de salida
   * terminan llamando a `autorizarComoAdministrador` a través de
   * `confirmarSalida`: no hay tres implementaciones paralelas.
   */
  readonly autenticacion: ServicioDeAutenticacion;
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
  private readonly autenticacion: ServicioDeAutenticacion;
  private readonly cerrarAplicacion: () => void;
  private readonly ahora: () => number;

  /** Por cuál de las tres rutas llegó la solicitud viva. */
  private origenDeLaSolicitud: OrigenDeSalida | null = null;

  /** Momento en que se presionó el atajo, o `null` si no hay solicitud viva. */
  private solicitadaEnMs: number | null = null;

  /** Cuántas veces se solicitó la salida. Solo para diagnóstico y auditoría. */
  private vecesSolicitada = 0;

  /**
   * `true` solo después de que el PIN correcto autorizó el cierre.
   *
   * Mientras sea `false`, cualquier intento de cerrar la aplicación —Cmd+Q en
   * macOS, Alt+F4 en Windows, el menú del Dock— se intercepta y se redirige a
   * pedir el PIN. Sin esto, el atajo estándar de "salir" del sistema operativo
   * sería una puerta trasera que se salta la autorización, la auditoría y el
   * cierre ordenado de la base de datos.
   */
  private cierreAutorizado = false;

  public constructor(dependencias: DependenciasDeSalida) {
    this.autenticacion = dependencias.autenticacion;
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
      this.solicitarPin(ventana, 'atajo_de_teclado');
    });
  }

  /**
   * Marca que hay una solicitud viva y le avisa a la interfaz.
   *
   * ÚNICO punto de entrada de las tres rutas. `origen` solo se guarda para el
   * asiento de auditoría: no cambia el comportamiento, porque desde el punto
   * de vista del negocio los tres son el mismo hecho.
   */
  public solicitarPin(ventana: BrowserWindow, origen: OrigenDeSalida): void {
    this.solicitadaEnMs = this.ahora();
    this.origenDeLaSolicitud = origen;
    this.vecesSolicitada += 1;
    console.info(`[kiosko] Se solicitó la salida controlada (origen: ${origen}); se pide el PIN.`);
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

  /** ¿Ya se autorizó el cierre con el PIN? */
  public cierreEstaAutorizado(): boolean {
    return this.cierreAutorizado;
  }

  /**
   * Autoriza el cierre sin pasar por el PIN.
   *
   * Lo usa ÚNICAMENTE el propio cierre ordenado del proceso principal, para
   * que su `app.quit()` no quede atrapado por la intercepción que este mismo
   * controlador instala. No debe llamarse desde ningún otro lugar.
   */
  public autorizarCierre(): void {
    this.cierreAutorizado = true;
  }

  /**
   * Decide qué hacer ante un intento de cerrar la aplicación que NO vino del
   * flujo con PIN: Cmd+Q en macOS, Alt+F4 o el botón de cerrar en Windows, el
   * menú del Dock, o un `app.quit()` de terceros.
   *
   * Devuelve `'permitir'` o `'pedir-pin'`. Cuando devuelve `'pedir-pin'` ya
   * dejó pedido el PIN: quien llama solo tiene que cancelar el evento.
   *
   * ESCAPE DELIBERADO: si la ventana ya no existe o su renderer se cayó, se
   * permite cerrar. No hay dónde mostrar el diálogo del PIN, y dejar el
   * proceso vivo sin interfaz obligaría a matarlo desde el sistema operativo.
   */
  public evaluarIntentoDeCierre(ventana: BrowserWindow): 'permitir' | 'pedir-pin' {
    if (this.cierreAutorizado) {
      return 'permitir';
    }

    if (ventana.isDestroyed() || ventana.webContents.isCrashed()) {
      console.warn('[kiosko] Cierre permitido sin PIN: la interfaz no está disponible para pedirlo.');
      return 'permitir';
    }

    console.info('[kiosko] Intento de cierre interceptado; se redirige al flujo con PIN.');
    this.solicitarPin(ventana, 'cierre_del_sistema');
    return 'pedir-pin';
  }

  /**
   * Verifica el PIN y, si corresponde, cierra la aplicación de forma ordenada.
   */
  public confirmarSalida(pin: string): ResultadoIntentoDeSalida {
    if (!this.haySolicitudVigente()) {
      // Nadie pidió salir (o pasó demasiado tiempo). No se verifica el PIN
      // siquiera: así, aunque la interfaz estuviera comprometida, no puede
      // usarse como oráculo para adivinar el PIN a fuerza de intentos.
      return {
        autorizado: false,
        codigo: 'SIN_SOLICITUD_VIGENTE',
        mensaje:
          'No hay ninguna solicitud de salida en curso. Volvé a pedir la salida y probá de nuevo.',
        segundosParaReintentar: null,
      };
    }

    const origen = this.origenDeLaSolicitud ?? 'atajo_de_teclado';

    // ÚNICA verificación de PIN del sistema, para las tres rutas.
    const resultado = this.autenticacion.autorizarComoAdministrador(pin, 'salida_controlada');

    if (!resultado.autenticado) {
      console.warn(`[kiosko] Intento de salida rechazado (${origen}): ${resultado.codigo}`);
      this.autenticacion.registrarSalida(false, origen, null, resultado.codigo);
      return {
        autorizado: false,
        codigo: resultado.codigo,
        mensaje: resultado.mensaje,
        segundosParaReintentar: resultado.segundosParaReintentar,
      };
    }

    this.solicitadaEnMs = null;
    this.cierreAutorizado = true;
    const autorizadoPor = resultado.usuario?.id ?? null;
    console.info(
      `[kiosko] Salida autorizada por ${resultado.usuario?.nombre ?? 'desconocido'} (origen: ${origen}, vía: ${resultado.viaDeAutorizacion ?? 'presencial'}).`,
    );
    // Acepta el PIN normal y, desde el 2026-09-15, también el remoto: lo
    // decide la tabla ACEPTA_PIN_REMOTO, no esta llamada. La vía queda en el
    // asiento, igual que en el descuento y en el cierre de caja.
    const via = resultado.viaDeAutorizacion ?? 'presencial';
    this.autenticacion.registrarSalida(true, origen, autorizadoPor, 'PIN correcto', via);
    this.cerrarAplicacion();

    return {
      autorizado: true,
      codigo: resultado.codigo,
      mensaje: 'Autorización correcta. Cerrando el punto de venta.',
      segundosParaReintentar: null,
    };
  }
}
