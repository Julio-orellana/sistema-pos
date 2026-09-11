/**
 * Los datos de la tienda que encabezan el recibo.
 *
 * Es la pantalla más chica del sistema y aun así importa: es lo que un cliente
 * lee arriba de su comprobante. Mientras los campos estén vacíos, el recibo
 * imprime marcadores entre corchetes —«[Nombre del negocio]»— y esta pantalla
 * lo dice, para que nadie descubra el hueco recién al entregar un papel.
 *
 * LOS CUATRO CAMPOS SON OPCIONALES, a propósito: los datos reales de Jimmy
 * todavía no llegaron y tiene que poder cargarse el nombre sin saber el NIT.
 * Un campo vacío se guarda como «sin configurar», no como texto en blanco.
 *
 * Solo es alcanzable con rol administrativo, pero eso no lo decide ella: el
 * proceso principal rechaza cada canal con `requiereRol`.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ConfiguracionDeNegocioIpc } from '@shared/types/ipc';

/** Lo que se muestra en el recibo cuando un campo sigue vacío. */
const MARCADORES: Record<keyof ConfiguracionDeNegocioIpc, string> = {
  nombreComercial: '[Nombre del negocio]',
  direccion: '[Dirección]',
  telefono: '[Teléfono]',
  nit: '[NIT]',
};

/** Los cuatro campos, con su etiqueta y su largo máximo. */
const CAMPOS = [
  { clave: 'nombreComercial', etiqueta: 'Nombre comercial', largo: 80 },
  { clave: 'direccion', etiqueta: 'Dirección', largo: 160 },
  { clave: 'telefono', etiqueta: 'Teléfono', largo: 40 },
  { clave: 'nit', etiqueta: 'NIT', largo: 20 },
] as const;

const VACIA: ConfiguracionDeNegocioIpc = {
  nombreComercial: null,
  direccion: null,
  telefono: null,
  nit: null,
};

export function PantallaDeNegocio({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [borrador, setBorrador] = useState<ConfiguracionDeNegocioIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.negocio.obtener();
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setBorrador(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
        setBorrador(VACIA);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, []);

  const guardar = useCallback((): void => {
    if (borrador === null) {
      return;
    }
    setTrabajando(true);
    void (async (): Promise<void> => {
      // Un campo en blanco viaja como `null`: «sin configurar» y «texto vacío»
      // tienen que ser el mismo estado, o el recibo tendría que conocer los dos
      // para decidir si pone el marcador.
      const respuesta = await window.pos.negocio.guardar({
        nombreComercial: vacioANulo(borrador.nombreComercial),
        direccion: vacioANulo(borrador.direccion),
        telefono: vacioANulo(borrador.telefono),
        nit: vacioANulo(borrador.nit),
      });
      setTrabajando(false);

      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setBorrador(respuesta.datos);
      setAviso('Guardado. Los recibos nuevos ya salen con estos datos.');
    })();
  }, [borrador]);

  if (borrador === null) {
    return (
      <div data-prueba="pantalla-de-negocio">
        <p className="pendiente">Consultando los datos del negocio…</p>
      </div>
    );
  }

  const faltantes = CAMPOS.filter((campo) => vacioANulo(borrador[campo.clave]) === null);

  return (
    <div data-prueba="pantalla-de-negocio">
      <header className="encabezado">
        <h1>Datos del negocio</h1>
        <p className="subtitulo">
          Es lo que encabeza el recibo que se le entrega al cliente. Se puede cargar por partes:
          lo que quede vacío sale como un marcador entre corchetes, nunca como un dato inventado.
        </p>
      </header>

      {mensaje !== null && (
        <p className="alerta" data-prueba="negocio-error">
          {mensaje}
        </p>
      )}
      {aviso !== null && (
        <p className="aviso-exito" data-prueba="negocio-aviso">
          {aviso}
        </p>
      )}

      {faltantes.length > 0 && (
        <p className="advertencia" data-prueba="negocio-faltantes">
          El recibo va a mostrar{' '}
          {faltantes.map((campo) => MARCADORES[campo.clave]).join(', ')} hasta que se carguen
          esos datos.
        </p>
      )}

      <section className="tarjeta">
        {CAMPOS.map((campo) => (
          <label className="campo" key={campo.clave}>
            <span className="campo__etiqueta">{campo.etiqueta}</span>
            <input
              type="text"
              value={borrador[campo.clave] ?? ''}
              maxLength={campo.largo}
              data-prueba={`negocio-${campo.clave}`}
              onChange={(evento) => {
                setAviso(null);
                setBorrador((anterior) =>
                  anterior === null ? anterior : { ...anterior, [campo.clave]: evento.target.value },
                );
              }}
            />
          </label>
        ))}

        <div className="acciones">
          <button
            type="button"
            disabled={trabajando}
            data-prueba="negocio-guardar"
            onClick={guardar}
          >
            Guardar
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

/** Un campo en blanco es «sin configurar», que se representa con `null`. */
function vacioANulo(valor: string | null): string | null {
  const limpio = (valor ?? '').trim();
  return limpio === '' ? null : limpio;
}
