/**
 * Pruebas del verificador de PIN de administrador.
 *
 * El PIN es hoy la única credencial del sistema y lo único que separa a un
 * cajero de cerrar el punto de venta. Estas pruebas verifican que autoriza a
 * quien debe, rechaza a quien no, y no se deja adivinar por fuerza bruta.
 */

import { describe, expect, it } from 'vitest';

import { esquemaConfirmacionDeSalida } from '@shared/types/ipc';
import {
  LARGO_MAXIMO_PIN,
  LARGO_MINIMO_PIN,
  PIN_POR_DEFECTO_EN_DESARROLLO,
  VerificadorDePinPorConfiguracion,
  crearVerificadorDePin,
  tieneFormatoDePinValido,
} from '../admin-pin';

const PIN_CORRECTO = '2468';
const PIN_EQUIVOCADO = '1357';
const INTENTOS_MAXIMOS = 3;
const SEGUNDOS_DE_BLOQUEO = 30;
const MILISEGUNDOS_POR_SEGUNDO = 1000;

/** Verificador con reloj controlado, para no esperar el bloqueo en tiempo real. */
function crearVerificadorConRelojFalso(): {
  verificador: VerificadorDePinPorConfiguracion;
  avanzarSegundos: (segundos: number) => void;
} {
  let instante = Date.UTC(2026, 0, 1);
  const verificador = new VerificadorDePinPorConfiguracion({
    pinConfigurado: PIN_CORRECTO,
    intentosMaximos: INTENTOS_MAXIMOS,
    segundosDeBloqueo: SEGUNDOS_DE_BLOQUEO,
    ahora: (): number => instante,
  });
  return {
    verificador,
    avanzarSegundos: (segundos: number): void => {
      instante += segundos * MILISEGUNDOS_POR_SEGUNDO;
    },
  };
}

// ===========================================================================
describe('Formato del PIN', () => {
  it('acepta un PIN de cuatro dígitos', () => {
    expect(tieneFormatoDePinValido('1234')).toBe(true);
  });

  it('rechaza un PIN más corto que el mínimo', () => {
    expect(tieneFormatoDePinValido('123')).toBe(false);
    expect(LARGO_MINIMO_PIN).toBe(4);
  });

  it('rechaza un PIN más largo que el máximo', () => {
    expect(tieneFormatoDePinValido('1'.repeat(LARGO_MAXIMO_PIN + 1))).toBe(false);
  });

  it('rechaza letras, espacios y símbolos', () => {
    expect(tieneFormatoDePinValido('12a4')).toBe(false);
    expect(tieneFormatoDePinValido('12 4')).toBe(false);
    expect(tieneFormatoDePinValido('12-4')).toBe(false);
  });

  it('rechaza el PIN vacío', () => {
    expect(tieneFormatoDePinValido('')).toBe(false);
  });
});

// ===========================================================================
describe('Autorización con el PIN correcto', () => {
  it('autoriza cuando el PIN coincide', () => {
    const { verificador } = crearVerificadorConRelojFalso();
    const resultado = verificador.verificar(PIN_CORRECTO);

    expect(resultado.autorizado).toBe(true);
    expect(resultado.codigo).toBe('PIN_CORRECTO');
  });

  it('un acierto borra los intentos fallidos acumulados', () => {
    const { verificador } = crearVerificadorConRelojFalso();

    verificador.verificar(PIN_EQUIVOCADO);
    verificador.verificar(PIN_EQUIVOCADO);
    expect(verificador.intentosRestantes()).toBe(1);

    verificador.verificar(PIN_CORRECTO);
    expect(verificador.intentosRestantes()).toBe(INTENTOS_MAXIMOS);
  });
});

// ===========================================================================
describe('Rechazo del PIN incorrecto', () => {
  it('no autoriza y descuenta un intento', () => {
    const { verificador } = crearVerificadorConRelojFalso();
    const resultado = verificador.verificar(PIN_EQUIVOCADO);

    expect(resultado.autorizado).toBe(false);
    expect(resultado.codigo).toBe('PIN_INCORRECTO');
    expect(resultado.intentosRestantes).toBe(INTENTOS_MAXIMOS - 1);
  });

  it('un PIN mal escrito no consume intentos: nadie debe autobloquearse por un error de tecleo', () => {
    const { verificador } = crearVerificadorConRelojFalso();
    const resultado = verificador.verificar('ab');

    expect(resultado.codigo).toBe('FORMATO_INVALIDO');
    expect(verificador.intentosRestantes()).toBe(INTENTOS_MAXIMOS);
  });
});

// ===========================================================================
describe('Qué consume un intento y qué no (respuesta al caso concreto)', () => {
  // El PIN real de este escenario es 5678 y alguien teclea 1234.
  const PIN_REAL = '5678';
  const PIN_COMPLETO_PERO_EQUIVOCADO = '1234';

  function verificadorDelEscenario(): VerificadorDePinPorConfiguracion {
    return new VerificadorDePinPorConfiguracion({
      pinConfigurado: PIN_REAL,
      intentosMaximos: INTENTOS_MAXIMOS,
    });
  }

  it('SÍ consume intento: cuatro dígitos completos pero equivocados ("1234" cuando el PIN es "5678")', () => {
    const verificador = verificadorDelEscenario();

    const resultado = verificador.verificar(PIN_COMPLETO_PERO_EQUIVOCADO);

    expect(resultado.autorizado).toBe(false);
    expect(resultado.codigo).toBe('PIN_INCORRECTO');
    expect(resultado.intentosRestantes).toBe(2);
    expect(verificador.intentosRestantes()).toBe(2);
  });

  it('SÍ consume intento: tres PIN completos y equivocados agotan los intentos y bloquean', () => {
    const verificador = verificadorDelEscenario();

    expect(verificador.verificar('1234').intentosRestantes).toBe(2);
    expect(verificador.verificar('0000').intentosRestantes).toBe(1);
    const tercero = verificador.verificar('9999');

    expect(tercero.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(verificador.intentosRestantes()).toBe(0);
  });

  it('NO consume intento: una entrada incompleta de tres dígitos ("123")', () => {
    const verificador = verificadorDelEscenario();

    const resultado = verificador.verificar('123');

    expect(resultado.codigo).toBe('FORMATO_INVALIDO');
    expect(verificador.intentosRestantes()).toBe(INTENTOS_MAXIMOS);
  });

  it('NO consume intento: una entrada con algo que no es un dígito ("12a4")', () => {
    const verificador = verificadorDelEscenario();

    const resultado = verificador.verificar('12a4');

    expect(resultado.codigo).toBe('FORMATO_INVALIDO');
    expect(verificador.intentosRestantes()).toBe(INTENTOS_MAXIMOS);
  });

  it('NO consume intento: una entrada vacía', () => {
    const verificador = verificadorDelEscenario();

    verificador.verificar('');

    expect(verificador.intentosRestantes()).toBe(INTENTOS_MAXIMOS);
  });

  it('NO consume intento: cancelar el diálogo, porque nunca llega nada al verificador', () => {
    const verificador = verificadorDelEscenario();

    // Cancelar no produce ninguna llamada: el estado queda intacto.
    expect(verificador.intentosRestantes()).toBe(INTENTOS_MAXIMOS);
  });

  it('mezclar entradas inválidas no protege al que sí está adivinando', () => {
    const verificador = verificadorDelEscenario();

    verificador.verificar('12');    // inválido, no cuenta
    verificador.verificar('1234');  // cuenta
    verificador.verificar('abcd');  // inválido, no cuenta
    verificador.verificar('5679');  // cuenta

    expect(verificador.intentosRestantes()).toBe(1);
  });

  it('el PIN correcto sigue funcionando después de entradas inválidas', () => {
    const verificador = verificadorDelEscenario();

    verificador.verificar('12');
    verificador.verificar('xyz');

    expect(verificador.verificar(PIN_REAL).autorizado).toBe(true);
  });
});

// ===========================================================================
describe('Qué frena la frontera IPC antes de llegar al verificador', () => {
  // Un PIN demasiado corto o demasiado largo se rechaza en la frontera y ni
  // siquiera llega al verificador, así que tampoco consume intento.

  it('un PIN de tres dígitos se rechaza en la frontera IPC', () => {
    expect(esquemaConfirmacionDeSalida.safeParse({ pin: '123' }).success).toBe(false);
  });

  it('un PIN de más de doce caracteres se rechaza en la frontera IPC', () => {
    expect(esquemaConfirmacionDeSalida.safeParse({ pin: '1'.repeat(13) }).success).toBe(false);
  });

  it('un PIN de cuatro dígitos sí cruza la frontera y llega al verificador', () => {
    expect(esquemaConfirmacionDeSalida.safeParse({ pin: '1234' }).success).toBe(true);
  });
});

// ===========================================================================
describe('Protección contra fuerza bruta', () => {
  it('bloquea después de tres intentos fallidos', () => {
    const { verificador } = crearVerificadorConRelojFalso();

    verificador.verificar(PIN_EQUIVOCADO);
    verificador.verificar(PIN_EQUIVOCADO);
    const tercero = verificador.verificar(PIN_EQUIVOCADO);

    expect(tercero.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(tercero.bloqueadoHasta).not.toBeNull();
  });

  it('durante el bloqueo rechaza incluso el PIN correcto', () => {
    const { verificador } = crearVerificadorConRelojFalso();

    verificador.verificar(PIN_EQUIVOCADO);
    verificador.verificar(PIN_EQUIVOCADO);
    verificador.verificar(PIN_EQUIVOCADO);

    const conElCorrecto = verificador.verificar(PIN_CORRECTO);
    expect(conElCorrecto.autorizado).toBe(false);
    expect(conElCorrecto.codigo).toBe('DEMASIADOS_INTENTOS');
  });

  it('el bloqueo se levanta solo al cumplirse el tiempo', () => {
    const { verificador, avanzarSegundos } = crearVerificadorConRelojFalso();

    verificador.verificar(PIN_EQUIVOCADO);
    verificador.verificar(PIN_EQUIVOCADO);
    verificador.verificar(PIN_EQUIVOCADO);

    avanzarSegundos(SEGUNDOS_DE_BLOQUEO - 1);
    expect(verificador.verificar(PIN_CORRECTO).codigo).toBe('DEMASIADOS_INTENTOS');

    avanzarSegundos(2);
    const despues = verificador.verificar(PIN_CORRECTO);
    expect(despues.autorizado).toBe(true);
    expect(despues.codigo).toBe('PIN_CORRECTO');
  });
});

// ===========================================================================
describe('Instalación sin PIN configurado', () => {
  it('en producción, la salida controlada queda deshabilitada y lo dice', () => {
    const verificador = crearVerificadorDePin({}, true);
    const resultado = verificador.verificar('0000');

    expect(resultado.autorizado).toBe(false);
    expect(resultado.codigo).toBe('PIN_NO_CONFIGURADO');
  });

  it('en producción no acepta el PIN de respaldo de desarrollo', () => {
    const verificador = crearVerificadorDePin({}, true);
    expect(verificador.verificar(PIN_POR_DEFECTO_EN_DESARROLLO).autorizado).toBe(false);
  });

  it('en desarrollo usa el PIN de respaldo para no tener que matar el proceso', () => {
    const verificador = crearVerificadorDePin({}, false);
    expect(verificador.verificar(PIN_POR_DEFECTO_EN_DESARROLLO).autorizado).toBe(true);
  });

  it('el PIN del entorno tiene prioridad sobre el de respaldo, también en desarrollo', () => {
    const verificador = crearVerificadorDePin({ POS_PIN_ADMINISTRADOR: PIN_CORRECTO }, false);

    expect(verificador.verificar(PIN_CORRECTO).autorizado).toBe(true);
    expect(verificador.verificar(PIN_POR_DEFECTO_EN_DESARROLLO).autorizado).toBe(false);
  });

  it('una variable de entorno vacía se trata como PIN no configurado', () => {
    const verificador = crearVerificadorDePin({ POS_PIN_ADMINISTRADOR: '' }, true);
    expect(verificador.verificar('0000').codigo).toBe('PIN_NO_CONFIGURADO');
  });
});
