/**
 * Pruebas del servicio de productos.
 *
 * Corren contra bases SQLite reales, con el esquema completo aplicado, así que
 * cuando una prueba dice que algo se rechaza ANTES de tocar la base, la base
 * está de verdad ahí para poder distinguir un caso del otro.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { cantidadACadena } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeCategorias } from '../servicio-de-categorias';
import { ServicioDeProductos, type DatosDeProductoNuevo } from '../servicio-de-productos';

let base: Database;
let repos: Repositorios;
let productos: ServicioDeProductos;
let categorias: ServicioDeCategorias;
let limpiar: () => void;
let idAdmin: string;
let idGranos: string;

/**
 * Cuántas escrituras llegaron al repositorio de productos.
 *
 * Se envuelven los métodos que escriben para poder afirmar que una validación
 * rechazó los datos ANTES de tocar la base, y no que la base los rechazó
 * después. Sin este contador, las dos situaciones se verían igual desde afuera.
 */
let escriturasEnLaBase: number;

/** Un producto por peso válido, para partir de algo correcto en cada prueba. */
function maiz(cambios: Partial<DatosDeProductoNuevo> = {}): DatosDeProductoNuevo {
  return {
    nombre: 'Maíz blanco',
    categoriaId: idGranos,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '4.25',
    inventarioInicial: '100',
    fotoPath: null,
    ...cambios,
  };
}

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  escriturasEnLaBase = 0;

  const repoProductos = repos.productos as unknown as Record<
    string,
    (...argumentos: never[]) => unknown
  >;
  for (const metodo of ['crear', 'actualizar', 'fijarInventario', 'fijarActivo']) {
    const original = repoProductos[metodo]?.bind(repos.productos);
    if (original === undefined) {
      throw new Error(`El repositorio de productos ya no tiene el método ${metodo}.`);
    }
    repoProductos[metodo] = (...argumentos: never[]): unknown => {
      escriturasEnLaBase += 1;
      return original(...argumentos);
    };
  }

  categorias = new ServicioDeCategorias({
    categorias: repos.categorias,
    auditoria: repos.auditoria,
  });
  productos = new ServicioDeProductos({
    productos: repos.productos,
    categorias: repos.categorias,
    auditoria: repos.auditoria,
  });

  idAdmin = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin('2468'),
  }).id;
  idGranos = categorias.crear(idAdmin, { nombre: 'Granos', orden: 1 }).id;
  escriturasEnLaBase = 0;
});

afterEach(() => {
  limpiar();
});

// ===========================================================================
describe('La coherencia entre tipo de medida y unidad se rechaza ANTES de tocar la base', () => {
  it('un producto por PESO sin unidad se rechaza, y no se escribe nada', () => {
    expect(() => productos.crear(idAdmin, maiz({ unidadPeso: null }))).toThrow(
      /necesita una unidad: libras o kilogramos/,
    );

    expect(escriturasEnLaBase).toBe(0);
    expect(repos.productos.listarTodos()).toHaveLength(0);
  });

  it('un producto por UNIDAD con unidad de peso se rechaza, y no se escribe nada', () => {
    expect(() =>
      productos.crear(idAdmin, maiz({ tipoMedida: 'unidad', unidadPeso: 'lb' })),
    ).toThrow(/no lleva unidad de peso/);

    expect(escriturasEnLaBase).toBe(0);
    expect(repos.productos.listarTodos()).toHaveLength(0);
  });

  it('el mensaje explica qué hacer, no cita la restricción de SQLite', () => {
    try {
      productos.crear(idAdmin, maiz({ unidadPeso: null }));
      expect.unreachable('debió rechazarse');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      const negocio = error as ErrorDeNegocio;
      expect(negocio.mensajeParaElUsuario).not.toContain('CHECK');
      expect(negocio.causaTecnica).toContain('tipo_medida');
    }
  });

  it('la misma incoherencia se rechaza también al EDITAR', () => {
    const creado = productos.crear(idAdmin, maiz());
    escriturasEnLaBase = 0;

    expect(() =>
      productos.editar(idAdmin, creado.id, {
        nombre: creado.nombre,
        categoriaId: idGranos,
        tipoMedida: 'peso',
        unidadPeso: null,
        cantidadPredefinidaIcono: '1',
        precioBase: '4.25',
        fotoPath: null,
      }),
    ).toThrow(/necesita una unidad/);

    expect(escriturasEnLaBase).toBe(0);
  });

  it('la base sigue siendo la última red: rechaza la incoherencia si alguien la saltea', () => {
    // Se escribe directo contra el repositorio, salteando el servicio. Es lo
    // que pasaría con un módulo futuro distraído, y el esquema tiene que
    // atraparlo igual.
    try {
      repos.productos.crear({
        nombre: 'Producto incoherente',
        categoriaId: idGranos,
        tipoMedida: 'peso',
        unidadPeso: null,
        cantidadPredefinidaIcono: '1',
        precioBase: '4.25',
        inventarioDisponible: '0',
      });
      expect.unreachable('la base debió rechazarlo');
    } catch (error) {
      // Llega como error de negocio ya traducido, pero la causa técnica
      // conserva la restricción que se violó: eso es lo que prueba que fue la
      // BASE la que lo atrapó y no una validación de la aplicación.
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      expect((error as ErrorDeNegocio).causaTecnica).toMatch(/CHECK constraint failed/);
    }

    expect(repos.productos.listarTodos()).toHaveLength(0);
  });

  it('SÍ deja cambiar el tipo de medida de un producto ya creado', () => {
    // Es deliberado: `venta_detalle` guarda una foto del nombre, la unidad y
    // el precio de cada venta, así que un cambio de hoy no altera un solo
    // comprobante de ayer.
    const creado = productos.crear(idAdmin, maiz());
    const editado = productos.editar(idAdmin, creado.id, {
      nombre: creado.nombre,
      categoriaId: idGranos,
      tipoMedida: 'unidad',
      unidadPeso: null,
      cantidadPredefinidaIcono: '1',
      precioBase: '4.25',
      fotoPath: null,
    });

    expect(editado.tipoMedida).toBe('unidad');
    expect(editado.unidadPeso).toBeNull();
  });
});

// ===========================================================================
describe('Los demás datos del producto también se validan antes de la base', () => {
  it('RECHAZA una cantidad de ícono de cero: sería un botón que no hace nada', () => {
    expect(() => productos.crear(idAdmin, maiz({ cantidadPredefinidaIcono: '0' }))).toThrow(
      /mayor que cero/,
    );
    expect(escriturasEnLaBase).toBe(0);
  });

  it('RECHAZA una cantidad de ícono negativa', () => {
    expect(() => productos.crear(idAdmin, maiz({ cantidadPredefinidaIcono: '-1' }))).toThrow(
      /mayor que cero/,
    );
    expect(escriturasEnLaBase).toBe(0);
  });

  it('RECHAZA un precio negativo', () => {
    expect(() => productos.crear(idAdmin, maiz({ precioBase: '-0.01' }))).toThrow(
      /no puede ser negativo/,
    );
    expect(escriturasEnLaBase).toBe(0);
  });

  it('ACEPTA un precio de 0: son las muestras y los regalos', () => {
    const creado = productos.crear(idAdmin, maiz({ precioBase: '0' }));
    expect(creado.precioBase.toFixed(2)).toBe('0.00');
  });

  it('ACEPTA inventario inicial 0: el producto puede darse de alta antes de que llegue', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '0' }));
    expect(cantidadACadena(creado.inventarioDisponible)).toBe('0.000');
  });

  it('RECHAZA un inventario inicial negativo', () => {
    expect(() => productos.crear(idAdmin, maiz({ inventarioInicial: '-5' }))).toThrow(
      /no puede ser negativo/,
    );
    expect(escriturasEnLaBase).toBe(0);
  });

  it('RECHAZA un precio que no es un número', () => {
    expect(() => productos.crear(idAdmin, maiz({ precioBase: 'cuatro con veinticinco' }))).toThrow(
      /tiene que ser un número/,
    );
    expect(escriturasEnLaBase).toBe(0);
  });

  it('RECHAZA un nombre repetido', () => {
    productos.crear(idAdmin, maiz());
    expect(() => productos.crear(idAdmin, maiz())).toThrow(/Ya existe un producto llamado/);
  });

  it('RECHAZA dar de alta un producto en una categoría desactivada', () => {
    categorias.fijarActivo(idAdmin, idGranos, false);
    expect(() => productos.crear(idAdmin, maiz())).toThrow(/está desactivada/);
  });

  it('pero SÍ deja editar un producto que ya estaba en una categoría desactivada', () => {
    const creado = productos.crear(idAdmin, maiz());
    categorias.fijarActivo(idAdmin, idGranos, false);

    // Retirar una categoría no puede obligar a reclasificar todo su catálogo
    // antes de poder corregirle un precio a un producto.
    expect(() =>
      productos.editar(idAdmin, creado.id, {
        nombre: creado.nombre,
        categoriaId: idGranos,
        tipoMedida: 'peso',
        unidadPeso: 'lb',
        cantidadPredefinidaIcono: '1',
        precioBase: '4.75',
        fotoPath: null,
      }),
    ).not.toThrow();
  });
});

// ===========================================================================
describe('Ajuste de inventario: recepción de mercadería', () => {
  it('suma al saldo con aritmética exacta, sin punto flotante', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '0.1' }));

    productos.ajustarInventario(idAdmin, { productoId: creado.id, cantidad: '0.2' });

    // Con aritmética nativa esto daría 0.30000000000000004.
    const guardado = repos.productos.obtenerPorId(creado.id);
    expect(cantidadACadena(guardado?.inventarioDisponible ?? '0')).toBe('0.300');
  });

  it('devuelve el saldo anterior, lo agregado y el nuevo', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '100' }));
    const resultado = productos.ajustarInventario(idAdmin, {
      productoId: creado.id,
      cantidad: '50.5',
      motivo: 'compra a proveedor La Bendición',
    });

    expect(resultado.cantidadAnterior).toBe('100.000');
    expect(resultado.cantidadAgregada).toBe('50.500');
    expect(resultado.cantidadNueva).toBe('150.500');
  });

  it('RECHAZA una cantidad negativa: las mermas son otro módulo', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '100' }));
    escriturasEnLaBase = 0;

    expect(() =>
      productos.ajustarInventario(idAdmin, { productoId: creado.id, cantidad: '-10' }),
    ).toThrow(/tiene que ser mayor que cero/);

    // Se rechaza ANTES de tocar la base, no por el CHECK del esquema.
    expect(escriturasEnLaBase).toBe(0);
    expect(cantidadACadena(repos.productos.obtenerPorId(creado.id)?.inventarioDisponible ?? '0'))
      .toBe('100.000');
  });

  it('RECHAZA una cantidad de cero: no es un ingreso de mercadería', () => {
    const creado = productos.crear(idAdmin, maiz());
    expect(() =>
      productos.ajustarInventario(idAdmin, { productoId: creado.id, cantidad: '0' }),
    ).toThrow(/mayor que cero/);
  });

  it('el mensaje explica que las mermas todavía no existen', () => {
    const creado = productos.crear(idAdmin, maiz());
    expect(() =>
      productos.ajustarInventario(idAdmin, { productoId: creado.id, cantidad: '-1' }),
    ).toThrow(/mermas y pérdidas son otro módulo/);
  });

  it('el inventario NUNCA queda negativo, sumando solo se puede subir', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '0' }));

    for (const cantidad of ['1', '2.5', '0.001']) {
      productos.ajustarInventario(idAdmin, { productoId: creado.id, cantidad });
    }

    const saldo = repos.productos.obtenerPorId(creado.id)?.inventarioDisponible;
    expect(cantidadACadena(saldo ?? '0')).toBe('3.501');
    expect(saldo?.isNegative()).toBe(false);
  });

  it('la base sigue siendo la última red: rechaza un saldo negativo escrito directo', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '10' }));

    expect(() => {
      repos.productos.fijarInventario(creado.id, '-1');
    }).toThrow(/Stock insuficiente/);
  });

  it('queda auditado con el saldo anterior, el nuevo y el motivo', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '100' }));
    productos.ajustarInventario(idAdmin, {
      productoId: creado.id,
      cantidad: '50',
      motivo: 'compra a proveedor X',
    });

    const asiento = repos.auditoria
      .listarPorEntidad('productos', creado.id)
      .find((registro) => registro.accion === 'inventario_ajustado');

    expect(asiento).toBeDefined();
    expect(asiento?.usuarioId).toBe(idAdmin);
    expect(asiento?.valorAnterior).toContain('100.000');
    expect(asiento?.valorNuevo).toContain('150.000');
    expect(asiento?.valorNuevo).toContain('compra a proveedor X');
  });

  it('usa una acción de auditoría PROPIA, distinta de editar el producto', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '100' }));
    productos.ajustarInventario(idAdmin, { productoId: creado.id, cantidad: '50' });

    const acciones = repos.auditoria
      .listarPorEntidad('productos', creado.id)
      .map((registro) => registro.accion);

    // Recibir mercadería y corregir el catálogo son hechos distintos del
    // negocio: si compartieran nombre de acción, no se podría auditar cuánta
    // mercadería entró sin leer el contenido de cada asiento.
    expect(acciones).toContain('inventario_ajustado');
    expect(acciones).not.toContain('producto_editado');
  });

  it('el motivo es opcional y queda como nulo cuando no se da', () => {
    const creado = productos.crear(idAdmin, maiz());
    productos.ajustarInventario(idAdmin, { productoId: creado.id, cantidad: '5' });

    const asiento = repos.auditoria
      .listarPorEntidad('productos', creado.id)
      .find((registro) => registro.accion === 'inventario_ajustado');

    expect(asiento?.valorNuevo).toContain('"motivo":null');
  });

  it('editar un producto NO mueve el inventario', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '100' }));

    productos.editar(idAdmin, creado.id, {
      nombre: 'Maíz blanco de primera',
      categoriaId: idGranos,
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '2',
      precioBase: '5.00',
      fotoPath: null,
    });

    const guardado = repos.productos.obtenerPorId(creado.id);
    expect(cantidadACadena(guardado?.inventarioDisponible ?? '0')).toBe('100.000');
  });
});

// ===========================================================================
describe('Desactivar un producto no borra ni rompe referencias', () => {
  it('el producto sigue existiendo, con su inventario intacto', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '75' }));
    productos.fijarActivo(idAdmin, creado.id, false);

    const guardado = repos.productos.obtenerPorId(creado.id);
    expect(guardado).not.toBeNull();
    expect(guardado?.activo).toBe(false);
    expect(cantidadACadena(guardado?.inventarioDisponible ?? '0')).toBe('75.000');
  });

  it('desaparece del listado de venta pero no del de administración', () => {
    const creado = productos.crear(idAdmin, maiz());
    productos.fijarActivo(idAdmin, creado.id, false);

    expect(productos.listarActivos().map((p) => p.id)).not.toContain(creado.id);
    expect(productos.listarTodos().map((p) => p.id)).toContain(creado.id);
  });

  it('una venta que lo referencia sigue existiendo y se puede consultar', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '100' }));

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
      productoId: creado.id,
      productoNombreSnap: creado.nombre,
      unidadSnap: 'lb',
      cantidad: '1',
      precioUnitarioSnap: '4.25',
      subtotalExacto: '4.25',
      subtotalImpreso: '4.25',
      ordenLinea: 0,
    });

    productos.fijarActivo(idAdmin, creado.id, false);

    const detalle = repos.ventaDetalle.listarPorVenta(venta.id);
    expect(detalle).toHaveLength(1);
    expect(detalle[0]?.productoId).toBe(creado.id);
    // La foto del nombre sobrevive aunque el producto se retire del catálogo.
    expect(detalle[0]?.productoNombreSnap).toBe('Maíz blanco');
  });

  it('se puede reactivar y vuelve al listado de venta', () => {
    const creado = productos.crear(idAdmin, maiz());
    productos.fijarActivo(idAdmin, creado.id, false);
    productos.fijarActivo(idAdmin, creado.id, true);

    expect(productos.listarActivos().map((p) => p.id)).toContain(creado.id);
  });

  it('la auditoría deja constancia del inventario con que quedó guardado', () => {
    const creado = productos.crear(idAdmin, maiz({ inventarioInicial: '75' }));
    productos.fijarActivo(idAdmin, creado.id, false);

    const asiento = repos.auditoria
      .listarPorEntidad('productos', creado.id)
      .find((registro) => registro.accion === 'producto_desactivado');

    expect(asiento?.valorNuevo).toContain('75.000');
  });
});

// ===========================================================================
/**
 * El orden de la cuadrícula de venta.
 *
 * No es cosmético: si el orden fuera ambiguo, la cuadrícula se reacomodaría
 * sola entre una recarga y otra, y el cajero que ya sabe dónde está el maíz
 * tendría que volver a buscarlo. Es el mismo criterio de «nunca dejar un orden
 * ambiguo» del reparto de centavos del comprobante.
 */
describe('La cuadrícula de venta tiene un orden determinista', () => {
  /** Crea un producto con el contador de ventas indicado. */
  function sembrar(nombre: string, ventas: number): string {
    const creado = productos.crear(idAdmin, maiz({ nombre }));
    for (let venta = 0; venta < ventas; venta += 1) {
      repos.productos.incrementarContadorVentas(creado.id);
    }
    return creado.id;
  }

  it('los más vendidos van primero', () => {
    sembrar('Poco vendido', 1);
    sembrar('Muy vendido', 9);
    sembrar('Vendido a medias', 5);

    expect(productos.listarParaVenta().map((p) => p.nombre)).toEqual([
      'Muy vendido',
      'Vendido a medias',
      'Poco vendido',
    ]);
  });

  it('CON EL CONTADOR EMPATADO, desempata el nombre', () => {
    // Es el estado de HOY: nada incrementa `contador_ventas` todavía, así que
    // todos los productos están en cero y sin desempate el orden sería el que
    // SQLite tuviera ganas de devolver.
    sembrar('Zanahoria', 0);
    sembrar('Arroz', 0);
    sembrar('Maíz', 0);

    expect(productos.listarParaVenta().map((p) => p.nombre)).toEqual([
      'Arroz',
      'Maíz',
      'Zanahoria',
    ]);
  });

  it('el mismo catálogo consultado diez veces devuelve el MISMO orden', () => {
    for (const nombre of ['Arroz', 'Frijol', 'Maíz', 'Azúcar', 'Sal']) {
      sembrar(nombre, 0);
    }

    const primera = productos.listarParaVenta().map((p) => p.id);
    for (let corrida = 0; corrida < 10; corrida += 1) {
      expect(productos.listarParaVenta().map((p) => p.id)).toEqual(primera);
    }
  });

  it('el empate solo desempata DENTRO del mismo contador', () => {
    sembrar('Zeta pero muy vendida', 7);
    sembrar('Arroz sin ventas', 0);
    sembrar('Banano sin ventas', 0);

    expect(productos.listarParaVenta().map((p) => p.nombre)).toEqual([
      'Zeta pero muy vendida',
      'Arroz sin ventas',
      'Banano sin ventas',
    ]);
  });

  it('los productos DESACTIVADOS no llegan a la cuadrícula', () => {
    const id = sembrar('Retirado', 3);
    sembrar('Vigente', 1);
    productos.fijarActivo(idAdmin, id, false);

    expect(productos.listarParaVenta().map((p) => p.nombre)).toEqual(['Vigente']);
  });
});
