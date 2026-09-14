/**
 * El cliente HTTP de la restauración, con la red de mentira: lo que anota en
 * la bitácora técnica por cada petición, y lo que NUNCA anota.
 *
 * La evidencia cruda de una restauración —cada petición con su método, su
 * ruta y su código— la anotaban hasta ahora los arneses por su cuenta. Desde
 * el ensayo por la ventana (`scripts/ensayo-de-restauracion.cjs`) la escribe
 * la propia aplicación en `log-tecnico.log`, para que una restauración en la
 * tienda deje el mismo rastro que una corrida de verificación.
 */
import { describe, expect, it } from 'vitest';

import type { ClienteDeAuth, ResultadoDeAuth } from '@main/sincronizacion/auth-de-nube';
import { ClienteDeRestauracionHttp, rutaParaLaBitacora } from '@main/restauracion/cliente-de-restauracion';

const CORREO = 'restauracion@pruebas.invalid';
const CONTRASENA = 'una-contrasena-que-no-debe-aparecer';
const TOKEN_DE_REFRESCO = 'refresco-que-no-debe-aparecer';
const SEGUNDOS_DE_VIDA = 900;
const HTTP_OK = 200;
const HTTP_CONTENIDO_PARCIAL = 206;
const HTTP_NO_ENCONTRADO = 404;
const FILAS_POR_PAGINA = 1000;

function tokenConClaims(claims: Record<string, unknown>): string {
  const cabecera = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const carga = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${cabecera}.${carga}.firma-de-mentira`;
}

const ACCESS_TOKEN = tokenConClaims({
  iat: 1_789_388_349,
  exp: 1_789_388_349 + SEGUNDOS_DE_VIDA,
  app_metadata: { rol: 'restauracion' },
  email: CORREO,
});

const authDeMentira: ClienteDeAuth = {
  iniciarSesionConContrasena: (): Promise<ResultadoDeAuth> =>
    Promise.resolve({ ok: true, sesion: { accessToken: ACCESS_TOKEN, tokenDeRefresco: TOKEN_DE_REFRESCO, duracionDeclaradaEnSegundos: SEGUNDOS_DE_VIDA } }),
  refrescar: (): Promise<ResultadoDeAuth> => Promise.reject(new Error('no debería renovar en estas pruebas')),
};

interface Peticion {
  readonly url: string;
  readonly metodo: string;
}

/** Una red de mentira que contesta según la ruta y recuerda cada petición. */
function redDeMentira(contestar: (url: string) => Response): { peticiones: Peticion[]; buscar: (url: string, opciones?: RequestInit) => Promise<Response> } {
  const peticiones: Peticion[] = [];
  return {
    peticiones,
    buscar: (url, opciones): Promise<Response> => {
      peticiones.push({ url, metodo: opciones?.method ?? 'GET' });
      return Promise.resolve(contestar(url));
    },
  };
}

function clienteCon(buscar: (url: string, opciones?: RequestInit) => Promise<Response>): { cliente: ClienteDeRestauracionHttp; bitacora: string[] } {
  const bitacora: string[] = [];
  const cliente = new ClienteDeRestauracionHttp({
    urlDelProyecto: 'https://proyecto.invalid',
    llavePublicable: 'llave-publicable',
    auth: authDeMentira,
    buscar,
    registrar: (mensaje): void => {
      bitacora.push(mensaje);
    },
  });
  return { cliente, bitacora };
}

describe('La bitácora del cliente de restauración: una línea por petición', () => {
  const red = redDeMentira((url) => {
    if (url.includes('/rest/v1/usuarios?')) {
      return new Response('[{"id":"a"}]', { status: HTTP_CONTENIDO_PARCIAL, headers: { 'content-range': '0-0/2', 'content-type': 'application/json' } });
    }
    if (url.includes('/storage/v1/object/')) {
      return new Response('{"statusCode":"404","error":"not_found"}', { status: HTTP_NO_ENCONTRADO });
    }
    return new Response('[]', { status: HTTP_OK, headers: { 'content-type': 'application/json' } });
  });

  it('anota el ingreso sin la contraseña, y cada petición con su método, su ruta y su código', async () => {
    const { cliente, bitacora } = clienteCon(red.buscar);
    await cliente.iniciarSesion(CORREO, CONTRASENA);
    expect(await cliente.contar('usuarios')).toBe(2);
    await cliente.leerPagina('ventas', null, FILAS_POR_PAGINA);
    await cliente.leerPagina('ventas', 'abc-123', 50);
    await cliente.ventasPorMes();
    expect(await cliente.bajarFoto('x.png')).toBeNull();

    expect(bitacora).toEqual([
      `sesión de restauración iniciada como ${CORREO}`,
      'GET /rest/v1/usuarios?limit=1 -> HTTP 206',
      'GET /rest/v1/ventas?limit=1000 -> HTTP 200',
      'GET /rest/v1/ventas?id=gt.abc-123&limit=50 -> HTTP 200',
      'POST /rest/v1/rpc/restauracion_ventas_por_mes -> HTTP 200',
      'GET /storage/v1/object/fotos/x.png -> HTTP 404',
    ]);
  });

  it('en la bitácora NUNCA aparecen la contraseña, el access token ni el token de refresco', async () => {
    const { cliente, bitacora } = clienteCon(red.buscar);
    await cliente.iniciarSesion(CORREO, CONTRASENA);
    await cliente.contar('usuarios');
    await cliente.leerPagina('ventas', null, FILAS_POR_PAGINA);
    const todo = bitacora.join('\n');
    expect(todo).not.toContain(CONTRASENA);
    expect(todo).not.toContain(ACCESS_TOKEN);
    expect(todo).not.toContain(TOKEN_DE_REFRESCO);
    expect(todo).not.toContain('llave-publicable');
    // Y la lista de columnas tampoco: es larga y siempre la misma para una tabla.
    expect(todo).not.toContain('select=');
  });

  it('la petición SÍ viajó con el token y con la lista de columnas: lo que se recorta es solo lo que se anota', async () => {
    const red2 = redDeMentira(() => new Response('[]', { status: HTTP_OK }));
    const { cliente } = clienteCon(red2.buscar);
    await cliente.iniciarSesion(CORREO, CONTRASENA);
    await cliente.leerPagina('ventas', null, FILAS_POR_PAGINA);
    expect(red2.peticiones).toHaveLength(1);
    expect(red2.peticiones[0]?.url).toContain('select=');
    expect(red2.peticiones[0]?.url).toContain('order=id.asc');
  });

  it('si la red no contesta, no queda ninguna línea de petición: el error es de conexión, no de la nube', async () => {
    const { cliente, bitacora } = clienteCon(() => Promise.reject(new Error('fetch failed')));
    await cliente.iniciarSesion(CORREO, CONTRASENA);
    await expect(cliente.contar('usuarios')).rejects.toThrow(/Se perdió la conexión con la nube/);
    expect(bitacora.filter((l) => l.includes('HTTP'))).toEqual([]);
  });
});

describe('rutaParaLaBitacora: la ruta sin la lista de columnas ni el orden', () => {
  it('deja una ruta sin parámetros tal cual', () => {
    expect(rutaParaLaBitacora('/rest/v1/rpc/contrato_de_sincronizacion')).toBe('/rest/v1/rpc/contrato_de_sincronizacion');
  });

  it('quita select= y order=, y conserva lo que distingue una página de otra', () => {
    expect(rutaParaLaBitacora('/rest/v1/ventas?select=id,total::text,recibido_en&order=id.asc&id=gt.abc&limit=1000')).toBe('/rest/v1/ventas?id=gt.abc&limit=1000');
  });

  it('si solo había select=, no deja un «?» colgando', () => {
    expect(rutaParaLaBitacora('/rest/v1/ventas?select=id')).toBe('/rest/v1/ventas');
  });
});
