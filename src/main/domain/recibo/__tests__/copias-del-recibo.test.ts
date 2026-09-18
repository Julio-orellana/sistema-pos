/**
 * Las dos copias impresas del recibo: qué lleva cada una, renglón por renglón
 * (spec/features/001-recibo-copia-tienda-cliente).
 *
 * LA PREGUNTA QUE CONTESTAN ESTAS PRUEBAS: ¿la copia del cliente oculta
 * EXACTAMENTE los datos de control interno —quién autorizó un descuento, el
 * número de boleta y, desde el 2026-09-18, quién autorizó la anulación— y NADA
 * MÁS? No alcanza con buscar que falten esos dos:
 * una plantilla que además ocultara el cajero pasaría esa búsqueda. Por eso se
 * compara la copia del cliente contra la de la tienda renglón por renglón, y
 * se exige que la diferencia sea justamente esa.
 *
 * Son funciones puras: el modelo se arma a mano y se recorre una grilla de 24
 * recibos, con y sin descuento, con y sin quién lo autorizó, en efectivo y con
 * tarjeta, original y reimpresión, en pie y anulada. Que el servicio mande
 * estas copias a la térmica se prueba en `recibo.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { LEYENDA_NO_FISCAL, type DescuentoDelRecibo, type ModeloDeRecibo } from '../modelo-de-recibo';
import {
  COLUMNAS_80MM,
  COPIAS_QUE_SE_IMPRIMEN,
  ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA,
  ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE,
  QUE_LLEVA_CADA_DESTINO,
  reciboComoTexto,
  textosDeLasCopias,
  type DestinoDelTexto,
} from '../plantilla-de-recibo';

/** Quien autorizó el DESCUENTO. Distinto de quien autorizó la anulación, a propósito. */
const AUTORIZO_EL_DESCUENTO = 'Rosa';
/** Quien autorizó la ANULACIÓN. */
const AUTORIZO_LA_ANULACION = 'Jimmy';
const VOUCHER = '004512';

const DESTINOS: readonly DestinoDelTexto[] = ['pantalla', 'tienda', 'cliente'];

interface CasoDeLaGrilla {
  readonly nombre: string;
  readonly modelo: ModeloDeRecibo;
}

/** Los 24 recibos: 3 descuentos × 2 formas de pago × original/reimpresión × en pie/anulada. */
function grilla(): CasoDeLaGrilla[] {
  const descuentos: readonly { clave: string; valor: DescuentoDelRecibo | null }[] = [
    { clave: 'sin descuento', valor: null },
    {
      clave: 'descuento dentro del tope',
      valor: { tipo: 'porcentaje', valor: '7.50', descripcion: '7.5 %', rebaja: '1.63', autorizadoPor: null },
    },
    {
      clave: 'descuento autorizado',
      valor: {
        tipo: 'porcentaje',
        valor: '30.00',
        descripcion: '30 %',
        rebaja: '20.07',
        autorizadoPor: AUTORIZO_EL_DESCUENTO,
      },
    },
  ];
  const pagos = [
    { clave: 'efectivo', formaPago: 'efectivo' as const, numBoleta: null },
    { clave: 'tarjeta', formaPago: 'tarjeta' as const, numBoleta: VOUCHER },
  ];
  const casos: CasoDeLaGrilla[] = [];
  for (const descuento of descuentos) {
    for (const pago of pagos) {
      for (const reimpresion of [false, true]) {
        for (const anulada of [false, true]) {
          casos.push({
            nombre: `${descuento.clave}, ${pago.clave}, ${reimpresion ? 'reimpresión' : 'original'}, ${anulada ? 'anulada' : 'en pie'}`,
            modelo: {
              negocio: {
                nombreComercial: 'Agroservicio El Quetzal',
                direccion: '4a calle 2-30 zona 1, San José Pinula, Guatemala',
                telefono: '5555-1234',
                nit: '1234567-8',
                sinConfigurar: false,
              },
              numeroRecibo: 128,
              ventaId: 'e4b5c6d7-0000-4000-8000-000000000001',
              fecha: '18/09/2026',
              hora: '10:15',
              cajero: 'Ana',
              lineas: [
                { orden: 0, producto: 'Maíz blanco', cantidad: '10', unidad: 'lb', precioUnitario: '4.68', subtotal: '46.83' },
                {
                  orden: 1,
                  producto: '[Ejemplo] Frijol negro quebrado de primera calidad',
                  cantidad: '1.777',
                  unidad: 'lb',
                  precioUnitario: '3.08',
                  subtotal: '5.47',
                },
              ],
              subtotal: '72.37',
              descuento: descuento.valor,
              total: '52.30',
              formaPago: pago.formaPago,
              numBoleta: pago.numBoleta,
              reimpresion,
              anulacion: anulada
                ? {
                    fecha: '18/09/2026',
                    hora: '11:02',
                    autorizadaPor: AUTORIZO_LA_ANULACION,
                    motivo: 'el cliente devolvió el producto',
                  }
                : null,
            },
          });
        }
      }
    }
  }
  return casos;
}

const renglones = (texto: string): string[] => texto.split('\n');

/** Dónde termina la leyenda de proforma: el encabezado de la copia va justo debajo. */
function renglonDeLaLeyenda(lineas: readonly string[]): number {
  const indice = lineas.findIndex((linea) => linea.trim() === LEYENDA_NO_FISCAL);
  expect(indice, 'el recibo no tiene la leyenda de proforma').toBeGreaterThan(0);
  return indice;
}

/**
 * Los renglones que la copia del cliente puede NO tener. Nada más.
 * «Autorizó: » (quién autorizó la ANULACIÓN) se sumó el 2026-09-18, por la
 * decisión de Julio sobre la pregunta 1 de la spec.
 */
const esRenglonReservado = (linea: string): boolean =>
  linea.startsWith('Autorizado por: ') || /^Boleta +\S+$/.test(linea) || linea.startsWith('Autorizó: ');

// ===========================================================================
describe('Qué lleva cada copia (spec 001, §3)', () => {
  it('la tabla QUE_LLEVA_CADA_DESTINO: la pantalla y la tienda llevan los tres datos reservados; el cliente, NINGUNO', () => {
    expect(QUE_LLEVA_CADA_DESTINO).toEqual({
      pantalla: { encabezado: [], autorizacionDelDescuento: true, boleta: true, autorizacionDeLaAnulacion: true },
      tienda: {
        encabezado: ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA,
        autorizacionDelDescuento: true,
        boleta: true,
        autorizacionDeLaAnulacion: true,
      },
      cliente: {
        encabezado: ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE,
        autorizacionDelDescuento: false,
        boleta: false,
        autorizacionDeLaAnulacion: false,
      },
    });
  });

  it('salen DOS copias, primero la del CLIENTE y después la de la TIENDA', () => {
    expect(COPIAS_QUE_SE_IMPRIMEN).toEqual(['cliente', 'tienda']);
    const primero = grilla()[0];
    if (primero === undefined) {
      throw new Error('la grilla está vacía');
    }
    const { modelo } = primero;
    expect(textosDeLasCopias(modelo)).toEqual([
      reciboComoTexto(modelo, 'cliente'),
      reciboComoTexto(modelo, 'tienda'),
    ]);
  });

  it('los encabezados son los del spec, solo ASCII, entran en 48 columnas y no se confunden entre sí', () => {
    expect(ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE).toEqual(['COPIA DEL CLIENTE']);
    expect(ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA).toEqual([
      'COPIA DE LA TIENDA',
      'Control interno. No se entrega al cliente.',
    ]);
    for (const renglon of [...ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE, ...ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA]) {
      expect(renglon.length).toBeLessThanOrEqual(COLUMNAS_80MM);
      // Solo ASCII imprimible: sale igual en cualquier página de códigos.
      expect(renglon).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE[0]).not.toBe(ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA[0]);
  });
});

// ===========================================================================
describe('Las copias comparadas renglón por renglón, en los 24 recibos de la grilla', () => {
  const casos = grilla();

  it('la grilla tiene los 24 recibos', () => {
    expect(casos).toHaveLength(24);
  });

  it.each(casos)(
    'LA DE LA TIENDA es la de pantalla con su encabezado debajo de la leyenda, y nada más: $nombre',
    ({ modelo }) => {
      const pantalla = renglones(reciboComoTexto(modelo, 'pantalla'));
      const tienda = renglones(reciboComoTexto(modelo, 'tienda'));
      const leyenda = renglonDeLaLeyenda(pantalla);
      const alto = ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA.length;

      expect(tienda.slice(0, leyenda + 1)).toEqual(pantalla.slice(0, leyenda + 1));
      expect(tienda.slice(leyenda + 1, leyenda + 1 + alto).map((linea) => linea.trim())).toEqual(
        ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA,
      );
      expect(tienda.slice(leyenda + 1 + alto)).toEqual(pantalla.slice(leyenda + 1));
    },
  );

  it.each(casos)(
    'LA DEL CLIENTE difiere de la de la tienda EXACTAMENTE en el encabezado, los dos autorizantes y la boleta: $nombre',
    ({ modelo }) => {
      const tienda = renglones(reciboComoTexto(modelo, 'tienda'));
      const cliente = renglones(reciboComoTexto(modelo, 'cliente'));
      const leyenda = renglonDeLaLeyenda(tienda);
      const altoTienda = ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA.length;
      const altoCliente = ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE.length;

      // Hasta la leyenda, idénticas.
      expect(cliente.slice(0, leyenda + 1)).toEqual(tienda.slice(0, leyenda + 1));
      // Su propio encabezado.
      expect(cliente.slice(leyenda + 1, leyenda + 1 + altoCliente).map((linea) => linea.trim())).toEqual(
        ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE,
      );
      // Y el resto: el de la tienda MENOS los renglones reservados, en el mismo orden.
      const restoDeLaTienda = tienda.slice(leyenda + 1 + altoTienda);
      const reservados = restoDeLaTienda.filter(esRenglonReservado);
      expect(cliente.slice(leyenda + 1 + altoCliente)).toEqual(
        restoDeLaTienda.filter((linea) => !esRenglonReservado(linea)),
      );
      // Los que se quitaron son exactamente los que el modelo tiene: ni uno más.
      const esperados = [
        ...(modelo.anulacion === null ? [] : [`Autorizó: ${modelo.anulacion.autorizadaPor}`]),
        ...(modelo.descuento?.autorizadoPor ? [`Autorizado por: ${modelo.descuento.autorizadoPor}`] : []),
        ...(modelo.numBoleta === null ? [] : [expect.stringMatching(new RegExp(`^Boleta +${modelo.numBoleta}$`))]),
      ];
      expect(reservados).toEqual(esperados);
    },
  );

  it.each(casos)(
    'en LA DEL CLIENTE no aparece, en NINGÚN renglón, ni quién autorizó el descuento, ni quién autorizó la anulación, ni el número de boleta: $nombre',
    ({ modelo }) => {
      const cliente = reciboComoTexto(modelo, 'cliente');
      expect(cliente).not.toContain(AUTORIZO_EL_DESCUENTO);
      expect(cliente).not.toContain(AUTORIZO_LA_ANULACION);
      expect(cliente).not.toContain('Autorizó');
      expect(cliente).not.toContain('Autorizado por');
      expect(cliente).not.toContain(VOUCHER);
      expect(cliente).not.toContain('Boleta');
    },
  );

  it.each(casos)(
    'LA DEL CLIENTE SÍ lleva todo lo demás —cajero, líneas, descuento, total, forma de pago, reimpresión y anulación—: $nombre',
    ({ modelo }) => {
      const cliente = reciboComoTexto(modelo, 'cliente');
      expect(cliente).toMatch(/^Cajero +Ana$/m);
      expect(cliente).toMatch(/^Recibo No\. +128$/m);
      for (const linea of modelo.lineas) {
        expect(cliente).toContain(`${linea.cantidad} ${linea.unidad} x ${linea.precioUnitario}`);
        expect(cliente).toContain(linea.subtotal);
      }
      expect(cliente).toMatch(/^TOTAL +52\.30$/m);
      expect(cliente).toMatch(new RegExp(`^Forma de pago +${modelo.formaPago === 'efectivo' ? 'Efectivo' : 'Tarjeta'}$`, 'm'));
      if (modelo.descuento !== null) {
        expect(cliente).toContain('Precios e importes ya incluyen el descuento.');
        expect(cliente).toMatch(new RegExp(`^Descuento ${modelo.descuento.descripcion} +-${modelo.descuento.rebaja}$`, 'm'));
      }
      expect(cliente.includes('** REIMPRESIÓN **')).toBe(modelo.reimpresion);
      if (modelo.anulacion !== null) {
        /*
          ESTA PRUEBA CAMBIÓ EL 2026-09-18 (spec 001, pregunta 1), Y NO SE BORRÓ.
          Antes decía: «LA MARCA DE ANULADA SALE ENTERA, con quién autorizó la
          anulación», y exigía `Autorizó: Jimmy` en la copia del cliente, porque
          el pedido original ocultaba «específicamente» el autorizante del
          descuento y la boleta. Julio decidió ocultar también el de la
          anulación, con el mismo criterio. La MARCA sigue: el cliente tiene que
          saber que la venta se anuló, cuándo y por qué.
        */
        expect(cliente).toContain('** VENTA ANULADA **');
        expect(cliente).toContain(`Anulada: ${modelo.anulacion.fecha} ${modelo.anulacion.hora}`);
        expect(cliente).toContain('Motivo: el cliente devolvió el producto');
        expect(cliente).not.toContain('Autorizó:');
        // Y la de la tienda sí lo lleva.
        expect(reciboComoTexto(modelo, 'tienda')).toContain(`Autorizó: ${AUTORIZO_LA_ANULACION}`);
      }
    },
  );

  it.each(
    casos.filter(
      ({ modelo }) =>
        (modelo.descuento?.autorizadoPor ?? null) === null && modelo.numBoleta === null && modelo.anulacion === null,
    ),
  )(
    'sin autorizantes, sin boleta y sin anular, las dos copias difieren SOLO en el encabezado: $nombre',
    ({ modelo }) => {
      const sinEncabezado = (destino: 'cliente' | 'tienda'): string[] => {
        const encabezado = QUE_LLEVA_CADA_DESTINO[destino].encabezado;
        return renglones(reciboComoTexto(modelo, destino)).filter((linea) => !encabezado.includes(linea.trim()));
      };
      expect(sinEncabezado('cliente')).toEqual(sinEncabezado('tienda'));
    },
  );

  it.each(casos)('ningún renglón de ninguna versión pasa de 48 columnas: $nombre', ({ modelo }) => {
    for (const destino of DESTINOS) {
      for (const linea of renglones(reciboComoTexto(modelo, destino))) {
        expect(linea.length, `${destino}: «${linea}»`).toBeLessThanOrEqual(COLUMNAS_80MM);
      }
    }
  });

  it.each(casos)('la versión de PANTALLA no lleva ningún encabezado de copia: $nombre', ({ modelo }) => {
    const pantalla = reciboComoTexto(modelo, 'pantalla');
    expect(pantalla).not.toContain('COPIA DEL CLIENTE');
    expect(pantalla).not.toContain('COPIA DE LA TIENDA');
  });
});

// ===========================================================================
describe('Las dos copias del ejemplo de la spec (§4.3), tal cual salen', () => {
  /*
    La venta del ejemplo: 10 lb de maíz a Q6.69, 30 % de descuento que pasa el
    tope del rol y autorizó Jimmy, pagada con tarjeta, con los datos del negocio
    sin cargar. Es la misma que cobra el arnés en la aplicación real. Si el
    papel cambia, esta prueba lo muestra con un diff renglón por renglón.
  */
  const ejemplo: ModeloDeRecibo = {
    negocio: {
      nombreComercial: '[Nombre del negocio]',
      direccion: '[Dirección]',
      telefono: '[Teléfono]',
      nit: '[NIT]',
      sinConfigurar: true,
    },
    numeroRecibo: 1,
    ventaId: 'e4b5c6d7-0000-4000-8000-000000000002',
    fecha: '18/09/2026',
    hora: '10:15',
    cajero: 'Ana',
    lineas: [{ orden: 0, producto: 'Maíz blanco', cantidad: '10', unidad: 'lb', precioUnitario: '4.68', subtotal: '46.83' }],
    subtotal: '66.90',
    descuento: { tipo: 'porcentaje', valor: '30.00', descripcion: '30 %', rebaja: '20.07', autorizadoPor: 'Jimmy' },
    total: '46.83',
    formaPago: 'tarjeta',
    numBoleta: VOUCHER,
    reimpresion: false,
    anulacion: null,
  };

  it('LA COPIA DEL CLIENTE, renglón por renglón', () => {
    expect(renglones(reciboComoTexto(ejemplo, 'cliente'))).toEqual([
      '              [Nombre del negocio]',
      '                  [Dirección]',
      '                Tel. [Teléfono]',
      '                   NIT [NIT]',
      '',
      '                RECIBO DE VENTA',
      '    Proforma, no válido como factura fiscal',
      '               COPIA DEL CLIENTE',
      '------------------------------------------------',
      'Recibo No.                                     1',
      'Fecha                           18/09/2026 10:15',
      'Cajero                                       Ana',
      '------------------------------------------------',
      'Maíz blanco',
      '  10 lb x 4.68                             46.83',
      '------------------------------------------------',
      '  Precios e importes ya incluyen el descuento.',
      'Descuento 30 %                            -20.07',
      'TOTAL                                      46.83',
      '',
      'Forma de pago                            Tarjeta',
      '',
      '            ¡Gracias por su compra!',
    ]);
  });

  it('LA COPIA DE LA TIENDA, renglón por renglón', () => {
    expect(renglones(reciboComoTexto(ejemplo, 'tienda'))).toEqual([
      '              [Nombre del negocio]',
      '                  [Dirección]',
      '                Tel. [Teléfono]',
      '                   NIT [NIT]',
      '',
      '                RECIBO DE VENTA',
      '    Proforma, no válido como factura fiscal',
      '               COPIA DE LA TIENDA',
      '   Control interno. No se entrega al cliente.',
      '------------------------------------------------',
      'Recibo No.                                     1',
      'Fecha                           18/09/2026 10:15',
      'Cajero                                       Ana',
      '------------------------------------------------',
      'Maíz blanco',
      '  10 lb x 4.68                             46.83',
      '------------------------------------------------',
      '  Precios e importes ya incluyen el descuento.',
      'Descuento 30 %                            -20.07',
      'Autorizado por: Jimmy',
      'TOTAL                                      46.83',
      '',
      'Forma de pago                            Tarjeta',
      'Boleta                                    004512',
      '',
      '            ¡Gracias por su compra!',
    ]);
  });
});

// ===========================================================================
describe('Quién autorizó la anulación, con un nombre que no entra en un renglón (spec 001, pregunta 1)', () => {
  const NOMBRE_LARGO = 'María Fernanda de los Ángeles Castañeda Villagrán';

  function anuladaCon(autorizadaPor: string): ModeloDeRecibo {
    const primero = grilla().find(({ modelo }) => modelo.anulacion !== null);
    if (primero?.modelo.anulacion == null) {
      throw new Error('la grilla no tiene ningún recibo anulado');
    }
    return { ...primero.modelo, anulacion: { ...primero.modelo.anulacion, autorizadaPor } };
  }

  it('el control: en la TIENDA el nombre largo ocupa MÁS DE UN renglón', () => {
    const tienda = renglones(reciboComoTexto(anuladaCon(NOMBRE_LARGO), 'tienda'));
    const inicio = tienda.findIndex((linea) => linea.startsWith('Autorizó: '));
    const motivo = tienda.findIndex((linea) => linea.startsWith('Motivo: '));
    expect(inicio).toBeGreaterThan(0);
    // Sin este control, la prueba de abajo pasaría igual con un nombre corto.
    expect(motivo - inicio).toBeGreaterThan(1);
  });

  it('en la del CLIENTE no queda NINGÚN pedazo del nombre: se omite el bloque entero, con sus renglones de continuación', () => {
    const modelo = anuladaCon(NOMBRE_LARGO);
    const cliente = reciboComoTexto(modelo, 'cliente');
    for (const palabra of NOMBRE_LARGO.split(' ').filter((p) => p.length > 3)) {
      expect(cliente, palabra).not.toContain(palabra);
    }
    // La tienda, en cambio, lo lleva: el ANTES y el DESPUÉS del bloque son iguales en las dos.
    const tienda = renglones(reciboComoTexto(modelo, 'tienda'));
    const inicio = tienda.findIndex((linea) => linea.startsWith('Autorizó: '));
    const motivo = tienda.findIndex((linea) => linea.startsWith('Motivo: '));
    const bloque = tienda.slice(inicio, motivo);
    expect(bloque.join(' ').replace(/\s+/g, ' ')).toBe(`Autorizó: ${NOMBRE_LARGO}`);
    const clienteRenglones = renglones(cliente);
    const altoTienda = ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA.length;
    const altoCliente = ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE.length;
    const sinElBloque = [...tienda.slice(0, inicio), ...tienda.slice(motivo)];
    const leyenda = renglonDeLaLeyenda(tienda);
    expect(clienteRenglones.slice(leyenda + 1 + altoCliente)).toEqual(sinElBloque.slice(leyenda + 1 + altoTienda));
  });
});
