/**
 * Los tres reportes, en una sola pantalla con tres solapas.
 *
 * NO CALCULA NADA. Ni una suma, ni un orden, ni un porcentaje: todos los
 * números llegan ya resueltos del proceso principal, que los saca con
 * Decimal.js. Si la ventana sumara, lo haría con aritmética de punto flotante
 * —es JavaScript del navegador, no hay Decimal acá— y el reporte diría un
 * número distinto del que dice la base. Es la misma razón por la que la
 * pantalla de venta no decide cuánto se cobra (§4.12).
 *
 * EL SELECTOR DE PERÍODO NO SE MUESTRA EN INVENTARIO, y es a propósito: el
 * inventario es la fotografía de HOY, no de un rango. Dejar el selector puesto
 * y que no hiciera nada invitaría a creer que se está viendo el inventario de
 * la semana pasada, que es un dato que este sistema no guarda.
 *
 * Solo es alcanzable con rol administrativo, pero eso no lo decide ella: el
 * proceso principal rechaza los tres canales con `requiereRol`.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  PeriodoIpc,
  ReporteDeInventarioIpc,
  ReporteDeVentasPorProductoIpc,
  ResumenDeVentasIpc,
} from '@shared/types/ipc';
import { CampoDeFecha } from './TecladoEnPantalla';

/** Qué reporte se está mirando. */
type Solapa = 'resumen' | 'productos' | 'inventario';

/** Las cinco opciones de período, en el orden en que se ofrecen. */
const PERIODOS: readonly { readonly clase: PeriodoIpc['clase']; readonly etiqueta: string }[] = [
  { clase: 'hoy', etiqueta: 'Hoy' },
  { clase: 'ayer', etiqueta: 'Ayer' },
  { clase: 'ultimos-7-dias', etiqueta: 'Últimos 7 días' },
  { clase: 'este-mes', etiqueta: 'Este mes' },
  { clase: 'personalizado', etiqueta: 'Rango personalizado' },
];

const SOLAPAS: readonly { readonly clave: Solapa; readonly etiqueta: string }[] = [
  { clave: 'resumen', etiqueta: 'Resumen de ventas' },
  { clave: 'productos', etiqueta: 'Ventas por producto' },
  { clave: 'inventario', etiqueta: 'Inventario' },
];

export function PantallaDeReportes({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [solapa, setSolapa] = useState<Solapa>('resumen');
  const [clase, setClase] = useState<PeriodoIpc['clase']>('hoy');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [ordenInventario, setOrdenInventario] = useState<'nombre' | 'cantidad'>('cantidad');

  const [resumen, setResumen] = useState<ResumenDeVentasIpc | null>(null);
  const [porProducto, setPorProducto] = useState<ReporteDeVentasPorProductoIpc | null>(null);
  const [inventario, setInventario] = useState<ReporteDeInventarioIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  /** Guarda lo que trajo la consulta, sea un reporte o un rechazo. */
  const aplicar = useCallback((traido: ReporteTraido): void => {
    if (!traido.ok) {
      setMensaje(traido.mensaje);
      return;
    }
    setMensaje(null);
    if (traido.cual === 'resumen') {
      setResumen(traido.datos);
    } else if (traido.cual === 'productos') {
      setPorProducto(traido.datos);
    } else {
      setInventario(traido.datos);
    }
  }, []);

  /** El botón «Ver» del rango personalizado. Acá sí se puede marcar la espera. */
  const consultarAMano = useCallback((): void => {
    setCargando(true);
    setMensaje(null);
    void (async (): Promise<void> => {
      const traido = await pedirReporte(solapa, { clase, desde, hasta }, ordenInventario);
      setCargando(false);
      aplicar(traido);
    })();
  }, [solapa, clase, desde, hasta, ordenInventario, aplicar]);

  /*
    UN EFECTO QUE EMPIEZA POR EL `await`, no por un `setState`.

    Cambiar de estado en el cuerpo de un efecto encadena renders y React lo
    marca; además, acá haría falta igual esperar la respuesta. Así que el efecto
    solo lanza la consulta —que es una función SIN estado, `pedirReporte`— y
    recién con la respuesta en la mano toca el estado. Es la misma forma que ya
    usan las otras pantallas que leen del proceso principal.

    El controlador descarta una respuesta que llegó tarde: sin él, cambiar de
    solapa dos veces rápido podría pintar el reporte anterior encima del nuevo.
  */
  useEffect(() => {
    if (clase === 'personalizado' && solapa !== 'inventario') {
      return undefined;
    }
    // Se usa un AbortController como en el resto de las pantallas: su `aborted`
    // es un booleano que TypeScript no estrecha, a diferencia de una bandera
    // suelta que dentro del cierre parece siempre `true`.
    const control = new AbortController();
    void (async (): Promise<void> => {
      const traido = await pedirReporte(solapa, { clase, desde, hasta }, ordenInventario);
      if (control.signal.aborted) {
        return;
      }
      setCargando(false);
      aplicar(traido);
    })();
    return (): void => {
      control.abort();
    };
  }, [solapa, clase, desde, hasta, ordenInventario, aplicar]);

  return (
    <div data-prueba="pantalla-de-reportes">
      <header className="encabezado">
        <h1>Reportes</h1>
        <p className="subtitulo">
          Los montos salen de lo que quedó guardado en cada venta, sumados con aritmética exacta.
          Solo se cuentan las ventas completadas.
        </p>
      </header>

      <div className="solapas" role="tablist">
        {SOLAPAS.map((una) => (
          <button
            key={una.clave}
            type="button"
            role="tab"
            aria-selected={solapa === una.clave}
            className={solapa === una.clave ? 'solapa solapa--activa' : 'solapa'}
            data-prueba={`solapa-${una.clave}`}
            onClick={() => {
              setMensaje(null);
              setSolapa(una.clave);
            }}
          >
            {una.etiqueta}
          </button>
        ))}
      </div>

      {solapa !== 'inventario' && (
        <section className="tarjeta">
          <div className="opciones" data-prueba="selector-de-periodo">
            {PERIODOS.map((periodo) => (
              <button
                key={periodo.clase}
                type="button"
                className={clase === periodo.clase ? 'opcion opcion--activa' : 'opcion'}
                data-prueba={`periodo-${periodo.clase}`}
                onClick={() => {
                  setClase(periodo.clase);
                }}
              >
                {periodo.etiqueta}
              </button>
            ))}
          </div>

          {clase === 'personalizado' && (
            <div className="filtros" data-prueba="rango-personalizado">
              <label className="campo">
                <span className="campo__etiqueta">Desde</span>
                <CampoDeFecha valor={desde} data-prueba="rango-desde" alCambiar={setDesde} />
              </label>
              <label className="campo">
                <span className="campo__etiqueta">Hasta</span>
                <CampoDeFecha valor={hasta} data-prueba="rango-hasta" alCambiar={setHasta} />
              </label>
              <button type="button" data-prueba="rango-ver" onClick={consultarAMano}>
                Ver
              </button>
            </div>
          )}
        </section>
      )}

      {mensaje !== null && (
        <p className="alerta" data-prueba="reportes-error">
          {mensaje}
        </p>
      )}

      {cargando && <p className="pendiente">Consultando…</p>}

      {!cargando && solapa === 'resumen' && resumen !== null && <Resumen datos={resumen} />}
      {!cargando && solapa === 'productos' && porProducto !== null && (
        <PorProducto datos={porProducto} />
      )}
      {!cargando && solapa === 'inventario' && inventario !== null && (
        <Inventario
          datos={inventario}
          orden={ordenInventario}
          alCambiarOrden={(nuevo) => {
            setOrdenInventario(nuevo);
          }}
        />
      )}

      <div className="pie">
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}

/** Tarea 1: cuánto entró y cómo se pagó. */
function Resumen({ datos }: { readonly datos: ResumenDeVentasIpc }): React.JSX.Element {
  return (
    <section className="tarjeta" data-prueba="reporte-resumen">
      <h2 className="reporte__titulo">{datos.periodo.etiqueta}</h2>

      {datos.cantidadDeVentas === 0 ? (
        <p className="pendiente" data-prueba="resumen-sin-ventas">
          No hay ventas completadas en este período.
        </p>
      ) : (
        <>
          <p className="reporte__destacado" data-prueba="resumen-total">
            Q{datos.totalVendido}
          </p>
          <div className="dato">
            <span className="dato__etiqueta">Ventas registradas</span>
            <span className="dato__valor" data-prueba="resumen-cantidad">
              {datos.cantidadDeVentas}
            </span>
          </div>
          <div className="dato">
            <span className="dato__etiqueta">
              En efectivo <small>({datos.ventasEnEfectivo})</small>
            </span>
            <span className="dato__valor" data-prueba="resumen-efectivo">
              Q{datos.totalEnEfectivo}
            </span>
          </div>
          <div className="dato">
            <span className="dato__etiqueta">
              Con tarjeta <small>({datos.ventasEnTarjeta})</small>
            </span>
            <span className="dato__valor" data-prueba="resumen-tarjeta">
              Q{datos.totalEnTarjeta}
            </span>
          </div>
          {/*
            Los descuentos van APARTE y con su aclaración: el total de arriba ya
            los tiene aplicados. Presentarlos como un renglón más de la lista
            invitaría a restarlos otra vez, que es la misma confusión que el
            recibo resolvió con su aclaración (§4.14).
          */}
          <div className="dato reporte__referencia">
            <span className="dato__etiqueta">
              Descuentos aplicados <small>({datos.ventasConDescuento})</small>
            </span>
            <span className="dato__valor" data-prueba="resumen-descuentos">
              Q{datos.totalDeDescuentos}
            </span>
          </div>
          <p className="nota">
            El total vendido ya viene con los descuentos aplicados. La última línea dice cuánto se
            dejó de cobrar, como referencia: no se le resta a nada.
          </p>
        </>
      )}
    </section>
  );
}

/** Tarea 2: qué se vendió en el período. */
function PorProducto({
  datos,
}: {
  readonly datos: ReporteDeVentasPorProductoIpc;
}): React.JSX.Element {
  return (
    <section className="tarjeta" data-prueba="reporte-por-producto">
      <h2 className="reporte__titulo">{datos.periodo.etiqueta}</h2>

      {datos.productos.length === 0 ? (
        <p className="pendiente" data-prueba="productos-sin-ventas">
          No se vendió ningún producto en este período.
        </p>
      ) : (
        <>
          <ul className="lista">
            {datos.productos.map((fila) => (
              <li className="lista__fila" key={fila.productoId} data-prueba="fila-de-producto">
                <span className="lista__principal">
                  <span className="lista__nombre">{fila.nombre}</span>
                  <span className="lista__detalle">
                    {fila.cantidadVendida} {fila.unidad} · {fila.vecesVendido}{' '}
                    {fila.vecesVendido === 1 ? 'venta' : 'ventas'}
                  </span>
                </span>
                <span className="reporte__montos">
                  <span className="dato__valor reporte__monto">Q{fila.montoGenerado}</span>
                  {/* «Sin dato» y no Q0.00: cero diría que el producto no deja
                      ganancia, y lo que pasa es que no se sabe su costo. */}
                  <span
                    className={
                      fila.margen === null
                        ? 'reporte__margen reporte__margen--sin-dato'
                        : 'reporte__margen'
                    }
                    data-prueba="margen-de-producto"
                  >
                    Margen: {fila.margen === null ? 'sin dato' : `Q${fila.margen}`}
                    {/* Cuántas líneas quedaron fuera, TAMBIÉN cuando son todas:
                        «sin dato» solo no dice si fue una venta o cien. */}
                    {fila.lineasSinCosto > 0 &&
                      ` (${String(fila.lineasSinCosto)} ${fila.lineasSinCosto === 1 ? 'línea' : 'líneas'} sin dato de costo)`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="dato">
            <span className="dato__etiqueta">Total del período</span>
            <span className="dato__valor" data-prueba="productos-total">
              Q{datos.montoTotal}
            </span>
          </div>
          <div className="dato">
            <span className="dato__etiqueta">Margen del período</span>
            <span className="dato__valor" data-prueba="margen-total">
              Q{datos.margenTotal}
            </span>
          </div>
          <div className="dato">
            <span className="dato__etiqueta">Líneas sin dato de costo (fuera del margen)</span>
            <span className="dato__valor" data-prueba="lineas-sin-costo">
              {datos.lineasSinCosto} · Q{datos.montoSinCosto}
            </span>
          </div>
          <p className="nota">
            El margen es lo cobrado menos el costo por la cantidad, con el costo que tenía el
            producto EL DÍA DE CADA VENTA: corregir el precio de compra hoy no cambia el margen de
            ventas ya registradas. Una venta sin costo conocido —anterior a este registro, o de un
            producto que entonces no tenía precio de compra— no entra en el margen y se cuenta
            aparte, nunca como margen cero.
          </p>
          <p className="nota">
            La cantidad es la de ESTE período. No es el acumulado de toda la vida del producto,
            que es otra medida y vive en el catálogo.
          </p>
        </>
      )}
    </section>
  );
}

/** Tarea 3: la fotografía del inventario de hoy. */
function Inventario({
  datos,
  orden,
  alCambiarOrden,
}: {
  readonly datos: ReporteDeInventarioIpc;
  readonly orden: 'nombre' | 'cantidad';
  readonly alCambiarOrden: (nuevo: 'nombre' | 'cantidad') => void;
}): React.JSX.Element {
  return (
    <section className="tarjeta" data-prueba="reporte-inventario">
      <div className="opciones">
        <button
          type="button"
          className={orden === 'cantidad' ? 'opcion opcion--activa' : 'opcion'}
          data-prueba="orden-cantidad"
          onClick={() => {
            alCambiarOrden('cantidad');
          }}
        >
          Menos disponible primero
        </button>
        <button
          type="button"
          className={orden === 'nombre' ? 'opcion opcion--activa' : 'opcion'}
          data-prueba="orden-nombre"
          onClick={() => {
            alCambiarOrden('nombre');
          }}
        >
          Por nombre
        </button>
      </div>

      {datos.productos.length === 0 ? (
        <p className="pendiente" data-prueba="inventario-vacio">
          No hay productos activos en el catálogo.
        </p>
      ) : (
        <ul className="lista">
          {datos.productos.map((fila) => (
            <li className="lista__fila" key={fila.productoId} data-prueba="fila-de-inventario">
              <span className="lista__principal">
                <span className="lista__nombre">{fila.nombre}</span>
                <span className="lista__detalle">{fila.categoria}</span>
              </span>
              <span className="dato__valor reporte__monto">
                {fila.inventarioDisponible} {fila.unidad}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="nota">
        Es el saldo de ahora mismo, de los {datos.total} productos activos. Todavía no hay umbral
        de stock mínimo ni alertas: cuál es el mínimo de cada producto es una definición que Jimmy
        no dio.
      </p>
    </section>
  );
}

/** Lo que devuelve una consulta: un reporte de alguna solapa, o un rechazo. */
type ReporteTraido =
  | { readonly ok: false; readonly mensaje: string }
  | { readonly ok: true; readonly cual: 'resumen'; readonly datos: ResumenDeVentasIpc }
  | {
      readonly ok: true;
      readonly cual: 'productos';
      readonly datos: ReporteDeVentasPorProductoIpc;
    }
  | { readonly ok: true; readonly cual: 'inventario'; readonly datos: ReporteDeInventarioIpc };

/**
 * Pide el reporte de una solapa. NO TOCA NINGÚN ESTADO de React.
 *
 * Vive fuera del componente justamente por eso: así el efecto que la llama no
 * cambia estado en su cuerpo, y quien lee el archivo ve de un vistazo que
 * consultar y pintar son dos pasos separados.
 */
async function pedirReporte(
  solapa: Solapa,
  rango: { readonly clase: PeriodoIpc['clase']; readonly desde: string; readonly hasta: string },
  orden: 'nombre' | 'cantidad',
): Promise<ReporteTraido> {
  const periodo: PeriodoIpc = {
    clase: rango.clase,
    desde: rango.desde === '' ? null : rango.desde,
    hasta: rango.hasta === '' ? null : rango.hasta,
  };

  if (solapa === 'resumen') {
    const respuesta = await window.pos.reportes.resumenDeVentas(periodo);
    return respuesta.ok
      ? { ok: true, cual: 'resumen', datos: respuesta.datos }
      : { ok: false, mensaje: respuesta.error.mensaje };
  }
  if (solapa === 'productos') {
    const respuesta = await window.pos.reportes.ventasPorProducto(periodo);
    return respuesta.ok
      ? { ok: true, cual: 'productos', datos: respuesta.datos }
      : { ok: false, mensaje: respuesta.error.mensaje };
  }
  const respuesta = await window.pos.reportes.inventario(orden);
  return respuesta.ok
    ? { ok: true, cual: 'inventario', datos: respuesta.datos }
    : { ok: false, mensaje: respuesta.error.mensaje };
}
