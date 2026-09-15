/**
 * «Historial de cajas»: todas las sesiones de caja, para auditar (§4.44).
 *
 * LA PANTALLA NO CALCULA NADA. Cada monto, cada «faltante» y cada nombre llegan
 * resueltos del proceso principal, que los lee de lo que el cierre guardó. Acá
 * solo se eligen filtros y se muestra.
 *
 * Lo que más importa mostrar es lo que un corte limpio escondería: la caja que
 * cerró otra persona, la diferencia que alguien autorizó por teléfono, y sobre
 * todo el conteo que se selló con diferencia y después se corrigió (§4.39). Por
 * eso esos tres casos llevan su propia etiqueta en la lista, sin tener que
 * abrir el detalle para enterarse.
 *
 * Solo es alcanzable con rol administrativo, pero eso no lo decide ella: el
 * proceso principal rechaza los dos canales con `requiereRol`.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  DesgloseEnHistorialIpc,
  DetalleDeSesionDeCajaIpc,
  HistorialDeCajasIpc,
  SesionDeCajaEnHistorialIpc,
} from '@shared/types/ipc';
import { llamarAlProcesoPrincipal } from './llamar-al-proceso-principal';

const MENSAJE_SIN_RESPUESTA =
  'El sistema no respondió. Volvé al menú y entrá de nuevo a «Historial de cajas».';

/**
 * Las fechas se muestran en hora de GUATEMALA, que es la del filtro: si se
 * mostraran en la hora de la máquina, una caja abierta a las 23:30 podría
 * aparecer con otro día que el que la filtra.
 */
function fechaYHora(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? iso
    : fecha.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Guatemala' });
}

function quetzales(monto: string): string {
  return `Q${monto}`;
}

/** Un monto que puede ser negativo: «−Q20.00» y no «Q-20.00». */
function quetzalesConSigno(monto: string): string {
  return monto.startsWith('-') ? `−Q${monto.slice(1)}` : `Q${monto}`;
}

/** «faltante de Q20.00», «sobrante de Q5.00» o «cuadra». */
function diferenciaLegible(sesion: SesionDeCajaEnHistorialIpc): string {
  const cierre = sesion.cierre;
  if (cierre === null) {
    return '';
  }
  if (cierre.tipoDeDiferencia === 'cuadra') {
    return 'cuadra';
  }
  const sinSigno = cierre.diferencia.replace(/^-/u, '');
  return `${cierre.tipoDeDiferencia} de ${quetzales(sinSigno)}`;
}

function via(valor: 'presencial' | 'remoto' | null): string {
  return valor === 'remoto' ? 'por teléfono (PIN remoto)' : valor === 'presencial' ? 'en persona' : 'vía desconocida';
}

export function PantallaDeHistorialDeCajas({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [abiertaPor, setAbiertaPor] = useState('');
  const [historial, setHistorial] = useState<HistorialDeCajasIpc | null>(null);
  const [detalle, setDetalle] = useState<DetalleDeSesionDeCajaIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  /** Pide la lista. Todo cambio de estado ocurre DESPUÉS de la respuesta. */
  const pedir = useCallback(
    async (filtro: { desde: string; hasta: string; abiertaPor: string }): Promise<void> => {
      const respuesta = await llamarAlProcesoPrincipal(
        () =>
          window.pos.historialDeCajas.listar({
            desde: filtro.desde === '' ? null : filtro.desde,
            hasta: filtro.hasta === '' ? null : filtro.hasta,
            abiertaPor: filtro.abiertaPor === '' ? null : filtro.abiertaPor,
          }),
        undefined,
        MENSAJE_SIN_RESPUESTA,
      );
      setCargando(false);
      if (respuesta.ok) {
        setMensaje(null);
        setHistorial(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
      }
    },
    [],
  );

  /** Lo que hacen los botones: marca la espera y después pide. */
  const consultar = useCallback(
    async (filtro: { desde: string; hasta: string; abiertaPor: string }): Promise<void> => {
      setCargando(true);
      await pedir(filtro);
    },
    [pedir],
  );

  useEffect(() => {
    void (async (): Promise<void> => {
      await pedir({ desde: '', hasta: '', abiertaPor: '' });
    })();
  }, [pedir]);

  const abrirDetalle = useCallback(async (id: string): Promise<void> => {
    setMensaje(null);
    const respuesta = await llamarAlProcesoPrincipal(
      () => window.pos.historialDeCajas.detalle(id),
      undefined,
      MENSAJE_SIN_RESPUESTA,
    );
    if (respuesta.ok) {
      setDetalle(respuesta.datos);
    } else {
      setMensaje(respuesta.error.mensaje);
    }
  }, []);

  const periodo = historial?.periodo ?? null;

  if (detalle !== null) {
    return (
      <VistaDeDetalle
        detalle={detalle}
        alVolverALaLista={() => {
          setDetalle(null);
        }}
      />
    );
  }

  return (
    <div data-prueba="pantalla-de-historial-de-cajas">
      <header className="encabezado">
        <h1>Historial de cajas</h1>
        <p className="subtitulo">
          Todas las sesiones de caja, de la más reciente a la más vieja. Tocá una para ver el detalle.
        </p>
      </header>

      <section className="tarjeta">
        <h2>Filtros</h2>
        <div className="filtros">
          <label className="campo">
            <span className="campo__etiqueta">Abiertas desde</span>
            <input
              type="date"
              value={desde}
              data-prueba="historial-desde"
              onChange={(evento) => {
                setDesde(evento.target.value);
              }}
            />
          </label>
          <label className="campo">
            <span className="campo__etiqueta">Hasta</span>
            <input
              type="date"
              value={hasta}
              data-prueba="historial-hasta"
              onChange={(evento) => {
                setHasta(evento.target.value);
              }}
            />
          </label>
          <label className="campo">
            <span className="campo__etiqueta">Abrió</span>
            <select
              value={abiertaPor}
              data-prueba="historial-abierta-por"
              onChange={(evento) => {
                setAbiertaPor(evento.target.value);
              }}
            >
              <option value="">Cualquier persona</option>
              {(historial?.personasQueAbrieron ?? []).map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="acciones">
          <button
            type="button"
            disabled={cargando}
            data-prueba="historial-aplicar"
            onClick={() => {
              void consultar({ desde, hasta, abiertaPor });
            }}
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            className="boton--secundario"
            disabled={cargando}
            data-prueba="historial-quitar-filtros"
            onClick={() => {
              setDesde('');
              setHasta('');
              setAbiertaPor('');
              void consultar({ desde: '', hasta: '', abiertaPor: '' });
            }}
          >
            Quitar filtros
          </button>
        </div>
        {periodo !== null && (
          <p className="subtitulo" data-prueba="historial-periodo">
            Aperturas del {periodo.etiqueta}
          </p>
        )}
      </section>

      {mensaje !== null && (
        <p className="alerta" data-prueba="historial-error">
          {mensaje}
        </p>
      )}

      <section className="tarjeta">
        {historial === null ? (
          <p className="pendiente">Consultando…</p>
        ) : historial.sesiones.length === 0 ? (
          <p data-prueba="historial-vacio">No hay sesiones de caja con estos filtros.</p>
        ) : (
          <ul className="lista" data-prueba="historial-lista">
            {historial.sesiones.map((sesion) => (
              <FilaDeHistorial
                key={sesion.id}
                sesion={sesion}
                alTocar={() => {
                  void abrirDetalle(sesion.id);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}

function FilaDeHistorial({
  sesion,
  alTocar,
}: {
  readonly sesion: SesionDeCajaEnHistorialIpc;
  readonly alTocar: () => void;
}): React.JSX.Element {
  const { cierre, reconteo } = sesion;
  const autorizacion = cierre?.diferenciaAutorizada ?? null;
  return (
    <li className="lista__fila" data-prueba="historial-fila" data-id={sesion.id} data-estado={sesion.estado}>
      <div className="lista__principal">
        <span className="lista__nombre">
          Abrió {sesion.abiertaPor.nombre} · {fechaYHora(sesion.abiertaEn)} · inicial {quetzales(sesion.montoInicial)}
        </span>
        {sesion.estado === 'abierta' ? (
          <span className="etiqueta" data-prueba="historial-etiqueta-abierta">Abierta</span>
        ) : null}
        {cierre !== null && (
          <span className="lista__detalle" data-prueba="historial-cierre">
            Cerró {cierre.cerradaPor.nombre}
            {cierre.cerradaPorOtraPersona ? ' (otra persona)' : ''} · {fechaYHora(cierre.cerradaEn)} · teórico{' '}
            {quetzales(cierre.montoTeorico)} · real {quetzales(cierre.montoReal)} · {diferenciaLegible(sesion)}
          </span>
        )}
        {cierre?.cerradaPorOtraPersona === true && (
          <span className="etiqueta" data-prueba="historial-etiqueta-ajena">Cerrada por otra persona</span>
        )}
        {autorizacion !== null && (
          <span className="lista__detalle" data-prueba="historial-autorizacion">
            Diferencia autorizada por {autorizacion.por.nombre}, {via(autorizacion.via)}
          </span>
        )}
        {reconteo !== null && (
          <span className="etiqueta" data-prueba="historial-etiqueta-reconteo">
            Recuento corregido: contó {quetzales(reconteo.conteosSellados[0]?.montoReal ?? '?')}, cerró con{' '}
            {quetzales(reconteo.conteoFinal.montoReal)} · autorizó {reconteo.autorizadoPor?.nombre ?? 'nadie registrado'},{' '}
            {via(reconteo.via)}
          </span>
        )}
        {sesion.estado === 'abierta' && sesion.cantidadDeConteosSellados > 0 && (
          <span className="lista__detalle" data-prueba="historial-sellos-pendientes">
            {sesion.cantidadDeConteosSellados === 1
              ? 'Tiene un conteo con diferencia ya registrado'
              : `Tiene ${String(sesion.cantidadDeConteosSellados)} conteos con diferencia ya registrados`}
          </span>
        )}
        {sesion.avisos.map((aviso) => (
          <span key={aviso} className="advertencia" data-prueba="historial-aviso">
            {aviso}
          </span>
        ))}
      </div>
      <div className="lista__acciones">
        <button type="button" className="boton--secundario" data-prueba="historial-ver" onClick={alTocar}>
          Ver detalle
        </button>
      </div>
    </li>
  );
}

function TablaDeDesglose({
  titulo,
  desglose,
  prueba,
}: {
  readonly titulo: string;
  readonly desglose: DesgloseEnHistorialIpc | null;
  readonly prueba: string;
}): React.JSX.Element {
  return (
    <section className="tarjeta" data-prueba={prueba}>
      <h2>{titulo}</h2>
      {desglose === null ? (
        <p className="subtitulo">Se contó escribiendo el total, sin desglose por denominación.</p>
      ) : (
        <dl className="datos">
          {desglose.lineas.map((linea) => (
            <div key={linea.valor} style={{ display: 'contents' }}>
              <dt>
                {linea.tipo === 'billete' ? 'Billete' : 'Moneda'} de {quetzales(linea.valor)}
              </dt>
              <dd>
                {linea.cantidad} × {quetzales(linea.valor)} = {quetzales(linea.subtotal)}
              </dd>
            </div>
          ))}
          <dt>
            <strong>Total</strong>
          </dt>
          <dd data-prueba={`${prueba}-total`}>
            <strong>{quetzales(desglose.total)}</strong>
          </dd>
        </dl>
      )}
    </section>
  );
}

function VistaDeDetalle({
  detalle,
  alVolverALaLista,
}: {
  readonly detalle: DetalleDeSesionDeCajaIpc;
  readonly alVolverALaLista: () => void;
}): React.JSX.Element {
  const { sesion, conteosSellados } = detalle;
  const { cierre, reconteo } = sesion;
  return (
    <div data-prueba="historial-detalle" data-id={sesion.id}>
      <header className="encabezado">
        <h1>Sesión de caja</h1>
        <p className="subtitulo">
          {sesion.estado === 'abierta' ? 'Abierta' : 'Cerrada'} · abrió {sesion.abiertaPor.nombre} el{' '}
          {fechaYHora(sesion.abiertaEn)}
        </p>
      </header>

      {sesion.avisos.map((aviso) => (
        <p key={aviso} className="advertencia" data-prueba="detalle-aviso">
          {aviso}
        </p>
      ))}

      <section className="tarjeta" data-prueba="detalle-resumen">
        <h2>Apertura y cierre</h2>
        <dl className="datos">
          <dt>Abrió</dt>
          <dd>{sesion.abiertaPor.nombre}</dd>
          <dt>Abierta el</dt>
          <dd>{fechaYHora(sesion.abiertaEn)}</dd>
          <dt>Monto inicial</dt>
          <dd>{quetzales(sesion.montoInicial)}</dd>
          {cierre === null ? (
            <>
              <dt>Estado</dt>
              <dd>Todavía abierta</dd>
            </>
          ) : (
            <>
              <dt>Cerró</dt>
              <dd data-prueba="detalle-cerro">
                {cierre.cerradaPor.nombre}
                {cierre.cerradaPorOtraPersona ? ' — otra persona, no quien abrió' : ''}
              </dd>
              {cierre.cerradaPorOtraPersona && (
                <>
                  <dt>Cierre ajeno autorizado por</dt>
                  <dd data-prueba="detalle-cierre-ajeno">
                    {cierre.cierreAjenoAutorizadoPor?.nombre ?? 'no quedó registrado'}
                  </dd>
                </>
              )}
              <dt>Cerrada el</dt>
              <dd>{fechaYHora(cierre.cerradaEn)}</dd>
              <dt>Monto teórico</dt>
              <dd data-prueba="detalle-teorico">{quetzales(cierre.montoTeorico)}</dd>
              <dt>Monto real contado</dt>
              <dd data-prueba="detalle-real">{quetzales(cierre.montoReal)}</dd>
              <dt>Diferencia</dt>
              <dd data-prueba="detalle-diferencia">
                {quetzalesConSigno(cierre.diferencia)} ({diferenciaLegible(sesion)})
              </dd>
              {cierre.diferenciaAutorizada !== null && (
                <>
                  <dt>Diferencia autorizada por</dt>
                  <dd data-prueba="detalle-autorizacion">
                    {cierre.diferenciaAutorizada.por.nombre}, {via(cierre.diferenciaAutorizada.via)}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
      </section>

      {reconteo !== null && (
        <section className="alerta" data-prueba="detalle-reconteo">
          <h2>Se corrigió un conteo que tenía diferencia</h2>
          <p>
            Antes de cerrar se confirmó un conteo con diferencia, y el cierre se hizo con otro número. La
            corrección la autorizó <strong>{reconteo.autorizadoPor?.nombre ?? 'nadie registrado'}</strong>,{' '}
            {via(reconteo.via)} ({fechaYHora(reconteo.fecha)}).
          </p>
          <ul>
            {reconteo.conteosSellados.map((conteo, indice) => (
              <li key={`${conteo.fecha}-${String(indice)}`} data-prueba="detalle-reconteo-sellado">
                {indice === 0 ? 'Primer conteo' : `Conteo ${String(indice + 1)}`}: {quetzales(conteo.montoReal)} contra{' '}
                {quetzales(conteo.montoEsperado)} teórico, diferencia {quetzalesConSigno(conteo.diferencia)}
                {conteo.fecha === '' ? '' : ` (${fechaYHora(conteo.fecha)})`}
              </li>
            ))}
            <li data-prueba="detalle-reconteo-final">
              Conteo final: {quetzales(reconteo.conteoFinal.montoReal)} contra{' '}
              {quetzales(reconteo.conteoFinal.montoEsperado)} teórico, diferencia{' '}
              {quetzalesConSigno(reconteo.conteoFinal.diferencia)}
            </li>
          </ul>
        </section>
      )}

      <section className="tarjeta" data-prueba="detalle-sellos">
        <h2>Conteos confirmados con diferencia</h2>
        {conteosSellados.length === 0 ? (
          <p className="subtitulo">Ninguno: no se confirmó ningún conteo con diferencia en esta sesión.</p>
        ) : (
          <ul>
            {conteosSellados.map((conteo, indice) => (
              <li key={`${conteo.fecha}-${String(indice)}`} data-prueba="detalle-sello">
                {fechaYHora(conteo.fecha)}: contó {quetzales(conteo.montoReal)}, teórico {quetzales(conteo.montoEsperado)},
                diferencia {quetzalesConSigno(conteo.diferencia)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <TablaDeDesglose titulo="Desglose de apertura" desglose={detalle.desgloseDeApertura} prueba="detalle-desglose-apertura" />
      {cierre !== null && (
        <TablaDeDesglose titulo="Desglose de cierre" desglose={detalle.desgloseDeCierre} prueba="detalle-desglose-cierre" />
      )}

      <div className="pie">
        <button type="button" className="boton--secundario" data-prueba="detalle-volver" onClick={alVolverALaLista}>
          Volver a la lista
        </button>
      </div>
    </div>
  );
}
