/**
 * Pantalla base tras un ingreso correcto.
 *
 * Es deliberadamente mínima: la pantalla de ventas llega en un prompt futuro.
 * Lo que sí conserva es el panel de verificación técnica, que sigue siendo la
 * forma de comprobar de un vistazo que la aritmética decimal, la base de datos
 * y los adaptadores están sanos.
 */

import type { SesionIniciada } from '@shared/types/ipc';
import { PanelDeVerificacion } from './PanelDeVerificacion';

export interface PantallaDeSesionProps {
  readonly sesion: SesionIniciada;
  readonly alCerrarSesion: () => void;
}

export function PantallaDeSesion({
  sesion,
  alCerrarSesion,
}: PantallaDeSesionProps): React.JSX.Element {
  return (
    <div data-prueba="pantalla-de-sesion">
      <header className="encabezado">
        <h1>Sesión iniciada</h1>
        <p className="subtitulo">
          {sesion.nombre} · rol {sesion.rol}
        </p>
      </header>

      <PanelDeVerificacion />

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alCerrarSesion}>
          Cerrar sesión
        </button>
        <p className="nota">
          La pantalla de ventas llega en un prompt futuro. Esto es la base tras el ingreso.
        </p>
      </div>
    </div>
  );
}
