/**
 * Pruebas de la capa de acceso a datos.
 *
 * Lo que se verifica es que un valor escrito por un repositorio vuelve
 * EXACTAMENTE igual al leerlo, y que los identificadores son UUID generados en
 * el cliente. Sin lógica de negocio: eso llega en los módulos siguientes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import type { Database } from 'better-sqlite3';

import { crearRepositorios, type Repositorios } from '../repositories';
import { ErrorDeNegocio } from '../errores';
import { aCadena, montoACadena } from '@shared/money';
import { crearBaseMigrada } from './ayuda-base-de-datos';

let base: Database;
let repos: Repositorios;
let limpiar: () => void;

/** Patrón de un UUID versión 4. */
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  repos = crearRepositorios(base);
  limpiar = prueba.limpiar;
});

afterEach(() => {
  limpiar();
});

/** Siembra un catálogo mínimo y devuelve los ids que hacen falta. */
function sembrarCatalogo(): { usuarioId: string; categoriaId: string; productoId: string } {
  const usuario = repos.usuarios.crear({ nombre: 'Cajero', rol: 'venta', pinHash: 'hash' });
  const categoria = repos.categorias.crear({ nombre: 'Granos', orden: 1 });
  const producto = repos.productos.crear({
    nombre: 'Maíz',
    categoriaId: categoria.id,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '2.23',
    inventarioDisponible: '60',
  });
  return { usuarioId: usuario.id, categoriaId: categoria.id, productoId: producto.id };
}

// ===========================================================================

/**
 * Anota una venta de un producto, leyendo antes su acumulado.
 *
 * `registrarVentaDeProducto` es un comparar-y-cambiar: necesita saber contra
 * qué valor escribe. En producción ese valor lo tiene el servicio de venta,
 * que ya leyó el producto; acá se lee al vuelo.
 */
function anotarVenta(id: string, cantidad: string): void {
  const producto = repos.productos.obtenerPorId(id);
  if (producto === null) {
    throw new Error(`No existe el producto ${id}.`);
  }
  const nuevo = producto.cantidadVendida.plus(cantidad);
  const anotado = repos.productos.registrarVentaDeProducto(id, producto.cantidadVendida, nuevo);
  if (!anotado) {
    throw new Error(`No se pudo anotar la venta de ${id}.`);
  }
}

describe('Los identificadores son UUID generados en el cliente', () => {
  it('cada registro nuevo nace con un UUID versión 4', () => {
    const usuario = repos.usuarios.crear({ nombre: 'Cajero', rol: 'venta', pinHash: 'hash' });
    expect(usuario.id).toMatch(PATRON_UUID);
  });

  it('dos registros creados seguidos NO tienen ids consecutivos', () => {
    // Si fueran autoincrementales serían 1 y 2, y dos máquinas offline
    // producirían los mismos ids y colisionarían al sincronizar.
    const primero = repos.categorias.crear({ nombre: 'Granos' });
    const segundo = repos.categorias.crear({ nombre: 'Abarrotes' });

    expect(primero.id).not.toBe(segundo.id);
    expect(Number(primero.id)).toBeNaN();
  });
});

// ===========================================================================
describe('Usuarios', () => {
  it('crea y recupera un usuario con todos sus campos', () => {
    const creado = repos.usuarios.crear({ nombre: 'Jimmy', rol: 'administrativo', pinHash: 'h1' });
    const leido = repos.usuarios.obtenerPorId(creado.id);

    expect(leido).toEqual(creado);
    expect(leido?.rol).toBe('administrativo');
    expect(leido?.activo).toBe(true);
  });

  it('busca por nombre y lista por rol', () => {
    repos.usuarios.crear({ nombre: 'Cajero', rol: 'venta', pinHash: 'h' });
    repos.usuarios.crear({ nombre: 'Jimmy', rol: 'administrativo', pinHash: 'h' });

    expect(repos.usuarios.obtenerPorNombre('Jimmy')?.rol).toBe('administrativo');
    expect(repos.usuarios.listarPorRol('venta')).toHaveLength(1);
    expect(repos.usuarios.listarActivos()).toHaveLength(2);
  });

  it('desactivar es baja lógica: el usuario sigue existiendo', () => {
    const creado = repos.usuarios.crear({ nombre: 'Cajero', rol: 'venta', pinHash: 'h' });
    repos.usuarios.desactivar(creado.id);

    expect(repos.usuarios.obtenerPorId(creado.id)?.activo).toBe(false);
    expect(repos.usuarios.listarActivos()).toHaveLength(0);
  });

  it('devuelve null cuando el id no existe, en vez de lanzar', () => {
    expect(repos.usuarios.obtenerPorId('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

// ===========================================================================
describe('Productos e inventario acumulado', () => {
  it('los decimales vuelven como Decimal, no como number', () => {
    const { productoId } = sembrarCatalogo();
    const producto = repos.productos.obtenerPorId(productoId);

    expect(producto?.precioBase).toBeInstanceOf(Decimal);
    expect(producto?.inventarioDisponible).toBeInstanceOf(Decimal);
    expect(montoACadena(producto?.precioBase ?? '0')).toBe('2.23');
    expect(aCadena(producto?.inventarioDisponible ?? '0')).toBe('60');
  });

  it('el inventario es UN SOLO saldo: llegan 50 sacos sobre 10 y quedan 60', () => {
    const { categoriaId } = sembrarCatalogo();
    const azucar = repos.productos.crear({
      nombre: 'Azúcar',
      categoriaId,
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '1',
      precioBase: '4.11',
      inventarioDisponible: '10',
    });

    // El saldo nuevo lo calcula quien llama, con Decimal.js; el repositorio
    // solo lo guarda. Nunca se suma en SQL sobre un valor decimal.
    const saldoAnterior = azucar.inventarioDisponible;
    const nuevoSaldo = saldoAnterior.plus(new Decimal('50'));
    repos.productos.fijarInventario(azucar.id, nuevoSaldo);

    expect(aCadena(repos.productos.obtenerPorId(azucar.id)?.inventarioDisponible ?? '0')).toBe('60');
  });

  it('el contador de ventas sube de a uno y ordena los más vendidos', () => {
    const { categoriaId, productoId } = sembrarCatalogo();
    const frijol = repos.productos.crear({
      nombre: 'Frijol',
      categoriaId,
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '1',
      precioBase: '6.35',
      inventarioDisponible: '20',
    });

    anotarVenta(frijol.id, '1');
    anotarVenta(frijol.id, '2.500');
    anotarVenta(productoId, '1');

    expect(repos.productos.obtenerPorId(frijol.id)?.contadorVentas).toBe(2);
    // Dos ventas, pero 3.5 libras: las dos medidas son distintas y por eso
    // conviven en dos columnas.
    expect(repos.productos.obtenerPorId(frijol.id)?.cantidadVendida.toFixed(3)).toBe('3.500');
    const populares = repos.productos.listarMasVendidos(2);
    expect(populares[0]?.nombre).toBe('Frijol');
  });

  it('lista por categoría y solo los activos', () => {
    const { categoriaId, productoId } = sembrarCatalogo();
    expect(repos.productos.listarPorCategoria(categoriaId)).toHaveLength(1);

    repos.productos.desactivar(productoId);
    expect(repos.productos.listarPorCategoria(categoriaId)).toHaveLength(0);
    expect(repos.productos.obtenerPorId(productoId)?.activo).toBe(false);
  });
});

// ===========================================================================
describe('Precios especiales y límites de descuento', () => {
  it('un precio especial vigente se encuentra por su ventana de tiempo', () => {
    const { productoId } = sembrarCatalogo();
    repos.preciosEspeciales.crear({
      productoId,
      tipo: 'porcentaje',
      valor: '15',
      vigenteDesde: '2026-09-01T00:00:00.000Z',
      vigenteHasta: '2026-09-30T00:00:00.000Z',
    });

    expect(repos.preciosEspeciales.listarVigentes(productoId, '2026-09-15T00:00:00.000Z')).toHaveLength(1);
    expect(repos.preciosEspeciales.listarVigentes(productoId, '2026-10-15T00:00:00.000Z')).toHaveLength(0);
  });

  it('el límite de un rol se fija una vez y después se reemplaza', () => {
    const { usuarioId } = sembrarCatalogo();

    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '50',
      editadoPor: usuarioId,
    });
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '15',
      descuentoMaxMontoFijo: '75',
      editadoPor: usuarioId,
    });

    const limite = repos.limitesDescuento.obtenerPorRol('venta');
    expect(montoACadena(limite?.descuentoMaxPorcentaje ?? '0')).toBe('15.00');
    expect(repos.limitesDescuento.listar()).toHaveLength(1);
  });
});

// ===========================================================================
describe('Caja, ventas y detalle', () => {
  it('abre y cierra un turno de caja con su cuadre', () => {
    const { usuarioId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });

    expect(sesion.estado).toBe('abierta');
    expect(sesion.montoReal).toBeNull();
    expect(repos.cajaSesiones.obtenerAbierta()?.id).toBe(sesion.id);

    // El cierre lleva faltante, así que lleva autorizante: desde la migración
    // 008 la base rechaza un descuadre sin autorizar.
    const cerrada = repos.cajaSesiones.cerrar(sesion.id, {
      montoEsperado: '1250.75',
      montoReal: '1250.00',
      diferencia: '-0.75',
      autorizadaPor: usuarioId,
      autorizadaVia: 'presencial',
    });

    expect(cerrada.estado).toBe('cerrada');
    expect(montoACadena(cerrada.diferencia ?? '0')).toBe('-0.75');
    expect(cerrada.diferenciaAutorizadaVia).toBe('presencial');
    expect(repos.cajaSesiones.obtenerAbierta()).toBeNull();
  });

  it('la base rechaza cerrar con faltante sin decir quién lo autorizó', () => {
    const { usuarioId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });

    // Es la última línea de defensa: aunque el servicio de caja se saltara su
    // propia comprobación, el descuadre sin autorizar no llega al disco.
    expect(() =>
      repos.cajaSesiones.cerrar(sesion.id, {
        montoEsperado: '1250.75',
        montoReal: '1250.00',
        diferencia: '-0.75',
      }),
    ).toThrow(ErrorDeNegocio);

    expect(repos.cajaSesiones.obtenerAbierta()?.id).toBe(sesion.id);
  });

  it('una venta con su detalle: el subtotal exacto y el impreso se guardan por separado', () => {
    const { usuarioId, productoId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });

    const venta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '16.795',
      total: '16.80',
      formaPago: 'efectivo',
    });

    repos.ventaDetalle.crear({
      ventaId: venta.id,
      productoId,
      productoNombreSnap: 'Maíz',
      unidadSnap: 'lb',
      cantidad: '1.5',
      precioUnitarioSnap: '2.23',
      subtotalExacto: '3.345',
      subtotalImpreso: '3.35',
      ordenLinea: 0,
    });

    const linea = repos.ventaDetalle.listarPorVenta(venta.id)[0];
    expect(aCadena(linea?.subtotalExacto ?? '0')).toBe('3.345');
    expect(montoACadena(linea?.subtotalImpreso ?? '0')).toBe('3.35');
    expect(montoACadena(venta.total)).toBe('16.80');
  });

  it('el detalle vuelve en el ORDEN DE CAPTURA, que decide el desempate de centavos', () => {
    const { usuarioId, productoId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const venta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'efectivo',
    });

    // Se insertan a propósito en desorden.
    for (const orden of [2, 0, 1]) {
      repos.ventaDetalle.crear({
        ventaId: venta.id,
        productoId,
        productoNombreSnap: `Línea ${String(orden)}`,
        unidadSnap: 'lb',
        cantidad: '1',
        precioUnitarioSnap: '1',
        subtotalExacto: '1',
        subtotalImpreso: '1',
        ordenLinea: orden,
      });
    }

    const lineas = repos.ventaDetalle.listarPorVenta(venta.id);
    expect(lineas.map((l) => l.ordenLinea)).toEqual([0, 1, 2]);
    expect(lineas.map((l) => l.productoNombreSnap)).toEqual(['Línea 0', 'Línea 1', 'Línea 2']);
  });

  it('el nombre y el precio quedan congelados: cambiar el producto no cambia el recibo', () => {
    const { usuarioId, productoId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const venta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '3.35',
      total: '3.35',
      formaPago: 'efectivo',
    });
    repos.ventaDetalle.crear({
      ventaId: venta.id,
      productoId,
      productoNombreSnap: 'Maíz',
      unidadSnap: 'lb',
      cantidad: '1.5',
      precioUnitarioSnap: '2.23',
      subtotalExacto: '3.345',
      subtotalImpreso: '3.35',
      ordenLinea: 0,
    });

    // Después de la venta, el producto cambia de precio y se desactiva.
    repos.productos.actualizarPrecioBase(productoId, '9.99');
    repos.productos.desactivar(productoId);

    const linea = repos.ventaDetalle.listarPorVenta(venta.id)[0];
    expect(linea?.productoNombreSnap).toBe('Maíz');
    expect(montoACadena(linea?.precioUnitarioSnap ?? '0')).toBe('2.23');
  });

  it('anular una venta no la borra ni la toca: la anulación es una fila aparte', () => {
    const { usuarioId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const venta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'tarjeta',
      // Desde la migración 014 la base exige el número de boleta con tarjeta.
      numBoleta: '004512',
    });
    const antes = base.prepare('SELECT * FROM ventas WHERE id = ?').get(venta.id);

    const anulacion = repos.anulacionesDeVenta.crear({
      ventaId: venta.id,
      solicitadaPor: usuarioId,
      autorizadaPor: usuarioId,
      autorizadaVia: 'presencial',
      motivo: 'error de carga',
      fecha: '2026-09-15T12:00:00.000Z',
    });

    expect(repos.anulacionesDeVenta.obtenerPorVenta(venta.id)?.id).toBe(anulacion.id);
    expect(base.prepare('SELECT * FROM ventas WHERE id = ?').get(venta.id)).toEqual(antes);
    expect(repos.ventas.obtenerPorId(venta.id)?.estado).toBe('completada');
  });

  it('una venta nace pendiente de sincronizar', () => {
    const { usuarioId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const venta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'efectivo',
    });

    expect(venta.estadoSincronizacion).toBe('pendiente');
    expect(repos.ventas.listarPendientesDeSincronizar(10)).toHaveLength(1);

    repos.ventas.marcarSincronizacion(venta.id, 'sincronizado');
    expect(repos.ventas.listarPendientesDeSincronizar(10)).toHaveLength(0);
  });
});

// ===========================================================================
describe('Recibos', () => {
  it('numera los recibos de forma secuencial', () => {
    const { usuarioId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const venta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'efectivo',
    });

    expect(repos.recibos.siguienteNumero()).toBe(1);
    const recibo = repos.recibos.crear({
      ventaId: venta.id,
      numeroRecibo: repos.recibos.siguienteNumero(),
      pdfPath: '/tmp/recibo-1.pdf',
    });

    expect(recibo.numeroRecibo).toBe(1);
    expect(recibo.impreso).toBe(false);
    expect(repos.recibos.siguienteNumero()).toBe(2);

    repos.recibos.marcarImpreso(recibo.id);
    expect(repos.recibos.obtenerPorVenta(venta.id)?.impreso).toBe(true);
  });
});

// ===========================================================================
describe('Auditoría y cola de sincronización', () => {
  it('un asiento de auditoría guarda los valores como JSON', () => {
    const { usuarioId } = sembrarCatalogo();
    const asiento = repos.auditoria.registrar({
      usuarioId,
      accion: 'descuento_autorizado',
      entidadTipo: 'ventas',
      entidadId: '66666666-6666-4666-8666-666666666666',
      valorAnterior: { porcentaje: '10.00' },
      valorNuevo: { porcentaje: '25.00' },
    });

    expect(asiento.valorNuevo).toBe('{"porcentaje":"25.00"}');
    expect(repos.auditoria.listarPorEntidad('ventas', '66666666-6666-4666-8666-666666666666')).toHaveLength(1);
  });

  it('un asiento sin usuario queda registrado igual (acciones del sistema)', () => {
    const asiento = repos.auditoria.registrar({ accion: 'migracion_aplicada', entidadTipo: 'sistema' });
    expect(asiento.usuarioId).toBeNull();
  });

  it('la cola encola, cuenta pendientes y marca sincronizado', () => {
    const elemento = repos.syncCola.encolar({
      entidadTipo: 'ventas',
      entidadId: '66666666-6666-4666-8666-666666666666',
      operacion: 'insertar',
      payload: { total: '16.80' },
    });

    expect(repos.syncCola.contarPendientes()).toBe(1);
    expect(elemento.payload).toBe('{"total":"16.80"}');

    repos.syncCola.marcarError(elemento.id, 'sin conexión');
    expect(repos.syncCola.obtenerPorId(elemento.id)?.error).toBe('sin conexión');
    expect(repos.syncCola.contarPendientes()).toBe(1);

    repos.syncCola.marcarSincronizado(elemento.id);
    expect(repos.syncCola.contarPendientes()).toBe(0);
    expect(repos.syncCola.obtenerPorId(elemento.id)?.error).toBeNull();
  });
});

// ===========================================================================
describe('Transacciones: una venta se guarda entera o no se guarda', () => {
  it('si algo falla a la mitad, no queda ni la venta ni el contador movido', () => {
    const { usuarioId, productoId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const contadorAntes = repos.productos.obtenerPorId(productoId)?.contadorVentas ?? -1;

    const registrarVentaRota = base.transaction((): void => {
      const venta = repos.ventas.crear({
        cajaSesionId: sesion.id,
        usuarioId,
        subtotal: '10.00',
        total: '10.00',
        formaPago: 'efectivo',
      });
      anotarVenta(productoId, '1');
      // Falla al final: la línea apunta a un producto que no existe.
      repos.ventaDetalle.crear({
        ventaId: venta.id,
        productoId: '00000000-0000-4000-8000-000000000000',
        productoNombreSnap: 'Fantasma',
        unidadSnap: 'lb',
        cantidad: '1',
        precioUnitarioSnap: '1',
        subtotalExacto: '1',
        subtotalImpreso: '1',
        ordenLinea: 0,
      });
    });

    // El error llega ya traducido a lenguaje de negocio, no como el texto
    // crudo de SQLite: de eso se encarga RepositorioBase.ejecutar().
    expect(() => { registrarVentaRota(); }).toThrow(ErrorDeNegocio);
    expect(() => { registrarVentaRota(); }).toThrow(/hace referencia a un registro que no existe/);

    const ventas = base.prepare('SELECT COUNT(*) AS total FROM ventas').get() as { total: number };
    expect(ventas.total).toBe(0);
    expect(repos.productos.obtenerPorId(productoId)?.contadorVentas).toBe(contadorAntes);
  });
});
