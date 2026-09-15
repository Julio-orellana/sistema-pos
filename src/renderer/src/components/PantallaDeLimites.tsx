/**
 * Los topes de descuento por rol.
 *
 * Reemplaza la dependencia del guion `npm run seed:limites`, que hasta ahora era
 * la ÚNICA forma de llenar `limites_descuento`: Jimmy no podía cambiar el tope
 * de su cajero sin que alguien le abriera una terminal en la computadora.
 *
 * DOS COSAS QUE LA PANTALLA TIENE QUE DECIR EN VOZ ALTA, porque quien las
 * ignore va a configurar mal:
 *
 *   1. **Un rol sin fila tiene tope CERO, no «sin límite».** Es el valor
 *      seguro: un olvido de configuración no se convierte en un permiso. Pero
 *      leído de corrido, un renglón en blanco parece lo contrario.
 *   2. **Los dos topes son independientes y no se convierten entre sí.** El
 *      porcentaje se compara contra un descuento en porcentaje y el monto fijo
 *      contra uno en quetzales. Poner 10 % no implica ningún techo en quetzales.
 *
 * LA CONFIRMACIÓN NO ES CEREMONIA: subir un tope le da a un rol la capacidad de
 * rebajar sin pedirle permiso a nadie, y el número que se está por dejar puesto
 * tiene que verse antes de guardarlo. Mismo criterio que el cierre de caja
 * descuadrado (§4.9), donde se muestra el monto antes de pedir el PIN.
 */

import { useCallback, useEffect, useState } from 'react';

import type { LimiteDeDescuentoIpc, RolIpc } from '@shared/types/ipc';
import { CampoDeTexto } from './TecladoEnPantalla';

/** Cómo se lee cada rol en la pantalla. */
const NOMBRES_DE_ROL: Record<RolIpc, string> = {
  venta: 'Venta (cajero)',
  administrativo: 'Administrativo',
};

/** Un porcentaje mayor que este no autoriza nada más: la venta entera ya cabe. */
const PORCENTAJE_COMPLETO = 100;

/** Lo que se está editando en un renglón. */
interface Borrador {
  readonly porcentaje: string;
  readonly montoFijo: string;
}

export function PantallaDeLimites({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [limites, setLimites] = useState<readonly LimiteDeDescuentoIpc[] | null>(null);
  const [editando, setEditando] = useState<RolIpc | null>(null);
  const [borrador, setBorrador] = useState<Borrador>({ porcentaje: '', montoFijo: '' });
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const recargar = useCallback((): void => {
    void (async (): Promise<void> => {
      const respuesta = await window.pos.limites.listar();
      if (respuesta.ok) {
        setLimites(respuesta.datos);
      } else {
        setMensaje(respuesta.error.mensaje);
        setLimites([]);
      }
    })();
  }, []);

  useEffect(recargar, [recargar]);

  const guardar = useCallback((): void => {
    if (editando === null) {
      return;
    }
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.limites.fijar({
        rol: editando,
        porcentaje: borrador.porcentaje,
        montoFijo: borrador.montoFijo,
      });
      setTrabajando(false);

      if (!respuesta.ok) {
        /*
          SE VUELVE AL PASO DE EDICIÓN, y esto se corrigió manejando la
          aplicación real. La primera versión se quedaba en la confirmación: los
          campos seguían visibles y editables, pero el botón «Guardar» no existía
          en ese estado —ahí el botón dice «Sí, guardar este tope»—, así que
          quien corrigiera el valor se quedaba mirando una confirmación que
          seguía repitiendo el número rechazado.

          Volver al paso de edición deja el aviso junto al botón que lo produjo,
          que es la regla de §4.11, y deja el foco donde está el problema: el
          valor.
        */
        setConfirmando(false);
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setConfirmando(false);
      setEditando(null);
      setAviso(
        `Tope de ${NOMBRES_DE_ROL[respuesta.datos.rol]} guardado: ${respuesta.datos.porcentaje} % o Q${respuesta.datos.montoFijo}.`,
      );
      recargar();
    })();
  }, [editando, borrador, recargar]);

  if (limites === null) {
    return (
      <div data-prueba="pantalla-de-limites">
        <p className="pendiente">Consultando los topes configurados…</p>
      </div>
    );
  }

  const sinConfigurar = limites.filter((limite) => !limite.configurado);
  const excedeCien = Number(borrador.porcentaje) > PORCENTAJE_COMPLETO;

  return (
    <div data-prueba="pantalla-de-limites">
      <header className="encabezado">
        <h1>Topes de descuento</h1>
        <p className="subtitulo">
          Cuánto puede rebajar cada rol sin pedir autorización. Si un descuento pasa el tope, el
          sistema lo bloquea y un administrador puede autorizar la excepción con su PIN.
        </p>
      </header>

      {mensaje !== null && editando === null && (
        <p className="alerta" data-prueba="limites-error">
          {mensaje}
        </p>
      )}
      {aviso !== null && (
        <p className="aviso-exito" data-prueba="limites-aviso">
          {aviso}
        </p>
      )}

      {sinConfigurar.length > 0 && (
        <p className="advertencia" data-prueba="limites-sin-configurar">
          {sinConfigurar.map((limite) => NOMBRES_DE_ROL[limite.rol]).join(' y ')} no{' '}
          {sinConfigurar.length === 1 ? 'tiene' : 'tienen'} tope configurado. Eso significa tope
          CERO, no «sin límite»: cualquier descuento, aunque sea de Q1, va a pedir el PIN de un
          administrador.
        </p>
      )}

      <section className="tarjeta">
        <ul className="lista">
          {limites.map((limite) => (
            <li className="lista__fila" key={limite.rol} data-prueba={`limite-${limite.rol}`}>
              <span className="lista__principal">
                <span className="lista__nombre">{NOMBRES_DE_ROL[limite.rol]}</span>
                <span className="lista__detalle" data-prueba={`limite-valores-${limite.rol}`}>
                  {limite.porcentaje} % · hasta Q{limite.montoFijo}
                  {limite.configurado ? '' : ' · sin configurar (tope cero)'}
                </span>
                {/*
                  TRES ESTADOS DISTINTOS, no dos. «Sin fila» y «fila sembrada
                  por el guion» comparten `editadoPor === null` pero no
                  significan lo mismo: decirle «sembrado por el guion» a un rol
                  que nunca se configuró sería afirmar que alguien corrió algo
                  que nadie corrió. Se descubrió mirando la pantalla real.
                */}
                <span className="lista__detalle">
                  {!limite.configurado
                    ? 'Todavía no lo configuró nadie'
                    : limite.editadoPor === null
                      ? 'Sembrado por el guion de desarrollo, sin responsable'
                      : `Última vez: ${limite.editadoPor}`}
                </span>
              </span>
              <span className="lista__acciones">
                <button
                  type="button"
                  data-prueba={`editar-limite-${limite.rol}`}
                  onClick={() => {
                    setAviso(null);
                    setMensaje(null);
                    setEditando(limite.rol);
                    setBorrador({ porcentaje: limite.porcentaje, montoFijo: limite.montoFijo });
                  }}
                >
                  Editar
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="nota">
          Los dos topes son independientes y no se convierten entre sí: el porcentaje se compara
          contra un descuento en porcentaje, y el monto fijo contra uno en quetzales.
        </p>
      </section>

      {editando !== null && (
        <section className="tarjeta" data-prueba="editor-de-limite">
          <h2>Tope de {NOMBRES_DE_ROL[editando]}</h2>

          <label className="campo">
            <span className="campo__etiqueta">Porcentaje máximo</span>
            <CampoDeTexto
              etiqueta="Porcentaje máximo"
              disposicion="decimal"
              valor={borrador.porcentaje}
              data-prueba="limite-porcentaje"
              alCambiar={(porcentaje) => {
                setMensaje(null);
                setBorrador((anterior) => ({ ...anterior, porcentaje }));
              }}
            />
            <span className="campo__pista">0 significa que este rol no puede dar descuento.</span>
          </label>

          <label className="campo">
            <span className="campo__etiqueta">Monto fijo máximo, en quetzales</span>
            <CampoDeTexto
              etiqueta="Monto fijo máximo, en quetzales"
              disposicion="decimal"
              valor={borrador.montoFijo}
              data-prueba="limite-monto"
              alCambiar={(montoFijo) => {
                setMensaje(null);
                setBorrador((anterior) => ({ ...anterior, montoFijo }));
              }}
            />
          </label>

          {/*
            AVISA SIN BLOQUEAR, igual que el aviso de inventario de la pantalla
            de venta (§4.12). Un porcentaje mayor que 100 no autoriza nada más
            que 100 —el total ya tiene piso en cero—, pero tampoco es ilegal, y
            rechazarlo sería inventar una regla que nadie confirmó.
          */}
          {excedeCien && (
            <p className="advertencia" data-prueba="limite-aviso-porcentaje">
              Más de 100 % no autoriza nada más que 100 %: con 100 % el rol ya puede descontar la
              venta entera. Si querías poner un tope en quetzales, va en el campo de abajo.
            </p>
          )}

          {confirmando ? (
            <>
              <p className="autorizacion__resumen" data-prueba="limite-confirmacion">
                El rol {NOMBRES_DE_ROL[editando]} va a poder rebajar hasta{' '}
                <strong>{borrador.porcentaje} %</strong> o hasta{' '}
                <strong>Q{borrador.montoFijo}</strong> sin pedirle autorización a nadie.
              </p>
              <div className="acciones">
                <button
                  type="button"
                  disabled={trabajando}
                  data-prueba="limite-confirmar"
                  onClick={guardar}
                >
                  Sí, guardar este tope
                </button>
                <button
                  type="button"
                  className="boton--secundario"
                  onClick={() => {
                    setConfirmando(false);
                  }}
                >
                  Revisar
                </button>
              </div>
            </>
          ) : (
            <div className="acciones">
              {/* El aviso va JUNTO al botón que lo produjo (§4.11). */}
              {mensaje !== null && (
                <p className="alerta" data-prueba="limites-error">
                  {mensaje}
                </p>
              )}
              <button
                type="button"
                data-prueba="limite-guardar"
                onClick={() => {
                  setMensaje(null);
                  setConfirmando(true);
                }}
              >
                Guardar
              </button>
              <button
                type="button"
                className="boton--secundario"
                onClick={() => {
                  setEditando(null);
                  setConfirmando(false);
                }}
              >
                Cancelar
              </button>
            </div>
          )}
        </section>
      )}

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}
