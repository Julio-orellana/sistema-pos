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
  COMANDO_CODIFICADO,
  ERROR_WIN32_NOMBRE_DE_IMPRESORA_INVALIDO,
  EnviadorPorPowerShell,
  SCRIPT_DE_ENVIO_RAW,
  VARIABLES_DEL_ENVIO,
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
  it('se llama a powershell.exe con -EncodedCommand, y NUNCA con -Command, -File ni un archivo .ps1', () => {
    expect(ARGUMENTOS_DE_POWERSHELL).not.toContain('-Command');
    expect(ARGUMENTOS_DE_POWERSHELL).not.toContain('-File');
    expect(ARGUMENTOS_DE_POWERSHELL.some((a) => a.toLowerCase().includes('.ps1'))).toBe(false);
    expect(ARGUMENTOS_DE_POWERSHELL.at(-2)).toBe('-EncodedCommand');
    expect(ARGUMENTOS_DE_POWERSHELL.at(-1)).toBe(COMANDO_CODIFICADO);
  });

  it('lo que va en -EncodedCommand es EXACTAMENTE el script constante, en UTF-16LE', () => {
    expect(Buffer.from(COMANDO_CODIFICADO, 'base64').toString('utf16le')).toBe(SCRIPT_DE_ENVIO_RAW);
  });

  it('sin perfil y sin preguntas: -NoProfile y -NonInteractive', () => {
    expect(ARGUMENTOS_DE_POWERSHELL).toContain('-NoProfile');
    expect(ARGUMENTOS_DE_POWERSHELL).toContain('-NonInteractive');
  });

  it('la línea de comandos cabe en el límite de Windows (32 767 caracteres)', () => {
    const linea = ['powershell.exe', ...ARGUMENTOS_DE_POWERSHELL].join(' ');
    expect(linea.length).toBeLessThan(32_767);
  });

  it('el script NO convierte texto en código al ejecutar: ni Invoke-Expression, ni iex, ni ScriptBlock::Create', () => {
    expect(SCRIPT_DE_ENVIO_RAW).not.toMatch(/Invoke-Expression/iu);
    expect(SCRIPT_DE_ENVIO_RAW).not.toMatch(/\biex\b/iu);
    expect(SCRIPT_DE_ENVIO_RAW).not.toMatch(/ScriptBlock\]::Create/iu);
    expect(SCRIPT_DE_ENVIO_RAW).not.toMatch(/Invoke-Command/iu);
  });

  it('el nombre se lee UNA vez de su variable y solo se usa como valor', () => {
    expect(SCRIPT_DE_ENVIO_RAW.match(/\$env:POS_IMPRESION_NOMBRE/gu)?.length).toBe(1);
    expect(SCRIPT_DE_ENVIO_RAW).toContain('$nombre = $env:POS_IMPRESION_NOMBRE');
    // Los tres usos de $nombre son argumentos de una llamada, nunca parte de un texto que se ejecute.
    const usos = SCRIPT_DE_ENVIO_RAW.split('\n').filter((l) => l.includes('$nombre')).map((l) => l.trim());
    expect(usos).toHaveLength(4);
    expect(usos[0]).toBe('$nombre = $env:POS_IMPRESION_NOMBRE');
    expect(usos[1]).toContain('[PosImpresionRaw]::Enviar($nombre, $datos)');
    expect(usos[2]).toContain('Get-PrintJob -PrinterName $nombre -ID $trabajo');
    expect(usos[3]).toContain('Get-Printer -Name $nombre -ErrorAction Stop');
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
    const bytes = new Uint8Array([0x1b, 0x40, 0x41]);
    const lanzamiento = await lanzarCon('POS-80', bytes, { PATH: 'x' });
    expect(lanzamiento.comando).toBe('powershell.exe');
    expect(lanzamiento.opciones.windowsHide).toBe(true);
    expect(lanzamiento.opciones.env.POS_IMPRESION_NOMBRE).toBe('POS-80');
    expect(lanzamiento.opciones.env.POS_IMPRESION_DATOS).toBe(Buffer.from(bytes).toString('base64'));
    expect(lanzamiento.opciones.env.PATH).toBe('x');
    // Lo único que el envío agrega al entorno son sus dos variables de datos.
    expect(Object.keys(lanzamiento.opciones.env).filter((k) => k.startsWith('POS_')).sort()).toEqual([...VARIABLES_DEL_ENVIO].sort());
  });
});

/** Lanza un envío con un proceso de mentira que contesta OK, y devuelve cómo se lanzó. */
async function lanzarCon(nombre: string, bytes: Uint8Array, entorno: NodeJS.ProcessEnv = {}): Promise<Lanzamiento> {
  const visto: { lanzamiento: Lanzamiento | null } = { lanzamiento: null };
  const enviador = new EnviadorPorPowerShell({
    plataforma: 'win32',
    entorno,
    lanzar: lanzadorQueAnota((l) => {
      visto.lanzamiento = l;
      l.proceso.stdout.emit('data', Buffer.from(`${JSON.stringify(OK)}\n`));
      l.proceso.emit('close', 0);
    }),
  });
  await enviador.enviar(nombre, bytes);
  if (visto.lanzamiento === null) {
    throw new Error('No se lanzó ningún proceso.');
  }
  return visto.lanzamiento;
}

// ===========================================================================
describe('Un nombre de impresora hostil NO altera el comando ni ejecuta nada distinto', () => {
  /*
    Mismo principio que las funciones SECURITY DEFINER de la sincronización:
    el dato nunca se arma como texto de código. Si el nombre llegara a la línea
    de comandos o al script, cualquiera de estos cambiaría lo que corre.
  */
  const NOMBRES_HOSTILES = [
    'POS-80 "con comillas"',
    "POS'; Remove-Item C:\\ -Recurse; '",
    'POS"; Start-Process calc; "',
    'POS`; calc`',
    'POS $(Start-Process calc)',
    'a;b;c',
    'POS & calc & rem',
    'POS | Out-File C:\\pwned.txt',
    'POS\n; calc',
    '@\'\n; calc\n\'@',
  ];
  const bytes = new Uint8Array([0x1b, 0x40]);

  it('control: con un nombre común, la línea de comandos es la esperada', async () => {
    const lanzamiento = await lanzarCon('POS-80', bytes);
    expect(lanzamiento.argumentos).toEqual(ARGUMENTOS_DE_POWERSHELL);
  });

  for (const nombre of NOMBRES_HOSTILES) {
    it(`${JSON.stringify(nombre)}: los argumentos son idénticos a los de un nombre común y el nombre solo está en su variable`, async () => {
      const comun = await lanzarCon('POS-80', bytes);
      const hostil = await lanzarCon(nombre, bytes);

      expect(hostil.comando).toBe('powershell.exe');
      expect(hostil.argumentos).toEqual(comun.argumentos);
      // Cada argumento es de un alfabeto sin espacios, comillas, ; ni `:
      // no hay nada que Windows tenga que escapar al armar la línea.
      for (const argumento of hostil.argumentos) {
        expect(argumento).toMatch(/^[-A-Za-z0-9+/=]+$/u);
      }
      // El script que corre es la constante, byte a byte, y no contiene el nombre.
      const script = Buffer.from(hostil.argumentos.at(-1) ?? '', 'base64').toString('utf16le');
      expect(script).toBe(SCRIPT_DE_ENVIO_RAW);
      expect(script.includes(nombre)).toBe(false);
      // El nombre llega sin tocar, como dato.
      expect(hostil.opciones.env.POS_IMPRESION_NOMBRE).toBe(nombre);
    });
  }
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
