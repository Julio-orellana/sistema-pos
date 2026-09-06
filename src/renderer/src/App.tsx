/**
 * Cascarón de la aplicación.
 *
 * Decide qué pantalla se muestra según el estado de arranque, y es el único
 * lugar donde se toma esa decisión:
 *
 *   1. Instalación sin usuarios  -> configuración inicial, y NADA más es
 *      accesible hasta que exista el primer administrador.
 *   2. Sin sesión                -> pantalla de ingreso.
 *   3. Con sesión                -> pantalla base tras el ingreso.
 *
 * La barra de estado y el diálogo de salida están SIEMPRE montados, en
 * cualquiera de los tres estados: la salida controlada es una función del
 * cascarón, no de una pantalla concreta.
 */

import { useEffect, useState } from 'react';

import type { EstadoDeSesion, SesionIniciada } from '@shared/types/ipc';
import { BarraDeEstado } from './components/BarraDeEstado';
import { ModalDeSalida } from './components/ModalDeSalida';
import { PantallaDeConfiguracionInicial } from './components/PantallaDeConfiguracionInicial';
import { PantallaDeIngreso } from './components/PantallaDeIngreso';
import { PantallaDeSesion } from './components/PantallaDeSesion';

export function App(): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoDeSesion | null>(null);
  const [sesion, setSesion] = useState<SesionIniciada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await window.pos.sesion.estado();
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setEstado(respuesta.datos);
        setSesion(respuesta.datos.sesion);
      } else {
        setError(respuesta.error.mensaje);
      }
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  const cerrarSesion = (): void => {
    void (async (): Promise<void> => {
      await window.pos.sesion.cerrar();
      setSesion(null);
      setRecarga((anterior) => anterior + 1);
    })();
  };

  const contenido = ((): React.JSX.Element => {
    if (error !== null) {
      return <p className="alerta">Error: {error}</p>;
    }
    if (estado === null) {
      return <p className="pendiente">Iniciando…</p>;
    }
    if (sesion !== null) {
      return <PantallaDeSesion sesion={sesion} alCerrarSesion={cerrarSesion} />;
    }
    if (estado.requiereConfiguracionInicial) {
      return <PantallaDeConfiguracionInicial alCrear={setSesion} />;
    }
    return <PantallaDeIngreso alIngresar={setSesion} />;
  })();

  return (
    <main className="pantalla">
      {/* Invisible hasta que se pide la salida controlada. */}
      <ModalDeSalida />

      {contenido}

      <BarraDeEstado sesion={sesion} />
    </main>
  );
}
