/**
 * A qué proyecto de Supabase apunta la aplicación (§4.38 de CLAUDE.md).
 *
 * Lo que estas pruebas tienen que sostener es la regla de precedencia, porque
 * equivocarla no rompe nada a la vista: la aplicación seguiría funcionando,
 * hablando **en silencio** con el proyecto equivocado. Es la misma confusión
 * entre el de pruebas y el real que ya costó una vuelta (§4.37), y esta vez
 * con la nube de por medio en vez de una pantalla de ingreso.
 */
import { describe, expect, it } from 'vitest';

import {
  describirConfiguracionDeNube,
  leerConfiguracionDeNube,
  referenciaDelProyecto,
} from '@main/configuracion-de-nube';

const DESCARTABLE = {
  url: 'https://ztidrshifrblhfraiowg.supabase.co',
  llavePublicable: 'sb_publishable_del_descartable',
  proveedor: 'supabase',
};
const REAL = {
  url: 'https://zgsdaelmbxufgcsideep.supabase.co',
  llavePublicable: 'sb_publishable_del_real',
  proveedor: 'supabase',
};

describe('EL ENTORNO GANA sobre lo incrustado', () => {
  it('con POS_NUBE_URL definida, los TRES valores salen del entorno', () => {
    const configuracion = leerConfiguracionDeNube(
      {
        POS_NUBE_URL: REAL.url,
        POS_NUBE_LLAVE_PUBLICABLE: REAL.llavePublicable,
        POS_SYNC_PROVIDER: 'supabase',
      },
      DESCARTABLE,
    );
    expect(configuracion).toEqual({
      url: REAL.url,
      llavePublicable: REAL.llavePublicable,
      proveedor: 'supabase',
      origen: 'entorno',
    });
  });

  it('NO MEZCLA: si el entorno trae la URL pero no la llave, la llave NO se completa con la incrustada', () => {
    // Media configuración de cada lado sería una tercera que nadie escribió, y
    // encima apuntaría a un proyecto con la llave de otro.
    const configuracion = leerConfiguracionDeNube({ POS_NUBE_URL: REAL.url }, DESCARTABLE);
    expect(configuracion.llavePublicable).toBe('');
    expect(configuracion.origen).toBe('entorno');
  });

  it('es lo que hace que los arneses sigan apuntando a donde dicen', () => {
    // `ensayo:restauracion` lanza la aplicación con estas variables. Si lo
    // incrustado ganara, el arnés diría «descartable» y la aplicación estaría
    // hablando con el real.
    const configuracion = leerConfiguracionDeNube(
      { POS_NUBE_URL: DESCARTABLE.url, POS_NUBE_LLAVE_PUBLICABLE: DESCARTABLE.llavePublicable, POS_SYNC_PROVIDER: 'supabase' },
      REAL,
    );
    expect(referenciaDelProyecto(configuracion.url)).toBe('ztidrshifrblhfraiowg');
  });
});

describe('Sin entorno, manda lo incrustado: es lo que hace que el .exe se conecte solo', () => {
  it('con el entorno vacío devuelve lo incrustado, y lo dice', () => {
    const configuracion = leerConfiguracionDeNube({}, DESCARTABLE);
    expect(configuracion).toEqual({
      url: DESCARTABLE.url,
      llavePublicable: DESCARTABLE.llavePublicable,
      proveedor: 'supabase',
      origen: 'incrustada',
    });
  });

  it('una URL vacía en el entorno NO cuenta como configuración', () => {
    const configuracion = leerConfiguracionDeNube({ POS_NUBE_URL: '' }, DESCARTABLE);
    expect(configuracion.origen).toBe('incrustada');
  });
});

describe('Sin ninguna de las dos: sin nube, que es un resultado válido', () => {
  it('devuelve vacío y origen «ninguna»', () => {
    const configuracion = leerConfiguracionDeNube({}, null);
    expect(configuracion.url).toBe('');
    expect(configuracion.llavePublicable).toBe('');
    expect(configuracion.origen).toBe('ninguna');
  });

  it('una incrustación con la URL vacía se trata como si no hubiera ninguna', () => {
    expect(leerConfiguracionDeNube({}, { url: '', llavePublicable: 'x', proveedor: 'supabase' }).origen).toBe('ninguna');
  });

  it('en Vitest, que no pasa por electron-vite, NO lanza por el identificador inexistente', () => {
    // El `typeof` del módulo es lo que lo evita. Sin él, esta llamada sin el
    // segundo argumento sería un ReferenceError y caería media suite.
    expect(() => leerConfiguracionDeNube({})).not.toThrow();
    expect(leerConfiguracionDeNube({}).origen).toBe('ninguna');
  });
});

describe('La referencia del proyecto, que es como se lo reconoce en el panel', () => {
  it('sale del anfitrión de la URL', () => {
    expect(referenciaDelProyecto(DESCARTABLE.url)).toBe('ztidrshifrblhfraiowg');
    expect(referenciaDelProyecto(REAL.url)).toBe('zgsdaelmbxufgcsideep');
  });

  it('con una URL vacía o inválida devuelve vacío en vez de lanzar', () => {
    expect(referenciaDelProyecto('')).toBe('');
    expect(referenciaDelProyecto('no soy una url')).toBe('');
  });
});

describe('Lo que queda escrito en la bitácora', () => {
  it('dice el proyecto, de dónde salió y con qué proveedor va a subir', () => {
    const linea = describirConfiguracionDeNube(leerConfiguracionDeNube({}, DESCARTABLE));
    expect(linea).toContain('ztidrshifrblhfraiowg');
    expect(linea).toContain('incrustado al compilar');
    expect(linea).toContain('SupabaseSyncProvider');
  });

  it('distingue el proveedor SIMULADO, que es el que no toca la red', () => {
    const linea = describirConfiguracionDeNube(
      leerConfiguracionDeNube({}, { ...DESCARTABLE, proveedor: 'simulado' }),
    );
    expect(linea).toContain('SIMULADO');
    expect(linea).not.toContain('SupabaseSyncProvider');
  });

  it('sin nube lo dice con todas las letras, en vez de callarse', () => {
    expect(describirConfiguracionDeNube(leerConfiguracionDeNube({}, null))).toContain('sin proyecto de nube configurado');
  });

  it('NUNCA escribe la llave publicable entera en la bitácora', () => {
    const linea = describirConfiguracionDeNube(leerConfiguracionDeNube({}, DESCARTABLE));
    expect(linea).not.toContain(DESCARTABLE.llavePublicable);
  });
});
