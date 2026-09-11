/**
 * El recibo: que diga EXACTAMENTE lo que se cobró.
 *
 * Es el único papel que se lleva el cliente, así que la pregunta que estas
 * pruebas responden es una sola, repetida de varias formas: ¿los montos del
 * recibo son los mismos que quedaron guardados al vender? No «los mismos que
 * daría recalcular», sino los mismos que están en la base, línea por línea.
 *
 * Las ventas se registran con el servicio de venta REAL, no insertando filas a
 * mano: si se armaran a mano, la prueba podría pasar con datos que la
 * transacción nunca habría producido.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import {
  absoluto,
  esMenorOIgualQue,
  montoACadena,
  multiplicar,
  restar,
  sumarLista,
} from '@shared/money';
import { NullPrinterProvider } from '@shared/adapters';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { LogTecnicoSilencioso } from '@main/log-tecnico';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { MARCADORES } from '../modelo-de-recibo';
import { reciboComoTexto } from '../plantilla-de-recibo';
import { ServicioDeRecibos } from '../servicio-de-recibos';

let base: Database;
let repos: Repositorios;
let venta: ServicioDeVenta;
let caja: ServicioDeCaja;
let recibos: ServicioDeRecibos;
let limpiar: () => void;

let idCajera: string;
let idJimmy: string;
let idMaiz: string;
let idFrijol: string;

/** Los HTML que se «imprimieron», en vez de escribir PDF en el disco. */
let pdfEscritos: { ruta: string; html: string }[];

/** Si el generador de PDF debe fallar, para probar ese camino. */
let elPdfFalla = false;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
  pdfEscritos = [];
  elPdfFalla = false;

  caja = new ServicioDeCaja({
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
  });
  recibos = new ServicioDeRecibos({
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    recibos: repos.recibos,
    usuarios: repos.usuarios,
    configuracion: repos.configuracionNegocio,
    impresora: new NullPrinterProvider(),
    log: new LogTecnicoSilencioso(),
    ubicacion: {
      carpeta: '/pdf',
      unir: (carpeta: string, nombre: string): string => `${carpeta}/${nombre}`,
    },
    generarPdf: (html: string, ruta: string): Promise<void> => {
      if (elPdfFalla) {
        return Promise.reject(new Error('disco lleno'));
      }
      pdfEscritos.push({ ruta, html });
      return Promise.resolve();
    },
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

  const categoriaId = repos.categorias.crear({ nombre: 'Granos', orden: 1 }).id;
  idMaiz = repos.productos.crear({
    nombre: 'Maíz blanco',
    categoriaId,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '6.69',
    inventarioDisponible: '100',
  }).id;
  idFrijol = repos.productos.crear({
    nombre: 'Frijol negro',
    categoriaId,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '3.33',
    inventarioDisponible: '100',
  }).id;

  caja.abrir(idCajera, { modo: 'simple', monto: '500' });
});

afterEach(() => {
  limpiar();
});

/** Registra una venta de tres medias libras de maíz, sin descuento. */
function ventaSimple(): string {
  return venta.registrar(idCajera, 'venta', {
    lineas: [{ productoId: idMaiz, cantidad: '0.5' }],
    descuento: null,
    formaPago: 'efectivo',
    numBoleta: null,
  }).venta.id;
}

/** La venta de dos capas de descuento: precio especial y descuento discrecional. */
function ventaConDosCapas(): string {
  repos.preciosEspeciales.crear({
    productoId: idMaiz,
    tipo: 'porcentaje',
    valor: '15',
    vigenteDesde: new Date(Date.now() - 86_400_000).toISOString(),
    vigenteHasta: null,
  });
  repos.limitesDescuento.fijar({
    rol: 'venta',
    descuentoMaxPorcentaje: '10',
    descuentoMaxMontoFijo: '50',
    editadoPor: idJimmy,
  });

  return venta.registrar(idCajera, 'venta', {
    lineas: [
      { productoId: idMaiz, cantidad: '0.333' },
      { productoId: idFrijol, cantidad: '1.777' },
    ],
    descuento: { tipo: 'porcentaje', valor: '7.5' },
    formaPago: 'efectivo',
    numBoleta: null,
  }).venta.id;
}

// ===========================================================================
describe('El recibo dice exactamente lo que quedó guardado', () => {
  it('cada línea del recibo repite el subtotal_impreso de venta_detalle', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);

    const guardadas = repos.ventaDetalle.listarPorVenta(ventaId);
    expect(modelo.lineas).toHaveLength(guardadas.length);

    for (const [indice, linea] of modelo.lineas.entries()) {
      const guardada = guardadas[indice];
      expect(linea.producto).toBe(guardada?.productoNombreSnap);
      expect(linea.unidad).toBe(guardada?.unidadSnap);
      // El IMPRESO, no el exacto: es el que suma exactamente el total.
      expect(linea.subtotal).toBe(montoACadena(guardada?.subtotalImpreso ?? '0'));
      /*
        El PRECIO UNITARIO no se compara acá contra `precio_unitario_snap`
        porque esta venta lleva descuento, y con descuento lo que se imprime es
        el precio EFECTIVO. Tiene su propio grupo de pruebas más abajo, «El
        precio unitario impreso: el renglón multiplica».
      */
    }
  });

  it('los importes del recibo SUMAN exactamente su total', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);

    const suma = sumarLista(modelo.lineas.map((linea) => linea.subtotal));
    expect(montoACadena(suma)).toBe(modelo.total);
  });

  it('el subtotal y el total son los de la fila de ventas, sin recalcular', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);

    const guardada = repos.ventas.obtenerPorId(ventaId);
    expect(modelo.subtotal).toBe(montoACadena(guardada?.subtotal ?? '0'));
    expect(modelo.total).toBe(montoACadena(guardada?.total ?? '0'));
  });

  it('la rebaja del descuento se DERIVA de subtotal − total, no de reaplicar el %', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);
    const guardada = repos.ventas.obtenerPorId(ventaId);

    expect(modelo.descuento).not.toBeNull();
    expect(modelo.descuento?.rebaja).toBe(
      montoACadena(restar(guardada?.subtotal ?? '0', guardada?.total ?? '0')),
    );
    // Y el subtotal menos la rebaja da el total, que es lo que el cliente paga.
    expect(montoACadena(sumarLista([modelo.total, modelo.descuento?.rebaja ?? '0']))).toBe(
      modelo.subtotal,
    );
  });

  it('esos mismos montos salen en el HTML del PDF y en el texto de la térmica', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);

    const html = pdfEscritos[0]?.html ?? '';
    const texto = reciboComoTexto(modelo);

    for (const linea of modelo.lineas) {
      expect(html).toContain(linea.subtotal);
      expect(texto).toContain(linea.subtotal);
    }
    expect(html).toContain(modelo.total);
    expect(texto).toContain(modelo.total);
  });

  it('EL PAPEL CUADRA: los importes de las líneas suman el TOTAL impreso', async () => {
    /*
      Es la prueba que atrapó un defecto real. `subtotal_impreso` es la parte
      que le toca a cada línea DEL TOTAL YA DESCONTADO, así que las líneas NO
      suman el subtotal. La primera versión del recibo imprimía «Subtotal /
      Descuento / Total» encima de esas líneas, y daba un papel donde los
      importes no cuadraban con ningún renglón: 14.80 + 5.32 no da 21.75.
    */
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);
    const texto = reciboComoTexto(modelo);

    const suma = sumarLista(modelo.lineas.map((linea) => linea.subtotal));
    expect(montoACadena(suma)).toBe(modelo.total);

    // Y el papel NO promete una resta que no cierra: no hay renglón «Subtotal».
    expect(texto).not.toContain('Subtotal');
    // Dice, en cambio, que los importes ya vienen descontados.
    expect(texto).toContain('ya incluyen el descuento');
  });

  it('el precio unitario efectivo sale EN EL PAPEL y EN EL HTML DEL PDF', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);

    const html = pdfEscritos[0]?.html ?? '';
    const texto = reciboComoTexto(modelo);

    for (const linea of modelo.lineas) {
      // El renglón entero, no el número suelto: así la prueba falla si el
      // precio efectivo se calcula bien pero se imprime el de lista.
      expect(texto).toContain(`${linea.cantidad} ${linea.unidad} x ${linea.precioUnitario}`);
      expect(html).toContain(`${linea.cantidad} ${linea.unidad} &times; ${linea.precioUnitario}`);
    }
  });

  it('SIN descuento el papel no trae ninguna aclaración de más', async () => {
    const { modelo } = await recibos.emitir(ventaSimple());
    const texto = reciboComoTexto(modelo);

    expect(texto).not.toContain('ya incluyen el descuento');
    expect(texto).not.toContain('Descuento');
  });

  it('el recibo NO lleva la leyenda de factura fiscal: dice que es proforma', async () => {
    const { modelo } = await recibos.emitir(ventaSimple());
    const texto = reciboComoTexto(modelo);

    expect(texto).toContain('RECIBO DE VENTA');
    expect(texto).toContain('no válido como factura fiscal');
  });

  it('quién autorizó el descuento sale EN EL PAPEL, no solo en la auditoría', async () => {
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '20',
      editadoPor: idJimmy,
    });
    const ventaId = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '10' }],
      descuento: { tipo: 'porcentaje', valor: '30', autorizacion: { autorizadoPor: idJimmy, via: 'presencial' } },
      formaPago: 'efectivo',
      numBoleta: null,
    }).venta.id;

    const { modelo } = await recibos.emitir(ventaId);
    expect(modelo.descuento?.autorizadoPor).toBe('Jimmy');
    expect(reciboComoTexto(modelo)).toContain('Autorizado por: Jimmy');
  });

  it('con tarjeta sale el número de boleta; en efectivo no aparece', async () => {
    const conTarjeta = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '1' }],
      descuento: null,
      formaPago: 'tarjeta',
      numBoleta: '004512',
    }).venta.id;

    const tarjeta = await recibos.emitir(conTarjeta);
    expect(reciboComoTexto(tarjeta.modelo)).toContain('004512');

    const efectivo = await recibos.emitir(ventaSimple());
    expect(reciboComoTexto(efectivo.modelo)).not.toContain('Boleta');
  });
});

// ===========================================================================
describe('El precio unitario impreso: el renglón multiplica', () => {
  /*
    QUÉ SE ESTÁ PROTEGIENDO. `subtotal_impreso` es la parte que le toca a cada
    línea del total YA DESCONTADO. Imprimir al lado el precio de LISTA daba un
    renglón que no multiplicaba —«0.333 lb x 6.69» junto a «2.06»— y el cliente
    no podía verificar su propio recibo de cabeza. Con descuento se imprime
    entonces el precio EFECTIVO, `subtotal_impreso ÷ cantidad`.

    ES PURAMENTE DE PRESENTACIÓN: `venta_detalle.precio_unitario_snap` sigue
    guardando el precio de lista, y hay una prueba abajo que lo comprueba.
  */

  it('CON descuento: cantidad × precio unitario impreso da el importe de la línea', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);

    expect(modelo.descuento).not.toBeNull();
    expect(modelo.lineas.length).toBeGreaterThan(0);

    for (const linea of modelo.lineas) {
      const multiplicado = multiplicar(linea.cantidad, linea.precioUnitario);
      const desvio = absoluto(restar(multiplicado, linea.subtotal));
      /*
        LA COTA, MEDIDA. El precio impreso lleva dos decimales, así que el
        producto puede desviarse hasta MEDIO CENTAVO POR UNIDAD: es el margen
        inevitable de imprimir un unitario redondeado, y no un defecto. Con
        0.333 lb son tres milésimas de centavo; con 100 lb llega a Q0.50, y por
        eso la cota se escribe en función de la cantidad y no como un centavo
        fijo.
      */
      const tolerancia = multiplicar(linea.cantidad, '0.005');
      expect(esMenorOIgualQue(desvio, tolerancia)).toBe(true);
    }
  });

  it('CON descuento: el precio impreso NO es el de lista, es el efectivo', async () => {
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);
    const guardadas = repos.ventaDetalle.listarPorVenta(ventaId);

    for (const [indice, linea] of modelo.lineas.entries()) {
      const guardada = guardadas[indice];
      expect(linea.precioUnitario).not.toBe(montoACadena(guardada?.precioUnitarioSnap ?? '0'));
    }
  });

  it('SIN descuento: el precio impreso es precio_unitario_snap tal cual', async () => {
    const ventaId = ventaSimple();
    const { modelo } = await recibos.emitir(ventaId);
    const guardadas = repos.ventaDetalle.listarPorVenta(ventaId);

    expect(modelo.descuento).toBeNull();
    for (const [indice, linea] of modelo.lineas.entries()) {
      expect(linea.precioUnitario).toBe(montoACadena(guardadas[indice]?.precioUnitarioSnap ?? '0'));
    }
  });

  it('NO CAMBIA LO GUARDADO: venta_detalle conserva el precio de LISTA', async () => {
    /*
      Es la mitad de la regla que más fácil se rompe sin querer. El precio
      efectivo es un número que solo existe mientras se dibuja el papel; lo que
      queda en la base tiene que seguir siendo la foto del precio al momento de
      vender, porque ese es el dato del negocio: lo que el producto costaba.
    */
    const ventaId = ventaConDosCapas();
    await recibos.emitir(ventaId);

    const guardadas = repos.ventaDetalle.listarPorVenta(ventaId);
    const maiz = guardadas.find((linea) => linea.productoId === idMaiz);
    // 6.69 de lista, menos el 15 % del precio especial: 5.6865, sin tocar por
    // el descuento discrecional, que se aplica sobre el total de la venta.
    expect(montoACadena(maiz?.precioUnitarioSnap ?? '0')).toBe('5.69');
  });

  it('EL PAPEL SIGUE CUADRANDO: los importes suman exactamente el total', async () => {
    /*
      La prueba que ya existía, repetida acá a propósito: el precio unitario
      efectivo se deriva de `subtotal_impreso`, nunca al revés. Si algún día
      alguien invirtiera la derivación —recalculando el importe a partir del
      precio impreso— las líneas dejarían de sumar el total y esta prueba lo
      diría.
    */
    const ventaId = ventaConDosCapas();
    const { modelo } = await recibos.emitir(ventaId);

    const suma = sumarLista(modelo.lineas.map((linea) => linea.subtotal));
    expect(montoACadena(suma)).toBe(modelo.total);
    expect(reciboComoTexto(modelo)).toContain(modelo.total);
  });

  it('CON MUCHA CANTIDAD el desvío sigue acotado a medio centavo por unidad', async () => {
    /*
      El caso donde el margen se ve en el papel: 100 libras de maíz. La cota es
      Q0.50 y hay que poder afirmarla, no suponerla.
    */
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '50',
      editadoPor: idJimmy,
    });
    const ventaId = venta.registrar(idCajera, 'venta', {
      lineas: [
        { productoId: idMaiz, cantidad: '100' },
        { productoId: idFrijol, cantidad: '0.777' },
      ],
      descuento: { tipo: 'porcentaje', valor: '7.5' },
      formaPago: 'efectivo',
      numBoleta: null,
    }).venta.id;

    const { modelo } = await recibos.emitir(ventaId);

    for (const linea of modelo.lineas) {
      const desvio = absoluto(
        restar(multiplicar(linea.cantidad, linea.precioUnitario), linea.subtotal),
      );
      expect(esMenorOIgualQue(desvio, multiplicar(linea.cantidad, '0.005'))).toBe(true);
    }
    // Y aun con ese margen por línea, la suma de los importes da el total
    // exacto, porque los importes no se derivan del precio impreso.
    expect(montoACadena(sumarLista(modelo.lineas.map((linea) => linea.subtotal)))).toBe(
      modelo.total,
    );
  });
});

// ===========================================================================
describe('Sin los datos del negocio cargados, el recibo lo dice', () => {
  it('muestra marcadores entre corchetes, no valores inventados', async () => {
    const { modelo } = await recibos.emitir(ventaSimple());

    expect(modelo.negocio.sinConfigurar).toBe(true);
    expect(modelo.negocio.nombreComercial).toBe(MARCADORES.nombreComercial);
    expect(modelo.negocio.direccion).toBe(MARCADORES.direccion);
    expect(modelo.negocio.telefono).toBe(MARCADORES.telefono);
    expect(modelo.negocio.nit).toBe(MARCADORES.nit);
  });

  it('los marcadores se VEN en el papel y en el PDF', async () => {
    const { modelo } = await recibos.emitir(ventaSimple());

    for (const salida of [reciboComoTexto(modelo), pdfEscritos[0]?.html ?? '']) {
      expect(salida).toContain('[Nombre del negocio]');
      expect(salida).toContain('[NIT]');
    }
  });

  it('NO inventa nada que pueda pasar por un dato real', async () => {
    const { modelo } = await recibos.emitir(ventaSimple());
    const texto = reciboComoTexto(modelo);

    // Ni el nombre del cliente, ni un NIT de ejemplo, ni «Consumidor final»:
    // cualquiera de esos se leería como un dato cargado de verdad.
    for (const inventado of ['Jimmy Cano', 'Agro', 'C/F', 'Consumidor', '0000']) {
      expect(texto).not.toContain(inventado);
    }
  });

  it('con los datos cargados, salen los de verdad y desaparecen los marcadores', async () => {
    repos.configuracionNegocio.guardar({
      nombreComercial: 'Agroservicio El Quetzal',
      direccion: '4a calle 2-30 zona 1',
      telefono: '5555-1234',
      nit: '1234567-8',
    });

    const { modelo } = await recibos.emitir(ventaSimple());
    const texto = reciboComoTexto(modelo);

    expect(modelo.negocio.sinConfigurar).toBe(false);
    expect(texto).toContain('Agroservicio El Quetzal');
    expect(texto).toContain('1234567-8');
    expect(texto).not.toContain('[Nombre del negocio]');
  });

  it('un campo cargado y tres vacíos: solo los vacíos llevan marcador', async () => {
    repos.configuracionNegocio.guardar({
      nombreComercial: 'Agroservicio El Quetzal',
      direccion: null,
      telefono: null,
      nit: null,
    });

    const { modelo } = await recibos.emitir(ventaSimple());
    expect(modelo.negocio.nombreComercial).toBe('Agroservicio El Quetzal');
    expect(modelo.negocio.direccion).toBe(MARCADORES.direccion);
    expect(modelo.negocio.sinConfigurar).toBe(false);
  });
});

// ===========================================================================
/**
 * La regla del Prompt 1, que no se negocia: el PDF es el respaldo obligatorio y
 * la impresión es una capa opcional encima. Ningún problema de impresora puede
 * tumbar una venta ya cobrada.
 */
describe('La venta sobrevive a cualquier problema de impresión', () => {
  /** Una impresora que siempre falla, como una sin papel o desconectada. */
  const impresoraRota = {
    nombre: 'ImpresoraRota',
    imprimirComprobante: (): Promise<never> =>
      Promise.reject(new Error('El dispositivo no responde.')),
    consultarEstado: (): Promise<{
      disponible: boolean;
      adaptador: string;
      descripcion: string;
    }> =>
      Promise.resolve({
        disponible: false,
        adaptador: 'ImpresoraRota',
        descripcion: 'rota',
      }),
  };

  /** El servicio de recibos con la impresora indicada. */
  function conImpresora(impresora: typeof impresoraRota): ServicioDeRecibos {
    return new ServicioDeRecibos({
      ventas: repos.ventas,
      ventaDetalle: repos.ventaDetalle,
      recibos: repos.recibos,
      usuarios: repos.usuarios,
      configuracion: repos.configuracionNegocio,
      impresora,
      log: new LogTecnicoSilencioso(),
      ubicacion: {
        carpeta: '/pdf',
        unir: (carpeta: string, nombre: string): string => `${carpeta}/${nombre}`,
      },
      generarPdf: (html: string, ruta: string): Promise<void> => {
        pdfEscritos.push({ ruta, html });
        return Promise.resolve();
      },
    });
  }

  it('SIN impresora configurada la venta se completa y el PDF se genera', async () => {
    const ventaId = ventaSimple();
    const resultado = await recibos.emitir(ventaId);

    expect(resultado.pdfGenerado).toBe(true);
    expect(resultado.impreso).toBe(false);
    expect(resultado.mensajeDeImpresion).toContain('PDF');
    // Y la venta sigue completa, que es lo que importa.
    expect(repos.ventas.obtenerPorId(ventaId)?.estado).toBe('completada');
  });

  it('con la impresora ROTA tampoco se cae: el recibo existe y el PDF también', async () => {
    const ventaId = ventaSimple();
    const resultado = await conImpresora(impresoraRota).emitir(ventaId);

    expect(resultado.pdfGenerado).toBe(true);
    expect(resultado.impreso).toBe(false);
    expect(repos.recibos.obtenerPorVenta(ventaId)).not.toBeNull();
    expect(repos.ventas.obtenerPorId(ventaId)?.estado).toBe('completada');
  });

  it('un fallo de impresión NO ensucia auditoria_log', async () => {
    // Es un evento técnico, no un hecho del negocio. La bitácora de auditoría
    // es evidencia para un auditor y no debe llenarse de ruido de hardware.
    await conImpresora(impresoraRota).emitir(ventaSimple());

    const acciones = repos.auditoria
      .listarPorRango('1900-01-01', '2999-01-01')
      .map((asiento) => asiento.accion);
    expect(acciones.some((accion) => accion.includes('impres'))).toBe(false);
  });

  it('si hasta el PDF falla, la venta sigue completada y el recibo queda emitido', async () => {
    const ventaId = ventaSimple();
    elPdfFalla = true;

    const resultado = await recibos.emitir(ventaId);

    expect(resultado.pdfGenerado).toBe(false);
    expect(repos.ventas.obtenerPorId(ventaId)?.estado).toBe('completada');
    // El recibo existe, así que se puede volver a emitir desde el historial.
    expect(repos.recibos.obtenerPorVenta(ventaId)).not.toBeNull();
  });

  it('cuando SÍ imprime, el recibo queda marcado como impreso', async () => {
    const impresoraQueFunciona = {
      ...impresoraRota,
      nombre: 'ImpresoraOk',
      imprimirComprobante: (): Promise<{
        ok: boolean;
        adaptador: string;
        omitidaPorDiseno: boolean;
        mensaje: string;
      }> =>
        Promise.resolve({
          ok: true,
          adaptador: 'ImpresoraOk',
          omitidaPorDiseno: false,
          mensaje: 'Recibo enviado a la impresora.',
        }),
    };

    const ventaId = ventaSimple();
    const resultado = await conImpresora(impresoraQueFunciona as typeof impresoraRota).emitir(
      ventaId,
    );

    expect(resultado.impreso).toBe(true);
    expect(repos.recibos.obtenerPorVenta(ventaId)?.impreso).toBe(true);
  });
});

// ===========================================================================
describe('Reimprimir reproduce los mismos datos que el original', () => {
  it('los montos son idénticos, línea por línea', async () => {
    const ventaId = ventaConDosCapas();
    const original = await recibos.emitir(ventaId);
    const copia = await recibos.reimprimir(original.recibo.id);

    expect(copia.modelo.numeroRecibo).toBe(original.modelo.numeroRecibo);
    expect(copia.modelo.subtotal).toBe(original.modelo.subtotal);
    expect(copia.modelo.total).toBe(original.modelo.total);
    expect(copia.modelo.lineas).toEqual(original.modelo.lineas);
    expect(copia.modelo.descuento?.rebaja).toBe(original.modelo.descuento?.rebaja);
  });

  it('NO emite un recibo nuevo ni consume otro número', async () => {
    const ventaId = ventaConDosCapas();
    const original = await recibos.emitir(ventaId);
    await recibos.reimprimir(original.recibo.id);

    expect(repos.recibos.siguienteNumero()).toBe(original.recibo.numeroRecibo + 1);
  });

  it('se marca como REIMPRESIÓN en el papel, para no confundirla con el original', async () => {
    const original = await recibos.emitir(ventaSimple());
    const copia = await recibos.reimprimir(original.recibo.id);

    expect(original.modelo.reimpresion).toBe(false);
    expect(copia.modelo.reimpresion).toBe(true);
    expect(reciboComoTexto(copia.modelo)).toContain('REIMPRESIÓN');
  });

  it('REGENERA desde la base: si se cargan los datos del negocio, salen los nuevos', async () => {
    // Es la razón por la que se regenera en vez de reusar el PDF del disco: un
    // recibo emitido antes de cargar los datos de la tienda tiene que poder
    // reimprimirse con el nombre y el NIT correctos.
    const original = await recibos.emitir(ventaSimple());
    expect(original.modelo.negocio.nombreComercial).toBe(MARCADORES.nombreComercial);

    repos.configuracionNegocio.guardar({
      nombreComercial: 'Agroservicio El Quetzal',
      direccion: null,
      telefono: null,
      nit: '1234567-8',
    });

    const copia = await recibos.reimprimir(original.recibo.id);
    expect(copia.modelo.negocio.nombreComercial).toBe('Agroservicio El Quetzal');
    // Y los montos no se movieron ni un centavo.
    expect(copia.modelo.total).toBe(original.modelo.total);
  });

  it('emitir dos veces la misma venta NO crea un segundo recibo', async () => {
    const ventaId = ventaSimple();
    const primero = await recibos.emitir(ventaId);
    const segundo = await recibos.emitir(ventaId);

    expect(segundo.recibo.id).toBe(primero.recibo.id);
    expect(segundo.modelo.reimpresion).toBe(true);
  });

  it('los números de recibo son correlativos entre ventas distintas', async () => {
    const uno = await recibos.emitir(ventaSimple());
    const otro = await recibos.emitir(
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: idFrijol, cantidad: '1' }],
        descuento: null,
        formaPago: 'efectivo',
        numBoleta: null,
      }).venta.id,
    );

    expect(otro.recibo.numeroRecibo).toBe(uno.recibo.numeroRecibo + 1);
  });
});
