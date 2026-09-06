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
 */

import { useState } from 'react';

export function BarraDeEstado({ version }: { readonly version: string }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

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

      <span className="barra-estado__relleno" />
      <span className="barra-estado__dato">v{version}</span>
    </footer>
  );
}
