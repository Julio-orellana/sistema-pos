/**
 * Pruebas de la salida controlada del modo kiosko.
 *
 * Verifican el comportamiento completo que se le prometió al cliente: que el
 * atajo pida el PIN, que solo el PIN correcto cierre la aplicación, que el
 * cierre sea ordenado, y que nadie pueda saltarse el atajo para adivinar el PIN
 * desde la interfaz.
 */

import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import { CANALES_IPC } from '@shared/types/ipc';
import { ATAJO_SALIDA_CONTROLADA } from '@shared/kiosk-input';
import { VerificadorDePinPorConfiguracion } from '@main/security/admin-pin';
import { ControladorDeSalidaControlada } from '../controlled-exit';

const PIN_CORRECTO = '4321';
const PIN_EQUIVOCADO = '1111';
const MILISEGUNDOS_POR_MINUTO = 60_000;

/** Escuchador de `before-input-event` capturado desde la ventana falsa. */
type EscuchadorDeEntrada = (
  evento: { preventDefault: () => void },
  entrada: Record<string, unknown>,
) => void;

/** Ventana falsa que registra lo que el controlador le pide hacer. */
function crearVentanaFalsa(estado: { destruida?: boolean; rendererCaido?: boolean } = {}): {
  ventana: BrowserWindow;
  canalesEnviados: string[];
  dispararEntrada: (entrada: Record<string, unknown>) => boolean;
} {
  const canalesEnviados: string[] = [];
  let escuchador: EscuchadorDeEntrada | null = null;

  const ventanaFalsa = {
    isDestroyed: (): boolean => estado.destruida ?? false,
    webContents: {
      isCrashed: (): boolean => estado.rendererCaido ?? false,
      on: (evento: string, manejador: EscuchadorDeEntrada): void => {
        if (evento === 'before-input-event') {
          escuchador = manejador;
        }
      },
      send: (canal: string): void => {
        canalesEnviados.push(canal);
      },
    },
  };

  return {
    ventana: ventanaFalsa as unknown as BrowserWindow,
    canalesEnviados,
    /** Simula una pulsación y responde si el evento fue consumido. */
    dispararEntrada: (entrada: Record<string, unknown>): boolean => {
      let consumido = false;
      escuchador?.({ preventDefault: (): void => { consumido = true; } }, entrada);
      return consumido;
    },
  };
}

/** Arma un controlador con reloj controlado y PIN conocido. */
function crearEscenario(): {
  controlador: ControladorDeSalidaControlada;
  cerrarAplicacion: ReturnType<typeof vi.fn>;
  avanzarMinutos: (minutos: number) => void;
} {
  let instante = Date.UTC(2026, 0, 1);
  const cerrarAplicacion = vi.fn();

  const controlador = new ControladorDeSalidaControlada({
    verificador: new VerificadorDePinPorConfiguracion({ pinConfigurado: PIN_CORRECTO }),
    cerrarAplicacion,
    ahora: (): number => instante,
  });

  return {
    controlador,
    cerrarAplicacion,
    avanzarMinutos: (minutos: number): void => {
      instante += minutos * MILISEGUNDOS_POR_MINUTO;
    },
  };
}

/** La pulsación exacta del atajo, tal como la entrega Electron. */
const PULSACION_DEL_ATAJO: Record<string, unknown> = {
  type: 'keyDown',
  code: ATAJO_SALIDA_CONTROLADA.code,
  key: 'q',
  control: true,
  shift: true,
  alt: true,
  meta: false,
};

// ===========================================================================
describe('El atajo pide el PIN', () => {
  it('al presionar el atajo se le solicita el PIN a la interfaz', () => {
    const { controlador } = crearEscenario();
    const { ventana, canalesEnviados, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);

    dispararEntrada(PULSACION_DEL_ATAJO);

    expect(canalesEnviados).toEqual([CANALES_IPC.solicitudDeSalidaControlada]);
    expect(controlador.solicitudesRecibidas()).toBe(1);
  });

  it('el atajo se consume y no llega a la interfaz de venta', () => {
    const { controlador } = crearEscenario();
    const { ventana, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);

    expect(dispararEntrada(PULSACION_DEL_ATAJO)).toBe(true);
  });

  it('otras teclas no disparan nada', () => {
    const { controlador } = crearEscenario();
    const { ventana, canalesEnviados, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);

    dispararEntrada({ ...PULSACION_DEL_ATAJO, code: 'KeyW' });
    dispararEntrada({ ...PULSACION_DEL_ATAJO, alt: false });
    dispararEntrada({ type: 'keyDown', code: 'KeyA', control: false, shift: false, alt: false, meta: false });

    expect(canalesEnviados).toHaveLength(0);
  });
});

// ===========================================================================
describe('Solo el PIN correcto cierra la aplicación', () => {
  it('con el PIN correcto se autoriza y se cierra de forma ordenada', () => {
    const { controlador, cerrarAplicacion } = crearEscenario();
    const { ventana, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);
    dispararEntrada(PULSACION_DEL_ATAJO);

    const resultado = controlador.confirmarSalida(PIN_CORRECTO);

    expect(resultado.autorizado).toBe(true);
    expect(cerrarAplicacion).toHaveBeenCalledTimes(1);
  });

  it('con el PIN incorrecto NO se cierra nada', () => {
    const { controlador, cerrarAplicacion } = crearEscenario();
    const { ventana, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);
    dispararEntrada(PULSACION_DEL_ATAJO);

    const resultado = controlador.confirmarSalida(PIN_EQUIVOCADO);

    expect(resultado.autorizado).toBe(false);
    expect(resultado.codigo).toBe('PIN_INCORRECTO');
    expect(cerrarAplicacion).not.toHaveBeenCalled();
  });

  it('tras autorizar, la solicitud se consume: un segundo PIN correcto ya no cierra otra vez', () => {
    const { controlador, cerrarAplicacion } = crearEscenario();
    const { ventana, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);
    dispararEntrada(PULSACION_DEL_ATAJO);

    controlador.confirmarSalida(PIN_CORRECTO);
    const segundoIntento = controlador.confirmarSalida(PIN_CORRECTO);

    expect(segundoIntento.autorizado).toBe(false);
    expect(segundoIntento.codigo).toBe('SIN_SOLICITUD_VIGENTE');
    expect(cerrarAplicacion).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
describe('Ninguna vía cierra la aplicación sin PIN', () => {
  // Cubre lo que hace Cmd+Q en macOS, Alt+F4 en Windows, el menú del Dock y
  // cualquier app.quit() ajeno: todos desembocan en evaluarIntentoDeCierre.

  it('un intento de cierre sin autorización se bloquea y pide el PIN', () => {
    const { controlador, cerrarAplicacion } = crearEscenario();
    const { ventana, canalesEnviados } = crearVentanaFalsa();

    const decision = controlador.evaluarIntentoDeCierre(ventana);

    expect(decision).toBe('pedir-pin');
    expect(canalesEnviados).toEqual([CANALES_IPC.solicitudDeSalidaControlada]);
    expect(cerrarAplicacion).not.toHaveBeenCalled();
  });

  it('el intento de cierre deja una solicitud viva, así que el PIN correcto sirve enseguida', () => {
    const { controlador, cerrarAplicacion } = crearEscenario();
    const { ventana } = crearVentanaFalsa();

    controlador.evaluarIntentoDeCierre(ventana);
    const resultado = controlador.confirmarSalida(PIN_CORRECTO);

    expect(resultado.autorizado).toBe(true);
    expect(cerrarAplicacion).toHaveBeenCalledTimes(1);
  });

  it('después de autorizar con el PIN, el cierre ya no se bloquea', () => {
    const { controlador } = crearEscenario();
    const { ventana } = crearVentanaFalsa();

    controlador.evaluarIntentoDeCierre(ventana);
    controlador.confirmarSalida(PIN_CORRECTO);

    expect(controlador.cierreEstaAutorizado()).toBe(true);
    expect(controlador.evaluarIntentoDeCierre(ventana)).toBe('permitir');
  });

  it('un PIN incorrecto NO desbloquea el cierre', () => {
    const { controlador, cerrarAplicacion } = crearEscenario();
    const { ventana } = crearVentanaFalsa();

    controlador.evaluarIntentoDeCierre(ventana);
    controlador.confirmarSalida(PIN_EQUIVOCADO);

    expect(controlador.cierreEstaAutorizado()).toBe(false);
    expect(controlador.evaluarIntentoDeCierre(ventana)).toBe('pedir-pin');
    expect(cerrarAplicacion).not.toHaveBeenCalled();
  });

  it('insistir con el cierre vuelve a pedir el PIN, no lo deja pasar por cansancio', () => {
    const { controlador } = crearEscenario();
    const { ventana, canalesEnviados } = crearVentanaFalsa();

    controlador.evaluarIntentoDeCierre(ventana);
    controlador.evaluarIntentoDeCierre(ventana);
    controlador.evaluarIntentoDeCierre(ventana);

    expect(canalesEnviados).toHaveLength(3);
    expect(controlador.cierreEstaAutorizado()).toBe(false);
  });

  it('el cierre ordenado del propio proceso se autoriza a sí mismo y no queda atrapado', () => {
    const { controlador } = crearEscenario();
    const { ventana } = crearVentanaFalsa();

    controlador.autorizarCierre();

    expect(controlador.evaluarIntentoDeCierre(ventana)).toBe('permitir');
  });

  describe('Escape deliberado cuando no hay dónde pedir el PIN', () => {
    it('si la ventana ya fue destruida, se permite cerrar', () => {
      const { controlador } = crearEscenario();
      const { ventana } = crearVentanaFalsa({ destruida: true });

      expect(controlador.evaluarIntentoDeCierre(ventana)).toBe('permitir');
    });

    it('si el renderer se cayó, se permite cerrar en vez de dejar el proceso zombi', () => {
      const { controlador } = crearEscenario();
      const { ventana } = crearVentanaFalsa({ rendererCaido: true });

      expect(controlador.evaluarIntentoDeCierre(ventana)).toBe('permitir');
    });
  });
});

// ===========================================================================
describe('No se puede saltar el atajo', () => {
  it('enviar un PIN sin haber presionado el atajo se rechaza sin siquiera verificarlo', () => {
    const { controlador, cerrarAplicacion } = crearEscenario();

    const resultado = controlador.confirmarSalida(PIN_CORRECTO);

    expect(resultado.autorizado).toBe(false);
    expect(resultado.codigo).toBe('SIN_SOLICITUD_VIGENTE');
    expect(cerrarAplicacion).not.toHaveBeenCalled();
  });

  it('la solicitud caduca a los dos minutos', () => {
    const { controlador, avanzarMinutos } = crearEscenario();
    const { ventana, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);
    dispararEntrada(PULSACION_DEL_ATAJO);

    expect(controlador.haySolicitudVigente()).toBe(true);

    avanzarMinutos(3);

    expect(controlador.haySolicitudVigente()).toBe(false);
    expect(controlador.confirmarSalida(PIN_CORRECTO).codigo).toBe('SIN_SOLICITUD_VIGENTE');
  });

  it('cancelar la solicitud deja de aceptar el PIN', () => {
    const { controlador } = crearEscenario();
    const { ventana, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);
    dispararEntrada(PULSACION_DEL_ATAJO);

    controlador.cancelarSolicitud();

    expect(controlador.confirmarSalida(PIN_CORRECTO).codigo).toBe('SIN_SOLICITUD_VIGENTE');
  });
});

// ===========================================================================
describe('Instalación sin PIN configurado', () => {
  it('la salida queda deshabilitada y el mensaje lo explica', () => {
    const cerrarAplicacion = vi.fn();
    const controlador = new ControladorDeSalidaControlada({
      verificador: new VerificadorDePinPorConfiguracion({ pinConfigurado: null }),
      cerrarAplicacion,
    });
    const { ventana, dispararEntrada } = crearVentanaFalsa();
    controlador.conectarVentana(ventana);
    dispararEntrada(PULSACION_DEL_ATAJO);

    const resultado = controlador.confirmarSalida('0000');

    expect(resultado.autorizado).toBe(false);
    expect(resultado.codigo).toBe('PIN_NO_CONFIGURADO');
    expect(cerrarAplicacion).not.toHaveBeenCalled();
  });
});
