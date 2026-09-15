/**
 * El instalador de Windows lleva la marca «Vixo POS» y la licencia, y NO toca
 * la identidad de la aplicación (§4.48 de CLAUDE.md).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTA PRUEBA EXISTE
 * ---------------------------------------------------------------------------
 * `productName` fija la carpeta de datos (%APPDATA%\POS Jimmy Cano\) y la
 * llave con que safeStorage cifra la credencial de la nube y el secreto TOTP
 * (§4.23, §4.37). Cambiarlo deja inaccesible toda instalación existente, y
 * nada fallaría en desarrollo: la aplicación de desarrollo se llama
 * `pos-agricola` y ni se enteraría. Esta prueba es lo que falla primero.
 *
 * El texto de la licencia es un documento legal: se fija por su huella, para
 * que ningún cambio (ni un espacio) entre sin que alguien lo lea. Y se exige
 * que no aparezca la cláusula de penalidad, que va solo en el contrato de
 * servicios firmado con cada cliente.
 *
 * Lo que esta prueba NO puede decir: qué muestra Windows. Eso se inspeccionó
 * sobre el instalador armado y queda pendiente de confirmar instalando.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EMISOR_DEL_CODIGO_REMOTO } from '@main/domain/usuarios/totp';

const RAIZ = process.cwd();
const requerir = createRequire(import.meta.url);
// js-yaml viaja con electron-builder, que es quien lee este archivo.
const yaml = requerir('js-yaml') as { load: (texto: string) => unknown };

interface ConfiguracionDelInstalador {
  appId: string;
  productName: string;
  copyright: string;
  extraMetadata: { productName: string; author: { name: string } };
  win: { executableName: string };
  nsis: {
    oneClick: boolean;
    license: string;
    include: string;
    installerLanguages: string[];
    language: string;
    createDesktopShortcut: boolean;
    createStartMenuShortcut: boolean;
    shortcutName: string;
    uninstallDisplayName: string;
  };
}

const config = yaml.load(readFileSync(join(RAIZ, 'electron-builder.yml'), 'utf8')) as ConfiguracionDelInstalador;
const paqueteDelRepositorio = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as Record<string, unknown>;

/**
 * sha256 del texto de la licencia sin BOM y con saltos LF: el texto exacto que
 * aprobó Julio el 2026-09-15, con la única corrección que pidió después
 * («a el/la» → «al/a la»). Huella anterior a esa corrección:
 * 8c6bf039d701e96bc141c4b01beab29c798753d6d736d2b306b00043add1daff.
 */
const HUELLA_DE_LA_LICENCIA = 'bd9897f4c73cd8ad39e0ce69effb8cc8a5e108b3d01ad16438322b6637bbbaa7';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function leerLicencia(): { bytes: Buffer; texto: string } {
  const bytes = readFileSync(join(RAIZ, config.nsis.license));
  const sinBom = bytes.subarray(0, 3).equals(BOM) ? bytes.subarray(3) : bytes;
  return { bytes, texto: sinBom.toString('utf8') };
}

describe('LA IDENTIDAD DE LA APLICACIÓN NO CAMBIA con la marca', () => {
  it('productName sigue siendo «POS Jimmy Cano», arriba y en el package.json que viaja en el paquete', () => {
    expect(config.productName).toBe('POS Jimmy Cano');
    expect(config.extraMetadata.productName).toBe('POS Jimmy Cano');
  });

  it('appId no cambió: de él salen la clave de desinstalación y la actualización sobre la instalación anterior', () => {
    expect(config.appId).toBe('gt.posagricola.desktop');
  });

  it('el ejecutable sigue llamándose «POS Jimmy Cano»: de su nombre dependen la carpeta de instalación y los accesos directos que apuntan a él', () => {
    expect(config.win.executableName).toBe('POS Jimmy Cano');
  });

  it('el package.json del repositorio no tiene productName y su autor sigue siendo Julio Orellana', () => {
    expect(paqueteDelRepositorio.productName).toBeUndefined();
    expect(paqueteDelRepositorio.author).toBe('Julio Orellana');
  });
});

describe('La marca «Vixo POS» en los metadatos', () => {
  it('el publicador del paquete es la misma marca que el emisor del código remoto', () => {
    expect(config.extraMetadata.author.name).toBe('Vixo POS');
    expect(config.extraMetadata.author.name).toBe(EMISOR_DEL_CODIGO_REMOTO);
  });

  it('los accesos directos y «Programas y características» dicen «Vixo POS» (son solo nombres visibles)', () => {
    expect(config.nsis.shortcutName).toBe('Vixo POS');
    expect(config.nsis.uninstallDisplayName).toBe('Vixo POS');
  });

  it('el copyright nombra la marca', () => {
    expect(config.copyright).toContain('Vixo POS');
  });
});

describe('La pantalla de licencia', () => {
  it('el instalador es asistido y apunta a un archivo de licencia que existe', () => {
    expect(config.nsis.oneClick).toBe(false);
    expect(config.nsis.license).toBe('build/licencia.txt');
    expect(existsSync(join(RAIZ, config.nsis.license))).toBe(true);
  });

  it('el texto es EXACTAMENTE el aprobado (huella del texto sin BOM y con LF)', () => {
    const { texto } = leerLicencia();
    const huella = createHash('sha256').update(texto.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
    expect(huella).toBe(HUELLA_DE_LA_LICENCIA);
  });

  it('la versión que dice la licencia es la del package.json: el instalador no puede decir una versión y la licencia otra', () => {
    const version = /^Versión: (.+)$/m.exec(leerLicencia().texto.replace(/\r\n/g, '\n'));
    expect(version?.[1]).toBe(paqueteDelRepositorio.version);
  });

  it('NO lleva la cláusula de penalidad: esa va solo en el contrato de servicios', () => {
    const { texto } = leerLicencia();
    expect(texto.toLowerCase()).not.toMatch(/penalidad|penaliz|multa|indemniz|cláusula penal/);
  });

  it('el archivo va en UTF-8 con BOM y con CRLF en todas las líneas', () => {
    const { bytes } = leerLicencia();
    expect(bytes.subarray(0, 3).equals(BOM)).toBe(true);
    const saltos = bytes.toString('latin1');
    expect(saltos.match(/\r\n/g)?.length).toBe(saltos.match(/\n/g)?.length);
  });

  it('la licencia dice «Acepto» y el instalador solo carga el español, donde el botón es «Acepto»', () => {
    expect(leerLicencia().texto).toContain('"Acepto"');
    expect(config.nsis.installerLanguages).toEqual(['es_ES']);
    expect(config.nsis.language).toBe('3082');
  });
});

describe('El acceso directo del escritorio es opcional', () => {
  const script = readFileSync(join(RAIZ, 'build', 'instalador.nsh'), 'utf8');
  const sinComentarios = script
    .split('\n')
    .filter((linea) => !linea.trimStart().startsWith(';'))
    .join('\n');

  it('electron-builder lo sigue creando (y su desinstalador lo sigue borrando), y el script propio está incluido', () => {
    expect(config.nsis.createDesktopShortcut).toBe(true);
    expect(config.nsis.createStartMenuShortcut).toBe(true);
    expect(config.nsis.include).toBe('build/instalador.nsh');
  });

  it('hay una página con la casilla, después de elegir la carpeta', () => {
    expect(sinComentarios).toContain('!macro customPageAfterChangeDir');
    expect(sinComentarios).toMatch(/\$\{NSD_CreateCheckbox\}.*"Crear un acceso directo en el escritorio"/);
  });

  it('el acceso directo se quita SOLO si la persona desmarcó la casilla; en silencioso se conserva', () => {
    expect(sinComentarios).toMatch(
      /!macro customInstall\s+\$\{if\} \$omitirAccesoEnEscritorio == "1"\s+WinShell::UninstShortcut "\$newDesktopLink"\s+Delete "\$newDesktopLink"\s+\$\{endif\}/,
    );
  });
});

describe('El título del asistente dice «Vixo POS» sin tocar nada más', () => {
  const script = readFileSync(join(RAIZ, 'build', 'instalador.nsh'), 'utf8');
  const sinComentarios = script
    .split('\n')
    .filter((linea) => !linea.trimStart().startsWith(';'))
    .join('\n');

  it('usa Caption, solo en el instalador', () => {
    expect(sinComentarios).toContain('Caption "Instalación de Vixo POS"');
    const inicioGuarda = sinComentarios.indexOf('!ifndef BUILD_UNINSTALLER');
    expect(inicioGuarda).toBeGreaterThanOrEqual(0);
    expect(sinComentarios.indexOf('Caption')).toBeGreaterThan(inicioGuarda);
  });

  it('el nombre visible del asistente es «Vixo POS», redefinido ANTES de que common.nsh lo use, para instalador y desinstalador', () => {
    expect(sinComentarios).toMatch(/!undef PRODUCT_NAME\s+!endif\s+!define PRODUCT_NAME "Vixo POS"/);
    expect(sinComentarios.indexOf('!define PRODUCT_NAME')).toBeLessThan(sinComentarios.indexOf('!ifndef BUILD_UNINSTALLER'));
  });

  it('no redefine Name ni ningún identificador que electron-builder use para rutas, registro o el ejecutable', () => {
    expect(sinComentarios).not.toMatch(/^\s*Name\s/m);
    expect(sinComentarios).not.toMatch(/!(define|undef)\s+(PRODUCT_FILENAME|APP_FILENAME|APP_PRODUCT_FILENAME|APP_EXECUTABLE_FILENAME|UNINSTALL_FILENAME|APP_ID|APP_GUID|UNINSTALL_APP_KEY|INSTALL_REGISTRY_KEY|UNINSTALL_REGISTRY_KEY)\b/);
    expect(sinComentarios).not.toMatch(/userData|productName/i);
    expect(sinComentarios).not.toMatch(/\$APPDATA/);
  });
});
