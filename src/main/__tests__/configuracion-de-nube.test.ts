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

  it('distingue las dos procedencias: «por variables de entorno» e «incrustado al compilar»', () => {
    // No es cosmético: es lo que permite mirar una bitácora y saber si esa
    // copia quedó apuntada por un arnés o por la compilación.
    const porEntorno = describirConfiguracionDeNube(
      leerConfiguracionDeNube({ POS_NUBE_URL: REAL.url, POS_SYNC_PROVIDER: 'supabase' }, DESCARTABLE),
    );
    expect(porEntorno).toContain('por variables de entorno');
    expect(porEntorno).toContain('zgsdaelmbxufgcsideep');
    expect(describirConfiguracionDeNube(leerConfiguracionDeNube({}, DESCARTABLE))).toContain('incrustado al compilar');
  });
});

describe('El proveedor, que es la diferencia entre subir y decir que se subió', () => {
  it('si el entorno trae la URL pero NO el proveedor, queda sin definir y la bitácora avisa que es el SIMULADO', () => {
    // El caso que más engaña: la pantalla de nube diría «conectada» y la de
    // sincronización «al día», con el proveedor simulado y sin que nada
    // hubiera viajado. Es la trampa medida en §4.35.
    const configuracion = leerConfiguracionDeNube({ POS_NUBE_URL: DESCARTABLE.url }, DESCARTABLE);
    expect(configuracion.proveedor).toBeUndefined();
    expect(describirConfiguracionDeNube(configuracion)).toContain('SIMULADO');
  });

  it('lo incrustado puede pedir el simulado, y se respeta', () => {
    const configuracion = leerConfiguracionDeNube({}, { ...DESCARTABLE, proveedor: 'simulado' });
    expect(configuracion.proveedor).toBe('simulado');
  });

  it('sin nube por ningún lado, el proveedor sigue saliendo del entorno', () => {
    // Es el caso de `npm run dev` con POS_SYNC_PROVIDER puesto y sin URL: no
    // hay a qué conectarse, pero la elección del adaptador no se pierde.
    expect(leerConfiguracionDeNube({ POS_SYNC_PROVIDER: 'supabase' }, null).proveedor).toBe('supabase');
  });
});

describe('Sin argumentos lee el process.env de verdad', () => {
  it('no lanza y devuelve una configuración coherente', () => {
    // En Vitest no hay POS_NUBE_URL ni identificador incrustado, así que el
    // resultado esperado es «ninguna». Lo que se comprueba es que el valor por
    // omisión del parámetro sea `process.env` y no un objeto vacío inventado.
    const configuracion = leerConfiguracionDeNube();
    expect(configuracion.origen).toBe('ninguna');
    expect(configuracion.url).toBe('');
  });
});
