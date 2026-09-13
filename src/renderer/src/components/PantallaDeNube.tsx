/**
 * «Conectar con la nube»: el aprovisionamiento de §1.3 del diseño.
 *
 * Se usa UNA vez por terminal. El administrador teclea el correo y la
 * contraseña del usuario de terminal —los que él mismo creó desde el panel de
 * Supabase—, la aplicación inicia sesión y guarda **solo el token de refresco**,
 * cifrado. Desde ahí la terminal se mantiene sola.
 *
 * ===========================================================================
 * LA CONTRASEÑA VIVE EN ESTA PANTALLA LO QUE DURA EL ENVÍO
 * ===========================================================================
 *
 * Está en un `useState` mientras se teclea, viaja por IPC una vez y **el campo
 * se limpia en cuanto la respuesta vuelve**, salga bien o mal. No se guarda en
 * `localStorage`, no se manda a ningún otro canal y el `input` va sin
 * `autoComplete`, para que el navegador embebido tampoco la recuerde.
 *
 * Que se limpie también cuando FALLA es deliberado: si quedara escrita, un
 * error de tecleo dejaría la contraseña de la terminal a la vista en el
 * mostrador hasta que alguien cambie de pantalla.
 *
 * Solo es alcanzable con rol administrativo, pero eso no lo decide ella: el
 * proceso principal rechaza los dos canales con `requiereRol`.
 */

import { useCallback, useEffect, useState } from 'react';

import type { EstadoDeNubeIpc, ResumenDeConexionIpc } from '@shared/types/ipc';

/** Segundos que tiene un minuto, para mostrar la vida del token en minutos. */
const SEGUNDOS_POR_MINUTO = 60;

/** La tolerancia de reloj medida contra PostgREST. Ver CLAUDE.md §4.22. */
const TOLERANCIA_DE_RELOJ_S = 30;

export function PantallaDeNube({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoDeNubeIpc | null>(null);
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenDeConexionIpc | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  /** `false` cuando el proceso principal no registró los canales de nube. */
  const [configurada, setConfigurada] = useState(true);

  const releerEstado = useCallback(async (): Promise<void> => {
    const respuesta = await window.pos.nube.estado();
    if (respuesta.ok) {
      setEstado(respuesta.datos);
      setConfigurada(true);
      return;
    }
    /*
      Si los canales no se registraron —porque falta `POS_NUBE_URL`—, Electron
      contesta que no hay manejador. Se distingue de un error de permiso para
      no decirle al administrador que le falta un permiso que sí tiene.
    */
    setConfigurada(!/No handler registered|no handler/i.test(respuesta.error.mensaje));
    setMensaje(respuesta.error.mensaje);
  }, []);

  useEffect(() => {
    /*
      La consulta va dentro de una función asíncrona y no suelta: el estado se
      actualiza recién cuando la respuesta vuelve del proceso principal, no en
      el cuerpo del efecto. Es el mismo patrón que usa `PantallaDeNegocio`.
    */
    void (async (): Promise<void> => {
      await releerEstado();
    })();
  }, [releerEstado]);

  const conectar = useCallback(async (): Promise<void> => {
    setTrabajando(true);
    setMensaje(null);
    setResumen(null);
    try {
      const respuesta = await window.pos.nube.conectar({ correo: correo.trim(), contrasena });
      if (respuesta.ok) {
        setResumen(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
      }
    } finally {
      // Pase lo que pase, la contraseña deja de estar en pantalla. Ver la
      // cabecera: en un mostrador, dejarla escrita tras un error es peor.
      setContrasena('');
      setTrabajando(false);
      await releerEstado();
    }
  }, [correo, contrasena, releerEstado]);

  if (!configurada) {
    return (
      <div data-prueba="pantalla-de-nube">
        <header className="encabezado">
          <h1>Conectar con la nube</h1>
        </header>
        <p className="advertencia" data-prueba="nube-sin-configurar">
          Esta copia de la aplicación no tiene configurado ningún proyecto de Supabase, así que
          todavía no hay a qué conectarse. Falta definir <code>POS_NUBE_URL</code> y{' '}
          <code>POS_NUBE_LLAVE_PUBLICABLE</code>.
        </p>
        <div className="pie">
          <button type="button" className="boton--secundario" onClick={alVolver}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  const puedeConectar = correo.trim() !== '' && contrasena !== '' && !trabajando;

  return (
    <div data-prueba="pantalla-de-nube">
      <header className="encabezado">
        <h1>Conectar con la nube</h1>
        <p className="subtitulo">
          Se hace una sola vez por terminal. La aplicación inicia sesión y guarda únicamente la
          sesión, cifrada con el sistema operativo: <strong>la contraseña no se guarda en ningún
          lado</strong> y hay que volver a escribirla si algún día se reconecta.
        </p>
      </header>

      {mensaje !== null && (
        <p className="alerta" data-prueba="nube-error">
          {mensaje}
        </p>
      )}

      <section className="tarjeta" data-prueba="nube-estado">
        <h2>Estado de esta terminal</h2>
        {estado === null ? (
          <p className="pendiente">Consultando…</p>
        ) : (
          <dl className="datos">
            <dt>Credencial guardada</dt>
            <dd data-prueba="nube-hay-credencial">{estado.hayCredencial ? 'Sí' : 'No'}</dd>

            <dt>Sesión activa ahora</dt>
            <dd data-prueba="nube-conectada">
              {estado.conectada ? 'Sí' : 'No'}
              {!estado.conectada && estado.hayCredencial && ' — reintentando'}
            </dd>

            <dt>Usuario</dt>
            <dd data-prueba="nube-correo">{estado.correo ?? '—'}</dd>

            <dt>Rol del token</dt>
            <dd data-prueba="nube-rol">{estado.rol ?? '—'}</dd>

            <dt>Duración del token</dt>
            <dd data-prueba="nube-vida">
              {estado.vidaDelTokenSegundos === null
                ? '—'
                : `${String(estado.vidaDelTokenSegundos)} s (${String(
                    Math.round(estado.vidaDelTokenSegundos / SEGUNDOS_POR_MINUTO),
                  )} min). Se renueva sola antes de que venza.`}
            </dd>

            {estado.renovacionesFallidas > 0 && (
              <>
                <dt>Renovaciones fallidas seguidas</dt>
                <dd data-prueba="nube-fallidas">{estado.renovacionesFallidas}</dd>
              </>
            )}

            {estado.ultimoMotivo !== null && (
              <>
                <dt>Último detalle</dt>
                <dd data-prueba="nube-motivo">{estado.ultimoMotivo}</dd>
              </>
            )}
          </dl>
        )}

        {estado?.relojSospechoso === true && (
          <p className="advertencia" data-prueba="nube-reloj">
            El reloj de esta computadora está desfasado{' '}
            {String(estado.desfaseDeRelojSegundos ?? 0)} segundos respecto del servidor. La
            renovación no depende del reloj local y sigue funcionando, pero conviene corregir la
            hora en Windows: pasados unos {String(TOLERANCIA_DE_RELOJ_S)} segundos de desfase la
            nube empieza a rechazar tokens que deberían servir.
          </p>
        )}
      </section>

      {resumen !== null && (
        <p className="aviso-exito" data-prueba="nube-conectada-aviso">
          Terminal conectada como {resumen.correo ?? 'el usuario indicado'}, con rol{' '}
          {resumen.rol ?? '—'}. El token dura {String(resumen.vidaDelTokenSegundos)} segundos y se
          renueva sola. La contraseña no quedó guardada.
        </p>
      )}

      <section className="tarjeta">
        <h2>{estado?.hayCredencial === true ? 'Volver a conectar' : 'Conectar'}</h2>
        {estado?.hayCredencial === true && (
          <p className="subtitulo">
            Ya hay una credencial guardada. Volver a conectar la reemplaza; solo hace falta si se
            cambió la contraseña del usuario de terminal o si se creó uno nuevo.
          </p>
        )}

        <label className="campo">
          <span className="campo__etiqueta">Correo del usuario de terminal</span>
          <input
            type="email"
            value={correo}
            maxLength={320}
            autoComplete="off"
            data-prueba="nube-correo-entrada"
            onChange={(evento) => {
              setCorreo(evento.target.value);
            }}
          />
        </label>

        <label className="campo">
          <span className="campo__etiqueta">Contraseña</span>
          <input
            type="password"
            value={contrasena}
            autoComplete="off"
            data-prueba="nube-contrasena-entrada"
            onChange={(evento) => {
              setContrasena(evento.target.value);
            }}
          />
        </label>

        <div className="acciones">
          <button
            type="button"
            disabled={!puedeConectar}
            data-prueba="nube-conectar"
            onClick={() => {
              void conectar();
            }}
          >
            {trabajando ? 'Conectando…' : 'Conectar'}
          </button>
        </div>
      </section>

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}
