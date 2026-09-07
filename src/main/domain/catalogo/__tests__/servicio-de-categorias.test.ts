/**
 * Pruebas del servicio de categorías.
 *
 * Corren contra bases SQLite reales: lo que se comprueba incluye que la
 * migración 009 dejó la columna `activo` funcionando y que desactivar una
 * categoría no toca los productos que la usan.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeCategorias } from '../servicio-de-categorias';

let base: Database;
let repos: Repositorios;
let servicio: ServicioDeCategorias;
let limpiar: () => void;
let idAdmin: string;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  servicio = new ServicioDeCategorias({
    categorias: repos.categorias,
    auditoria: repos.auditoria,
  });

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
describe('Crear una categoría', () => {
  it('la guarda activa y la deja lista para usarse', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });

    expect(creada.nombre).toBe('Granos');
    expect(creada.orden).toBe(1);
    expect(creada.activo).toBe(true);
  });

  it('recorta los espacios de más del nombre', () => {
    const creada = servicio.crear(idAdmin, { nombre: '   Abarrotes   ', orden: 0 });
    expect(creada.nombre).toBe('Abarrotes');
  });

  it('RECHAZA un nombre vacío con un mensaje que se puede leer en pantalla', () => {
    expect(() => servicio.crear(idAdmin, { nombre: '   ', orden: 0 })).toThrow(
      /La categoría necesita un nombre/,
    );
  });

  it('RECHAZA un orden negativo', () => {
    expect(() => servicio.crear(idAdmin, { nombre: 'Granos', orden: -1 })).toThrow(
      /número entero de 0 en adelante/,
    );
  });

  it('RECHAZA un nombre repetido, sin distinguir mayúsculas', () => {
    servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });
    expect(() => servicio.crear(idAdmin, { nombre: 'GRANOS', orden: 2 })).toThrow(
      /Ya existe una categoría llamada/,
    );
  });

  it('si el nombre lo ocupa una categoría DESACTIVADA, lo dice en el mensaje', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });
    servicio.fijarActivo(idAdmin, creada.id, false);

    // Sin esta aclaración, quien administra el catálogo ve un nombre que "no
    // está" en la lista y no entiende por qué la base lo rechaza.
    expect(() => servicio.crear(idAdmin, { nombre: 'Granos', orden: 2 })).toThrow(
      /está desactivada: reactivala/,
    );
  });

  it('deja un asiento de auditoría con quién la creó', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });

    const asientos = repos.auditoria.listarPorEntidad('categorias', creada.id);
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.accion).toBe('categoria_creada');
    expect(asientos[0]?.usuarioId).toBe(idAdmin);
  });
});

// ===========================================================================
describe('Editar una categoría', () => {
  it('cambia nombre y orden', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });
    const editada = servicio.editar(idAdmin, creada.id, { nombre: 'Granos básicos', orden: 5 });

    expect(editada.nombre).toBe('Granos básicos');
    expect(editada.orden).toBe(5);
  });

  it('deja conservar su propio nombre al editar solo el orden', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });
    expect(() => servicio.editar(idAdmin, creada.id, { nombre: 'Granos', orden: 9 })).not.toThrow();
  });

  it('RECHAZA tomar el nombre de otra categoría', () => {
    servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });
    const otra = servicio.crear(idAdmin, { nombre: 'Abarrotes', orden: 2 });

    expect(() => servicio.editar(idAdmin, otra.id, { nombre: 'Granos', orden: 2 })).toThrow(
      /Ya existe una categoría llamada/,
    );
  });

  it('RECHAZA editar una categoría que no existe', () => {
    expect(() =>
      servicio.editar(idAdmin, '00000000-0000-4000-8000-000000000000', {
        nombre: 'Fantasma',
        orden: 0,
      }),
    ).toThrow(ErrorDeNegocio);
  });

  it('guarda el valor anterior en la auditoría, para poder comparar', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });
    servicio.editar(idAdmin, creada.id, { nombre: 'Granos básicos', orden: 5 });

    const edicion = repos.auditoria
      .listarPorEntidad('categorias', creada.id)
      .find((asiento) => asiento.accion === 'categoria_editada');

    expect(edicion?.valorAnterior).toContain('Granos');
    expect(edicion?.valorNuevo).toContain('Granos básicos');
  });
});

// ===========================================================================
describe('Desactivar una categoría no borra ni rompe nada', () => {
  /** Crea una categoría con un producto adentro. */
  function categoriaConProducto(): { categoriaId: string; productoId: string } {
    const categoria = servicio.crear(idAdmin, { nombre: 'Granos', orden: 1 });
    const producto = repos.productos.crear({
      nombre: 'Maíz',
      categoriaId: categoria.id,
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '1',
      precioBase: '4.25',
      inventarioDisponible: '100',
    });
    return { categoriaId: categoria.id, productoId: producto.id };
  }

  it('la categoría sigue existiendo, solo deja de estar activa', () => {
    const { categoriaId } = categoriaConProducto();
    servicio.fijarActivo(idAdmin, categoriaId, false);

    const guardada = repos.categorias.obtenerPorId(categoriaId);
    expect(guardada).not.toBeNull();
    expect(guardada?.activo).toBe(false);
  });

  it('el producto que la usaba sigue activo, en su misma categoría', () => {
    const { categoriaId, productoId } = categoriaConProducto();
    servicio.fijarActivo(idAdmin, categoriaId, false);

    // Esta es la regla que importa: desactivar una categoría es una decisión
    // de catálogo, no una baja de inventario. Si desactivara sus productos,
    // retiraría mercadería de la venta sin que nadie lo pidiera.
    const producto = repos.productos.obtenerPorId(productoId);
    expect(producto?.activo).toBe(true);
    expect(producto?.categoriaId).toBe(categoriaId);
  });

  it('desaparece del listado para el selector de productos, pero no del de administración', () => {
    const { categoriaId } = categoriaConProducto();
    servicio.fijarActivo(idAdmin, categoriaId, false);

    expect(servicio.listarActivas().map((c) => c.id)).not.toContain(categoriaId);
    expect(servicio.listarTodas().map((c) => c.id)).toContain(categoriaId);
  });

  it('se puede reactivar y vuelve al selector', () => {
    const { categoriaId } = categoriaConProducto();
    servicio.fijarActivo(idAdmin, categoriaId, false);
    servicio.fijarActivo(idAdmin, categoriaId, true);

    expect(servicio.listarActivas().map((c) => c.id)).toContain(categoriaId);
  });

  it('la auditoría anota cuántos productos quedaron usándola', () => {
    const { categoriaId } = categoriaConProducto();
    servicio.fijarActivo(idAdmin, categoriaId, false);

    const asiento = repos.auditoria
      .listarPorEntidad('categorias', categoriaId)
      .find((registro) => registro.accion === 'categoria_desactivada');

    expect(asiento?.valorNuevo).toContain('"productosQueLaSiguenUsando":1');
  });

  it('desactivar dos veces seguidas no genera un asiento de más', () => {
    const { categoriaId } = categoriaConProducto();
    servicio.fijarActivo(idAdmin, categoriaId, false);
    servicio.fijarActivo(idAdmin, categoriaId, false);

    const desactivaciones = repos.auditoria
      .listarPorEntidad('categorias', categoriaId)
      .filter((registro) => registro.accion === 'categoria_desactivada');

    expect(desactivaciones).toHaveLength(1);
  });
});
