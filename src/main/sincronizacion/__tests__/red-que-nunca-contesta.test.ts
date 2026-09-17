/**
 * UNA RED QUE NUNCA CONTESTA NO DEJA NADA ESPERANDO PARA SIEMPRE.
 *
 * Nace del hallazgo de la tienda del 2026-09-17: con la red del local, la
 * aplicación no llegó a mostrar ninguna pantalla. La hipótesis es una petición
 * que ni se resuelve ni se rechaza porque algo en esa red descarta los paquetes
 * en silencio.
 *
 * Estas pruebas le dan a cada módulo que habla con la nube un `fetch` que hace
 * EXACTAMENTE eso: no contesta nunca, y solo se rinde si le cortan la señal
 * —que es como se comportan `net.fetch` de Electron 44 y el `fetch` de Node,
 * medido ese día contra servidores mudos—. Y otro que manda los encabezados y
 * se calla a mitad del cuerpo. En cada caso se exige:
 *
 *   - que la operación TERMINE justo al vencer su límite, y no antes;
 *   - que termine como «no hay conexión» (transitorio, sin código HTTP), que es
 *     el mismo resultado que cuando de verdad no hay red;
 *   - que el límite sea el declarado, para que un cambio de número se vea.
 *
 * Las fotos y la restauración usan `AbortSignal.timeout`, que los relojes
 * falsos de Vitest no controlan; su `signal` lo exige la prueba estructural
 * `toda-peticion-de-red-lleva-limite.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CambioSincronizable } from '@shared/adapters';
import { ClienteDeAuthHttp, TIEMPO_MAXIMO_DE_AUTH_MS } from '../auth-de-nube';
import { DetectorDeConexion, TIEMPO_MAXIMO_DE_SALUD_MS } from '../deteccion-de-conexion';
import { clasificarFallo } from '../reintentos';
import type { EstadoDeNube, SesionDeNube } from '../sesion-de-nube';
import { SupabaseSyncProvider, TIEMPO_MAXIMO_DE_RPC_MS } from '../supabase-sync-provider';

const URL_DEL_PROYECTO = 'https://ztidrshifrblhfraiowg.supabase.co';
const REFERENCIA = 'ztidrshifrblhfraiowg';
const LLAVE = 'sb_publishable_de_mentira';

function errorDeCorte(): Error {
  return new DOMException('This operation was aborted', 'AbortError');
}

/** No contesta nunca. Solo rechaza si le cortan la señal. */
function fetchMudo(): { buscar: typeof fetch; llamadas: () => number } {
  let llamadas = 0;
  const buscar = ((_url: string, opciones?: RequestInit): Promise<Response> => {
    llamadas += 1;
    return new Promise<Response>((_resolver, rechazar) => {
      opciones?.signal?.addEventListener('abort', () => {
        rechazar(errorDeCorte());
      });
    });
  }) as unknown as typeof fetch;
  return { buscar, llamadas: () => llamadas };
}

/** Contesta 200 con los encabezados del proyecto y se calla a mitad del cuerpo. */
function fetchConCuerpoMudo(): typeof fetch {
  return ((_url: string, opciones?: RequestInit): Promise<Response> => {
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controlador): void {
        controlador.enqueue(new TextEncoder().encode('{"name":"Go'));
        opciones?.signal?.addEventListener('abort', () => {
          controlador.error(errorDeCorte());
        });
      },
    });
    return Promise.resolve(
      new Response(cuerpo, {
        status: 200,
        headers: { 'sb-project-ref': REFERENCIA, date: new Date().toUTCString() },
      }),
    );
  }) as unknown as typeof fetch;
}

/** Corre la operación y dice si ya terminó, sin esperarla. */
function observar<T>(operacion: Promise<T>): { terminada: () => boolean; valor: () => T | undefined } {
  let terminada = false;
  let valor: T | undefined;
  void operacion.then((resultado) => {
    terminada = true;
    valor = resultado;
  });
  return { terminada: () => terminada, valor: () => valor };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Detección de conexión contra una red que nunca contesta', () => {
  const detector = (buscar: typeof fetch): DetectorDeConexion =>
    new DetectorDeConexion({
      urlDelProyecto: URL_DEL_PROYECTO,
      referenciaDelProyecto: REFERENCIA,
      llavePublicable: LLAVE,
      sistemaDiceQueHayRed: (): boolean => true,
      buscar,
    });

  it(`el límite del health es de ${String(TIEMPO_MAXIMO_DE_SALUD_MS / 1000)} s: unos pocos segundos`, () => {
    expect(TIEMPO_MAXIMO_DE_SALUD_MS).toBe(8_000);
  });

  it('SIN RESPUESTA: sigue esperando un instante antes del límite, y AL límite termina como «sin nube»', async () => {
    const { buscar, llamadas } = fetchMudo();
    const operacion = observar(detector(buscar).comprobar());
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DE_SALUD_MS - 1);
    expect(llamadas()).toBe(1);
    expect(operacion.terminada()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(operacion.terminada()).toBe(true);
    expect(operacion.valor()).toEqual({
      hayNube: false,
      motivo: 'La nube no contestó en 8 s.',
      capa: 2,
    });
  });

  it('CUERPO MUDO: con los encabezados del proyecto pero el cuerpo a medias, también termina como «sin nube»', async () => {
    const operacion = observar(detector(fetchConCuerpoMudo()).comprobar());
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DE_SALUD_MS);
    expect(operacion.terminada()).toBe(true);
    expect(operacion.valor()?.hayNube).toBe(false);
  });

  it('el latido diario contra una red muda termina en su límite y devuelve «no se pudo»', async () => {
    const { buscar } = fetchMudo();
    const operacion = observar(detector(buscar).latir('token'));
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DE_SALUD_MS);
    expect(operacion.terminada()).toBe(true);
    expect(operacion.valor()).toBe(false);
  });
});

describe('La renovación de la sesión (Auth) contra una red que nunca contesta', () => {
  it(`el límite de Auth es de ${String(TIEMPO_MAXIMO_DE_AUTH_MS / 1000)} s`, () => {
    expect(TIEMPO_MAXIMO_DE_AUTH_MS).toBe(20_000);
  });

  it('SIN RESPUESTA: al límite termina SIN código HTTP, o sea como red caída y no como credencial muerta', async () => {
    const { buscar } = fetchMudo();
    const bitacora: string[] = [];
    const cliente = new ClienteDeAuthHttp(URL_DEL_PROYECTO, LLAVE, buscar, {
      registrar: (mensaje): void => {
        bitacora.push(mensaje);
      },
    });
    const operacion = observar(cliente.refrescar('refresco'));
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DE_AUTH_MS - 1);
    expect(operacion.terminada()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(operacion.terminada()).toBe(true);
    expect(operacion.valor()).toEqual({ ok: false, fallo: { mensaje: 'Supabase Auth no contestó en 20 s.' } });
    expect(bitacora).toEqual(['Auth no contestó a la renovación de la sesión: Supabase Auth no contestó en 20 s.']);
  });

  it('CUERPO MUDO: la respuesta a medias también termina al límite', async () => {
    const cliente = new ClienteDeAuthHttp(URL_DEL_PROYECTO, LLAVE, fetchConCuerpoMudo());
    const operacion = observar(cliente.refrescar('refresco'));
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DE_AUTH_MS);
    expect(operacion.terminada()).toBe(true);
    expect(operacion.valor()).toEqual({ ok: false, fallo: { mensaje: 'Supabase Auth no contestó en 20 s.' } });
  });
});

describe('La subida de un lote contra una nube que nunca contesta', () => {
  const sesion = {
    accessTokenVigente: (): string => 'token',
    estado: (): EstadoDeNube => ({ conectada: true }) as EstadoDeNube,
  } as unknown as SesionDeNube;
  const lote: CambioSincronizable[] = [
    {
      tabla: 'categorias',
      idRegistro: '11111111-1111-4111-8111-111111111111',
      operacion: 'insertar',
      datos: { id: '11111111-1111-4111-8111-111111111111', nombre: 'Granos' },
      actualizadoEn: '2026-09-17T00:00:00.000Z',
    },
  ];

  it(`el límite de la subida es de ${String(TIEMPO_MAXIMO_DE_RPC_MS / 1000)} s`, () => {
    expect(TIEMPO_MAXIMO_DE_RPC_MS).toBe(30_000);
  });

  it('SIN RESPUESTA: al límite termina como TRANSITORIO (sin código), así el trabajador reintenta y no detiene la cola', async () => {
    const { buscar } = fetchMudo();
    const proveedor = new SupabaseSyncProvider({ urlDelProyecto: URL_DEL_PROYECTO, llavePublicable: LLAVE, sesion, buscar });
    const operacion = observar(proveedor.empujarCambios(lote));
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DE_RPC_MS - 1);
    expect(operacion.terminada()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(operacion.terminada()).toBe(true);
    const resultado = operacion.valor();
    expect(resultado?.ok).toBe(false);
    expect(resultado?.estadoHttp).toBeUndefined();
    expect(resultado?.errores).toEqual(['sincronizar_lote_simple no contestó en 30 s.']);
    expect(resultado === undefined ? null : clasificarFallo(resultado)).toBe('transitorio');
  });

  it('CUERPO MUDO: la constancia a medias también termina al límite, como transitorio', async () => {
    const proveedor = new SupabaseSyncProvider({
      urlDelProyecto: URL_DEL_PROYECTO,
      llavePublicable: LLAVE,
      sesion,
      buscar: fetchConCuerpoMudo(),
    });
    const operacion = observar(proveedor.empujarCambios(lote));
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DE_RPC_MS);
    expect(operacion.terminada()).toBe(true);
    expect(operacion.valor()?.estadoHttp).toBeUndefined();
  });
});
