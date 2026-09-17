/**
 * La ventana se muestra aunque nunca avise que está lista, y la promesa que
 * habilita la red se resuelve SOLO cuando la ventana ya se mostró.
 *
 * Nace del hallazgo de la tienda del 2026-09-17: con la red del local, la
 * aplicación no llegó a mostrar ninguna pantalla. Ver `mostrar-ventana.ts`.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import {
  ESPERA_MAXIMA_PARA_MOSTRAR_LA_VENTANA_MS,
  mostrarCuandoEsteLista,
  type ComoSeMostro,
} from '../mostrar-ventana';

class VentanaDePrueba extends EventEmitter {
  public mostrada = 0;
  public enfocada = 0;
  public destruida = false;

  public show(): void {
    this.mostrada += 1;
  }

  public focus(): void {
    this.enfocada += 1;
  }

  public isDestroyed(): boolean {
    return this.destruida;
  }
}

/** Un reloj que solo avanza cuando la prueba lo pide. */
function relojManual(): {
  programar: (accion: () => void, ms: number) => unknown;
  cancelar: (identificador: unknown) => void;
  pasarMs: (ms: number) => void;
  pendientes: () => number;
} {
  let ahora = 0;
  let siguiente = 1;
  const tareas = new Map<number, { cuando: number; accion: () => void }>();
  return {
    programar: (accion, ms): unknown => {
      const id = siguiente;
      siguiente += 1;
      tareas.set(id, { cuando: ahora + ms, accion });
      return id;
    },
    cancelar: (identificador): void => {
      tareas.delete(identificador as number);
    },
    pasarMs: (ms): void => {
      ahora += ms;
      for (const [id, tarea] of [...tareas]) {
        if (tarea.cuando <= ahora) {
          tareas.delete(id);
          tarea.accion();
        }
      }
    },
    pendientes: (): number => tareas.size,
  };
}

function preparar(limiteMs = 10_000): {
  ventana: VentanaDePrueba;
  reloj: ReturnType<typeof relojManual>;
  bitacora: string[];
  resultado: Promise<ComoSeMostro>;
  estado: () => ComoSeMostro | 'pendiente';
} {
  const ventana = new VentanaDePrueba();
  const reloj = relojManual();
  const bitacora: string[] = [];
  let resuelta: ComoSeMostro | 'pendiente' = 'pendiente';
  const resultado = mostrarCuandoEsteLista(ventana, {
    limiteMs,
    registrar: (mensaje) => bitacora.push(mensaje),
    msDesdeElInicio: () => 1234,
    programar: reloj.programar,
    cancelar: reloj.cancelar,
  }).then((como) => {
    resuelta = como;
    return como;
  });
  return { ventana, reloj, bitacora, resultado, estado: () => resuelta };
}

/** Deja correr las continuaciones de las promesas. */
const vaciarMicrotareas = (): Promise<void> => new Promise((resolver) => setImmediate(resolver));

describe('Mostrar la ventana: el caso normal', () => {
  it('con «ready-to-show», la ventana se muestra, se enfoca y la promesa dice que avisó', async () => {
    const { ventana, resultado, bitacora } = preparar();
    ventana.emit('ready-to-show');
    await expect(resultado).resolves.toBe('aviso-que-estaba-lista');
    expect(ventana.mostrada).toBe(1);
    expect(ventana.enfocada).toBe(1);
    expect(bitacora).toEqual(['ventana mostrada a los 1234 ms del inicio del proceso: avisó que estaba lista']);
  });

  it('al mostrarse por el aviso, el temporizador del límite se cancela y no vuelve a mostrar nada', async () => {
    const { ventana, reloj, resultado } = preparar();
    ventana.emit('ready-to-show');
    await resultado;
    expect(reloj.pendientes()).toBe(0);
    reloj.pasarMs(60_000);
    expect(ventana.mostrada).toBe(1);
  });
});

describe('Mostrar la ventana: si nunca avisa que está lista', () => {
  it('LA VENTANA SE MUESTRA IGUAL al vencer el límite, y queda escrito que fue por límite', async () => {
    const { ventana, reloj, resultado, bitacora } = preparar(10_000);
    reloj.pasarMs(10_000);
    await expect(resultado).resolves.toBe('por-limite-de-espera');
    expect(ventana.mostrada).toBe(1);
    expect(bitacora[0]).toContain('SIN que avisara que estaba lista');
    expect(bitacora[0]).toContain('no llegó «ready-to-show» en 10000 ms');
  });

  it('ANTES del límite la promesa NO se resuelve: lo que usa la red no puede arrancar con la ventana escondida', async () => {
    const { ventana, reloj, estado } = preparar(10_000);
    reloj.pasarMs(9_999);
    await vaciarMicrotareas();
    expect(estado()).toBe('pendiente');
    expect(ventana.mostrada).toBe(0);
  });

  it('un «ready-to-show» que llega DESPUÉS del límite no la vuelve a mostrar ni cambia el resultado', async () => {
    const { ventana, reloj, resultado } = preparar(10_000);
    reloj.pasarMs(10_000);
    await resultado;
    ventana.emit('ready-to-show');
    await vaciarMicrotareas();
    expect(ventana.mostrada).toBe(1);
    await expect(resultado).resolves.toBe('por-limite-de-espera');
  });

  it('el límite por omisión es de 10 s: «unos pocos segundos», no minutos', () => {
    expect(ESPERA_MAXIMA_PARA_MOSTRAR_LA_VENTANA_MS).toBe(10_000);
  });
});

describe('Mostrar la ventana: si se destruyó antes', () => {
  it('no se llama a show() sobre una ventana destruida, y la promesa lo dice para que NO arranque la red', async () => {
    const { ventana, reloj, resultado, bitacora } = preparar();
    ventana.destruida = true;
    reloj.pasarMs(10_000);
    await expect(resultado).resolves.toBe('destruida-antes-de-mostrarse');
    expect(ventana.mostrada).toBe(0);
    expect(bitacora[0]).toContain('se destruyó antes de mostrarse');
  });
});
