/**
 * La pantalla de impresora, del lado del proceso principal (§4.43).
 *
 * Lista las impresoras que el sistema operativo tiene instaladas, guarda la
 * elegida en `impresora.json`, la quita, y manda un ticket de prueba.
 *
 * EL TICKET DE PRUEBA NO DICE SI SALIÓ BIEN. Una térmica ESC/POS no contesta
 * nada: lo único que la computadora sabe es si Windows aceptó el trabajo. Por
 * eso, cuando el envío sale bien, la pantalla le pregunta a la persona qué vio.
 * La respuesta «salió con símbolos raros o sin cortar» queda guardada como una
 * señal explícita de que el modelo podría no entender los comandos ESC/POS que
 * se usan, y NO como un fallo de conexión: son dos problemas con dos arreglos.
 *
 * NADA DE ESTO ES UN HECHO DEL NEGOCIO. Va a la bitácora TÉCNICA y a
 * `impresora.json`, nunca a `auditoria_log` (§4.14).
 */

import { randomUUID } from 'node:crypto';

import type {
  ClaseDeEnvioIpc,
  EstadoDeImpresoraIpc,
  ImpresoraDelSistemaIpc,
  ResultadoDeConfirmacionIpc,
  ResultadoDePruebaDeImpresoraIpc,
} from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';
import type { LogTecnico } from '@main/log-tecnico';
import { reciboComoEscPos } from '@main/domain/recibo/escpos';
import {
  describirImpresora,
  guardarImpresoraEnArchivo,
  guardarUltimaPruebaEnArchivo,
  leerArchivoDeImpresora,
  quitarImpresoraDelArchivo,
} from '@main/adapters/impresora-configurada';
import { clasificarEnvio, type EnviadorRaw } from '@main/adapters/cola-de-windows';

/** Lo que Electron devuelve de cada impresora (`PrinterInfo`), sin depender de su tipo. */
export interface ImpresoraListada {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
}

export interface DependenciasDelServicioDeImpresora {
  readonly carpetaDeDatos: string;
  /**
   * Las impresoras instaladas. En la aplicación es `webContents.getPrintersAsync()`
   * de la ventana que pregunta; en las pruebas y en el arnés, una lista simulada.
   */
  readonly listar: () => Promise<readonly ImpresoraListada[]>;
  readonly enviador: EnviadorRaw;
  readonly log: LogTecnico;
  readonly ahora?: () => Date;
}

/**
 * El texto del ticket de prueba. Genérico, SIN datos de ventas, y con las
 * letras que más fallan si la página de códigos no coincide: vocales con tilde,
 * eñe y el símbolo del quetzal. Si salen raras, se ve a simple vista.
 */
export function textoDelTicketDePrueba(fecha: Date, impresora: string): string {
  return [
    'POS Jimmy Cano',
    'TICKET DE PRUEBA',
    '',
    'Si esto se lee bien, la impresora',
    'quedo lista para imprimir recibos.',
    '',
    'Acentos: a e i o u con tilde: á é í ó ú',
    'Enie: ñ Ñ   Moneda: Q 1,234.50',
    '',
    `Impresora: ${impresora}`,
    `Fecha: ${fecha.toISOString()}`,
    '',
    'El papel tiene que salir cortado.',
  ].join('\n');
}

/** Lo que se contesta después de mirar el ticket, dicho para la persona. */
export const MENSAJES_DE_CONFIRMACION: Readonly<Record<ResultadoDeConfirmacionIpc, string>> = {
  bien: 'La impresora quedó probada: el ticket salió legible y cortado.',
  ilegible:
    'Quedó anotado que el ticket salió con símbolos raros o sin cortar. La impresora SÍ recibe lo que se le manda, así que no es un problema de conexión: el modelo podría no entender del todo los comandos ESC/POS que usa el sistema. Hay que revisarlo con el modelo en la mano.',
  nada:
    'Quedó anotado que no salió nada aunque Windows aceptó el ticket. Revisá que sea la impresora correcta, que esté encendida y que tenga papel. Si todo eso está bien, el modelo podría estar ignorando los comandos.',
};

interface PruebaPendiente {
  readonly id: string;
  readonly impresora: string;
  readonly fecha: string;
}

export class ServicioDeImpresora {
  private readonly carpeta: string;
  private readonly listarDelSistema: () => Promise<readonly ImpresoraListada[]>;
  private readonly enviador: EnviadorRaw;
  private readonly log: LogTecnico;
  private readonly ahora: () => Date;
  /** La última prueba enviada con éxito y todavía sin contestar. Una sola a la vez. */
  private pendiente: PruebaPendiente | null = null;

  public constructor(dependencias: DependenciasDelServicioDeImpresora) {
    this.carpeta = dependencias.carpetaDeDatos;
    this.listarDelSistema = dependencias.listar;
    this.enviador = dependencias.enviador;
    this.log = dependencias.log;
    this.ahora = dependencias.ahora ?? ((): Date => new Date());
  }

  public estado(): EstadoDeImpresoraIpc {
    const leido = leerArchivoDeImpresora(this.carpeta, this.log);
    const { impresora } = leido;
    return {
      tipo: impresora.tipo,
      nombre: impresora.tipo === 'cola' ? impresora.nombre : impresora.tipo === 'ruta' ? impresora.dispositivo : null,
      descripcion: describirImpresora(impresora),
      ultimaPrueba: leido.ultimaPrueba,
    };
  }

  /** Las impresoras instaladas. Si el sistema no contesta, se dice con todas las letras. */
  public async listar(): Promise<readonly ImpresoraDelSistemaIpc[]> {
    let impresoras: readonly ImpresoraListada[];
    try {
      impresoras = await this.listarDelSistema();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.log.registrar('impresion', `No se pudo pedir la lista de impresoras al sistema: ${detalle}`);
      throw new ErrorDeNegocio(
        'IMPRESORAS_NO_LISTADAS',
        'El sistema no devolvió la lista de impresoras. Probá de nuevo en un momento.',
        detalle,
      );
    }
    return impresoras.map((i) => ({
      nombre: i.name,
      nombreVisible: i.displayName.trim() === '' ? i.name : i.displayName,
      descripcion: i.description,
    }));
  }

  /** Guarda el NOMBRE, solo si es una impresora que el sistema tiene instalada ahora. */
  public async guardar(nombre: string): Promise<EstadoDeImpresoraIpc> {
    await this.exigirQueEsteInstalada(nombre);
    guardarImpresoraEnArchivo(this.carpeta, nombre);
    this.log.registrar('impresion', `Se configuró la impresora ${nombre}.`);
    return this.estado();
  }

  public quitar(): EstadoDeImpresoraIpc {
    quitarImpresoraDelArchivo(this.carpeta);
    this.pendiente = null;
    this.log.registrar('impresion', 'Se quitó la impresora: los recibos quedan solo en PDF.');
    return this.estado();
  }

  /**
   * Manda el ticket de prueba. NUNCA falla en silencio: todo resultado vuelve
   * clasificado, con el detalle técnico al lado.
   */
  public async imprimirPrueba(nombre: string): Promise<ResultadoDePruebaDeImpresoraIpc> {
    const fecha = this.ahora();
    const bytes = reciboComoEscPos(textoDelTicketDePrueba(fecha, nombre));
    this.pendiente = null;

    let envio;
    try {
      envio = clasificarEnvio(await this.enviador.enviar(nombre, bytes), bytes.length);
    } catch (error) {
      // El contrato del enviador es no lanzar; si una implementación lo
      // incumple, se informa igual en vez de romper la pantalla.
      const detalle = error instanceof Error ? error.message : String(error);
      envio = {
        clase: 'entorno' as ClaseDeEnvioIpc,
        titulo: 'Esta computadora no pudo ejecutar el envío',
        mensaje: 'No se llegó a hablar con la impresora: el problema está en esta computadora, no en la impresora.',
        detalle,
      };
    }

    const fechaIso = fecha.toISOString();
    guardarUltimaPruebaEnArchivo(this.carpeta, { impresora: nombre, fecha: fechaIso, envio: envio.clase, confirmacion: null });
    this.log.registrar('impresion', `Ticket de prueba a ${nombre}: ${envio.clase}. ${envio.detalle ?? ''}`);

    let pruebaId: string | null = null;
    if (envio.clase === 'enviado') {
      pruebaId = randomUUID();
      this.pendiente = { id: pruebaId, impresora: nombre, fecha: fechaIso };
    }
    return { clase: envio.clase, titulo: envio.titulo, mensaje: envio.mensaje, detalle: envio.detalle, pruebaId };
  }

  /** Lo que la persona vio. Solo vale para la prueba que acaba de salir. */
  public confirmarPrueba(pruebaId: string, resultado: ResultadoDeConfirmacionIpc): { estado: EstadoDeImpresoraIpc; mensaje: string } {
    const pendiente = this.pendiente;
    if (pendiente?.id !== pruebaId) {
      throw new ErrorDeNegocio(
        'PRUEBA_NO_VIGENTE',
        'Esa prueba ya no está esperando respuesta. Imprimí un ticket de prueba nuevo.',
        `Se confirmó la prueba ${pruebaId} y la pendiente es ${pendiente?.id ?? 'ninguna'}.`,
      );
    }
    this.pendiente = null;
    guardarUltimaPruebaEnArchivo(this.carpeta, {
      impresora: pendiente.impresora,
      fecha: pendiente.fecha,
      envio: 'enviado',
      confirmacion: resultado,
    });
    const senal = resultado === 'ilegible' ? ' SEÑAL: el modelo podría no ser compatible con los comandos ESC/POS usados.' : '';
    this.log.registrar('impresion', `Ticket de prueba a ${pendiente.impresora}: la persona contestó «${resultado}».${senal}`);
    return { estado: this.estado(), mensaje: MENSAJES_DE_CONFIRMACION[resultado] };
  }

  private async exigirQueEsteInstalada(nombre: string): Promise<void> {
    const instaladas = await this.listar();
    if (!instaladas.some((i) => i.nombre === nombre)) {
      throw new ErrorDeNegocio(
        'IMPRESORA_NO_INSTALADA',
        'Esa impresora no está en la lista del sistema. Volvé a buscar las impresoras y elegí una de la lista.',
        `No se encontró «${nombre}» entre ${String(instaladas.length)} impresora(s).`,
      );
    }
  }
}
