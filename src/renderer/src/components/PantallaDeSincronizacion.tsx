/**
 * Pantalla de sincronización: el tercer nivel de visibilidad de §3.3 del
 * diseño. Solo rol administrativo.
 *
 * Muestra el estado, cuántos cambios esperan por tabla, cuándo se subió algo
 * por última vez, y —si hay un lote detenido— su error TAL CUAL lo devolvió
 * la función de Postgres, con dos acciones: reintentarlo o saltarlo.
 *
 * ===========================================================================
 * «SALTAR ESTE LOTE» PIDE PIN, Y MUESTRA QUÉ SE VA A PERDER ANTES DE PEDIRLO
 * ===========================================================================
 *
 * Es el mismo criterio del cierre de caja descuadrado (CLAUDE.md §4.9): quien
 * autoriza tiene que VER qué está aprobando antes de teclear su código. Acá
 * ya lo está viendo —el error completo está en pantalla desde que se entró—
 * así que el paso de confirmación repite las tablas involucradas y pide el
 * PIN con el mismo teclado de siempre.
 */

import { useCallback, useEffect, useState } from 'react';

import type { DetalleDeSincronizacionIpc } from '@shared/types/ipc';
import { TecladoNumerico } from './TecladoNumerico';

/** Nombres de tabla a un texto más legible. Sin entrada, se muestra tal cual. */
const NOMBRES_DE_TABLA: Readonly<Record<string, string>> = {
  usuarios: 'usuarios',
  categorias: 'categorías',
  productos: 'productos',
  precios_especiales: 'precios especiales',
  limites_descuento: 'topes de descuento',
  configuracion_negocio: 'datos del negocio',
  caja_sesiones: 'turnos de caja',
  caja_sesion_denominaciones: 'arqueos de caja',
  ventas: 'ventas',
  venta_detalle: 'líneas de venta',
  recibos: 'recibos',
  anulaciones_de_venta: 'anulaciones de venta',
  auditoria_log: 'asientos de auditoría',
  archivo_foto: 'fotos de producto',
};

function nombreLegibleDeTabla(entidadTipo: string): string {
  return NOMBRES_DE_TABLA[entidadTipo] ?? entidadTipo;
}

/** Una fecha ISO, como la leería alguien parado en el mostrador. */
function fechaLegible(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString();
}

const TEXTO_DE_ESTADO: Readonly<Record<DetalleDeSincronizacionIpc['estado'], string>> = {
  detenida: 'Detenida',
  credencial_danada: 'Credencial dañada: esta aplicación no puede leerla. Volvé a conectar la terminal',
  sin_credencial: 'Sin conectar',
  pendientes_viejos: 'Con pendientes de más de 24 horas',
  sin_conexion: 'Sin conexión ahora mismo',
  problema_al_sincronizar: 'Problema al sincronizar: la nube contesta, pero la última subida falló',
  pendientes: 'Con pendientes',
  al_dia: 'Al día',
};

export function PantallaDeSincronizacion({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [detalle, setDetalle] = useState<DetalleDeSincronizacionIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [confirmandoSalto, setConfirmandoSalto] = useState(false);
  const [pin, setPin] = useState('');

  const releer = useCallback(async (): Promise<void> => {
    const respuesta = await window.pos.sincronizacion.detalle();
    if (respuesta.ok) {
      setDetalle(respuesta.datos);
    } else {
      setMensaje(respuesta.error.mensaje);
    }
  }, []);

  useEffect(() => {
    void (async (): Promise<void> => {
      await releer();
    })();
  }, [releer]);

  const reintentar = useCallback(
    async (loteId: string): Promise<void> => {
      setTrabajando(true);
      setMensaje(null);
      try {
        const respuesta = await window.pos.sincronizacion.reintentarLote({ loteId });
        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
        }
      } finally {
        setTrabajando(false);
        await releer();
      }
    },
    [releer],
  );

  const saltar = useCallback(
    async (loteId: string): Promise<void> => {
      setTrabajando(true);
      try {
        const respuesta = await window.pos.sincronizacion.saltarLote({ loteId, pin });
        if (respuesta.ok) {
          if (respuesta.datos.saltado) {
            setMensaje(respuesta.datos.mensaje);
            setConfirmandoSalto(false);
          } else {
            // PIN incorrecto o candado bloqueado: se queda en la pantalla de
            // confirmación para que se pueda reintentar sin volver a navegar.
            setMensaje(respuesta.datos.mensaje);
          }
        } else {
          setMensaje(respuesta.error.mensaje);
        }
      } finally {
        // Pase lo que pase, el PIN sale de la pantalla: es un mostrador, y un
        // error de tecleo no debe dejarlo escrito a la vista (mismo criterio
        // que PantallaDeNube con la contraseña).
        setPin('');
        setTrabajando(false);
        await releer();
      }
    },
    [pin, releer],
  );

  if (detalle === null) {
    return (
      <div data-prueba="pantalla-de-sincronizacion">
        <header className="encabezado">
          <h1>Sincronización</h1>
        </header>
        {mensaje !== null ? (
          <p className="alerta">{mensaje}</p>
        ) : (
          <p className="pendiente">Consultando…</p>
        )}
        <div className="pie">
          <button type="button" className="boton--secundario" onClick={alVolver}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  const loteBloqueante = detalle.loteBloqueante;

  if (confirmandoSalto && loteBloqueante !== null) {
    return (
      <div data-prueba="pantalla-de-sincronizacion">
        <header className="encabezado">
          <h1>Saltar este lote</h1>
          <p className="subtitulo">
            Esto deja un hueco DELIBERADO en el respaldo de la nube: los cambios de este lote
            nunca van a subir. Es la única forma legítima de hacerlo, y queda registrado en la
            auditoría con tu nombre.
          </p>
        </header>

        {mensaje !== null && (
          <p className="alerta" data-prueba="sincronizacion-error">
            {mensaje}
          </p>
        )}

        <div className="tarjeta" data-prueba="confirmacion-de-salto">
          <h2>Lo que se va a saltar</h2>
          <dl className="datos">
            <dt>Tablas</dt>
            <dd>{loteBloqueante.tablas.map(nombreLegibleDeTabla).join(', ')}</dd>
            <dt>Error de la nube</dt>
            <dd data-prueba="salto-error-original">{loteBloqueante.error}</dd>
          </dl>
        </div>

        <p className="subtitulo">Un administrador debe autorizar con su PIN, en persona.</p>

        <TecladoNumerico
          valor={pin}
          alCambiar={setPin}
          alConfirmar={() => {
            void saltar(loteBloqueante.loteId);
          }}
          deshabilitado={trabajando}
        />

        <button
          type="button"
          className="boton--secundario"
          onClick={() => {
            setConfirmandoSalto(false);
            setMensaje(null);
            setPin('');
          }}
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div data-prueba="pantalla-de-sincronizacion">
      <header className="encabezado">
        <h1>Sincronización</h1>
        <p className="subtitulo">Estado del respaldo de esta terminal en la nube.</p>
      </header>

      {mensaje !== null && (
        <p className="alerta" data-prueba="sincronizacion-error">
          {mensaje}
        </p>
      )}

      {!detalle.configurada && (
        <p className="advertencia" data-prueba="sincronizacion-sin-configurar">
          Esta copia de la aplicación no tiene ningún proyecto de nube configurado. Los cambios se
          registran igual en el disco de la tienda.
        </p>
      )}

      <section className="tarjeta" data-prueba="sincronizacion-resumen">
        <h2>Estado: {TEXTO_DE_ESTADO[detalle.estado]}</h2>
        <dl className="datos">
          <dt>Pendientes</dt>
          <dd data-prueba="sincronizacion-pendientes">{detalle.pendientes}</dd>

          <dt>El más viejo espera desde</dt>
          <dd>{fechaLegible(detalle.pendienteMasViejaDesde)}</dd>

          <dt>Último éxito</dt>
          <dd data-prueba="sincronizacion-ultimo-exito">{fechaLegible(detalle.ultimoExitoEn)}</dd>

          {detalle.archivosApartados > 0 && (
            <>
              <dt>Fotos sin subir (se reintentan mañana)</dt>
              <dd data-prueba="sincronizacion-archivos-apartados">{detalle.archivosApartados}</dd>
            </>
          )}
        </dl>
      </section>

      {detalle.pendientesPorTabla.length > 0 && (
        <section className="tarjeta" data-prueba="sincronizacion-por-tabla">
          <h2>Pendientes por tabla</h2>
          <dl className="datos">
            {detalle.pendientesPorTabla.map((fila) => (
              <div className="dato" key={fila.entidadTipo}>
                <span className="dato__etiqueta">{nombreLegibleDeTabla(fila.entidadTipo)}</span>
                <span className="dato__valor">{fila.total}</span>
              </div>
            ))}
          </dl>
        </section>
      )}

      {loteBloqueante !== null && (
        <section className="alerta" data-prueba="sincronizacion-lote-bloqueante">
          <h2>La cola está detenida</h2>
          <p>
            Un lote con <strong>{nombreLegibleDeTabla(loteBloqueante.tablas[0] ?? '')}</strong>
            {loteBloqueante.tablas.length > 1 &&
              ` y ${loteBloqueante.tablas.slice(1).map(nombreLegibleDeTabla).join(', ')}`}{' '}
            quedó detenido después de {loteBloqueante.intentos}{' '}
            {loteBloqueante.intentos === 1 ? 'intento' : 'intentos'}. Nada detrás de él va a subir
            hasta que se resuelva.
          </p>
          <p className="subtitulo">Error de la nube, tal cual lo devolvió:</p>
          <pre data-prueba="sincronizacion-error-completo">{loteBloqueante.error}</pre>

          <div className="acciones">
            <button
              type="button"
              disabled={trabajando}
              data-prueba="sincronizacion-reintentar"
              onClick={() => {
                void reintentar(loteBloqueante.loteId);
              }}
            >
              Reintentar ahora
            </button>
            <button
              type="button"
              className="boton--secundario"
              disabled={trabajando}
              data-prueba="sincronizacion-saltar"
              onClick={() => {
                setConfirmandoSalto(true);
                setMensaje(null);
              }}
            >
              Saltar este lote
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
