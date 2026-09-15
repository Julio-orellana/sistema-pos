/**
 * Fotos de producto en el disco local.
 *
 * DÓNDE VIVEN Y POR QUÉ: dentro de `app.getPath('userData')`, nunca dentro de
 * la carpeta de instalación de la aplicación. La carpeta de instalación no es
 * escribible de forma confiable en Windows —en `Program Files` hace falta
 * elevación— y además se reemplaza entera en cada actualización, así que las
 * fotos del catálogo desaparecerían al actualizar. `userData` es la misma
 * carpeta donde vive el archivo SQLite, así que respaldar la tienda es
 * respaldar una sola ubicación.
 *
 * QUÉ SE GUARDA EN LA BASE: solo la ruta RELATIVA
 * (`fotos-de-productos/<uuid>.jpg`). La ruta absoluta cambia entre máquinas y
 * entre sistemas operativos; guardarla haría que la base de un respaldo
 * restaurado en otra computadora apuntara a carpetas inexistentes.
 *
 * SUBIR LA IMAGEN A SUPABASE STORAGE NO ES DE ESTE MÓDULO, y sigue sin serlo:
 * desde la fase 3.c la subida existe, pero la hace el trabajador de
 * sincronización leyendo `sync_cola`, igual que con cualquier otra fila. Lo que
 * este módulo sí hace desde esa fase es **reducir la foto a 800 px al
 * guardarla** (ver `redimensionar.ts`), que es lo que hace que subirlas quepa
 * en el plan gratuito.
 *
 * LA RUTA LOCAL NO CAMBIA DE SIGNIFICADO: `foto_path` sigue siendo la ruta
 * relativa EN ESTE DISCO, y no se agregó ninguna columna «ruta en la nube». El
 * objeto de Storage se deriva del nombre del archivo (§2.5.1 del diseño), y una
 * columna nueva sería un segundo lugar donde la misma información puede
 * discrepar.
 *
 * Este módulo NO importa Electron a propósito: recibe la carpeta base por
 * parámetro. Así las pruebas lo ejercitan de verdad, contra archivos reales en
 * una carpeta temporal, sin arrancar la aplicación.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync, mkdirSync, openSync, readSync, readFileSync, closeSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

import type { ArchivoParaSubir } from '@main/database/bandeja-de-salida';
import { ErrorDeNegocio } from '@main/database/errores';
import type { FormatoDeImagen, RedimensionadorDeImagen } from './redimensionar';

/** Subcarpeta de `userData` donde se copian las fotos. */
export const SUBCARPETA_DE_FOTOS = 'fotos-de-productos';

/** Bytes que tiene un megabyte (1024 × 1024). */
const BYTES_POR_MEGABYTE = 1048576;

/**
 * Tamaño máximo aceptado, en megabytes, DEL ARCHIVO QUE SE ELIGE.
 *
 * Es el tope de ENTRADA, no el de lo que queda guardado: desde la fase 3.c la
 * foto se reduce a 800 px de lado mayor al guardarse (`redimensionar.ts`), así
 * que lo que termina en el disco pesa bastante menos. El tope sigue existiendo
 * porque leer y decodificar un archivo enorme cuesta memoria y tiempo antes de
 * poder reducirlo, y porque el bucket `fotos` de la nube lo rechazaría igual:
 * la migración 0026 le puso `file_size_limit` de 5 MB del lado del servidor.
 */
export const MAXIMO_MEGABYTES = 5;

/** Tamaño máximo aceptado, en bytes. */
export const TAMANO_MAXIMO_BYTES = MAXIMO_MEGABYTES * BYTES_POR_MEGABYTE;

/** Cuántos bytes hay que leer para reconocer la firma de un formato. */
const BYTES_DE_FIRMA = 8;

/**
 * Formatos aceptados, con su firma binaria escrita en hexadecimal.
 *
 * SE COMPRUEBA LA FIRMA, NO SOLO LA EXTENSIÓN. Cambiarle el nombre a un
 * archivo es gratis: `virus.exe` renombrado a `foto.png` pasaría cualquier
 * comprobación de extensión. Los primeros bytes de un archivo sí dicen qué es
 * de verdad, y esa es la comprobación que decide.
 *
 * La firma va como cadena hexadecimal y no como lista de números porque así se
 * lee igual que en la documentación de cada formato, y porque una lista de
 * literales numéricos sueltos es exactamente lo que la regla de "números
 * mágicos" de este proyecto existe para evitar.
 */
const FORMATOS_ACEPTADOS = [
  {
    nombre: 'JPEG',
    extensiones: ['.jpg', '.jpeg'],
    /** Marcador SOI (`FFD8`) seguido del inicio de otro marcador (`FF`). */
    firmaHex: 'ffd8ff',
    extensionCanonica: '.jpg',
    formato: 'jpeg' as FormatoDeImagen,
  },
  {
    nombre: 'PNG',
    extensiones: ['.png'],
    /** Firma fija de 8 bytes definida por la especificación del PNG. */
    firmaHex: '89504e470d0a1a0a',
    extensionCanonica: '.png',
    formato: 'png' as FormatoDeImagen,
  },
] as const;

/** Extensiones que se le ofrecen al diálogo nativo de selección de archivo. */
export const EXTENSIONES_DE_IMAGEN: readonly string[] = FORMATOS_ACEPTADOS.flatMap((formato) =>
  formato.extensiones.map((extension) => extension.replace('.', '')),
);

/**
 * Lee los primeros bytes de un archivo, en hexadecimal, sin cargarlo entero en
 * memoria: una imagen de 5 MB no tiene por qué entrar en RAM para saber si es
 * una imagen.
 */
export function leerFirmaHex(ruta: string): string {
  const descriptor = openSync(ruta, 'r');
  try {
    const bufer = Buffer.alloc(BYTES_DE_FIRMA);
    const leidos = readSync(descriptor, bufer, 0, BYTES_DE_FIRMA, 0);
    return bufer.subarray(0, leidos).toString('hex');
  } finally {
    closeSync(descriptor);
  }
}

/** Redondea a un decimal, solo para el texto de un mensaje de error. */
function enMegabytes(bytes: number): string {
  const DECIMALES = 1;
  return (bytes / BYTES_POR_MEGABYTE).toFixed(DECIMALES);
}

/**
 * Resuelve la ruta absoluta de una foto y comprueba que caiga DENTRO de la
 * carpeta de fotos.
 *
 * Es la barrera contra el recorrido de directorios: sin ella, un valor como
 * `../../../etc/passwd` guardado en `productos.foto_path` haría que la
 * aplicación sirviera cualquier archivo del disco a la ventana. Se exporta
 * aparte porque es una función pura y se prueba por su cuenta.
 */
export function resolverRutaDeFoto(carpetaBase: string, rutaRelativa: string): string {
  const carpetaDeFotos = resolve(join(carpetaBase, SUBCARPETA_DE_FOTOS));

  if (isAbsolute(rutaRelativa)) {
    throw new ErrorDeNegocio(
      'DATO_INVALIDO',
      'La ruta de la foto no es válida.',
      `ruta absoluta rechazada: ${rutaRelativa}`,
    );
  }

  const candidata = resolve(join(carpetaBase, normalize(rutaRelativa)));

  if (candidata !== carpetaDeFotos && !candidata.startsWith(carpetaDeFotos + sep)) {
    throw new ErrorDeNegocio(
      'DATO_INVALIDO',
      'La ruta de la foto no es válida.',
      `ruta fuera de la carpeta de fotos: ${rutaRelativa}`,
    );
  }

  return candidata;
}

/** Guarda y localiza las fotos de producto. */
export class AlmacenDeFotos {
  private readonly carpetaBase: string;

  private readonly redimensionador: RedimensionadorDeImagen;

  /**
   * @param carpetaBase Normalmente `app.getPath('userData')`.
   * @param redimensionador Quien reduce la imagen a 800 px de lado mayor.
   *
   * **El redimensionador es OBLIGATORIO, no opcional, y es deliberado.** Uno
   * opcional dejaría que cualquier sitio de construcción que se olvidara de
   * pasarlo guardara las fotos enteras **en silencio**, y el síntoma —el
   * gigabyte de Storage lleno— aparecería meses después y lejos de la causa.
   * Es la misma razón por la que `DependenciasDeAutenticacion.base` se hizo
   * obligatoria en la fase 3.b (§4.25): que el compilador obligue a contestar
   * la pregunta.
   */
  public constructor(carpetaBase: string, redimensionador: RedimensionadorDeImagen) {
    this.carpetaBase = carpetaBase;
    this.redimensionador = redimensionador;
  }

  /** Carpeta absoluta donde se copian las fotos. */
  public carpetaDeFotos(): string {
    return join(this.carpetaBase, SUBCARPETA_DE_FOTOS);
  }

  /**
   * Copia una imagen elegida por el usuario y devuelve su ruta RELATIVA.
   *
   * El nombre de destino es un UUID nuevo, no el nombre original: dos personas
   * pueden elegir dos archivos distintos llamados `foto.jpg`, y el segundo
   * pisaría la foto del primer producto sin que nadie se enterara.
   */
  public guardar(rutaOrigen: string): string {
    const extension = extname(rutaOrigen).toLocaleLowerCase('en');
    const formato = FORMATOS_ACEPTADOS.find((candidato) =>
      (candidato.extensiones as readonly string[]).includes(extension),
    );

    if (formato === undefined) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'La foto tiene que ser un archivo JPG o PNG.',
        `extensión no admitida: ${extension === '' ? '(sin extensión)' : extension}`,
      );
    }

    let tamano: number;
    try {
      tamano = statSync(rutaOrigen).size;
    } catch {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'No se pudo leer el archivo de la foto. ¿Sigue estando donde lo elegiste?',
        `no se pudo leer: ${rutaOrigen}`,
      );
    }

    if (tamano > TAMANO_MAXIMO_BYTES) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `La foto pesa ${enMegabytes(tamano)} MB y el máximo es ${String(MAXIMO_MEGABYTES)} MB. Elegí una imagen más liviana.`,
        `tamaño ${String(tamano)} bytes sobre un máximo de ${String(TAMANO_MAXIMO_BYTES)}.`,
      );
    }

    // La extensión ya coincidía; ahora se comprueba que el CONTENIDO sea
    // realmente esa imagen. Un archivo renombrado se cae aquí.
    if (!leerFirmaHex(rutaOrigen).startsWith(formato.firmaHex)) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El archivo dice ser ${formato.nombre} pero su contenido no lo es. Elegí una imagen JPG o PNG de verdad.`,
        `firma binaria que no corresponde a ${formato.nombre}: ${rutaOrigen}`,
      );
    }

    const nombreDestino = `${randomUUID()}${formato.extensionCanonica}`;
    const rutaDestino = join(this.carpetaDeFotos(), nombreDestino);
    mkdirSync(this.carpetaDeFotos(), { recursive: true });

    /*
      SE REDUCE AL GUARDAR, no solo al subir (§2.5.3 del diseño, decisión 7).
      `reducir` devuelve `null` cuando la imagen ya cabía en 800 px, y ahí se
      copia el archivo original tal cual: re-encodar una foto que ya estaba
      bien la degrada sin ahorrar nada.
    */
    const reducida = this.redimensionador.reducir(rutaOrigen, formato.formato);
    if (reducida === null) {
      copyFileSync(rutaOrigen, rutaDestino);
    } else {
      writeFileSync(rutaDestino, reducida);
    }

    // Se guarda con separador '/' siempre, también en Windows: la ruta viaja a
    // la base y de ahí a la nube, y un '\' la volvería ilegible en otro sistema.
    return `${SUBCARPETA_DE_FOTOS}/${nombreDestino}`;
  }

  /** Ruta absoluta de una foto ya guardada, con la barrera de recorrido. */
  public rutaAbsolutaDe(rutaRelativa: string): string {
    return resolverRutaDeFoto(this.carpetaBase, rutaRelativa);
  }

  /**
   * Lo que hay que saber de una foto ya guardada para poder subirla después, o
   * `null` si el archivo no está.
   *
   * EL HASH SE CALCULA AQUÍ Y NO EN UN `worker_thread`, y conviene decir por
   * qué se separa del diseño. §2.5.2 pedía un hilo aparte «porque leer 5 MB y
   * hacer SHA-256 en un i3 son unos cientos de milisegundos que no tienen por
   * qué congelar la ventana». **Esa premisa dejó de valer en esta misma fase**:
   * la foto ya se guardó reducida a 800 px, así que lo que se lee acá son unas
   * decenas o cientos de KB, no 5 MB. Un hilo aparte para eso sería
   * infraestructura para un problema que la reducción ya eliminó.
   *
   * El nombre del objeto en Storage se DERIVA del nombre del archivo, sin
   * columna nueva (§2.5.1): `fotos-de-productos/<uuid>.jpg` sube al bucket
   * `fotos` como `<uuid>.jpg`.
   */
  public describirParaSubir(rutaRelativa: string): ArchivoParaSubir | null {
    const absoluta = this.rutaAbsolutaDe(rutaRelativa);

    let contenido: Buffer;
    try {
      contenido = readFileSync(absoluta);
    } catch {
      return null;
    }

    return {
      rutaLocal: rutaRelativa,
      objeto: basename(rutaRelativa),
      tamano: contenido.byteLength,
      sha256: createHash('sha256').update(contenido).digest('hex'),
    };
  }
}

/**
 * Esquema de URL con el que la ventana pide una foto.
 *
 * No se usa `file://` a propósito: daría a la ventana acceso a cualquier ruta
 * del disco. Con un esquema propio, el proceso principal decide qué archivo
 * entrega y comprueba antes que la ruta caiga dentro de la carpeta de fotos.
 */
export const ESQUEMA_DE_FOTOS = 'pos-foto';

/**
 * Anfitrión fijo de las URL de foto.
 *
 * El esquema se registra como "estándar" para que la ventana lo trate como una
 * dirección normal y la política de seguridad de contenido lo admita en un
 * `<img>`. Un esquema estándar EXIGE anfitrión: `pos-foto:///archivo.png`, sin
 * él, no se resuelve de forma fiable. Por eso hay uno fijo.
 */
export const ANFITRION_DE_FOTOS = 'catalogo';

/** URL con la que el renderer muestra una foto ya guardada. */
export function urlDeFoto(rutaRelativa: string): string {
  const segmentos = rutaRelativa.split('/').map((parte) => encodeURIComponent(parte));
  return `${ESQUEMA_DE_FOTOS}://${ANFITRION_DE_FOTOS}/${segmentos.join('/')}`;
}

/**
 * Ruta relativa que pedía una URL de foto, o `null` si no es una de las
 * nuestras.
 *
 * Devolver la ruta NO significa que sea válida: quien la use tiene que pasarla
 * igual por `resolverRutaDeFoto`, que es donde está la barrera contra el
 * recorrido de directorios.
 */
export function rutaRelativaDesdeUrl(url: string): string | null {
  let analizada: URL;
  try {
    analizada = new URL(url);
  } catch {
    return null;
  }

  if (analizada.protocol !== `${ESQUEMA_DE_FOTOS}:` || analizada.hostname !== ANFITRION_DE_FOTOS) {
    return null;
  }

  return decodeURIComponent(analizada.pathname).replace(/^\//, '');
}
