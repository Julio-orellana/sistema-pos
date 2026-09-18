/**
 * La transacción de venta: lo que Jimmy cobra de verdad.
 *
 * Es el módulo donde se juntan todas las reglas del proyecto —redondeo único,
 * reparto de centavos, inventario atómico, tope de descuento por rol, corte de
 * caja— así que estas pruebas son la lista de verificación de que ninguna se
 * quedó a medias. Corren contra bases SQLite reales, migradas desde cero.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { cantidadACadena, montoACadena, sumarLista } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { hayTransaccionDeNegocioEnCurso } from '@main/database/transaccion-en-curso';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ejecutarConRespuesta } from '@main/ipc/respuesta';
import type { LogTecnico, OrigenTecnico } from '@main/log-tecnico';
import { ServicioDeVenta, type DatosDeLaVenta } from '../servicio-de-venta';
import { CifradoDePrueba, codigoDeLaApp, SECRETO_DE_PRUEBA, sembrarAutorizacionRemota } from '@main/domain/usuarios/__tests__/ayuda-totp';

const PIN_DE_JIMMY = '2468';
/** El cifrado del sistema, de prueba: el mismo para sembrar el secreto y para verificarlo. */
const cifrado = new CifradoDePrueba();
/** El código que muestra ahora la app de autenticación de Jimmy. */
const codigoRemotoDeJimmy = (): string => codigoDeLaApp(SECRETO_DE_PRUEBA, Date.now());

/** Bitácora técnica que guarda lo que se le escribe, para poder leerlo. */
class BitacoraQueGuarda implements LogTecnico {
  public readonly lineas: string[] = [];

  public registrar(origen: OrigenTecnico, mensaje: string): void {
    this.lineas.push(`[${origen}] ${mensaje}`);
  }
}

let base: Database;
let repos: Repositorios;
let venta: ServicioDeVenta;
let caja: ServicioDeCaja;
let autenticacion: ServicioDeAutenticacion;
let bitacoraTecnica: BitacoraQueGuarda;
let limpiar: () => void;

let idJimmy: string;
let idCajera: string;
let idCategoria: string;

/** Momento fijo del reloj del servicio, para que la vigencia sea reproducible. */
let momentoDePrueba = new Date('2026-09-10T15:00:00.000Z').getTime();

/**
 * El comienzo de un día, tantos días desde `momentoDePrueba`.
 *
 * Las columnas de vigencia guardan un INSTANTE ISO completo —lo exige su CHECK
 * en la migración 001—, pero la vigencia se compara POR DÍA. Estas pruebas
 * ponen las promociones a las 00:00 del día que interesa, que es el caso que
 * hace visible la diferencia: una promoción que vence «hoy» sigue valiendo a
 * las tres de la tarde.
 */
function diasDesdeHoy(dias: number): string {
  const MILISEGUNDOS_POR_DIA = 86_400_000;
  const dia = new Date(momentoDePrueba + dias * MILISEGUNDOS_POR_DIA);
  dia.setUTCHours(0, 0, 0, 0);
  return dia.toISOString();
}

/** El comienzo del día de `momentoDePrueba`. */
function hoy(): string {
  return diasDesdeHoy(0);
}

/** Crea un producto por peso con el precio y el inventario indicados. */
function producto(nombre: string, precio: string, inventario: string): string {
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

/** Abre el turno de la cajera con Q500 de fondo. */
function abrirCaja(): string {
  return caja.abrir(idCajera, { modo: 'simple', monto: '500' }).id;
}

/** Una venta en efectivo, sin descuento. */
function enEfectivo(lineas: DatosDeLaVenta['lineas']): DatosDeLaVenta {
  return { lineas, descuento: null, formaPago: 'efectivo', numBoleta: null };
}

/** El saldo de inventario de un producto, como cadena canónica. */
function inventarioDe(productoId: string): string {
  return cantidadACadena(repos.productos.obtenerPorId(productoId)?.inventarioDisponible ?? '0');
}

beforeEach(() => {
  momentoDePrueba = new Date('2026-09-10T15:00:00.000Z').getTime();

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
  autenticacion = new ServicioDeAutenticacion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
    cifrado,
  });
  bitacoraTecnica = new BitacoraQueGuarda();
  venta = new ServicioDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    preciosEspeciales: repos.preciosEspeciales,
    limitesDescuento: repos.limitesDescuento,
    cajaSesiones: repos.cajaSesiones,
    auditoria: repos.auditoria,
    log: bitacoraTecnica,
    ahora: (): number => momentoDePrueba,
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin(PIN_DE_JIMMY),
  }).id;
  sembrarAutorizacionRemota(repos.usuarios, cifrado, idJimmy);

  idCajera = repos.usuarios.crear({
    nombre: 'Ana',
    rol: 'venta',
    pinHash: generarHashDePin('1357'),
  }).id;

  idCategoria = repos.categorias.crear({ nombre: 'Granos' }).id;
});

afterEach(() => {
  limpiar();
});

// ===========================================================================
describe('Antes de tocar nada: la caja tiene que seguir abierta', () => {
  it('sin caja abierta no se registra la venta ni se descuenta inventario', () => {
    const maiz = producto('Maíz', '0.67', '20');

    expect(() => venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '5' }])))
      .toThrow(/No hay ninguna caja abierta/);

    expect(inventarioDe(maiz)).toBe('20.000');
    expect(repos.ventas.listarPendientesDeSincronizar(10)).toHaveLength(0);
  });

  it('con la caja de OTRA persona tampoco se vende', () => {
    const maiz = producto('Maíz', '0.67', '20');
    caja.abrir(idJimmy, { modo: 'simple', monto: '500' });

    expect(() => venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '5' }])))
      .toThrow(/de otra persona/);
    expect(inventarioDe(maiz)).toBe('20.000');
  });

  it('la caja se reverifica DENTRO de la transacción: cerrarla a mitad de turno frena la venta', () => {
    const maiz = producto('Maíz', '0.67', '20');
    const sesionId = abrirCaja();
    caja.intentarCerrar(sesionId, { modo: 'simple', monto: '500' }, { usuarioQueCierra: idCajera });

    expect(() => venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '5' }])))
      .toThrow(/No hay ninguna caja abierta/);
    expect(inventarioDe(maiz)).toBe('20.000');
  });
});

// ===========================================================================
describe('Precio especial: se aplica solo mientras está vigente', () => {
  it('SIN precio especial se cobra el precio de lista', () => {
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    expect(resultado.total).toBe('20.00');
    expect(resultado.lineasConPrecioEspecial).toBe(0);
    const linea = repos.ventaDetalle.listarPorVenta(resultado.venta.id)[0];
    expect(montoACadena(linea?.precioUnitarioSnap ?? '0')).toBe('10.00');
  });

  it('un precio especial VIGENTE rebaja el precio y queda en precio_unitario_snap', () => {
    const maiz = producto('Maíz', '10.00', '20');
    repos.preciosEspeciales.crear({
      productoId: maiz,
      tipo: 'porcentaje',
      valor: '10',
      vigenteDesde: diasDesdeHoy(-5),
      vigenteHasta: diasDesdeHoy(5),
    });
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    // 10.00 menos 10 % son 9.00; dos libras, Q18.00.
    expect(resultado.total).toBe('18.00');
    expect(resultado.lineasConPrecioEspecial).toBe(1);
    const linea = repos.ventaDetalle.listarPorVenta(resultado.venta.id)[0];
    expect(montoACadena(linea?.precioUnitarioSnap ?? '0')).toBe('9.00');
  });

  it('EL BORDE: vigente_hasta = HOY todavía se aplica', () => {
    const maiz = producto('Maíz', '10.00', '20');
    repos.preciosEspeciales.crear({
      productoId: maiz,
      tipo: 'porcentaje',
      valor: '10',
      vigenteDesde: diasDesdeHoy(-5),
      // Vence hoy. El último día de una promoción es un día de promoción: si
      // se aplicara el precio de lista, el cliente pagaría de más justo el día
      // que el cartel del mostrador todavía dice que está rebajado.
      vigenteHasta: hoy(),
    });
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }]));
    expect(resultado.total).toBe('18.00');
  });

  it('EL BORDE: vigente_hasta = AYER ya no se aplica', () => {
    const maiz = producto('Maíz', '10.00', '20');
    repos.preciosEspeciales.crear({
      productoId: maiz,
      tipo: 'porcentaje',
      valor: '10',
      vigenteDesde: diasDesdeHoy(-5),
      vigenteHasta: diasDesdeHoy(-1),
    });
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }]));
    expect(resultado.total).toBe('20.00');
    expect(resultado.lineasConPrecioEspecial).toBe(0);
  });

  it('EL BORDE: vigente_desde = MAÑANA todavía no se aplica', () => {
    const maiz = producto('Maíz', '10.00', '20');
    repos.preciosEspeciales.crear({
      productoId: maiz,
      tipo: 'porcentaje',
      valor: '10',
      vigenteDesde: diasDesdeHoy(1),
      vigenteHasta: null,
    });
    abrirCaja();

    expect(venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }])).total)
      .toBe('20.00');
  });

  it('un precio especial DESACTIVADO no se aplica aunque esté en fecha', () => {
    const maiz = producto('Maíz', '10.00', '20');
    const especial = repos.preciosEspeciales.crear({
      productoId: maiz,
      tipo: 'porcentaje',
      valor: '10',
      vigenteDesde: diasDesdeHoy(-5),
      vigenteHasta: diasDesdeHoy(5),
    });
    repos.preciosEspeciales.desactivar(especial.id);
    abrirCaja();

    expect(venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }])).total)
      .toBe('20.00');
  });
});

// ===========================================================================
describe('Descuento discrecional: el tope del rol decide si hace falta PIN', () => {
  /** Le da al rol de venta un tope de 10 % y Q20. */
  function fijarTopes(): void {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '20',
      editadoPor: idJimmy,
    });
  }

  it('un descuento DENTRO del límite no pide PIN y no guarda autorizante', () => {
    fijarTopes();
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: { tipo: 'porcentaje', valor: '10' },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(resultado.total).toBe('90.00');
    expect(resultado.descuentoAplicado).toBe('10.00');
    expect(resultado.venta.descuentoAutorizadoPor).toBeNull();
  });

  it('un descuento que EXCEDE el límite se rechaza si no viene autorizado', () => {
    fijarTopes();
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: maiz, cantidad: '10' }],
        descuento: { tipo: 'porcentaje', valor: '25' },
        formaPago: 'efectivo',
        numBoleta: null,
      }),
    ).toThrow(/pasa el límite de tu rol/);

    // Y no dejó nada: ni la venta ni el inventario descontado.
    expect(inventarioDe(maiz)).toBe('20.000');
    expect(repos.ventas.listarPendientesDeSincronizar(10)).toHaveLength(0);
  });

  it('el PIN NORMAL de un administrador autoriza el exceso', () => {
    fijarTopes();
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    const permiso = autenticacion.autorizarComoAdministrador(PIN_DE_JIMMY, 'descuento_excedente');
    expect(permiso.autenticado).toBe(true);
    expect(permiso.viaDeAutorizacion).toBe('presencial');

    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: {
        tipo: 'porcentaje',
        valor: '25',
        autorizacion: {
          autorizadoPor: permiso.usuario?.id ?? '',
          via: permiso.viaDeAutorizacion ?? 'presencial',
        },
      },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(resultado.total).toBe('75.00');
    expect(resultado.venta.descuentoAutorizadoPor).toBe(idJimmy);
    expect(resultado.venta.descuentoAutorizadoVia).toBe('presencial');
  });

  it('EL PIN REMOTO AHORA SÍ autoriza un descuento, y queda como «remoto»', () => {
    /*
      CAMBIO DE COMPORTAMIENTO DELIBERADO, del 2026-09-11. Esta prueba antes
      afirmaba lo contrario: que el PIN remoto NO autorizaba un descuento.
      Aquella era la decisión correcta en su momento —alcance mínimo por
      omisión— y el propio código decía que ampliarla exigía una decisión
      explícita. Julio la tomó: Jimmy no siempre está en la tienda y un cliente
      no puede esperar en el mostrador a que vuelva.

      Se conserva el rastro del cambio acá a propósito, para que nadie lo lea
      como que la regla de alcance mínimo se aflojó: sigue vigente, y
      `salida_controlada` y `cierre_de_caja_ajena` lo comprueban abajo.
    */
    fijarTopes();

    const intento = autenticacion.autorizarComoAdministrador(
      codigoRemotoDeJimmy(),
      'descuento_excedente',
    );

    expect(intento.autenticado).toBe(true);
    expect(intento.usuario?.id).toBe(idJimmy);
    expect(intento.viaDeAutorizacion).toBe('remoto');
  });

  it('y las superficies que no se ampliaron SIGUEN sin aceptarlo: la ampliación fue acotada', () => {
    fijarTopes();

    // `salida_controlada` salió de esta lista el 2026-09-15 por una SEGUNDA
    // decisión explícita (CLAUDE.md §4.41), no por heredar la del descuento.
    for (const superficie of ['cierre_de_caja_ajena', 'saltar_lote_de_sincronizacion'] as const) {
      const intento = autenticacion.autorizarComoAdministrador(codigoRemotoDeJimmy(), superficie);
      expect(intento.autenticado, `${superficie} no debe aceptar el PIN remoto`).toBe(false);
      expect(intento.usuario).toBeNull();
    }
  });

  it('la venta autorizada con el PIN REMOTO guarda la vía «remoto»', () => {
    fijarTopes();
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    const permiso = autenticacion.autorizarComoAdministrador(
      codigoRemotoDeJimmy(),
      'descuento_excedente',
    );
    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: {
        tipo: 'porcentaje',
        valor: '25',
        autorizacion: {
          autorizadoPor: permiso.usuario?.id ?? '',
          via: permiso.viaDeAutorizacion ?? 'presencial',
        },
      },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(resultado.venta.descuentoAutorizadoPor).toBe(idJimmy);
    expect(resultado.venta.descuentoAutorizadoVia).toBe('remoto');
  });

  it('sin límite configurado para el rol, el tope es CERO: cualquier descuento pide PIN', () => {
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: maiz, cantidad: '10' }],
        descuento: { tipo: 'porcentaje', valor: '1' },
        formaPago: 'efectivo',
        numBoleta: null,
      }),
    ).toThrow(/pasa el límite de tu rol/);
  });

  it('el porcentaje se mide contra el tope de PORCENTAJE y el monto contra el de MONTO', () => {
    fijarTopes();
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();

    // Q15 está dentro del tope de Q20 aunque sea el 15 % de una venta de Q100.
    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: { tipo: 'monto_fijo', valor: '15' },
      formaPago: 'efectivo',
      numBoleta: null,
    });
    expect(resultado.total).toBe('85.00');
  });

  it('una autorización que NO hacía falta no se guarda', () => {
    fijarTopes();
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      // 5 % cabe en el tope de 10 %: el autorizante sobra y no debe quedar.
      descuento: { tipo: 'porcentaje', valor: '5', autorizacion: { autorizadoPor: idJimmy, via: 'presencial' } },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(resultado.venta.descuentoAutorizadoPor).toBeNull();
  });

  it('un descuento de cero o negativo se rechaza', () => {
    fijarTopes();
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: maiz, cantidad: '1' }],
        descuento: { tipo: 'monto_fijo', valor: '0' },
        formaPago: 'efectivo',
        numBoleta: null,
      }),
    ).toThrow(/no cambia nada/);

    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: maiz, cantidad: '1' }],
        descuento: { tipo: 'monto_fijo', valor: '-5' },
        formaPago: 'efectivo',
        numBoleta: null,
      }),
    ).toThrow(/no puede ser negativo/);
  });
});

// ===========================================================================
/**
 * La prueba de falsificación del prompt: un fallo a mitad de camino tiene que
 * revertir TODO. Si esta pasa por casualidad, todo lo demás vale poco.
 */
describe('TODO O NADA: un fallo a mitad de la venta no deja ni una línea descontada', () => {
  it('la última línea sin stock revierte también las dos primeras', () => {
    const maiz = producto('Maíz', '10.00', '50');
    const frijol = producto('Frijol', '6.00', '50');
    const azucar = producto('Azúcar', '4.00', '2');
    abrirCaja();

    expect(() =>
      venta.registrar(
        idCajera,
        'venta',
        enEfectivo([
          { productoId: maiz, cantidad: '10' },
          { productoId: frijol, cantidad: '10' },
          // No alcanza: hay 2 y se piden 10.
          { productoId: azucar, cantidad: '10' },
        ]),
      ),
    ).toThrow(/No hay suficiente Azúcar/);

    expect(inventarioDe(maiz)).toBe('50.000');
    expect(inventarioDe(frijol)).toBe('50.000');
    expect(inventarioDe(azucar)).toBe('2.000');
    expect(repos.ventas.listarPendientesDeSincronizar(10)).toHaveLength(0);
  });

  it('un CONFLICTO_DE_INVENTARIO en la última línea revierte las anteriores', () => {
    const maiz = producto('Maíz', '10.00', '50');
    const frijol = producto('Frijol', '6.00', '50');
    const azucar = producto('Azúcar', '4.00', '50');
    abrirCaja();

    /*
      Se fuerza el conflicto de verdad: se envuelve el comparar-y-cambiar para
      que la TERCERA llamada devuelva false, que es exactamente lo que pasaría
      si otro escritor hubiera movido el saldo entremedio. No se simula el
      error lanzándolo: se hace fallar la escritura, como en la realidad.
    */
    const original = repos.productos.descontarSiSigueIgual.bind(repos.productos);
    let llamadas = 0;
    repos.productos.descontarSiSigueIgual = (id, leido, nuevo): boolean => {
      llamadas += 1;
      const TERCERA = 3;
      return llamadas === TERCERA ? false : original(id, leido, nuevo);
    };

    try {
      expect(() =>
        venta.registrar(
          idCajera,
          'venta',
          enEfectivo([
            { productoId: maiz, cantidad: '10' },
            { productoId: frijol, cantidad: '10' },
            { productoId: azucar, cantidad: '10' },
          ]),
        ),
      ).toThrow(ErrorDeNegocio);
    } finally {
      repos.productos.descontarSiSigueIgual = original;
    }

    // NINGUNA línea quedó descontada, ni siquiera las dos que sí se escribieron.
    expect(inventarioDe(maiz)).toBe('50.000');
    expect(inventarioDe(frijol)).toBe('50.000');
    expect(inventarioDe(azucar)).toBe('50.000');
    expect(repos.ventas.listarPendientesDeSincronizar(10)).toHaveLength(0);
    expect(repos.auditoria.listarPorRango('1900-01-01', '2999-01-01')
      .filter((asiento) => asiento.accion === 'venta_registrada')).toHaveLength(0);
  });

  it('el mensaje del conflicto NOMBRA el producto que falló', () => {
    const maiz = producto('Maíz', '10.00', '50');
    const frijol = producto('Frijol quebrado', '6.00', '50');
    abrirCaja();

    const original = repos.productos.descontarSiSigueIgual.bind(repos.productos);
    repos.productos.descontarSiSigueIgual = (id, leido, nuevo): boolean =>
      id === frijol ? false : original(id, leido, nuevo);

    try {
      venta.registrar(
        idCajera,
        'venta',
        enEfectivo([
          { productoId: maiz, cantidad: '1' },
          { productoId: frijol, cantidad: '1' },
        ]),
      );
      throw new Error('Se esperaba un conflicto de inventario.');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      const negocio = error as ErrorDeNegocio;
      expect(negocio.codigo).toBe('CONFLICTO_DE_INVENTARIO');
      expect(negocio.mensajeParaElUsuario).toContain('Frijol quebrado');
    } finally {
      repos.productos.descontarSiSigueIgual = original;
    }
  });

  it('un producto desactivado a mitad del ticket frena la venta entera', () => {
    const maiz = producto('Maíz', '10.00', '50');
    const frijol = producto('Frijol', '6.00', '50');
    repos.productos.fijarActivo(frijol, false);
    abrirCaja();

    expect(() =>
      venta.registrar(
        idCajera,
        'venta',
        enEfectivo([
          { productoId: maiz, cantidad: '10' },
          { productoId: frijol, cantidad: '10' },
        ]),
      ),
    ).toThrow(/se desactivó/);

    expect(inventarioDe(maiz)).toBe('50.000');
  });
});

// ===========================================================================
/**
 * EL CONFLICTO DE INVENTARIO DEJA CONSTANCIA (CLAUDE.md §4.3).
 *
 * La tabla de §4.3 decía «¿Queda registrado? Sí, un asiento de auditoría», y
 * hasta el 2026-09-15 NO era cierto: el servicio lanzaba el error dentro de la
 * transacción, la transacción se revertía y nadie escribía nada después. Estas
 * pruebas fijan las cuatro cosas que tienen que pasar juntas: la venta no
 * queda, el cajero ve lo mismo de siempre, el asiento sí queda, y se encola
 * solo, en su propio lote.
 *
 * EL CONFLICTO SE PROVOCA CON EL UPDATE REAL, no con un `return false`: justo
 * antes del comparar-y-cambiar se mueve el saldo del producto, y la sentencia
 * de verdad corre con el saldo que se había leído y afecta cero filas. Esa
 * escritura «ajena» usa la MISMA conexión, así que se revierte con la venta;
 * un escritor en otra conexión no daría cero filas sino `SQLITE_BUSY_SNAPSHOT`
 * (medido, ver §4.3), que es otro camino y no lo cubre este asiento.
 */
describe('EL CONFLICTO DE INVENTARIO DEJA CONSTANCIA, después de revertir (§4.3)', () => {
  const MOMENTO = '2026-09-10T15:00:00.000Z';
  const MENSAJE_AL_CAJERO = (nombre: string): string =>
    `El inventario de ${nombre} cambió mientras se cobraba. ` +
    'No se registró la venta. Revisá la cantidad y volvé a cobrar.';

  /** Una fila de `sync_cola`, con lo que estas pruebas miran. */
  interface FilaDeCola {
    readonly id: string;
    readonly entidad_tipo: string;
    readonly entidad_id: string;
    readonly operacion: string;
    readonly lote_id: string;
    readonly orden_en_lote: number;
    readonly payload: string;
    readonly sincronizado_en: string | null;
    readonly bloqueante: number;
  }

  function filasDeLaCola(): FilaDeCola[] {
    return base
      .prepare(
        `SELECT id, entidad_tipo, entidad_id, operacion, lote_id, orden_en_lote,
                payload, sincronizado_en, bloqueante
           FROM sync_cola ORDER BY rowid`,
      )
      .all() as FilaDeCola[];
  }

  /** Las filas de la cola que no estaban en `antes`. */
  function filasNuevasDeLaCola(antes: readonly FilaDeCola[]): FilaDeCola[] {
    const vistas = new Set(antes.map((fila) => fila.id));
    return filasDeLaCola().filter((fila) => !vistas.has(fila.id));
  }

  function asientosDeConflicto(): ReturnType<Repositorios['auditoria']['listarPorRango']> {
    return repos.auditoria
      .listarPorRango('1900-01-01', '2999-01-01')
      .filter((asiento) => asiento.accion === 'conflicto_de_inventario');
  }

  function filasDe(tabla: 'ventas' | 'venta_detalle'): number {
    return (base.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n;
  }

  /** Otro escritor mueve el saldo JUSTO antes del comparar-y-cambiar de inventario. */
  function moverElSaldoAntesDeDescontar(productoId: string, saldoAjeno: string): void {
    // `repos` se crea de nuevo en cada prueba, así que no hace falta restaurar.
    const original = repos.productos.descontarSiSigueIgual.bind(repos.productos);
    repos.productos.descontarSiSigueIgual = (id, leido, nuevo): boolean => {
      if (id === productoId) {
        base.prepare('UPDATE productos SET inventario_disponible = ? WHERE id = ?').run(saldoAjeno, id);
      }
      return original(id, leido, nuevo);
    };
  }

  /** Otro escritor mueve la cantidad vendida JUSTO antes de su comparar-y-cambiar (paso 6). */
  function moverLaCantidadVendidaAntesDeAnotar(productoId: string, cantidadAjena: string): void {
    const original = repos.productos.registrarVentaDeProducto.bind(repos.productos);
    repos.productos.registrarVentaDeProducto = (id, leida, nueva): boolean => {
      if (id === productoId) {
        base.prepare('UPDATE productos SET cantidad_vendida = ? WHERE id = ?').run(cantidadAjena, id);
      }
      return original(id, leida, nueva);
    };
  }

  /** Cobra y devuelve el error que lanzó. Falla si la venta se registró. */
  function cobrarEsperandoError(datos: DatosDeLaVenta): ErrorDeNegocio {
    try {
      venta.registrar(idCajera, 'venta', datos);
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      return error as ErrorDeNegocio;
    }
    throw new Error('Se esperaba que la venta fallara.');
  }

  it('si otro escritor movió el saldo, la venta NO queda escrita: ni cabecera, ni detalle, ni inventario, ni contadores', () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    moverElSaldoAntesDeDescontar(maiz, '47.000');

    cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    expect(filasDe('ventas')).toBe(0);
    expect(filasDe('venta_detalle')).toBe(0);
    // El saldo vuelve a 50: se revirtió también la escritura «ajena», que usó la
    // misma conexión. Lo que importa es que la venta no descontó nada.
    expect(inventarioDe(maiz)).toBe('50.000');
    const despues = repos.productos.obtenerPorId(maiz);
    expect(cantidadACadena(despues?.cantidadVendida ?? '')).toBe('0.000');
    expect(despues?.contadorVentas).toBe(0);
    expect(
      repos.auditoria
        .listarPorRango('1900-01-01', '2999-01-01')
        .filter((asiento) => asiento.accion === 'venta_registrada'),
    ).toHaveLength(0);
  });

  it('el cajero recibe EXACTAMENTE el error de siempre: mismo código, mismo mensaje y misma causa técnica', () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    moverElSaldoAntesDeDescontar(maiz, '47.000');

    const error = cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    // Textos LITERALES, copiados de lo que el servicio decía antes de este
    // cambio: recalcularlos con la misma función no probaría que no cambiaron.
    expect(error.codigo).toBe('CONFLICTO_DE_INVENTARIO');
    expect(error.mensajeParaElUsuario).toBe(MENSAJE_AL_CAJERO('Maíz blanco'));
    expect(error.causaTecnica).toBe(
      `El comparar-y-cambiar de inventario del producto ${maiz} afectó 0 filas: ` +
        'el saldo cambió desde que se leyó (50.000).',
    );
  });

  it('la VENTANA recibe el mismo sobre de siempre por el envoltorio de IPC', async () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    moverElSaldoAntesDeDescontar(maiz, '47.000');

    const respuesta = await ejecutarConRespuesta('COBRO_FALLIDO', () =>
      venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }])),
    );

    expect(respuesta).toEqual({
      ok: false,
      error: {
        codigo: 'CONFLICTO_DE_INVENTARIO',
        mensaje: MENSAJE_AL_CAJERO('Maíz blanco'),
        detalle:
          `El comparar-y-cambiar de inventario del producto ${maiz} afectó 0 filas: ` +
          'el saldo cambió desde que se leyó (50.000).',
      },
    });
  });

  it('queda UN asiento conflicto_de_inventario, a nombre de quien vendía, con el producto y lo que se leyó', () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    moverElSaldoAntesDeDescontar(maiz, '47.000');

    cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    const asientos = asientosDeConflicto();
    expect(asientos).toHaveLength(1);
    const asiento = asientos[0]!;
    expect(asiento.usuarioId).toBe(idCajera);
    // `productos` y no `ventas`: la venta nunca existió, así que no hay un id
    // de venta que nombrar sin apuntar a la nada.
    expect(asiento.entidadTipo).toBe('productos');
    expect(asiento.entidadId).toBe(maiz);
    expect(asiento.valorAnterior).toBeNull();
    expect(asiento.fecha).toBe(MOMENTO);
    // LA FORMA ÚNICA (conflicto-de-inventario.ts): exacta, sin claves de más.
    // Sin `momento` desde el 2026-09-15: el instante es la columna `fecha`.
    expect(JSON.parse(asiento.valorNuevo ?? 'null')).toEqual({
      operacion: 'venta',
      ventaId: null,
      productoId: maiz,
      nombre: 'Maíz blanco',
      comparacion: 'inventario_disponible',
      saldoQueSeLeyo: '50.000',
      cantidadVendidaQueSeLeyo: '0.000',
      causaTecnica:
        `El comparar-y-cambiar de inventario del producto ${maiz} afectó 0 filas: ` +
        'el saldo cambió desde que se leyó (50.000).',
    });
  });

  it('el asiento queda encolado en sync_cola SOLO, en su propio lote, y de la venta no se encola nada', () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    const antes = filasDeLaCola();
    moverElSaldoAntesDeDescontar(maiz, '47.000');

    cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    const nuevas = filasNuevasDeLaCola(antes);
    const asiento = asientosDeConflicto()[0];
    expect(nuevas).toHaveLength(1);
    const fila = nuevas[0]!;
    expect(fila.entidad_tipo).toBe('auditoria_log');
    expect(fila.entidad_id).toBe(asiento?.id);
    expect(fila.operacion).toBe('insertar');
    expect(fila.orden_en_lote).toBe(0);
    expect(fila.sincronizado_en).toBeNull();
    expect(fila.bloqueante).toBe(0);
    // SU PROPIO lote: ninguna otra fila de la cola comparte el `lote_id`. Un
    // lote de puros asientos es el que el enrutador manda a `sincronizar_asiento`.
    expect(filasDeLaCola().filter((otra) => otra.lote_id === fila.lote_id)).toHaveLength(1);
    // El payload es la fila tal como quedó en la base (§4.17).
    const payload = JSON.parse(fila.payload) as { id: string; accion: string; usuario_id: string };
    expect(payload.id).toBe(asiento?.id);
    expect(payload.accion).toBe('conflicto_de_inventario');
    expect(payload.usuario_id).toBe(idCajera);
  });

  it('el asiento se escribe cuando la venta YA se revirtió: en ese instante no hay cabecera, ni detalle, ni inventario descontado', () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    // Paso 6: para cuando falla, la transacción YA escribió la cabecera, el
    // detalle y el inventario. Si el asiento se escribiera antes de revertir,
    // vería esas filas; y además se revertiría con ellas.
    moverLaCantidadVendidaAntesDeAnotar(maiz, '1.000');
    const registrar = repos.auditoria.registrar.bind(repos.auditoria);
    const vistoAlEscribir: { ventas: number; detalle: number; saldo: string }[] = [];
    repos.auditoria.registrar = (datos): ReturnType<typeof registrar> => {
      if (datos.accion === 'conflicto_de_inventario') {
        vistoAlEscribir.push({
          ventas: filasDe('ventas'),
          detalle: filasDe('venta_detalle'),
          saldo: inventarioDe(maiz),
        });
      }
      return registrar(datos);
    };

    cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    expect(vistoAlEscribir).toEqual([{ ventas: 0, detalle: 0, saldo: '50.000' }]);
    expect(asientosDeConflicto()).toHaveLength(1);
  });

  it('si falla el comparar-y-cambiar de la CANTIDAD VENDIDA (paso 6), pasa lo mismo, y el asiento dice qué comparación falló', () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    const antes = filasDeLaCola();
    moverLaCantidadVendidaAntesDeAnotar(maiz, '1.000');

    const error = cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    expect(error.codigo).toBe('CONFLICTO_DE_INVENTARIO');
    expect(error.mensajeParaElUsuario).toBe(MENSAJE_AL_CAJERO('Maíz blanco'));
    expect(error.causaTecnica).toBe(
      `El comparar-y-cambiar de la cantidad vendida del producto ${maiz} afectó 0 filas: ` +
        'el acumulado cambió desde que se leyó (0.000).',
    );
    // La venta no quedó, aunque en este paso ya se habían escrito sus filas.
    expect(filasDe('ventas')).toBe(0);
    expect(filasDe('venta_detalle')).toBe(0);
    expect(inventarioDe(maiz)).toBe('50.000');

    const asientos = asientosDeConflicto();
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.usuarioId).toBe(idCajera);
    expect(JSON.parse(asientos[0]?.valorNuevo ?? 'null')).toEqual({
      operacion: 'venta',
      ventaId: null,
      productoId: maiz,
      nombre: 'Maíz blanco',
      comparacion: 'cantidad_vendida',
      saldoQueSeLeyo: '50.000',
      cantidadVendidaQueSeLeyo: '0.000',
      causaTecnica:
        `El comparar-y-cambiar de la cantidad vendida del producto ${maiz} afectó 0 filas: ` +
        'el acumulado cambió desde que se leyó (0.000).',
    });
    const nuevas = filasNuevasDeLaCola(antes);
    expect(nuevas.map((fila) => [fila.entidad_tipo, fila.entidad_id])).toEqual([
      ['auditoria_log', asientos[0]?.id],
    ]);
  });

  it('en un ticket de tres líneas, el asiento nombra la línea que falló y las otras dos quedan como estaban', () => {
    const maiz = producto('Maíz', '10.00', '50');
    const frijol = producto('Frijol', '6.00', '50');
    const azucar = producto('Azúcar', '4.00', '50');
    abrirCaja();
    moverElSaldoAntesDeDescontar(azucar, '40.000');

    const error = cobrarEsperandoError(
      enEfectivo([
        { productoId: maiz, cantidad: '10' },
        { productoId: frijol, cantidad: '10' },
        { productoId: azucar, cantidad: '10' },
      ]),
    );

    expect(error.mensajeParaElUsuario).toBe(MENSAJE_AL_CAJERO('Azúcar'));
    expect(inventarioDe(maiz)).toBe('50.000');
    expect(inventarioDe(frijol)).toBe('50.000');
    expect(inventarioDe(azucar)).toBe('50.000');
    const asientos = asientosDeConflicto();
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.entidadId).toBe(azucar);
    expect((JSON.parse(asientos[0]?.valorNuevo ?? '{}') as { nombre: string }).nombre).toBe('Azúcar');
  });

  it('lo que NO es un conflicto no deja asiento de conflicto: sin caja, stock insuficiente, producto desactivado, descuento sin PIN', () => {
    const maiz = producto('Maíz', '10.00', '50');
    const poco = producto('Azúcar', '4.00', '2');
    const inactivo = producto('Frijol', '6.00', '50');
    repos.productos.fijarActivo(inactivo, false);

    // Sin caja abierta, antes de abrirla.
    const antesDeAbrir = filasDeLaCola();
    expect(cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '1' }])).codigo).toBe('DATO_INVALIDO');
    expect(filasNuevasDeLaCola(antesDeAbrir)).toHaveLength(0);

    abrirCaja();
    const antes = filasDeLaCola();
    expect(cobrarEsperandoError(enEfectivo([{ productoId: poco, cantidad: '10' }])).codigo).toBe('STOCK_INSUFICIENTE');
    expect(cobrarEsperandoError(enEfectivo([{ productoId: inactivo, cantidad: '1' }])).codigo).toBe('DATO_INVALIDO');
    expect(
      cobrarEsperandoError({
        lineas: [{ productoId: maiz, cantidad: '1' }],
        // Sin topes configurados el tope es cero: cualquier descuento pide PIN.
        descuento: { tipo: 'porcentaje', valor: '5' },
        formaPago: 'efectivo',
        numBoleta: null,
      }).codigo,
    ).toBe('PERMISO_DENEGADO');

    expect(asientosDeConflicto()).toHaveLength(0);
    expect(filasNuevasDeLaCola(antes)).toHaveLength(0);
    expect(bitacoraTecnica.lineas).toEqual([]);
  });

  it('una venta que se registra bien no deja asiento de conflicto', () => {
    const maiz = producto('Maíz', '10.00', '50');
    abrirCaja();

    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    expect(asientosDeConflicto()).toHaveLength(0);
    expect(inventarioDe(maiz)).toBe('48.000');
  });

  it('si el asiento NO se puede escribir, el cajero recibe IGUAL el conflicto y la falla queda en la bitácora técnica', async () => {
    const maiz = producto('Maíz blanco', '10.00', '50');
    abrirCaja();
    const antes = filasDeLaCola();
    // Una falla REAL de la base al insertar el asiento, no una excepción inventada.
    base.exec(`
      CREATE TRIGGER prueba_asiento_de_conflicto_falla
      BEFORE INSERT ON auditoria_log
      WHEN NEW.accion = 'conflicto_de_inventario'
      BEGIN
        SELECT RAISE(ABORT, 'sin espacio en disco (simulado por la prueba)');
      END;
    `);
    moverElSaldoAntesDeDescontar(maiz, '47.000');

    const error = cobrarEsperandoError(enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    expect(error.codigo).toBe('CONFLICTO_DE_INVENTARIO');
    expect(error.mensajeParaElUsuario).toBe(MENSAJE_AL_CAJERO('Maíz blanco'));
    expect(asientosDeConflicto()).toHaveLength(0);
    expect(filasNuevasDeLaCola(antes)).toHaveLength(0);
    expect(filasDe('ventas')).toBe(0);
    expect(hayTransaccionDeNegocioEnCurso()).toBe(false);

    expect(bitacoraTecnica.lineas).toHaveLength(1);
    const linea = bitacoraTecnica.lineas[0]!;
    expect(linea.startsWith('[venta] ')).toBe(true);
    expect(linea).toContain('conflicto_de_inventario');
    expect(linea).toContain(maiz);
    expect(linea).toContain('sin espacio en disco (simulado por la prueba)');

    // Y por el envoltorio de IPC la ventana sigue viendo el conflicto, no un
    // «La operación no pudo completarse». El saldo se vuelve a mover solo: el
    // reemplazo de arriba sigue puesto para este segundo cobro.
    const respuesta = await ejecutarConRespuesta('COBRO_FALLIDO', () =>
      venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }])),
    );
    expect(respuesta.ok).toBe(false);
    expect(respuesta.ok ? null : respuesta.error.codigo).toBe('CONFLICTO_DE_INVENTARIO');
  });
});

// ===========================================================================
describe('Los contadores del producto suben dentro de la misma transacción', () => {
  it('cantidad_vendida sube por la CANTIDAD, no de a uno por línea', () => {
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();

    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '12.500' }]));

    const despues = repos.productos.obtenerPorId(maiz);
    expect(cantidadACadena(despues?.cantidadVendida ?? '0')).toBe('12.500');
    // Y `contador_ventas` cuenta VECES: una venta, una vez.
    expect(despues?.contadorVentas).toBe(1);
  });

  it('dos ventas acumulan la cantidad de las dos', () => {
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();

    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '12.500' }]));
    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '7.250' }]));

    const despues = repos.productos.obtenerPorId(maiz);
    expect(cantidadACadena(despues?.cantidadVendida ?? '0')).toBe('19.750');
    expect(despues?.contadorVentas).toBe(2);
  });

  it('cada producto del ticket mueve SUS propios contadores, no los de los demás', () => {
    const maiz = producto('Maíz', '10.00', '100');
    const frijol = producto('Frijol', '6.00', '100');
    abrirCaja();

    venta.registrar(
      idCajera,
      'venta',
      enEfectivo([
        { productoId: maiz, cantidad: '3' },
        { productoId: frijol, cantidad: '8' },
      ]),
    );

    expect(cantidadACadena(repos.productos.obtenerPorId(maiz)?.cantidadVendida ?? '0')).toBe('3.000');
    expect(cantidadACadena(repos.productos.obtenerPorId(frijol)?.cantidadVendida ?? '0')).toBe('8.000');
  });

  it('si la venta falla, los contadores tampoco se mueven', () => {
    const maiz = producto('Maíz', '10.00', '100');
    const azucar = producto('Azúcar', '4.00', '1');
    abrirCaja();

    expect(() =>
      venta.registrar(
        idCajera,
        'venta',
        enEfectivo([
          { productoId: maiz, cantidad: '3' },
          { productoId: azucar, cantidad: '50' },
        ]),
      ),
    ).toThrow(ErrorDeNegocio);

    const despues = repos.productos.obtenerPorId(maiz);
    expect(cantidadACadena(despues?.cantidadVendida ?? '0')).toBe('0.000');
    expect(despues?.contadorVentas).toBe(0);
  });
});

// ===========================================================================
/**
 * EL TOTAL MANDA: la suma de los importes impresos es exactamente el total.
 *
 * Es la regla que hace que un recibo cuadre consigo mismo. Sin ella, tres
 * pesadas de Q3.345 imprimen Q3.35 cada una y suman un centavo más que el
 * total cobrado, y ese recibo no se defiende en una auditoría.
 */
describe('El recibo cuadra: los subtotales impresos suman exactamente el total', () => {
  /** Suma los `subtotal_impreso` de una venta, con Decimal. */
  function sumaDeImpresos(ventaId: string): string {
    return montoACadena(
      sumarLista(repos.ventaDetalle.listarPorVenta(ventaId).map((linea) => linea.subtotalImpreso)),
    );
  }

  it('tres pesadas iguales de medio centavo cada una', () => {
    const maiz = producto('Maíz', '6.69', '100');
    const frijol = producto('Frijol', '6.69', '100');
    const azucar = producto('Azúcar', '6.69', '100');
    abrirCaja();

    const resultado = venta.registrar(
      idCajera,
      'venta',
      enEfectivo([
        { productoId: maiz, cantidad: '0.5' },
        { productoId: frijol, cantidad: '0.5' },
        { productoId: azucar, cantidad: '0.5' },
      ]),
    );

    // 3.345 × 3 = 10.035, que redondea a 10.04 una sola vez. Línea por línea
    // habrían sido 3.35 × 3 = 10.05: un centavo de más al cliente.
    expect(resultado.total).toBe('10.04');
    expect(sumaDeImpresos(resultado.venta.id)).toBe('10.04');
  });

  it('con precio especial, descuento y varias líneas a la vez', () => {
    const maiz = producto('Maíz', '6.69', '100');
    const frijol = producto('Frijol', '3.33', '100');
    const azucar = producto('Azúcar', '1.11', '100');
    repos.preciosEspeciales.crear({
      productoId: maiz,
      tipo: 'porcentaje',
      valor: '15',
      vigenteDesde: diasDesdeHoy(-1),
      vigenteHasta: hoy(),
    });
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '50',
      editadoPor: idJimmy,
    });
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [
        { productoId: maiz, cantidad: '0.333' },
        { productoId: frijol, cantidad: '1.777' },
        { productoId: azucar, cantidad: '2.125' },
      ],
      descuento: { tipo: 'porcentaje', valor: '7.5' },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(resultado.lineasConPrecioEspecial).toBe(1);
    expect(sumaDeImpresos(resultado.venta.id)).toBe(resultado.total);
    expect(montoACadena(resultado.venta.total)).toBe(resultado.total);
  });

  it('diez líneas con residuo, todas a la vez', () => {
    abrirCaja();
    const ids = Array.from({ length: 10 }, (_, indice) =>
      producto(`Grano ${String(indice)}`, '0.67', '100'),
    );

    const resultado = venta.registrar(
      idCajera,
      'venta',
      enEfectivo(ids.map((id) => ({ productoId: id, cantidad: '0.5' }))),
    );

    // 0.335 × 10 = 3.35 exacto, pero cada línea vale medio centavo.
    expect(resultado.total).toBe('3.35');
    expect(sumaDeImpresos(resultado.venta.id)).toBe('3.35');
  });

  it('el orden de captura se conserva en orden_linea', () => {
    const maiz = producto('Maíz', '1.00', '100');
    const frijol = producto('Frijol', '1.00', '100');
    const azucar = producto('Azúcar', '1.00', '100');
    abrirCaja();

    const resultado = venta.registrar(
      idCajera,
      'venta',
      enEfectivo([
        { productoId: azucar, cantidad: '1' },
        { productoId: maiz, cantidad: '1' },
        { productoId: frijol, cantidad: '1' },
      ]),
    );

    const lineas = repos.ventaDetalle.listarPorVenta(resultado.venta.id);
    expect(lineas.map((linea) => linea.ordenLinea)).toEqual([0, 1, 2]);
    expect(lineas.map((linea) => linea.productoNombreSnap)).toEqual([
      'Azúcar',
      'Maíz',
      'Frijol',
    ]);
  });
});

// ===========================================================================
describe('Forma de pago: la boleta va con tarjeta y solo con tarjeta', () => {
  it('una venta con tarjeta SIN boleta se rechaza', () => {
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: maiz, cantidad: '1' }],
        descuento: null,
        formaPago: 'tarjeta',
        numBoleta: null,
      }),
    ).toThrow(/número de boleta/);
    expect(inventarioDe(maiz)).toBe('20.000');
  });

  it('una venta en efectivo CON boleta se rechaza', () => {
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: maiz, cantidad: '1' }],
        descuento: null,
        formaPago: 'efectivo',
        numBoleta: '004512',
      }),
    ).toThrow(/no lleva número de boleta/);
  });

  it('con tarjeta y boleta se registra, y la boleta queda guardada tal cual', () => {
    const maiz = producto('Maíz', '10.00', '20');
    abrirCaja();

    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '1' }],
      descuento: null,
      formaPago: 'tarjeta',
      // Con el cero a la izquierda: es un número de documento, no una cantidad.
      numBoleta: '004512',
    });

    expect(resultado.venta.numBoleta).toBe('004512');
  });
});

// ===========================================================================
describe('monto_esperado del corte refleja las ventas en efectivo del turno', () => {
  it('suma las ventas en efectivo y EXCLUYE las de tarjeta', () => {
    const maiz = producto('Maíz', '10.00', '100');
    const sesionId = abrirCaja();

    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '3' }]));
    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '5' }],
      descuento: null,
      formaPago: 'tarjeta',
      numBoleta: '004512',
    });
    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '2' }]));

    const sesion = repos.cajaSesiones.obtenerPorId(sesionId);
    if (sesion === null) {
      throw new Error('Se perdió la sesión de caja.');
    }
    // 500 de fondo + 30 + 20 en efectivo. Los Q50 de la tarjeta NO entran al
    // cajón: ese dinero llega por el banco.
    expect(montoACadena(caja.montoEsperadoDe(sesion))).toBe('550.00');
  });

  it('EL TEÓRICO EN VIVO sube con cada venta en efectivo, y es el mismo número que el esperado del cierre', () => {
    const maiz = producto('Maíz', '10.00', '100');
    const sesionId = abrirCaja();
    const leer = (): ReturnType<typeof caja.resumenDelTurno> => {
      const sesion = repos.cajaSesiones.obtenerPorId(sesionId);
      if (sesion === null) {
        throw new Error('Se perdió la sesión de caja.');
      }
      return caja.resumenDelTurno(sesion);
    };

    // Recién abierta: el teórico es el fondo, y no hay ventas.
    expect(montoACadena(leer().montoTeorico)).toBe('500.00');
    expect(leer().cantidadDeVentasEnEfectivo).toBe(0);

    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '3' }]));
    expect(montoACadena(leer().ventasEnEfectivo)).toBe('30.00');
    expect(montoACadena(leer().montoTeorico)).toBe('530.00');

    // Una venta con tarjeta NO mueve el teórico: ese dinero no entra al cajón.
    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '5' }],
      descuento: null,
      formaPago: 'tarjeta',
      numBoleta: '004512',
    });
    expect(montoACadena(leer().montoTeorico)).toBe('530.00');
    expect(leer().cantidadDeVentasEnEfectivo).toBe(1);

    // Y al cerrar se compara contra exactamente ese número.
    const cierre = caja.intentarCerrar(sesionId, { modo: 'simple', monto: '530' }, {
      usuarioQueCierra: idCajera,
    });
    expect(cierre.montoEsperado).toBe('530.00');
    expect(cierre.cerrada).toBe(true);
  });

  it('el descuento ya viene aplicado: se suma el TOTAL, no el subtotal', () => {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '20',
      editadoPor: idJimmy,
    });
    const maiz = producto('Maíz', '10.00', '100');
    const sesionId = abrirCaja();

    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: { tipo: 'porcentaje', valor: '10' },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    const sesion = repos.cajaSesiones.obtenerPorId(sesionId);
    if (sesion === null) {
      throw new Error('Se perdió la sesión de caja.');
    }
    expect(montoACadena(caja.montoEsperadoDe(sesion))).toBe('590.00');
  });

  it('las ventas de OTRO turno no cuentan en este', () => {
    const maiz = producto('Maíz', '10.00', '100');
    const primero = abrirCaja();
    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '3' }]));
    caja.intentarCerrar(primero, { modo: 'simple', monto: '530' }, { usuarioQueCierra: idCajera });

    const segundo = caja.abrir(idCajera, { modo: 'simple', monto: '100' }).id;
    const sesion = repos.cajaSesiones.obtenerPorId(segundo);
    if (sesion === null) {
      throw new Error('Se perdió la sesión de caja.');
    }
    expect(montoACadena(caja.montoEsperadoDe(sesion))).toBe('100.00');
  });

  it('cerrar el turno con lo que las ventas dicen que hay CUADRA sin autorización', () => {
    const maiz = producto('Maíz', '10.00', '100');
    const sesionId = abrirCaja();
    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '7' }]));

    const cierre = caja.intentarCerrar(
      sesionId,
      { modo: 'simple', monto: '570' },
      { usuarioQueCierra: idCajera },
    );

    expect(cierre.cerrada).toBe(true);
    expect(cierre.diferencia).toBe('0.00');
  });
});

// ===========================================================================
describe('La auditoría deja rastro de la venta y de la autorización', () => {
  /** Los asientos de una acción, en toda la base. */
  function asientos(accion: string): readonly { readonly usuarioId: string | null }[] {
    return repos.auditoria
      .listarPorRango('1900-01-01', '2999-01-01')
      .filter((asiento) => asiento.accion === accion);
  }

  it('cada venta deja UN asiento, a nombre de quien vendió', () => {
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();
    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '1' }]));

    const registrados = asientos('venta_registrada');
    expect(registrados).toHaveLength(1);
    expect(registrados[0]?.usuarioId).toBe(idCajera);
  });

  it('la autorización del descuento deja su PROPIO asiento, a nombre del administrador', () => {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '20',
      editadoPor: idJimmy,
    });
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();

    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: maiz, cantidad: '10' }],
      descuento: { tipo: 'porcentaje', valor: '30', autorizacion: { autorizadoPor: idJimmy, via: 'presencial' } },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    const autorizaciones = asientos('descuento_autorizado');
    expect(autorizaciones).toHaveLength(1);
    // El asiento es del administrador, no de quien vendió: son dos personas.
    expect(autorizaciones[0]?.usuarioId).toBe(idJimmy);
    expect(asientos('venta_registrada')[0]?.usuarioId).toBe(idCajera);
  });

  it('una venta SIN descuento no deja ningún asiento de autorización', () => {
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();
    venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '1' }]));

    expect(asientos('descuento_autorizado')).toHaveLength(0);
  });
});

// ===========================================================================
describe('Lo que el canal no puede mandar', () => {
  it('un ticket vacío no se cobra', () => {
    abrirCaja();
    expect(() => venta.registrar(idCajera, 'venta', enEfectivo([]))).toThrow(/ticket vacío/);
  });

  it('el mismo producto en dos líneas se rechaza CON SU MOTIVO, no como conflicto', () => {
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();

    try {
      venta.registrar(
        idCajera,
        'venta',
        enEfectivo([
          { productoId: maiz, cantidad: '1' },
          { productoId: maiz, cantidad: '2' },
        ]),
      );
      throw new Error('Se esperaba un rechazo por producto repetido.');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      const negocio = error as ErrorDeNegocio;
      // NO es CONFLICTO_DE_INVENTARIO: decirle al cajero que el saldo cambió
      // sería mentirle sobre lo que pasó.
      expect(negocio.codigo).toBe('DATO_INVALIDO');
      expect(negocio.mensajeParaElUsuario).toContain('dos líneas');
    }
  });

  it('un producto que no existe frena la venta', () => {
    abrirCaja();
    expect(() =>
      venta.registrar(
        idCajera,
        'venta',
        enEfectivo([{ productoId: '00000000-0000-4000-8000-000000000000', cantidad: '1' }]),
      ),
    ).toThrow(/ya no existe/);
  });

  it('una cantidad de cero o negativa se rechaza', () => {
    const maiz = producto('Maíz', '10.00', '100');
    abrirCaja();

    expect(() => venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '0' }])))
      .toThrow(/mayor que cero/);
    expect(() => venta.registrar(idCajera, 'venta', enEfectivo([{ productoId: maiz, cantidad: '-3' }])))
      .toThrow(/mayor que cero/);
  });
});
