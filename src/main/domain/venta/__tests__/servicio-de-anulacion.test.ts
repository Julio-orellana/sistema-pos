/**
 * Pruebas de la anulación de una venta (docs/ANULACION-DE-VENTA.md §10.1).
 *
 * Contra una base SQLite real, con los servicios reales: la venta se registra
 * con `ServicioDeVenta`, el ajuste con `ServicioDeProductos`, el PIN con
 * `ServicioDeAutenticacion`, y la anulación pasa por `FlujoDeAnulacionDeVenta`
 * igual que desde la ventana. Donde una prueba necesita forzar algo que en la
 * aplicación no puede pasar —un conflicto del comparar-y-cambiar, una boleta
 * guardada con espacios— lo dice.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { cantidadACadena, montoACadena, sumarLista } from '@shared/money';
import { ErrorDeNegocio, traducirErrorDeBaseDeDatos } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import type { SuperficieDeAutorizacion } from '@main/database/repositories/bloqueos-de-autorizacion';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import type { UsuarioEnSesion } from '@main/domain/usuarios/sesion';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import { LogTecnicoSilencioso, type LogTecnico, type OrigenTecnico } from '@main/log-tecnico';
import { hayTransaccionDeNegocioEnCurso } from '@main/database/transaccion-en-curso';
import { ServicioDeReportes } from '@main/domain/reportes/servicio-de-reportes';
import { FlujoDeAnulacionDeVenta } from '@main/ipc/anulacion-de-venta';
import type { PedidoDeAnulacionIpc, ResultadoDeAnulacionIpc } from '@shared/types/ipc';
import { ServicioDeVenta, type DatosDeLaVenta } from '../servicio-de-venta';
import { ServicioDeAnulacionDeVenta } from '../servicio-de-anulacion';

const PIN_DE_JIMMY = '2468';
const PIN_REMOTO_DE_JIMMY = '9753';
const PIN_DE_ANA = '1357';
const PIN_MALO = '0000';
const MOTIVO = 'el cliente devolvió el producto';

let base: Database;
let repos: Repositorios;
let limpiar: () => void;
let caja: ServicioDeCaja;
let venta: ServicioDeVenta;
let productos: ServicioDeProductos;
let reportes: ServicioDeReportes;
let autenticacion: ServicioDeAutenticacion;
let anulacion: ServicioDeAnulacionDeVenta;
let bitacoraTecnica: BitacoraQueGuarda;

/** Bitácora técnica que guarda las líneas en memoria, para leerlas en las pruebas. */
class BitacoraQueGuarda implements LogTecnico {
  public readonly lineas: string[] = [];

  public registrar(origen: OrigenTecnico, mensaje: string): void {
    this.lineas.push(`[${origen}] ${mensaje}`);
  }
}
let flujo: FlujoDeAnulacionDeVenta;

let idJimmy: string;
let idAna: string;
let idCategoria: string;
let idMaiz: string;
let idFrijol: string;
let idCaja: string;

const reloj = new Date('2026-09-15T16:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

function crearProducto(nombre: string, precio: string, inventario: string): string {
  return repos.productos.crear({
    nombre,
    categoriaId: idCategoria,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: precio,
    inventarioDisponible: inventario,
  }).id;
}

/** Ana cobra en su caja. Devuelve el id de la venta. */
function vender(
  lineas: DatosDeLaVenta['lineas'],
  formaPago: 'efectivo' | 'tarjeta' = 'efectivo',
  numBoleta: string | null = formaPago === 'tarjeta' ? '004512' : null,
): string {
  return venta.registrar(idAna, 'venta', { lineas, descuento: null, formaPago, numBoleta }).venta.id;
}

function sesionDe(id: string, nombre: string, rol: 'venta' | 'administrativo'): UsuarioEnSesion {
  return { id, nombre, rol, desde: '2026-09-15T15:00:00.000Z' };
}

/** Pide la anulación como lo haría la ventana, con la sesión de Ana. */
function pedir(
  ventaId: string,
  pin: string | null,
  extra: Partial<Pick<PedidoDeAnulacionIpc, 'motivo' | 'voucher'>> = {},
): ResultadoDeAnulacionIpc {
  return flujo.pedir(
    { ventaId, motivo: extra.motivo ?? MOTIVO, voucher: extra.voucher ?? null, pin },
    sesionDe(idAna, 'Ana', 'venta'),
  );
}

/** El error de negocio que lanza una operación, o falla la prueba. */
function errorDe(operacion: () => unknown): ErrorDeNegocio {
  try {
    operacion();
  } catch (error) {
    if (error instanceof ErrorDeNegocio) {
      return error;
    }
    throw error;
  }
  throw new Error('Se esperaba un ErrorDeNegocio y la operación no lanzó nada.');
}

function inventarioDe(productoId: string): string {
  return cantidadACadena(repos.productos.obtenerPorId(productoId)?.inventarioDisponible ?? '0');
}

function esperadoDeLaCaja(): string {
  const sesion = repos.cajaSesiones.obtenerPorId(idCaja);
  if (sesion === null) {
    throw new Error('No está la caja de la prueba.');
  }
  return montoACadena(caja.montoEsperadoDe(sesion));
}

/** Una foto de todo lo que una anulación podría escribir, para comprobar que no escribió nada. */
function fotoDeLaBase(): Record<string, unknown> {
  const todas = (sql: string): unknown[] => base.prepare(sql).all();
  return {
    anulaciones: todas('SELECT * FROM anulaciones_de_venta ORDER BY id'),
    auditoria: todas('SELECT id FROM auditoria_log ORDER BY rowid'),
    cola: todas('SELECT id FROM sync_cola ORDER BY rowid'),
    productos: todas('SELECT * FROM productos ORDER BY id'),
    ventas: todas('SELECT * FROM ventas ORDER BY id'),
    candado: todas('SELECT * FROM bloqueos_de_autorizacion ORDER BY superficie'),
  };
}

/** Lee el JSON de un asiento como un objeto de campos sueltos. */
function campos(json: string | null | undefined): Record<string, unknown> {
  return JSON.parse(json ?? '{}') as Record<string, unknown>;
}

function asientos(accion: string): { usuario_id: string | null; entidad_tipo: string; entidad_id: string | null; valor_anterior: string | null; valor_nuevo: string }[] {
  return base
    .prepare('SELECT usuario_id, entidad_tipo, entidad_id, valor_anterior, valor_nuevo FROM auditoria_log WHERE accion = ? ORDER BY rowid')
    .all(accion) as { usuario_id: string | null; entidad_tipo: string; entidad_id: string | null; valor_anterior: string | null; valor_nuevo: string }[];
}

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  caja = new ServicioDeCaja({
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
  });
  productos = new ServicioDeProductos({
    base,
    productos: repos.productos,
    categorias: repos.categorias,
    auditoria: repos.auditoria,
    describirFoto: (): null => null,
  });
  reportes = new ServicioDeReportes({
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    categorias: repos.categorias,
    ahora: (): number => reloj,
  });
  autenticacion = new ServicioDeAutenticacion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
  });
  bitacoraTecnica = new BitacoraQueGuarda();
  anulacion = new ServicioDeAnulacionDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    cajaSesiones: repos.cajaSesiones,
    recibos: repos.recibos,
    usuarios: repos.usuarios,
    anulaciones: repos.anulacionesDeVenta,
    auditoria: repos.auditoria,
    log: bitacoraTecnica,
    ahora: (): number => reloj,
  });
  flujo = new FlujoDeAnulacionDeVenta({ anulacion, autenticacion });

  idJimmy = repos.usuarios.crear({ nombre: 'Jimmy', rol: 'administrativo', pinHash: generarHashDePin(PIN_DE_JIMMY) }).id;
  repos.usuarios.actualizarPinRemotoHash(idJimmy, generarHashDePin(PIN_REMOTO_DE_JIMMY));
  idAna = repos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pinHash: generarHashDePin(PIN_DE_ANA) }).id;
  idCategoria = repos.categorias.crear({ nombre: 'Granos', orden: 1 }).id;
  idMaiz = crearProducto('Maíz blanco', '4.25', '100');
  idFrijol = crearProducto('Frijol negro', '9.00', '50');
  idCaja = caja.abrir(idAna, { modo: 'simple', monto: '500' }).id;
});

afterEach(() => {
  limpiar();
});

// ===========================================================================
describe('El efectivo esperado: la venta anulada se EXCLUYE, no se resta', () => {
  it('una venta en efectivo anulada deja de contar en el efectivo esperado', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    vender([{ productoId: idFrijol, cantidad: '1' }]);
    expect(esperadoDeLaCaja()).toBe('517.50');

    expect(pedir(ventaId, PIN_DE_JIMMY).anulada).toBe(true);

    expect(esperadoDeLaCaja()).toBe('509.00');
  });

  it('una con tarjeta NO lo cambia, ni al venderse ni al anularse', () => {
    vender([{ productoId: idFrijol, cantidad: '1' }]);
    const conTarjeta = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta');
    expect(esperadoDeLaCaja()).toBe('509.00');

    const resultado = pedir(conTarjeta, PIN_DE_JIMMY, { voucher: '004512' });
    expect(resultado.anulada).toBe(true);
    expect(resultado.anulacion?.efectivoQueDejaDeContar).toBe('0.00');

    expect(esperadoDeLaCaja()).toBe('509.00');
  });

  it('el ejemplo de §3.2: A, B con tarjeta y C; se anula A y después B', () => {
    const a = vender([{ productoId: idMaiz, cantidad: '6.471' }]); // Q27.50
    const b = vender([{ productoId: idFrijol, cantidad: '4.444' }], 'tarjeta'); // Q40.00
    vender([{ productoId: idFrijol, cantidad: '1.333' }]); // Q12.00
    expect(esperadoDeLaCaja()).toBe('539.50');

    pedir(a, PIN_DE_JIMMY);
    expect(esperadoDeLaCaja()).toBe('512.00');

    pedir(b, PIN_DE_JIMMY, { voucher: '004512' });
    expect(esperadoDeLaCaja()).toBe('512.00');
  });
});

// ===========================================================================
describe('La reposición SUMA sobre el saldo de HOY (§2.1)', () => {
  it('con un ajuste y otra venta en el medio: 100 − 5, +50, −3, y al anular la primera queda 147, no 100', () => {
    const ventaA = vender([{ productoId: idMaiz, cantidad: '5' }]);
    expect(inventarioDe(idMaiz)).toBe('95.000');
    productos.ajustarInventario(idJimmy, { productoId: idMaiz, cantidad: '50', motivo: 'llegó un pedido' });
    vender([{ productoId: idMaiz, cantidad: '3' }]);
    expect(inventarioDe(idMaiz)).toBe('142.000');

    const resultado = pedir(ventaA, PIN_DE_JIMMY);

    expect(inventarioDe(idMaiz)).toBe('147.000');
    expect(resultado.anulacion?.productos).toEqual([
      expect.objectContaining({ productoId: idMaiz, cantidad: '5.000', saldoAnterior: '142.000', saldoNuevo: '147.000' }),
    ]);
  });

  it('los dos contadores bajan, y la suma de los reportes vuelve a dar el acumulado', () => {
    const ventaA = vender([{ productoId: idMaiz, cantidad: '5' }]);
    vender([{ productoId: idMaiz, cantidad: '3' }]);
    const antes = repos.productos.obtenerPorId(idMaiz);
    expect(antes?.contadorVentas).toBe(2);
    expect(cantidadACadena(antes?.cantidadVendida ?? '0')).toBe('8.000');

    pedir(ventaA, PIN_DE_JIMMY);

    const despues = repos.productos.obtenerPorId(idMaiz);
    expect(despues?.contadorVentas).toBe(1);
    expect(cantidadACadena(despues?.cantidadVendida ?? '0')).toBe('3.000');

    // «Son los mismos hechos»: el reporte del período excluye la anulada, y su
    // cantidad tiene que dar el acumulado del producto.
    const fila = reportes.ventasPorProducto({ clase: 'hoy' }).productos.find((p) => p.productoId === idMaiz);
    expect(fila?.vecesVendido).toBe(1);
    expect(sumarLista([fila?.cantidadVendida ?? '0']).toFixed(3)).toBe(despues?.cantidadVendida.toFixed(3));
    expect(reportes.resumenDeVentas({ clase: 'hoy' }).cantidadDeVentas).toBe(1);
  });

  it('un producto DESACTIVADO se repone igual y NO se reactiva; la vista previa lo avisa', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '5' }]);
    repos.productos.fijarActivo(idMaiz, false);

    const vista = pedir(ventaId, null).vistaPrevia;
    expect(vista.productosDesactivados).toEqual(['Maíz blanco']);
    expect(vista.lineas[0]?.productoActivo).toBe(false);

    const resultado = pedir(ventaId, PIN_DE_JIMMY);
    expect(resultado.anulada).toBe(true);
    expect(inventarioDe(idMaiz)).toBe('100.000');
    expect(repos.productos.obtenerPorId(idMaiz)?.activo).toBe(false);
    const lineas = campos(asientos('venta_anulada')[0]?.valor_nuevo).lineas as { productoActivo: boolean }[];
    expect(lineas[0]?.productoActivo).toBe(false);
  });

  it('una venta con varios productos repone cada uno sobre su propio saldo', () => {
    const ventaId = vender([
      { productoId: idMaiz, cantidad: '2.5' },
      { productoId: idFrijol, cantidad: '1' },
    ]);
    expect(inventarioDe(idMaiz)).toBe('97.500');
    expect(inventarioDe(idFrijol)).toBe('49.000');

    pedir(ventaId, PIN_DE_JIMMY);

    expect(inventarioDe(idMaiz)).toBe('100.000');
    expect(inventarioDe(idFrijol)).toBe('50.000');
  });
});

// ===========================================================================
describe('Lo que se rechaza ANTES de pedir el PIN, sin escribir nada', () => {
  it('con la UNIDAD cambiada (de lb a unidad) se rechaza, contando filas', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2.5' }]);
    base.prepare("UPDATE productos SET tipo_medida = 'unidad', unidad_peso = NULL WHERE id = ?").run(idMaiz);
    const antes = fotoDeLaBase();

    const error = errorDe(() => pedir(ventaId, null));

    expect(error.codigo).toBe('UNIDAD_CAMBIADA');
    expect(error.mensajeParaElUsuario).toBe(
      'La unidad de Maíz blanco cambió desde la venta (se vendió en lb y hoy se cuenta por unidad). ' +
        'El sistema no tiene cómo convertir la cantidad, así que la venta no se anuló.',
    );
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('también si solo cambió la unidad de peso (de lb a kg), y tampoco con el PIN correcto', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2.5' }]);
    base.prepare("UPDATE productos SET unidad_peso = 'kg' WHERE id = ?").run(idMaiz);
    const antes = fotoDeLaBase();

    expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY)).codigo).toBe('UNIDAD_CAMBIADA');
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('con la CAJA CERRADA se rechaza', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    caja.intentarCerrar(idCaja, { modo: 'simple', monto: '508.50' }, { usuarioQueCierra: idAna });
    expect(repos.cajaSesiones.obtenerPorId(idCaja)?.estado).toBe('cerrada');
    const antes = fotoDeLaBase();

    const error = errorDe(() => pedir(ventaId, PIN_DE_JIMMY));

    expect(error.codigo).toBe('CAJA_DE_LA_VENTA_CERRADA');
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('la SEGUNDA anulación de la misma venta se rechaza', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    expect(pedir(ventaId, PIN_DE_JIMMY).anulada).toBe(true);
    const antes = fotoDeLaBase();

    expect(errorDe(() => pedir(ventaId, null)).codigo).toBe('VENTA_YA_ANULADA');
    expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY)).codigo).toBe('VENTA_YA_ANULADA');
    expect(inventarioDe(idMaiz)).toBe('100.000');
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('SIN MOTIVO se rechaza, y con más de 200 caracteres también', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    const antes = fotoDeLaBase();

    expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY, { motivo: '   ' })).mensajeParaElUsuario).toBe(
      'Escribí el motivo de la anulación.',
    );
    expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY, { motivo: 'x'.repeat(201) })).codigo).toBe('DATO_INVALIDO');
    expect(fotoDeLaBase()).toEqual(antes);
    // Y con 200 exactos pasa.
    expect(pedir(ventaId, PIN_DE_JIMMY, { motivo: 'x'.repeat(200) }).anulada).toBe(true);
  });

  it('una venta que no existe se rechaza', () => {
    expect(errorDe(() => pedir('00000000-0000-4000-8000-000000000000', null)).codigo).toBe('REFERENCIA_INEXISTENTE');
  });

  it('una venta que se anuló o una caja que se cerró MIENTRAS TANTO no consume un intento del candado: se valida antes de mirar el PIN', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    expect(pedir(ventaId, null).codigo).toBe('REQUIERE_AUTORIZACION');
    caja.intentarCerrar(idCaja, { modo: 'simple', monto: '508.50' }, { usuarioQueCierra: idAna });

    expect(errorDe(() => pedir(ventaId, PIN_MALO)).codigo).toBe('CAJA_DE_LA_VENTA_CERRADA');
    expect(repos.bloqueosDeAutorizacion.obtener('anulacion_de_venta').intentosFallidos).toBe(0);
    expect(asientos('anulacion_de_venta_rechazada')).toEqual([]);
  });
});

// ===========================================================================
describe('EL VOUCHER de una venta con tarjeta (§3.3, decisión 9)', () => {
  it('con un voucher DISTINTO se rechaza con «El voucher no coincide con el de la venta original», sin pedir PIN, sin sumar intento y sin escribir nada', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta', '004512');
    const antes = fotoDeLaBase();

    // Con el PIN CORRECTO incluso: no se llega a mirarlo.
    const error = errorDe(() => pedir(ventaId, PIN_DE_JIMMY, { voucher: '004513' }));

    expect(error.codigo).toBe('VOUCHER_NO_COINCIDE');
    expect(error.mensajeParaElUsuario).toBe('El voucher no coincide con el de la venta original.');
    expect(error.mensajeParaElUsuario).not.toContain('004512');
    expect(repos.bloqueosDeAutorizacion.obtener('anulacion_de_venta').intentosFallidos).toBe(0);
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('el voucher CORRECTO de OTRA venta también se rechaza: se compara contra ESTA venta', () => {
    const primera = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta', 'A-100');
    vender([{ productoId: idFrijol, cantidad: '1' }], 'tarjeta', 'B-200');

    expect(errorDe(() => pedir(primera, PIN_DE_JIMMY, { voucher: 'B-200' })).codigo).toBe('VOUCHER_NO_COINCIDE');
    expect(pedir(primera, PIN_DE_JIMMY, { voucher: 'A-100' }).anulada).toBe(true);
  });

  it('con tarjeta y SIN voucher se rechaza antes del PIN', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta');
    const antes = fotoDeLaBase();

    const error = errorDe(() => pedir(ventaId, PIN_DE_JIMMY, { voucher: null }));

    expect(error.mensajeParaElUsuario).toBe('Esta venta fue con tarjeta: escribí el número de voucher.');
    expect(errorDe(() => pedir(ventaId, null, { voucher: '  ' })).codigo).toBe('DATO_INVALIDO');
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('en EFECTIVO, un pedido CON voucher se rechaza', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);

    const error = errorDe(() => pedir(ventaId, null, { voucher: '004512' }));

    expect(error.codigo).toBe('DATO_INVALIDO');
    expect(error.mensajeParaElUsuario).toBe('Una venta en efectivo no lleva voucher.');
  });

  it('se recortan espacios DE LOS DOS LADOS, incluida una boleta guardada con espacios por el canal, y 0012 no es 12', () => {
    // El cobro por la pantalla recorta la boleta, pero el servicio la guarda tal
    // como llega: una venta cobrada llamando al canal a mano puede tener espacios.
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta', ' 0012 ');
    expect(repos.ventas.obtenerPorId(ventaId)?.numBoleta).toBe(' 0012 ');

    expect(errorDe(() => pedir(ventaId, null, { voucher: '12' })).codigo).toBe('VOUCHER_NO_COINCIDE');
    expect(errorDe(() => pedir(ventaId, null, { voucher: '0012a' })).codigo).toBe('VOUCHER_NO_COINCIDE');
    expect(pedir(ventaId, null, { voucher: '0012' }).codigo).toBe('REQUIERE_AUTORIZACION');
    expect(pedir(ventaId, PIN_DE_JIMMY, { voucher: '  0012' }).anulada).toBe(true);
  });

  it('distingue mayúsculas: B-1 no es b-1', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta', 'B-1');
    expect(errorDe(() => pedir(ventaId, null, { voucher: 'b-1' })).codigo).toBe('VOUCHER_NO_COINCIDE');
  });

  it('el pedido CON PIN y un voucher distinto del primero se rechaza igual: el flujo vuelve a validar, y la transacción también', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta', '004512');
    expect(pedir(ventaId, null, { voucher: '004512' }).codigo).toBe('REQUIERE_AUTORIZACION');
    const antes = fotoDeLaBase();

    // Por el flujo: se rechaza antes de mirar el PIN.
    expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY, { voucher: '999999' })).codigo).toBe('VOUCHER_NO_COINCIDE');
    // Llamando a la transacción directo, con una autorización ya concedida: la
    // transacción valida adentro y no escribe nada.
    expect(
      errorDe(() =>
        anulacion.anular({ ventaId, motivo: MOTIVO, voucher: '999999' }, idAna, { autorizadaPor: idJimmy, via: 'presencial' }),
      ).codigo,
    ).toBe('VOUCHER_NO_COINCIDE');
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('la vista previa de una venta con tarjeta muestra el voucher y dice que la devolución es en el banco', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta', '004512');
    const vista = pedir(ventaId, null, { voucher: '004512' }).vistaPrevia;
    expect(vista.numBoleta).toBe('004512');
    expect(vista.avisoDeDevolucion).toBe('La devolución se hace en la terminal del banco.');
  });
});

// ===========================================================================
describe('La vista previa y la transacción', () => {
  it('sin PIN devuelve REQUIERE_AUTORIZACION con la vista previa, y NO escribe nada', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    repos.recibos.crear({ ventaId, numeroRecibo: 128, pdfPath: 'recibos/recibo-000128.pdf' });
    const antes = fotoDeLaBase();

    const resultado = pedir(ventaId, null);

    expect(resultado).toEqual({
      anulada: false,
      codigo: 'REQUIERE_AUTORIZACION',
      mensaje: 'Anular una venta exige el PIN de un administrador.',
      segundosParaReintentar: null,
      anulacion: null,
      vistaPrevia: {
        ventaId,
        numeroRecibo: 128,
        fecha: repos.ventas.obtenerPorId(ventaId)?.fecha,
        vendidaPor: { id: idAna, nombre: 'Ana' },
        cajaAbiertaPor: { id: idAna, nombre: 'Ana' },
        formaPago: 'efectivo',
        numBoleta: null,
        total: '8.50',
        lineas: [{ productoId: idMaiz, nombreSnap: 'Maíz blanco', unidadSnap: 'lb', cantidad: '2.000', productoActivo: true }],
        productosDesactivados: [],
        avisoDeDevolucion: 'Hay que devolverle Q8.50 al cliente.',
      },
    });
    expect(fotoDeLaBase()).toEqual(antes);
  });

  it('la vista previa y el resultado NO llevan el teórico de la caja', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    const esperado = esperadoDeLaCaja();
    expect(esperado).toBe('508.50');
    expect(JSON.stringify(pedir(ventaId, null))).not.toContain(esperado);
    const hecho = pedir(ventaId, PIN_DE_JIMMY);
    expect(JSON.stringify(hecho)).not.toContain('508.50');
    expect(JSON.stringify(hecho)).not.toContain('500.00');
  });

  it('la fila de ventas, las de venta_detalle y la de recibos quedan BYTE A BYTE iguales antes y después de anular', () => {
    const ventaId = vender([
      { productoId: idMaiz, cantidad: '2' },
      { productoId: idFrijol, cantidad: '1' },
    ]);
    repos.recibos.crear({ ventaId, numeroRecibo: 7, pdfPath: 'recibos/recibo-000007.pdf' });
    const leer = (): unknown => ({
      ventas: base.prepare('SELECT * FROM ventas WHERE id = ?').all(ventaId),
      detalle: base.prepare('SELECT * FROM venta_detalle WHERE venta_id = ? ORDER BY orden_linea').all(ventaId),
      recibos: base.prepare('SELECT * FROM recibos WHERE venta_id = ?').all(ventaId),
    });
    const antes = leer();

    expect(pedir(ventaId, PIN_DE_JIMMY).anulada).toBe(true);

    expect(leer()).toEqual(antes);
    expect(repos.ventas.obtenerPorId(ventaId)?.estado).toBe('completada');
  });

  it('la anulación queda escrita con quién la pidió, quién la autorizó, por qué vía y el motivo recortado', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);

    const resultado = pedir(ventaId, PIN_DE_JIMMY, { motivo: '  el cliente devolvió el producto  ' });

    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toEqual({
      id: resultado.anulacion?.id,
      ventaId,
      solicitadaPor: idAna,
      autorizadaPor: idJimmy,
      autorizadaVia: 'presencial',
      motivo: MOTIVO,
      fecha: new Date(reloj).toISOString(),
    });
  });

  it('el lote encolado tiene la forma de §7.1 —anulación, productos, asiento— y NUNCA incluye ventas', () => {
    const ventaId = vender([
      { productoId: idMaiz, cantidad: '2' },
      { productoId: idFrijol, cantidad: '1' },
    ]);
    const resultado = pedir(ventaId, PIN_DE_JIMMY);
    const idAnulacion = resultado.anulacion?.id;

    const filas = base
      .prepare(
        `SELECT lote_id, orden_en_lote, entidad_tipo, entidad_id, operacion FROM sync_cola
          WHERE lote_id = (SELECT lote_id FROM sync_cola WHERE entidad_tipo = 'anulaciones_de_venta')
          ORDER BY orden_en_lote`,
      )
      .all() as { entidad_tipo: string; entidad_id: string; operacion: string }[];
    const asiento = base.prepare("SELECT id FROM auditoria_log WHERE accion = 'venta_anulada'").get() as { id: string };

    expect(filas.map((f) => [f.entidad_tipo, f.entidad_id, f.operacion])).toEqual([
      ['anulaciones_de_venta', idAnulacion, 'insertar'],
      ['productos', idMaiz, 'actualizar'],
      ['productos', idFrijol, 'actualizar'],
      ['auditoria_log', asiento.id, 'insertar'],
    ]);
    // Ni en este lote ni en ningún lote posterior a la venta aparece `ventas`.
    const ventasEncoladas = base.prepare("SELECT count(*) AS n FROM sync_cola WHERE entidad_tipo = 'ventas'").get() as { n: number };
    expect(ventasEncoladas.n).toBe(1);
  });

  it('el disparador rechaza EDITAR o BORRAR una anulación, y el error se traduce a ANULACION_INMUTABLE', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    pedir(ventaId, PIN_DE_JIMMY);

    const editar = (): unknown => base.prepare("UPDATE anulaciones_de_venta SET motivo = 'otro' WHERE venta_id = ?").run(ventaId);
    const borrar = (): unknown => base.prepare('DELETE FROM anulaciones_de_venta WHERE venta_id = ?').run(ventaId);

    expect(editar).toThrow('Una anulación de venta no se puede modificar.');
    expect(borrar).toThrow('Una anulación de venta no se puede borrar.');
    for (const operacion of [editar, borrar]) {
      try {
        operacion();
      } catch (error) {
        const traducido = traducirErrorDeBaseDeDatos(error);
        expect(traducido).toBeInstanceOf(ErrorDeNegocio);
        expect((traducido as ErrorDeNegocio).codigo).toBe('ANULACION_INMUTABLE');
      }
    }
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)?.motivo).toBe(MOTIVO);
  });
});

// ===========================================================================
describe('Un CONFLICTO del comparar-y-cambiar revierte TODO y deja su asiento (§2.5)', () => {
  it('si falla la reposición del SEGUNDO producto, el primero no queda repuesto, no hay anulación ni asiento de la venta, y queda conflicto_de_inventario', () => {
    const ventaId = vender([
      { productoId: idMaiz, cantidad: '2' },
      { productoId: idFrijol, cantidad: '1' },
    ]);
    const antes = {
      maiz: repos.productos.obtenerPorId(idMaiz),
      frijol: repos.productos.obtenerPorId(idFrijol),
    };

    /*
      Se fuerza el conflicto de verdad, como en las pruebas de la venta: la
      SEGUNDA llamada al comparar-y-cambiar de la reposición devuelve false, que
      es lo que pasaría si otro escritor hubiera movido el saldo entremedio. Con
      una sola conexión síncrona no puede pasar en la aplicación.
    */
    const original = repos.productos.reponerSiSigueIgual.bind(repos.productos);
    let llamadas = 0;
    repos.productos.reponerSiSigueIgual = (...argumentos): boolean => {
      llamadas += 1;
      return llamadas === 2 ? false : original(...argumentos);
    };
    try {
      const error = errorDe(() => pedir(ventaId, PIN_DE_JIMMY));
      expect(error.codigo).toBe('CONFLICTO_DE_INVENTARIO');
      expect(error.mensajeParaElUsuario).toBe(
        'El inventario de Frijol negro cambió mientras se anulaba. La venta no se anuló. Volvé a intentarlo.',
      );
    } finally {
      repos.productos.reponerSiSigueIgual = original;
    }

    // Todo revertido: el maíz, que SÍ se había repuesto dentro de la transacción, volvió.
    expect(repos.productos.obtenerPorId(idMaiz)).toEqual(antes.maiz);
    expect(repos.productos.obtenerPorId(idFrijol)).toEqual(antes.frijol);
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toBeNull();
    expect(asientos('venta_anulada')).toEqual([]);
    expect(base.prepare("SELECT count(*) AS n FROM sync_cola WHERE entidad_tipo = 'anulaciones_de_venta'").get()).toEqual({ n: 0 });

    // Y el asiento del conflicto, aparte, encolado para subir suelto.
    const conflicto = asientos('conflicto_de_inventario');
    expect(conflicto).toHaveLength(1);
    expect(conflicto[0]?.usuario_id).toBe(idAna);
    expect(conflicto[0]?.entidad_id).toBe(idFrijol);
    // LA FORMA ÚNICA (conflicto-de-inventario.ts), exacta: la misma que la venta.
    expect(JSON.parse(conflicto[0]?.valor_nuevo ?? '{}')).toEqual({
      operacion: 'anulacion',
      ventaId,
      productoId: idFrijol,
      nombre: 'Frijol negro',
      comparacion: 'inventario_disponible',
      saldoQueSeLeyo: '49.000',
      cantidadVendidaQueSeLeyo: '1.000',
      causaTecnica:
        `El comparar-y-cambiar de la reposición del producto ${idFrijol} afectó 0 filas: ` +
        'el saldo cambió desde que se leyó (49.000).',
    });
    const encolado = base
      .prepare("SELECT c.entidad_tipo FROM sync_cola c JOIN auditoria_log a ON a.id = c.entidad_id WHERE a.accion = 'conflicto_de_inventario'")
      .all();
    expect(encolado).toEqual([{ entidad_tipo: 'auditoria_log' }]);
  });

  it('si falla el de los CONTADORES, también se revierte la reposición ya hecha', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    const antes = repos.productos.obtenerPorId(idMaiz);
    const original = repos.productos.anularVentaDeProducto.bind(repos.productos);
    repos.productos.anularVentaDeProducto = (): boolean => false;
    try {
      expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY)).codigo).toBe('CONFLICTO_DE_INVENTARIO');
    } finally {
      repos.productos.anularVentaDeProducto = original;
    }
    expect(repos.productos.obtenerPorId(idMaiz)).toEqual(antes);
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toBeNull();
    expect(campos(asientos('conflicto_de_inventario')[0]?.valor_nuevo)).toEqual({
      operacion: 'anulacion',
      ventaId,
      productoId: idMaiz,
      nombre: 'Maíz blanco',
      comparacion: 'cantidad_vendida',
      saldoQueSeLeyo: '98.000',
      cantidadVendidaQueSeLeyo: '2.000',
      causaTecnica:
        `El comparar-y-cambiar de los contadores del producto ${idMaiz} afectó 0 filas: ` +
        'la cantidad vendida cambió desde que se leyó (2.000).',
    });
  });

  it('CERO reintentos: después del conflicto, volver a pedir con el PIN funciona, y el PIN hay que teclearlo otra vez', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    const original = repos.productos.reponerSiSigueIgual.bind(repos.productos);
    let llamadas = 0;
    repos.productos.reponerSiSigueIgual = (...argumentos): boolean => {
      llamadas += 1;
      return llamadas === 1 ? false : original(...argumentos);
    };
    try {
      expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY)).codigo).toBe('CONFLICTO_DE_INVENTARIO');
      // Una sola llamada: no reintentó sola.
      expect(llamadas).toBe(1);
      expect(pedir(ventaId, PIN_DE_JIMMY).anulada).toBe(true);
    } finally {
      repos.productos.reponerSiSigueIgual = original;
    }
  });

  it('contadores que quedarían NEGATIVOS se rechazan antes del PIN, sin corregir en silencio', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    base.prepare("UPDATE productos SET cantidad_vendida = '1.000' WHERE id = ?").run(idMaiz);
    const antes = fotoDeLaBase();

    const error = errorDe(() => pedir(ventaId, null));

    expect(error.codigo).toBe('CONTADORES_INCONSISTENTES');
    expect(fotoDeLaBase()).toEqual(antes);
  });
});

// ===========================================================================
describe('EL ASIENTO DEL CONFLICTO TIENE UNA SOLA FORMA: la venta y la anulación escriben lo mismo (2026-09-15)', () => {
  /** Las claves de la forma única, en el orden en que se escriben. */
  const CLAVES_DE_LA_FORMA_UNICA = [
    'operacion',
    'ventaId',
    'productoId',
    'nombre',
    'comparacion',
    'saldoQueSeLeyo',
    'cantidadVendidaQueSeLeyo',
    'causaTecnica',
  ];

  it('un conflicto al VENDER y uno al ANULAR dejan asientos con EXACTAMENTE las mismas claves, en la misma base', () => {
    // Una venta cuyo comparar-y-cambiar de inventario falla.
    const original = repos.productos.descontarSiSigueIgual.bind(repos.productos);
    repos.productos.descontarSiSigueIgual = (): boolean => false;
    try {
      expect(errorDe(() => vender([{ productoId: idMaiz, cantidad: '1' }])).codigo).toBe('CONFLICTO_DE_INVENTARIO');
    } finally {
      repos.productos.descontarSiSigueIgual = original;
    }

    // Una anulación cuyo comparar-y-cambiar de inventario falla.
    const ventaId = vender([{ productoId: idFrijol, cantidad: '1' }]);
    const reponer = repos.productos.reponerSiSigueIgual.bind(repos.productos);
    repos.productos.reponerSiSigueIgual = (): boolean => false;
    try {
      expect(errorDe(() => pedir(ventaId, PIN_DE_JIMMY)).codigo).toBe('CONFLICTO_DE_INVENTARIO');
    } finally {
      repos.productos.reponerSiSigueIgual = reponer;
    }

    const escritos = asientos('conflicto_de_inventario').map((asiento) => campos(asiento.valor_nuevo));
    expect(escritos.map((valor) => valor.operacion)).toEqual(['venta', 'anulacion']);
    for (const valor of escritos) {
      expect(Object.keys(valor)).toEqual(CLAVES_DE_LA_FORMA_UNICA);
    }
    expect(escritos[0]?.ventaId).toBeNull();
    expect(escritos[1]?.ventaId).toBe(ventaId);
    // Ninguna de las claves de la forma vieja de cada lado.
    for (const vieja of ['momento', 'detalle', 'saldoLeido', 'cantidadVendidaLeida']) {
      expect(escritos.some((valor) => vieja in valor), vieja).toBe(false);
    }
  });

  it('si el asiento NO se puede escribir al ANULAR, el cajero recibe IGUAL el conflicto y la falla queda en la bitácora técnica', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    const antes = repos.productos.obtenerPorId(idMaiz);
    // Una falla REAL de la base al insertar el asiento, la misma que usa la
    // prueba de la venta. Hasta el 2026-09-15 esta escritura no estaba
    // envuelta y el cajero recibía este error en lugar del conflicto.
    base.exec(`
      CREATE TRIGGER prueba_asiento_de_conflicto_falla
      BEFORE INSERT ON auditoria_log
      WHEN NEW.accion = 'conflicto_de_inventario'
      BEGIN
        SELECT RAISE(ABORT, 'sin espacio en disco (simulado por la prueba)');
      END;
    `);
    const original = repos.productos.reponerSiSigueIgual.bind(repos.productos);
    repos.productos.reponerSiSigueIgual = (): boolean => false;
    let error: ErrorDeNegocio;
    try {
      error = errorDe(() => pedir(ventaId, PIN_DE_JIMMY));
    } finally {
      repos.productos.reponerSiSigueIgual = original;
    }

    expect(error.codigo).toBe('CONFLICTO_DE_INVENTARIO');
    expect(error.mensajeParaElUsuario).toBe(
      'El inventario de Maíz blanco cambió mientras se anulaba. La venta no se anuló. Volvé a intentarlo.',
    );
    expect(asientos('conflicto_de_inventario')).toEqual([]);
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toBeNull();
    expect(repos.productos.obtenerPorId(idMaiz)).toEqual(antes);
    expect(hayTransaccionDeNegocioEnCurso()).toBe(false);

    expect(bitacoraTecnica.lineas).toHaveLength(1);
    const linea = bitacoraTecnica.lineas[0]!;
    expect(linea.startsWith('[anulacion] ')).toBe(true);
    expect(linea).toContain('conflicto_de_inventario');
    expect(linea).toContain(idMaiz);
    expect(linea).toContain(ventaId);
    expect(linea).toContain('sin espacio en disco (simulado por la prueba)');
  });
});

// ===========================================================================
describe('Autorización: superficie propia, sin PIN remoto, cada rechazo con su asiento', () => {
  it('el PIN REMOTO se rechaza en esta superficie y no anula nada', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);

    const resultado = pedir(ventaId, PIN_REMOTO_DE_JIMMY);

    expect(resultado.anulada).toBe(false);
    expect(resultado.codigo).toBe('PIN_INCORRECTO');
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toBeNull();
    expect(inventarioDe(idMaiz)).toBe('98.000');
  });

  it('el PIN de un usuario de VENTA no autoriza, aunque sea el de quien pide', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    expect(pedir(ventaId, PIN_DE_ANA).codigo).toBe('PIN_INCORRECTO');
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toBeNull();
  });

  it('CADA PIN equivocado deja su asiento anulacion_de_venta_rechazada, con quién pidió y el código, y nunca el PIN', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);

    pedir(ventaId, PIN_MALO);
    pedir(ventaId, '1111');

    const rechazos = asientos('anulacion_de_venta_rechazada');
    expect(rechazos).toHaveLength(2);
    for (const rechazo of rechazos) {
      expect(rechazo.usuario_id).toBe(idAna);
      expect(rechazo.entidad_tipo).toBe('ventas');
      expect(rechazo.entidad_id).toBe(ventaId);
      expect(JSON.parse(rechazo.valor_nuevo)).toEqual({ ventaId, codigo: 'PIN_INCORRECTO' });
      expect(rechazo.valor_nuevo).not.toContain(PIN_MALO);
      expect(rechazo.valor_nuevo).not.toContain('1111');
    }
    expect(repos.bloqueosDeAutorizacion.obtener('anulacion_de_venta').intentosFallidos).toBe(2);
    // Encolados, para subir sueltos por `sincronizar_asiento`.
    const encolados = base
      .prepare("SELECT count(*) AS n FROM sync_cola c JOIN auditoria_log a ON a.id = c.entidad_id WHERE a.accion = 'anulacion_de_venta_rechazada'")
      .get() as { n: number };
    expect(encolados.n).toBe(2);
  });

  it('el tercer PIN equivocado bloquea la superficie: deja su rechazo y el asiento autorizacion_bloqueada que ya existe', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    pedir(ventaId, PIN_MALO);
    pedir(ventaId, PIN_MALO);

    const tercero = pedir(ventaId, PIN_MALO);

    expect(tercero.codigo).toBe('AUTORIZACION_BLOQUEADA');
    expect(tercero.segundosParaReintentar).toBe(30);
    expect(asientos('anulacion_de_venta_rechazada').map((a) => campos(a.valor_nuevo).codigo)).toEqual([
      'PIN_INCORRECTO',
      'PIN_INCORRECTO',
      'AUTORIZACION_BLOQUEADA',
    ]);
    expect(campos(asientos('autorizacion_bloqueada')[0]?.valor_nuevo).superficie).toBe('anulacion_de_venta');
    // Bloqueada, ni el PIN correcto anula.
    expect(pedir(ventaId, PIN_DE_JIMMY).anulada).toBe(false);
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toBeNull();
  });

  it('un administrador con sesión TAMBIÉN teclea su PIN: el primer pedido pide autorización igual', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    const deJimmy = flujo.pedir(
      { ventaId, motivo: MOTIVO, voucher: null, pin: null },
      sesionDe(idJimmy, 'Jimmy', 'administrativo'),
    );
    expect(deJimmy.codigo).toBe('REQUIERE_AUTORIZACION');
    expect(repos.anulacionesDeVenta.obtenerPorVenta(ventaId)).toBeNull();
  });
});

// ===========================================================================
describe('El candado de anulacion_de_venta es INDEPENDIENTE, en los dos sentidos', () => {
  const OTRAS: readonly SuperficieDeAutorizacion[] = [
    'salida_controlada',
    'cierre_con_diferencia',
    'cierre_de_caja_ajena',
    'descuento_excedente',
    'saltar_lote_de_sincronizacion',
  ];

  function agotar(superficie: SuperficieDeAutorizacion): void {
    for (let intento = 0; intento < 3; intento += 1) {
      autenticacion.autorizarComoAdministrador(PIN_MALO, superficie);
    }
  }

  function bloqueada(superficie: SuperficieDeAutorizacion): boolean {
    return autenticacion.autorizarComoAdministrador(PIN_DE_JIMMY, superficie).codigo === 'AUTORIZACION_BLOQUEADA';
  }

  for (const otra of OTRAS) {
    it(`bloquear anulacion_de_venta NO bloquea ${otra}`, () => {
      agotar('anulacion_de_venta');
      expect(bloqueada('anulacion_de_venta')).toBe(true);
      expect(bloqueada(otra)).toBe(false);
    });

    it(`bloquear ${otra} NO bloquea anulacion_de_venta`, () => {
      agotar(otra);
      expect(bloqueada(otra)).toBe(true);
      expect(bloqueada('anulacion_de_venta')).toBe(false);
    });
  }

  it('bloquear anulacion_de_venta NO impide iniciar sesión, ni le toca el contador al usuario', () => {
    agotar('anulacion_de_venta');
    expect(bloqueada('anulacion_de_venta')).toBe(true);
    expect(autenticacion.autenticar(idJimmy, PIN_DE_JIMMY).autenticado).toBe(true);
    expect(repos.usuarios.obtenerPorId(idJimmy)?.intentosFallidos).toBe(0);
  });

  it('bloquear el INGRESO de un usuario NO bloquea anulacion_de_venta', () => {
    for (let intento = 0; intento < 3; intento += 1) {
      autenticacion.autenticar(idJimmy, PIN_MALO);
    }
    expect(autenticacion.autenticar(idJimmy, PIN_DE_JIMMY).codigo).toBe('USUARIO_BLOQUEADO');
    expect(bloqueada('anulacion_de_venta')).toBe(false);
  });

  it('la base acepta la superficie nueva (migración 034)', () => {
    autenticacion.autorizarComoAdministrador(PIN_MALO, 'anulacion_de_venta');
    expect(repos.bloqueosDeAutorizacion.obtener('anulacion_de_venta').intentosFallidos).toBe(1);
  });
});

// ===========================================================================
describe('Los asientos, con el contenido EXACTO de §6.2', () => {
  it('venta_anulada: valor_anterior es la venta; valor_nuevo, la anulación y lo que movió, clave por clave', () => {
    const ventaA = vender([{ productoId: idMaiz, cantidad: '5' }]);
    productos.ajustarInventario(idJimmy, { productoId: idMaiz, cantidad: '50', motivo: 'llegó un pedido' });
    vender([{ productoId: idMaiz, cantidad: '3' }]);
    repos.recibos.crear({ ventaId: ventaA, numeroRecibo: 128, pdfPath: 'recibos/recibo-000128.pdf' });
    const laVenta = repos.ventas.obtenerPorId(ventaA);

    const resultado = pedir(ventaA, PIN_DE_JIMMY);

    const [asiento] = asientos('venta_anulada');
    expect(asiento?.usuario_id).toBe(idAna);
    expect(asiento?.entidad_tipo).toBe('ventas');
    expect(asiento?.entidad_id).toBe(ventaA);
    expect(JSON.parse(asiento?.valor_anterior ?? '{}')).toStrictEqual({
      ventaId: ventaA,
      numeroRecibo: 128,
      fecha: laVenta?.fecha,
      vendidaPor: idAna,
      cajaSesionId: idCaja,
      cajaAbiertaPor: idAna,
      formaPago: 'efectivo',
      numBoleta: null,
      total: '21.25',
    });
    expect(JSON.parse(asiento?.valor_nuevo ?? '{}')).toStrictEqual({
      anulacionId: resultado.anulacion?.id,
      solicitadaPor: idAna,
      autorizadaPor: idJimmy,
      autorizadaVia: 'presencial',
      motivo: MOTIVO,
      fecha: new Date(reloj).toISOString(),
      efectivoQueDejaDeContar: '21.25',
      lineas: [
        {
          productoId: idMaiz,
          nombreSnap: 'Maíz blanco',
          unidadSnap: 'lb',
          cantidad: '5.000',
          productoActivo: true,
          saldoAnterior: '142.000',
          saldoNuevo: '147.000',
          cantidadVendidaAnterior: '8.000',
          cantidadVendidaNueva: '3.000',
        },
      ],
    });
  });

  it('con tarjeta, efectivoQueDejaDeContar es 0.00 y numBoleta es el voucher; numeroRecibo va null si la venta no tuvo recibo', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }], 'tarjeta', '004512');
    pedir(ventaId, PIN_DE_JIMMY, { voucher: '004512' });

    const [asiento] = asientos('venta_anulada');
    const anterior = JSON.parse(asiento?.valor_anterior ?? '{}') as Record<string, unknown>;
    const nuevo = JSON.parse(asiento?.valor_nuevo ?? '{}') as Record<string, unknown>;
    expect(anterior.numBoleta).toBe('004512');
    expect(anterior.numeroRecibo).toBeNull();
    expect(nuevo.efectivoQueDejaDeContar).toBe('0.00');
  });

  it('ningún asiento de la anulación lleva el PIN, ni en claro ni con hash', () => {
    const ventaId = vender([{ productoId: idMaiz, cantidad: '2' }]);
    pedir(ventaId, PIN_MALO);
    pedir(ventaId, PIN_DE_JIMMY);

    const texto = JSON.stringify(base.prepare('SELECT valor_anterior, valor_nuevo FROM auditoria_log').all());
    expect(texto).not.toContain(PIN_DE_JIMMY);
    expect(texto).not.toContain(PIN_MALO);
    expect(texto).not.toContain('scrypt$');
  });
});
