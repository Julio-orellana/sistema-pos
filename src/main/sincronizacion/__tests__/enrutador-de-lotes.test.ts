/**
 * A qué función de la nube va cada lote.
 *
 * LA PREGUNTA QUE ESTE ARCHIVO CONTESTA: ¿puede un lote terminar llamando a la
 * función equivocada? Porque si puede, el síntoma no sería un error claro sino
 * una venta rechazada con un mensaje sobre una tabla que nadie mencionó.
 */

import { describe, expect, it } from 'vitest';

import type { CambioSincronizable } from '@shared/adapters';
import { elegirFuncionDelLote, LoteNoEnrutable } from '../enrutador-de-lotes';

/** Una fila del lote, con lo mínimo que el enrutador mira. */
function fila(
  tabla: string,
  datos: Readonly<Record<string, unknown>> = {},
): CambioSincronizable {
  return {
    tabla,
    idRegistro: `id-de-${tabla}`,
    operacion: 'insertar',
    datos: { id: `id-de-${tabla}`, ...datos },
    actualizadoEn: '2026-09-13T00:00:00.000Z',
  };
}

describe('Los cinco lotes van cada uno a SU función', () => {
  it('una venta va a sincronizar_venta', () => {
    const venta = [
      fila('productos'),
      fila('ventas'),
      fila('venta_detalle'),
      fila('auditoria_log'),
    ];

    expect(elegirFuncionDelLote(venta)).toBe('sincronizar_venta');
  });

  it('un alta de usuario va a sincronizar_usuario', () => {
    expect(elegirFuncionDelLote([fila('usuarios'), fila('auditoria_log')])).toBe(
      'sincronizar_usuario',
    );
  });

  it('una APERTURA de caja va a sincronizar_apertura_de_caja', () => {
    const apertura = [
      fila('caja_sesiones', { estado: 'abierta' }),
      fila('caja_sesion_denominaciones'),
      fila('auditoria_log'),
    ];

    expect(elegirFuncionDelLote(apertura)).toBe('sincronizar_apertura_de_caja');
  });

  it('un CIERRE de caja va a sincronizar_cierre_de_caja', () => {
    const cierre = [
      fila('caja_sesiones', { estado: 'cerrada' }),
      fila('caja_sesion_denominaciones'),
      fila('auditoria_log'),
    ];

    expect(elegirFuncionDelLote(cierre)).toBe('sincronizar_cierre_de_caja');
  });

  it('el catálogo, los topes, la configuración y un recibo van a sincronizar_lote_simple', () => {
    for (const tabla of [
      'categorias',
      'productos',
      'precios_especiales',
      'limites_descuento',
      'configuracion_negocio',
      'recibos',
    ]) {
      expect(elegirFuncionDelLote([fila(tabla), fila('auditoria_log')])).toBe(
        'sincronizar_lote_simple',
      );
    }
  });
});

describe('LA APERTURA Y EL CIERRE NO SE CONFUNDEN, que es el par peligroso', () => {
  /*
    Son las dos únicas funciones que reciben lotes con exactamente las mismas
    TABLAS. Lo único que las distingue es el `estado` de la fila de
    `caja_sesiones`. Si se confundieran, un cierre podría intentar «reabrir» una
    caja o una apertura toparse con la transición única que la 0023 exige.
  */
  const conEstado = (estado: string): CambioSincronizable[] => [
    fila('caja_sesiones', { estado }),
    fila('caja_sesion_denominaciones'),
    fila('auditoria_log'),
  ];

  it('una apertura NUNCA termina llamando a sincronizar_cierre_de_caja', () => {
    expect(elegirFuncionDelLote(conEstado('abierta'))).not.toBe('sincronizar_cierre_de_caja');
  });

  it('un cierre NUNCA termina llamando a sincronizar_apertura_de_caja', () => {
    expect(elegirFuncionDelLote(conEstado('cerrada'))).not.toBe('sincronizar_apertura_de_caja');
  });

  it('las dos tienen las MISMAS tablas: lo único que decide es el estado', () => {
    const tablasApertura = conEstado('abierta').map((f) => f.tabla);
    const tablasCierre = conEstado('cerrada').map((f) => f.tabla);

    expect(tablasApertura).toEqual(tablasCierre);
    expect(elegirFuncionDelLote(conEstado('abierta'))).not.toBe(
      elegirFuncionDelLote(conEstado('cerrada')),
    );
  });

  it('un estado que no es ni abierta ni cerrada se RECHAZA, no se adivina', () => {
    expect(() => elegirFuncionDelLote(conEstado('pendiente'))).toThrow(LoteNoEnrutable);
    expect(() => elegirFuncionDelLote(conEstado('pendiente'))).toThrow(/pendiente/);
  });

  it('una fila de caja SIN estado legible se rechaza', () => {
    const sinEstado = [fila('caja_sesiones'), fila('auditoria_log')];

    expect(() => elegirFuncionDelLote(sinEstado)).toThrow(/no se sabe si es una apertura/);
  });

  it('dos filas de caja_sesiones en el mismo lote se rechazan', () => {
    const dos = [
      fila('caja_sesiones', { estado: 'abierta' }),
      fila('caja_sesiones', { estado: 'cerrada' }),
    ];

    expect(() => elegirFuncionDelLote(dos)).toThrow(/2 filas de caja_sesiones/);
  });
});

describe('UN LOTE DE PUROS ASIENTOS tiene su propia función (la 0027)', () => {
  /*
    Las cinco funciones de la 0023 exigen una fila principal de negocio, y hay
    hechos que no la tienen: un ingreso fallido, un candado, una salida
    controlada. Sin la 0027, esos lotes iban a `sincronizar_lote_simple` y la
    nube los rechazaba con «FORMA: la tabla auditoria_log no se sincroniza como
    lote simple», **deteniendo la cola entera**. Medido, no supuesto.
  */
  it('un asiento suelto va a sincronizar_asiento', () => {
    expect(elegirFuncionDelLote([fila('auditoria_log')])).toBe('sincronizar_asiento');
  });

  it('varios asientos juntos, también', () => {
    const tres = [fila('auditoria_log'), fila('auditoria_log'), fila('auditoria_log')];

    expect(elegirFuncionDelLote(tres)).toBe('sincronizar_asiento');
  });

  it('NO va a sincronizar_lote_simple, que es donde iba y donde lo rechazaban', () => {
    expect(elegirFuncionDelLote([fila('auditoria_log')])).not.toBe('sincronizar_lote_simple');
  });

  it('un asiento CON su fila de negocio delante sigue yendo al lote simple', () => {
    // La 0027 es para los asientos SUELTOS. Un lote de catálogo no cambia.
    expect(elegirFuncionDelLote([fila('categorias'), fila('auditoria_log')])).toBe(
      'sincronizar_lote_simple',
    );
  });

  it('y uno con una venta delante sigue yendo a sincronizar_venta', () => {
    expect(elegirFuncionDelLote([fila('ventas'), fila('auditoria_log')])).toBe('sincronizar_venta');
  });
});

describe('NO SE ENRUTA POR LA PRIMERA TABLA, y este es el caso que lo prueba', () => {
  /*
    CLAUDE.md §4.20 lo dejó anotado para este día: una venta y un lote simple
    de catálogo EMPIEZAN LOS DOS por `productos`. Enrutar por la primera fila
    mandaría toda venta a `sincronizar_lote_simple`, que la rechazaría por
    nombre y detendría la cola por la razón equivocada.
  */
  it('una venta y un lote simple empiezan los dos por productos', () => {
    const venta = [fila('productos'), fila('ventas'), fila('auditoria_log')];
    const simple = [fila('productos'), fila('auditoria_log')];

    expect(venta[0]?.tabla).toBe('productos');
    expect(simple[0]?.tabla).toBe('productos');
  });

  it('y aun así van a funciones DISTINTAS: decide la presencia de ventas', () => {
    const venta = [fila('productos'), fila('ventas'), fila('auditoria_log')];
    const simple = [fila('productos'), fila('auditoria_log')];

    expect(elegirFuncionDelLote(venta)).toBe('sincronizar_venta');
    expect(elegirFuncionDelLote(simple)).toBe('sincronizar_lote_simple');
  });

  it('una venta con VARIAS filas de productos delante sigue yendo a sincronizar_venta', () => {
    const venta = [
      fila('productos'),
      fila('productos'),
      fila('productos'),
      fila('ventas'),
      fila('venta_detalle'),
      fila('auditoria_log'),
    ];

    expect(elegirFuncionDelLote(venta)).toBe('sincronizar_venta');
  });

  it('la fila de ventas al final del lote también decide: no importa la posición', () => {
    expect(elegirFuncionDelLote([fila('productos'), fila('auditoria_log'), fila('ventas')])).toBe(
      'sincronizar_venta',
    );
  });
});

describe('LA ANULACIÓN DE UNA VENTA va a su propia función (la 0035), y no se confunde con nada', () => {
  /*
    Una anulación trae `productos` y `auditoria_log`, igual que un lote simple,
    y NO trae `ventas`. Sin su tabla decisiva caería en
    `sincronizar_lote_simple`, que la rechazaría por nombre y detendría la cola
    (docs/ANULACION-DE-VENTA.md §7.5).
  */
  const anulacion = (): CambioSincronizable[] => [
    fila('anulaciones_de_venta'),
    fila('productos'),
    fila('productos'),
    fila('auditoria_log'),
  ];

  it('una anulación va a sincronizar_anulacion_de_venta', () => {
    expect(elegirFuncionDelLote(anulacion())).toBe('sincronizar_anulacion_de_venta');
  });

  it('una anulación y un lote simple comparten productos y auditoria_log: decide la PRESENCIA de anulaciones_de_venta', () => {
    const simple = [fila('productos'), fila('auditoria_log')];

    expect(elegirFuncionDelLote(simple)).toBe('sincronizar_lote_simple');
    expect(elegirFuncionDelLote(anulacion())).toBe('sincronizar_anulacion_de_venta');
  });

  it('PRUEBA CRUZADA: un lote de venta normal sigue yendo a sincronizar_venta, y nunca a la función de la anulación', () => {
    const venta = [fila('productos'), fila('productos'), fila('ventas'), fila('venta_detalle'), fila('auditoria_log')];

    expect(elegirFuncionDelLote(venta)).toBe('sincronizar_venta');
    expect(elegirFuncionDelLote(venta)).not.toBe('sincronizar_anulacion_de_venta');
  });

  it('la fila de la anulación decide en cualquier posición: no se enruta por la primera tabla', () => {
    expect(elegirFuncionDelLote([fila('productos'), fila('auditoria_log'), fila('anulaciones_de_venta')])).toBe(
      'sincronizar_anulacion_de_venta',
    );
  });

  it('una anulación mezclada con una venta se rechaza nombrando las dos: ninguna función la aceptaría', () => {
    const mezcla = [fila('anulaciones_de_venta'), fila('productos'), fila('ventas'), fila('auditoria_log')];

    expect(() => elegirFuncionDelLote(mezcla)).toThrow(LoteNoEnrutable);
    expect(() => elegirFuncionDelLote(mezcla)).toThrow(/anulaciones_de_venta/);
    expect(() => elegirFuncionDelLote(mezcla)).toThrow(/ventas/);
  });

  it('una anulación mezclada con un usuario o con una caja también se rechaza', () => {
    expect(() => elegirFuncionDelLote([fila('anulaciones_de_venta'), fila('usuarios')])).toThrow(/mezcla tablas/);
    expect(() =>
      elegirFuncionDelLote([fila('anulaciones_de_venta'), fila('caja_sesiones', { estado: 'abierta' })]),
    ).toThrow(/mezcla tablas/);
  });
});

describe('Ante un lote incoherente NO SE ADIVINA: se rechaza con el motivo', () => {
  it('un lote vacío se rechaza', () => {
    expect(() => elegirFuncionDelLote([])).toThrow(/no tiene ninguna fila/);
  });

  it('un lote que mezcla ventas y usuarios se rechaza nombrando las dos', () => {
    const mezcla = [fila('ventas'), fila('usuarios'), fila('auditoria_log')];

    expect(() => elegirFuncionDelLote(mezcla)).toThrow(/mezcla tablas/);
    expect(() => elegirFuncionDelLote(mezcla)).toThrow(/ventas/);
    expect(() => elegirFuncionDelLote(mezcla)).toThrow(/usuarios/);
  });

  it('un lote que mezcla una venta con una caja se rechaza', () => {
    const mezcla = [fila('ventas'), fila('caja_sesiones', { estado: 'abierta' })];

    expect(() => elegirFuncionDelLote(mezcla)).toThrow(/mezcla tablas/);
  });

  it('una tabla que NINGUNA función admite se rechaza acá, sin salir a la red', () => {
    const intrusa = [fila('sync_cola'), fila('auditoria_log')];

    expect(() => elegirFuncionDelLote(intrusa)).toThrow(/Ninguna función de la nube admite/);
    expect(() => elegirFuncionDelLote(intrusa)).toThrow(/sync_cola/);
  });

  it('el error es de una clase propia, para que quien llame lo trate distinto', () => {
    expect(() => elegirFuncionDelLote([])).toThrow(LoteNoEnrutable);
  });
});
