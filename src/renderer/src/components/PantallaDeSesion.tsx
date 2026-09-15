/**
 * Pantalla base tras un ingreso correcto.
 *
 * Es el punto desde el que se llega a lo que ya existe. La pantalla de ventas
 * llega en un prompt futuro y va a reemplazar este menú.
 */

import { useEffect, useState } from 'react';

import type { ResumenDeSincronizacionIpc, SesionIniciada } from '@shared/types/ipc';
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
import { PantallaDeNube } from './PantallaDeNube';
import { PantallaDeImpresora } from './PantallaDeImpresora';
import { PantallaDeHistorialDeCajas } from './PantallaDeHistorialDeCajas';
import { PantallaDeSincronizacion } from './PantallaDeSincronizacion';
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
  | 'limites'
  | 'nube'
  | 'impresora'
  | 'historial-de-cajas'
  | 'sincronizacion';

/**
 * El aviso de §3.3 al iniciar sesión, con el umbral de 24 h (decisión 8,
 * provisional). Solo se muestra con algo REALMENTE pendiente: un install
 * recién conectado, sin ninguna venta todavía, no tiene nada que avisar
 * aunque no tenga credencial.
 */
function AvisoDePendientes({
  resumen,
  irASincronizacion,
}: {
  readonly resumen: ResumenDeSincronizacionIpc;
  readonly irASincronizacion: () => void;
}): React.JSX.Element | null {
  if (resumen.pendientes === 0) {
    return null;
  }

  const texto = ((): string | null => {
    const cambios = resumen.pendientes === 1 ? '1 cambio' : `${String(resumen.pendientes)} cambios`;
    if (resumen.estado === 'pendientes_viejos') {
      const desde =
        resumen.pendienteMasViejaDesde === null
          ? ''
          : ` desde ${new Date(resumen.pendienteMasViejaDesde).toLocaleString()}`;
      return `Hay ${cambios} sin respaldar en la nube${desde}.`;
    }
    if (resumen.estado === 'detenida') {
      return `La sincronización está DETENIDA. Hay ${cambios} esperando.`;
    }
    if (resumen.estado === 'sin_credencial') {
      return `Esta terminal no tiene conexión con la nube. Hay ${cambios} esperando.`;
    }
    return null;
  })();

  if (texto === null) {
    return null;
  }

  const clase = resumen.estado === 'pendientes_viejos' ? 'advertencia' : 'alerta';

  return (
    <div className={clase} data-prueba="aviso-de-pendientes">
      <p>{texto}</p>
      <button type="button" className="boton--secundario" onClick={irASincronizacion}>
        Ver detalle
      </button>
    </div>
  );
}

export function PantallaDeSesion({
  sesion,
  alCerrarSesion,
}: PantallaDeSesionProps): React.JSX.Element {
  const [vista, setVista] = useState<Vista>('menu');
  const [resumenDeNube, setResumenDeNube] = useState<ResumenDeSincronizacionIpc | null>(null);

  useEffect(() => {
    if (sesion.rol !== 'administrativo') {
      return;
    }
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.sincronizacion.resumen();
      if (!control.signal.aborted && respuesta.ok) {
        setResumenDeNube(respuesta.datos);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [sesion.rol]);

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
  if (vista === 'nube') {
    return <PantallaDeNube alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'historial-de-cajas') {
    return <PantallaDeHistorialDeCajas alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'impresora') {
    return <PantallaDeImpresora alVolver={() => { setVista('menu'); }} />;
  }
  if (vista === 'sincronizacion') {
    return <PantallaDeSincronizacion alVolver={() => { setVista('menu'); }} />;
  }

  return (
    <div data-prueba="pantalla-de-sesion">
      <header className="encabezado">
        <h1>Sesión iniciada</h1>
        <p className="subtitulo">
          {sesion.nombre} · rol {sesion.rol}
        </p>
      </header>

      {sesion.rol === 'administrativo' && resumenDeNube !== null && (
        <AvisoDePendientes
          resumen={resumenDeNube}
          irASincronizacion={() => { setVista('sincronizacion'); }}
        />
      )}

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
              data-prueba="ir-a-historial-de-cajas"
              onClick={() => { setVista('historial-de-cajas'); }}
            >
              Historial de cajas
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
              data-prueba="ir-a-impresora"
              onClick={() => { setVista('impresora'); }}
            >
              Impresora de recibos
            </button>
            <button
              type="button"
              data-prueba="ir-a-nube"
              onClick={() => { setVista('nube'); }}
            >
              Conectar con la nube
            </button>
            <button
              type="button"
              data-prueba="ir-a-sincronizacion"
              onClick={() => { setVista('sincronizacion'); }}
            >
              Sincronización
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
