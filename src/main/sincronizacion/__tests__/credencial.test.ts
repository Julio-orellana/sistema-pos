import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlmacenDeCredencial, ARCHIVO_DE_CREDENCIAL, type CifradoSeguro } from '../credencial';

/*
  ===========================================================================
  QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO PUEDE PROBAR
  ===========================================================================

  El cifrado se inyecta, porque las pruebas corren en Node puro y `safeStorage`
  vive en Electron (`vitest.config.ts`). Con un cifrado de mentira se prueba
  **el contrato del almacén**: que siempre pase por el cifrado, que nunca
  escriba el texto tal cual, que se niegue a guardar si no hay cifrado
  disponible y que un archivo ilegible no tumbe la aplicación.

  **Lo que ESTO NO PRUEBA es que DPAPI o el llavero de macOS cifren de
  verdad.** Eso depende de Electron y del sistema operativo, no de este código,
  y comprobarlo exige la aplicación real corriendo. Queda dicho acá para que
  nadie lea este archivo como si cubriera esa mitad.
*/

/**
 * Un cifrado de mentira que SÍ transforma los bytes: invierte el texto y le
 * aplica un XOR.
 *
 * No es criptografía y no pretende serlo. Lo que importa es que el texto
 * original **no aparezca** en la salida, para que la prueba de «no queda en
 * texto plano» signifique algo. Un doble que devolviera el mismo texto haría
 * pasar esa prueba sin que probara nada.
 */
class CifradoDeMentira implements CifradoSeguro {
  public disponible = true;
  public vecesQueCifro = 0;

  private static readonly MASCARA = 0x5a;

  public isEncryptionAvailable(): boolean {
    return this.disponible;
  }

  public encryptString(texto: string): Buffer {
    this.vecesQueCifro += 1;
    // Se invierten los BYTES, no los caracteres: `[...texto].reverse()`
    // rompería cualquier carácter fuera del plano básico, y acá lo único que
    // importa es que la salida no contenga el texto original.
    const bytes = Buffer.from(Buffer.from(texto, 'utf8')).reverse();
    return Buffer.from(bytes.map((b) => b ^ CifradoDeMentira.MASCARA));
  }

  public decryptString(cifrado: Buffer): string {
    const bytes = Buffer.from(cifrado.map((b) => b ^ CifradoDeMentira.MASCARA)).reverse();
    return bytes.toString('utf8');
  }
}

const TOKEN_DE_REFRESCO = 'v1.MRFcXaKq7yPd-token-de-refresco-de-mentira-pero-largo';

describe('El almacén de la credencial de la nube', () => {
  let carpeta: string;
  let cifrado: CifradoDeMentira;
  let almacen: AlmacenDeCredencial;

  beforeEach(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'pos-credencial-'));
    cifrado = new CifradoDeMentira();
    almacen = new AlmacenDeCredencial(carpeta, cifrado);
  });

  afterEach(() => {
    rmSync(carpeta, { recursive: true, force: true });
  });

  const rutaEsperada = (): string => join(carpeta, ARCHIVO_DE_CREDENCIAL);

  describe('Guardar', () => {
    it('guarda el token y lo devuelve igual al leerlo', () => {
      almacen.guardar(TOKEN_DE_REFRESCO);

      expect(almacen.leer()).toBe(TOKEN_DE_REFRESCO);
    });

    it('EL TOKEN NO QUEDA EN TEXTO PLANO en el archivo', () => {
      almacen.guardar(TOKEN_DE_REFRESCO);

      const crudo = readFileSync(rutaEsperada());

      expect(crudo.toString('utf8')).not.toContain(TOKEN_DE_REFRESCO);
      expect(crudo.toString('latin1')).not.toContain(TOKEN_DE_REFRESCO);
      expect(crudo.includes(Buffer.from(TOKEN_DE_REFRESCO, 'utf8'))).toBe(false);
    });

    it('pasa SIEMPRE por el cifrado del sistema: no hay ningún camino que lo saltee', () => {
      almacen.guardar(TOKEN_DE_REFRESCO);

      expect(cifrado.vecesQueCifro).toBe(1);
    });

    it('el archivo se llama sincronizacion.credencial y vive en la carpeta de datos', () => {
      almacen.guardar(TOKEN_DE_REFRESCO);

      expect(almacen.rutaDelArchivo()).toBe(rutaEsperada());
      expect(existsSync(rutaEsperada())).toBe(true);
    });

    it('rechaza un token vacío en vez de guardar un archivo inútil', () => {
      expect(() => {
        almacen.guardar('');
      }).toThrow(/vacío/);
      expect(existsSync(rutaEsperada())).toBe(false);
    });

    it('guardar otra vez REEMPLAZA el token anterior, porque el de refresco rota', () => {
      almacen.guardar(TOKEN_DE_REFRESCO);
      almacen.guardar('v1.el-siguiente-de-la-rotacion');

      expect(almacen.leer()).toBe('v1.el-siguiente-de-la-rotacion');
    });
  });

  describe('SIN cifrado disponible NO se guarda nada, y se dice por qué', () => {
    beforeEach(() => {
      cifrado.disponible = false;
    });

    it('lanza en vez de escribir el token en claro', () => {
      expect(() => {
        almacen.guardar(TOKEN_DE_REFRESCO);
      }).toThrow(/NO se guardó/);
    });

    it('NO deja ningún archivo detrás', () => {
      expect(() => {
        almacen.guardar(TOKEN_DE_REFRESCO);
      }).toThrow();

      expect(existsSync(rutaEsperada())).toBe(false);
    });

    it('el mensaje explica que el texto plano no es una opción', () => {
      expect(() => {
        almacen.guardar(TOKEN_DE_REFRESCO);
      }).toThrow(/texto plano/);
    });

    it('con un archivo guardado antes, leer devuelve null con motivo en vez de reventar', () => {
      // El archivo lo dejó una corrida anterior, cuando el cifrado SÍ estaba;
      // es el caso de una máquina que perdió el llavero, no el de una recién
      // instalada.
      writeFileSync(rutaEsperada(), cifrado.encryptString(TOKEN_DE_REFRESCO));

      expect(almacen.leer()).toBeNull();
      expect(almacen.ultimoMotivo).toMatch(/no está disponible/);
    });

    it('SIN archivo, la falta de cifrado no inventa un problema: no hay credencial y punto', () => {
      expect(almacen.leer()).toBeNull();
      expect(almacen.ultimoMotivo).toBeNull();
    });
  });

  describe('Leer', () => {
    it('sin archivo devuelve null y no inventa un motivo', () => {
      expect(almacen.leer()).toBeNull();
      expect(almacen.ultimoMotivo).toBeNull();
    });

    it('un archivo que NO se puede descifrar devuelve null con motivo, sin tumbar la aplicación', () => {
      writeFileSync(rutaEsperada(), Buffer.from('basura que no descifra'));
      vi.spyOn(cifrado, 'decryptString').mockImplementation(() => {
        throw new Error('no se pudo descifrar en esta cuenta de Windows');
      });

      expect(almacen.leer()).toBeNull();
      expect(almacen.ultimoMotivo).toMatch(/no se pudo descifrar/);
    });

    it('un archivo que descifra a cadena vacía se trata como si no hubiera credencial', () => {
      writeFileSync(rutaEsperada(), cifrado.encryptString('x'));
      vi.spyOn(cifrado, 'decryptString').mockReturnValue('');

      expect(almacen.leer()).toBeNull();
      expect(almacen.ultimoMotivo).toMatch(/vacía/);
    });
  });

  describe('Estado y borrado', () => {
    it('el estado dice si hay archivo y si esta máquina puede descifrar', () => {
      expect(almacen.estado()).toEqual({ existe: false, cifradoDisponible: true });

      almacen.guardar(TOKEN_DE_REFRESCO);

      expect(almacen.estado()).toEqual({ existe: true, cifradoDisponible: true });
    });

    it('borrar quita el archivo', () => {
      almacen.guardar(TOKEN_DE_REFRESCO);
      almacen.borrar();

      expect(existsSync(rutaEsperada())).toBe(false);
      expect(almacen.leer()).toBeNull();
    });

    it('borrar sin credencial guardada no falla', () => {
      expect(() => {
        almacen.borrar();
      }).not.toThrow();
    });
  });

  describe('Permisos del archivo', () => {
    /*
      `chmod` no aplica en Windows —ahí manda la ACL— así que esta prueba se
      salta sola en esa plataforma en vez de fallar por algo que no es un
      defecto. Windows sigue siendo la plataforma de producción y esta
      comprobación NO cubre su caso: lo que protege allá es DPAPI, no el modo.
    */
    const soloPosix = process.platform === 'win32' ? it.skip : it;

    soloPosix('queda legible solo para el dueño (0600)', () => {
      almacen.guardar(TOKEN_DE_REFRESCO);

      const modo = statSync(rutaEsperada()).mode & 0o777;

      expect(modo.toString(8)).toBe('600');
    });

    soloPosix('un archivo que YA existía con permisos amplios queda en 0600 al reescribirlo', () => {
      writeFileSync(rutaEsperada(), 'viejo', { mode: 0o644 });

      almacen.guardar(TOKEN_DE_REFRESCO);

      expect((statSync(rutaEsperada()).mode & 0o777).toString(8)).toBe('600');
    });
  });
});
