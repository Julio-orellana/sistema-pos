/**
 * Subir una foto a Storage: qué se manda, qué se reintenta y qué NO se sube.
 *
 * ===========================================================================
 * QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO PUEDE PROBAR
 * ===========================================================================
 *
 * Acá el `fetch` es de mentira, así que lo que se comprueba es **lo que la
 * terminal MANDA**: la URL, el bucket, las cabeceras, la ausencia de
 * `x-upsert`, y qué hace con cada respuesta. Que la política REAL de Storage
 * acepte esa petición es otra cosa y no se puede probar sin red: eso lo mide la
 * batería (`verify:nube --destructivo`) y se corrió de verdad contra
 * `pos-pruebas-descartable`.
 *
 * La distinción importa porque es justo la que costó dos defectos en las fases
 * anteriores: un doble contesta lo que uno cree que la nube contesta.
 */

import { describe, expect, it } from 'vitest';

import type { ArchivoParaSubir } from '@main/database/bandeja-de-salida';
import { BUCKET_DE_FOTOS, SubidorDeFotos, tipoDeContenidoDe } from '../subida-de-fotos';

const URL_DEL_PROYECTO = 'https://ztidrshifrblhfraiowg.supabase.co';

const FOTO: ArchivoParaSubir = {
  rutaLocal: 'fotos-de-productos/5ea12297-0000-4000-8000-000000000001.jpg',
  objeto: '5ea12297-0000-4000-8000-000000000001.jpg',
  tamano: 3,
  sha256: 'abc123',
};

interface Peticion {
  readonly url: string;
  readonly opciones: RequestInit;
}

/** Un subidor con el `fetch` anotado, para poder afirmar sobre lo mandado. */
function subidor(
  responder: (intento: number) => { estado: number; cuerpo: string } | Error,
  opciones: { token?: string | null; contenido?: Buffer | null } = {},
): { subir: () => ReturnType<SubidorDeFotos['subir']>; peticiones: Peticion[] } {
  const peticiones: Peticion[] = [];
  const buscar = ((url: string, init?: RequestInit): Promise<Response> => {
    peticiones.push({ url, opciones: init ?? {} });
    const respuesta = responder(peticiones.length);
    if (respuesta instanceof Error) {
      return Promise.reject(respuesta);
    }
    return Promise.resolve({
      status: respuesta.estado,
      text: () => Promise.resolve(respuesta.cuerpo),
    } as Response);
  }) as unknown as typeof fetch;

  const instancia = new SubidorDeFotos({
    urlDelProyecto: URL_DEL_PROYECTO,
    llavePublicable: 'sb_publishable_de_mentira',
    accessToken: (): string | null =>
      opciones.token === undefined ? 'token-vivo' : opciones.token,
    buscar,
    leerArchivo: (): Buffer | null =>
      opciones.contenido === undefined ? Buffer.from('jpg') : opciones.contenido,
  });

  return { subir: () => instancia.subir(FOTO), peticiones };
}

const CUERPO_OK = JSON.stringify({ Key: 'fotos/5ea12297-0000-4000-8000-000000000001.jpg' });

// ===========================================================================
describe('Qué se manda: el bucket, la ruta y las cabeceras', () => {
  it('sube al bucket fotos, por POST, a la ruta de Storage', async () => {
    const { subir, peticiones } = subidor(() => ({ estado: 200, cuerpo: CUERPO_OK }));

    await subir();

    expect(peticiones[0]?.url).toBe(
      `${URL_DEL_PROYECTO}/storage/v1/object/${BUCKET_DE_FOTOS}/${FOTO.objeto}`,
    );
    expect(peticiones[0]?.opciones.method).toBe('POST');
  });

  it('NO manda x-upsert: una foto en una ruta es inmutable (§2.5.2)', async () => {
    /*
      Con `x-upsert` pediría permiso de UPDATE, que la terminal no tiene, y RLS
      la rechazaría. Está medido en la batería de la fase 2.c: la respuesta trae
      «row-level security». Acá se comprueba que ni siquiera se manda.
    */
    const { subir, peticiones } = subidor(() => ({ estado: 200, cuerpo: CUERPO_OK }));

    await subir();

    const cabeceras = peticiones[0]?.opciones.headers as Record<string, string>;
    expect(Object.keys(cabeceras).map((c) => c.toLowerCase())).not.toContain('x-upsert');
  });

  it('manda la credencial de la terminal y la llave publicable', async () => {
    const { subir, peticiones } = subidor(() => ({ estado: 200, cuerpo: CUERPO_OK }));

    await subir();

    const cabeceras = peticiones[0]?.opciones.headers as Record<string, string>;
    expect(cabeceras.Authorization).toBe('Bearer token-vivo');
    expect(cabeceras.apikey).toBe('sb_publishable_de_mentira');
  });

  it('el tipo de contenido sale de la extensión, no se adivina', () => {
    expect(tipoDeContenidoDe('algo.png')).toBe('image/png');
    expect(tipoDeContenidoDe('algo.PNG')).toBe('image/png');
    expect(tipoDeContenidoDe('algo.jpg')).toBe('image/jpeg');
    expect(tipoDeContenidoDe('algo.jpeg')).toBe('image/jpeg');
  });
});

// ===========================================================================
describe('UNA SUBIDA CORTADA A LA MITAD retoma, y no duplica', () => {
  /*
    §2.5.2: no hay TUS ni trozos. Un archivo más chico que un trozo se sube
    entero o no se sube, así que «retomar» es reintentar entero; y lo que
    garantiza que no se duplique NO es el cliente sino Storage, que sin
    `x-upsert` contesta «ya existe» y esa respuesta se lee como ÉXITO.
  */
  it('si se corta la conexión, el primer intento falla como TRANSITORIO', async () => {
    const { subir } = subidor(() => new Error('socket hang up'));

    const resultado = await subir();

    expect(resultado.ok).toBe(false);
    // Sin código HTTP: el trabajador lo lee como transitorio y lo reintenta.
    expect(resultado.estadoHttp).toBeUndefined();
    expect(resultado.archivoAusente).toBeUndefined();
  });

  it('el reintento que encuentra el objeto YA SUBIDO se marca como éxito', async () => {
    /*
      Este es el caso que el diseño describe: la subida llegó y la confirmación
      se perdió. Volver a mandarla choca con «ya existe», y como el contenido de
      esa ruta es inmutable, eso NO es un error: es la prueba de que los bytes
      están allá.
    */
    const { subir } = subidor(() => ({
      estado: 409,
      cuerpo: JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'KeyAlreadyExists' }),
    }));

    const resultado = await subir();

    expect(resultado.ok).toBe(true);
    expect(resultado.cambiosAceptados).toBe(1);
  });

  it('«ya existe» se reconoce por el CUERPO, no por el código: Storage usa 400', async () => {
    // Medido en la fase 2.c: Storage contesta casi todo con 400 y el código
    // real adentro del JSON. Clasificar por el 400 mandaría un ÉXITO a detener
    // la cola.
    const { subir } = subidor(() => ({
      estado: 400,
      cuerpo: JSON.stringify({ statusCode: '400', message: 'The resource already exists' }),
    }));

    expect((await subir()).ok).toBe(true);
  });

  it('cortada y después reintentada, MANDA LOS BYTES UNA SOLA VEZ POR INTENTO', async () => {
    const { subir, peticiones } = subidor((intento) =>
      intento === 1 ? new Error('ECONNRESET') : { estado: 200, cuerpo: CUERPO_OK },
    );

    const primero = await subir();
    const segundo = await subir();

    expect(primero.ok).toBe(false);
    expect(segundo.ok).toBe(true);
    expect(peticiones).toHaveLength(2);
  });
});

// ===========================================================================
describe('Los otros desenlaces se clasifican para que el trabajador sepa qué hacer', () => {
  it('sin credencial devuelve 401, que deja la cola INTACTA', async () => {
    const { subir, peticiones } = subidor(() => ({ estado: 200, cuerpo: CUERPO_OK }), {
      token: null,
    });

    const resultado = await subir();

    expect(resultado.estadoHttp).toBe(401);
    // Y ni siquiera sale a la red: no hay nada que intentar.
    expect(peticiones).toEqual([]);
  });

  it('un archivo que ya no está se marca archivoAusente, SIN salir a la red', async () => {
    const { subir, peticiones } = subidor(() => ({ estado: 200, cuerpo: CUERPO_OK }), {
      contenido: null,
    });

    const resultado = await subir();

    expect(resultado.archivoAusente).toBe(true);
    expect(resultado.estadoHttp).toBeUndefined();
    expect(peticiones).toEqual([]);
    expect(resultado.errores[0]).toMatch(/archivo_ausente/);
  });

  it('un 5xx se devuelve con su código, para que se lea como transitorio', async () => {
    const { subir } = subidor(() => ({ estado: 503, cuerpo: 'service unavailable' }));

    expect((await subir()).estadoHttp).toBe(503);
  });

  it('un rechazo de RLS se devuelve con su código y su texto', async () => {
    const { subir } = subidor(() => ({
      estado: 403,
      cuerpo: JSON.stringify({ message: 'new row violates row-level security policy' }),
    }));

    const resultado = await subir();

    expect(resultado.estadoHttp).toBe(403);
    expect(resultado.errores[0]).toMatch(/row-level security/);
  });
});
