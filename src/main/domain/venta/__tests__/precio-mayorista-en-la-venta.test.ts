/**
 * El precio mayorista en la venta de verdad (spec 002): servicio real, base
 * SQLite real, migrada desde cero.
 *
 * Lo que se comprueba acá, que la prueba de la función compartida no puede:
 *
 *   · Que `ServicioDeVenta` COBRA con esa función: el precio que queda
 *     congelado en `venta_detalle.precio_unitario_snap` (CA-1 a CA-6, CA-10,
 *     CA-11, CA-14).
 *   · Que el descuento discrecional sigue igual, sobre el subtotal mayorista
 *     (CA-15).
 *   · Que el asiento de la venta dice de dónde salió el precio (CA-23).
 *   · Que LO QUE LA PANTALLA MUESTRA ES LO QUE SE COBRA (CA-13): el ticket de la
 *     pantalla, alimentado con el mismo DTO que manda el proceso principal,
 *     calcula el mismo precio que guarda el cobro, en una grilla de casos.
 *
 * Los números son los de la spec: Maíz por libra (lista Q6.00, mayorista Q5.50
 * desde 50 lb), Azúcar por kilogramo (Q9.00, Q8.20 desde 25.5 kg) y Huevo por
 * unidad (Q1.25, Q1.10 desde 30).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import type { OrigenDelPrecio } from '@shared/precio-de-linea';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseVacia, crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { aplicarMigraciones, MIGRACIONES } from '@main/database/migrator';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { productoParaVender } from '@main/ipc/producto-para-vender';
import type { LogTecnico } from '@main/log-tecnico';
import { agregarAlTicket, fijarCantidad } from '../../../../renderer/src/venta/ticket';
import { ServicioDeVenta, type DatosDeLaVenta } from '../servicio-de-venta';

/** Bitácora técnica que no se lee en estas pruebas. */
const bitacora: LogTecnico = { registrar: (): void => undefined };

/** Reloj fijo del servicio, para que la vigencia de los precios especiales sea reproducible. */
const MOMENTO = new Date('2026-09-18T15:00:00.000Z').getTime();
const HACE_UNA_SEMANA = '2026-09-11T00:00:00.000Z';

let base: Database;
let repos: Repositorios;
let venta: ServicioDeVenta;
let limpiar: () => void;
let idCajera: string;
let idCategoria: string;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  venta = new ServicioDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    preciosEspeciales: repos.preciosEspeciales,
    limitesDescuento: repos.limitesDescuento,
    cajaSesiones: repos.cajaSesiones,
    auditoria: repos.auditoria,
    log: bitacora,
    ahora: (): number => MOMENTO,
  });
  const caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });

  idCajera = repos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pinHash: generarHashDePin('1357') }).id;
  idCategoria = repos.categorias.crear({ nombre: 'Granos' }).id;
  caja.abrir(idCajera, { modo: 'simple', monto: '500' });
});

afterEach(() => {
  limpiar();
});

interface Configuracion {
  readonly nombre: string;
  readonly medida: 'lb' | 'kg' | 'unidad';
  readonly lista: string;
  readonly mayorista: { readonly precio: string; readonly cantidadMinima: string } | null;
  /** Un precio especial vigente, en porcentaje o en quetzales. */
  readonly especial?: { readonly tipo: 'porcentaje' | 'monto_fijo'; readonly valor: string };
}

/** Crea el producto (con su precio especial vigente, si lo lleva) y devuelve su id. */
function producto(configuracion: Configuracion): string {
  const id = repos.productos.crear({
    nombre: configuracion.nombre,
    categoriaId: idCategoria,
    tipoMedida: configuracion.medida === 'unidad' ? 'unidad' : 'peso',
    unidadPeso: configuracion.medida === 'unidad' ? null : configuracion.medida,
    cantidadPredefinidaIcono: '1',
    precioBase: configuracion.lista,
    inventarioDisponible: '10000',
    mayorista: configuracion.mayorista,
  }).id;
  if (configuracion.especial !== undefined) {
    repos.preciosEspeciales.crear({
      productoId: id,
      tipo: configuracion.especial.tipo,
      valor: configuracion.especial.valor,
      vigenteDesde: HACE_UNA_SEMANA,
      vigenteHasta: null,
    });
  }
  return id;
}

const MAIZ: Configuracion = {
  nombre: 'Maíz',
  medida: 'lb',
  lista: '6.00',
  mayorista: { precio: '5.50', cantidadMinima: '50' },
};

function enEfectivo(lineas: DatosDeLaVenta['lineas']): DatosDeLaVenta {
  return { lineas, descuento: null, formaPago: 'efectivo', numBoleta: null };
}

interface LineaCobrada {
  readonly precio: string;
  readonly origen: OrigenDelPrecio;
  readonly precioEspecialId: string | null;
  readonly mayorista: unknown;
}

/** Cobra UNA línea y devuelve lo que quedó guardado: el precio congelado y lo que dice el asiento. */
function cobrar(productoId: string, cantidad: string): LineaCobrada {
  const resultado = venta.registrar(idCajera, 'venta', enEfectivo([{ productoId, cantidad }]));
  const detalle = base
    .prepare('SELECT precio_unitario_snap FROM venta_detalle WHERE venta_id = ?')
    .get(resultado.venta.id) as { precio_unitario_snap: string };
  const asiento = base
    .prepare("SELECT valor_nuevo FROM auditoria_log WHERE accion = 'venta_registrada' AND entidad_id = ?")
    .get(resultado.venta.id) as { valor_nuevo: string };
  const [linea] = (
    JSON.parse(asiento.valor_nuevo) as {
      lineas: { origenDelPrecio: OrigenDelPrecio; precioEspecialId: string | null; mayorista: unknown }[];
    }
  ).lineas;
  if (linea === undefined) {
    throw new Error('El asiento de la venta no tiene líneas.');
  }
  return {
    precio: detalle.precio_unitario_snap,
    origen: linea.origenDelPrecio,
    precioEspecialId: linea.precioEspecialId,
    mayorista: linea.mayorista,
  };
}

/** Precio y origen de lo cobrado, legibles juntos. */
function cobrado(productoId: string, cantidad: string): string {
  const linea = cobrar(productoId, cantidad);
  return `${linea.precio} ${linea.origen}`;
}

// ===========================================================================
describe('Con el servicio real: lo que se congela en precio_unitario_snap', () => {
  it('CA-1 y CA-2: solo mayorista — 49.999 lb a Q6.00 (lista); 50 y 80 lb a Q5.50 (mayorista)', () => {
    const maiz = producto(MAIZ);
    expect(cobrado(maiz, '49.999')).toBe('6.00 lista');
    expect(cobrado(maiz, '50')).toBe('5.50 mayorista');
    expect(cobrado(maiz, '80')).toBe('5.50 mayorista');
  });

  it('CA-3: solo especial (10 %) — Q5.40 con cualquier cantidad, como antes de la spec 002', () => {
    const maiz = producto({ ...MAIZ, mayorista: null, especial: { tipo: 'porcentaje', valor: '10' } });
    expect(cobrado(maiz, '1')).toBe('5.40 especial');
    expect(cobrado(maiz, '500')).toBe('5.40 especial');
  });

  it('CA-4: los dos, gana el MAYORISTA — especial 5 % (Q5.70) y mayorista Q5.50: con 50 lb, Q5.50; con 49.999 lb, Q5.70', () => {
    const maiz = producto({ ...MAIZ, especial: { tipo: 'porcentaje', valor: '5' } });
    expect(cobrado(maiz, '50')).toBe('5.50 mayorista');
    expect(cobrado(maiz, '49.999')).toBe('5.70 especial');
  });

  it('CA-5: los dos, gana el ESPECIAL — especial 10 % (Q5.40) y mayorista Q5.50: con 60 lb, Q5.40', () => {
    const maiz = producto({ ...MAIZ, especial: { tipo: 'porcentaje', valor: '10' } });
    expect(cobrado(maiz, '60')).toBe('5.40 especial');
  });

  it('CA-6: empate — especial de Q0.50 menos (Q5.50) y mayorista Q5.50: se cobra Q5.50, marcado especial', () => {
    const maiz = producto({ ...MAIZ, especial: { tipo: 'monto_fijo', valor: '0.50' } });
    expect(cobrado(maiz, '60')).toBe('5.50 especial');
  });

  it('CA-10: por kilogramo — Azúcar 25.499 kg a Q9.00 y 25.500 kg a Q8.20', () => {
    const azucar = producto({
      nombre: 'Azúcar',
      medida: 'kg',
      lista: '9.00',
      mayorista: { precio: '8.20', cantidadMinima: '25.5' },
    });
    expect(cobrado(azucar, '25.499')).toBe('9.00 lista');
    expect(cobrado(azucar, '25.5')).toBe('8.20 mayorista');
  });

  it('CA-11: por unidad — Huevo 29 a Q1.25 y 30 a Q1.10', () => {
    const huevo = producto({
      nombre: 'Huevo',
      medida: 'unidad',
      lista: '1.25',
      mayorista: { precio: '1.10', cantidadMinima: '30' },
    });
    expect(cobrado(huevo, '29')).toBe('1.25 lista');
    expect(cobrado(huevo, '30')).toBe('1.10 mayorista');
  });

  it('el subtotal de la línea sale del precio mayorista: 50 lb × Q5.50 = Q275.00', () => {
    const maiz = producto(MAIZ);
    const resultado = venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '50' }]));
    expect(resultado.total).toBe('275.00');
    expect(resultado.lineasConPrecioMayorista).toBe(1);
    expect(resultado.lineasConPrecioEspecial).toBe(0);
    expect(
      base.prepare('SELECT subtotal_exacto, subtotal_impreso FROM venta_detalle WHERE venta_id = ?').get(resultado.venta.id),
    ).toEqual({ subtotal_exacto: '275', subtotal_impreso: '275.00' });
  });
});

// ===========================================================================
describe('CA-14 — Ninguna columna nueva en venta_detalle', () => {
  it('la 039 no le agrega nada a venta_detalle: sus columnas son las mismas que antes de ella', () => {
    const antes = crearBaseVacia();
    try {
      aplicarMigraciones(antes.base, MIGRACIONES.filter((m) => m.orden < 39));
      const columnas = (conexion: Database): string[] =>
        (conexion.prepare('PRAGMA table_info(venta_detalle)').all() as { name: string }[]).map((c) => c.name);
      expect(columnas(base)).toEqual(columnas(antes.base));
      expect(columnas(base).some((nombre) => /mayorista|origen/.test(nombre))).toBe(false);
    } finally {
      antes.limpiar();
    }
  });
});

// ===========================================================================
describe('CA-15 — El descuento discrecional no cambia: se aplica sobre el subtotal mayorista', () => {
  it('50 lb a Q5.50 (Q275.00) con un 10 % de descuento: subtotal Q275.00, descuento Q27.50, total Q247.50', () => {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '20',
      editadoPor: null,
    });
    const maiz = producto(MAIZ);
    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '50' }],
      descuento: { tipo: 'porcentaje', valor: '10' },
      formaPago: 'efectivo',
      numBoleta: null,
    });
    expect([resultado.subtotal, resultado.descuentoAplicado, resultado.total]).toEqual(['275.00', '27.50', '247.50']);
  });
});

// ===========================================================================
describe('CA-23 — El asiento de la venta dice de dónde salió el precio', () => {
  it('a precio mayorista: origen «mayorista», con la configuración usada, y sin precio especial', () => {
    const maiz = producto({ ...MAIZ, especial: { tipo: 'porcentaje', valor: '5' } });
    const linea = cobrar(maiz, '50');
    expect(linea.origen).toBe('mayorista');
    expect(linea.mayorista).toEqual({ precio: '5.50', cantidadMinima: '50.000' });
    // Había un especial vigente, pero no fijó el precio: no se anota.
    expect(linea.precioEspecialId).toBeNull();
  });

  it('a precio especial: origen «especial», y el id del especial', () => {
    const maiz = producto({ ...MAIZ, especial: { tipo: 'porcentaje', valor: '10' } });
    const linea = cobrar(maiz, '60');
    expect(linea.origen).toBe('especial');
    expect(linea.precioEspecialId).not.toBeNull();
  });

  it('a precio de lista, en un producto sin mayorista: origen «lista» y mayorista null', () => {
    const maiz = producto({ ...MAIZ, mayorista: null });
    const linea = cobrar(maiz, '60');
    expect(linea.origen).toBe('lista');
    expect(linea.mayorista).toBeNull();
    expect(linea.precioEspecialId).toBeNull();
  });
});

// ===========================================================================
describe('CA-13 — LO QUE LA PANTALLA MUESTRA ES LO QUE SE COBRA', () => {
  /*
    El ticket de la pantalla se alimenta con el MISMO DTO que manda el proceso
    principal (`productoParaVender`) y calcula el precio con la cantidad; el
    cobro lo vuelve a calcular contra la base. Los dos tienen que decir lo
    mismo, precio y origen, en toda la grilla.
  */
  it('tres productos × tres precios especiales × tres cantidades alrededor del umbral: 27 de 27 coinciden', () => {
    const bases: readonly (Configuracion & { readonly cantidades: readonly string[] })[] = [
      { ...MAIZ, cantidades: ['49.999', '50', '80'] },
      {
        nombre: 'Azúcar',
        medida: 'kg',
        lista: '9.00',
        mayorista: { precio: '8.20', cantidadMinima: '25.5' },
        cantidades: ['25.499', '25.5', '40'],
      },
      {
        nombre: 'Huevo',
        medida: 'unidad',
        lista: '1.25',
        mayorista: { precio: '1.10', cantidadMinima: '30' },
        cantidades: ['29', '30', '45'],
      },
    ];
    const especiales = [
      undefined,
      { tipo: 'porcentaje' as const, valor: '5' },
      { tipo: 'porcentaje' as const, valor: '10' },
    ];

    const comparaciones: string[] = [];
    for (const configuracion of bases) {
      for (const [indice, especial] of especiales.entries()) {
        const id = producto({
          ...configuracion,
          nombre: `${configuracion.nombre} ${String(indice)}`,
          ...(especial === undefined ? {} : { especial }),
        });
        for (const cantidad of configuracion.cantidades) {
          const deLaBase = repos.productos.obtenerPorId(id);
          if (deLaBase === null) {
            throw new Error('Falta el producto recién creado.');
          }
          const dto = productoParaVender(
            deLaBase,
            repos.preciosEspeciales.vigentesPorProductoEn(new Date(MOMENTO).toISOString()).get(id) ?? [],
            'Granos',
            null,
          );
          const [lineaDelTicket] = fijarCantidad(agregarAlTicket([], dto), id, cantidad);
          const enPantalla = `${lineaDelTicket?.precioUnitario ?? '?'} ${lineaDelTicket?.origenDelPrecio ?? '?'}`;
          const enLaBase = cobrado(id, cantidad);
          comparaciones.push(`${dto.nombre} × ${cantidad}: pantalla ${enPantalla} · cobro ${enLaBase}`);
          expect(enPantalla, comparaciones.at(-1)).toBe(enLaBase);
        }
      }
    }
    expect(comparaciones).toHaveLength(27);
  });
});
