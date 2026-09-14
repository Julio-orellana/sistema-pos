/**
 * El reloj de esta máquina contra el de Supabase (fase 4.c, riesgo 8.5).
 *
 * Lo que estas pruebas tienen que sostener, y que es la razón de que el módulo
 * no sea una resta: que una conexión lenta NO pueda producir un aviso falso, y
 * que un reloj de verdad mal puesto SÍ avise.
 */
import { describe, expect, it } from 'vitest';

import {
  DESFASE_DE_RELOJ_QUE_MERECE_AVISO_S,
  ESPERA_ENTRE_AVISOS_DE_RELOJ_MS,
  ObservadorDelRelojDeLaNube,
  describirDesfase,
  leerDesfaseDelReloj,
} from '../reloj-de-la-nube';

/** Un instante cualquiera, redondo, para que las cuentas se lean. */
const DEL_SERVIDOR = Date.UTC(2026, 8, 14, 17, 7, 35);
const CABECERA = new Date(DEL_SERVIDOR).toUTCString();
const MS_POR_SEGUNDO = 1000;
const MS_POR_MINUTO = 60 * MS_POR_SEGUNDO;
const MS_POR_HORA = 60 * MS_POR_MINUTO;

/** Una respuesta con el reloj local desviado `desviacionMs` y un viaje de `viajeMs`. */
function respuestaCon(desviacionMs: number, viajeMs: number): { cabeceraDate: string; enviadoEn: number; recibidoEn: number } {
  // El servidor declara el segundo entero; su hora real es el centro de ese
  // segundo. El reloj local se centra ahí más la desviación que se quiera.
  const centro = DEL_SERVIDOR + MS_POR_SEGUNDO / 2 + desviacionMs;
  return {
    cabeceraDate: CABECERA,
    enviadoEn: centro - viajeMs / 2,
    recibidoEn: centro + viajeMs / 2,
  };
}

describe('Medir el desfase del reloj contra la cabecera Date', () => {
  it('un reloj en hora da desfase cero y no merece aviso', () => {
    const lectura = leerDesfaseDelReloj(respuestaCon(0, 200));
    expect(lectura?.desfaseSegundos).toBe(0);
    expect(lectura?.mereceAviso).toBe(false);
  });

  it('positivo es ADELANTADO y negativo es ATRASADO, sin que haya que pensarlo', () => {
    expect(leerDesfaseDelReloj(respuestaCon(10 * MS_POR_SEGUNDO, 100))?.desfaseSegundos).toBe(10);
    expect(leerDesfaseDelReloj(respuestaCon(-10 * MS_POR_SEGUNDO, 100))?.desfaseSegundos).toBe(-10);
    const adelantado = leerDesfaseDelReloj(respuestaCon(10 * MS_POR_SEGUNDO, 100));
    const atrasado = leerDesfaseDelReloj(respuestaCon(-10 * MS_POR_SEGUNDO, 100));
    expect(adelantado === null ? '' : describirDesfase(adelantado)).toContain('ADELANTADO');
    expect(atrasado === null ? '' : describirDesfase(atrasado)).toContain('ATRASADO');
  });

  it('DOS MINUTOS de desfase SÍ avisan, en las dos direcciones', () => {
    expect(leerDesfaseDelReloj(respuestaCon(2 * MS_POR_MINUTO, 300))?.mereceAviso).toBe(true);
    expect(leerDesfaseDelReloj(respuestaCon(-2 * MS_POR_MINUTO, 300))?.mereceAviso).toBe(true);
  });

  it('el reloj ATRASADO UNA HORA —el caso que arruina el reporte del día— avisa', () => {
    const lectura = leerDesfaseDelReloj(respuestaCon(-MS_POR_HORA, 500));
    expect(lectura?.desfaseSegundos).toBe(-3600);
    expect(lectura?.mereceAviso).toBe(true);
  });

  it('medio minuto NO avisa: el umbral es un minuto, no cualquier diferencia', () => {
    expect(leerDesfaseDelReloj(respuestaCon(30 * MS_POR_SEGUNDO, 200))?.mereceAviso).toBe(false);
  });

  it('justo en el umbral no avisa, y un poco más allá tampoco mientras la incertidumbre lo cubra', () => {
    const justo = leerDesfaseDelReloj(respuestaCon(DESFASE_DE_RELOJ_QUE_MERECE_AVISO_S * MS_POR_SEGUNDO, 200));
    expect(justo?.mereceAviso).toBe(false);
  });

  describe('UNA CONEXIÓN LENTA NO PUEDE INVENTAR UN AVISO', () => {
    it('un viaje de SEIS SEGUNDOS con el reloj en hora no avisa, y lo dice en la incertidumbre', () => {
      const lectura = leerDesfaseDelReloj(respuestaCon(0, 6 * MS_POR_SEGUNDO));
      expect(lectura?.desfaseSegundos).toBe(0);
      expect(lectura?.incertidumbreSegundos).toBe(4);
      expect(lectura?.mereceAviso).toBe(false);
    });

    it('con un viaje enorme, un desfase de 61 s queda dentro de la duda y NO avisa', () => {
      const lectura = leerDesfaseDelReloj(respuestaCon(61 * MS_POR_SEGUNDO, 20 * MS_POR_SEGUNDO));
      expect(lectura?.mereceAviso).toBe(false);
    });

    it('…y el MISMO desfase con una conexión normal SÍ avisa: lo que cambia es la duda, no el reloj', () => {
      const lectura = leerDesfaseDelReloj(respuestaCon(70 * MS_POR_SEGUNDO, 200));
      expect(lectura?.mereceAviso).toBe(true);
    });
  });

  describe('Respuestas que no sirven para medir', () => {
    it('sin cabecera Date devuelve null, no cero', () => {
      expect(leerDesfaseDelReloj({ cabeceraDate: null, enviadoEn: 1, recibidoEn: 2 })).toBeNull();
    });

    it('con una cabecera que no es una fecha devuelve null', () => {
      expect(leerDesfaseDelReloj({ cabeceraDate: 'la hora de siempre', enviadoEn: 1, recibidoEn: 2 })).toBeNull();
    });

    it('con la cabecera vacía devuelve null', () => {
      expect(leerDesfaseDelReloj({ cabeceraDate: '', enviadoEn: 1, recibidoEn: 2 })).toBeNull();
    });

    it('si el reloj local SALTÓ durante la petición (recibido antes que enviado) devuelve null', () => {
      expect(leerDesfaseDelReloj({ cabeceraDate: CABECERA, enviadoEn: 1000, recibidoEn: 500 })).toBeNull();
    });
  });
});

describe('El observador: avisa una vez por hora y guarda la última lectura', () => {
  function observadorDePrueba(): { observador: ObservadorDelRelojDeLaNube; bitacora: string[] } {
    const bitacora: string[] = [];
    return {
      observador: new ObservadorDelRelojDeLaNube((mensaje) => bitacora.push(mensaje)),
      bitacora,
    };
  }

  it('con el reloj en hora no escribe nada en la bitácora', () => {
    const { observador, bitacora } = observadorDePrueba();
    observador.observar(respuestaCon(0, 100));
    expect(bitacora).toEqual([]);
  });

  it('con el reloj mal, avisa UNA vez aunque se midan cien respuestas seguidas', () => {
    const { observador, bitacora } = observadorDePrueba();
    for (let i = 0; i < 100; i += 1) {
      observador.observar(respuestaCon(5 * MS_POR_MINUTO, 100));
    }
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]).toContain('300 s ADELANTADO');
    expect(bitacora[0]).toContain('Revisá la hora del sistema');
  });

  it('vuelve a avisar recién cuando pasó una hora', () => {
    const bitacora: string[] = [];
    const observador = new ObservadorDelRelojDeLaNube((mensaje) => bitacora.push(mensaje), ESPERA_ENTRE_AVISOS_DE_RELOJ_MS);
    const mal = respuestaCon(5 * MS_POR_MINUTO, 100);
    observador.observar(mal);
    // Cincuenta y nueve minutos después: todavía no.
    observador.observar({ ...mal, enviadoEn: mal.enviadoEn + 59 * MS_POR_MINUTO, recibidoEn: mal.recibidoEn + 59 * MS_POR_MINUTO });
    expect(bitacora).toHaveLength(1);
    // Pasada la hora: otra vez.
    observador.observar({ ...mal, enviadoEn: mal.enviadoEn + 61 * MS_POR_MINUTO, recibidoEn: mal.recibidoEn + 61 * MS_POR_MINUTO });
    expect(bitacora).toHaveLength(2);
  });

  it('guarda la última lectura para que una pantalla pueda mostrarla', () => {
    const { observador } = observadorDePrueba();
    expect(observador.ultimaLectura()).toBeNull();
    observador.observar(respuestaCon(7 * MS_POR_SEGUNDO, 100));
    expect(observador.ultimaLectura()?.desfaseSegundos).toBe(7);
  });

  it('una respuesta que no sirve para medir NO pisa la última lectura buena', () => {
    const { observador } = observadorDePrueba();
    observador.observar(respuestaCon(7 * MS_POR_SEGUNDO, 100));
    observador.observar({ cabeceraDate: null, enviadoEn: 1, recibidoEn: 2 });
    expect(observador.ultimaLectura()?.desfaseSegundos).toBe(7);
  });

  it('NUNCA lanza, ni siquiera si la bitácora falla: un diagnóstico no puede tirar abajo la subida que observa', () => {
    const observador = new ObservadorDelRelojDeLaNube(() => {
      throw new Error('el disco está lleno');
    });
    // Con el reloj en hora no hay aviso, así que el registrador roto ni se
    // llama; con el reloj mal sí, y ahí es donde tiene que aguantar.
    expect(() => observador.observar(respuestaCon(0, 100))).not.toThrow();
    expect(() => observador.observar(respuestaCon(5 * MS_POR_MINUTO, 100))).not.toThrow();
    // Y la última lectura quedó igual: lo que falló fue anotarla, no medirla.
    expect(observador.ultimaLectura()?.desfaseSegundos).toBe(300);
  });
});
