/**
 * Recepción de mercadería: suma al inventario de un producto.
 *
 * Es un flujo PROPIO y no un campo del formulario de edición, y eso es una
 * decisión de negocio, no de diseño de pantalla: que entre mercadería es un
 * hecho distinto de que se corrija un precio, y deja su propio asiento de
 * auditoría con el saldo anterior, el nuevo y el motivo.
 *
 * SOLO SUMA. Las mermas y pérdidas son un módulo futuro con sus propias reglas
 * de autorización; el servicio rechaza cualquier cantidad que no sea positiva.
 */

import { useCallback, useState } from 'react';

import type { ProductoIpc } from '@shared/types/ipc';
import { CampoDeTexto } from './TecladoEnPantalla';

export interface ModalDeAjusteDeInventarioProps {
  readonly producto: ProductoIpc;
  readonly alTerminar: () => void;
  readonly alCancelar: () => void;
}

export function ModalDeAjusteDeInventario({
  producto,
  alTerminar,
  alCancelar,
}: ModalDeAjusteDeInventarioProps): React.JSX.Element {
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const unidad = producto.tipoMedida === 'peso' ? (producto.unidadPeso ?? '') : 'unidades';

  const registrar = useCallback((): void => {
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await window.pos.catalogo.ajustarInventario(
        producto.id,
        cantidad.trim(),
        motivo.trim() === '' ? null : motivo.trim(),
      );
      setTrabajando(false);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      alTerminar();
    })();
  }, [producto.id, cantidad, motivo, alTerminar]);

  return (
    <div className="capa-modal capa-modal--arriba">
      <section className="modal" data-prueba="modal-de-ajuste">
        <h2>Ajustar inventario</h2>
        <p className="modal__texto">
          {producto.nombre} · disponible hoy: {producto.inventarioDisponible} {unidad}
        </p>

        {mensaje !== null && <p className="modal__error">{mensaje}</p>}

        <label className="campo">
          <span className="campo__etiqueta">Cantidad recibida ({unidad})</span>
          <CampoDeTexto
            etiqueta={`Cantidad recibida (${unidad})`}
            disposicion={producto.tipoMedida === 'peso' ? 'decimal' : 'entero'}
            valor={cantidad}
            autoFocus
            data-prueba="ajuste-cantidad"
            alCambiar={setCantidad}
          />
        </label>

        <label className="campo">
          <span className="campo__etiqueta">Motivo (opcional)</span>
          <CampoDeTexto
            etiqueta="Motivo del ajuste"
            valor={motivo}
            maxLength={200}
            placeholder="Compra a proveedor…"
            data-prueba="ajuste-motivo"
            alCambiar={setMotivo}
          />
        </label>

        <p className="nota">
          Este ajuste solo suma mercadería recibida. Las mermas y pérdidas son otro módulo,
          todavía no disponible.
        </p>

        <div className="modal__acciones">
          <button
            type="button"
            disabled={trabajando || cantidad.trim().length === 0}
            data-prueba="ajuste-confirmar"
            onClick={registrar}
          >
            Registrar ingreso
          </button>
          <button type="button" className="boton--secundario" onClick={alCancelar}>
            Cancelar
          </button>
        </div>
      </section>
    </div>
  );
}
