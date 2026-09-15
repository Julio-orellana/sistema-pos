/**
 * «Impresora de recibos»: elegir la térmica de esta terminal, probarla y
 * quitarla (§4.43).
 *
 * LA IMPRESORA ES OPCIONAL. El PDF del recibo se genera siempre (§4, punto 8);
 * esta pantalla solo decide si además sale en papel.
 *
 * ===========================================================================
 * EL TICKET DE PRUEBA LO JUZGA UNA PERSONA
 * ===========================================================================
 *
 * Una térmica ESC/POS no le contesta nada a la computadora. Lo único que se
 * sabe es si Windows aceptó el trabajo. Por eso, cuando el envío sale bien, la
 * pantalla pregunta qué salió en el papel, con tres respuestas. «Salió con
 * símbolos raros o sin cortar» queda guardada como señal de que el modelo
 * podría no entender los comandos, que es un problema distinto de no poder
 * conectarse.
 *
 * Solo es alcanzable con rol administrativo, pero eso no lo decide ella: el
 * proceso principal rechaza los seis canales con `requiereRol`.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  EstadoDeImpresoraIpc,
  ImpresoraDelSistemaIpc,
  ResultadoDeConfirmacionIpc,
  ResultadoDePruebaDeImpresoraIpc,
} from '@shared/types/ipc';
import { llamarAlProcesoPrincipal } from './llamar-al-proceso-principal';

/**
 * Cuánto se espera el ticket de prueba. PowerShell tiene su propio límite de
 * 12 s en el proceso principal; este va por encima para que ese límite, que
 * dice qué pasó, llegue antes que este, que no lo sabe.
 */
const LIMITE_DE_LA_PRUEBA_MS = 30_000;

const MENSAJE_SIN_RESPUESTA_DE_IMPRESORA =
  'El sistema no respondió y no se sabe si la operación se completó. Volvé al menú y entrá de nuevo a «Impresora de recibos» para ver cómo quedó.';

const TEXTO_DEL_ENVIO: Readonly<Record<string, string>> = {
  enviado: 'Windows aceptó el ticket',
  no_encontrada: 'no se encontró la impresora',
  no_se_pudo_enviar: 'no se pudo conectar',
  trabajo_con_error: 'la impresora reportó un problema',
  entorno: 'esta computadora no pudo enviarlo',
};

const TEXTO_DE_LA_CONFIRMACION: Readonly<Record<ResultadoDeConfirmacionIpc, string>> = {
  bien: 'salió bien',
  ilegible: 'salió con símbolos raros o sin cortar',
  nada: 'no salió nada',
};

function fechaLegible(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString();
}

export function PantallaDeImpresora({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoDeImpresoraIpc | null>(null);
  const [impresoras, setImpresoras] = useState<readonly ImpresoraDelSistemaIpc[] | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDePruebaDeImpresoraIpc | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const leerEstado = useCallback(async (): Promise<EstadoDeImpresoraIpc | null> => {
    const respuesta = await llamarAlProcesoPrincipal(
      () => window.pos.impresora.estado(),
      undefined,
      MENSAJE_SIN_RESPUESTA_DE_IMPRESORA,
    );
    if (!respuesta.ok) {
      setMensaje(respuesta.error.mensaje);
      return null;
    }
    setEstado(respuesta.datos);
    return respuesta.datos;
  }, []);

  const buscarImpresoras = useCallback(async (configurada: string | null): Promise<void> => {
    const respuesta = await llamarAlProcesoPrincipal(
      () => window.pos.impresora.listar(),
      undefined,
      MENSAJE_SIN_RESPUESTA_DE_IMPRESORA,
    );
    if (!respuesta.ok) {
      setMensaje(respuesta.error.mensaje);
      setImpresoras([]);
      return;
    }
    setImpresoras(respuesta.datos);
    // Se marca la configurada solo si sigue instalada: marcar una que ya no
    // está invitaría a probar algo que no existe.
    setElegida((actual) => actual ?? (respuesta.datos.some((i) => i.nombre === configurada) ? configurada : null));
  }, []);

  useEffect(() => {
    void (async (): Promise<void> => {
      const leido = await leerEstado();
      await buscarImpresoras(leido?.tipo === 'cola' ? leido.nombre : null);
    })();
  }, [leerEstado, buscarImpresoras]);

  const imprimirPrueba = useCallback(async (): Promise<void> => {
    setMensaje(null);
    setAviso(null);
    setResultado(null);
    if (elegida === null) {
      setMensaje('Primero elegí una impresora de la lista. Sin impresora elegida no hay adónde mandar el ticket de prueba.');
      return;
    }
    setTrabajando('prueba');
    const respuesta = await llamarAlProcesoPrincipal(
      () => window.pos.impresora.imprimirPrueba(elegida),
      LIMITE_DE_LA_PRUEBA_MS,
      MENSAJE_SIN_RESPUESTA_DE_IMPRESORA,
    );
    setTrabajando(null);
    if (respuesta.ok) {
      setResultado(respuesta.datos);
    } else {
      setMensaje(respuesta.error.mensaje);
    }
    await leerEstado();
  }, [elegida, leerEstado]);

  const confirmar = useCallback(
    async (contestacion: ResultadoDeConfirmacionIpc): Promise<void> => {
      const pruebaId = resultado?.pruebaId ?? null;
      if (pruebaId === null) {
        return;
      }
      setTrabajando('confirmar');
      const respuesta = await llamarAlProcesoPrincipal(
        () => window.pos.impresora.confirmarPrueba({ pruebaId, resultado: contestacion }),
        undefined,
        MENSAJE_SIN_RESPUESTA_DE_IMPRESORA,
      );
      setTrabajando(null);
      if (respuesta.ok) {
        setResultado(null);
        setAviso(respuesta.datos.mensaje);
        setEstado(respuesta.datos.estado);
      } else {
        setMensaje(respuesta.error.mensaje);
      }
    },
    [resultado],
  );

  const guardar = useCallback(async (): Promise<void> => {
    if (elegida === null) {
      return;
    }
    setMensaje(null);
    setAviso(null);
    setTrabajando('guardar');
    const respuesta = await llamarAlProcesoPrincipal(
      () => window.pos.impresora.guardar(elegida),
      undefined,
      MENSAJE_SIN_RESPUESTA_DE_IMPRESORA,
    );
    setTrabajando(null);
    if (respuesta.ok) {
      setEstado(respuesta.datos);
      setAviso('Listo: los recibos nuevos se van a imprimir en esta impresora, además del PDF.');
    } else {
      setMensaje(respuesta.error.mensaje);
    }
  }, [elegida]);

  const quitar = useCallback(async (): Promise<void> => {
    setMensaje(null);
    setAviso(null);
    setResultado(null);
    setTrabajando('quitar');
    const respuesta = await llamarAlProcesoPrincipal(
      () => window.pos.impresora.quitar(),
      undefined,
      MENSAJE_SIN_RESPUESTA_DE_IMPRESORA,
    );
    setTrabajando(null);
    if (respuesta.ok) {
      setEstado(respuesta.datos);
      setElegida(null);
      setAviso('Se quitó la impresora. Los recibos se siguen generando en PDF, como siempre.');
    } else {
      setMensaje(respuesta.error.mensaje);
    }
  }, []);

  const hayImpresora = estado !== null && estado.tipo !== 'ninguna';
  const ultimaPrueba = estado?.ultimaPrueba ?? null;
  const yaEsLaConfigurada = estado?.tipo === 'cola' && estado.nombre === elegida;
  const ocupada = trabajando !== null;

  return (
    <div data-prueba="pantalla-de-impresora">
      <header className="encabezado">
        <h1>Impresora de recibos</h1>
        <p className="subtitulo">
          El recibo se guarda siempre en PDF. Si hay una impresora térmica instalada en Windows, acá
          se elige para que además salga en papel.
        </p>
      </header>

      <section className="tarjeta">
        <h2>Estado</h2>
        {estado === null ? (
          <p className="pendiente">Consultando…</p>
        ) : (
          <p data-prueba="impresora-descripcion">
            <strong>{estado.descripcion}</strong>
          </p>
        )}
        {estado?.tipo === 'ruta' && (
          <p className="advertencia" data-prueba="impresora-formato-viejo">
            Esta configuración es de una versión anterior y nunca se probó en una impresora real.
            Elegí la impresora de la lista y guardala.
          </p>
        )}
        {ultimaPrueba !== null && (
          <p className="subtitulo" data-prueba="impresora-ultima-prueba">
            Última prueba: {fechaLegible(ultimaPrueba.fecha)}, en «{ultimaPrueba.impresora}»:{' '}
            {TEXTO_DEL_ENVIO[ultimaPrueba.envio] ?? ultimaPrueba.envio}
            {ultimaPrueba.confirmacion !== null &&
              `, y según quien la miró ${TEXTO_DE_LA_CONFIRMACION[ultimaPrueba.confirmacion]}`}
            .
          </p>
        )}
      </section>

      {mensaje !== null && (
        <p className="alerta" data-prueba="impresora-error">
          {mensaje}
        </p>
      )}
      {aviso !== null && (
        <p className="aviso-exito" data-prueba="impresora-aviso">
          {aviso}
        </p>
      )}

      <section className="tarjeta">
        <h2>Impresoras instaladas en esta computadora</h2>
        {impresoras === null ? (
          <p className="pendiente">Buscando…</p>
        ) : impresoras.length === 0 ? (
          <p className="advertencia" data-prueba="impresora-lista-vacia">
            Windows no tiene ninguna impresora instalada. Hay que instalarla primero en Windows y
            después volver a buscar.
          </p>
        ) : (
          <div className="opciones" role="radiogroup" aria-label="Impresoras instaladas">
            {impresoras.map((impresora) => (
              <button
                key={impresora.nombre}
                type="button"
                role="radio"
                aria-checked={elegida === impresora.nombre}
                className={elegida === impresora.nombre ? 'opcion opcion--activa' : 'opcion'}
                data-prueba="impresora-opcion"
                data-nombre={impresora.nombre}
                onClick={() => {
                  setElegida(impresora.nombre);
                  setResultado(null);
                }}
              >
                {impresora.nombreVisible}
              </button>
            ))}
          </div>
        )}

        <div className="acciones">
          <button
            type="button"
            className="boton--secundario"
            disabled={ocupada}
            data-prueba="impresora-buscar"
            onClick={() => {
              setMensaje(null);
              setImpresoras(null);
              void buscarImpresoras(estado?.tipo === 'cola' ? estado.nombre : null);
            }}
          >
            Volver a buscar
          </button>
          <button
            type="button"
            disabled={ocupada}
            data-prueba="impresora-probar"
            onClick={() => {
              void imprimirPrueba();
            }}
          >
            {trabajando === 'prueba' ? 'Enviando…' : 'Imprimir recibo de prueba'}
          </button>
          <button
            type="button"
            disabled={ocupada || elegida === null || yaEsLaConfigurada}
            data-prueba="impresora-guardar"
            onClick={() => {
              void guardar();
            }}
          >
            {yaEsLaConfigurada ? 'Es la impresora configurada' : 'Usar esta impresora'}
          </button>
        </div>
      </section>

      {resultado !== null && (
        <section
          className={resultado.clase === 'enviado' ? 'tarjeta' : 'alerta'}
          data-prueba="impresora-resultado"
          data-clase={resultado.clase}
        >
          <h2 data-prueba="impresora-resultado-titulo">{resultado.titulo}</h2>
          <p data-prueba="impresora-resultado-mensaje">{resultado.mensaje}</p>
          {resultado.detalle !== null && (
            <details>
              <summary>Detalle técnico</summary>
              <pre data-prueba="impresora-resultado-detalle">{resultado.detalle}</pre>
            </details>
          )}
          {resultado.pruebaId !== null && (
            <div data-prueba="impresora-confirmacion">
              <p>
                <strong>¿Cómo salió el ticket?</strong>
              </p>
              <div className="acciones">
                <button
                  type="button"
                  disabled={ocupada}
                  data-prueba="impresora-confirmar-bien"
                  onClick={() => {
                    void confirmar('bien');
                  }}
                >
                  Sí, salió bien
                </button>
                <button
                  type="button"
                  className="boton--secundario"
                  disabled={ocupada}
                  data-prueba="impresora-confirmar-ilegible"
                  onClick={() => {
                    void confirmar('ilegible');
                  }}
                >
                  Salió con símbolos raros o sin cortar
                </button>
                <button
                  type="button"
                  className="boton--secundario"
                  disabled={ocupada}
                  data-prueba="impresora-confirmar-nada"
                  onClick={() => {
                    void confirmar('nada');
                  }}
                >
                  No salió nada
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {hayImpresora && (
        <section className="tarjeta">
          <h2>Quitar la impresora</h2>
          <p className="subtitulo">
            Los recibos van a quedar solo en PDF. No se borra ningún recibo ni ningún PDF.
          </p>
          <div className="acciones">
            <button
              type="button"
              className="boton--secundario"
              disabled={ocupada}
              data-prueba="impresora-quitar"
              onClick={() => {
                void quitar();
              }}
            >
              Quitar la impresora
            </button>
          </div>
        </section>
      )}

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}
