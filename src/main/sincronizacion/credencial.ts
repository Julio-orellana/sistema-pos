/**
 * Dónde y cómo se guarda la credencial de la terminal (§1.4 del diseño).
 *
 * ===========================================================================
 * LO ÚNICO QUE SE GUARDA ES EL TOKEN DE REFRESCO
 * ===========================================================================
 *
 * No la contraseña, no el access token, no el correo.
 *
 *  · **La contraseña** se teclea una vez, viaja a Auth y se descarta en ese
 *    mismo momento (§1.3). Es lo que convierte el archivo en «una sesión y no
 *    una contraseña»: quien lo lea consigue actuar como la terminal, pero no
 *    consigue la contraseña, que es lo que además serviría para volver a
 *    entrar después de que la sesión se revoque.
 *  · **El access token** vive 900 segundos: guardarlo en disco solo agregaría
 *    una copia de algo que caduca antes de que a nadie le sirva encontrarla.
 *  · **El correo** tampoco hace falta, y por eso no está: el access token lo
 *    trae en sus claims, así que la pantalla puede decir con quién está
 *    conectada sin que el disco lo guarde. Un dato que no se guarda es un dato
 *    que no se filtra.
 *
 * El archivo es, entonces, **el token de refresco cifrado y nada más**. Sin
 * envoltorio JSON, sin número de versión: cualquier campo extra sería una
 * excepción a la regla de arriba que después habría que justificar.
 *
 * ===========================================================================
 * NUNCA, BAJO NINGUNA CIRCUNSTANCIA, SE ESCRIBE EN TEXTO PLANO
 * ===========================================================================
 *
 * `safeStorage.isEncryptionAvailable()` puede dar `false`: en Linux sin
 * llavero, o si se lo llama antes de que la aplicación esté lista. En ese caso
 * esta clase **se niega a guardar y lanza**. La alternativa —escribirlo en
 * claro «por esta vez»— dejaría un token de refresco legible en el disco de la
 * tienda, que es exactamente lo que este archivo existe para impedir, y lo
 * haría en silencio. Es la misma regla que hizo que los guiones de datos de
 * ejemplo dejaran de salir callados (CLAUDE.md §4.11): **fallar ruidosamente
 * antes que hacer algo distinto de lo que se prometió.**
 *
 * ===========================================================================
 * QUÉ PROTEGE ESTO Y QUÉ NO
 * ===========================================================================
 *
 * `safeStorage` usa DPAPI en Windows y el llavero en macOS, o sea que cifra
 * con material derivado de la CUENTA del sistema operativo. Protege contra
 * quien se lleve el disco sin la contraseña de esa cuenta. **No protege contra
 * quien encienda la máquina y entre como ese usuario**, y una terminal en modo
 * kiosko probablemente inicie sesión sola. §1.4 del diseño lo dice sin
 * adornos: la credencial **es extraíble**, y el trabajo de verdad es acotar lo
 * que puede hacer (§1.5), no esconderla mejor.
 */

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nombre del archivo dentro de la carpeta de datos de la aplicación. */
export const ARCHIVO_DE_CREDENCIAL = 'sincronizacion.credencial';

/**
 * Permisos del archivo: solo el dueño lee y escribe.
 *
 * En Windows no hace nada —`chmod` es un no-op ahí y quien manda es la ACL—,
 * pero en macOS y Linux evita que quede legible para todo el mundo. Es defensa
 * en profundidad barata: el cifrado sigue siendo la protección real.
 */
const SOLO_EL_DUENO = 0o600;

/**
 * Lo que este módulo necesita de `safeStorage` de Electron.
 *
 * **Es una interfaz y no un `import { safeStorage } from 'electron'` directo**
 * porque las pruebas corren en Node puro, sin Electron (ver `vitest.config.ts`).
 * Con la interfaz, una prueba puede inyectar un cifrado de mentira y además
 * comprobar el caso que en una máquina de desarrollo no se puede provocar: que
 * el cifrado NO esté disponible.
 */
export interface CifradoSeguro {
  isEncryptionAvailable(): boolean;
  encryptString(texto: string): Buffer;
  decryptString(cifrado: Buffer): string;
}

/** Lo que se pudo averiguar del archivo de credencial sin descifrarlo. */
export interface EstadoDeLaCredencial {
  /** `true` si el archivo existe. No dice si su contenido sirve. */
  readonly existe: boolean;
  /** `false` si esta máquina no puede descifrar (sin llavero, por ejemplo). */
  readonly cifradoDisponible: boolean;
}

/** Guarda y recupera el token de refresco de la terminal, siempre cifrado. */
export class AlmacenDeCredencial {
  private readonly ruta: string;

  public constructor(
    carpetaDeDatos: string,
    private readonly cifrado: CifradoSeguro,
  ) {
    this.ruta = join(carpetaDeDatos, ARCHIVO_DE_CREDENCIAL);
  }

  /** Dónde vive el archivo. Lo usan la pantalla de diagnóstico y las pruebas. */
  public rutaDelArchivo(): string {
    return this.ruta;
  }

  public estado(): EstadoDeLaCredencial {
    return {
      existe: existsSync(this.ruta),
      cifradoDisponible: this.cifrado.isEncryptionAvailable(),
    };
  }

  /**
   * Guarda el token de refresco, cifrado.
   *
   * Lanza si el cifrado no está disponible. Ver la cabecera: no hay respaldo
   * en texto plano y no lo va a haber.
   */
  public guardar(tokenDeRefresco: string): void {
    if (tokenDeRefresco === '') {
      throw new Error('No se puede guardar un token de refresco vacío.');
    }
    if (!this.cifrado.isEncryptionAvailable()) {
      throw new Error(
        'El almacenamiento cifrado del sistema no está disponible, así que la credencial NO se guardó. ' +
          'Guardarla en texto plano dejaría el token de refresco legible en el disco, y eso no se hace.',
      );
    }

    writeFileSync(this.ruta, this.cifrado.encryptString(tokenDeRefresco), { mode: SOLO_EL_DUENO });
    try {
      // `writeFileSync` solo aplica `mode` cuando CREA el archivo: si ya
      // existía, conserva los permisos que tuviera. Sin esto, un archivo
      // creado antes con permisos amplios se quedaría así para siempre.
      chmodSync(this.ruta, SOLO_EL_DUENO);
    } catch {
      // En Windows `chmod` no aplica y puede fallar. No es motivo para
      // descartar una credencial que ya quedó bien guardada y cifrada.
    }
  }

  /**
   * Devuelve el token de refresco, o `null` si no hay ninguno guardado.
   *
   * Un archivo que existe pero no se puede descifrar también devuelve `null`,
   * con el motivo en `ultimoMotivo`: pasa cuando el archivo se copió de otra
   * máquina o de otra cuenta de Windows, y el camino correcto es el mismo que
   * cuando no hay nada —volver a conectar desde la pantalla— y no reventar el
   * arranque de la aplicación.
   */
  public leer(): string | null {
    this.ultimaLecturaIlegible = false;
    if (!existsSync(this.ruta)) {
      this.ultimoMotivo = null;
      return null;
    }
    if (!this.cifrado.isEncryptionAvailable()) {
      this.ultimoMotivo = 'El almacenamiento cifrado del sistema no está disponible en esta máquina.';
      return null;
    }
    try {
      const token = this.cifrado.decryptString(readFileSync(this.ruta));
      this.ultimoMotivo = token === '' ? 'La credencial guardada está vacía.' : null;
      this.ultimaLecturaIlegible = token === '';
      return token === '' ? null : token;
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.ultimoMotivo = `La credencial guardada no se pudo descifrar en esta máquina: ${detalle}`;
      this.ultimaLecturaIlegible = true;
      return null;
    }
  }

  /** Por qué la última lectura devolvió `null`, o `null` si no había nada raro. */
  public ultimoMotivo: string | null = null;

  /**
   * `true` cuando la última lectura encontró el archivo y NO lo pudo usar: no
   * se descifró, o descifrado estaba vacío. Es la credencial DAÑADA (§4.52):
   * lo que hay que hacer es reconectar, no esperar a la red.
   *
   * **No incluye «el almacenamiento cifrado no está disponible»**: ahí el
   * archivo puede estar perfecto y lo que falta es el llavero o DPAPI, y
   * reconectar tampoco serviría, porque guardar exige el mismo cifrado.
   */
  public ultimaLecturaIlegible = false;

  /** Borra la credencial. No falla si no había ninguna. */
  public borrar(): void {
    rmSync(this.ruta, { force: true });
    this.ultimoMotivo = null;
    this.ultimaLecturaIlegible = false;
  }
}
