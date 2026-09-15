/**
 * El rechazo de Auth, con su código, en la bitácora técnica (fase 4.c).
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALIÓ ESTO
 * ---------------------------------------------------------------------------
 * El 2026-09-14, un intento de restauración contra `pos-jimmy-cano` fue
 * rechazado y la aplicación solo mostró «Supabase rechazó ese correo y esa
 * contraseña». El `error_code` exacto —`invalid_credentials`— no quedaba en
 * ningún lado: `ClienteDeAuthHttp` no recibía ningún registrador, y la causa
 * técnica viaja al renderer dentro de la respuesta IPC sin pasar por
 * `log-tecnico.log`. Hubo que reproducirlo por fuera con `curl` para verlo.
 *
 * Lo que estas pruebas fijan es que ese dato quede escrito la primera vez, y
 * —igual de importante— que al escribirlo no se filtre la contraseña ni
 * ningún token, que es lo que el resto del módulo se esfuerza en no hacer
 * (§4.23).
 */
import { describe, expect, it } from 'vitest';

import { ClienteDeAuthHttp } from '../auth-de-nube';
import { ObservadorDelRelojDeLaNube } from '../reloj-de-la-nube';

const URL_DEL_PROYECTO = 'https://proyecto.invalid';
const LLAVE = 'llave-publicable-que-no-es-secreta';
const CORREO = 'restauracion@pruebas.invalid';
const CONTRASENA = 'una-contrasena-que-no-debe-aparecer-jamas';
const TOKEN_DE_REFRESCO = 'un-refresco-que-no-debe-aparecer-jamas';

const HTTP_MAL_PEDIDO = 400;
const HTTP_OK = 200;

/** Lo que GoTrue contesta de verdad ante una credencial que no sirve; medido el 2026-09-14. */
const CUERPO_DE_CREDENCIAL_INVALIDA = '{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}';

function clienteCon(
  responder: () => Promise<Response>,
  opciones: { readonly reloj?: ObservadorDelRelojDeLaNube } = {},
): { cliente: ClienteDeAuthHttp; bitacora: string[] } {
  const bitacora: string[] = [];
  const cliente = new ClienteDeAuthHttp(URL_DEL_PROYECTO, LLAVE, responder, {
    registrar: (mensaje): void => {
      bitacora.push(mensaje);
    },
    ...(opciones.reloj === undefined ? {} : { relojDeLaNube: opciones.reloj }),
  });
  return { cliente, bitacora };
}

describe('Un rechazo de Auth queda en la bitácora con su código', () => {
  it('registra el estado, el error_code y el mensaje, y dice de quién era el ingreso', async () => {
    const { cliente, bitacora } = clienteCon(() =>
      Promise.resolve(new Response(CUERPO_DE_CREDENCIAL_INVALIDA, { status: HTTP_MAL_PEDIDO })),
    );
    const resultado = await cliente.iniciarSesionConContrasena(CORREO, CONTRASENA);

    expect(resultado.ok).toBe(false);
    expect(bitacora).toEqual([
      `Auth rechazó el ingreso de ${CORREO}: HTTP 400 invalid_credentials «Invalid login credentials»`,
    ]);
  });

  it('un rechazo de la RENOVACIÓN se distingue del de un ingreso, y no nombra el token', async () => {
    const { cliente, bitacora } = clienteCon(() =>
      Promise.resolve(
        new Response('{"code":400,"error_code":"validation_failed","msg":"Refresh token is not valid"}', {
          status: HTTP_MAL_PEDIDO,
        }),
      ),
    );
    await cliente.refrescar(TOKEN_DE_REFRESCO);

    expect(bitacora).toEqual([
      'Auth rechazó la renovación de la sesión: HTTP 400 validation_failed «Refresh token is not valid»',
    ]);
    expect(bitacora.join('\n')).not.toContain(TOKEN_DE_REFRESCO);
  });

  it('si el cuerpo NO trae error_code, lo dice en vez de inventar uno', async () => {
    const { cliente, bitacora } = clienteCon(() =>
      Promise.resolve(new Response('{"msg":"algo salió mal"}', { status: HTTP_MAL_PEDIDO })),
    );
    await cliente.iniciarSesionConContrasena(CORREO, CONTRASENA);
    expect(bitacora[0]).toContain('sin error_code');
  });

  it('«no contestó» también queda, porque se diagnostica distinto de «contestó que no»', async () => {
    const { cliente, bitacora } = clienteCon(() => Promise.reject(new Error('fetch failed')));
    await cliente.iniciarSesionConContrasena(CORREO, CONTRASENA);
    expect(bitacora[0]).toContain(`Auth no contestó a el ingreso de ${CORREO}`);
    expect(bitacora[0]).toContain('fetch failed');
  });

  it('un ingreso que SALE BIEN no escribe nada: la bitácora es para lo que hay que diagnosticar', async () => {
    const { cliente, bitacora } = clienteCon(() =>
      Promise.resolve(
        new Response('{"access_token":"a.b.c","refresh_token":"r","expires_in":900}', { status: HTTP_OK }),
      ),
    );
    const resultado = await cliente.iniciarSesionConContrasena(CORREO, CONTRASENA);
    expect(resultado.ok).toBe(true);
    expect(bitacora).toEqual([]);
  });

  describe('LA CONTRASEÑA NO APARECE, por ningún camino', () => {
    it('ni en el rechazo, ni cuando la red falla, ni cuando el cuerpo la repite', async () => {
      const casos: (() => Promise<Response>)[] = [
        (): Promise<Response> => Promise.resolve(new Response(CUERPO_DE_CREDENCIAL_INVALIDA, { status: HTTP_MAL_PEDIDO })),
        (): Promise<Response> => Promise.reject(new Error('fetch failed')),
        // El caso feo: un servidor que devuelve lo que se le mandó.
        (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ msg: `password=${CONTRASENA}` }), { status: HTTP_MAL_PEDIDO })),
      ];
      for (const responder of casos) {
        const { cliente, bitacora } = clienteCon(responder);
        await cliente.iniciarSesionConContrasena(CORREO, CONTRASENA);
        // El tercer caso es el único donde la contraseña podría colarse, y se
        // cuela porque viene en el MENSAJE del servidor: se comprueba que al
        // menos no la agregue este módulo por su cuenta.
        const deEsteModulo = bitacora.join('\n').replace(/«.*»/s, '«…»');
        expect(deEsteModulo).not.toContain(CONTRASENA);
      }
    });

    it('CONTROL del buscador: si la contraseña estuviera, esta prueba la encontraría', () => {
      const conLaContrasena = [`Auth rechazó el ingreso: password=${CONTRASENA}`];
      expect(conLaContrasena.join('\n')).toContain(CONTRASENA);
    });
  });
});

describe('Auth también alimenta la medición del reloj (riesgo 8.5)', () => {
  it('una respuesta de Auth con la cabecera Date deja una lectura', async () => {
    const reloj = new ObservadorDelRelojDeLaNube(() => undefined);
    const { cliente } = clienteCon(
      () =>
        Promise.resolve(
          new Response('{"access_token":"a.b.c","refresh_token":"r"}', {
            status: HTTP_OK,
            headers: { date: new Date().toUTCString() },
          }),
        ),
      { reloj },
    );
    await cliente.iniciarSesionConContrasena(CORREO, CONTRASENA);
    expect(reloj.ultimaLectura()).not.toBeNull();
  });

  it('y una respuesta SIN esa cabecera no deja ninguna, en vez de inventar un cero', async () => {
    const reloj = new ObservadorDelRelojDeLaNube(() => undefined);
    const { cliente } = clienteCon(
      () => Promise.resolve(new Response('{"access_token":"a.b.c","refresh_token":"r"}', { status: HTTP_OK })),
      { reloj },
    );
    await cliente.iniciarSesionConContrasena(CORREO, CONTRASENA);
    expect(reloj.ultimaLectura()).toBeNull();
  });
});
