/**
 * Barra de estado del cascarón de la aplicación.
 *
 * Contiene el ÚNICO control visible que puede cerrar el punto de venta, y no
 * cierra nada por su cuenta: le pide al proceso principal que inicie la salida
 * controlada, que responde abriendo el mismo diálogo de PIN que abre el atajo
 * de teclado. No hay un camino paralelo ni un cierre sin autorización.
 *
 * UBICACIÓN, Y POR QUÉ (ver la sección 4.5 de CLAUDE.md):
 *
 *   - Va en la BARRA DE ESTADO, que es cromo de la aplicación y no parte del
 *     flujo de venta: el cajero trabaja mirando el centro de la pantalla.
 *   - Va en la esquina inferior IZQUIERDA, lo más lejos posible del botón de
 *     cobrar, que por convención de punto de venta se ubica abajo a la
 *     derecha. Así se reduce el toque accidental en una pantalla táctil.
 *   - Está en todas las pantallas, no dentro de un menú: es una salida de
 *     emergencia y un administrador tiene que poder llegar a ella sin navegar.
 *   - Es un ícono discreto con etiqueta accesible, no un botón que diga
 *     "Cerrar": no invita a que lo prueben.
 *
 * La barrera real sigue siendo el PIN. La ubicación solo evita el accidente y
 * que el cajero lo tenga delante como una opción más del día.
 *
 * ===========================================================================
 * TAMBIÉN MUESTRA EL ESTADO DE SINCRONIZACIÓN (§3.3 del diseño, Fase 4.a)
 * ===========================================================================
 *
 * Es el nivel «permanente» de los tres que describe el diseño: visible
 * siempre, sin estorbar la venta, con un texto corto y un color. Consulta
 * `sincronizacion:resumen`, el ÚNICO canal de sincronización sin guard de rol
 * —esta barra está montada incluso antes de iniciar sesión— y que no lleva
 * ningún dato sensible.
 *
 * Se sondea cada `INTERVALO_DE_SONDEO_MS`: es una consulta local a SQLite, sin
 * red de por medio, así que el costo de refrescarla seguido es despreciable.
 */

import { useEffect, useState } from 'react';

import type { ResumenDeSincronizacionIpc, SesionIniciada } from '@shared/types/ipc';

/** Cada cuánto se refresca el indicador de sincronización. */
const INTERVALO_DE_SONDEO_MS = 20_000;

/** El texto y la clase de color para cada estado, calculados en el proceso principal. */
function claseDeColor(estado: ResumenDeSincronizacionIpc['estado']): string {
  if (estado === 'detenida' || estado === 'sin_credencial') {
    return 'barra-estado__nube barra-estado__nube--rojo';
  }
  if (estado === 'pendientes_viejos') {
    return 'barra-estado__nube barra-estado__nube--ambar';
  }
  return 'barra-estado__nube';
}

/** El texto corto, con los mismos nombres que usa `resumen-de-sincronizacion.ts`. */
function textoDelResumen(resumen: ResumenDeSincronizacionIpc): string {
  switch (resumen.estado) {
    case 'detenida':
      return 'Nube: DETENIDA';
    case 'sin_credencial':
      return 'Nube: sin conectar';
    case 'pendientes_viejos':
      return `Nube: ${String(resumen.pendientes)} pendientes (más de 24 h)`;
    case 'sin_conexion':
      return `Nube: sin conexión — ${String(resumen.pendientes)} pendientes`;
    case 'pendientes':
      return `Nube: ${String(resumen.pendientes)} pendientes`;
    case 'al_dia':
      return 'Nube: al día';
  }
}

export function BarraDeEstado({
  sesion,
}: {
  readonly sesion: SesionIniciada | null;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState('—');
  const [resumen, setResumen] = useState<ResumenDeSincronizacionIpc | null>(null);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.diagnostico.aplicacion();
      if (!control.signal.aborted && respuesta.ok) {
        setVersion(respuesta.datos.version);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, []);

  useEffect(() => {
    const control = new AbortController();

    const consultar = async (): Promise<void> => {
      const respuesta = await window.pos.sincronizacion.resumen();
      if (!control.signal.aborted && respuesta.ok) {
        setResumen(respuesta.datos);
      }
    };

    void consultar();
    const intervalo = setInterval(() => {
      void consultar();
    }, INTERVALO_DE_SONDEO_MS);

    return (): void => {
      control.abort();
      clearInterval(intervalo);
    };
  }, []);

  const pedirSalida = (): void => {
    void (async (): Promise<void> => {
      const respuesta = await window.pos.kiosko.solicitarSalida();
      setError(respuesta.ok ? null : respuesta.error.mensaje);
    })();
  };

  return (
    <footer className="barra-estado">
      <button
        type="button"
        className="barra-estado__salir"
        data-prueba="boton-salida"
        onClick={pedirSalida}
        title="Salir del sistema (requiere PIN de administrador)"
        aria-label="Salir del sistema. Requiere PIN de administrador."
      >
        {/* Ícono de salida, sin texto: discreto a propósito. */}
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {error !== null && <span className="barra-estado__error">{error}</span>}

      {resumen !== null && (
        // "false" no es un texto engañoso: `configurada === false` significa
        // que esta copia no tiene ningún proyecto de nube, y en ese caso el
        // estado calculado ya es 'al_dia' (o 'pendientes'), nunca uno que
        // alarme (ver `calcularEstadoDeSincronizacion`). No hace falta una
        // rama aparte para "sin configurar": el propio cálculo ya lo cubre.
        <span className={claseDeColor(resumen.estado)} data-prueba="barra-nube">
          {textoDelResumen(resumen)}
        </span>
      )}

      <span className="barra-estado__relleno" />
      {sesion !== null && (
        <span className="barra-estado__dato" data-prueba="usuario-en-sesion">
          {sesion.nombre} · {sesion.rol}
        </span>
      )}
      <span className="barra-estado__dato">v{version}</span>
    </footer>
  );
}
