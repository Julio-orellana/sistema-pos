/**
 * Pruebas del catálogo de ejemplo.
 *
 * Lo que importa verificar acá no es que los productos sean bonitos, sino que
 * la herramienta se pueda usar y deshacer tantas veces como haga falta sin
 * dejar rastro a medias. El día que Jimmy entregue su catálogo real, `npm run
 * seed:limpiar` tiene que dejar la base exactamente como estaba.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import {
  PREFIJO_DE_EJEMPLO,
  contarDatosDeEjemplo,
  esDeEjemplo,
  limpiarDatosDeEjemplo,
  sembrarDatosDeEjemplo,
} from '../datos-de-ejemplo';

let base: Database;
let repos: Repositorios;
let limpiar: () => void;
let idAdmin: string;

/** Cuántas filas hay en total, de ejemplo y reales. */
function totales(): { categorias: number; productos: number } {
  return {
    categorias: repos.categorias.listar().length,
    productos: repos.productos.listarTodos().length,
  };
}

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  idAdmin = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin('2468'),
  }).id;
});

afterEach(() => {
  limpiar();
});

// ===========================================================================
describe('Sembrar el catálogo de ejemplo', () => {
  it('crea 3 categorías y 5 productos', () => {
    const informe = sembrarDatosDeEjemplo(base, repos);

    expect(informe.categoriasCreadas).toBe(3);
    expect(informe.productosCreados).toBe(5);
    expect(informe.yaExistian).toBe(0);
  });

  it('todos los registros llevan el prefijo que los identifica como de ejemplo', () => {
    sembrarDatosDeEjemplo(base, repos);

    for (const categoria of repos.categorias.listar()) {
      expect(esDeEjemplo(categoria.nombre)).toBe(true);
      expect(categoria.nombre.startsWith(PREFIJO_DE_EJEMPLO)).toBe(true);
    }
    for (const producto of repos.productos.listarTodos()) {
      expect(esDeEjemplo(producto.nombre)).toBe(true);
    }
  });

  it('siembra maíz y azúcar por peso en libras, como se usó en todo el proyecto', () => {
    sembrarDatosDeEjemplo(base, repos);
    const porNombre = new Map(repos.productos.listarTodos().map((p) => [p.nombre, p]));

    const maiz = porNombre.get(`${PREFIJO_DE_EJEMPLO}Maíz blanco`);
    const azucar = porNombre.get(`${PREFIJO_DE_EJEMPLO}Azúcar`);

    expect(maiz?.tipoMedida).toBe('peso');
    expect(maiz?.unidadPeso).toBe('lb');
    expect(azucar?.tipoMedida).toBe('peso');
    expect(azucar?.unidadPeso).toBe('lb');
  });

  it('siembra los huevos por unidad, en cartón y en docena', () => {
    sembrarDatosDeEjemplo(base, repos);
    const huevos = repos.productos
      .listarTodos()
      .filter((producto) => producto.nombre.includes('Huevos'));

    expect(huevos).toHaveLength(2);
    for (const producto of huevos) {
      expect(producto.tipoMedida).toBe('unidad');
      expect(producto.unidadPeso).toBeNull();
    }
  });

  it('todos quedan con inventario de ejemplo cargado y activos', () => {
    sembrarDatosDeEjemplo(base, repos);

    for (const producto of repos.productos.listarTodos()) {
      expect(producto.activo).toBe(true);
      expect(producto.inventarioDisponible.isNegative()).toBe(false);
      expect(producto.inventarioDisponible.isZero()).toBe(false);
    }
  });

  it('se puede correr DOS veces sin duplicar nada', () => {
    sembrarDatosDeEjemplo(base, repos);
    const segunda = sembrarDatosDeEjemplo(base, repos);

    expect(segunda.categoriasCreadas).toBe(0);
    expect(segunda.productosCreados).toBe(0);
    expect(segunda.yaExistian).toBe(8);
    expect(totales()).toEqual({ categorias: 3, productos: 5 });
  });

  it('no pisa un precio que alguien cambió a mano para probar', () => {
    sembrarDatosDeEjemplo(base, repos);
    const maiz = repos.productos
      .listarTodos()
      .find((p) => p.nombre === `${PREFIJO_DE_EJEMPLO}Maíz blanco`);
    repos.productos.actualizarPrecioBase(maiz?.id ?? '', '99.99');

    sembrarDatosDeEjemplo(base, repos);

    const despues = repos.productos.obtenerPorId(maiz?.id ?? '');
    expect(despues?.precioBase.toFixed(2)).toBe('99.99');
  });
});

// ===========================================================================
describe('Limpiar el catálogo de ejemplo', () => {
  it('deja la base exactamente como estaba antes de sembrar', () => {
    const antes = totales();
    sembrarDatosDeEjemplo(base, repos);
    limpiarDatosDeEjemplo(base, repos);

    expect(totales()).toEqual(antes);
    expect(contarDatosDeEjemplo(repos)).toEqual({ categorias: 0, productos: 0 });
  });

  it('informa cuántas filas quitó', () => {
    sembrarDatosDeEjemplo(base, repos);
    const informe = limpiarDatosDeEjemplo(base, repos);

    expect(informe.productosEliminados).toBe(5);
    expect(informe.categoriasEliminadas).toBe(3);
    expect(informe.conservadosPorTenerVentas).toEqual([]);
  });

  it('BORRA de verdad, no desactiva: el nombre queda libre para el catálogo real', () => {
    sembrarDatosDeEjemplo(base, repos);
    limpiarDatosDeEjemplo(base, repos);

    // Si solo se desactivaran, el UNIQUE seguiría ocupando el nombre y el
    // "Maíz blanco" de verdad de Jimmy chocaría contra el de mentira.
    const categoria = repos.categorias.crear({ nombre: 'Granos', orden: 1 });
    expect(() =>
      repos.productos.crear({
        nombre: 'Maíz blanco',
        categoriaId: categoria.id,
        tipoMedida: 'peso',
        unidadPeso: 'lb',
        cantidadPredefinidaIcono: '1',
        precioBase: '4.25',
        inventarioDisponible: '0',
      }),
    ).not.toThrow();
  });

  it('correr limpiar sin haber sembrado no falla ni borra nada', () => {
    const informe = limpiarDatosDeEjemplo(base, repos);
    expect(informe.productosEliminados).toBe(0);
    expect(informe.categoriasEliminadas).toBe(0);
  });

  it('se puede sembrar, limpiar y volver a sembrar', () => {
    sembrarDatosDeEjemplo(base, repos);
    limpiarDatosDeEjemplo(base, repos);
    const tercera = sembrarDatosDeEjemplo(base, repos);

    expect(tercera.categoriasCreadas).toBe(3);
    expect(tercera.productosCreados).toBe(5);
    expect(totales()).toEqual({ categorias: 3, productos: 5 });
  });

  it('NO toca las categorías ni los productos reales de la tienda', () => {
    const real = repos.categorias.crear({ nombre: 'Ferretería', orden: 9 });
    repos.productos.crear({
      nombre: 'Machete',
      categoriaId: real.id,
      tipoMedida: 'unidad',
      unidadPeso: null,
      cantidadPredefinidaIcono: '1',
      precioBase: '85.00',
      inventarioDisponible: '12',
    });

    sembrarDatosDeEjemplo(base, repos);
    limpiarDatosDeEjemplo(base, repos);

    expect(totales()).toEqual({ categorias: 1, productos: 1 });
    expect(repos.categorias.listar()[0]?.nombre).toBe('Ferretería');
    expect(repos.productos.listarTodos()[0]?.nombre).toBe('Machete');
  });
});

// ===========================================================================
describe('La limpieza no rompe nada a medias', () => {
  it('si un producto de ejemplo tiene ventas, NO borra nada y avisa cuál', () => {
    sembrarDatosDeEjemplo(base, repos);
    const maiz = repos.productos
      .listarTodos()
      .find((p) => p.nombre === `${PREFIJO_DE_EJEMPLO}Maíz blanco`);

    const sesionDeCaja = repos.cajaSesiones.abrir({ usuarioId: idAdmin, montoInicial: '500' });
    const venta = repos.ventas.crear({
      cajaSesionId: sesionDeCaja.id,
      usuarioId: idAdmin,
      subtotal: '4.25',
      total: '4.25',
      formaPago: 'efectivo',
    });
    repos.ventaDetalle.crear({
      ventaId: venta.id,
      productoId: maiz?.id ?? '',
      productoNombreSnap: maiz?.nombre ?? '',
      unidadSnap: 'lb',
      cantidad: '1',
      precioUnitarioSnap: '4.25',
      subtotalExacto: '4.25',
      subtotalImpreso: '4.25',
      ordenLinea: 0,
    });

    const informe = limpiarDatosDeEjemplo(base, repos);

    expect(informe.conservadosPorTenerVentas).toContain(`${PREFIJO_DE_EJEMPLO}Maíz blanco`);
    expect(informe.productosEliminados).toBe(0);
    // Ni siquiera se borran los que SÍ se podían borrar: o se limpia todo o no
    // se limpia nada, para no dejar un catálogo a medias.
    expect(totales()).toEqual({ categorias: 3, productos: 5 });
  });

  it('si un producto REAL quedó en una categoría de ejemplo, revierte la limpieza entera', () => {
    sembrarDatosDeEjemplo(base, repos);
    const granos = repos.categorias
      .listar()
      .find((c) => c.nombre === `${PREFIJO_DE_EJEMPLO}Granos`);

    // Alguien creó un producto de verdad dentro de una categoría de ejemplo.
    repos.productos.crear({
      nombre: 'Arroz de verdad',
      categoriaId: granos?.id ?? '',
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '1',
      precioBase: '7.00',
      inventarioDisponible: '50',
    });

    expect(() => limpiarDatosDeEjemplo(base, repos)).toThrow(ErrorDeNegocio);

    // La transacción se revierte entera: los productos de ejemplo que ya se
    // habían borrado dentro de la transacción vuelven a estar.
    expect(totales()).toEqual({ categorias: 3, productos: 6 });
    expect(contarDatosDeEjemplo(repos)).toEqual({ categorias: 3, productos: 5 });
  });
});
