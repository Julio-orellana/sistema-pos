import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClienteDeAuth, ResultadoDeAuth } from '../auth-de-nube';
import { AlmacenDeCredencial, type CifradoSeguro } from '../credencial';
import { clasificarFalloDeRenovacion, SesionDeNube } from '../sesion-de-nube';
import { COTA_DE_TOLERANCIA_MEDIDA_S } from '../vida-del-token';

const VIDA_MEDIDA = 900;
const SEGUNDO = 1000;

/** La contraseña de mentira. Es DISTINTIVA a propósito, para poder buscarla. */
const CONTRASENA = 'zZq7-CONTRASENA-QUE-NO-DEBE-QUEDAR-EN-NINGUN-LADO-4pX';
const CORREO = 'terminal-1@pos.jimmycano.invalid';
const REFRESCO_INICIAL = 'v1.refresco-numero-uno';
const REFRESCO_ROTADO = 'v1.refresco-numero-dos-tras-rotar';

function armarJwt(carga: Readonly<Record<string, unknown>>): string {
  const cabecera = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  return `${cabecera}.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.firma`;
}

function accessTokenDe(rol: string | null, opciones: { anonimo?: boolean; vida?: number } = {}): string {
  const iat = 1_700_000_000;
  return armarJwt({
    iat,
    exp: iat + (opciones.vida ?? VIDA_MEDIDA),
    email: CORREO,
    is_anonymous: opciones.anonimo ?? false,
    app_metadata: rol === null ? { provider: 'email' } : { provider: 'email', rol },
  });
}

function sesionOk(rol: string, refresco: string, opciones: { anonimo?: boolean; vida?: number } = {}): ResultadoDeAuth {
  return {
    ok: true,
    sesion: {
      accessToken: accessTokenDe(rol, opciones),
      tokenDeRefresco: refresco,
      duracionDeclaradaEnSegundos: opciones.vida ?? VIDA_MEDIDA,
    },
  };
}

/** Cifrado de mentira que sí transforma los bytes. Ver `credencial.test.ts`. */
class CifradoDeMentira implements CifradoSeguro {
  private static readonly MASCARA = 0x5a;
  public isEncryptionAvailable(): boolean {
    return true;
  }
  public encryptString(texto: string): Buffer {
    return Buffer.from(Buffer.from(texto, 'utf8').map((b) => b ^ CifradoDeMentira.MASCARA));
  }
  public decryptString(cifrado: Buffer): string {
    return Buffer.from(cifrado.map((b) => b ^ CifradoDeMentira.MASCARA)).toString('utf8');
  }
}

/** Auth de mentira: guarda qué se le pidió y devuelve lo que se le programe. */
class AuthDeMentira implements ClienteDeAuth {
  public correosRecibidos: string[] = [];
  public refrescosRecibidos: string[] = [];
  public respuestaDeLogin: ResultadoDeAuth = sesionOk('terminal', REFRESCO_INICIAL);
  public respuestasDeRefresco: ResultadoDeAuth[] = [];

  public iniciarSesionConContrasena(correo: string, _contrasena: string): Promise<ResultadoDeAuth> {
    this.correosRecibidos.push(correo);
    return Promise.resolve(this.respuestaDeLogin);
  }

  public refrescar(tokenDeRefresco: string): Promise<ResultadoDeAuth> {
    this.refrescosRecibidos.push(tokenDeRefresco);
    return Promise.resolve(this.respuestasDeRefresco.shift() ?? sesionOk('terminal', REFRESCO_ROTADO));
  }
}

/** Busca una aguja en TODO el grafo de un objeto, por profundo que sea. */
function apareceEnAlgunLado(raiz: unknown, aguja: string): boolean {
  const vistos = new Set<unknown>();
  const pila: unknown[] = [raiz];

  while (pila.length > 0) {
    const actual = pila.pop();
    if (actual === null || actual === undefined) {
      continue;
    }
    if (typeof actual === 'string') {
      if (actual.includes(aguja)) {
        return true;
      }
      continue;
    }
    if (typeof actual !== 'object') {
      continue;
    }
    if (vistos.has(actual)) {
      continue;
    }
    vistos.add(actual);
    for (const valor of Object.values(actual as Record<string, unknown>)) {
      pila.push(valor);
    }
  }
  return false;
}

describe('La sesión de la terminal contra Supabase Auth', () => {
  let carpeta: string;
  let auth: AuthDeMentira;
  let credencial: AlmacenDeCredencial;
  let bitacora: string[];
  let agendados: { accion: () => void; ms: number }[];
  let canceladas: number;
  let sesion: SesionDeNube;

  beforeEach(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'pos-sesion-nube-'));
    auth = new AuthDeMentira();
    credencial = new AlmacenDeCredencial(carpeta, new CifradoDeMentira());
    bitacora = [];
    agendados = [];
    canceladas = 0;
    sesion = new SesionDeNube({
      auth,
      credencial,
      ahora: (): number => 1_700_000_000 * SEGUNDO,
      programar: (accion, ms): number => {
        agendados.push({ accion, ms });
        return agendados.length - 1;
      },
      cancelar: (): void => {
        canceladas += 1;
      },
      registrar: (mensaje): number => bitacora.push(mensaje),
      azar: (): number => 0.5,
    });
  });

  afterEach(() => {
    sesion.detener();
    rmSync(carpeta, { recursive: true, force: true });
  });

  // =========================================================================
  describe('LA CONTRASEÑA NO SE GUARDA EN NINGÚN LADO', () => {
    beforeEach(async () => {
      await sesion.conectar(CORREO, CONTRASENA);
    });

    it('no aparece en el archivo de credencial, ni en texto ni en bytes', () => {
      const crudo = readFileSync(credencial.rutaDelArchivo());

      expect(crudo.toString('utf8')).not.toContain(CONTRASENA);
      expect(crudo.toString('latin1')).not.toContain(CONTRASENA);
      expect(crudo.includes(Buffer.from(CONTRASENA, 'utf8'))).toBe(false);
    });

    it('no aparece en NINGÚN archivo de la carpeta de datos', () => {
      const archivos = readdirSync(carpeta);

      expect(archivos.length).toBeGreaterThan(0);
      for (const archivo of archivos) {
        const contenido = readFileSync(join(carpeta, archivo));
        expect(contenido.toString('utf8')).not.toContain(CONTRASENA);
        expect(contenido.includes(Buffer.from(CONTRASENA, 'utf8'))).toBe(false);
      }
    });

    it('no aparece en la bitácora técnica', () => {
      expect(bitacora.length).toBeGreaterThan(0);
      expect(bitacora.join('\n')).not.toContain(CONTRASENA);
    });

    it('no queda colgada en NINGÚN campo del objeto de sesión, por profundo que esté', () => {
      expect(apareceEnAlgunLado(sesion, CONTRASENA)).toBe(false);
    });

    it('no sale en el estado que viaja a la pantalla', () => {
      expect(apareceEnAlgunLado(sesion.estado(), CONTRASENA)).toBe(false);
    });

    it('lo ÚNICO que quedó guardado es el token de refresco', () => {
      expect(credencial.leer()).toBe(REFRESCO_INICIAL);
    });

    it('el buscador de la aguja FUNCIONA: encuentra la contraseña si está', () => {
      // Sin este control, las cinco comprobaciones de arriba pasarían igual
      // aunque el buscador estuviera roto y no encontrara nada nunca.
      expect(apareceEnAlgunLado({ a: { b: [{ c: CONTRASENA }] } }, CONTRASENA)).toBe(true);
      expect(apareceEnAlgunLado(`prefijo ${CONTRASENA} sufijo`, CONTRASENA)).toBe(true);
    });
  });

  // =========================================================================
  describe('Conectar', () => {
    it('inicia sesión con el correo que se le dio y guarda el refresco', async () => {
      const resumen = await sesion.conectar(CORREO, CONTRASENA);

      expect(auth.correosRecibidos).toEqual([CORREO]);
      expect(credencial.leer()).toBe(REFRESCO_INICIAL);
      expect(resumen.correo).toBe(CORREO);
      expect(resumen.rol).toBe('terminal');
    });

    it('informa la vida REAL del token, leída de exp - iat', async () => {
      const resumen = await sesion.conectar(CORREO, CONTRASENA);

      expect(resumen.vidaDelTokenSegundos).toBe(VIDA_MEDIDA);
    });

    it('deja la sesión conectada y con access token vigente', async () => {
      await sesion.conectar(CORREO, CONTRASENA);

      expect(sesion.estado().conectada).toBe(true);
      expect(sesion.accessTokenVigente()).not.toBeNull();
    });

    it('RECHAZA un usuario con rol restauracion, y NO guarda ninguna credencial', async () => {
      auth.respuestaDeLogin = sesionOk('restauracion', REFRESCO_INICIAL);

      await expect(sesion.conectar(CORREO, CONTRASENA)).rejects.toThrow(/rol «restauracion»/);
      expect(credencial.leer()).toBeNull();
      expect(sesion.estado().conectada).toBe(false);
    });

    it('RECHAZA un usuario sin ningún rol, nombrando lo que falta', async () => {
      auth.respuestaDeLogin = sesionOk('', REFRESCO_INICIAL);
      auth.respuestaDeLogin = { ok: true, sesion: { accessToken: accessTokenDe(null), tokenDeRefresco: REFRESCO_INICIAL, duracionDeclaradaEnSegundos: VIDA_MEDIDA } };

      await expect(sesion.conectar(CORREO, CONTRASENA)).rejects.toThrow(/ningún rol/);
      expect(credencial.leer()).toBeNull();
    });

    it('RECHAZA una sesión anónima, que las políticas también rechazan', async () => {
      auth.respuestaDeLogin = sesionOk('terminal', REFRESCO_INICIAL, { anonimo: true });

      await expect(sesion.conectar(CORREO, CONTRASENA)).rejects.toThrow(/anónima/);
      expect(credencial.leer()).toBeNull();
    });

    it('con la contraseña equivocada explica eso, sin repetir el mensaje crudo de Auth', async () => {
      auth.respuestaDeLogin = { ok: false, fallo: { estadoHttp: 400, mensaje: 'Invalid login credentials' } };

      await expect(sesion.conectar(CORREO, CONTRASENA)).rejects.toThrow(/rechazó ese correo y esa contraseña/);
    });

    it('sin red lo dice como problema de conexión, no como contraseña equivocada', async () => {
      auth.respuestaDeLogin = { ok: false, fallo: { mensaje: 'fetch failed' } };

      await expect(sesion.conectar(CORREO, CONTRASENA)).rejects.toThrow(/conexión a internet/);
    });
  });

  // =========================================================================
  describe('Renovación automática, ANTES de que venza', () => {
    it('al conectar agenda la renovación a los 675 s de un token de 900 s', async () => {
      await sesion.conectar(CORREO, CONTRASENA);

      expect(agendados).toHaveLength(1);
      expect(agendados[0]?.ms).toBe(675 * SEGUNDO);
    });

    it('la renovación queda ANTES del vencimiento, con 225 s de colchón', async () => {
      await sesion.conectar(CORREO, CONTRASENA);

      expect(agendados[0]?.ms).toBeLessThan(VIDA_MEDIDA * SEGUNDO);
      expect(VIDA_MEDIDA * SEGUNDO - (agendados[0]?.ms ?? 0)).toBe(225 * SEGUNDO);
    });

    it('con un token de 300 s agenda a los 225 s: NO está atado a 900', async () => {
      auth.respuestaDeLogin = sesionOk('terminal', REFRESCO_INICIAL, { vida: 300 });

      await sesion.conectar(CORREO, CONTRASENA);

      expect(agendados[0]?.ms).toBe(225 * SEGUNDO);
    });

    it('cuando el temporizador dispara, renueva con el token guardado', async () => {
      await sesion.conectar(CORREO, CONTRASENA);

      await sesion.renovar();

      expect(auth.refrescosRecibidos).toEqual([REFRESCO_INICIAL]);
    });

    it('GUARDA EL TOKEN ROTADO: la próxima renovación usa el nuevo, no el viejo', async () => {
      await sesion.conectar(CORREO, CONTRASENA);
      await sesion.renovar();

      expect(credencial.leer()).toBe(REFRESCO_ROTADO);

      await sesion.renovar();

      expect(auth.refrescosRecibidos).toEqual([REFRESCO_INICIAL, REFRESCO_ROTADO]);
    });

    it('tras renovar vuelve a agendar, así que la cadena no se corta', async () => {
      await sesion.conectar(CORREO, CONTRASENA);
      await sesion.renovar();

      expect(agendados).toHaveLength(2);
      expect(agendados[1]?.ms).toBe(675 * SEGUNDO);
    });

    it('hay UN SOLO temporizador vivo: agendar cancela el anterior', async () => {
      await sesion.conectar(CORREO, CONTRASENA);
      await sesion.renovar();

      expect(canceladas).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  describe('Un corte de red durante la renovación NO es un fallo duro', () => {
    beforeEach(async () => {
      await sesion.conectar(CORREO, CONTRASENA);
    });

    it('no lanza: la aplicación sigue vendiendo aunque la nube no conteste', async () => {
      auth.respuestasDeRefresco = [{ ok: false, fallo: { mensaje: 'fetch failed' } }];

      await expect(sesion.renovar()).resolves.toBeUndefined();
    });

    it('reintenta con la escalera: 5 s tras el primer fallo', async () => {
      auth.respuestasDeRefresco = [{ ok: false, fallo: { mensaje: 'fetch failed' } }];

      await sesion.renovar();

      expect(agendados[agendados.length - 1]?.ms).toBe(5 * SEGUNDO);
    });

    it('la espera crece con cada fallo seguido: 5 s, 15 s, 45 s, 60 s', async () => {
      auth.respuestasDeRefresco = Array.from({ length: 4 }, () => ({
        ok: false as const,
        fallo: { mensaje: 'fetch failed' },
      }));

      const esperas: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        await sesion.renovar();
        esperas.push(agendados[agendados.length - 1]?.ms ?? 0);
      }

      expect(esperas).toEqual([5 * SEGUNDO, 15 * SEGUNDO, 45 * SEGUNDO, 60 * SEGUNDO]);
    });

    it('NO BORRA la credencial guardada: un corte de red no es una revocación', async () => {
      auth.respuestasDeRefresco = [{ ok: false, fallo: { mensaje: 'fetch failed' } }];

      await sesion.renovar();

      expect(credencial.leer()).toBe(REFRESCO_INICIAL);
    });

    it('cuando la red vuelve, la siguiente renovación funciona y el contador se reinicia', async () => {
      auth.respuestasDeRefresco = [
        { ok: false, fallo: { mensaje: 'fetch failed' } },
        sesionOk('terminal', REFRESCO_ROTADO),
      ];

      await sesion.renovar();
      expect(sesion.estado().renovacionesFallidas).toBe(1);

      await sesion.renovar();
      expect(sesion.estado().renovacionesFallidas).toBe(0);
      expect(sesion.estado().ultimoMotivo).toBeNull();
    });

    it('el motivo del fallo queda visible para la pantalla, sin tokens adentro', async () => {
      auth.respuestasDeRefresco = [{ ok: false, fallo: { mensaje: 'fetch failed' } }];

      await sesion.renovar();

      expect(sesion.estado().ultimoMotivo).toBe('fetch failed');
      expect(apareceEnAlgunLado(sesion.estado(), REFRESCO_INICIAL)).toBe(false);
    });
  });

  // =========================================================================
  describe('Arrancar la aplicación', () => {
    it('sin credencial guardada NO lanza, y lo dice', async () => {
      await expect(sesion.arrancar()).resolves.toBeUndefined();

      expect(sesion.estado().hayCredencial).toBe(false);
      expect(sesion.estado().ultimoMotivo).toMatch(/Conectá la terminal/);
    });

    it('sin credencial NO llama a la red: no gasta cuota preguntando al vacío', async () => {
      await sesion.arrancar();

      expect(auth.refrescosRecibidos).toEqual([]);
    });

    it('con credencial guardada consigue un access token sin pedir contraseña', async () => {
      credencial.guardar(REFRESCO_INICIAL);

      await sesion.arrancar();

      expect(auth.refrescosRecibidos).toEqual([REFRESCO_INICIAL]);
      expect(sesion.estado().conectada).toBe(true);
      expect(auth.correosRecibidos).toEqual([]);
    });

    it('ANTES de arrancar no hubo ningún intento; después, sí (con token, sin red o sin credencial)', async () => {
      expect(sesion.primerIntentoTerminado).toBe(false);
      await sesion.arrancar();
      expect(sesion.primerIntentoTerminado).toBe(true);
    });

    it('MIENTRAS la primera renovación está en camino, el intento todavía no terminó', async () => {
      credencial.guardar(REFRESCO_INICIAL);
      let contestar: (resultado: ResultadoDeAuth) => void = () => undefined;
      auth.refrescar = (tokenDeRefresco: string): Promise<ResultadoDeAuth> => {
        auth.refrescosRecibidos.push(tokenDeRefresco);
        return new Promise((resolver) => {
          contestar = resolver;
        });
      };

      const arranque = sesion.arrancar();
      expect(sesion.estado().conectada).toBe(false);
      expect(sesion.primerIntentoTerminado).toBe(false);

      contestar({ ok: false, fallo: { mensaje: 'fetch failed' } });
      await arranque;
      expect(sesion.estado().conectada).toBe(false);
      expect(sesion.primerIntentoTerminado).toBe(true);
    });

    it('con la renovación bien, el intento terminó y hay token', async () => {
      credencial.guardar(REFRESCO_INICIAL);
      await sesion.arrancar();
      expect(sesion.estado().conectada).toBe(true);
      expect(sesion.primerIntentoTerminado).toBe(true);
    });

    it('si la nube no contesta al arrancar, la aplicación abre igual y reintenta', async () => {
      credencial.guardar(REFRESCO_INICIAL);
      auth.respuestasDeRefresco = [{ ok: false, fallo: { mensaje: 'fetch failed' } }];

      await expect(sesion.arrancar()).resolves.toBeUndefined();

      expect(sesion.estado().conectada).toBe(false);
      expect(agendados[agendados.length - 1]?.ms).toBe(5 * SEGUNDO);
    });
  });

  // =========================================================================
  describe('El reloj desfasado se anota pero NO rompe la renovación', () => {
    it('con el reloj una hora adelantado, la renovación se agenda igual a los 675 s', async () => {
      const UNA_HORA = 3600;
      const conRelojMalo = new SesionDeNube({
        auth,
        credencial,
        ahora: (): number => (1_700_000_000 + UNA_HORA) * SEGUNDO,
        programar: (accion, ms): number => {
          agendados.push({ accion, ms });
          return agendados.length - 1;
        },
        cancelar: (): void => undefined,
        registrar: (mensaje): number => bitacora.push(mensaje),
      });

      const resumen = await conRelojMalo.conectar(CORREO, CONTRASENA);
      conRelojMalo.detener();

      expect(resumen.desfaseDeRelojSegundos).toBe(UNA_HORA);
      expect(resumen.relojSospechoso).toBe(true);
      expect(agendados[0]?.ms).toBe(675 * SEGUNDO);
    });

    it('un desfase grande deja un AVISO en la bitácora técnica', async () => {
      const UNA_HORA = 3600;
      const conRelojMalo = new SesionDeNube({
        auth,
        credencial,
        ahora: (): number => (1_700_000_000 + UNA_HORA) * SEGUNDO,
        programar: (): number => 0,
        cancelar: (): void => undefined,
        registrar: (mensaje): number => bitacora.push(mensaje),
      });

      await conRelojMalo.conectar(CORREO, CONTRASENA);
      conRelojMalo.detener();

      expect(bitacora.join('\n')).toMatch(/AVISO: el reloj de esta máquina/);
    });

    it('con el reloj en hora NO ensucia la bitácora con avisos', async () => {
      await sesion.conectar(CORREO, CONTRASENA);

      expect(bitacora.join('\n')).not.toMatch(/AVISO/);
      expect(sesion.estado().relojSospechoso).toBe(false);
    });
  });

  // =========================================================================
  describe('Detener', () => {
    it('cancela el temporizador y suelta el access token de la memoria', async () => {
      await sesion.conectar(CORREO, CONTRASENA);

      sesion.detener();

      expect(sesion.accessTokenVigente()).toBeNull();
      expect(sesion.estado().conectada).toBe(false);
    });

    it('NO borra la credencial: cerrar el punto de venta no es desconectar la terminal', async () => {
      await sesion.conectar(CORREO, CONTRASENA);

      sesion.detener();

      expect(credencial.leer()).toBe(REFRESCO_INICIAL);
      expect(sesion.estado().hayCredencial).toBe(true);
    });

    it('después de detener, renovar no hace nada ni vuelve a agendar', async () => {
      await sesion.conectar(CORREO, CONTRASENA);
      const agendadosAntes = agendados.length;
      const refrescosAntes = auth.refrescosRecibidos.length;

      sesion.detener();
      await sesion.renovar();

      expect(auth.refrescosRecibidos).toHaveLength(refrescosAntes);
      expect(agendados).toHaveLength(agendadosAntes);
    });
  });
});

// ===========================================================================
// FASE 3.a, SEGUNDA MITAD: la credencial revocada
// ===========================================================================

describe('Clasificar un fallo de renovación: NO es «401 = revocada»', () => {
  /*
    La forma evidente sería mirar el 401, y sería un control que NO DISPARA
    NUNCA: medido contra pos-pruebas-descartable, GoTrue contesta 400 cuando el
    token de refresco no sirve. El 401 es lo que devuelve PostgREST ante un
    access token vencido, que pasa cada 900 s de forma normal.
  */
  it('el 400 que GoTrue devuelve de verdad se lee como credencial muerta', () => {
    expect(clasificarFalloDeRenovacion(400)).toBe('credencial_muerta');
  });

  it('un 401 también, aunque no sea el código que GoTrue usa acá', () => {
    expect(clasificarFalloDeRenovacion(401)).toBe('credencial_muerta');
  });

  it('un 403 —usuario baneado— también', () => {
    expect(clasificarFalloDeRenovacion(403)).toBe('credencial_muerta');
  });

  it('SIN código HTTP es transitorio: es el caso de la red caída', () => {
    expect(clasificarFalloDeRenovacion(undefined)).toBe('transitorio');
  });

  it('los 5xx son transitorios: el problema es del servidor, no de la credencial', () => {
    for (const codigo of [500, 502, 503, 504]) {
      expect(clasificarFalloDeRenovacion(codigo)).toBe('transitorio');
    }
  });

  it('408, 425 y 429 son transitorios: el propio protocolo pide reintentar', () => {
    for (const codigo of [408, 425, 429]) {
      expect(clasificarFalloDeRenovacion(codigo)).toBe('transitorio');
    }
  });

  it('un código 4xx que nadie previó se lee como credencial muerta, no como transitorio', () => {
    // La regla enumera lo transitorio y deja el resto del lado conservador:
    // mejor avisar de más que reintentar en bucle algo que ya no sirve.
    expect(clasificarFalloDeRenovacion(418)).toBe('credencial_muerta');
    expect(clasificarFalloDeRenovacion(422)).toBe('credencial_muerta');
  });
});

describe('Cuando la nube RECHAZA la credencial, la terminal queda SIN CREDENCIAL', () => {
  const RECHAZO = {
    ok: false as const,
    fallo: { estadoHttp: 400, mensaje: 'Refresh token is not valid' },
  };

  let carpeta: string;
  let auth: AuthDeMentira;
  let credencial: AlmacenDeCredencial;
  let bitacora: string[];
  let agendados: { accion: () => void; ms: number }[];
  let sesion: SesionDeNube;
  let pendientes: number;

  beforeEach(async () => {
    carpeta = mkdtempSync(join(tmpdir(), 'pos-revocada-'));
    auth = new AuthDeMentira();
    credencial = new AlmacenDeCredencial(carpeta, new CifradoDeMentira());
    bitacora = [];
    agendados = [];
    pendientes = 47;
    sesion = new SesionDeNube({
      auth,
      credencial,
      ahora: (): number => Date.UTC(2026, 8, 13, 22, 30, 0),
      programar: (accion, ms): number => {
        agendados.push({ accion, ms });
        return agendados.length - 1;
      },
      cancelar: (): void => undefined,
      registrar: (mensaje): number => bitacora.push(mensaje),
      azar: (): number => 0.5,
      contarPendientes: (): number => pendientes,
    });
    await sesion.conectar(CORREO, CONTRASENA);
    agendados.length = 0;
    bitacora.length = 0;
  });

  afterEach(() => {
    sesion.detener();
    rmSync(carpeta, { recursive: true, force: true });
  });

  it('el estado dice que está revocada, y DESDE CUÁNDO', async () => {
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    expect(sesion.estado().revocada).toBe(true);
    expect(sesion.estado().revocadaDesde).toBe('2026-09-13T22:30:00.000Z');
  });

  it('deja de haber sesión activa, aunque el access token todavía no venció', async () => {
    expect(sesion.estado().conectada).toBe(true);
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    expect(sesion.estado().conectada).toBe(false);
  });

  it('EL ACCESS TOKEN DEJA DE ENTREGARSE: no se sube nada más con una credencial muerta', async () => {
    expect(sesion.accessTokenVigente()).not.toBeNull();
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    expect(sesion.accessTokenVigente()).toBeNull();
  });

  it('NO SE REINTENTA: no queda ningún temporizador agendado', async () => {
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    expect(agendados).toHaveLength(0);
  });

  it('y un temporizador que llegara tarde tampoco vuelve a preguntar', async () => {
    auth.respuestasDeRefresco = [RECHAZO];
    await sesion.renovar();
    const consultasAntes = auth.refrescosRecibidos.length;

    await sesion.renovar();

    expect(auth.refrescosRecibidos).toHaveLength(consultasAntes);
  });

  it('NO BORRA la credencial del disco: borrar es irreversible y el 400 podría no serlo', async () => {
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    expect(credencial.leer()).not.toBeNull();
    expect(sesion.estado().hayCredencial).toBe(true);
  });

  it('el motivo le dice a una persona QUÉ HACER, no solo qué pasó', async () => {
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    expect(sesion.estado().ultimoMotivo).toMatch(/volver a conectarla/);
    expect(sesion.estado().ultimoMotivo).toMatch(/Conectar con la nube/);
  });

  it('informa CUÁNTAS filas se están acumulando en la cola sin poder subir', async () => {
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    expect(sesion.estado().filasPendientes).toBe(47);
  });

  it('informa hasta cuándo un token YA EMITIDO pudo seguir sirviendo (exp + cota medida)', async () => {
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    // El token de las pruebas vence en iat+900 = 1_700_000_900.
    const esperado = new Date((1_700_000_900 + COTA_DE_TOLERANCIA_MEDIDA_S) * 1000).toISOString();
    expect(sesion.estado().exposicionHasta).toBe(esperado);
  });

  it('deja el hecho en la bitácora técnica, con la cola y la ventana', async () => {
    auth.respuestasDeRefresco = [RECHAZO];

    await sesion.renovar();

    const texto = bitacora.join('\n');
    expect(texto).toMatch(/CREDENCIAL RECHAZADA POR LA NUBE/);
    expect(texto).toMatch(/SIN CREDENCIAL/);
    expect(texto).toMatch(/47/);
  });

  it('UN CORTE DE RED NO ES UNA REVOCACIÓN: sigue reintentando y no se declara muerta', async () => {
    auth.respuestasDeRefresco = [{ ok: false, fallo: { mensaje: 'fetch failed' } }];

    await sesion.renovar();

    expect(sesion.estado().revocada).toBe(false);
    expect(sesion.accessTokenVigente()).not.toBeNull();
    expect(agendados).toHaveLength(1);
  });

  it('un 503 tampoco: el problema es del servidor, no de la credencial', async () => {
    auth.respuestasDeRefresco = [{ ok: false, fallo: { estadoHttp: 503, mensaje: 'upstream' } }];

    await sesion.renovar();

    expect(sesion.estado().revocada).toBe(false);
    expect(agendados).toHaveLength(1);
  });

  it('VOLVER A CONECTAR con una contraseña nueva es la salida, y limpia el estado', async () => {
    auth.respuestasDeRefresco = [RECHAZO];
    await sesion.renovar();
    expect(sesion.estado().revocada).toBe(true);

    auth.respuestaDeLogin = sesionOk('terminal', 'v1.credencial-nueva');
    await sesion.conectar(CORREO, 'una-contrasena-nueva');

    expect(sesion.estado().revocada).toBe(false);
    expect(sesion.estado().revocadaDesde).toBeNull();
    expect(sesion.estado().conectada).toBe(true);
    expect(sesion.accessTokenVigente()).not.toBeNull();
    expect(credencial.leer()).toBe('v1.credencial-nueva');
  });

  it('ARRANCAR vuelve a preguntarle al servidor: no se cree una decisión vieja', async () => {
    auth.respuestasDeRefresco = [RECHAZO];
    await sesion.renovar();
    const consultasAntes = auth.refrescosRecibidos.length;

    // Como si la aplicación se reiniciara: el estado de revocada vive en
    // memoria, así que el arranque re-verifica en vez de darlo por hecho.
    auth.respuestasDeRefresco = [sesionOk('terminal', REFRESCO_ROTADO)];
    await sesion.arrancar();

    expect(auth.refrescosRecibidos.length).toBe(consultasAntes + 1);
    expect(sesion.estado().revocada).toBe(false);
    expect(sesion.estado().conectada).toBe(true);
  });
});

// ===========================================================================
describe('Una credencial que existe pero NO SE PUEDE DESCIFRAR', () => {
  /*
    ES EL CASO DEL CAMBIO DE NOMBRE DEL PRODUCTO, y no es hipotético: se
    encontró midiendo. `safeStorage` deriva la llave de la IDENTIDAD de la
    aplicación, así que un instalador que cambie el nombre del producto deja
    ilegible toda credencial guardada por la versión anterior. Lo mismo pasa
    con un archivo copiado de otra máquina o de otra cuenta de Windows.

    Lo que NO puede hacer la aplicación es fallar en silencio ni colgarse: el
    comportamiento esperado es detectarlo, decirlo, y ofrecer reconectar.
    Ver CLAUDE.md §4.23.
  */
  let carpeta: string;
  let auth: AuthDeMentira;
  let credencial: AlmacenDeCredencial;
  let bitacora: string[];
  let sesion: SesionDeNube;

  beforeEach(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'pos-ilegible-'));
    auth = new AuthDeMentira();
    // Un cifrado que escribe bien pero NO puede leer: es exactamente lo que le
    // pasa a la aplicación renombrada frente a un archivo de la versión vieja.
    const cifradoQueNoLee: CifradoSeguro = {
      isEncryptionAvailable: () => true,
      encryptString: (t) => Buffer.from(t, 'utf8'),
      decryptString: () => {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      },
    };
    credencial = new AlmacenDeCredencial(carpeta, cifradoQueNoLee);
    // La deja escrita una "versión anterior", con otro cifrado.
    new AlmacenDeCredencial(carpeta, new CifradoDeMentira()).guardar(REFRESCO_INICIAL);
    bitacora = [];
    sesion = new SesionDeNube({
      auth,
      credencial,
      ahora: (): number => 1_700_000_000 * SEGUNDO,
      programar: (): number => 0,
      cancelar: (): void => undefined,
      registrar: (mensaje): number => bitacora.push(mensaje),
    });
  });

  afterEach(() => {
    sesion.detener();
    rmSync(carpeta, { recursive: true, force: true });
  });

  it('arrancar NO lanza y NO cuelga la aplicación', async () => {
    await expect(sesion.arrancar()).resolves.toBeUndefined();
  });

  it('NO se inventa una sesión: queda desconectada', async () => {
    await sesion.arrancar();

    expect(sesion.estado().conectada).toBe(false);
    expect(sesion.accessTokenVigente()).toBeNull();
  });

  it('NO llama a la red con un token que no pudo leer', async () => {
    await sesion.arrancar();

    expect(auth.refrescosRecibidos).toEqual([]);
  });

  it('NO FALLA EN SILENCIO: el motivo explica que no se pudo descifrar', async () => {
    await sesion.arrancar();

    expect(sesion.estado().ultimoMotivo).toMatch(/no se pudo descifrar/);
  });

  it('el hecho queda en la bitácora técnica, no solo en la pantalla', async () => {
    await sesion.arrancar();

    expect(bitacora.join('\n')).toMatch(/no se pudo descifrar/);
  });

  it('dice que SÍ hay un archivo, para que no parezca una instalación nueva', async () => {
    await sesion.arrancar();

    expect(sesion.estado().hayCredencial).toBe(true);
  });

  it('NO se marca como revocada: no es lo mismo que la nube rechace la credencial', async () => {
    await sesion.arrancar();

    // Son dos problemas distintos con dos arreglos distintos: acá la
    // credencial podría estar perfecta y el que no la puede leer es este
    // programa. Confundirlos mandaría a revocar en el panel sin necesidad.
    expect(sesion.estado().revocada).toBe(false);
  });

  it('LA SALIDA ES RECONECTAR, y funciona: reemplaza el archivo ilegible', async () => {
    await sesion.arrancar();

    await sesion.conectar(CORREO, CONTRASENA);

    expect(sesion.estado().conectada).toBe(true);
    expect(sesion.estado().ultimoMotivo).toBeNull();
  });
});
