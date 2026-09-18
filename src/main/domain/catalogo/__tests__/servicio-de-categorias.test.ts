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
    base,
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
  it('la guarda activa, sin ventas, y la deja lista para usarse', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos' });

    expect(creada.nombre).toBe('Granos');
    expect(creada.ventas).toBe(0);
    expect(creada.activo).toBe(true);
  });

  it('recorta los espacios de más del nombre', () => {
    const creada = servicio.crear(idAdmin, { nombre: '   Abarrotes   ' });
    expect(creada.nombre).toBe('Abarrotes');
  });

  it('RECHAZA un nombre vacío con un mensaje que se puede leer en pantalla', () => {
    expect(() => servicio.crear(idAdmin, { nombre: '   ' })).toThrow(/La categoría necesita un nombre/);
  });

  // REEMPLAZA a «RECHAZA un orden negativo» (§4.63). Aquella prueba protegía que
  // nadie guardara una posición inválida escrita a mano. Desde que la posición la
  // calculan las ventas nadie la escribe, así que lo que hay que proteger ahora
  // es que el servicio NO la acepte de ninguna forma: ni válida ni inválida.
  it('NO pide ni guarda ningún orden: un «orden» que llegue igual se ignora y la columna queda en 0', () => {
    const conOrden = { nombre: 'Granos', orden: -1 } as unknown as { nombre: string };
    const creada = servicio.crear(idAdmin, conOrden);

    const fila = base.prepare('SELECT orden FROM categorias WHERE id = ?').get(creada.id) as { orden: number };
    expect(fila.orden).toBe(0);
    expect(Object.keys(creada)).not.toContain('orden');
  });

  it('RECHAZA un nombre repetido, sin distinguir mayúsculas', () => {
    servicio.crear(idAdmin, { nombre: 'Granos' });
    expect(() => servicio.crear(idAdmin, { nombre: 'GRANOS' })).toThrow(/Ya existe una categoría llamada/);
  });

  it('si el nombre lo ocupa una categoría DESACTIVADA, lo dice en el mensaje', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos' });
    servicio.fijarActivo(idAdmin, creada.id, false);

    // Sin esta aclaración, quien administra el catálogo ve un nombre que "no
    // está" en la lista y no entiende por qué la base lo rechaza.
    expect(() => servicio.crear(idAdmin, { nombre: 'Granos' })).toThrow(/está desactivada: reactivala/);
  });

  it('deja un asiento de auditoría con quién la creó, sin ningún orden', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos' });

    const asientos = repos.auditoria.listarPorEntidad('categorias', creada.id);
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.accion).toBe('categoria_creada');
    expect(asientos[0]?.usuarioId).toBe(idAdmin);
    expect(asientos[0]?.valorNuevo).toBe('{"nombre":"Granos"}');
  });
});

// ===========================================================================
describe('Editar una categoría', () => {
  // REEMPLAZA a «cambia nombre y orden»: el orden ya no se edita (§4.63).
  it('cambia el nombre', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos' });
    const editada = servicio.editar(idAdmin, creada.id, { nombre: 'Granos básicos' });

    expect(editada.nombre).toBe('Granos básicos');
  });

  // REEMPLAZA a «deja conservar su propio nombre al editar solo el orden».
  // Lo que protegía sigue valiendo: guardar sin cambiar el nombre no choca
  // consigo mismo. Ya no existe «editar solo el orden».
  it('deja guardar con su propio nombre sin chocar consigo misma', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos' });
    expect(() => servicio.editar(idAdmin, creada.id, { nombre: 'Granos' })).not.toThrow();
  });

  it('RECHAZA tomar el nombre de otra categoría', () => {
    servicio.crear(idAdmin, { nombre: 'Granos' });
    const otra = servicio.crear(idAdmin, { nombre: 'Abarrotes' });

    expect(() => servicio.editar(idAdmin, otra.id, { nombre: 'Granos' })).toThrow(/Ya existe una categoría llamada/);
  });

  it('RECHAZA editar una categoría que no existe', () => {
    expect(() =>
      servicio.editar(idAdmin, '00000000-0000-4000-8000-000000000000', { nombre: 'Fantasma' }),
    ).toThrow(ErrorDeNegocio);
  });

  it('guarda el valor anterior en la auditoría, para poder comparar, sin ningún orden', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos' });
    servicio.editar(idAdmin, creada.id, { nombre: 'Granos básicos' });

    const edicion = repos.auditoria
      .listarPorEntidad('categorias', creada.id)
      .find((asiento) => asiento.accion === 'categoria_editada');

    expect(edicion?.valorAnterior).toBe('{"nombre":"Granos"}');
    expect(edicion?.valorNuevo).toBe('{"nombre":"Granos básicos"}');
  });

  it('editar el nombre NO toca la columna orden que quedó de antes', () => {
    const creada = servicio.crear(idAdmin, { nombre: 'Granos' });
    base.prepare('UPDATE categorias SET orden = 7 WHERE id = ?').run(creada.id);

    servicio.editar(idAdmin, creada.id, { nombre: 'Granos básicos' });

    const fila = base.prepare('SELECT orden FROM categorias WHERE id = ?').get(creada.id) as { orden: number };
    expect(fila.orden).toBe(7);
  });
});

// ===========================================================================
describe('EL ORDEN LO DECIDEN LAS VENTAS: la suma del contador de sus productos (§4.63)', () => {
  /** Crea un producto en la categoría, con su contador en cero. */
  function producto(nombre: string, categoriaId: string): string {
    return repos.productos.crear({
      nombre,
      categoriaId,
      tipoMedida: 'unidad',
      unidadPeso: null,
      cantidadPredefinidaIcono: '1',
      precioBase: '1.00',
      inventarioDisponible: '1000',
    }).id;
  }

  /** Suma `veces` ventas al contador, por el MISMO método que usa la venta. */
  function vender(productoId: string, veces: number): void {
    for (let i = 0; i < veces; i += 1) {
      const actual = repos.productos.obtenerPorId(productoId);
      if (actual === null) throw new Error('no existe el producto');
      const leida = actual.cantidadVendida.toFixed(3);
      const nueva = actual.cantidadVendida.plus(1).toFixed(3);
      expect(repos.productos.registrarVentaDeProducto(productoId, leida, nueva)).toBe(true);
    }
  }

  const nombres = (lista: readonly { nombre: string }[]): string[] => lista.map((c) => c.nombre);

  it('suma las ventas de TODOS los productos de la categoría y ordena de más a menos', () => {
    const granos = servicio.crear(idAdmin, { nombre: 'Granos' }).id;
    const abarrotes = servicio.crear(idAdmin, { nombre: 'Abarrotes' }).id;
    const huevos = servicio.crear(idAdmin, { nombre: 'Huevos' }).id;
    vender(producto('Maíz', granos), 2);
    vender(producto('Frijol', granos), 2);
    vender(producto('Azúcar', abarrotes), 3);
    vender(producto('Cartón de huevos', huevos), 1);

    expect(nombres(servicio.listarActivas())).toEqual(['Granos', 'Abarrotes', 'Huevos']);
    expect(servicio.listarActivas().map((c) => c.ventas)).toEqual([4, 3, 1]);
    expect(nombres(servicio.listarTodas())).toEqual(['Granos', 'Abarrotes', 'Huevos']);
  });

  it('una categoría NUEVA, sin ventas, cae al final sin que nadie decida su posición', () => {
    const granos = servicio.crear(idAdmin, { nombre: 'Granos' }).id;
    vender(producto('Maíz', granos), 1);
    // «Abarrotes» va antes que «Granos» por nombre: si el orden fuera por
    // nombre o por creación, la nueva quedaría arriba.
    servicio.crear(idAdmin, { nombre: 'Abarrotes' });

    expect(nombres(servicio.listarActivas())).toEqual(['Granos', 'Abarrotes']);
  });

  it('EMPATE (cero incluido): desempata el nombre, igual que los productos, sin importar el orden de creación', () => {
    // Creadas en orden inverso al alfabético, a propósito.
    servicio.crear(idAdmin, { nombre: 'Semillas' });
    servicio.crear(idAdmin, { nombre: 'Huevos' });
    servicio.crear(idAdmin, { nombre: 'Abarrotes' });
    expect(nombres(servicio.listarActivas())).toEqual(['Abarrotes', 'Huevos', 'Semillas']);

    // Empate en 2 entre dos categorías, con una tercera en 0.
    const semillas = repos.categorias.listar().find((c) => c.nombre === 'Semillas')?.id ?? '';
    const huevos = repos.categorias.listar().find((c) => c.nombre === 'Huevos')?.id ?? '';
    vender(producto('Semilla de maíz', semillas), 2);
    vender(producto('Huevo', huevos), 2);
    expect(nombres(servicio.listarActivas())).toEqual(['Huevos', 'Semillas', 'Abarrotes']);
  });

  it('el desempate compara el nombre EXACTAMENTE como la cuadrícula de productos (binario: «Z» antes que «a»)', () => {
    const abonos = servicio.crear(idAdmin, { nombre: 'abonos' }).id;
    servicio.crear(idAdmin, { nombre: 'Zanahorias' });
    // Dos productos con los mismos nombres y cero ventas: la cuadrícula los
    // ordena con su propio criterio, y las categorías tienen que coincidir.
    producto('abonos', abonos);
    producto('Zanahorias', abonos);

    const ordenDeLosProductos = repos.productos.listarParaVenta().map((p) => p.nombre);
    expect(ordenDeLosProductos).toEqual(['Zanahorias', 'abonos']);
    expect(nombres(servicio.listarActivas())).toEqual(ordenDeLosProductos);
  });

  it('cuentan también las ventas de productos DESACTIVADOS: lo vendido no se borra', () => {
    const granos = servicio.crear(idAdmin, { nombre: 'Granos' }).id;
    const abarrotes = servicio.crear(idAdmin, { nombre: 'Abarrotes' }).id;
    const maiz = producto('Maíz', granos);
    vender(maiz, 3);
    vender(producto('Azúcar', abarrotes), 2);
    repos.productos.fijarActivo(maiz, false);

    expect(nombres(servicio.listarActivas())).toEqual(['Granos', 'Abarrotes']);
    expect(servicio.listarActivas()[0]?.ventas).toBe(3);
  });

  it('una categoría DESACTIVADA sale de las activas y sigue en su lugar en la lista completa', () => {
    const granos = servicio.crear(idAdmin, { nombre: 'Granos' }).id;
    servicio.crear(idAdmin, { nombre: 'Abarrotes' });
    vender(producto('Maíz', granos), 1);
    servicio.fijarActivo(idAdmin, granos, false);

    expect(nombres(servicio.listarActivas())).toEqual(['Abarrotes']);
    expect(nombres(servicio.listarTodas())).toEqual(['Granos', 'Abarrotes']);
  });

  it('se recalcula en cada lectura: una venta nueva cambia el orden sin que nadie toque la categoría', () => {
    const granos = servicio.crear(idAdmin, { nombre: 'Granos' }).id;
    const abarrotes = servicio.crear(idAdmin, { nombre: 'Abarrotes' }).id;
    const maiz = producto('Maíz', granos);
    const azucar = producto('Azúcar', abarrotes);
    vender(maiz, 1);
    expect(nombres(servicio.listarActivas())).toEqual(['Granos', 'Abarrotes']);

    vender(azucar, 2);
    expect(nombres(servicio.listarActivas())).toEqual(['Abarrotes', 'Granos']);
    expect(repos.categorias.obtenerPorId(abarrotes)?.ventas).toBe(2);
  });

  it('IGNORA la columna orden que quedó de antes: un orden viejo no mueve a nadie', () => {
    const granos = servicio.crear(idAdmin, { nombre: 'Granos' }).id;
    servicio.crear(idAdmin, { nombre: 'Abarrotes' });
    vender(producto('Maíz', granos), 1);
    // Como quedaron las categorías cargadas a mano antes de §4.63.
    base.prepare("UPDATE categorias SET orden = 1 WHERE nombre = 'Abarrotes'").run();
    base.prepare("UPDATE categorias SET orden = 99 WHERE nombre = 'Granos'").run();

    expect(nombres(servicio.listarActivas())).toEqual(['Granos', 'Abarrotes']);
  });
});

// ===========================================================================
describe('Desactivar una categoría no borra ni rompe nada', () => {
  /** Crea una categoría con un producto adentro. */
  function categoriaConProducto(): { categoriaId: string; productoId: string } {
    const categoria = servicio.crear(idAdmin, { nombre: 'Granos' });
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
