/**
 * Pantalla base tras un ingreso correcto.
 *
 * Es el punto desde el que se llega a lo que ya existe. La pantalla de ventas
 * llega en un prompt futuro y va a reemplazar este menú.
 */

import { useState } from 'react';

import type { SesionIniciada } from '@shared/types/ipc';
import { PanelDeVerificacion } from './PanelDeVerificacion';
import { PantallaDeCaja } from './PantallaDeCaja';
import { PantallaDePinRemoto } from './PantallaDePinRemoto';

export interface PantallaDeSesionProps {
  readonly sesion: SesionIniciada;
  readonly alCerrarSesion: () => void;
}

/** Dónde está parado el usuario dentro de la sesión. */
type Vista = 'menu' | 'caja' | 'pin-remoto';

export function PantallaDeSesion({
  sesion,
  alCerrarSesion,
}: PantallaDeSesionProps): React.JSX.Element {
  const [vista, setVista] = useState<Vista>('menu');

  if (vista === 'caja') {
    return <PantallaDeCaja alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'pin-remoto') {
    return <PantallaDePinRemoto alVolver={() => { setVista('menu'); }} />;
  }

  return (
    <div data-prueba="pantalla-de-sesion">
      <header className="encabezado">
        <h1>Sesión iniciada</h1>
        <p className="subtitulo">
          {sesion.nombre} · rol {sesion.rol}
        </p>
      </header>

      <div className="menu">
        <button type="button" data-prueba="ir-a-caja" onClick={() => { setVista('caja'); }}>
          Caja
        </button>
        {/* El PIN remoto solo lo configura un administrador, para sí mismo. */}
        {sesion.rol === 'administrativo' && (
          <button
            type="button"
            className="boton--secundario"
            data-prueba="ir-a-pin-remoto"
            onClick={() => { setVista('pin-remoto'); }}
          >
            PIN de autorización remota
          </button>
        )}
      </div>

      <PanelDeVerificacion />

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alCerrarSesion}>
          Cerrar sesión
        </button>
        <p className="nota">
          La pantalla de ventas llega en un prompt futuro y va a reemplazar este menú.
        </p>
      </div>
    </div>
  );
}
