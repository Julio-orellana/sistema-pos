/**
 * Panel de verificación técnica.
 *
 * NO ES UNA PANTALLA DE NEGOCIO. Comprueba de un vistazo que el andamiaje está
 * sano: la aritmética decimal, la conexión a SQLite con sus migraciones y los
 * adaptadores activos. Se quita cuando exista la pantalla de ventas real.
 */

import { useEffect, useState } from 'react';

import type { DiagnosticoAplicacion, DiagnosticoBaseDeDatos } from '@shared/types/ipc';
import { formatearQuetzales, montoACadena, sumar } from '@shared/money';

/** Fila de la tabla de resultados. */
function Dato({ etiqueta, valor }: { readonly etiqueta: string; readonly valor: string }): React.JSX.Element {
  return (
    <div className="dato">
      <span className="dato__etiqueta">{etiqueta}</span>
      <span className="dato__valor">{valor}</span>
    </div>
  );
}

/**
 * «Pantalla y entrada» (§4.62): lo que el navegador sabe de la pantalla del
 * equipo y de cómo le llega el dedo. Existe por el hallazgo de la tienda: no
 * se podía bajar con el dedo, y la causa depende de si Windows entrega cada
 * toque como TÁCTIL o como MOUSE. Tocar cualquier parte de la pantalla
 * actualiza «Último toque», así que en el equipo real se lee con un dedo.
 */
function TarjetaDePantallaYEntrada(): React.JSX.Element {
  const [ultimoPuntero, setUltimoPuntero] = useState<string>('todavía ninguno');
  const [medidas, setMedidas] = useState(() => ({ ancho: window.innerWidth, alto: window.innerHeight }));

  useEffect(() => {
    const alTocar = (evento: PointerEvent): void => {
      setUltimoPuntero(evento.pointerType === '' ? 'desconocido' : evento.pointerType);
    };
    const alCambiarDeTamano = (): void => {
      setMedidas({ ancho: window.innerWidth, alto: window.innerHeight });
    };
    window.addEventListener('pointerdown', alTocar, { capture: true, passive: true });
    window.addEventListener('resize', alCambiarDeTamano);
    return (): void => {
      window.removeEventListener('pointerdown', alTocar, { capture: true });
      window.removeEventListener('resize', alCambiarDeTamano);
    };
  }, []);

  return (
    <section className="tarjeta" data-prueba="tarjeta-pantalla-y-entrada">
      <h2>Pantalla y entrada</h2>
      <Dato etiqueta="Ventana" valor={`${String(medidas.ancho)} × ${String(medidas.alto)} px`} />
      <Dato etiqueta="Densidad de píxeles" valor={String(window.devicePixelRatio)} />
      <Dato
        etiqueta="Puntos táctiles que anuncia el sistema"
        valor={navigator.maxTouchPoints === 0 ? '0 (el sistema no la ve como pantalla táctil)' : String(navigator.maxTouchPoints)}
      />
      <Dato etiqueta="Último toque llegó como" valor={ultimoPuntero} />
    </section>
  );
}

export function PanelDeVerificacion(): React.JSX.Element {
  const [aplicacion, setAplicacion] = useState<DiagnosticoAplicacion | null>(null);
  const [baseDeDatos, setBaseDeDatos] = useState<DiagnosticoBaseDeDatos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const [respuestaAplicacion, respuestaBase] = await Promise.all([
        window.pos.diagnostico.aplicacion(),
        window.pos.diagnostico.baseDeDatos({ incluirConteoDeRegistros: true }),
      ]);
      if (control.signal.aborted) {
        return;
      }
      if (respuestaAplicacion.ok) {
        setAplicacion(respuestaAplicacion.datos);
      } else {
        setError(respuestaAplicacion.error.mensaje);
      }
      if (respuestaBase.ok) {
        setBaseDeDatos(respuestaBase.datos);
      } else {
        setError(respuestaBase.error.mensaje);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, []);

  return (
    <>
      {error !== null && <p className="alerta">Error: {error}</p>}

      <TarjetaDePantallaYEntrada />

      <section className="tarjeta">
        <h2>Aritmética decimal</h2>
        <Dato etiqueta="0.1 + 0.2 con Decimal.js" valor={montoACadena(sumar('0.1', '0.2'))} />
        <Dato etiqueta="Formato de moneda" valor={formatearQuetzales('1234.5')} />
      </section>

      <section className="tarjeta">
        <h2>Base de datos local (SQLite)</h2>
        {baseDeDatos === null ? (
          <p className="pendiente">Consultando…</p>
        ) : (
          <>
            <Dato etiqueta="Conectada" valor={baseDeDatos.conectada ? 'Sí' : 'No'} />
            <Dato etiqueta="Versión de SQLite" valor={baseDeDatos.versionSqlite} />
            <Dato etiqueta="Modo journal" valor={baseDeDatos.modoJournal} />
            <Dato
              etiqueta="Llaves foráneas"
              valor={baseDeDatos.llavesForaneasActivas ? 'Activas' : 'Inactivas'}
            />
            <Dato
              etiqueta="Migraciones aplicadas"
              valor={`${String(baseDeDatos.migracionesAplicadas)} (${baseDeDatos.ultimaMigracion ?? 'ninguna'})`}
            />
            <Dato etiqueta="Tablas del esquema" valor={String(baseDeDatos.tablas.length)} />
          </>
        )}
      </section>

      <section className="tarjeta">
        <h2>Aplicación y adaptadores</h2>
        {aplicacion === null ? (
          <p className="pendiente">Consultando…</p>
        ) : (
          <>
            <Dato etiqueta="Versión" valor={aplicacion.version} />
            <Dato etiqueta="Entorno" valor={aplicacion.entorno} />
            <Dato etiqueta="Electron" valor={aplicacion.versionElectron} />
            <Dato etiqueta="Impresora" valor={aplicacion.impresora} />
            <Dato etiqueta="Adaptador de sincronización" valor={aplicacion.adaptadorSincronizacion} />
            <Dato
              etiqueta="Supabase"
              valor={aplicacion.sincronizacionSimulada ? 'Simulado (no consume cuota)' : 'Conectado'}
            />
            <Dato etiqueta="Aceleración gráfica" valor={aplicacion.aceleracionGrafica} />
          </>
        )}
      </section>
    </>
  );
}
