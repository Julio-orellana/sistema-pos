/**
 * Los tres reportes, contra ventas REGISTRADAS DE VERDAD.
 *
 * Las ventas se hacen con `ServicioDeVenta`, la misma transacción que corre en
 * el mostrador, y no insertando filas a mano. Si se armaran a mano, un reporte
 * podría dar bien sobre datos que la aplicación nunca habría producido, y la
 * prueba no diría nada sobre la tienda real.
 *
 * El reloj es INYECTADO: tanto el servicio de venta como el de reportes reciben
 * un `ahora` que estas pruebas mueven a voluntad. Así se pueden registrar
 * ventas de ayer y de hoy y pedir el reporte de un día concreto, sin esperar a
 * que pase la medianoche y sin que el resultado dependa de la hora a la que
 * alguien corra `npm test`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { montoACadena, sumarLista } from '@shared/money';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { LogTecnicoSilencioso } from '@main/log-tecnico';
import { ServicioDeReportes } from '../servicio-de-reportes';

let base: Database;
let repos: Repositorios;
let venta: ServicioDeVenta;
let reportes: ServicioDeReportes;
let limpiar: () => void;

let idCajera: string;
let idJimmy: string;
let idMaiz: string;
let idFrijol: string;
let idAzucar: string;

/** El reloj que ven los dos servicios. Las pruebas lo mueven. */
let reloj = 0;

/** Las 14:00 de Guatemala del 11 de septiembre de 2026. */
const HOY_TARDE = Date.parse('2026-09-11T20:00:00.000Z');

/** Las 20:30 de Guatemala del 11: en UTC ya es el 12. */
const HOY_NOCHE = Date.parse('2026-09-12T02:30:00.000Z');

/** Las 10:00 de Guatemala del 10 de septiembre. */
const AYER = Date.parse('2026-09-10T16:00:00.000Z');

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  reloj = HOY_TARDE;

  const caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  venta = new ServicioDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    preciosEspeciales: repos.preciosEspeciales,
    limitesDescuento: repos.limitesDescuento,
    cajaSesiones: repos.cajaSesiones,
    auditoria: repos.auditoria,
    log: new LogTecnicoSilencioso(),
    ahora: (): number => reloj,
  });
  reportes = new ServicioDeReportes({
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    categorias: repos.categorias,
    ahora: (): number => reloj,
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin('2468'),
  }).id;
  idCajera = repos.usuarios.crear({
    nombre: 'Ana',
    rol: 'venta',
    pinHash: generarHashDePin('1357'),
  }).id;

  const granos = repos.categorias.crear({ nombre: 'Granos' }).id;
  const abarrotes = repos.categorias.crear({ nombre: 'Abarrotes' }).id;

  idMaiz = repos.productos.crear({
    nombre: 'Maíz blanco',
    categoriaId: granos,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '6.00',
    inventarioDisponible: '500',
  }).id;
  idFrijol = repos.productos.crear({
    nombre: 'Frijol negro',
    categoriaId: granos,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '9.00',
    inventarioDisponible: '80',
  }).id;
  idAzucar = repos.productos.crear({
    nombre: 'Azúcar',
    categoriaId: abarrotes,
    tipoMedida: 'unidad',
    unidadPeso: null,
    cantidadPredefinidaIcono: '1',
    precioBase: '5.50',
    inventarioDisponible: '9',
  }).id;

  caja.abrir(idCajera, { modo: 'simple', monto: '500' });
});

afterEach(() => {
  limpiar();
});

/** Registra una venta al instante indicado y devuelve su total impreso. */
function vender(
  instante: number,
  lineas: readonly { readonly productoId: string; readonly cantidad: string }[],
  opciones: {
    readonly formaPago?: 'efectivo' | 'tarjeta';
    readonly descuento?: { readonly tipo: 'porcentaje' | 'monto_fijo'; readonly valor: string };
  } = {},
): string {
  const anterior = reloj;
  reloj = instante;
  const formaPago = opciones.formaPago ?? 'efectivo';
  const resultado = venta.registrar(idCajera, 'venta', {
    lineas: [...lineas],
    descuento: opciones.descuento === undefined ? null : { ...opciones.descuento },
    formaPago,
    numBoleta: formaPago === 'tarjeta' ? '004512' : null,
  });
  reloj = anterior;
  return montoACadena(resultado.venta.total);
}

// ===========================================================================
describe('Tarea 1 — El resumen de ventas de un período', () => {
  it('sin ventas, el total es 0.00 y no un hueco', () => {
    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(resumen.cantidadDeVentas).toBe(0);
    expect(resumen.totalVendido).toBe('0.00');
    expect(resumen.totalEnEfectivo).toBe('0.00');
    expect(resumen.totalEnTarjeta).toBe('0.00');
    expect(resumen.totalDeDescuentos).toBe('0.00');
  });

  it('suma los totales de las ventas del día y cuenta las transacciones', () => {
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);
    vender(HOY_TARDE, [{ productoId: idFrijol, cantidad: '1' }]);

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(resumen.cantidadDeVentas).toBe(2);
    expect(resumen.totalVendido).toBe('21.00');
  });

  it('NO INCLUYE las ventas de ayer al pedir HOY', () => {
    vender(AYER, [{ productoId: idMaiz, cantidad: '10' }]);
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);

    expect(reportes.resumenDeVentas({ clase: 'hoy' }).totalVendido).toBe('12.00');
    expect(reportes.resumenDeVentas({ clase: 'ayer' }).totalVendido).toBe('60.00');
  });

  it('UNA VENTA DE LAS 20:30 CUENTA COMO DE HOY, no de mañana', () => {
    /*
      El defecto que el módulo de período evita. A las 20:30 de Guatemala el día
      UTC ya avanzó, así que sin convertir la zona esta venta se le atribuiría al
      12 de septiembre y el reporte de la noche del 11 diría que no se vendió
      nada desde las 18:00.
    */
    vender(HOY_NOCHE, [{ productoId: idMaiz, cantidad: '3' }]);

    reloj = HOY_NOCHE;
    expect(reportes.resumenDeVentas({ clase: 'hoy' }).totalVendido).toBe('18.00');
    expect(reportes.resumenDeVentas({ clase: 'hoy' }).cantidadDeVentas).toBe(1);
  });

  it('una venta ANULADA no entra en el reporte, y la decide su fila de anulación, no ventas.estado', () => {
    // Se inserta la fila de anulación directo por el repositorio: acá se prueba
    // el FILTRO del reporte, no el servicio de anulación, que tiene sus pruebas.
    const total = vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);
    vender(HOY_TARDE, [{ productoId: idFrijol, cantidad: '1' }]);
    expect(total).toBe('12.00');

    const primera = repos.ventas.listarPorRango('2000-01-01', '2100-01-01')[0];
    repos.anulacionesDeVenta.crear({
      ventaId: primera?.id ?? '',
      solicitadaPor: idCajera,
      autorizadaPor: idJimmy,
      autorizadaVia: 'presencial',
      motivo: 'prueba del filtro del reporte',
      fecha: new Date(HOY_TARDE).toISOString(),
    });

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });
    expect(resumen.cantidadDeVentas).toBe(1);
    expect(resumen.totalVendido).toBe('9.00');
    // La fila de la venta dice 'completada' igual: el reporte no la mira.
    expect(repos.ventas.obtenerPorId(primera?.id ?? '')?.estado).toBe('completada');
  });
});

// ===========================================================================
describe('EFECTIVO + TARJETA da EXACTAMENTE el total general', () => {
  it('con una venta de cada forma de pago', () => {
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }], { formaPago: 'efectivo' });
    vender(HOY_TARDE, [{ productoId: idFrijol, cantidad: '1' }], { formaPago: 'tarjeta' });

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(resumen.totalEnEfectivo).toBe('12.00');
    expect(resumen.totalEnTarjeta).toBe('9.00');
    expect(montoACadena(sumarLista([resumen.totalEnEfectivo, resumen.totalEnTarjeta]))).toBe(
      resumen.totalVendido,
    );
  });

  it('con SOLO efectivo: la tarjeta queda en 0.00 y la suma sigue cerrando', () => {
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '1' }]);
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '1' }]);

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(resumen.totalEnTarjeta).toBe('0.00');
    expect(montoACadena(sumarLista([resumen.totalEnEfectivo, resumen.totalEnTarjeta]))).toBe(
      resumen.totalVendido,
    );
  });

  it('con SOLO tarjeta', () => {
    vender(HOY_TARDE, [{ productoId: idFrijol, cantidad: '2' }], { formaPago: 'tarjeta' });

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(resumen.totalEnEfectivo).toBe('0.00');
    expect(resumen.totalEnTarjeta).toBe('18.00');
    expect(montoACadena(sumarLista([resumen.totalEnEfectivo, resumen.totalEnTarjeta]))).toBe(
      resumen.totalVendido,
    );
  });

  it('con DESCUENTOS de por medio: el descuento no descuadra el desglose', () => {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '50',
      descuentoMaxMontoFijo: '500',
      editadoPor: idJimmy,
    });
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '3' }], {
      descuento: { tipo: 'porcentaje', valor: '7.5' },
    });
    vender(HOY_TARDE, [{ productoId: idFrijol, cantidad: '1' }], {
      formaPago: 'tarjeta',
      descuento: { tipo: 'monto_fijo', valor: '1.33' },
    });

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(montoACadena(sumarLista([resumen.totalEnEfectivo, resumen.totalEnTarjeta]))).toBe(
      resumen.totalVendido,
    );
  });

  it('CON MUCHAS VENTAS de montos que en punto flotante NO cerrarían', () => {
    /*
      ES LA PRUEBA QUE JUSTIFICA LA REGLA. Se registran veinte ventas con
      cantidades que producen totales de los que rompen la aritmética de punto
      flotante, se suman aparte con `Number` —que es lo que haría un `SUM()` de
      SQL o un reporte escrito en la ventana— y se comprueba que ESA suma no da
      el mismo número que la del reporte.
    */
    const cantidades = ['0.05', '0.1', '0.15', '0.35', '0.55', '1.15', '1.45', '0.005', '0.01', '0.015'];
    for (const cantidad of cantidades) {
      vender(HOY_TARDE, [{ productoId: idMaiz, cantidad }], { formaPago: 'efectivo' });
      vender(HOY_TARDE, [{ productoId: idFrijol, cantidad }], { formaPago: 'tarjeta' });
    }

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });
    expect(resumen.cantidadDeVentas).toBe(cantidades.length * 2);

    // Exacto: efectivo + tarjeta da el total, al centavo.
    expect(montoACadena(sumarLista([resumen.totalEnEfectivo, resumen.totalEnTarjeta]))).toBe(
      resumen.totalVendido,
    );

    // Y la suma de los MISMOS totales hecha con `number` se desvía del valor
    // exacto: es el error que la regla evita, medido sobre estas ventas.
    const guardadas = repos.ventas.listarPorRango('2000-01-01', '2100-01-01');
    const sumaConFloat = guardadas.reduce(
      (acumulado, una) => acumulado + Number(montoACadena(una.total)),
      0,
    );
    expect(sumaConFloat).not.toBe(Number(resumen.totalVendido));
    expect(montoACadena(sumarLista(guardadas.map((una) => una.total)))).toBe(
      resumen.totalVendido,
    );
  });
});

// ===========================================================================
describe('Los descuentos son una REFERENCIA, no un sumando', () => {
  beforeEach(() => {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '50',
      descuentoMaxMontoFijo: '500',
      editadoPor: idJimmy,
    });
  });

  it('suma solo las ventas que llevaron descuento, y las cuenta', () => {
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }], {
      descuento: { tipo: 'monto_fijo', valor: '2.00' },
    });
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(resumen.ventasConDescuento).toBe(1);
    expect(resumen.totalDeDescuentos).toBe('2.00');
  });

  it('EL TOTAL VENDIDO YA VIENE DESCONTADO: no se le vuelve a restar', () => {
    // Q12 de maíz menos Q2 de descuento: el total guardado es Q10, que es lo que
    // el cliente pagó. Restarle otra vez los Q2 daría Q8, un número que nunca
    // existió.
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }], {
      descuento: { tipo: 'monto_fijo', valor: '2.00' },
    });

    const resumen = reportes.resumenDeVentas({ clase: 'hoy' });

    expect(resumen.totalVendido).toBe('10.00');
    expect(resumen.totalDeDescuentos).toBe('2.00');
  });

  it('el descuento en PORCENTAJE se informa como el valor configurado, no en quetzales', () => {
    // `ventas.descuento_valor` guarda el 7.5, no los Q1.35 que rebajó. Es lo que
    // se pidió sumar, y hay que saber leerlo: no es dinero.
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '3' }], {
      descuento: { tipo: 'porcentaje', valor: '7.5' },
    });

    expect(reportes.resumenDeVentas({ clase: 'hoy' }).totalDeDescuentos).toBe('7.50');
  });
});

// ===========================================================================
describe('Tarea 2 — Ventas por producto, EN EL PERÍODO', () => {
  it('suma la cantidad y el monto de cada producto, sin ceros decorativos', () => {
    vender(HOY_TARDE, [
      { productoId: idMaiz, cantidad: '2' },
      { productoId: idFrijol, cantidad: '1' },
    ]);
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '3' }]);

    const reporte = reportes.ventasPorProducto({ clase: 'hoy' });
    const maiz = reporte.productos.find((fila) => fila.productoId === idMaiz);
    const frijol = reporte.productos.find((fila) => fila.productoId === idFrijol);

    expect(maiz?.cantidadVendida).toBe('5');
    expect(maiz?.montoGenerado).toBe('30.00');
    expect(maiz?.vecesVendido).toBe(2);
    expect(frijol?.cantidadVendida).toBe('1');
    expect(frijol?.montoGenerado).toBe('9.00');
    expect(frijol?.vecesVendido).toBe(1);
  });

  it('ordena por monto generado, de mayor a menor', () => {
    vender(HOY_TARDE, [
      { productoId: idMaiz, cantidad: '1' },
      { productoId: idFrijol, cantidad: '5' },
      { productoId: idAzucar, cantidad: '2' },
    ]);

    const reporte = reportes.ventasPorProducto({ clase: 'hoy' });

    expect(reporte.productos.map((fila) => fila.nombre)).toEqual([
      'Frijol negro',
      'Azúcar',
      'Maíz blanco',
    ]);
  });

  it('no lista un producto que no se vendió en el período', () => {
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '1' }]);

    const reporte = reportes.ventasPorProducto({ clase: 'hoy' });
    expect(reporte.productos).toHaveLength(1);
    expect(reporte.productos[0]?.productoId).toBe(idMaiz);
  });

  it('el monto total del reporte cuadra con el total vendido del resumen', () => {
    // Los dos reportes salen de tablas distintas —`ventas` y `venta_detalle`— y
    // tienen que dar el mismo número. Si no cuadraran, uno de los dos miente.
    vender(HOY_TARDE, [
      { productoId: idMaiz, cantidad: '2.333' },
      { productoId: idFrijol, cantidad: '1.777' },
    ]);
    vender(HOY_TARDE, [{ productoId: idAzucar, cantidad: '3' }], { formaPago: 'tarjeta' });

    expect(reportes.ventasPorProducto({ clase: 'hoy' }).montoTotal).toBe(
      reportes.resumenDeVentas({ clase: 'hoy' }).totalVendido,
    );
  });

  it('CON DESCUENTO también cuadra: se suma `subtotal_impreso`, que suma el total', () => {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '50',
      descuentoMaxMontoFijo: '500',
      editadoPor: idJimmy,
    });
    vender(
      HOY_TARDE,
      [
        { productoId: idMaiz, cantidad: '0.333' },
        { productoId: idFrijol, cantidad: '1.777' },
      ],
      { descuento: { tipo: 'porcentaje', valor: '7.5' } },
    );

    expect(reportes.ventasPorProducto({ clase: 'hoy' }).montoTotal).toBe(
      reportes.resumenDeVentas({ clase: 'hoy' }).totalVendido,
    );
  });
});

// ===========================================================================
describe('LA CANTIDAD DEL PERÍODO NO ES EL ACUMULADO HISTÓRICO', () => {
  /*
    Es la confusión que el reporte existe para no cometer. `contador_ventas` y
    `cantidad_vendida` guardan las mismas dos medidas pero de TODA la vida del
    producto, y no se pueden acotar: nadie guardó su valor al empezar el
    período. Usarlas acá daría el histórico bajo una etiqueta que dice «hoy».
  */
  beforeEach(() => {
    vender(AYER, [{ productoId: idMaiz, cantidad: '10' }]);
    vender(AYER, [{ productoId: idMaiz, cantidad: '5' }]);
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);
  });

  it('el acumulado del catálogo dice 17 libras en 3 ventas: toda la vida del producto', () => {
    const maiz = repos.productos.obtenerPorId(idMaiz);
    expect(maiz?.cantidadVendida.toFixed(3)).toBe('17.000');
    expect(maiz?.contadorVentas).toBe(3);
  });

  it('EL REPORTE DE HOY dice 2 libras en 1 venta, no 17 en 3', () => {
    const hoy = reportes.ventasPorProducto({ clase: 'hoy' });
    const maiz = hoy.productos.find((fila) => fila.productoId === idMaiz);

    expect(maiz?.cantidadVendida).toBe('2');
    expect(maiz?.vecesVendido).toBe(1);
    expect(maiz?.cantidadVendida).not.toBe('17');
  });

  it('el de AYER dice 15 libras en 2 ventas', () => {
    const ayer = reportes.ventasPorProducto({ clase: 'ayer' });
    const maiz = ayer.productos.find((fila) => fila.productoId === idMaiz);

    expect(maiz?.cantidadVendida).toBe('15');
    expect(maiz?.vecesVendido).toBe(2);
  });

  it('y los dos períodos SUMADOS sí dan el acumulado: son los mismos hechos', () => {
    const hoy = reportes.ventasPorProducto({ clase: 'hoy' }).productos[0]?.cantidadVendida ?? '0';
    const ayer = reportes.ventasPorProducto({ clase: 'ayer' }).productos[0]?.cantidadVendida ?? '0';

    expect(sumarLista([hoy, ayer]).toFixed(3)).toBe(
      repos.productos.obtenerPorId(idMaiz)?.cantidadVendida.toFixed(3),
    );
  });
});

// ===========================================================================
describe('Tarea 3 — El estado de inventario', () => {
  it('lista todos los productos activos con su categoría y su unidad', () => {
    const reporte = reportes.inventario('nombre');

    expect(reporte.total).toBe(3);
    const maiz = reporte.productos.find((fila) => fila.productoId === idMaiz);
    expect(maiz?.categoria).toBe('Granos');
    expect(maiz?.unidad).toBe('lb');
    expect(maiz?.inventarioDisponible).toBe('500.000');

    const azucar = reporte.productos.find((fila) => fila.productoId === idAzucar);
    expect(azucar?.categoria).toBe('Abarrotes');
    expect(azucar?.unidad).toBe('u');
  });

  it('un producto DESACTIVADO no aparece', () => {
    repos.productos.fijarActivo(idAzucar, false);
    const reporte = reportes.inventario('nombre');

    expect(reporte.total).toBe(2);
    expect(reporte.productos.some((fila) => fila.productoId === idAzucar)).toBe(false);
  });

  it('ordenado por NOMBRE va alfabético', () => {
    expect(reportes.inventario('nombre').productos.map((fila) => fila.nombre)).toEqual([
      'Azúcar',
      'Frijol negro',
      'Maíz blanco',
    ]);
  });

  it('ORDENADO POR CANTIDAD pone primero lo que MENOS queda, numéricamente', () => {
    /*
      Azúcar tiene 9, frijol 80 y maíz 500. Ordenado alfabéticamente —que es lo
      que haría un `ORDER BY` de SQL sobre esta columna TEXT— «500.000» iría
      antes que «80.000» y «9.000» quedaría último: exactamente al revés de para
      lo que sirve el reporte.
    */
    const porCantidad = reportes.inventario('cantidad').productos;

    expect(porCantidad.map((fila) => fila.nombre)).toEqual([
      'Azúcar',
      'Frijol negro',
      'Maíz blanco',
    ]);
    expect(porCantidad.map((fila) => fila.inventarioDisponible)).toEqual([
      '9.000',
      '80.000',
      '500.000',
    ]);
  });

  it('el orden por cantidad NO es el alfabético de esas mismas cadenas', () => {
    // La contraprueba explícita: si alguien volviera a ordenar en SQL, el
    // resultado sería este otro, y esta prueba lo diría.
    const cantidades = reportes.inventario('cantidad').productos.map(
      (fila) => fila.inventarioDisponible,
    );
    const alfabetico = [...cantidades].sort();

    expect(cantidades).not.toEqual(alfabetico);
    expect(alfabetico).toEqual(['500.000', '80.000', '9.000']);
  });

  it('refleja lo que la venta descontó, sin recalcular nada', () => {
    vender(HOY_TARDE, [{ productoId: idAzucar, cantidad: '4' }]);

    const azucar = reportes
      .inventario('nombre')
      .productos.find((fila) => fila.productoId === idAzucar);

    expect(azucar?.inventarioDisponible).toBe('5.000');
  });

  it('dos productos con el mismo saldo se desempatan por nombre, siempre igual', () => {
    repos.productos.fijarInventario(idFrijol, '9');
    const primera = reportes.inventario('cantidad').productos.map((fila) => fila.nombre);
    const segunda = reportes.inventario('cantidad').productos.map((fila) => fila.nombre);

    expect(primera).toEqual(segunda);
    // Azúcar y frijol quedan los dos en 9.000: el desempate por nombre decide,
    // y decide siempre igual.
    expect(primera).toEqual(['Azúcar', 'Frijol negro', 'Maíz blanco']);
  });
});

// ===========================================================================
/**
 * El margen por producto, calculado con la FOTO del costo de cada línea
 * (`venta_detalle.costo_unitario_snap`, migración 032, §4.40), igual que el
 * recibo usa la foto del precio. Corregir el costo hoy no puede cambiar el
 * margen de una venta ya registrada.
 */
describe('EL MARGEN USA LA FOTO DEL COSTO DE CADA VENTA, no el catálogo de hoy', () => {
  const fijarCosto = (productoId: string, costo: string | null): void => {
    base.prepare('UPDATE productos SET precio_compra = ? WHERE id = ?').run(costo, productoId);
  };
  /** Simula una venta registrada ANTES de la 032: su línea no tiene foto del costo. */
  const borrarFotoDelCosto = (productoId: string): void => {
    base.prepare('UPDATE venta_detalle SET costo_unitario_snap = NULL WHERE producto_id = ?').run(productoId);
  };
  const filaDe = (productoId: string): ReturnType<ServicioDeReportes['ventasPorProducto']>['productos'][number] | undefined =>
    reportes.ventasPorProducto({ clase: 'hoy' }).productos.find((f) => f.productoId === productoId);

  it('UNA VENTA DE HOY CAPTURA EL COSTO VIGENTE en ese momento', () => {
    fijarCosto(idMaiz, '4.50');
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);

    const linea = base
      .prepare('SELECT costo_unitario_snap FROM venta_detalle WHERE producto_id = ?')
      .get(idMaiz) as { costo_unitario_snap: string | null };
    expect(linea.costo_unitario_snap).toBe('4.50');
  });

  it('margen = cobrado − costo × cantidad', () => {
    fijarCosto(idMaiz, '4.50');
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '3' }]);

    // 5 lb a Q6 = Q30; costo 5 × 4.50 = Q22.50.
    expect(filaDe(idMaiz)?.montoGenerado).toBe('30.00');
    expect(filaDe(idMaiz)?.margen).toBe('7.50');
    expect(filaDe(idMaiz)?.lineasSinCosto).toBe(0);
  });

  it('SI EL COSTO CAMBIA DESPUÉS, el margen de la venta ya registrada NO cambia', () => {
    fijarCosto(idMaiz, '4.50');
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);
    expect(filaDe(idMaiz)?.margen).toBe('3.00');

    fijarCosto(idMaiz, '5.90');
    expect(filaDe(idMaiz)?.margen).toBe('3.00');
    fijarCosto(idMaiz, null);
    expect(filaDe(idMaiz)?.margen).toBe('3.00');
  });

  it('una venta NUEVA después del cambio usa el costo NUEVO, y cada una conserva el suyo', () => {
    fijarCosto(idMaiz, '4.50');
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);
    fijarCosto(idMaiz, '5.00');
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);

    // (12 − 9) + (12 − 10) = 5.
    expect(filaDe(idMaiz)?.margen).toBe('5.00');
  });

  it('UNA VENTA ANTERIOR A ESTE CAMBIO (sin foto del costo) queda fuera del margen, NO como margen cero', () => {
    vender(HOY_TARDE, [{ productoId: idFrijol, cantidad: '1' }]);
    borrarFotoDelCosto(idFrijol);
    // Aunque HOY el frijol tenga costo: no se inventa retroactivamente.
    fijarCosto(idFrijol, '7.00');

    const frijol = filaDe(idFrijol);
    expect(frijol?.margen).toBeNull();
    expect(frijol?.margen).not.toBe('0.00');
    expect(frijol?.lineasSinCosto).toBe(1);
  });

  it('un producto que NO TENÍA costo al venderse tampoco entra, y se cuenta aparte', () => {
    vender(HOY_TARDE, [{ productoId: idAzucar, cantidad: '2' }]);

    const azucar = filaDe(idAzucar);
    expect(azucar?.margen).toBeNull();
    expect(azucar?.lineasSinCosto).toBe(1);
  });

  it('en un mismo producto, las líneas con costo dan margen y las sin costo se cuentan aparte', () => {
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '1' }]);
    fijarCosto(idMaiz, '4.00');
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '2' }]);

    const maiz = filaDe(idMaiz);
    // Solo la segunda venta: 12 − 8 = 4. La primera (Q6) no suma cero al margen.
    expect(maiz?.margen).toBe('4.00');
    expect(maiz?.lineasSinCosto).toBe(1);
  });

  it('EL REPORTE DICE CUÁNTAS LÍNEAS quedaron sin dato de costo en el período, y cuánto se cobró en ellas', () => {
    fijarCosto(idMaiz, '4.50');
    vender(HOY_TARDE, [
      { productoId: idMaiz, cantidad: '5' },
      { productoId: idFrijol, cantidad: '1' },
      { productoId: idAzucar, cantidad: '2' },
    ]);

    const reporte = reportes.ventasPorProducto({ clase: 'hoy' });
    expect(reporte.margenTotal).toBe('7.50');
    expect(reporte.lineasSinCosto).toBe(2);
    // Frijol Q9.00 + azúcar Q11.00.
    expect(reporte.montoSinCosto).toBe('20.00');
  });

  it('un costo IGUAL al precio da 0.00: no deja ganancia, que es distinto de no saberlo', () => {
    fijarCosto(idFrijol, '9.00');
    vender(HOY_TARDE, [{ productoId: idFrijol, cantidad: '2' }]);
    expect(filaDe(idFrijol)?.margen).toBe('0.00');
  });

  it('vender por debajo del costo da un margen NEGATIVO, que se informa tal cual', () => {
    fijarCosto(idAzucar, '8.00');
    vender(HOY_TARDE, [{ productoId: idAzucar, cantidad: '2' }]);
    expect(filaDe(idAzucar)?.margen).toBe('-5.00');
  });

  it('SE REDONDEA UNA SOLA VEZ, al final: tres ventas de 0.333 lb no acumulan centavos', () => {
    // Cada venta: 0.333 × 6.00 = 1.998 → cobrado Q2.00. Costo exacto de las
    // tres: 0.999 × 4.55 = 4.54545. Margen = 6.00 − 4.54545 = 1.45455 → 1.45.
    // Redondeando cada línea (2.00 − 1.52 = 0.48, × 3 = 1.44) daría un
    // centavo en contra de la tienda.
    fijarCosto(idMaiz, '4.55');
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '0.333' }]);
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '0.333' }]);
    vender(HOY_TARDE, [{ productoId: idMaiz, cantidad: '0.333' }]);

    expect(filaDe(idMaiz)?.montoGenerado).toBe('6.00');
    expect(filaDe(idMaiz)?.margen).toBe('1.45');
  });

  it('el margen total cuadra con la suma de la columna que se ve', () => {
    fijarCosto(idMaiz, '4.55');
    fijarCosto(idFrijol, '7.33');
    vender(HOY_TARDE, [
      { productoId: idMaiz, cantidad: '0.333' },
      { productoId: idFrijol, cantidad: '1.777' },
    ]);

    const reporte = reportes.ventasPorProducto({ clase: 'hoy' });
    const columna = sumarLista(
      reporte.productos.map((f) => f.margen).filter((m): m is string => m !== null),
    );
    expect(reporte.margenTotal).toBe(montoACadena(columna));
  });
});
