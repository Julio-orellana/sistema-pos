/**
 * La impresión por la cola de Windows, en RAW, con PowerShell (§4.43).
 *
 * NADA DE ESTO CORRE POWERSHELL. Esta máquina es macOS y no tiene Windows ni
 * una térmica. Lo que se prueba es lo que SÍ depende de nosotros: qué se le
 * pide a `powershell.exe` (con `-Command`, sin archivo `.ps1`), qué hace el
 * enviador cuando PowerShell no contesta o contesta cualquier cosa, y cómo se
 * traduce cada resultado a lo que la persona lee. Que el script funcione en el
 * Windows de la tienda está SIN VERIFICAR.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import {
  ARGUMENTOS_DE_POWERSHELL,
  COMANDO_DE_POWERSHELL,
  ERROR_WIN32_NOMBRE_DE_IMPRESORA_INVALIDO,
  EnviadorPorPowerShell,
  SCRIPT_DE_ENVIO_RAW,
  clasificarEnvio,
  envioFallidoPorEntorno,
  interpretarSalidaDePowerShell,
  type LanzadorDeProceso,
  type ResultadoDelEnvioRaw,
} from '../cola-de-windows';

/** Un proceso de mentira que el test maneja a mano. */
class ProcesoDeMentira extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public matado = false;
  public kill(): boolean {
    this.matado = true;
    return true;
  }
}

interface Lanzamiento {
  comando: string;
  argumentos: readonly string[];
  opciones: { env: NodeJS.ProcessEnv; windowsHide: boolean };
  proceso: ProcesoDeMentira;
}

function lanzadorQueAnota(alLanzar: (l: Lanzamiento) => void): LanzadorDeProceso {
  return (comando, argumentos, opciones) => {
    const proceso = new ProcesoDeMentira();
    const lanzamiento = { comando, argumentos, opciones, proceso };
    queueMicrotask(() => {
      alLanzar(lanzamiento);
    });
    return proceso;
  };
}

const OK: ResultadoDelEnvioRaw = {
  etapa: 'ok',
  codigoWin32: null,
  bytesEscritos: 10,
  trabajo: 7,
  estadoDelTrabajo: 'Printing',
  estadoDeLaImpresora: 'Normal',
  lenguaje: 'FullLanguage',
  mensaje: null,
};

// ===========================================================================
describe('Qué se le pide a PowerShell', () => {
  it('se llama a powershell.exe con -Command, y NUNCA con -File ni un archivo .ps1', () => {
    expect(ARGUMENTOS_DE_POWERSHELL).toContain('-Command');
    expect(ARGUMENTOS_DE_POWERSHELL).not.toContain('-File');
    expect(ARGUMENTOS_DE_POWERSHELL.some((a) => a.toLowerCase().includes('.ps1'))).toBe(false);
    // -Command es el penúltimo y su texto el último: todo lo que sigue a
    // -Command se interpreta como el comando.
    expect(ARGUMENTOS_DE_POWERSHELL.at(-2)).toBe('-Command');
    expect(ARGUMENTOS_DE_POWERSHELL.at(-1)).toBe(COMANDO_DE_POWERSHELL);
  });

  it('sin perfil y sin preguntas: -NoProfile y -NonInteractive', () => {
    expect(ARGUMENTOS_DE_POWERSHELL).toContain('-NoProfile');
    expect(ARGUMENTOS_DE_POWERSHELL).toContain('-NonInteractive');
  });

  it('el texto del comando NO lleva comillas dobles, para que Windows no pueda partirlo al armar la línea', () => {
    expect(COMANDO_DE_POWERSHELL).not.toContain('"');
    expect(COMANDO_DE_POWERSHELL).toContain('$env:POS_IMPRESION_SCRIPT');
    expect(COMANDO_DE_POWERSHELL).toContain('Invoke-Expression');
  });

  it('el script es la secuencia RAW del spooler: OpenPrinter, StartDocPrinter con "RAW", StartPagePrinter, WritePrinter', () => {
    for (const funcion of ['OpenPrinter', 'StartDocPrinter', 'StartPagePrinter', 'WritePrinter', 'EndPagePrinter', 'EndDocPrinter', 'ClosePrinter']) {
      expect(SCRIPT_DE_ENVIO_RAW).toContain(funcion);
    }
    expect(SCRIPT_DE_ENVIO_RAW).toContain('winspool.drv');
    expect(SCRIPT_DE_ENVIO_RAW).toContain('info.pDatatype = "RAW"');
  });

  it('el script NO escribe en una ruta de dispositivo: nada de \\\\.\\USB001 ni de abrir archivos', () => {
    expect(SCRIPT_DE_ENVIO_RAW).not.toContain('USB001');
    expect(SCRIPT_DE_ENVIO_RAW).not.toContain('CreateFile');
  });

  it('el nombre y los bytes viajan en variables de entorno, no dentro del texto del comando', async () => {
    let visto: Lanzamiento | null = null;
    const enviador = new EnviadorPorPowerShell({
      plataforma: 'win32',
      entorno: { PATH: 'x' },
      lanzar: lanzadorQueAnota((l) => {
        visto = l;
        l.proceso.stdout.emit('data', Buffer.from(`${JSON.stringify(OK)}\n`));
        l.proceso.emit('close', 0);
      }),
    });
    const bytes = new Uint8Array([0x1b, 0x40, 0x41]);
    await enviador.enviar('POS-80 "con comillas"', bytes);

    const lanzamiento = visto as Lanzamiento | null;
    expect(lanzamiento?.comando).toBe('powershell.exe');
    expect(lanzamiento?.opciones.windowsHide).toBe(true);
    expect(lanzamiento?.opciones.env.POS_IMPRESION_NOMBRE).toBe('POS-80 "con comillas"');
    expect(lanzamiento?.opciones.env.POS_IMPRESION_DATOS).toBe(Buffer.from(bytes).toString('base64'));
    expect(Buffer.from(lanzamiento?.opciones.env.POS_IMPRESION_SCRIPT ?? '', 'base64').toString('utf8')).toBe(SCRIPT_DE_ENVIO_RAW);
    expect(lanzamiento?.opciones.env.PATH).toBe('x');
    expect(lanzamiento?.argumentos.join(' ')).not.toContain('POS-80');
  });
});

// ===========================================================================
describe('El enviador nunca se queda colgado ni lanza', () => {
  it('fuera de Windows no arranca nada y lo dice: «solo funciona en Windows»', async () => {
    let lanzado = false;
    const enviador = new EnviadorPorPowerShell({
      plataforma: 'darwin',
      lanzar: lanzadorQueAnota(() => {
        lanzado = true;
      }),
    });
    const resultado = await enviador.enviar('POS-80', new Uint8Array([1]));
    expect(lanzado).toBe(false);
    expect(resultado.etapa).toBe('entorno');
    expect(resultado.mensaje).toContain('solo funciona en Windows');
  });

  it('si PowerShell no termina a tiempo, se mata el proceso y vuelve «entorno»', async () => {
    let proceso: ProcesoDeMentira | null = null;
    const enviador = new EnviadorPorPowerShell({
      plataforma: 'win32',
      limiteMs: 20,
      lanzar: lanzadorQueAnota((l) => {
        proceso = l.proceso;
      }),
    });
    const resultado = await enviador.enviar('POS-80', new Uint8Array([1]));
    expect(resultado.etapa).toBe('entorno');
    expect(resultado.mensaje).toContain('no terminó');
    expect((proceso as ProcesoDeMentira | null)?.matado).toBe(true);
  });

  it('si powershell.exe no existe (error al lanzar), vuelve «entorno» con el motivo', async () => {
    const enviador = new EnviadorPorPowerShell({
      plataforma: 'win32',
      lanzar: lanzadorQueAnota((l) => {
        l.proceso.emit('error', new Error('spawn powershell.exe ENOENT'));
      }),
    });
    const resultado = await enviador.enviar('POS-80', new Uint8Array([1]));
    expect(resultado.etapa).toBe('entorno');
    expect(resultado.mensaje).toContain('ENOENT');
  });

  it('si el lanzador lanza en el acto, tampoco rompe', async () => {
    const enviador = new EnviadorPorPowerShell({
      plataforma: 'win32',
      lanzar: (): never => {
        throw new Error('sin permiso');
      },
    });
    const resultado = await enviador.enviar('POS-80', new Uint8Array([1]));
    expect(resultado.etapa).toBe('entorno');
    expect(resultado.mensaje).toContain('sin permiso');
  });
});

// ===========================================================================
describe('Leer lo que devolvió PowerShell', () => {
  it('toma la ÚLTIMA línea JSON, aunque haya ruido antes', () => {
    const salida = `advertencia cualquiera\r\n{"etapa":"abrir","codigoWin32":5}\r\n${JSON.stringify(OK)}\r\n`;
    expect(interpretarSalidaDePowerShell(salida, '', 0)).toEqual(OK);
  });

  it('sin ninguna línea JSON: «entorno», con lo que dijo stderr', () => {
    const resultado = interpretarSalidaDePowerShell('', 'No se reconoce Add-Type', 1);
    expect(resultado.etapa).toBe('entorno');
    expect(resultado.mensaje).toContain('No se reconoce Add-Type');
  });

  it('una línea que empieza con { y no es JSON: «entorno», nunca una excepción', () => {
    const resultado = interpretarSalidaDePowerShell('{roto', '', 0);
    expect(resultado.etapa).toBe('entorno');
    expect(resultado.mensaje).toContain('no es JSON');
  });

  it('una etapa que no existe: «entorno»', () => {
    const resultado = interpretarSalidaDePowerShell('{"etapa":"quizas"}', '', 0);
    expect(resultado.etapa).toBe('entorno');
  });
});

// ===========================================================================
describe('Qué lee la persona: «no se encontró / no se pudo conectar» NO es lo mismo que «enviado»', () => {
  it('nombre inexistente (Win32 1801 al abrir) → «No se encontró la impresora»', () => {
    const envio = clasificarEnvio(
      { ...OK, etapa: 'abrir', codigoWin32: ERROR_WIN32_NOMBRE_DE_IMPRESORA_INVALIDO, bytesEscritos: 0, trabajo: null },
      10,
    );
    expect(envio.clase).toBe('no_encontrada');
    expect(envio.titulo).toBe('No se encontró la impresora');
  });

  it('otro error al abrir, al escribir o al terminar → «No se pudo conectar con la impresora»', () => {
    for (const etapa of ['abrir', 'documento', 'pagina', 'escribir', 'terminar'] as const) {
      const envio = clasificarEnvio({ ...OK, etapa, codigoWin32: 5 }, 10);
      expect(envio.clase).toBe('no_se_pudo_enviar');
      expect(envio.titulo).toBe('No se pudo conectar con la impresora');
    }
  });

  it('se escribieron MENOS bytes de los mandados → no se da por enviado', () => {
    expect(clasificarEnvio({ ...OK, bytesEscritos: 9 }, 10).clase).toBe('no_se_pudo_enviar');
  });

  it('Windows aceptó el trabajo pero la impresora está Offline, sin papel o en error → «reporta un problema»', () => {
    for (const estados of [
      { estadoDeLaImpresora: 'Offline' },
      { estadoDeLaImpresora: 'PaperOut' },
      { estadoDelTrabajo: 'Error, Printing' },
    ]) {
      const envio = clasificarEnvio({ ...OK, ...estados }, 10);
      expect(envio.clase).toBe('trabajo_con_error');
    }
  });

  it('todo bien → «enviado», y el mensaje pide MIRAR el ticket: la computadora no puede saber si salió legible', () => {
    const envio = clasificarEnvio(OK, 10);
    expect(envio.clase).toBe('enviado');
    expect(envio.mensaje).toContain('no tiene forma de saber');
  });

  it('sin poder leer el estado del trabajo (null) igual se da por enviado: esa consulta es optativa', () => {
    expect(clasificarEnvio({ ...OK, estadoDelTrabajo: null, estadoDeLaImpresora: null }, 10).clase).toBe('enviado');
  });

  it('PowerShell en modo restringido: «entorno» con un mensaje que lo nombra', () => {
    const envio = clasificarEnvio(envioFallidoPorEntorno('Add-Type no permitido', 'ConstrainedLanguage'), 10);
    expect(envio.clase).toBe('entorno');
    expect(envio.mensaje).toContain('modo restringido');
  });

  it('el detalle técnico lleva la etapa, el código y los bytes, para diagnosticar después', () => {
    const envio = clasificarEnvio({ ...OK, etapa: 'escribir', codigoWin32: 1722, bytesEscritos: 3 }, 10);
    expect(envio.detalle).toContain('etapa=escribir');
    expect(envio.detalle).toContain('codigoWin32=1722');
    expect(envio.detalle).toContain('bytes=3/10');
  });
});
