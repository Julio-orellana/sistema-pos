/**
 * Qué impresora usa ESTA terminal, y por qué no está en la base.
 *
 * LA CONFIGURACIÓN DE LA IMPRESORA NO ES DATO DE NEGOCIO. Es estado operativo
 * de una máquina: dos cajas podrían tener la térmica con nombres distintos, y
 * la de la caja A no significa nada en la caja B. Ponerla en
 * `configuracion_negocio` —que se espeja en Postgres— repetiría el error que el
 * proyecto ya evitó con `bloqueos_de_autorizacion` (§4.4). Por eso vive en un
 * archivo, `impresora.json`, al lado de la base.
 *
 * SIN ARCHIVO NO HAY IMPRESORA, y eso NO es un error: los recibos quedan en PDF.
 *
 * LOS DOS FORMATOS DEL ARCHIVO (§4.43):
 *
 * ```json
 * { "impresora": "POS-80" }            ← el actual: el NOMBRE de la impresora de Windows
 * { "dispositivo": "\\\\equipo\\TERMICA" }  ← el viejo: una ruta donde escribir bytes
 * ```
 *
 * El viejo se sigue LEYENDO por compatibilidad hacia atrás, pero la pantalla ya
 * no lo ofrece. Su ejemplo de siempre, `\\.\USB001`, probablemente nunca
 * funcionó: `USB001` es un puerto de la cola de impresión, no un dispositivo
 * que se abra como archivo (corrección del 2026-09-15, §4.14). Nunca se midió en
 * hardware real.
 *
 * El archivo guarda además `ultimaPrueba`: qué pasó con el último ticket de
 * prueba y qué contestó la persona. Sirve para diagnosticar después, sobre todo
 * la respuesta «salió con símbolos raros», que indica que el modelo podría no
 * entender los comandos ESC/POS que se mandan.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NullPrinterProvider,
  type ComprobanteImprimible,
  type EstadoImpresora,
  type ReceiptPrinterProvider,
  type ResultadoImpresion,
} from '@shared/adapters';
import {
  CLASES_DE_ENVIO_IPC,
  RESULTADOS_DE_CONFIRMACION_IPC,
  type UltimaPruebaDeImpresoraIpc,
} from '@shared/types/ipc';
import type { LogTecnico } from '@main/log-tecnico';
import { copiasComoEscPos } from '@main/domain/recibo/escpos';
import { EscPosPrinterProvider } from './escpos-printer';
import { clasificarEnvio, type EnviadorRaw } from './cola-de-windows';

/** Archivo que dice cuál es la impresora, dentro de `userData`. */
export const ARCHIVO_DE_IMPRESORA = 'impresora.json';

/** Lo que dice el archivo, ya interpretado. */
export type ImpresoraConfigurada =
  | { readonly tipo: 'ninguna' }
  | { readonly tipo: 'cola'; readonly nombre: string }
  | { readonly tipo: 'ruta'; readonly dispositivo: string };

export interface ArchivoDeImpresoraLeido {
  readonly impresora: ImpresoraConfigurada;
  readonly ultimaPrueba: UltimaPruebaDeImpresoraIpc | null;
}

const SIN_NADA: ArchivoDeImpresoraLeido = { impresora: { tipo: 'ninguna' }, ultimaPrueba: null };

function textoNoVacio(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

function leerUltimaPrueba(valor: unknown): UltimaPruebaDeImpresoraIpc | null {
  if (valor === null || typeof valor !== 'object') {
    return null;
  }
  const crudo = valor as Record<string, unknown>;
  const impresora = textoNoVacio(crudo.impresora);
  const fecha = textoNoVacio(crudo.fecha);
  const envio = CLASES_DE_ENVIO_IPC.find((c) => c === crudo.envio);
  const confirmacion = RESULTADOS_DE_CONFIRMACION_IPC.find((c) => c === crudo.confirmacion) ?? null;
  if (impresora === null || fecha === null || envio === undefined) {
    return null;
  }
  return { impresora, fecha, envio, confirmacion };
}

/**
 * Lee `impresora.json`. NUNCA LANZA: un archivo roto se anota y se lee como
 * «sin impresora», porque el punto de venta tiene que arrancar igual.
 */
export function leerArchivoDeImpresora(carpetaDeDatos: string, log?: LogTecnico): ArchivoDeImpresoraLeido {
  const ruta = join(carpetaDeDatos, ARCHIVO_DE_IMPRESORA);
  let crudo: string;
  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch {
    return SIN_NADA;
  }
  try {
    const contenido = JSON.parse(crudo) as Record<string, unknown>;
    const ultimaPrueba = leerUltimaPrueba(contenido.ultimaPrueba);
    const nombre = textoNoVacio(contenido.impresora);
    if (nombre !== null) {
      return { impresora: { tipo: 'cola', nombre }, ultimaPrueba };
    }
    const dispositivo = textoNoVacio(contenido.dispositivo);
    if (dispositivo !== null) {
      return { impresora: { tipo: 'ruta', dispositivo }, ultimaPrueba };
    }
    return { impresora: { tipo: 'ninguna' }, ultimaPrueba };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    log?.registrar('impresion', `No se pudo leer ${ruta}: ${detalle}. Se imprime solo en PDF.`);
    return SIN_NADA;
  }
}

/** Espacios de sangría del JSON: el archivo se tiene que poder leer a mano. */
const SANGRIA_DEL_ARCHIVO = 2;

/** Escribe el archivo entero de una vez: primero a un temporal y después se renombra. */
function escribirArchivo(carpetaDeDatos: string, contenido: Record<string, unknown>): void {
  const ruta = join(carpetaDeDatos, ARCHIVO_DE_IMPRESORA);
  const temporal = `${ruta}.tmp`;
  writeFileSync(temporal, `${JSON.stringify(contenido, null, SANGRIA_DEL_ARCHIVO)}\n`, 'utf8');
  renameSync(temporal, ruta);
}

function contenidoDe(leido: ArchivoDeImpresoraLeido): Record<string, unknown> {
  const contenido: Record<string, unknown> = {};
  if (leido.impresora.tipo === 'cola') {
    contenido.impresora = leido.impresora.nombre;
  }
  if (leido.impresora.tipo === 'ruta') {
    contenido.dispositivo = leido.impresora.dispositivo;
  }
  if (leido.ultimaPrueba !== null) {
    contenido.ultimaPrueba = leido.ultimaPrueba;
  }
  return contenido;
}

/** Guarda el NOMBRE de la impresora. Reemplaza el formato viejo si lo había; conserva la última prueba. */
export function guardarImpresoraEnArchivo(carpetaDeDatos: string, nombre: string): void {
  const anterior = leerArchivoDeImpresora(carpetaDeDatos);
  escribirArchivo(carpetaDeDatos, contenidoDe({ impresora: { tipo: 'cola', nombre }, ultimaPrueba: anterior.ultimaPrueba }));
}

/**
 * Quita la impresora. Sin última prueba que conservar, borra el archivo: sin
 * archivo es exactamente el estado «solo PDF» de siempre.
 */
export function quitarImpresoraDelArchivo(carpetaDeDatos: string): void {
  const anterior = leerArchivoDeImpresora(carpetaDeDatos);
  if (anterior.ultimaPrueba === null) {
    rmSync(join(carpetaDeDatos, ARCHIVO_DE_IMPRESORA), { force: true });
    return;
  }
  escribirArchivo(carpetaDeDatos, contenidoDe({ impresora: { tipo: 'ninguna' }, ultimaPrueba: anterior.ultimaPrueba }));
}

/** Anota la última prueba sin tocar cuál es la impresora. */
export function guardarUltimaPruebaEnArchivo(carpetaDeDatos: string, prueba: UltimaPruebaDeImpresoraIpc): void {
  const anterior = leerArchivoDeImpresora(carpetaDeDatos);
  escribirArchivo(carpetaDeDatos, contenidoDe({ impresora: anterior.impresora, ultimaPrueba: prueba }));
}

/** La frase para la persona. Nunca el nombre de una clase del código. */
export function describirImpresora(impresora: ImpresoraConfigurada): string {
  switch (impresora.tipo) {
    case 'ninguna':
      return 'Sin impresora configurada — los recibos solo se generan en PDF';
    case 'cola':
      return `Impresora configurada: ${impresora.nombre}`;
    case 'ruta':
      return `Impresora configurada con el formato anterior (ruta ${impresora.dispositivo}). Elegila de nuevo de la lista para usar el formato actual.`;
  }
}

// ---------------------------------------------------------------------------
// El proveedor que usa el servicio de recibos
// ---------------------------------------------------------------------------

/** Imprime por la cola de Windows, en RAW, a la impresora con ese nombre. */
export class ImpresoraPorColaDeWindows implements ReceiptPrinterProvider {
  public readonly nombre = 'ImpresoraPorColaDeWindows';

  public constructor(
    private readonly nombreDeImpresora: string,
    private readonly enviador: EnviadorRaw,
    private readonly log: LogTecnico,
  ) {}

  public async imprimirComprobante(comprobante: ComprobanteImprimible): Promise<ResultadoImpresion> {
    const copias = comprobante.copiasEnTexto;
    if (copias.length === 0 || copias.some((texto) => texto.trim() === '')) {
      return this.fallo(comprobante, 'El comprobante llegó sin texto para imprimir.');
    }
    try {
      /*
        TODAS LAS COPIAS EN UN SOLO TRABAJO: un PowerShell por comprobante, como
        cuando había un solo papel, y no uno por copia. Ver `copiasComoEscPos`.
      */
      const bytes = copiasComoEscPos(copias);
      const envio = clasificarEnvio(await this.enviador.enviar(this.nombreDeImpresora, bytes), bytes.length);
      if (envio.clase !== 'enviado') {
        return this.fallo(comprobante, `${envio.titulo}. ${envio.detalle ?? ''}`);
      }
      this.log.registrar(
        'impresion',
        `Comprobante ${comprobante.idComprobante} enviado a la impresora ${this.nombreDeImpresora} ` +
          `(${String(bytes.length)} bytes, ${String(copias.length)} copia(s) en un solo trabajo).`,
      );
      return { ok: true, adaptador: this.nombre, omitidaPorDiseno: false, mensaje: 'Recibo enviado a la impresora.' };
    } catch (error) {
      return this.fallo(comprobante, error instanceof Error ? error.message : String(error));
    }
  }

  public consultarEstado(): Promise<EstadoImpresora> {
    return Promise.resolve({
      disponible: true,
      adaptador: this.nombre,
      descripcion: `Impresora configurada: ${this.nombreDeImpresora}`,
    });
  }

  private fallo(comprobante: ComprobanteImprimible, detalle: string): ResultadoImpresion {
    this.log.registrar(
      'impresion',
      `FALLÓ el comprobante ${comprobante.idComprobante} hacia la impresora ${this.nombreDeImpresora}: ${detalle}`,
    );
    return { ok: false, adaptador: this.nombre, omitidaPorDiseno: false, mensaje: 'No se pudo imprimir. El recibo quedó guardado en PDF.' };
  }
}

/**
 * El proveedor de impresión de la aplicación: vuelve a leer `impresora.json`
 * en CADA impresión.
 *
 * Así guardar o quitar la impresora desde la pantalla vale para el próximo
 * recibo sin reiniciar. Leer un JSON de unos bytes por recibo no cuesta nada al
 * lado de generar el PDF. NUNCA LANZA, igual que los proveedores que elige.
 */
export class ImpresoraSegunElArchivo implements ReceiptPrinterProvider {
  public readonly nombre = 'ImpresoraSegunElArchivo';

  public constructor(
    private readonly carpetaDeDatos: string,
    private readonly enviador: EnviadorRaw,
    private readonly log: LogTecnico,
  ) {}

  public imprimirComprobante(comprobante: ComprobanteImprimible): Promise<ResultadoImpresion> {
    return this.proveedorActual().imprimirComprobante(comprobante);
  }

  public consultarEstado(): Promise<EstadoImpresora> {
    return this.proveedorActual().consultarEstado();
  }

  private proveedorActual(): ReceiptPrinterProvider {
    const { impresora } = leerArchivoDeImpresora(this.carpetaDeDatos, this.log);
    switch (impresora.tipo) {
      case 'ninguna':
        return new NullPrinterProvider();
      case 'cola':
        return new ImpresoraPorColaDeWindows(impresora.nombre, this.enviador, this.log);
      case 'ruta':
        return new EscPosPrinterProvider({ dispositivo: impresora.dispositivo }, this.log);
    }
  }
}
