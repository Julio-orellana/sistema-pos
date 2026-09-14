/**
 * Subir una foto de producto a Supabase Storage.
 *
 * ===========================================================================
 * SOLO FOTOS. LOS PDF DE RECIBOS NO SE SUBEN, Y NO ES UN PENDIENTE
 * ===========================================================================
 *
 * Es la decisión de §2.5.3 del diseño y está tomada: un PDF es **dato
 * derivado** —la reimpresión lo regenera desde `ventas`, `venta_detalle` y
 * `configuracion_negocio`, que es lo que §4.14 ya hace— y subirlos llenaría el
 * gigabyte del plan gratuito en unos **ocho meses** para respaldar algo que la
 * restauración reconstruye en segundos.
 *
 * Por eso en este módulo **el bucket es una constante y hay uno solo**. No hay
 * un parámetro `bucket`, ni una bandera «subir PDF», ni una rama apagada: no se
 * puede pedirle que suba a `recibos` porque no sabe hacerlo. La nube dice lo
 * mismo del otro lado —la terminal **no tiene ninguna política** sobre ese
 * bucket (migración 0026)— así que aunque alguien agregara la llamada, RLS la
 * rechazaría. Las dos mitades se comprueban: hay una prueba estructural que
 * revisa que ningún archivo del proyecto arme una ruta de subida a `recibos`.
 *
 * ===========================================================================
 * SIN `x-upsert`, Y «YA EXISTE» ES ÉXITO
 * ===========================================================================
 *
 * §2.5.2: el contenido de una ruta de foto es **inmutable** —una foto nueva
 * recibe un UUID nuevo (§4.11)— así que si Storage contesta que el objeto ya
 * existe, **es que una subida anterior llegó y la confirmación se perdió**. Eso
 * no es un error: es exactamente el caso que el reintento tenía que resolver, y
 * se marca como éxito sin volver a mandar los bytes.
 *
 * Con `x-upsert` sería peor de dos maneras: pediría permiso de `UPDATE`, que la
 * terminal no tiene y RLS le negaría —medido en la batería—, y volvería a subir
 * bytes que ya están.
 *
 * ===========================================================================
 * UNA SOLA PETICIÓN, SIN TUS
 * ===========================================================================
 *
 * §2.5.2 evaluó las subidas reanudables de Storage (TUS, trozos de 6 MB) y las
 * descartó para estos tamaños: **un archivo más chico que un trozo se sube
 * entero o no se sube**, y «reanudar desde el último trozo» de un archivo de un
 * solo trozo es volver a empezar. Desde que la foto se reduce a 800 px al
 * guardarla (fase 3.c), los archivos son todavía más chicos que cuando se
 * escribió ese párrafo. Reintentar entero es barato y no hay estado a medias
 * que persistir.
 */

import type { ResultadoEmpuje } from '@shared/adapters';
import type { ArchivoParaSubir } from '@main/database/bandeja-de-salida';

/**
 * El `fetch` que se inyecta. Es el mismo tipo acotado que usa el proveedor de
 * la fase 3.b, y por la misma razón: `net.fetch` de Electron —el que respeta el
 * proxy de Windows— no es asignable a `typeof fetch`, y pedir el tipo completo
 * obligaría a un cast en el único lugar donde importa usar el correcto.
 */
export type BuscarEnLaRed = (url: string, opciones?: RequestInit) => Promise<Response>;

/** El ÚNICO bucket al que esta terminal sube. Ver la cabecera. */
export const BUCKET_DE_FOTOS = 'fotos';

/** Cuánto se espera una subida antes de darla por cortada. */
export const TIEMPO_MAXIMO_DE_SUBIDA_MS = 60_000;

/** Códigos que el módulo necesita nombrar, para no dejar números sueltos. */
const HTTP = {
  ok: 200,
  credencialRechazada: 401,
} as const;

/**
 * Cómo dice Storage que el objeto ya estaba.
 *
 * **Se mira el CUERPO y no el código**, y eso está MEDIDO contra
 * `pos-pruebas-descartable` el 2026-09-14, subiendo dos veces la misma foto:
 *
 *   1.ª subida  HTTP 200  {"Key":"fotos/31e5c420-….png","Id":"493fad0c-…"}
 *   2.ª subida  HTTP 400  {"statusCode":"409","error":"Duplicate",
 *                          "message":"The resource already exists",
 *                          "code":"KeyAlreadyExists"}
 *
 * Nótese el detalle que hace falta atender: **el estado HTTP es 400 y el 409
 * viene adentro del cuerpo, como texto**. Clasificar por el código a secas
 * mandaría este caso —que es un ÉXITO, los bytes ya están allá— directo a
 * detener la cola.
 */
const YA_EXISTIA = ['KeyAlreadyExists', 'Duplicate', 'already exists'];

/** Cuánto del cuerpo de un rechazo se conserva para la bitácora. */
const CARACTERES_DE_ERROR = 300;

/** Tipo de contenido según la extensión, para que Storage lo guarde bien. */
export function tipoDeContenidoDe(objeto: string): string {
  return objeto.toLocaleLowerCase('en').endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/** Lo que hace falta para subir. `leerArchivo` devuelve `null` si no está. */
export interface DependenciasDeSubida {
  readonly urlDelProyecto: string;
  readonly llavePublicable: string;
  /** El access token vigente, o `null` si no hay credencial usable. */
  readonly accessToken: () => string | null;
  readonly buscar: BuscarEnLaRed;
  /** Lee el archivo por su ruta relativa. `null` = ya no está en el disco. */
  readonly leerArchivo: (rutaRelativa: string) => Buffer | null;
}

/** Sube fotos al bucket `fotos`, y nada más. */
export class SubidorDeFotos {
  private readonly dependencias: DependenciasDeSubida;

  public constructor(dependencias: DependenciasDeSubida) {
    this.dependencias = dependencias;
  }

  public async subir(archivo: ArchivoParaSubir): Promise<ResultadoEmpuje> {
    const token = this.dependencias.accessToken();
    if (token === null) {
      // Igual que con las filas: sin credencial la cola NO se toca. No se suma
      // intento, no se agenda nada y no se bloquea; se resuelve reconectando.
      return this.fallo('No hay credencial de nube usable.', HTTP.credencialRechazada);
    }

    /*
      SE LEE EL ARCHIVO ANTES DE SALIR A LA RED. Si no está, no hay nada que
      subir y tampoco tiene sentido gastar una petición: se devuelve la señal de
      §2.5.4 y el trabajador lo aparta un día sin detener la cola.
    */
    const contenido = this.dependencias.leerArchivo(archivo.rutaLocal);
    if (contenido === null) {
      return {
        ok: false,
        adaptador: 'SubidorDeFotos',
        cambiosAceptados: 0,
        cambiosRechazados: 1,
        errores: [`archivo_ausente: ${archivo.rutaLocal} ya no está en este disco.`],
        archivoAusente: true,
        simulado: false,
      };
    }

    const destino = `${this.dependencias.urlDelProyecto}/storage/v1/object/${BUCKET_DE_FOTOS}/${encodeURIComponent(archivo.objeto)}`;

    let respuesta: Response;
    let cuerpo: string;
    try {
      respuesta = await this.dependencias.buscar(destino, {
        method: 'POST',
        headers: {
          apikey: this.dependencias.llavePublicable,
          Authorization: `Bearer ${token}`,
          'Content-Type': tipoDeContenidoDe(archivo.objeto),
          // NO va `x-upsert`. Ver la cabecera del módulo.
        },
        body: new Uint8Array(contenido),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_DE_SUBIDA_MS),
      });
      cuerpo = await respuesta.text();
    } catch (causa) {
      // Sin respuesta no hay código, y sin código se lee como transitorio: es
      // el caso de siempre, se cayó el internet de la tienda a mitad de subida.
      return this.fallo(causa instanceof Error ? causa.message : String(causa), undefined);
    }

    if (respuesta.status === HTTP.ok) {
      return this.exito();
    }

    if (YA_EXISTIA.some((marca) => cuerpo.includes(marca))) {
      // Éxito de un reintento: los bytes ya estaban allá (§2.5.2).
      return this.exito();
    }

    return this.fallo(
      `Storage rechazó ${archivo.objeto}: HTTP ${String(respuesta.status)} ${cuerpo.slice(0, CARACTERES_DE_ERROR)}`,
      respuesta.status,
    );
  }

  private exito(): ResultadoEmpuje {
    return {
      ok: true,
      adaptador: 'SubidorDeFotos',
      cambiosAceptados: 1,
      cambiosRechazados: 0,
      errores: [],
      simulado: false,
    };
  }

  private fallo(detalle: string, estadoHttp: number | undefined): ResultadoEmpuje {
    return {
      ok: false,
      adaptador: 'SubidorDeFotos',
      cambiosAceptados: 0,
      cambiosRechazados: 1,
      errores: [detalle],
      simulado: false,
      ...(estadoHttp === undefined ? {} : { estadoHttp }),
    };
  }
}
