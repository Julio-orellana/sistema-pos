import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClienteDeAuth, ResultadoDeAuth } from '../auth-de-nube';
import { AlmacenDeCredencial, type CifradoSeguro } from '../credencial';
import { SesionDeNube } from '../sesion-de-nube';

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
