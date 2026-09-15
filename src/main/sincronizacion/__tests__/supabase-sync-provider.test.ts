/**
 * El proveedor real contra Supabase: la lista de verificación de la Fase 3.b.
 *
 * **SIN RED.** El `fetch` se inyecta y las pruebas registran exactamente qué
 * URL, qué cabeceras y qué cuerpo se habrían mandado, y contestan lo que la
 * prueba necesite. Es la única forma de afirmar «llamó a `sincronizar_venta`
 * con las filas en orden» sin depender de que Supabase esté disponible ni de
 * consumir la cuota del plan gratuito.
 *
 * LAS PREGUNTAS QUE CONTESTA:
 *
 *   1. ¿Cada lote llama a SU función, con el payload en la forma exacta que
 *      `exigir_forma_del_cambio` valida allá?
 *   2. ¿Repetir un lote se trata como ÉXITO y no como error?
 *   3. ¿Un desajuste de contrato detiene la cola nombrando los dos números?
 *   4. Sin credencial usable, ¿se informa como tal y NO como fallo de red?
 */

import { describe, expect, it, beforeEach } from 'vitest';

import type { CambioSincronizable } from '@shared/adapters';
import { VERSION_DEL_CONTRATO_DE_SINCRONIZACION } from '@shared/contrato-de-sincronizacion';
import { clasificarFallo } from '../reintentos';
import { SupabaseSyncProvider } from '../supabase-sync-provider';
import type { EstadoDeNube, SesionDeNube } from '../sesion-de-nube';

const URL_DEL_PROYECTO = 'https://ztidrshifrblhfraiowg.supabase.co';
const LLAVE = 'sb_publishable_de_mentira';
const TOKEN = 'eyJ-un-access-token-de-mentira';

/** Lo que se le pidió a la red, para poder afirmar sobre ello. */
interface PeticionVista {
  readonly url: string;
  readonly cabeceras: Record<string, string>;
  readonly cuerpo: { lote: unknown[]; version_de_contrato: number };
}

/** Un `fetch` de mentira que anota lo que le pidieron y contesta a pedido. */
function fetchDeMentira(respuestas: { estado: number; cuerpo: string }[]): {
  buscar: typeof fetch;
  vistas: PeticionVista[];
} {
  const vistas: PeticionVista[] = [];
  const buscar = ((url: string, opciones: RequestInit): Promise<Response> => {
    vistas.push({
      url,
      cabeceras: opciones.headers as Record<string, string>,
      cuerpo: JSON.parse(opciones.body as string) as PeticionVista['cuerpo'],
    });
    const siguiente = respuestas.shift() ?? { estado: 200, cuerpo: '{}' };
    return Promise.resolve({
      ok: siguiente.estado >= 200 && siguiente.estado < 300,
      status: siguiente.estado,
      text: () => Promise.resolve(siguiente.cuerpo),
    } as Response);
  }) as unknown as typeof fetch;
  return { buscar, vistas };
}

/** Una sesión de nube de mentira: solo lo que el proveedor le pregunta. */
function sesionDeMentira(token: string | null, extra: Partial<EstadoDeNube> = {}): SesionDeNube {
  const estado: EstadoDeNube = {
    hayCredencial: token !== null,
    conectada: token !== null,
    correo: 'terminal@pos.invalid',
    rol: 'terminal',
    vidaDelTokenSegundos: 900,
    desfaseDeRelojSegundos: 0,
    relojSospechoso: false,
    renovacionesFallidas: 0,
    ultimoMotivo: null,
    revocada: false,
    revocadaDesde: null,
    exposicionHasta: null,
    filasPendientes: null,
    ...extra,
  };
  return {
    accessTokenVigente: (): string | null => token,
    estado: (): EstadoDeNube => estado,
  } as unknown as SesionDeNube;
}

function fila(tabla: string, id: string, datos: Record<string, unknown> = {}): CambioSincronizable {
  return {
    tabla,
    idRegistro: id,
    operacion: 'insertar',
    datos: { id, ...datos },
    actualizadoEn: '2026-09-13T00:00:00.000Z',
  };
}

/** La constancia que devuelve una función cuando todo salió bien. */
function constanciaDe(funcion: string, filas: CambioSincronizable[], resultado = 'insertada'): string {
  return JSON.stringify({
    funcion,
    contrato: VERSION_DEL_CONTRATO_DE_SINCRONIZACION,
    filas: filas.map((f) => ({
      tabla: `public.${f.tabla}`,
      id: f.idRegistro,
      resultado,
      huella: 'abc123',
      recibido_en: '2026-09-13T22:00:00+00:00',
    })),
  });
}

const VENTA = [
  fila('productos', 'p-1'),
  fila('ventas', 'v-1'),
  fila('venta_detalle', 'd-1'),
  fila('auditoria_log', 'a-1'),
];

function armar(
  respuestas: { estado: number; cuerpo: string }[],
  token: string | null = TOKEN,
  extra: Partial<EstadoDeNube> = {},
): { proveedor: SupabaseSyncProvider; vistas: PeticionVista[]; bitacora: string[] } {
  const { buscar, vistas } = fetchDeMentira(respuestas);
  const bitacora: string[] = [];
  const proveedor = new SupabaseSyncProvider({
    urlDelProyecto: URL_DEL_PROYECTO,
    llavePublicable: LLAVE,
    sesion: sesionDeMentira(token, extra),
    buscar,
    registrar: (m): number => bitacora.push(m),
  });
  return { proveedor, vistas, bitacora };
}

// ===========================================================================
describe('Cada lote llama a SU función de la nube', () => {
  it('una venta llama a sincronizar_venta', async () => {
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA) }]);

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.ok).toBe(true);
    expect(vistas[0]?.url).toBe(`${URL_DEL_PROYECTO}/rest/v1/rpc/sincronizar_venta`);
  });

  it('un alta de usuario llama a sincronizar_usuario', async () => {
    const lote = [fila('usuarios', 'u-1', { rol: 'venta' }), fila('auditoria_log', 'a-1')];
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_usuario', lote) }]);

    await proveedor.empujarCambios(lote);

    expect(vistas[0]?.url).toContain('/rpc/sincronizar_usuario');
  });

  it('una apertura de caja llama a sincronizar_apertura_de_caja Y NO al cierre', async () => {
    const lote = [fila('caja_sesiones', 'c-1', { estado: 'abierta' }), fila('auditoria_log', 'a-1')];
    const { proveedor, vistas } = armar([
      { estado: 200, cuerpo: constanciaDe('sincronizar_apertura_de_caja', lote) },
    ]);

    await proveedor.empujarCambios(lote);

    expect(vistas[0]?.url).toContain('/rpc/sincronizar_apertura_de_caja');
    expect(vistas[0]?.url).not.toContain('cierre');
  });

  it('un cierre de caja llama a sincronizar_cierre_de_caja Y NO a la apertura', async () => {
    const lote = [fila('caja_sesiones', 'c-1', { estado: 'cerrada' }), fila('auditoria_log', 'a-1')];
    const { proveedor, vistas } = armar([
      { estado: 200, cuerpo: constanciaDe('sincronizar_cierre_de_caja', lote) },
    ]);

    await proveedor.empujarCambios(lote);

    expect(vistas[0]?.url).toContain('/rpc/sincronizar_cierre_de_caja');
    expect(vistas[0]?.url).not.toContain('apertura');
  });

  it('el catálogo llama a sincronizar_lote_simple', async () => {
    const lote = [fila('categorias', 'cat-1'), fila('auditoria_log', 'a-1')];
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_lote_simple', lote) }]);

    await proveedor.empujarCambios(lote);

    expect(vistas[0]?.url).toContain('/rpc/sincronizar_lote_simple');
  });
});

// ===========================================================================
describe('El payload tiene la forma EXACTA que la nube valida', () => {
  it('cada cambio es {tabla, id, operacion, datos}, y nada más', async () => {
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA) }]);

    await proveedor.empujarCambios(VENTA);

    for (const cambio of vistas[0]?.cuerpo.lote ?? []) {
      expect(Object.keys(cambio as object).sort()).toEqual(['datos', 'id', 'operacion', 'tabla']);
    }
  });

  it('datos.id coincide con el id declarado, que es lo que exige exigir_forma_del_cambio', async () => {
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA) }]);

    await proveedor.empujarCambios(VENTA);

    for (const cambio of (vistas[0]?.cuerpo.lote ?? []) as { id: string; datos: { id: string } }[]) {
      expect(cambio.datos.id).toBe(cambio.id);
    }
  });

  it('LAS FILAS VAN EN EL ORDEN RECIBIDO: padres antes que hijos', async () => {
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA) }]);

    await proveedor.empujarCambios(VENTA);

    const tablas = ((vistas[0]?.cuerpo.lote ?? []) as { tabla: string }[]).map((c) => c.tabla);
    expect(tablas).toEqual(['productos', 'ventas', 'venta_detalle', 'auditoria_log']);
  });

  it('manda la versión de contrato de la constante compartida', async () => {
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA) }]);

    await proveedor.empujarCambios(VENTA);

    expect(vistas[0]?.cuerpo.version_de_contrato).toBe(VERSION_DEL_CONTRATO_DE_SINCRONIZACION);
  });

  it('manda la llave publicable y el access token de la sesión', async () => {
    const { proveedor, vistas } = armar([{ estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA) }]);

    await proveedor.empujarCambios(VENTA);

    expect(vistas[0]?.cabeceras.apikey).toBe(LLAVE);
    expect(vistas[0]?.cabeceras.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('NO reconvierte los decimales: el payload viaja tal cual salió de la base', async () => {
    const conDecimales = [
      fila('ventas', 'v-1', { total: '21.75', subtotal_exacto: '21.7512345678' }),
      fila('auditoria_log', 'a-1'),
    ];
    const { proveedor, vistas } = armar([
      { estado: 200, cuerpo: constanciaDe('sincronizar_venta', conDecimales) },
    ]);

    await proveedor.empujarCambios(conDecimales);

    const primera = (vistas[0]?.cuerpo.lote ?? [])[0] as { datos: Record<string, unknown> };
    expect(primera.datos.total).toBe('21.75');
    expect(primera.datos.subtotal_exacto).toBe('21.7512345678');
  });
});

// ===========================================================================
describe('REPETIR UN LOTE ES ÉXITO, no un error (§3.1)', () => {
  it('«ya_existia» en todas las filas se trata como lote subido', async () => {
    const { proveedor } = armar([
      { estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA, 'ya_existia') },
    ]);

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.ok).toBe(true);
    expect(resultado.errores).toEqual([]);
  });

  it('«sin_cambios» también', async () => {
    const { proveedor } = armar([
      { estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA, 'sin_cambios') },
    ]);

    expect((await proveedor.empujarCambios(VENTA)).ok).toBe(true);
  });

  it('los cuatro resultados de escribir_fila son éxito', async () => {
    for (const resultado of ['insertada', 'actualizada', 'ya_existia', 'sin_cambios']) {
      const { proveedor } = armar([
        { estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA, resultado) },
      ]);
      expect((await proveedor.empujarCambios(VENTA)).ok).toBe(true);
    }
  });

  it('un reintento confirmado queda anotado en la bitácora, aunque sea éxito', async () => {
    const { proveedor, bitacora } = armar([
      { estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA, 'ya_existia') },
    ]);

    await proveedor.empujarCambios(VENTA);

    expect(bitacora.join('\n')).toMatch(/ya estaba en la nube/);
  });

  it('un resultado que esta versión NO conoce se rechaza: un 200 que no se entiende es peor que un error', async () => {
    const { proveedor } = armar([
      { estado: 200, cuerpo: constanciaDe('sincronizar_venta', VENTA, 'teletransportada') },
    ]);

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.ok).toBe(false);
    expect(resultado.errores[0]).toMatch(/teletransportada/);
    expect(clasificarFallo(resultado)).toBe('deterministico');
  });
});

// ===========================================================================
describe('El desajuste de contrato DETIENE la cola, con los dos números', () => {
  it('el mensaje de la nube se reenvía tal cual, con las dos versiones', async () => {
    const { proveedor } = armar([
      {
        estado: 400,
        cuerpo: JSON.stringify({
          code: 'P0001',
          message: 'CONTRATO: la terminal manda la versión 1 y la nube declara la 2',
        }),
      },
    ]);

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.ok).toBe(false);
    expect(resultado.errores[0]).toMatch(/la terminal manda la versión 1 y la nube declara la 2/);
  });

  it('y se clasifica como DETERMINÍSTICO: la cola se detiene, no reintenta', async () => {
    const { proveedor } = armar([
      { estado: 400, cuerpo: JSON.stringify({ message: 'CONTRATO: …' }) },
    ]);

    expect(clasificarFallo(await proveedor.empujarCambios(VENTA))).toBe('deterministico');
  });

  it('si la constancia declara OTRO contrato que el que se mandó, también se detiene', async () => {
    const otroContrato = JSON.stringify({
      funcion: 'sincronizar_venta',
      contrato: 99,
      filas: [{ tabla: 'public.ventas', id: 'v-1', resultado: 'insertada' }],
    });
    const { proveedor } = armar([{ estado: 200, cuerpo: otroContrato }]);

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.ok).toBe(false);
    expect(resultado.errores[0]).toMatch(/99/);
    expect(clasificarFallo(resultado)).toBe('deterministico');
  });
});

// ===========================================================================
describe('Un 42501 y los errores de FORMA detienen la cola', () => {
  it('un permiso denegado (403) es determinístico', async () => {
    const { proveedor } = armar([
      { estado: 403, cuerpo: JSON.stringify({ code: '42501', message: 'Solo la terminal puede sincronizar usuarios' }) },
    ]);

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.ok).toBe(false);
    expect(resultado.errores[0]).toMatch(/42501/);
    expect(clasificarFallo(resultado)).toBe('deterministico');
  });

  it('un error de FORMA con nombre se reenvía sin traducir', async () => {
    const { proveedor } = armar([
      { estado: 400, cuerpo: JSON.stringify({ message: 'FORMA: la tabla recibos no forma parte de un lote de venta' }) },
    ]);

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.errores[0]).toMatch(/FORMA: la tabla recibos no forma parte/);
  });

  it('un lote que NO SE PUEDE ENRUTAR ni sale a la red, y detiene la cola', async () => {
    const mezcla = [fila('ventas', 'v-1'), fila('usuarios', 'u-1')];
    const { proveedor, vistas } = armar([]);

    const resultado = await proveedor.empujarCambios(mezcla);

    expect(vistas).toHaveLength(0);
    expect(resultado.ok).toBe(false);
    expect(clasificarFallo(resultado)).toBe('deterministico');
  });
});

// ===========================================================================
describe('Un fallo de RED es transitorio, no detiene nada', () => {
  it('un 503 se clasifica como transitorio', async () => {
    const { proveedor } = armar([{ estado: 503, cuerpo: 'upstream' }]);

    expect(clasificarFallo(await proveedor.empujarCambios(VENTA))).toBe('transitorio');
  });

  it('sin respuesta —el caso de la red caída— NO trae estadoHttp, y eso es transitorio', async () => {
    const buscar = ((): Promise<Response> => Promise.reject(new Error('fetch failed'))) as unknown as typeof fetch;
    const proveedor = new SupabaseSyncProvider({
      urlDelProyecto: URL_DEL_PROYECTO,
      llavePublicable: LLAVE,
      sesion: sesionDeMentira(TOKEN),
      buscar,
    });

    const resultado = await proveedor.empujarCambios(VENTA);

    expect(resultado.estadoHttp).toBeUndefined();
    expect(clasificarFallo(resultado)).toBe('transitorio');
  });
});

// ===========================================================================
describe('SIN CREDENCIAL USABLE no se intenta nada, y NO es un fallo de red', () => {
  let sinToken: ReturnType<typeof armar>;

  beforeEach(() => {
    sinToken = armar([], null);
  });

  it('no se hace ninguna petición', async () => {
    await sinToken.proveedor.empujarCambios(VENTA);

    expect(sinToken.vistas).toHaveLength(0);
  });

  it('se clasifica como CREDENCIAL: la cola no se toca, no suma intento ni bloquea', async () => {
    const resultado = await sinToken.proveedor.empujarCambios(VENTA);

    expect(clasificarFallo(resultado)).toBe('credencial');
  });

  it('NO se clasifica como transitorio: no es que no haya red', async () => {
    const resultado = await sinToken.proveedor.empujarCambios(VENTA);

    expect(clasificarFallo(resultado)).not.toBe('transitorio');
  });

  it('NO se clasifica como determinístico: el lote es válido, falta la credencial', async () => {
    const resultado = await sinToken.proveedor.empujarCambios(VENTA);

    expect(clasificarFallo(resultado)).not.toBe('deterministico');
  });

  it('el mensaje dice que no se intentó, no que falló', async () => {
    const resultado = await sinToken.proveedor.empujarCambios(VENTA);

    expect(resultado.errores[0]).toMatch(/No se intentó subir/);
  });

  it('con la credencial REVOCADA lo dice con esa palabra', async () => {
    const revocada = armar([], null, { revocada: true, revocadaDesde: '2026-09-13T22:30:00.000Z' });

    const resultado = await revocada.proveedor.empujarCambios(VENTA);

    expect(resultado.errores[0]).toMatch(/rechazó la credencial/);
    expect(clasificarFallo(resultado)).toBe('credencial');
  });

  it('nunca dice que el adaptador es simulado: este es el real', async () => {
    const resultado = await sinToken.proveedor.empujarCambios(VENTA);

    expect(resultado.simulado).toBe(false);
    expect(resultado.adaptador).toBe('SupabaseSyncProvider');
  });
});
