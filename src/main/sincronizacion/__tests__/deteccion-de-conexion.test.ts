/**
 * ¿Se llega a la nube de ESTE proyecto? La lista de verificación de §5.
 *
 * LA PREGUNTA QUE CONTESTA: ¿puede el detector decir «hay nube» cuando no la
 * hay? Porque ese falso positivo es el que deja al trabajador subiendo contra
 * la nada, y es exactamente lo que `net.isOnline()` solo no puede evitar.
 */

import { describe, expect, it } from 'vitest';

import {
  DetectorDeConexion,
  esperaTrasFalloDeConexion,
  ESCALERA_DE_RECOMPROBACION_MS,
  PERIODO_DEL_LATIDO_MS,
  TIEMPO_MAXIMO_DE_SALUD_MS,
} from '../deteccion-de-conexion';

const REFERENCIA = 'ztidrshifrblhfraiowg';
const URL_DEL_PROYECTO = `https://${REFERENCIA}.supabase.co`;

/** La respuesta REAL medida del health, el 2026-09-13. */
const CUERPO_REAL = '{"version":"v2.196.0","name":"GoTrue","description":"GoTrue is a user registration and authentication API"}';

interface Respuesta {
  readonly estado: number;
  readonly cuerpo: string;
  readonly cabeceras?: Record<string, string>;
}

function detector(
  respuesta: Respuesta | Error,
  opciones: { sistema?: boolean; ahora?: () => number } = {},
): { det: DetectorDeConexion; urls: string[]; bitacora: string[] } {
  const urls: string[] = [];
  const bitacora: string[] = [];
  const buscar = ((url: string): Promise<Response> => {
    urls.push(url);
    if (respuesta instanceof Error) {
      return Promise.reject(respuesta);
    }
    const cabeceras = respuesta.cabeceras ?? {
      'content-type': 'application/json',
      'sb-project-ref': REFERENCIA,
    };
    return Promise.resolve({
      status: respuesta.estado,
      headers: { get: (n: string): string | null => cabeceras[n.toLowerCase()] ?? null },
      text: () => Promise.resolve(respuesta.cuerpo),
    } as Response);
  }) as unknown as typeof fetch;

  const det = new DetectorDeConexion({
    urlDelProyecto: URL_DEL_PROYECTO,
    referenciaDelProyecto: REFERENCIA,
    llavePublicable: 'sb_publishable_de_mentira',
    buscar,
    ...(opciones.sistema === undefined ? {} : { sistemaDiceQueHayRed: (): boolean => opciones.sistema! }),
    ...(opciones.ahora === undefined ? {} : { ahora: opciones.ahora }),
    registrar: (m): number => bitacora.push(m),
  });
  return { det, urls, bitacora };
}

// ===========================================================================
describe('Capa 1: al sistema operativo SOLO se le cree el «no»', () => {
  it('si el sistema dice que NO hay red, no se gasta una petición', async () => {
    const { det, urls } = detector({ estado: 200, cuerpo: CUERPO_REAL }, { sistema: false });

    const veredicto = await det.comprobar();

    expect(veredicto.hayNube).toBe(false);
    expect(veredicto.capa).toBe(1);
    expect(urls).toEqual([]);
  });

  it('si el sistema dice que SÍ hay red, NO se le cree: se comprueba igual', async () => {
    const { det, urls } = detector({ estado: 200, cuerpo: CUERPO_REAL }, { sistema: true });

    const veredicto = await det.comprobar();

    expect(veredicto.capa).toBe(2);
    expect(urls).toHaveLength(1);
  });
});

// ===========================================================================
describe('Capa 2: se comprueba contra la nube de ESTE proyecto', () => {
  it('un 200 con la referencia correcta y el cuerpo de GoTrue cuenta como «hay nube»', async () => {
    const { det } = detector({ estado: 200, cuerpo: CUERPO_REAL });

    expect((await det.comprobar()).hayNube).toBe(true);
  });

  it('se consulta /auth/v1/health por GET, no por HEAD', async () => {
    /*
      Medido contra pos-pruebas-descartable: HEAD devuelve 405 Method Not
      Allowed con `allow: GET`. Un detector que use HEAD diría «sin internet»
      siempre, con la red perfecta. §5.2 pedía HEAD y estaba equivocado.
    */
    const { det, urls } = detector({ estado: 200, cuerpo: CUERPO_REAL });

    await det.comprobar();

    expect(urls[0]).toBe(`${URL_DEL_PROYECTO}/auth/v1/health`);
  });

  it('UN PORTAL CAUTIVO que devuelve 200 NO cuenta: la referencia no es la nuestra', async () => {
    const { det } = detector({
      estado: 200,
      cuerpo: '<html>Iniciá sesión en la red del centro comercial</html>',
      cabeceras: { 'content-type': 'text/html' },
    });

    const veredicto = await det.comprobar();

    expect(veredicto.hayNube).toBe(false);
    expect(veredicto.motivo).toMatch(/portal cautivo/);
  });

  it('un 200 con JSON pero de OTRO proyecto tampoco cuenta', async () => {
    const { det } = detector({
      estado: 200,
      cuerpo: CUERPO_REAL,
      cabeceras: { 'content-type': 'application/json', 'sb-project-ref': 'otro-proyecto' },
    });

    expect((await det.comprobar()).hayNube).toBe(false);
  });

  it('un 200 del proyecto correcto pero con un cuerpo que no es de GoTrue tampoco', async () => {
    const { det } = detector({
      estado: 200,
      cuerpo: '{"algo":"otra cosa"}',
      cabeceras: { 'content-type': 'application/json', 'sb-project-ref': REFERENCIA },
    });

    const veredicto = await det.comprobar();

    expect(veredicto.hayNube).toBe(false);
    expect(veredicto.motivo).toMatch(/no es el del servicio de Auth/);
  });

  it('cualquier código que no sea 200 es «sin nube»', async () => {
    for (const estado of [301, 404, 500, 503]) {
      const { det } = detector({ estado, cuerpo: CUERPO_REAL });
      expect((await det.comprobar()).hayNube).toBe(false);
    }
  });

  it('un fallo de red es «sin nube», con el motivo', async () => {
    const { det } = detector(new Error('getaddrinfo ENOTFOUND'));

    const veredicto = await det.comprobar();

    expect(veredicto.hayNube).toBe(false);
    expect(veredicto.motivo).toMatch(/ENOTFOUND/);
  });

  it('el tiempo máximo es de 8 s, que es lo que §5.4 pide por Windows', () => {
    expect(TIEMPO_MAXIMO_DE_SALUD_MS).toBe(8_000);
  });
});

// ===========================================================================
describe('Cadencia: con la cola vacía NO se comprueba nada (§5.3)', () => {
  it('sin pendientes, nunca toca comprobar', () => {
    const { det } = detector({ estado: 200, cuerpo: CUERPO_REAL });

    expect(det.tocaComprobar(false)).toBe(false);
  });

  it('sigue sin tocar aunque la última comprobación haya fallado', async () => {
    const { det } = detector({ estado: 500, cuerpo: '' });
    await det.comprobar();

    expect(det.tocaComprobar(false)).toBe(false);
  });

  it('con pendientes y sin haber comprobado nunca, sí toca', () => {
    const { det } = detector({ estado: 200, cuerpo: CUERPO_REAL });

    expect(det.tocaComprobar(true)).toBe(true);
  });

  it('tras un fallo se respeta la escalera: no se recomprueba antes de tiempo', async () => {
    let reloj = 1_000_000;
    const { det } = detector({ estado: 500, cuerpo: '' }, { ahora: () => reloj });
    await det.comprobar();

    reloj += 29_000;
    expect(det.tocaComprobar(true)).toBe(false);

    reloj += 2_000;
    expect(det.tocaComprobar(true)).toBe(true);
  });

  it('un cambio de estado del sistema saltea la espera', async () => {
    let reloj = 1_000_000;
    const { det } = detector({ estado: 500, cuerpo: '' }, { ahora: () => reloj });
    await det.comprobar();
    reloj += 1_000;
    expect(det.tocaComprobar(true)).toBe(false);

    det.olvidarLaEspera();

    expect(det.tocaComprobar(true)).toBe(true);
  });

  it('la escalera es 30 s, 1 min, 2 min y 5 min de techo', () => {
    expect(ESCALERA_DE_RECOMPROBACION_MS).toEqual([30_000, 60_000, 120_000, 300_000]);
    expect(esperaTrasFalloDeConexion(1)).toBe(30_000);
    expect(esperaTrasFalloDeConexion(4)).toBe(300_000);
    expect(esperaTrasFalloDeConexion(99)).toBe(300_000);
  });

  it('UN DÍA SIN INTERNET cuesta menos de 31 KB, que es el cálculo de §5.3', () => {
    const BYTES_MEDIDOS_POR_COMPROBACION = 107;
    const UN_DIA_MS = 24 * 60 * 60 * 1000;
    const comprobaciones = UN_DIA_MS / esperaTrasFalloDeConexion(99);

    expect(comprobaciones).toBe(288);
    expect(comprobaciones * BYTES_MEDIDOS_POR_COMPROBACION).toBeLessThan(31_000);
  });

  it('una comprobación buena deja volver a intentar sin esperar', async () => {
    const { det } = detector({ estado: 200, cuerpo: CUERPO_REAL });
    await det.comprobar();

    expect(det.tocaComprobar(true)).toBe(true);
  });
});

// ===========================================================================
describe('La bitácora anota los CAMBIOS, no cada comprobación', () => {
  it('288 comprobaciones fallidas seguidas dejan UN renglón, no 288', async () => {
    const { det, bitacora } = detector({ estado: 500, cuerpo: '' });

    for (let i = 0; i < 5; i += 1) {
      await det.comprobar();
    }

    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]).toMatch(/sin nube/);
  });
});

// ===========================================================================
describe('El latido diario NO es para detectar conexión (§5.3 y riesgo 8.3)', () => {
  it('corre una vez al día', () => {
    const reloj = 1_000_000;
    const { det } = detector({ estado: 200, cuerpo: '[]' }, { ahora: () => reloj });

    expect(det.tocaLatido()).toBe(true);
  });

  it('NO pega al health de Auth: ese no cuenta como actividad de BASE', async () => {
    const { det, urls } = detector({ estado: 200, cuerpo: '[]' });

    await det.latir('token-de-mentira');

    expect(urls[0]).toContain('/rest/v1/configuracion_negocio');
    expect(urls[0]).not.toContain('/auth/v1/health');
  });

  it('tras latir, no vuelve a tocar hasta que pase un día', async () => {
    let reloj = 1_000_000;
    const { det } = detector({ estado: 200, cuerpo: '[]' }, { ahora: () => reloj });
    await det.latir('token');

    expect(det.tocaLatido()).toBe(false);

    reloj += PERIODO_DEL_LATIDO_MS;
    expect(det.tocaLatido()).toBe(true);
  });

  it('un 200 con lista VACÍA es éxito: la terminal no lee filas y aun así la consulta llegó', async () => {
    // Medido: como terminal, la consulta devuelve 200 con `[]` porque no tiene
    // política de lectura. Igual tocó Postgres, que es lo único que cuenta.
    const { det } = detector({ estado: 200, cuerpo: '[]' });

    expect(await det.latir('token')).toBe(true);
  });

  it('si falla, no lanza: se reintenta mañana', async () => {
    const { det } = detector(new Error('sin red'));

    await expect(det.latir('token')).resolves.toBe(false);
  });
});
