/**
 * Impresión por la COLA DE WINDOWS, en modo RAW (§4.43).
 *
 * POR QUÉ ESTA VÍA. Hasta el 2026-09-15 el adaptador escribía los bytes en una
 * ruta de dispositivo (`\\.\USB001`). La investigación previa a la pantalla de
 * impresora encontró que `USB001` es un PUERTO de la cola de impresión, no un
 * dispositivo que se abra como archivo, así que esa ruta probablemente nunca
 * funcionó. La vía documentada por Microsoft para mandar bytes crudos a una
 * impresora es la del spooler: `OpenPrinter → StartDocPrinter("RAW") →
 * StartPagePrinter → WritePrinter`. Con el tipo de dato RAW los bytes llegan
 * a la impresora sin que el controlador los toque, así que siguen yendo
 * nuestros comandos ESC/POS (página de códigos, corte).
 *
 * POR QUÉ POWERSHELL Y NO UN MÓDULO NATIVO. Decisión de Julio: un módulo nativo
 * obliga a compilar para Electron y para Windows (§4.37). PowerShell 5.1 viene
 * con Windows 10 y 11, y `Add-Type` declara las funciones de `winspool.drv`.
 *
 * POR QUÉ `-Command` Y NO UN ARCHIVO `.ps1`. La política de ejecución por
 * omisión de un Windows de escritorio es `Restricted`, que según Microsoft
 * «permite comandos individuales, pero no scripts» e «impide ejecutar todos los
 * archivos de script». `-File` corre un archivo; `-Command` corre texto como si
 * se tecleara. El texto del comando no lleva comillas dobles, para que la forma
 * en que Windows arma la línea de comandos no pueda romperlo: solo decodifica
 * el script, que viaja en una variable de entorno, y lo ejecuta con
 * `Invoke-Expression`. Detalle y fuentes en CLAUDE.md §4.43. Lo que dice la
 * documentación NO se midió en Windows.
 *
 * LO QUE ESTO NO PUEDE SABER. Una térmica ESC/POS no contesta: que Windows
 * acepte el trabajo no dice que el ticket salió legible. Eso lo confirma la
 * persona que lo tiene en la mano (`servicio-de-impresora.ts`).
 */

import { spawn as spawnReal } from 'node:child_process';

import type { ClaseDeEnvioIpc } from '@shared/types/ipc';

/** En qué paso quedó el envío. `ok` es que `WritePrinter` y `EndDocPrinter` salieron bien. */
export type EtapaDelEnvio = 'ok' | 'abrir' | 'documento' | 'pagina' | 'escribir' | 'terminar' | 'entorno';

/** Lo que devuelve un envío, crudo, antes de clasificarlo. */
export interface ResultadoDelEnvioRaw {
  readonly etapa: EtapaDelEnvio;
  /** `GetLastWin32Error` del paso que falló; `null` si no aplica. */
  readonly codigoWin32: number | null;
  readonly bytesEscritos: number;
  /** El id de trabajo del spooler, o `null`. */
  readonly trabajo: number | null;
  /** `JobStatus` de `Get-PrintJob` un momento después; `null` si no se pudo leer. */
  readonly estadoDelTrabajo: string | null;
  /** `PrinterStatus` de `Get-Printer`; `null` si no se pudo leer. */
  readonly estadoDeLaImpresora: string | null;
  /** El modo de lenguaje de PowerShell (`FullLanguage`, `ConstrainedLanguage`…). */
  readonly lenguaje: string | null;
  /** Mensaje de error de PowerShell o del lanzador, tal cual. */
  readonly mensaje: string | null;
}

/** Quien manda los bytes. Se inyecta: las pruebas y el arnés no tienen Windows. */
export interface EnviadorRaw {
  enviar(nombreDeImpresora: string, bytes: Uint8Array): Promise<ResultadoDelEnvioRaw>;
}

/** Un resultado de `entorno`, con su mensaje. */
export function envioFallidoPorEntorno(mensaje: string, lenguaje: string | null = null): ResultadoDelEnvioRaw {
  return {
    etapa: 'entorno',
    codigoWin32: null,
    bytesEscritos: 0,
    trabajo: null,
    estadoDelTrabajo: null,
    estadoDeLaImpresora: null,
    lenguaje,
    mensaje,
  };
}

// ---------------------------------------------------------------------------
// El script de PowerShell
// ---------------------------------------------------------------------------

/**
 * El script que corre en Windows PowerShell 5.1.
 *
 * Es la secuencia del artículo de Microsoft «Send raw data to printers by using
 * Win32 API» (KB 138594), declarada con `Add-Type`. Lee sus datos de variables
 * de entorno y escribe UNA línea JSON en la salida estándar.
 *
 * La consulta del trabajo con `Get-PrintJob` y `Get-Printer` es optativa: vive
 * en un módulo del sistema que carga archivos de formato, y eso SÍ lo alcanza la
 * política de ejecución. Si falla, se informa `null` y la impresión no se ve
 * afectada, porque el envío ya ocurrió.
 */
export const SCRIPT_DE_ENVIO_RAW = String.raw`
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$lenguaje = [string]$ExecutionContext.SessionState.LanguageMode
function Responder($etapa, $codigo, $escritos, $trabajo, $estadoTrabajo, $estadoImpresora, $mensaje) {
  $salida = [ordered]@{
    etapa = $etapa; codigoWin32 = $codigo; bytesEscritos = $escritos; trabajo = $trabajo
    estadoDelTrabajo = $estadoTrabajo; estadoDeLaImpresora = $estadoImpresora
    lenguaje = $lenguaje; mensaje = $mensaje
  }
  [Console]::Out.WriteLine(($salida | ConvertTo-Json -Compress))
}
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PosImpresionRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DocInfo1 pDocInfo);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

  // Devuelve "etapa|codigo|trabajo|escritos".
  public static string Enviar(string nombre, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(nombre, out h, IntPtr.Zero)) {
      return "abrir|" + Marshal.GetLastWin32Error() + "|0|0";
    }
    try {
      DocInfo1 info = new DocInfo1();
      info.pDocName = "POS Jimmy Cano";
      info.pOutputFile = null;
      info.pDatatype = "RAW";
      int trabajo = StartDocPrinter(h, 1, info);
      if (trabajo == 0) { return "documento|" + Marshal.GetLastWin32Error() + "|0|0"; }
      if (!StartPagePrinter(h)) {
        int e = Marshal.GetLastWin32Error(); EndDocPrinter(h);
        return "pagina|" + e + "|" + trabajo + "|0";
      }
      int escritos;
      bool escribio = WritePrinter(h, datos, datos.Length, out escritos);
      int errorEscribir = Marshal.GetLastWin32Error();
      EndPagePrinter(h);
      if (!escribio) { EndDocPrinter(h); return "escribir|" + errorEscribir + "|" + trabajo + "|" + escritos; }
      if (!EndDocPrinter(h)) { return "terminar|" + Marshal.GetLastWin32Error() + "|" + trabajo + "|" + escritos; }
      return "ok|0|" + trabajo + "|" + escritos;
    } finally {
      ClosePrinter(h);
    }
  }
}
'@
} catch {
  Responder 'entorno' $null 0 $null $null $null ('No se pudo preparar el envio (Add-Type): ' + $_.Exception.Message)
  exit 0
}
try {
  $nombre = $env:POS_IMPRESION_NOMBRE
  $datos = [Convert]::FromBase64String($env:POS_IMPRESION_DATOS)
  $partes = [PosImpresionRaw]::Enviar($nombre, $datos).Split('|')
  $etapa = $partes[0]; $codigo = [int]$partes[1]; $trabajo = [int]$partes[2]; $escritos = [int]$partes[3]
  $estadoTrabajo = $null; $estadoImpresora = $null
  if ($etapa -eq 'ok') {
    Start-Sleep -Milliseconds 1500
    try { $estadoTrabajo = [string](Get-PrintJob -PrinterName $nombre -ID $trabajo -ErrorAction Stop).JobStatus } catch { $estadoTrabajo = $null }
  }
  try { $estadoImpresora = [string](Get-Printer -Name $nombre -ErrorAction Stop).PrinterStatus } catch { $estadoImpresora = $null }
  $codigoFinal = $null; if ($etapa -ne 'ok') { $codigoFinal = $codigo }
  $trabajoFinal = $null; if ($trabajo -ne 0) { $trabajoFinal = $trabajo }
  Responder $etapa $codigoFinal $escritos $trabajoFinal $estadoTrabajo $estadoImpresora $null
} catch {
  Responder 'entorno' $null 0 $null $null $null ('El envio fallo dentro de PowerShell: ' + $_.Exception.Message)
}
`;

/**
 * El texto que va en `-Command`. Sin comillas dobles, a propósito: solo
 * decodifica el script de la variable de entorno y lo ejecuta.
 */
export const COMANDO_DE_POWERSHELL =
  "Invoke-Expression ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:POS_IMPRESION_SCRIPT)))";

/** Los argumentos de `powershell.exe`. Se exportan para que una prueba los fije. */
export const ARGUMENTOS_DE_POWERSHELL: readonly string[] = [
  '-NoProfile',
  '-NonInteractive',
  // Solo afecta a la consulta optativa del trabajo, que carga un módulo del
  // sistema con archivos de formato. El envío no la necesita. Una directiva de
  // grupo la puede anular, y en ese caso la consulta devuelve `null`.
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  COMANDO_DE_POWERSHELL,
];

/**
 * Cuánto se espera a PowerShell. Arrancarlo y compilar el `Add-Type` en un i3
 * puede llevar varios segundos (no medido); el script además espera 1,5 s para
 * leer el trabajo. Queda por debajo de los 15 s con que la pantalla da una
 * llamada por perdida.
 */
export const LIMITE_DE_POWERSHELL_MS = 12_000;

/** Lo mínimo de `child_process.spawn` que se usa, para poder inyectarlo. */
export type LanzadorDeProceso = (
  comando: string,
  argumentos: readonly string[],
  opciones: { env: NodeJS.ProcessEnv; windowsHide: boolean },
) => {
  stdout: { on(evento: 'data', escuchar: (trozo: Buffer) => void): unknown } | null;
  stderr: { on(evento: 'data', escuchar: (trozo: Buffer) => void): unknown } | null;
  on(evento: 'error', escuchar: (error: Error) => void): unknown;
  on(evento: 'close', escuchar: (codigo: number | null) => void): unknown;
  kill(): boolean;
};

export interface OpcionesDelEnviadorPorPowerShell {
  readonly plataforma?: NodeJS.Platform;
  readonly lanzar?: LanzadorDeProceso;
  readonly limiteMs?: number;
  readonly entorno?: NodeJS.ProcessEnv;
}

/** El enviador de producción: `powershell.exe -Command` en Windows. */
export class EnviadorPorPowerShell implements EnviadorRaw {
  private readonly plataforma: NodeJS.Platform;
  private readonly lanzar: LanzadorDeProceso;
  private readonly limiteMs: number;
  private readonly entorno: NodeJS.ProcessEnv;

  public constructor(opciones: OpcionesDelEnviadorPorPowerShell = {}) {
    this.plataforma = opciones.plataforma ?? process.platform;
    this.lanzar = opciones.lanzar ?? spawnReal;
    this.limiteMs = opciones.limiteMs ?? LIMITE_DE_POWERSHELL_MS;
    this.entorno = opciones.entorno ?? process.env;
  }

  public enviar(nombreDeImpresora: string, bytes: Uint8Array): Promise<ResultadoDelEnvioRaw> {
    if (this.plataforma !== 'win32') {
      return Promise.resolve(
        envioFallidoPorEntorno(
          `La impresión por la cola de Windows solo funciona en Windows, y esta computadora es ${this.plataforma}.`,
        ),
      );
    }

    return new Promise((resolver) => {
      let terminado = false;
      let salida = '';
      let errores = '';
      const terminar = (resultado: ResultadoDelEnvioRaw): void => {
        if (terminado) {
          return;
        }
        terminado = true;
        clearTimeout(temporizador);
        resolver(resultado);
      };

      let proceso: ReturnType<LanzadorDeProceso>;
      try {
        proceso = this.lanzar('powershell.exe', ARGUMENTOS_DE_POWERSHELL, {
          env: {
            ...this.entorno,
            POS_IMPRESION_SCRIPT: Buffer.from(SCRIPT_DE_ENVIO_RAW, 'utf8').toString('base64'),
            POS_IMPRESION_NOMBRE: nombreDeImpresora,
            POS_IMPRESION_DATOS: Buffer.from(bytes).toString('base64'),
          },
          windowsHide: true,
        });
      } catch (error) {
        resolver(envioFallidoPorEntorno(`No se pudo arrancar PowerShell: ${describir(error)}`));
        return;
      }

      const temporizador = setTimeout(() => {
        proceso.kill();
        terminar(envioFallidoPorEntorno(`PowerShell no terminó en ${String(this.limiteMs / MILISEGUNDOS_POR_SEGUNDO)} s.`));
      }, this.limiteMs);

      proceso.stdout?.on('data', (trozo) => {
        salida += trozo.toString('utf8');
      });
      proceso.stderr?.on('data', (trozo) => {
        errores += trozo.toString('utf8');
      });
      proceso.on('error', (error) => {
        terminar(envioFallidoPorEntorno(`No se pudo arrancar PowerShell: ${error.message}`));
      });
      proceso.on('close', (codigo) => {
        terminar(interpretarSalidaDePowerShell(salida, errores, codigo));
      });
    });
  }
}

const MILISEGUNDOS_POR_SEGUNDO = 1000;

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ETAPAS: readonly EtapaDelEnvio[] = ['ok', 'abrir', 'documento', 'pagina', 'escribir', 'terminar', 'entorno'];

function numeroONull(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function textoONull(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** Lee la última línea JSON que escribió el script. Todo lo inesperado es `entorno`. */
export function interpretarSalidaDePowerShell(salida: string, errores: string, codigo: number | null): ResultadoDelEnvioRaw {
  const ultima = salida
    .split(/\r?\n/u)
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith('{'))
    .pop();
  if (ultima === undefined) {
    const detalle = errores.trim() === '' ? `sin salida (código ${String(codigo)})` : errores.trim();
    return envioFallidoPorEntorno(`PowerShell no devolvió un resultado: ${detalle}`);
  }
  try {
    const crudo = JSON.parse(ultima) as Record<string, unknown>;
    const etapa = ETAPAS.find((e) => e === crudo.etapa);
    if (etapa === undefined) {
      return envioFallidoPorEntorno(`PowerShell devolvió una etapa desconocida: ${String(crudo.etapa)}`);
    }
    return {
      etapa,
      codigoWin32: numeroONull(crudo.codigoWin32),
      bytesEscritos: numeroONull(crudo.bytesEscritos) ?? 0,
      trabajo: numeroONull(crudo.trabajo),
      estadoDelTrabajo: textoONull(crudo.estadoDelTrabajo),
      estadoDeLaImpresora: textoONull(crudo.estadoDeLaImpresora),
      lenguaje: textoONull(crudo.lenguaje),
      mensaje: textoONull(crudo.mensaje),
    };
  } catch {
    return envioFallidoPorEntorno(`PowerShell devolvió algo que no es JSON: ${ultima}`);
  }
}

// ---------------------------------------------------------------------------
// Clasificación: lo que la persona lee
// ---------------------------------------------------------------------------

/** `ERROR_INVALID_PRINTER_NAME`: no hay ninguna impresora con ese nombre. */
export const ERROR_WIN32_NOMBRE_DE_IMPRESORA_INVALIDO = 1801;

/**
 * Estados de `Get-PrintJob` y `Get-Printer` que significan que la impresora no
 * va a imprimir. Son nombres de enumeraciones de Windows; la comparación es por
 * contenido porque `JobStatus` puede traer varios juntos («Error, Printing»).
 */
const ESTADOS_CON_PROBLEMA = ['Error', 'Offline', 'PaperOut', 'PaperJam', 'UserIntervention', 'Blocked', 'NotAvailable', 'DoorOpen', 'NoToner'];

export interface EnvioClasificado {
  readonly clase: ClaseDeEnvioIpc;
  readonly titulo: string;
  readonly mensaje: string;
  readonly detalle: string | null;
}

function detalleTecnico(resultado: ResultadoDelEnvioRaw, bytesEsperados: number): string {
  const partes = [
    `etapa=${resultado.etapa}`,
    `codigoWin32=${String(resultado.codigoWin32)}`,
    `bytes=${String(resultado.bytesEscritos)}/${String(bytesEsperados)}`,
    `trabajo=${String(resultado.trabajo)}`,
    `estadoDelTrabajo=${String(resultado.estadoDelTrabajo)}`,
    `estadoDeLaImpresora=${String(resultado.estadoDeLaImpresora)}`,
    `lenguaje=${String(resultado.lenguaje)}`,
  ];
  if (resultado.mensaje !== null) {
    partes.push(`mensaje=${resultado.mensaje}`);
  }
  return partes.join('; ');
}

/**
 * Traduce un envío a lo que la persona tiene que leer. Pura.
 *
 * Distingue lo que Windows SÍ puede decir —no existe, no se pudo abrir o
 * escribir, quedó en error— de lo que ninguna computadora puede saber: si el
 * ticket salió legible. Para `enviado` el mensaje pide mirarlo.
 */
export function clasificarEnvio(resultado: ResultadoDelEnvioRaw, bytesEsperados: number): EnvioClasificado {
  const detalle = detalleTecnico(resultado, bytesEsperados);

  if (resultado.etapa === 'entorno') {
    const bloqueadoPorPolitica = resultado.lenguaje !== null && resultado.lenguaje !== 'FullLanguage';
    return {
      clase: 'entorno',
      titulo: 'Esta computadora no pudo ejecutar el envío',
      mensaje: bloqueadoPorPolitica
        ? 'Windows está en un modo restringido que no deja preparar el envío a la impresora. Hay que revisarlo con quien administra la computadora.'
        : 'No se llegó a hablar con la impresora: el problema está en esta computadora, no en la impresora.',
      detalle,
    };
  }
  if (resultado.etapa === 'abrir' && resultado.codigoWin32 === ERROR_WIN32_NOMBRE_DE_IMPRESORA_INVALIDO) {
    return {
      clase: 'no_encontrada',
      titulo: 'No se encontró la impresora',
      mensaje: 'Windows no tiene ninguna impresora instalada con ese nombre. Volvé a buscar las impresoras: puede haberse desinstalado o cambiado de nombre.',
      detalle,
    };
  }
  if (resultado.etapa !== 'ok' || resultado.bytesEscritos !== bytesEsperados) {
    return {
      clase: 'no_se_pudo_enviar',
      titulo: 'No se pudo conectar con la impresora',
      mensaje: 'La impresora está instalada en Windows, pero no se le pudo mandar el ticket. Revisá que esté encendida y conectada, y probá de nuevo.',
      detalle,
    };
  }
  const estados = `${resultado.estadoDelTrabajo ?? ''} ${resultado.estadoDeLaImpresora ?? ''}`;
  const problema = ESTADOS_CON_PROBLEMA.find((estado) => estados.includes(estado));
  if (problema !== undefined) {
    return {
      clase: 'trabajo_con_error',
      titulo: 'La impresora recibió el ticket pero reporta un problema',
      mensaje: `Windows aceptó el ticket y la impresora informa «${problema}» (desconectada, sin papel o con error). Revisala y probá de nuevo.`,
      detalle,
    };
  }
  return {
    clase: 'enviado',
    titulo: 'Ticket de prueba enviado',
    mensaje: 'Windows aceptó el ticket. Mirá la impresora y contestá qué salió: la computadora no tiene forma de saber si se imprimió bien.',
    detalle,
  };
}
