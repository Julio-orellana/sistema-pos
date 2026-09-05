/**
 * Pruebas de la traducción de errores de base de datos a errores de negocio.
 *
 * Verifica que cuando la base rechaza una operación, lo que llega a la interfaz
 * es un mensaje que un cajero puede leer, y no el texto crudo de SQLite.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { ErrorDeNegocio, errorDeConflictoDeInventario, traducirErrorDeBaseDeDatos } from '../errores';
import { crearRepositorios, type Repositorios } from '../repositories';
import { crearBaseMigrada } from './ayuda-base-de-datos';

let base: Database;
let repos: Repositorios;
let limpiar: () => void;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  repos = crearRepositorios(base);
  limpiar = prueba.limpiar;
});

afterEach(() => {
  limpiar();
});

/** Catálogo mínimo con un producto de 10 libras en inventario. */
function sembrarCatalogo(): { usuarioId: string; productoId: string } {
  const usuario = repos.usuarios.crear({ nombre: 'Cajero', rol: 'venta', pinHash: 'hash' });
  const categoria = repos.categorias.crear({ nombre: 'Granos' });
  const producto = repos.productos.crear({
    nombre: 'Maíz',
    categoriaId: categoria.id,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '2.23',
    inventarioDisponible: '10',
  });
  return { usuarioId: usuario.id, productoId: producto.id };
}

// ===========================================================================
describe('Stock insuficiente: el caso que motiva toda la traducción', () => {
  it('dejar el inventario en negativo devuelve un mensaje que el cajero puede leer', () => {
    const { productoId } = sembrarCatalogo();

    try {
      // Simula lo que hará el módulo de ventas: intentar dejar el saldo en -5.
      repos.productos.fijarInventario(productoId, '-5');
      expect.unreachable('Se esperaba que la base rechazara el inventario negativo.');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      const negocio = error as ErrorDeNegocio;
      expect(negocio.codigo).toBe('STOCK_INSUFICIENTE');
      expect(negocio.mensajeParaElUsuario).toBe('Stock insuficiente para completar la venta.');
      // El detalle técnico no se pierde: queda para la bitácora.
      expect(negocio.causaTecnica).toContain('productos_inventario_no_negativo');
    }
  });

  it('el mensaje NO contiene jerga de SQLite', () => {
    const { productoId } = sembrarCatalogo();
    try {
      repos.productos.fijarInventario(productoId, '-1');
      expect.unreachable('Se esperaba el rechazo.');
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).not.toContain('CHECK constraint');
      expect(mensaje).not.toContain('SQLITE');
      expect(mensaje).not.toContain('GLOB');
    }
  });

  it('dejar el inventario exactamente en 0 NO es un error', () => {
    const { productoId } = sembrarCatalogo();
    expect(() => { repos.productos.fijarInventario(productoId, '0'); }).not.toThrow();
  });
});

// ===========================================================================
describe('Otras reglas que la base hace cumplir, traducidas', () => {
  it('abrir un segundo turno de caja avisa que ya hay uno abierto', () => {
    const { usuarioId } = sembrarCatalogo();
    repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });

    try {
      repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
      expect.unreachable('Se esperaba que el segundo turno fuera rechazado.');
    } catch (error) {
      expect((error as ErrorDeNegocio).codigo).toBe('CAJA_YA_ABIERTA');
      expect((error as ErrorDeNegocio).mensajeParaElUsuario).toContain('turno de caja abierto');
    }
  });

  it('repetir el número de recibo se explica como número duplicado', () => {
    const { usuarioId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const primeraVenta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'efectivo',
    });
    const segundaVenta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '20.00',
      total: '20.00',
      formaPago: 'efectivo',
    });

    repos.recibos.crear({ ventaId: primeraVenta.id, numeroRecibo: 1, pdfPath: '/tmp/a.pdf' });

    try {
      repos.recibos.crear({ ventaId: segundaVenta.id, numeroRecibo: 1, pdfPath: '/tmp/b.pdf' });
      expect.unreachable('Se esperaba que el número repetido fuera rechazado.');
    } catch (error) {
      expect((error as ErrorDeNegocio).codigo).toBe('NUMERO_DE_RECIBO_DUPLICADO');
    }
  });

  it('una referencia inexistente se explica sin hablar de llaves foráneas', () => {
    const { usuarioId } = sembrarCatalogo();
    const sesion = repos.cajaSesiones.abrir({ usuarioId, montoInicial: '500' });
    const venta = repos.ventas.crear({
      cajaSesionId: sesion.id,
      usuarioId,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'efectivo',
    });

    try {
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
      expect.unreachable('Se esperaba el rechazo por referencia inexistente.');
    } catch (error) {
      expect((error as ErrorDeNegocio).codigo).toBe('REFERENCIA_INEXISTENTE');
      expect((error as Error).message).not.toContain('FOREIGN KEY');
    }
  });

  it('un nombre de usuario repetido se explica como registro duplicado', () => {
    repos.usuarios.crear({ nombre: 'Jimmy', rol: 'administrativo', pinHash: 'h' });

    try {
      repos.usuarios.crear({ nombre: 'Jimmy', rol: 'venta', pinHash: 'h' });
      expect.unreachable('Se esperaba el rechazo por duplicado.');
    } catch (error) {
      expect((error as ErrorDeNegocio).codigo).toBe('REGISTRO_DUPLICADO');
    }
  });
});

// ===========================================================================
describe('Conflicto de inventario: el contrato del comparar-y-cambiar', () => {
  // El módulo de ventas todavía no existe; lo que se fija aquí es el código y
  // el mensaje exactos que deberá usar, para que no se improvisen después.

  it('nombra el producto y deja claro que la venta NO se registró', () => {
    const error = errorDeConflictoDeInventario('Maíz');

    expect(error).toBeInstanceOf(ErrorDeNegocio);
    expect(error.codigo).toBe('CONFLICTO_DE_INVENTARIO');
    expect(error.mensajeParaElUsuario).toContain('Maíz');
    expect(error.mensajeParaElUsuario).toContain('No se registró la venta');
    expect(error.mensajeParaElUsuario).toContain('volvé a cobrar');
  });

  it('el mensaje NO le pide al cajero rehacer la venta desde cero', () => {
    // La transacción se revierte, pero el carrito de la pantalla se conserva:
    // el cajero vuelve a cobrar, no vuelve a capturar todo.
    const mensaje = errorDeConflictoDeInventario('Azúcar').mensajeParaElUsuario;
    expect(mensaje).not.toContain('desde cero');
    expect(mensaje).not.toContain('nuevamente todos');
  });

  it('conserva la causa técnica para la bitácora', () => {
    const error = errorDeConflictoDeInventario('Frijol');
    expect(error.causaTecnica).toContain('0 filas');
  });

  it('es distinto de STOCK_INSUFICIENTE: son dos situaciones diferentes', () => {
    // Stock insuficiente = no alcanza. Conflicto = alguien lo movió entremedio.
    expect(errorDeConflictoDeInventario('Maíz').codigo).not.toBe('STOCK_INSUFICIENTE');
  });
});

// ===========================================================================
describe('Qué NO se traduce', () => {
  it('un error que no es de restricción pasa tal cual, sin disfrazarse', () => {
    // Envolver todo con un mensaje genérico escondería fallos de programación
    // detrás de un texto tranquilizador.
    const original = new Error('la conexión se cayó');
    expect(traducirErrorDeBaseDeDatos(original)).toBe(original);
  });

  it('un valor que ni siquiera es un error se devuelve intacto', () => {
    expect(traducirErrorDeBaseDeDatos('algo raro')).toBe('algo raro');
  });

  it('un ErrorDeNegocio ya traducido no se vuelve a envolver', () => {
    const yaTraducido = new ErrorDeNegocio('STOCK_INSUFICIENTE', 'Sin stock.', 'detalle');
    expect(traducirErrorDeBaseDeDatos(yaTraducido)).toBe(yaTraducido);
  });
});

// ===========================================================================
describe('Preparado también para Postgres', () => {
  it('reconoce la restricción por el campo `constraint`, como la reporta Postgres', () => {
    // Postgres no pone el nombre en el mensaje: lo expone en `constraint`.
    const errorDePostgres = Object.assign(
      new Error('new row for relation "productos" violates check constraint'),
      { code: '23514', constraint: 'productos_inventario_no_negativo' },
    );

    const traducido = traducirErrorDeBaseDeDatos(errorDePostgres);
    expect(traducido).toBeInstanceOf(ErrorDeNegocio);
    expect((traducido as ErrorDeNegocio).codigo).toBe('STOCK_INSUFICIENTE');
  });
});
