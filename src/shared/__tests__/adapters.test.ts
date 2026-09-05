/**
 * Pruebas de los adaptadores por defecto.
 *
 * Lo que se verifica aquí es una garantía de negocio, no un detalle técnico:
 * que el sistema pueda cerrar ventas sin impresora y trabajar sin Supabase.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIGURACION_ADAPTADORES_POR_DEFECTO,
  NullPrinterProvider,
  SimulatedSyncProvider,
  type CambioSincronizable,
  type ComprobanteImprimible,
  crearReceiptPrinterProvider,
  crearSyncProvider,
  leerConfiguracionAdaptadoresDelEntorno,
} from '../adapters';

const COMPROBANTE_DE_EJEMPLO: ComprobanteImprimible = {
  idComprobante: 'RCB-000001',
  tipo: 'recibo',
  rutaPdf: '/tmp/RCB-000001.pdf',
  copias: 1,
};

describe('Impresión: la venta nunca depende de que haya impresora', () => {
  it('el adaptador por defecto es el que no imprime nada', () => {
    expect(crearReceiptPrinterProvider()).toBeInstanceOf(NullPrinterProvider);
  });

  it('imprimir sin impresora responde ok y deja constancia de que fue omitido por diseño', async () => {
    const impresora = new NullPrinterProvider();
    const resultado = await impresora.imprimirComprobante(COMPROBANTE_DE_EJEMPLO);

    expect(resultado.ok).toBe(true);
    expect(resultado.omitidaPorDiseno).toBe(true);
    expect(resultado.mensaje).toContain('RCB-000001');
    expect(resultado.mensaje).toContain('.pdf');
  });

  it('reporta que no hay impresora disponible sin lanzar error', async () => {
    const estado = await new NullPrinterProvider().consultarEstado();
    expect(estado.disponible).toBe(false);
    expect(estado.adaptador).toBe('NullPrinterProvider');
  });

  it('pedir el adaptador ESC/POS todavía no rompe: cae al adaptador nulo', () => {
    const impresora = crearReceiptPrinterProvider({
      impresion: 'escpos',
      sincronizacion: 'simulado',
    });
    expect(impresora).toBeInstanceOf(NullPrinterProvider);
  });
});

describe('Sincronización: el desarrollo no consume cuota de Supabase', () => {
  let sincronizador: SimulatedSyncProvider;

  beforeEach(() => {
    sincronizador = new SimulatedSyncProvider();
  });

  it('el adaptador por defecto es el simulado', () => {
    expect(crearSyncProvider()).toBeInstanceOf(SimulatedSyncProvider);
    expect(CONFIGURACION_ADAPTADORES_POR_DEFECTO.sincronizacion).toBe('simulado');
  });

  it('empujar cambios los acepta todos y los deja registrados para inspección', async () => {
    const cambios: readonly CambioSincronizable[] = [
      {
        tabla: 'prueba_conexion',
        idRegistro: '1',
        operacion: 'insertar',
        datos: { descripcion: 'prueba' },
        actualizadoEn: '2026-01-01T00:00:00.000Z',
      },
    ];

    const resultado = await sincronizador.empujarCambios(cambios);

    expect(resultado.ok).toBe(true);
    expect(resultado.simulado).toBe(true);
    expect(resultado.cambiosAceptados).toBe(1);
    expect(resultado.cambiosRechazados).toBe(0);
    expect(sincronizador.obtenerCambiosEmpujados()).toHaveLength(1);
  });

  it('traer cambios no inventa datos remotos: devuelve una lista vacía', async () => {
    const DESDE = '2026-01-01T00:00:00.000Z';
    const resultado = await sincronizador.traerCambios(DESDE);

    expect(resultado.ok).toBe(true);
    expect(resultado.simulado).toBe(true);
    expect(resultado.cambios).toHaveLength(0);
    expect(resultado.sincronizadoHasta).toBe(DESDE);
  });

  it('la bitácora simulada se puede limpiar entre pruebas', async () => {
    await sincronizador.empujarCambios([
      {
        tabla: 'prueba_conexion',
        idRegistro: '2',
        operacion: 'actualizar',
        datos: {},
        actualizadoEn: '2026-01-01T00:00:00.000Z',
      },
    ]);
    sincronizador.limpiar();
    expect(sincronizador.obtenerCambiosEmpujados()).toHaveLength(0);
  });

  it('pedir el adaptador de Supabase todavía cae al simulado', () => {
    const proveedor = crearSyncProvider({ impresion: 'nulo', sincronizacion: 'supabase' });
    expect(proveedor).toBeInstanceOf(SimulatedSyncProvider);
  });
});

describe('Lectura de configuración desde el entorno', () => {
  it('un entorno vacío produce la configuración segura', () => {
    expect(leerConfiguracionAdaptadoresDelEntorno({})).toEqual({
      impresion: 'nulo',
      sincronizacion: 'simulado',
    });
  });

  it('un valor desconocido no habilita nada por accidente', () => {
    const configuracion = leerConfiguracionAdaptadoresDelEntorno({
      POS_PRINTER_PROVIDER: 'impresora-magica',
      POS_SYNC_PROVIDER: 'firebase',
    });
    expect(configuracion).toEqual({ impresion: 'nulo', sincronizacion: 'simulado' });
  });

  it('reconoce los valores válidos escritos exactamente', () => {
    const configuracion = leerConfiguracionAdaptadoresDelEntorno({
      POS_PRINTER_PROVIDER: 'escpos',
      POS_SYNC_PROVIDER: 'supabase',
    });
    expect(configuracion).toEqual({ impresion: 'escpos', sincronizacion: 'supabase' });
  });
});
