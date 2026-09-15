/**
 * La impresora de la terminal: lista, guarda, prueba y quita (§4.43).
 *
 * TODO CORRE SIN HARDWARE. Las impresoras son las simuladas del arnés y el
 * envío escribe los bytes en un archivo. Lo que estas pruebas NO pueden decir
 * —y ninguna prueba en esta Mac puede— es si el ticket sale legible en la
 * térmica de Jimmy. Para eso existe la confirmación humana, y eso también se
 * prueba acá: que se pida, que se guarde y que la respuesta «ilegible» quede
 * como señal distinta de un fallo de conexión.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generarHashDePin } from '@shared/auth';
import { crearRepositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ErrorDeNegocio } from '@main/database/errores';
import type { LogTecnico, OrigenTecnico } from '@main/log-tecnico';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import {
  ARCHIVO_DE_IMPRESORA,
  ImpresoraSegunElArchivo,
  describirImpresora,
  leerArchivoDeImpresora,
} from '@main/adapters/impresora-configurada';
import type { EnviadorRaw, ResultadoDelEnvioRaw } from '@main/adapters/cola-de-windows';
import {
  EnviadorSimulado,
  IMPRESORA_SIMULADA_DESCONECTADA,
  IMPRESORA_SIMULADA_QUE_RECIBE,
  impresorasSimuladas,
} from '@main/adapters/impresoras-simuladas';
import { ServicioDeImpresora, type ImpresoraListada } from '../servicio-de-impresora';

/** Bitácora que guarda las líneas, para leer qué se anotó. */
class LogQueGuarda implements LogTecnico {
  public readonly lineas: string[] = [];
  public registrar(origen: OrigenTecnico, mensaje: string): void {
    this.lineas.push(`[${origen}] ${mensaje}`);
  }
}

/** Un enviador que cuenta cuántas veces se le pidió algo. */
class EnviadorQueCuenta implements EnviadorRaw {
  public envios = 0;
  public constructor(private readonly interno: EnviadorRaw) {}
  public enviar(nombre: string, bytes: Uint8Array): Promise<ResultadoDelEnvioRaw> {
    this.envios += 1;
    return this.interno.enviar(nombre, bytes);
  }
}

let carpeta: string;
let log: LogQueGuarda;

function servicio(opciones: { listar?: () => Promise<readonly ImpresoraListada[]>; enviador?: EnviadorRaw } = {}): ServicioDeImpresora {
  return new ServicioDeImpresora({
    carpetaDeDatos: carpeta,
    listar: opciones.listar ?? ((): Promise<readonly ImpresoraListada[]> => Promise.resolve(impresorasSimuladas())),
    enviador: opciones.enviador ?? new EnviadorSimulado(carpeta),
    log,
    ahora: (): Date => new Date('2026-09-15T12:00:00.000Z'),
  });
}

function archivoCrudo(): unknown {
  return JSON.parse(readFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), 'utf8')) as unknown;
}

function codigoDelError(accion: () => unknown): string | null {
  try {
    accion();
    return null;
  } catch (error) {
    return error instanceof ErrorDeNegocio ? error.codigo : `no es de negocio: ${String(error)}`;
  }
}

async function codigoDelErrorAsincrono(accion: () => Promise<unknown>): Promise<string | null> {
  try {
    await accion();
    return null;
  } catch (error) {
    return error instanceof ErrorDeNegocio ? error.codigo : `no es de negocio: ${String(error)}`;
  }
}

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), 'pos-impresora-'));
  log = new LogQueGuarda();
});

afterEach(() => {
  rmSync(carpeta, { recursive: true, force: true });
});

// ===========================================================================
describe('El estado se dice con palabras, nunca con el nombre de una clase', () => {
  it('sin impresora.json: «Sin impresora configurada — los recibos solo se generan en PDF»', () => {
    const estado = servicio().estado();
    expect(estado.tipo).toBe('ninguna');
    expect(estado.descripcion).toBe('Sin impresora configurada — los recibos solo se generan en PDF');
    expect(estado.descripcion).not.toContain('NullPrinterProvider');
  });

  it('con una impresora: «Impresora configurada: [nombre]»', () => {
    writeFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), JSON.stringify({ impresora: 'POS-80' }));
    expect(servicio().estado().descripcion).toBe('Impresora configurada: POS-80');
  });

  it('ninguna de las tres descripciones nombra una clase del código', () => {
    for (const impresora of [
      { tipo: 'ninguna' as const },
      { tipo: 'cola' as const, nombre: 'X' },
      { tipo: 'ruta' as const, dispositivo: '\\\\equipo\\TERMICA' },
    ]) {
      expect(describirImpresora(impresora)).not.toMatch(/Provider|Impresora[A-Z]/u);
    }
  });
});

// ===========================================================================
describe('impresora.json: el formato nuevo y el viejo', () => {
  it('el formato VIEJO ({ dispositivo }) se sigue LEYENDO, como «ruta»', () => {
    writeFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), JSON.stringify({ dispositivo: '\\\\equipo\\TERMICA' }));
    expect(leerArchivoDeImpresora(carpeta).impresora).toEqual({ tipo: 'ruta', dispositivo: '\\\\equipo\\TERMICA' });
    expect(servicio().estado().descripcion).toContain('formato anterior');
  });

  it('si el archivo trae las dos claves, manda la nueva', () => {
    writeFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), JSON.stringify({ impresora: 'POS-80', dispositivo: 'vieja' }));
    expect(leerArchivoDeImpresora(carpeta).impresora).toEqual({ tipo: 'cola', nombre: 'POS-80' });
  });

  it('un archivo ROTO no rompe nada: se lee como «sin impresora» y queda anotado', () => {
    writeFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), '{ esto no es json');
    const leido = leerArchivoDeImpresora(carpeta, log);
    expect(leido.impresora.tipo).toBe('ninguna');
    expect(log.lineas.join('\n')).toContain('No se pudo leer');
  });

  it('una última prueba con valores inventados se ignora en vez de mostrarse', () => {
    writeFileSync(
      join(carpeta, ARCHIVO_DE_IMPRESORA),
      JSON.stringify({ impresora: 'X', ultimaPrueba: { impresora: 'X', fecha: 'hoy', envio: 'magia', confirmacion: null } }),
    );
    expect(leerArchivoDeImpresora(carpeta).ultimaPrueba).toBeNull();
  });
});

// ===========================================================================
describe('Listar sin hardware', () => {
  it('devuelve las impresoras del sistema con su nombre y el nombre para mostrar', async () => {
    const lista = await servicio().listar();
    expect(lista.map((i) => i.nombre)).toEqual([IMPRESORA_SIMULADA_QUE_RECIBE, IMPRESORA_SIMULADA_DESCONECTADA]);
    expect(lista[0]?.nombreVisible).toBe('Térmica simulada (arnés)');
  });

  it('si displayName viene vacío, se muestra el nombre', async () => {
    const lista = await servicio({ listar: () => Promise.resolve([{ name: 'EPSON_L3560', displayName: '  ', description: '' }]) }).listar();
    expect(lista[0]?.nombreVisible).toBe('EPSON_L3560');
  });

  it('una lista vacía es una respuesta válida, no un error', async () => {
    expect(await servicio({ listar: () => Promise.resolve([]) }).listar()).toEqual([]);
  });

  it('si el sistema no contesta, falla con un mensaje claro y queda en la bitácora', async () => {
    const s = servicio({ listar: () => Promise.reject(new Error('CUPS caído')) });
    expect(await codigoDelErrorAsincrono(() => s.listar())).toBe('IMPRESORAS_NO_LISTADAS');
    expect(log.lineas.join('\n')).toContain('CUPS caído');
  });
});

// ===========================================================================
describe('Guardar persiste en impresora.json y sobrevive a un reinicio', () => {
  it('guarda el NOMBRE en impresora.json, con la clave nueva', async () => {
    const estado = await servicio().guardar(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(estado.descripcion).toBe(`Impresora configurada: ${IMPRESORA_SIMULADA_QUE_RECIBE}`);
    expect(archivoCrudo()).toEqual({ impresora: IMPRESORA_SIMULADA_QUE_RECIBE });
  });

  it('UN SERVICIO NUEVO (la aplicación reiniciada) lee la misma impresora', async () => {
    await servicio().guardar(IMPRESORA_SIMULADA_QUE_RECIBE);
    const despuesDelReinicio = servicio();
    expect(despuesDelReinicio.estado()).toMatchObject({ tipo: 'cola', nombre: IMPRESORA_SIMULADA_QUE_RECIBE });
  });

  it('guardar sobre el formato viejo lo REEMPLAZA: ya no queda la clave dispositivo', async () => {
    writeFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), JSON.stringify({ dispositivo: '\\\\.\\USB001' }));
    await servicio().guardar(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(archivoCrudo()).toEqual({ impresora: IMPRESORA_SIMULADA_QUE_RECIBE });
  });

  it('una impresora que NO está en la lista del sistema se rechaza y el archivo no se toca', async () => {
    const s = servicio();
    expect(await codigoDelErrorAsincrono(() => s.guardar('Inventada'))).toBe('IMPRESORA_NO_INSTALADA');
    expect(existsSync(join(carpeta, ARCHIVO_DE_IMPRESORA))).toBe(false);
  });

  it('no queda ningún temporal .tmp al lado del archivo', async () => {
    await servicio().guardar(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(existsSync(join(carpeta, `${ARCHIVO_DE_IMPRESORA}.tmp`))).toBe(false);
  });
});

// ===========================================================================
describe('El ticket de prueba nunca falla en silencio', () => {
  it('SIN impresora (un nombre que el sistema no tiene): «No se encontró la impresora», sin pedir confirmación', async () => {
    const resultado = await servicio().imprimirPrueba('No-existe');
    expect(resultado.clase).toBe('no_encontrada');
    expect(resultado.titulo).toBe('No se encontró la impresora');
    expect(resultado.mensaje).toContain('Volvé a buscar');
    expect(resultado.pruebaId).toBeNull();
  });

  it('la impresora desconectada: «reporta un problema», sin pedir confirmación', async () => {
    const resultado = await servicio().imprimirPrueba(IMPRESORA_SIMULADA_DESCONECTADA);
    expect(resultado.clase).toBe('trabajo_con_error');
    expect(resultado.mensaje).toContain('Offline');
    expect(resultado.pruebaId).toBeNull();
  });

  it('un enviador que LANZA se informa como «entorno», y el servicio no lanza', async () => {
    const roto: EnviadorRaw = { enviar: () => Promise.reject(new Error('reventó')) };
    const resultado = await servicio({ enviador: roto }).imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(resultado.clase).toBe('entorno');
    expect(resultado.detalle).toContain('reventó');
  });

  it('la que recibe: «enviado», con un id para confirmar, y los bytes son ESC/POS con inicio y corte', async () => {
    const resultado = await servicio().imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(resultado.clase).toBe('enviado');
    expect(resultado.pruebaId).toMatch(/^[0-9a-f-]{36}$/u);

    const bytes = readFileSync(join(carpeta, `${IMPRESORA_SIMULADA_QUE_RECIBE}.bin`));
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(bytes.toString('latin1')).toContain('TICKET DE PRUEBA');
  });

  it('cada prueba queda anotada en impresora.json, sin confirmar todavía', async () => {
    await servicio().imprimirPrueba(IMPRESORA_SIMULADA_DESCONECTADA);
    expect(leerArchivoDeImpresora(carpeta).ultimaPrueba).toEqual({
      impresora: IMPRESORA_SIMULADA_DESCONECTADA,
      fecha: '2026-09-15T12:00:00.000Z',
      envio: 'trabajo_con_error',
      confirmacion: null,
    });
  });

  it('probar NO configura la impresora: sigue sin impresora hasta que alguien la guarde', async () => {
    const s = servicio();
    await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(s.estado().tipo).toBe('ninguna');
  });
});

// ===========================================================================
describe('La confirmación de la persona', () => {
  it('«salió bien» se guarda y se contesta que quedó probada', async () => {
    const s = servicio();
    const { pruebaId } = await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    const respuesta = s.confirmarPrueba(pruebaId ?? '', 'bien');
    expect(respuesta.mensaje).toContain('quedó probada');
    expect(respuesta.estado.ultimaPrueba?.confirmacion).toBe('bien');
  });

  it('«símbolos raros o sin cortar» queda como SEÑAL de compatibilidad ESC/POS, NO como fallo de conexión', async () => {
    const s = servicio();
    const { pruebaId } = await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    const respuesta = s.confirmarPrueba(pruebaId ?? '', 'ilegible');

    expect(respuesta.mensaje).toContain('no es un problema de conexión');
    expect(respuesta.mensaje).toContain('ESC/POS');
    // En el archivo: el envío fue exitoso y la persona dijo que salió mal.
    expect(leerArchivoDeImpresora(carpeta).ultimaPrueba).toMatchObject({ envio: 'enviado', confirmacion: 'ilegible' });
    expect(log.lineas.join('\n')).toContain('SEÑAL: el modelo podría no ser compatible');
  });

  it('«no salió nada» se guarda y el mensaje sugiere revisar papel y encendido', async () => {
    const s = servicio();
    const { pruebaId } = await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(s.confirmarPrueba(pruebaId ?? '', 'nada').mensaje).toContain('papel');
  });

  it('una confirmación se usa una sola vez: la segunda se rechaza con PRUEBA_NO_VIGENTE', async () => {
    const s = servicio();
    const { pruebaId } = await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    s.confirmarPrueba(pruebaId ?? '', 'bien');
    expect(codigoDelError(() => s.confirmarPrueba(pruebaId ?? '', 'nada'))).toBe('PRUEBA_NO_VIGENTE');
  });

  it('una prueba que no salió no se puede confirmar, ni con un id inventado', async () => {
    const s = servicio();
    await s.imprimirPrueba(IMPRESORA_SIMULADA_DESCONECTADA);
    expect(codigoDelError(() => s.confirmarPrueba('00000000-0000-4000-8000-000000000000', 'bien'))).toBe('PRUEBA_NO_VIGENTE');
  });

  it('una prueba nueva deja sin valor la anterior sin contestar', async () => {
    const s = servicio();
    const primera = await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(codigoDelError(() => s.confirmarPrueba(primera.pruebaId ?? '', 'bien'))).toBe('PRUEBA_NO_VIGENTE');
  });
});

// ===========================================================================
describe('TODA respuesta del servicio cruza el puente IPC (structuredClone)', () => {
  it('estado, lista, guardar, las cuatro clases de prueba, confirmar y quitar', async () => {
    const s = servicio();
    const respuestas: unknown[] = [];
    respuestas.push(s.estado());
    respuestas.push(await s.listar());
    respuestas.push(await s.guardar(IMPRESORA_SIMULADA_QUE_RECIBE));
    respuestas.push(await s.imprimirPrueba('No-existe'));
    respuestas.push(await s.imprimirPrueba(IMPRESORA_SIMULADA_DESCONECTADA));
    respuestas.push(await servicio({ enviador: { enviar: () => Promise.reject(new Error('x')) } }).imprimirPrueba('x'));
    const enviada = await s.imprimirPrueba(IMPRESORA_SIMULADA_QUE_RECIBE);
    respuestas.push(enviada);
    respuestas.push(s.confirmarPrueba(enviada.pruebaId ?? '', 'ilegible'));
    respuestas.push(s.estado());
    respuestas.push(s.quitar());

    for (const respuesta of respuestas) {
      expect(() => structuredClone(respuesta)).not.toThrow();
      expect(structuredClone(respuesta)).toEqual(respuesta);
    }
  });

  it('control: un objeto con una función adentro SÍ falla, así que la prueba de arriba mide algo', () => {
    expect(() => structuredClone({ estado: (): void => undefined })).toThrow();
  });
});

// ===========================================================================
describe('Quitar la impresora vuelve a «solo PDF» y los recibos se siguen emitiendo', () => {
  it('quitar sin prueba previa BORRA impresora.json', async () => {
    const s = servicio();
    await s.guardar(IMPRESORA_SIMULADA_QUE_RECIBE);
    expect(s.quitar().descripcion).toBe('Sin impresora configurada — los recibos solo se generan en PDF');
    expect(existsSync(join(carpeta, ARCHIVO_DE_IMPRESORA))).toBe(false);
  });

  it('quitar conserva la última prueba, para el diagnóstico, pero sin impresora', async () => {
    const s = servicio();
    await s.guardar(IMPRESORA_SIMULADA_QUE_RECIBE);
    await s.imprimirPrueba(IMPRESORA_SIMULADA_DESCONECTADA);
    s.quitar();
    const crudo = archivoCrudo() as Record<string, unknown>;
    expect(crudo.impresora).toBeUndefined();
    expect(crudo.ultimaPrueba).toMatchObject({ envio: 'trabajo_con_error' });
  });

  it('CON UN SERVICIO DE RECIBOS REAL: imprime con impresora; al quitarla el PDF sigue y no se manda nada', async () => {
    const prueba = crearBaseMigrada();
    try {
      const base = prueba.base;
      const repos = crearRepositorios(base);
      const enviador = new EnviadorQueCuenta(new EnviadorSimulado(carpeta));
      const pdfs: string[] = [];
      const recibos = new ServicioDeRecibos({
        base,
        ventas: repos.ventas,
        ventaDetalle: repos.ventaDetalle,
        recibos: repos.recibos,
        usuarios: repos.usuarios,
        configuracion: repos.configuracionNegocio,
        impresora: new ImpresoraSegunElArchivo(carpeta, enviador, log),
        log,
        carpetaDeDatos: carpeta,
        generarPdf: (_html: string, ruta: string): Promise<void> => {
          pdfs.push(ruta);
          return Promise.resolve();
        },
      });
      const caja = new ServicioDeCaja({
        base,
        cajaSesiones: repos.cajaSesiones,
        denominaciones: repos.denominaciones,
        desglose: repos.desgloseDeCaja,
        ventas: repos.ventas,
        auditoria: repos.auditoria,
      });
      const venta = new ServicioDeVenta({
        base,
        ventas: repos.ventas,
        ventaDetalle: repos.ventaDetalle,
        productos: repos.productos,
        preciosEspeciales: repos.preciosEspeciales,
        limitesDescuento: repos.limitesDescuento,
        cajaSesiones: repos.cajaSesiones,
        auditoria: repos.auditoria,
      });
      const cajera = repos.usuarios.crear({ nombre: 'Ana', rol: 'venta', pinHash: generarHashDePin('1357') }).id;
      const categoriaId = repos.categorias.crear({ nombre: 'Granos', orden: 1 }).id;
      const maiz = repos.productos.crear({
        nombre: 'Maíz blanco',
        categoriaId,
        tipoMedida: 'peso',
        unidadPeso: 'lb',
        cantidadPredefinidaIcono: '1',
        precioBase: '6.69',
        inventarioDisponible: '100',
      }).id;
      caja.abrir(cajera, { modo: 'simple', monto: '500' });
      const vender = (): string =>
        venta.registrar(cajera, 'venta', {
          lineas: [{ productoId: maiz, cantidad: '1' }],
          descuento: null,
          formaPago: 'efectivo',
          numBoleta: null,
        }).venta.id;

      const s = servicio({ enviador });
      await s.guardar(IMPRESORA_SIMULADA_QUE_RECIBE);
      const conImpresora = await recibos.emitir(vender());
      expect(conImpresora.pdfGenerado).toBe(true);
      expect(conImpresora.impreso).toBe(true);
      expect(enviador.envios).toBe(1);
      expect(readFileSync(join(carpeta, `${IMPRESORA_SIMULADA_QUE_RECIBE}.bin`)).toString('latin1')).toContain('TOTAL');

      s.quitar();
      const sinImpresora = await recibos.emitir(vender());
      expect(sinImpresora.pdfGenerado).toBe(true);
      expect(sinImpresora.impreso).toBe(false);
      expect(sinImpresora.recibo.numeroRecibo).toBe(conImpresora.recibo.numeroRecibo + 1);
      expect(enviador.envios).toBe(1);
      expect(pdfs).toHaveLength(2);
    } finally {
      prueba.limpiar();
    }
  });

  it('con una impresora que se desinstaló, el recibo sale en PDF y la venta no se entera', async () => {
    writeFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), JSON.stringify({ impresora: 'Ya-no-esta' }));
    const impresora = new ImpresoraSegunElArchivo(carpeta, new EnviadorSimulado(carpeta), log);
    const resultado = await impresora.imprimirComprobante({
      idComprobante: 'r1',
      tipo: 'recibo',
      rutaPdf: join(carpeta, 'r1.pdf'),
      contenidoTexto: 'hola',
      copias: 1,
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain('PDF');
    expect(log.lineas.join('\n')).toContain('No se encontró la impresora');
  });

  it('el formato viejo sigue imprimiendo por la ruta, como antes (compatibilidad hacia atrás)', async () => {
    const destino = join(carpeta, 'dispositivo-viejo.bin');
    writeFileSync(join(carpeta, ARCHIVO_DE_IMPRESORA), JSON.stringify({ dispositivo: destino }));
    writeFileSync(destino, '');
    const impresora = new ImpresoraSegunElArchivo(carpeta, new EnviadorSimulado(carpeta), log);
    const resultado = await impresora.imprimirComprobante({
      idComprobante: 'r2',
      tipo: 'recibo',
      rutaPdf: join(carpeta, 'r2.pdf'),
      contenidoTexto: 'hola',
      copias: 1,
    });
    expect(resultado.ok).toBe(true);
    expect([...readFileSync(destino).subarray(0, 2)]).toEqual([0x1b, 0x40]);
  });
});
