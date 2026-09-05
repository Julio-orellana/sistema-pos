/**
 * Pantalla de verificación técnica.
 *
 * ESTO NO ES UNA PANTALLA DE NEGOCIO. Existe para comprobar, a simple vista,
 * que el andamiaje funciona: que la ventana abre en kiosko, que el renderer
 * habla con el proceso principal por IPC, que SQLite responde, y que los
 * adaptadores activos son los seguros por defecto.
 *
 * Se reemplaza por la interfaz real de la caja cuando lleguen los módulos de
 * negocio.
 */

import { useEffect, useState } from 'react';

import type { DiagnosticoAplicacion, DiagnosticoBaseDeDatos } from '@shared/types/ipc';
import { formatearQuetzales, montoACadena, sumar } from '@shared/money';
import { ModalDeSalida } from './components/ModalDeSalida';

/** Fila de la tabla de resultados. */
function Dato({ etiqueta, valor }: { readonly etiqueta: string; readonly valor: string }): React.JSX.Element {
  return (
    <div className="dato">
      <span className="dato__etiqueta">{etiqueta}</span>
      <span className="dato__valor">{valor}</span>
    </div>
  );
}

export function App(): React.JSX.Element {
  const [aplicacion, setAplicacion] = useState<DiagnosticoAplicacion | null>(null);
  const [baseDeDatos, setBaseDeDatos] = useState<DiagnosticoBaseDeDatos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  /** Contador que dispara una nueva verificación al pulsar el botón. */
  const [intento, setIntento] = useState<number>(0);

  // El efecto consulta al proceso principal cuando cambia `intento`. Todos los
  // cambios de estado ocurren DESPUÉS del await, no en el cuerpo síncrono del
  // efecto, para no provocar renders en cascada.
  useEffect(() => {
    let vigente = true;

    const consultar = async (): Promise<void> => {
      const [respuestaAplicacion, respuestaBase] = await Promise.all([
        window.pos.diagnostico.aplicacion(),
        window.pos.diagnostico.baseDeDatos({
          incluirConteoDeRegistros: true,
          descripcionDePrueba: `Verificación de arranque ${new Date().toISOString()}`,
        }),
      ]);

      if (!vigente) {
        return;
      }

      setError(
        respuestaAplicacion.ok
          ? respuestaBase.ok
            ? null
            : respuestaBase.error.mensaje
          : respuestaAplicacion.error.mensaje,
      );

      if (respuestaAplicacion.ok) {
        setAplicacion(respuestaAplicacion.datos);
      }
      if (respuestaBase.ok) {
        setBaseDeDatos(respuestaBase.datos);
      }
      setCargando(false);
    };

    void consultar();

    return (): void => {
      vigente = false;
    };
  }, [intento]);

  /** Reintenta la verificación desde el botón del pie. */
  const volverAVerificar = (): void => {
    setCargando(true);
    setIntento((anterior) => anterior + 1);
  };

  // Demostración visible de la aritmética exacta: 0.1 + 0.2 debe dar 0.30.
  const pruebaDecimal = montoACadena(sumar('0.1', '0.2'));

  return (
    <main className="pantalla">
      {/* Invisible hasta que el administrador presiona su atajo. */}
      <ModalDeSalida />

      <header className="encabezado">
        <h1>POS Agrícola</h1>
        <p className="subtitulo">Verificación técnica del andamiaje · Cliente: Jimmy Cano</p>
      </header>

      {error !== null && <p className="alerta">Error: {error}</p>}

      <section className="tarjeta">
        <h2>Aritmética decimal</h2>
        <Dato etiqueta="0.1 + 0.2 con Decimal.js" valor={pruebaDecimal} />
        <Dato etiqueta="Formato de moneda" valor={formatearQuetzales('1234.5')} />
      </section>

      <section className="tarjeta">
        <h2>Base de datos local (SQLite)</h2>
        {baseDeDatos === null ? (
          <p className="pendiente">{cargando ? 'Consultando…' : 'Sin datos.'}</p>
        ) : (
          <>
            <Dato etiqueta="Conectada" valor={baseDeDatos.conectada ? 'Sí' : 'No'} />
            <Dato etiqueta="Versión de SQLite" valor={baseDeDatos.versionSqlite} />
            <Dato etiqueta="Modo journal" valor={baseDeDatos.modoJournal} />
            <Dato
              etiqueta="Llaves foráneas"
              valor={baseDeDatos.llavesForaneasActivas ? 'Activas' : 'Inactivas'}
            />
            <Dato etiqueta="Tabla de prueba" valor={baseDeDatos.tablaDePrueba} />
            <Dato
              etiqueta="Registros escritos"
              valor={baseDeDatos.registrosDePrueba === null ? 'No contados' : String(baseDeDatos.registrosDePrueba)}
            />
            <Dato etiqueta="Archivo" valor={baseDeDatos.rutaArchivo} />
          </>
        )}
      </section>

      <section className="tarjeta">
        <h2>Aplicación y adaptadores</h2>
        {aplicacion === null ? (
          <p className="pendiente">{cargando ? 'Consultando…' : 'Sin datos.'}</p>
        ) : (
          <>
            <Dato etiqueta="Versión" valor={aplicacion.version} />
            <Dato etiqueta="Entorno" valor={aplicacion.entorno} />
            <Dato etiqueta="Electron" valor={aplicacion.versionElectron} />
            <Dato etiqueta="Node" valor={aplicacion.versionNode} />
            <Dato etiqueta="Chromium" valor={aplicacion.versionChrome} />
            <Dato etiqueta="Adaptador de impresión" valor={aplicacion.adaptadorImpresion} />
            <Dato etiqueta="Adaptador de sincronización" valor={aplicacion.adaptadorSincronizacion} />
            <Dato
              etiqueta="Supabase"
              valor={aplicacion.sincronizacionSimulada ? 'Simulado (no consume cuota)' : 'Conectado'}
            />
          </>
        )}
      </section>

      <footer className="pie">
        <button type="button" onClick={volverAVerificar} disabled={cargando}>
          {cargando ? 'Verificando…' : 'Volver a verificar'}
        </button>
        <p className="nota">
          Ventana en modo kiosko: sin menú, sin barra de título, sin zoom y sin menú de clic derecho.
        </p>
      </footer>
    </main>
  );
}
