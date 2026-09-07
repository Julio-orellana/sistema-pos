/**
 * Pruebas del envoltorio de respuesta IPC.
 *
 * Este módulo decide QUÉ TEXTO llega a la pantalla cuando algo falla, así que
 * es la diferencia entre que el cajero lea «El precio no puede ser negativo» y
 * que lea «La operación no pudo completarse». Antes esa lógica vivía suelta
 * dentro de register-handlers.ts y no tenía ninguna prueba; ahora vive en un
 * solo lugar y esta es su red.
 *
 * La regla que se verifica es de dos filos:
 *   · un ErrorDeNegocio SÍ cruza con su código y su mensaje, porque están
 *     escritos para que los lea una persona;
 *   · cualquier OTRO error NO cruza su texto, porque un fallo inesperado no
 *     debe filtrar detalles internos a la ventana.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ErrorDeNegocio } from '@main/database/errores';
import { ejecutarConRespuesta } from '../respuesta';

/** Saca el error de una respuesta, o falla si la respuesta fue exitosa. */
function errorDe<T>(respuesta: Awaited<ReturnType<typeof ejecutarConRespuesta<T>>>): {
  codigo: string;
  mensaje: string;
  detalle?: string;
} {
  if (respuesta.ok) {
    throw new Error('Se esperaba una respuesta fallida y llegó una exitosa.');
  }
  return respuesta.error;
}

// ===========================================================================
describe('Una operación que funciona', () => {
  it('devuelve los datos dentro del sobre', async () => {
    const respuesta = await ejecutarConRespuesta('DA_IGUAL', () => ({ total: '16.80' }));

    expect(respuesta.ok).toBe(true);
    expect(respuesta.ok && respuesta.datos).toEqual({ total: '16.80' });
  });

  it('espera a una operación asíncrona antes de responder', async () => {
    const respuesta = await ejecutarConRespuesta('DA_IGUAL', async () => {
      await Promise.resolve();
      return 'listo';
    });

    expect(respuesta.ok && respuesta.datos).toBe('listo');
  });
});

// ===========================================================================
describe('Un ErrorDeNegocio llega a la pantalla con SU mensaje', () => {
  it('conserva el código de negocio, no el genérico del manejador', async () => {
    const respuesta = await ejecutarConRespuesta('PRODUCTO_CREACION_FALLIDA', () => {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El precio no puede ser negativo. Se permite 0, para muestras y regalos.',
        'precio_base recibido: -5.00',
      );
    });

    expect(errorDe(respuesta).codigo).toBe('DATO_INVALIDO');
  });

  it('conserva el texto exacto que se le muestra a la persona', async () => {
    const respuesta = await ejecutarConRespuesta('PRODUCTO_CREACION_FALLIDA', () => {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'El precio no puede ser negativo. Se permite 0, para muestras y regalos.',
        'precio_base recibido: -5.00',
      );
    });

    // Este es exactamente el texto que se verificó manejando la aplicación real.
    expect(errorDe(respuesta).mensaje).toBe(
      'El precio no puede ser negativo. Se permite 0, para muestras y regalos.',
    );
    expect(errorDe(respuesta).mensaje).not.toBe('La operación no pudo completarse.');
  });

  it('lleva la causa técnica aparte, para la bitácora', async () => {
    const respuesta = await ejecutarConRespuesta('DA_IGUAL', () => {
      throw new ErrorDeNegocio('STOCK_INSUFICIENTE', 'Stock insuficiente.', 'CHECK constraint');
    });

    expect(errorDe(respuesta).detalle).toBe('CHECK constraint');
  });

  it('un PERMISO_DENEGADO del guard también llega con su explicación', async () => {
    // Es el caso de todos los canales del catálogo: el guard `requiereRol`
    // lanza este error y quien lo ve tiene que entender que le falta el rol,
    // no que "algo salió mal".
    const respuesta = await ejecutarConRespuesta('CATEGORIA_CREACION_FALLIDA', () => {
      throw new ErrorDeNegocio(
        'PERMISO_DENEGADO',
        'Esta acción requiere el rol "administrativo" y tu usuario tiene el rol "venta".',
        'Usuario X con rol venta intentó una acción que exige administrativo.',
      );
    });

    expect(errorDe(respuesta).codigo).toBe('PERMISO_DENEGADO');
    expect(errorDe(respuesta).mensaje).toContain('administrativo');
  });
});

// ===========================================================================
describe('Cualquier otro error NO filtra su texto a la ventana', () => {
  it('un Error común usa el código del manejador y el mensaje genérico', async () => {
    const respuesta = await ejecutarConRespuesta('CIERRE_DE_CAJA_FALLIDO', () => {
      throw new Error('SQLITE_CORRUPT: la página 42 del índice está dañada');
    });

    expect(errorDe(respuesta).codigo).toBe('CIERRE_DE_CAJA_FALLIDO');
    expect(errorDe(respuesta).mensaje).toBe('La operación no pudo completarse.');
  });

  it('pero el detalle técnico SÍ viaja, porque la bitácora lo necesita', async () => {
    const respuesta = await ejecutarConRespuesta('CIERRE_DE_CAJA_FALLIDO', () => {
      throw new Error('SQLITE_CORRUPT: la página 42 del índice está dañada');
    });

    expect(errorDe(respuesta).detalle).toContain('SQLITE_CORRUPT');
  });

  it('un payload que no cumple el contrato se reporta como PAYLOAD_INVALIDO', async () => {
    const respuesta = await ejecutarConRespuesta('PRODUCTO_CREACION_FALLIDA', () => {
      z.object({ nombre: z.string().min(1) }).parse({ nombre: '' });
      return null;
    });

    expect(errorDe(respuesta).codigo).toBe('PAYLOAD_INVALIDO');
  });

  it('algo que ni siquiera es un Error tampoco rompe el sobre', async () => {
    const respuesta = await ejecutarConRespuesta('DA_IGUAL', () => {
      // Lanzar algo que no es un Error es un defecto, pero pasa; el sobre
      // tiene que sobrevivirlo igual en vez de dejar la pantalla colgada.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'una cadena suelta';
    });

    expect(respuesta.ok).toBe(false);
    expect(errorDe(respuesta).detalle).toBe('una cadena suelta');
  });
});

// ===========================================================================
describe('Los flujos anteriores no dependían de este envoltorio', () => {
  it('un PIN equivocado NO es un error: viaja como respuesta exitosa', async () => {
    // El ingreso, la salida controlada y el cierre de caja devuelven su propio
    // resultado con `autenticado: false` o `cerrada: false` DENTRO del sobre
    // exitoso, y nunca lanzan. Por eso el cambio de envoltorio no los toca:
    // su camino normal jamás pasó por aquí.
    const respuesta = await ejecutarConRespuesta('INGRESO_FALLIDO', () => ({
      autenticado: false,
      codigo: 'PIN_INCORRECTO',
      mensaje: 'El PIN no es correcto.',
      sesion: null,
      segundosParaReintentar: null,
    }));

    expect(respuesta.ok).toBe(true);
    expect(respuesta.ok && respuesta.datos.codigo).toBe('PIN_INCORRECTO');
  });

  it('un cierre que requiere autorización también viaja como respuesta exitosa', async () => {
    const respuesta = await ejecutarConRespuesta('CIERRE_DE_CAJA_FALLIDO', () => ({
      cerrada: false,
      codigo: 'REQUIERE_AUTORIZACION',
      diferencia: '-20.00',
    }));

    expect(respuesta.ok).toBe(true);
    expect(respuesta.ok && respuesta.datos.diferencia).toBe('-20.00');
  });
});
