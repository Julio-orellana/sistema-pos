/**
 * Restaurar desde la nube (§6 del diseño, fase 4.b).
 *
 * Es la única pantalla que se ofrece ANTES de que exista un usuario local, y
 * por eso no exige sesión: quien autoriza es la nube, con el usuario de rol
 * `restauracion` del dueño. La contraseña vive en un `useState` lo que dura el
 * envío, viaja por IPC una vez y el campo se limpia al volver la respuesta,
 * salga bien o mal (el mismo criterio de «Conectar con la nube»).
 *
 * Cinco momentos, en este orden, y la pantalla no deja saltar ninguno:
 *
 *   1. Iniciar (o retomar): correo, contraseña, motivo, y la fecha si es robo.
 *   2. Progreso: una fila por tabla, ritmo de los últimos 30 s, cancelar.
 *      SIN estimación de tiempo total: en la primera página siempre miente.
 *   3. Verificación: conteos y suma por mes, nube contra local, al centavo.
 *   4. Revisión: filas posteriores al robo (excluidas o restauradas y
 *      listadas), usuarios con cambios posteriores al robo (uno por uno), y
 *      un PIN nuevo para cada usuario activo.
 *   5. Terminar: recién cuando no queda ningún impedimento.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  AnomaliaDeRestauracionIpc,
  MotivoDeRestauracionIpc,
  ProgresoDeRestauracionIpc,
  RolIpc,
  UsuarioRestauradoIpc,
} from '@shared/types/ipc';
import { LARGO_DEL_PIN } from '@shared/pin';
import { CampoDeFecha, CampoDeTexto } from './TecladoEnPantalla';
import { TecladoNumerico } from './TecladoNumerico';

/** Cada cuánto se refresca el progreso mientras la restauración corre. */
const INTERVALO_DE_SONDEO_MS = 700;

/** Las fases en las que la pantalla sondea. */
const FASES_EN_MARCHA = new Set<ProgresoDeRestauracionIpc['fase']>(['iniciando', 'tablas', 'archivos', 'verificacion']);

const NOMBRES_DE_TABLA: Readonly<Record<string, string>> = {
  usuarios: 'usuarios',
  categorias: 'categorías',
  configuracion_negocio: 'datos del negocio',
  productos: 'productos',
  precios_especiales: 'precios especiales',
  limites_descuento: 'topes de descuento',
  caja_sesiones: 'turnos de caja',
  caja_sesion_denominaciones: 'arqueos de caja',
  ventas: 'ventas',
  venta_detalle: 'líneas de venta',
  recibos: 'recibos',
  anulaciones_de_venta: 'anulaciones de venta',
  auditoria_log: 'asientos de auditoría',
};

const nombreDeTabla = (tabla: string): string => NOMBRES_DE_TABLA[tabla] ?? tabla;

/**
 * La REFERENCIA del proyecto de Supabase, sacada de su URL: lo que el panel
 * muestra como nombre del proyecto (`https://abcd….supabase.co` → `abcd…`).
 *
 * Si la URL no tiene esa forma se devuelve tal cual: es un dato para que una
 * persona reconozca el proyecto, y una URL rara se reconoce mejor entera que
 * recortada a la mitad.
 */
function referenciaDelProyecto(url: string): string {
  try {
    const anfitrion = new URL(url).hostname;
    return anfitrion.split('.')[0] ?? url;
  } catch {
    return url;
  }
}

function fechaLegible(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString();
}

/** Lo que devuelve un `<input type="datetime-local">`, pasado a ISO en UTC. */
function aIso(local: string): string | null {
  if (local === '') {
    return null;
  }
  const fecha = new Date(local);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

export interface PantallaDeRestauracionProps {
  /** Se llama cuando la restauración terminó y ya se puede ingresar. */
  readonly alTerminar: () => void;
  /** Volver a la configuración inicial. `null` cuando hay una restauración a medias: no hay adónde volver. */
  readonly alVolver: (() => void) | null;
}

export function PantallaDeRestauracion({ alTerminar, alVolver }: PantallaDeRestauracionProps): React.JSX.Element {
  const [progreso, setProgreso] = useState<ProgresoDeRestauracionIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [motivo, setMotivo] = useState<MotivoDeRestauracionIpc>('falla');
  const [fechaDelRobo, setFechaDelRobo] = useState('');
  const [usuarioParaPin, setUsuarioParaPin] = useState<UsuarioRestauradoIpc | null>(null);
  const [pin, setPin] = useState('');

  const aplicar = useCallback((respuesta: { ok: true; datos: ProgresoDeRestauracionIpc } | { ok: false; error: { mensaje: string } }): void => {
    if (respuesta.ok) {
      setProgreso(respuesta.datos);
    } else {
      setMensaje(respuesta.error.mensaje);
    }
  }, []);

  const releer = useCallback(async (): Promise<void> => {
    aplicar(await window.pos.restauracion.progreso());
  }, [aplicar]);

  useEffect(() => {
    void (async (): Promise<void> => {
      await releer();
    })();
  }, [releer]);

  const enMarcha = progreso !== null && FASES_EN_MARCHA.has(progreso.fase);
  useEffect(() => {
    if (!enMarcha) {
      return;
    }
    const intervalo = setInterval(() => {
      void releer();
    }, INTERVALO_DE_SONDEO_MS);
    return (): void => {
      clearInterval(intervalo);
    };
  }, [enMarcha, releer]);

  const iniciar = useCallback(async (): Promise<void> => {
    setTrabajando(true);
    setMensaje(null);
    try {
      const respuesta =
        progreso?.hayRestauracionIncompleta === true
          ? await window.pos.restauracion.retomar({ correo: correo.trim(), contrasena })
          : await window.pos.restauracion.iniciar({
              correo: correo.trim(),
              contrasena,
              motivo,
              fechaDelRobo: motivo === 'robo' ? aIso(fechaDelRobo) : null,
            });
      aplicar(respuesta);
    } finally {
      // La contraseña deja de estar en pantalla, salga bien o mal.
      setContrasena('');
      setTrabajando(false);
    }
  }, [aplicar, contrasena, correo, fechaDelRobo, motivo, progreso?.hayRestauracionIncompleta]);

  const accion = useCallback(
    async (operacion: () => Promise<Parameters<typeof aplicar>[0]>): Promise<void> => {
      setTrabajando(true);
      setMensaje(null);
      try {
        aplicar(await operacion());
      } finally {
        setTrabajando(false);
      }
    },
    [aplicar],
  );

  const asignarPin = useCallback(async (): Promise<void> => {
    if (usuarioParaPin === null) {
      return;
    }
    const id = usuarioParaPin.id;
    const pinTecleado = pin;
    setPin('');
    await accion(() => window.pos.restauracion.asignarPin({ id, pin: pinTecleado }));
    setUsuarioParaPin(null);
  }, [accion, pin, usuarioParaPin]);

  // ---------------------------------------------------------------------------

  if (progreso === null) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-restauracion">
        <h1>Restaurar desde la nube</h1>
        {mensaje !== null ? <p className="alerta">{mensaje}</p> : <p className="pendiente">Consultando…</p>}
      </div>
    );
  }

  if (!progreso.configurada) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-restauracion">
        <h1>Restaurar desde la nube</h1>
        <p className="advertencia" data-prueba="restauracion-sin-configurar">
          Esta copia de la aplicación no tiene configurado ningún proyecto de Supabase, así que no hay de
          dónde restaurar. Falta definir <code>POS_NUBE_URL</code> y <code>POS_NUBE_LLAVE_PUBLICABLE</code>.
        </p>
        {alVolver !== null && (
          <button type="button" className="boton--secundario" onClick={alVolver}>
            Volver
          </button>
        )}
      </div>
    );
  }

  const encabezado = (
    <header className="encabezado">
      <h1>Restaurar desde la nube</h1>
      {/*
        A QUÉ PROYECTO, ANTES DE QUE NADIE ESCRIBA NADA.
        Esto no es decoración: el 2026-09-14 un intento de restauración contra
        el proyecto real fue rechazado porque se tecleó la credencial del
        proyecto de pruebas, y la pantalla no daba ninguna pista de contra cuál
        estaba por conectarse. Cada proyecto de Supabase tiene su propia tabla
        de usuarios, así que la credencial de uno nunca sirve en el otro, y el
        rechazo se lee como «la contraseña está mal».
      */}
      {progreso.proyecto !== null && (
        <p className="subtitulo" data-prueba="restauracion-proyecto">
          Se va a restaurar desde el proyecto <strong>{referenciaDelProyecto(progreso.proyecto)}</strong> de Supabase.
          Usá la contraseña del usuario de restauración <strong>de ese proyecto</strong>. <span className="tenue">{progreso.proyecto}</span>
        </p>
      )}
      <p className="subtitulo">
        Solo para una terminal nueva o vacía. Se trae todo lo que la nube tiene de la tienda, con los mismos
        identificadores; <strong>ningún usuario conserva su PIN</strong>: cada uno recibe uno nuevo antes de terminar.
      </p>
    </header>
  );

  const aviso = mensaje !== null && (
    <p className="alerta" data-prueba="restauracion-error">
      {mensaje}
    </p>
  );

  // --- 1. Iniciar o retomar ---------------------------------------------------
  if (progreso.fase === 'inactiva' || progreso.fase === 'cancelada' || progreso.fase === 'fallida') {
    const retomando = progreso.hayRestauracionIncompleta;
    const puedeEnviar = correo.trim() !== '' && contrasena !== '' && !trabajando && (retomando || motivo === 'falla' || aIso(fechaDelRobo) !== null);
    return (
      <div data-prueba="pantalla-de-restauracion">
        {encabezado}
        {aviso}
        {progreso.fase === 'fallida' && progreso.mensaje !== null && (
          <p className="alerta" data-prueba="restauracion-detenida">
            La restauración se detuvo: {progreso.mensaje}
          </p>
        )}
        {retomando && (
          <p className="advertencia" data-prueba="restauracion-incompleta">
            Hay una restauración incompleta en esta instalación
            {progreso.correo !== null && <> (la empezó {progreso.correo})</>}. Lo que ya bajó quedó guardado. Volvé a iniciar
            sesión para retomarla por la tabla y la página donde quedó; si preferís empezar de cero, hay que borrar la
            carpeta de datos de la aplicación.
          </p>
        )}
        {!retomando && !progreso.baseVacia && (
          <p className="alerta" data-prueba="restauracion-base-con-datos">
            Esta instalación ya tiene datos. La restauración es solo para una terminal vacía: no hay modo de fusionar ni
            de sobrescribir.
          </p>
        )}

        <section className="tarjeta">
          <h2>{retomando ? 'Retomar' : 'Iniciar'}</h2>
          <label className="campo">
            <span className="campo__etiqueta">Correo del usuario de restauración</span>
            <CampoDeTexto
              etiqueta="Correo del usuario de restauración"
              valor={correo}
              maxLength={320}
              mayusculaInicial={false}
              autoComplete="off"
              data-prueba="restauracion-correo"
              alCambiar={setCorreo}
            />
          </label>
          <label className="campo">
            <span className="campo__etiqueta">Contraseña</span>
            <CampoDeTexto
              etiqueta="Contraseña"
              oculto
              mayusculaInicial={false}
              valor={contrasena}
              autoComplete="off"
              data-prueba="restauracion-contrasena"
              alCambiar={setContrasena}
            />
          </label>

          {!retomando && (
            <>
              <div className="opciones" data-prueba="restauracion-motivo">
                <label className={motivo === 'falla' ? 'opcion opcion--activa' : 'opcion'}>
                  <input
                    type="radio"
                    name="motivo"
                    value="falla"
                    checked={motivo === 'falla'}
                    onChange={() => {
                      setMotivo('falla');
                    }}
                  />
                  Falla o reemplazo del equipo
                </label>
                <label className={motivo === 'robo' ? 'opcion opcion--activa' : 'opcion'}>
                  <input
                    type="radio"
                    name="motivo"
                    value="robo"
                    checked={motivo === 'robo'}
                    onChange={() => {
                      setMotivo('robo');
                    }}
                  />
                  Robo
                </label>
              </div>
              {motivo === 'robo' && (
                <label className="campo">
                  <span className="campo__etiqueta">Fecha y hora aproximadas del robo</span>
                  <CampoDeFecha
                    conHora
                    valor={fechaDelRobo}
                    data-prueba="restauracion-fecha-del-robo"
                    alCambiar={setFechaDelRobo}
                  />
                  <span className="campo__pista">
                    Todo lo que la nube recibió después de esa hora se muestra aparte para revisarlo. Ante la duda, una
                    hora ANTERIOR: sobra revisión, no falta. El PIN de todos se resetea igual, sea robo o falla.
                  </span>
                </label>
              )}
            </>
          )}

          <div className="acciones">
            <button
              type="button"
              disabled={!puedeEnviar || (!retomando && !progreso.baseVacia)}
              data-prueba="restauracion-iniciar"
              onClick={() => {
                void iniciar();
              }}
            >
              {trabajando ? 'Comprobando…' : retomando ? 'Retomar la restauración' : 'Iniciar la restauración'}
            </button>
          </div>
        </section>

        {alVolver !== null && !retomando && (
          <div className="pie">
            <button type="button" className="boton--secundario" onClick={alVolver}>
              Volver
            </button>
          </div>
        )}
      </div>
    );
  }

  // --- 2. Progreso -------------------------------------------------------------
  if (enMarcha) {
    return (
      <div data-prueba="pantalla-de-restauracion">
        {encabezado}
        {aviso}
        <section className="tarjeta" data-prueba="restauracion-progreso">
          <h2>
            {progreso.fase === 'iniciando' && 'Comprobando las precondiciones…'}
            {progreso.fase === 'tablas' && 'Bajando las tablas…'}
            {progreso.fase === 'archivos' && 'Bajando las fotos de los productos…'}
            {progreso.fase === 'verificacion' && 'Verificando conteos y sumas…'}
          </h2>
          <ul className="lista">
            {progreso.tablas.map((tabla) => (
              <li key={tabla.tabla} className="lista__fila" data-prueba="restauracion-tabla" data-tabla={tabla.tabla}>
                <div className="lista__principal">
                  <span className="lista__nombre">{nombreDeTabla(tabla.tabla)}</span>
                  <span className="lista__detalle">
                    {tabla.estado === 'esperando' && 'esperando'}
                    {tabla.estado === 'bajando' && `bajando ${String(tabla.filas)}${tabla.total === null ? '' : ` de ${String(tabla.total)}`}`}
                    {tabla.estado === 'lista' && `listo · ${String(tabla.filas)} filas`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {progreso.fotos !== null && (
            <p className="subtitulo" data-prueba="restauracion-fotos">
              Fotos: {String(progreso.fotos.hechas)} de {String(progreso.fotos.total)}
            </p>
          )}
          <p className="subtitulo">
            {progreso.filasPorSegundo !== null && `${String(progreso.filasPorSegundo)} filas por segundo en los últimos 30 s. `}
            {progreso.filasRestantes !== null && `Faltan ${String(progreso.filasRestantes)} filas.`}
          </p>
          <div className="acciones">
            <button
              type="button"
              className="boton--secundario"
              disabled={trabajando}
              data-prueba="restauracion-cancelar"
              onClick={() => {
                void accion(() => window.pos.restauracion.cancelar());
              }}
            >
              Cancelar (se puede retomar)
            </button>
          </div>
        </section>
      </div>
    );
  }

  // --- 5. Terminada ------------------------------------------------------------
  if (progreso.fase === 'terminada') {
    return (
      <div data-prueba="pantalla-de-restauracion">
        {encabezado}
        <p className="aviso-exito" data-prueba="restauracion-terminada">
          Restauración terminada. Todos los usuarios activos tienen su PIN nuevo. Ya se puede ingresar; la terminal se
          conecta a la nube después, desde «Conectar con la nube», con su propio usuario.
        </p>
        <div className="acciones">
          <button type="button" data-prueba="restauracion-ir-al-ingreso" onClick={alTerminar}>
            Ir al ingreso
          </button>
        </div>
      </div>
    );
  }

  // --- 3 y 4. Revisión ---------------------------------------------------------
  const verificacion = progreso.verificacion;
  const excluidas = progreso.anomalias.filter((a) => a.excluida && !a.aceptada);
  const restauradasYListadas = progreso.anomalias.filter((a) => !a.excluida && a.tabla !== 'usuarios');
  const aceptadas = progreso.anomalias.filter((a) => a.aceptada);
  const usuariosAnomalos = progreso.usuarios.filter((u) => u.anomalo);

  const descripcion = (anomalia: AnomaliaDeRestauracionIpc): string =>
    `${nombreDeTabla(anomalia.tabla)}: ${anomalia.resumen} · recibida en la nube el ${fechaLegible(anomalia.recibidoEn)}`;

  if (usuarioParaPin !== null) {
    return (
      <div data-prueba="pantalla-de-restauracion">
        {encabezado}
        {aviso}
        <section className="tarjeta" data-prueba="restauracion-pin">
          <h2>PIN nuevo para {usuarioParaPin.nombre}</h2>
          <p className="subtitulo">
            {String(LARGO_DEL_PIN)} dígitos. No puede ser el de otro usuario activo. El PIN anterior no existe: no
            viajó a la nube.
          </p>
          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => {
              void asignarPin();
            }}
            deshabilitado={trabajando}
          />
          <button
            type="button"
            className="boton--secundario"
            onClick={() => {
              setUsuarioParaPin(null);
              setPin('');
            }}
          >
            Cancelar
          </button>
        </section>
      </div>
    );
  }

  return (
    <div data-prueba="pantalla-de-restauracion">
      {encabezado}
      {aviso}

      <section className="tarjeta" data-prueba="restauracion-verificacion">
        <h2>Verificación {verificacion?.ok === true ? '· cuadra' : '· NO cuadra'}</h2>
        {verificacion !== null && (
          <>
            <dl className="datos">
              {verificacion.conteos.map((conteo) => (
                <div className="dato" key={conteo.tabla}>
                  <span className="dato__etiqueta">{nombreDeTabla(conteo.tabla)}</span>
                  <span className="dato__valor">
                    nube {String(conteo.nube)} · acá {String(conteo.local)}
                    {conteo.excluidas > 0 && ` · excluidas ${String(conteo.excluidas)}`}
                    {conteo.coincide ? ' ✓' : ' ✗'}
                  </span>
                </div>
              ))}
            </dl>
            <h3>Ventas por mes, al centavo</h3>
            <dl className="datos" data-prueba="restauracion-ventas-por-mes">
              {verificacion.ventasPorMes.length === 0 && (
                <div className="dato">
                  <span className="dato__etiqueta">sin ventas</span>
                </div>
              )}
              {verificacion.ventasPorMes.map((mes) => (
                <div className="dato" key={mes.mes}>
                  <span className="dato__etiqueta">{mes.mes}</span>
                  <span className="dato__valor">
                    nube Q{mes.nube} · acá Q{mes.local}
                    {mes.excluidas !== '0.00' && ` · excluidas Q${mes.excluidas}`}
                    {mes.coincide ? ' ✓' : ' ✗'}
                  </span>
                </div>
              ))}
            </dl>
            {!verificacion.ok && (
              <p className="alerta">
                {verificacion.detalle.join('. ')}. La restauración no se da por buena así: cancelá y retomá, o revisá la
                nube.
              </p>
            )}
          </>
        )}
        {progreso.fotos !== null && progreso.fotos.faltantes.length > 0 && (
          <p className="advertencia" data-prueba="restauracion-fotos-faltantes">
            {String(progreso.fotos.faltantes.length)} foto(s) que la nube no tiene; esos productos quedan sin foto, que
            es su estado normal: {progreso.fotos.faltantes.join(', ')}
          </p>
        )}
      </section>

      {progreso.motivo === 'robo' && (
        <section className="tarjeta" data-prueba="restauracion-anomalias">
          <h2>Lo que la nube recibió después del robo ({fechaLegible(progreso.fechaDelRobo)})</h2>
          {progreso.anomalias.length === 0 && <p>Nada. La nube no recibió nada después de esa hora.</p>}
          {excluidas.length > 0 && (
            <>
              <h3>Excluidas: NO se restauraron</h3>
              <p className="subtitulo">
                Son de tablas que la nube solo permite insertar, así que llegaron después del robo. Si alguna es
                legítima, restaurala igual; una venta se restaura con sus líneas y su recibo.
              </p>
              <ul className="lista">
                {excluidas.map((anomalia) => (
                  <li key={`${anomalia.tabla}/${anomalia.id}`} className="lista__fila" data-prueba="restauracion-excluida">
                    <div className="lista__principal">
                      <span className="lista__detalle">{descripcion(anomalia)}</span>
                    </div>
                    <div className="lista__acciones">
                      <button
                        type="button"
                        className="boton--secundario"
                        disabled={trabajando}
                        data-prueba="restauracion-aceptar-excluida"
                        onClick={() => {
                          void accion(() => window.pos.restauracion.aceptarExcluida({ tabla: anomalia.tabla, id: anomalia.id }));
                        }}
                      >
                        Restaurar igual
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {restauradasYListadas.length > 0 && (
            <>
              <h3>Restauradas, para revisar</h3>
              <p className="subtitulo">
                Filas tocadas después del robo en tablas que la nube también actualiza. No se pueden excluir sin romper
                lo legítimo que las referencia; revisalas después desde la aplicación.
              </p>
              <ul className="lista">
                {restauradasYListadas.map((anomalia) => (
                  <li key={`${anomalia.tabla}/${anomalia.id}`} className="lista__fila" data-prueba="restauracion-anomalia">
                    <span className="lista__detalle">{descripcion(anomalia)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {aceptadas.length > 0 && (
            <p className="subtitulo">Restauradas a mano: {aceptadas.map((a) => `${nombreDeTabla(a.tabla)} ${a.resumen}`).join('; ')}.</p>
          )}
        </section>
      )}

      <section className="tarjeta" data-prueba="restauracion-usuarios">
        <h2>Usuarios: revisión y PIN nuevo</h2>
        <p className="subtitulo">
          Ninguno tiene PIN todavía. Cada usuario activo necesita uno nuevo antes de terminar.
          {usuariosAnomalos.length > 0 && ' Los marcados tienen cambios posteriores al robo y hay que revisarlos uno por uno.'}
        </p>
        <ul className="lista">
          {progreso.usuarios.map((usuario) => (
            <li
              key={usuario.id}
              className={usuario.activo ? 'lista__fila' : 'lista__fila lista__fila--inactiva'}
              data-prueba="restauracion-usuario"
              data-usuario={usuario.id}
            >
              <div className="lista__principal">
                <span className="lista__nombre">{usuario.nombre}</span>
                <span className="lista__detalle">
                  {usuario.rol}
                  {!usuario.activo && ' · de baja'}
                  {usuario.sinPin ? ' · SIN PIN' : ' · PIN asignado'}
                  {usuario.anomalo && (usuario.revisado ? ' · revisado' : ' · CAMBIÓ DESPUÉS DEL ROBO: revisar')}
                </span>
              </div>
              <div className="lista__acciones">
                {usuario.anomalo && !usuario.revisado && (
                  <RevisionDeUsuario
                    usuario={usuario}
                    deshabilitado={trabajando}
                    alDecidir={(rol, activo) => {
                      void accion(() => window.pos.restauracion.revisarUsuario({ id: usuario.id, rol, activo }));
                    }}
                  />
                )}
                <button
                  type="button"
                  disabled={trabajando}
                  data-prueba="restauracion-asignar-pin"
                  onClick={() => {
                    setPin('');
                    setUsuarioParaPin(usuario);
                  }}
                >
                  {usuario.sinPin ? 'Asignar PIN' : 'Cambiar PIN'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="acciones">
        <button
          type="button"
          disabled={trabajando}
          data-prueba="restauracion-terminar"
          onClick={() => {
            void accion(() => window.pos.restauracion.terminar());
          }}
        >
          Terminar la restauración
        </button>
        <button
          type="button"
          className="boton--secundario"
          disabled={trabajando}
          onClick={() => {
            void accion(() => window.pos.restauracion.cancelar());
          }}
        >
          Dejarla para después
        </button>
      </div>
    </div>
  );
}

/** La decisión sobre un usuario anómalo: rol y si sigue activo. */
function RevisionDeUsuario({
  usuario,
  deshabilitado,
  alDecidir,
}: {
  readonly usuario: UsuarioRestauradoIpc;
  readonly deshabilitado: boolean;
  readonly alDecidir: (rol: RolIpc, activo: boolean) => void;
}): React.JSX.Element {
  const [rol, setRol] = useState<RolIpc>(usuario.rol);
  const [activo, setActivo] = useState(usuario.activo);
  return (
    <span className="acciones" data-prueba="restauracion-revision">
      <select
        value={rol}
        disabled={deshabilitado}
        onChange={(evento) => {
          setRol(evento.target.value === 'administrativo' ? 'administrativo' : 'venta');
        }}
      >
        <option value="venta">venta</option>
        <option value="administrativo">administrativo</option>
      </select>
      <label className="opcion">
        <input
          type="checkbox"
          checked={activo}
          disabled={deshabilitado}
          onChange={(evento) => {
            setActivo(evento.target.checked);
          }}
        />
        activo
      </label>
      <button
        type="button"
        className="boton--secundario"
        disabled={deshabilitado}
        data-prueba="restauracion-confirmar-revision"
        onClick={() => {
          alDecidir(rol, activo);
        }}
      >
        Confirmar revisión
      </button>
    </span>
  );
}
