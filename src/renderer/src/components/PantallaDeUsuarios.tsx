/**
 * Administración de usuarios: alta, edición, cambio de PIN y baja.
 *
 * Muestra TODOS —activos e inactivos— porque un usuario dado de baja tiene que
 * poder verse para reactivarlo. Se distinguen visualmente: si se ocultaran los
 * inactivos, alguien intentaría crear otro con el mismo nombre y chocaría
 * contra un UNIQUE sin entender por qué. Es el mismo criterio de la pantalla de
 * categorías.
 *
 * Esta pantalla solo es alcanzable con rol administrativo, pero eso no lo
 * decide ella: el proceso principal rechaza cada canal con `requiereRol`.
 * Esconder el botón es comodidad, no control.
 *
 * EL PIN SE PIDE EN SU PROPIO DIÁLOGO, no como un campo más del formulario de
 * edición. Es información sensible y su cambio es un hecho aparte en la
 * auditoría; mezclarlo con el nombre invitaría a tocarlo sin querer al
 * corregir un acento.
 */

import { useCallback, useEffect, useState } from 'react';

import type { RolIpc, UsuarioIpc } from '@shared/types/ipc';
import { LARGO_DEL_PIN, tieneFormatoDePinValido } from '@shared/pin';
import { CampoDeTexto } from './TecladoEnPantalla';
import { TecladoNumerico } from './TecladoNumerico';

/** Estado del formulario, tanto para crear como para editar. */
interface Borrador {
  /** `null` cuando se está dando de alta a alguien nuevo. */
  readonly id: string | null;
  readonly nombre: string;
  readonly rol: RolIpc;
  /** Solo se usa al crear: al editar, el PIN va por su propio diálogo. */
  readonly pin: string;
}

const BORRADOR_VACIO: Borrador = { id: null, nombre: '', rol: 'venta', pin: '' };

/** Cómo se lee un rol en pantalla. */
function nombreDelRol(rol: RolIpc): string {
  return rol === 'administrativo' ? 'Administrativo' : 'Venta';
}

export function PantallaDeUsuarios({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  /**
   * `null` mientras se está consultando.
   *
   * Hace falta distinguirlo del arreglo vacío: esta lista NUNCA puede estar
   * vacía de verdad —para verla hay que tener sesión iniciada, así que como
   * mínimo estás vos—, de modo que una lista sin filas solo puede significar
   * «todavía no llegó la respuesta». Se vio manejando la aplicación: la
   * pantalla abría con la tarjeta vacía y las filas aparecían después.
   */
  const [usuarios, setUsuarios] = useState<readonly UsuarioIpc[] | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  /** Usuario al que se le está cambiando el PIN, o `null`. */
  const [cambiandoPin, setCambiandoPin] = useState<UsuarioIpc | null>(null);
  const [pinNuevo, setPinNuevo] = useState('');

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.usuarios.listar();
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setUsuarios(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const refrescar = useCallback((): void => {
    setRecarga((anterior) => anterior + 1);
  }, []);

  const editando = borrador.id !== null;

  const guardar = useCallback((): void => {
    const nombre = borrador.nombre.trim();

    if (borrador.id === null && !tieneFormatoDePinValido(borrador.pin)) {
      setMensaje(`El PIN tiene que ser de ${String(LARGO_DEL_PIN)} dígitos.`);
      return;
    }

    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta =
        borrador.id === null
          ? await window.pos.usuarios.crear({ nombre, rol: borrador.rol, pin: borrador.pin })
          : await window.pos.usuarios.editar({ id: borrador.id, nombre, rol: borrador.rol });
      setTrabajando(false);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setAviso(
        borrador.id === null
          ? `${respuesta.datos.nombre} ya puede iniciar sesión con su PIN.`
          : `Se guardaron los cambios de ${respuesta.datos.nombre}.`,
      );
      setBorrador(BORRADOR_VACIO);
      refrescar();
    })();
  }, [borrador, refrescar]);

  const cambiarEstado = useCallback(
    (usuario: UsuarioIpc): void => {
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await window.pos.usuarios.fijarActivo(usuario.id, !usuario.activo);
        setTrabajando(false);
        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          return;
        }
        setMensaje(null);
        setAviso(
          respuesta.datos.activo
            ? `${respuesta.datos.nombre} vuelve a poder iniciar sesión.`
            : `${respuesta.datos.nombre} ya no puede iniciar sesión. Su historial queda intacto.`,
        );
        refrescar();
      })();
    },
    [refrescar],
  );

  const confirmarPin = useCallback((): void => {
    if (cambiandoPin === null) {
      return;
    }
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.usuarios.cambiarPin(cambiandoPin.id, pinNuevo);
      setTrabajando(false);
      setPinNuevo('');

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setAviso(`${respuesta.datos.nombre} tiene un PIN nuevo. Decíselo en persona.`);
      setCambiandoPin(null);
      refrescar();
    })();
  }, [cambiandoPin, pinNuevo, refrescar]);

  return (
    <div data-prueba="pantalla-de-usuarios">
      <header className="encabezado">
        <h1>Usuarios</h1>
        <p className="subtitulo">
          Quién puede usar el sistema y con qué permisos. Un usuario nunca se borra: se da de
          baja, y sus ventas y su historial de auditoría quedan intactos.
        </p>
      </header>

      {mensaje !== null && (
        <p className="alerta" data-prueba="usuarios-error">
          {mensaje}
        </p>
      )}
      {aviso !== null && (
        <p className="aviso-exito" data-prueba="usuarios-aviso">
          {aviso}
        </p>
      )}

      <section className="tarjeta">
        <h2>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>

        <label className="campo">
          <span className="campo__etiqueta">Nombre</span>
          <CampoDeTexto
            etiqueta="Nombre del usuario"
            valor={borrador.nombre}
            maxLength={60}
            data-prueba="usuario-nombre"
            alCambiar={(nombre) => {
              setBorrador((anterior) => ({ ...anterior, nombre }));
            }}
          />
        </label>

        <label className="campo">
          <span className="campo__etiqueta">Rol</span>
          <select
            value={borrador.rol}
            data-prueba="usuario-rol"
            onChange={(evento) => {
              setBorrador((anterior) => ({ ...anterior, rol: evento.target.value as RolIpc }));
            }}
          >
            <option value="venta">Venta</option>
            <option value="administrativo">Administrativo</option>
          </select>
          <span className="campo__pista">
            Venta cobra y abre caja. Administrativo además carga catálogo, autoriza descuentos
            y gestiona usuarios.
          </span>
        </label>

        {/*
          El PIN solo se pide al CREAR. Al editar no está, a propósito: para
          cambiarlo hay un botón aparte en cada fila, con su propio diálogo.
        */}
        {!editando && (
          <label className="campo">
            <span className="campo__etiqueta">PIN de {LARGO_DEL_PIN} dígitos</span>
            <CampoDeTexto
              etiqueta={`PIN de ${String(LARGO_DEL_PIN)} dígitos`}
              disposicion="entero"
              oculto
              autoComplete="off"
              valor={borrador.pin}
              maxLength={LARGO_DEL_PIN}
              data-prueba="usuario-pin"
              alCambiar={(valor) => {
                // El teclado en pantalla ya solo escribe dígitos; esto cubre
                // un teclado físico, que puede mandar cualquier cosa.
                setBorrador((anterior) => ({
                  ...anterior,
                  pin: valor.replace(/\D/g, ''),
                }));
              }}
            />
            <span className="campo__pista">
              Se lo decís en persona. El sistema guarda solo su huella, no el número, así que
              nadie puede recuperarlo después: si lo olvida, se le pone uno nuevo.
            </span>
          </label>
        )}

        <div className="acciones">
          <button
            type="button"
            disabled={trabajando || borrador.nombre.trim().length === 0}
            data-prueba="usuario-guardar"
            onClick={guardar}
          >
            {editando ? 'Guardar cambios' : 'Crear usuario'}
          </button>
          {editando && (
            <button
              type="button"
              className="boton--secundario"
              data-prueba="usuario-cancelar"
              onClick={() => {
                setBorrador(BORRADOR_VACIO);
                setMensaje(null);
              }}
            >
              Cancelar
            </button>
          )}
        </div>
      </section>

      <section className="tarjeta">
        <h2>Todos los usuarios</h2>
        {usuarios === null ? (
          <p className="pendiente" data-prueba="usuarios-cargando">
            Consultando los usuarios…
          </p>
        ) : (
        <ul className="lista" data-prueba="lista-de-usuarios">
          {usuarios.map((usuario) => (
            <li
              key={usuario.id}
              className={usuario.activo ? 'lista__fila' : 'lista__fila lista__fila--inactiva'}
              data-prueba="fila-de-usuario"
              data-usuario={usuario.id}
            >
              <div className="lista__principal">
                <span className="lista__nombre">{usuario.nombre}</span>
                {!usuario.activo && <span className="etiqueta">Dado de baja</span>}
                {usuario.bloqueado && (
                  <span className="etiqueta" data-prueba="usuario-bloqueado">
                    Bloqueado por intentos
                  </span>
                )}
                {usuario.esUnoMismo && <span className="etiqueta">Vos</span>}
                {usuario.sinPin && (
                  <span className="etiqueta" data-prueba="usuario-sin-pin">
                    Sin PIN: asignarle uno con «cambiar PIN»
                  </span>
                )}
                <span className="lista__detalle">
                  {nombreDelRol(usuario.rol)}
                  {usuario.tieneAutorizacionRemota && ' · con autorización remota'}
                </span>
              </div>

              <div className="lista__acciones">
                <button
                  type="button"
                  className="boton--secundario"
                  data-prueba="usuario-editar"
                  onClick={() => {
                    setBorrador({
                      id: usuario.id,
                      nombre: usuario.nombre,
                      rol: usuario.rol,
                      pin: '',
                    });
                    setMensaje(null);
                    setAviso(null);
                  }}
                >
                  Editar
                </button>

                <button
                  type="button"
                  className="boton--secundario"
                  data-prueba="usuario-cambiar-pin"
                  onClick={() => {
                    setCambiandoPin(usuario);
                    setPinNuevo('');
                    setMensaje(null);
                    setAviso(null);
                  }}
                >
                  Cambiar PIN
                </button>

                {/*
                  No se ofrece dar de baja ni a uno mismo ni al único
                  administrador activo. El proceso principal lo rechaza igual;
                  esconder el botón evita que alguien lo intente y reciba un
                  mensaje que llega tarde.
                */}
                <button
                  type="button"
                  className="boton--secundario"
                  disabled={
                    trabajando ||
                    (usuario.activo && (usuario.esUnoMismo || usuario.esElUnicoAdministrador))
                  }
                  data-prueba="usuario-cambiar-estado"
                  title={
                    usuario.esElUnicoAdministrador
                      ? 'Es el único administrador activo: sin él nadie podría administrar el sistema.'
                      : usuario.esUnoMismo
                        ? 'No podés darte de baja a vos mismo.'
                        : undefined
                  }
                  onClick={() => {
                    cambiarEstado(usuario);
                  }}
                >
                  {usuario.activo ? 'Dar de baja' : 'Reactivar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
        )}
      </section>

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>

      {/* Cambio de PIN: su propio diálogo, con el mismo teclado táctil del ingreso. */}
      {cambiandoPin !== null && (
        <div className="capa-modal">
          <section className="modal" data-prueba="dialogo-de-pin">
            <h2>PIN nuevo para {cambiandoPin.nombre}</h2>
            <p className="modal__texto">
              No hace falta el PIN anterior: esta acción existe justamente para cuando alguien
              lo olvidó. Queda registrado en la auditoría quién lo cambió y a quién, nunca el
              número.
            </p>

            <TecladoNumerico
              valor={pinNuevo}
              alCambiar={setPinNuevo}
              alConfirmar={confirmarPin}
              deshabilitado={trabajando}
            />

            <div className="modal__acciones">
              <button
                type="button"
                className="boton--secundario"
                data-prueba="cancelar-cambio-de-pin"
                onClick={() => {
                  setCambiandoPin(null);
                  setPinNuevo('');
                }}
              >
                Cancelar
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
