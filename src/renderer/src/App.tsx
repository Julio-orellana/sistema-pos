/**
 * Cascarón de la aplicación.
 *
 * Decide qué pantalla se muestra según el estado de arranque, y es el único
 * lugar donde se toma esa decisión:
 *
 *   1. Instalación sin usuarios  -> configuración inicial, y NADA más es
 *      accesible hasta que exista el primer administrador. Desde ahí se
 *      puede elegir, en cambio, RESTAURAR desde la nube (fase 4.b).
 *   1b. Restauración a medias    -> solo la pantalla de restauración, para
 *      retomarla: la base está parcial y sus usuarios no tienen PIN.
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
import { PantallaDeRestauracion } from './components/PantallaDeRestauracion';
import { PantallaDeSesion } from './components/PantallaDeSesion';
import { ProveedorDeTeclado } from './components/TecladoEnPantalla';

export function App(): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoDeSesion | null>(null);
  const [sesion, setSesion] = useState<SesionIniciada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  /** `true` mientras se eligió restaurar desde la nube en vez de crear el primer administrador. */
  const [restaurando, setRestaurando] = useState(false);

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
    /*
      Una restauración a medias manda: la base está parcialmente llena y sus
      usuarios no tienen PIN, así que ni el ingreso ni la configuración inicial
      tienen sentido. Solo se puede retomar (§6.6 del diseño).
    */
    if (estado.restauracionIncompleta) {
      return (
        <PantallaDeRestauracion
          alVolver={null}
          alTerminar={() => {
            setRecarga((anterior) => anterior + 1);
          }}
        />
      );
    }
    if (estado.requiereConfiguracionInicial && restaurando) {
      return (
        <PantallaDeRestauracion
          alVolver={() => {
            setRestaurando(false);
          }}
          alTerminar={() => {
            setRestaurando(false);
            setRecarga((anterior) => anterior + 1);
          }}
        />
      );
    }
    if (estado.requiereConfiguracionInicial) {
      return (
        <PantallaDeConfiguracionInicial
          alCrear={setSesion}
          alRestaurar={() => {
            setRestaurando(true);
          }}
        />
      );
    }
    return <PantallaDeIngreso alIngresar={setSesion} />;
  })();

  return (
    <main className="pantalla">
      {/* Invisible hasta que se pide la salida controlada. */}
      <ModalDeSalida />

      {/* Un solo teclado en pantalla para toda la aplicación: los campos de
          texto lo abren al tocarlos (componente `CampoDeTexto`). */}
      <ProveedorDeTeclado>{contenido}</ProveedorDeTeclado>

      <BarraDeEstado sesion={sesion} />
    </main>
  );
}
