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
import { PantallaDeCategorias } from './PantallaDeCategorias';
import { PantallaDePinRemoto } from './PantallaDePinRemoto';
import { PantallaDeProductos } from './PantallaDeProductos';
import { PantallaDeUsuarios } from './PantallaDeUsuarios';
import { PantallaDeNegocio } from './PantallaDeNegocio';
import { PantallaDeRecibos } from './PantallaDeRecibos';
import { PantallaDeReportes } from './PantallaDeReportes';
import { PantallaDeLimites } from './PantallaDeLimites';
import { PantallaDeVenta } from './PantallaDeVenta';

export interface PantallaDeSesionProps {
  readonly sesion: SesionIniciada;
  readonly alCerrarSesion: () => void;
}

/** Dónde está parado el usuario dentro de la sesión. */
type Vista =
  | 'menu'
  | 'venta'
  | 'caja'
  | 'pin-remoto'
  | 'categorias'
  | 'productos'
  | 'usuarios'
  | 'negocio'
  | 'recibos'
  | 'reportes'
  | 'limites';

export function PantallaDeSesion({
  sesion,
  alCerrarSesion,
}: PantallaDeSesionProps): React.JSX.Element {
  const [vista, setVista] = useState<Vista>('menu');

  if (vista === 'venta') {
    return (
      <PantallaDeVenta
        alVolver={() => { setVista('menu'); }}
        alIrACaja={() => { setVista('caja'); }}
      />
    );
  }
  if (vista === 'caja') {
    return <PantallaDeCaja alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'pin-remoto') {
    return <PantallaDePinRemoto alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'categorias') {
    return <PantallaDeCategorias alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'productos') {
    return <PantallaDeProductos alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'usuarios') {
    return <PantallaDeUsuarios alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'negocio') {
    return <PantallaDeNegocio alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'recibos') {
    return <PantallaDeRecibos alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'reportes') {
    return <PantallaDeReportes alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'limites') {
    return <PantallaDeLimites alVolver={() => { setVista('menu'); }} />;
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
        <button type="button" data-prueba="ir-a-venta" onClick={() => { setVista('venta'); }}>
          Vender
        </button>
        <button type="button" data-prueba="ir-a-caja" onClick={() => { setVista('caja'); }}>
          Caja
        </button>
        {/*
          Recibos NO es de administración: reimprimir lo pide un cliente que
          perdió su papel, y el cajero tiene que poder resolverlo solo.
        */}
        <button type="button" data-prueba="ir-a-recibos" onClick={() => { setVista('recibos'); }}>
          Recibos
        </button>
        {/*
          El catálogo y el PIN remoto son de administración. Esconder los
          botones es comodidad: quien de verdad impide el acceso es el guard
          `requiereRol` del proceso principal, en cada canal.
        */}
        {sesion.rol === 'administrativo' && (
          <>
            <button
              type="button"
              data-prueba="ir-a-productos"
              onClick={() => { setVista('productos'); }}
            >
              Productos
            </button>
            <button
              type="button"
              data-prueba="ir-a-categorias"
              onClick={() => { setVista('categorias'); }}
            >
              Categorías
            </button>
            <button
              type="button"
              data-prueba="ir-a-usuarios"
              onClick={() => { setVista('usuarios'); }}
            >
              Usuarios
            </button>
            <button
              type="button"
              data-prueba="ir-a-reportes"
              onClick={() => { setVista('reportes'); }}
            >
              Reportes
            </button>
            <button
              type="button"
              data-prueba="ir-a-limites"
              onClick={() => { setVista('limites'); }}
            >
              Topes de descuento
            </button>
            <button
              type="button"
              data-prueba="ir-a-negocio"
              onClick={() => { setVista('negocio'); }}
            >
              Datos del negocio
            </button>
            <button
              type="button"
              className="boton--secundario"
              data-prueba="ir-a-pin-remoto"
              onClick={() => { setVista('pin-remoto'); }}
            >
              PIN de autorización remota
            </button>
          </>
        )}
      </div>

      <PanelDeVerificacion />

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alCerrarSesion}>
          Cerrar sesión
        </button>
        <p className="nota">
          Todavía no existen: anular una venta ya registrada, las alertas de stock mínimo y la
          exportación de reportes a un archivo.
        </p>
      </div>
    </div>
  );
}
