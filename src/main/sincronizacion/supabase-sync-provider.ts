/**
 * El `SyncProvider` real contra Supabase. Fase 3.b.
 *
 * Es el primer código del proyecto que **usa la credencial de la fase 3.a para
 * escribir en la nube**. Hasta acá la credencial existía y no la usaba nadie.
 *
 * ===========================================================================
 * NO SUBE NADA CON UPSERTS DIRECTOS: TODO PASA POR UNA DE LAS CINCO FUNCIONES
 * ===========================================================================
 *
 * El diseño original de esta fase asumía `INSERT … ON CONFLICT DO NOTHING`
 * desde la terminal. **Eso quedó superado en la fase 2.b al medir el riesgo
 * 8.4**: bajo RLS, ese upsert exige política de `SELECT` aunque no haya
 * conflicto, y dársela a la terminal sobre `ventas`, `recibos` y
 * `auditoria_log` es exactamente lo que §1.5 evita. Después de la `0024` la
 * terminal **no tiene ningún privilegio directo sobre ninguna tabla**: su
 * único camino es `EXECUTE` sobre las cinco funciones `SECURITY DEFINER`.
 *
 * Así que este proveedor hace tres cosas y nada más: **elegir** la función
 * (eso vive en `enrutador-de-lotes.ts`, que es puro), **traducir** el lote al
 * `jsonb` que la función espera, y **leer la constancia** que devuelve.
 *
 * ===========================================================================
 * QUÉ NO HACE, A PROPÓSITO
 * ===========================================================================
 *
 *   · **No decide cuándo correr ni cuándo reintentar.** Eso es del trabajador
 *     y del planificador de la fase 1.b, que ya existen y no se tocan.
 *   · **No clasifica sus propios fallos.** Devuelve el código HTTP en
 *     `estadoHttp` y `reintentos.ts` decide; es la decisión de la fase 1.b de
 *     que la clasificación es política del negocio y no del transporte.
 *   · **No convierte ni normaliza los datos.** El payload viaja tal como lo
 *     guardó la bandeja de salida, que lo leyó de la base con `SELECT *`
 *     justamente para que no haya ninguna conversión que pueda equivocarse.
 */

import type {
  CambioSincronizable,
  EstadoSincronizacion,
  ResultadoEmpuje,
  SyncProvider,
} from '@shared/adapters';
import { VERSION_DEL_CONTRATO_DE_SINCRONIZACION } from '@shared/contrato-de-sincronizacion';

import { PREFIJO_DE_ARCHIVO, type ArchivoParaSubir } from '@main/database/bandeja-de-salida';
import type { DetectorDeConexion } from './deteccion-de-conexion';
import { elegirFuncionDelLote, LoteNoEnrutable } from './enrutador-de-lotes';
import type { SesionDeNube } from './sesion-de-nube';
import type { SubidorDeFotos } from './subida-de-fotos';

/**
 * Lo que este módulo necesita de `fetch`, y nada más.
 *
 * **No se declara como `typeof fetch` a propósito**: `net.fetch` de Electron
 * —que es el que hay que usar en Windows, porque respeta el proxy del sistema
 * (§5.4)— acepta menos que el `fetch` estándar; no toma un `URL`, por ejemplo.
 * Pedir el tipo completo obligaría a un cast en el único lugar donde importa
 * usar el correcto. Se pide exactamente lo que se llama: una cadena y opciones.
 */
export type BuscarEnLaRed = (url: string, opciones?: RequestInit) => Promise<Response>;

/** Cuánto se espera una respuesta de PostgREST antes de darla por perdida. */
export const TIEMPO_MAXIMO_DE_RPC_MS = 30_000;

const MS_POR_SEGUNDO = 1000;

/**
 * Cuánto del mensaje de error de la nube se conserva.
 *
 * Alcanza de sobra para el texto de un `RAISE EXCEPTION` de la `0023`, y evita
 * que una respuesta de error enorme llene la columna `error` de `sync_cola` y
 * la bitácora técnica.
 */
const LARGO_MAXIMO_DEL_ERROR = 500;

/**
 * Los cuatro resultados que `escribir_fila` puede devolver por fila, **y los
 * cuatro son ÉXITO**.
 *
 * `sin_cambios` y `ya_existia` son el caso de §3.1: el lote ya había subido y
 * la respuesta se perdió en el camino, así que la terminal lo reintentó. La
 * nube contesta que no hizo nada, **y eso es exactamente lo que se quería**.
 * Tratarlo como error haría que un reintento normal detuviera la cola.
 */
const RESULTADOS_DE_EXITO = ['insertada', 'actualizada', 'ya_existia', 'sin_cambios'] as const;

/**
 * El código con el que se reporta un lote que no se pudo ni armar.
 *
 * Es un 4xx a propósito: `clasificarFallo` lo lee como **determinístico** y el
 * trabajador detiene la cola en ese lote. Un lote incoherente no se arregla
 * reintentando, y dejarlo girar lo esconderia.
 */
const NO_SE_PUDO_ARMAR = 422;

/**
 * El código con el que se reporta que no hay credencial usable.
 *
 * `clasificarFallo` lo lee como clase **credencial**, y el trabajador
 * entonces **no toca la cola**: no suma intento, no agenda reintento y no
 * bloquea (§3.2). Es la respuesta correcta y no un error de red: el lote es
 * válido, lo que falta es una credencial, y eso se resuelve reconectando la
 * terminal, no esperando.
 */
const SIN_CREDENCIAL = 401;

/** Una fila del lote, en la forma exacta que exige `exigir_forma_del_cambio`. */
interface CambioParaLaNube {
  readonly tabla: string;
  readonly id: string;
  readonly operacion: string;
  readonly datos: Readonly<Record<string, unknown>>;
}

/** Lo que devuelve una función de escritura por cada fila que escribió. */
interface ConstanciaDeFila {
  readonly tabla?: unknown;
  readonly id?: unknown;
  readonly resultado?: unknown;
  readonly huella?: unknown;
  readonly recibido_en?: unknown;
}

interface RespuestaDeFuncion {
  readonly funcion?: unknown;
  readonly contrato?: unknown;
  readonly filas?: unknown;
}

export interface DependenciasDelProveedor {
  readonly urlDelProyecto: string;
  readonly llavePublicable: string;
  /** La sesión de la fase 3.a. De acá sale el access token, y solo de acá. */
  readonly sesion: SesionDeNube;
  /** Opcional: si está, `consultarEstado` dice si se llega a la nube. */
  readonly conexion?: DetectorDeConexion;
  /** `net.fetch` de Electron: respeta el proxy de Windows (§5.4). */
  readonly buscar?: BuscarEnLaRed;
  /**
   * Quien sube las FOTOS a Storage (fase 3.c).
   *
   * Opcional porque un lote de archivo solo existe si alguien encoló una foto,
   * y sin este subidor no hay quien la encole: la aplicación construye los dos
   * juntos o ninguno. Si faltara y llegara un lote de archivo igual, no se
   * adivina nada —se rechaza diciendo que no hay subidor—, que es preferible a
   * dar la foto por subida.
   */
  readonly subidorDeFotos?: SubidorDeFotos;
  readonly registrar?: (mensaje: string) => void;
}

export class SupabaseSyncProvider implements SyncProvider {
  public readonly nombre = 'SupabaseSyncProvider';

  private readonly urlDelProyecto: string;
  private readonly llavePublicable: string;
  private readonly sesion: SesionDeNube;
  private readonly conexion: DetectorDeConexion | null;
  private readonly buscar: BuscarEnLaRed;
  private readonly registrar: (mensaje: string) => void;

  private readonly subidorDeFotos: SubidorDeFotos | undefined;

  public constructor(dependencias: DependenciasDelProveedor) {
    this.urlDelProyecto = dependencias.urlDelProyecto.replace(/\/+$/, '');
    this.llavePublicable = dependencias.llavePublicable;
    this.sesion = dependencias.sesion;
    this.conexion = dependencias.conexion ?? null;
    this.buscar = dependencias.buscar ?? fetch;
    this.registrar = dependencias.registrar ?? ((): void => undefined);
    this.subidorDeFotos = dependencias.subidorDeFotos;
  }

  public async empujarCambios(cambios: readonly CambioSincronizable[]): Promise<ResultadoEmpuje> {
    /*
      PRIMERO la credencial, antes de mirar el lote. Sin credencial no hay nada
      que intentar, y gastar tiempo armando un payload que no va a salir sería
      trabajo perdido. `accessTokenVigente()` ya devuelve `null` cuando la
      sesión está revocada (§4.23), así que este único chequeo cubre los tres
      casos: nunca se conectó, no se pudo descifrar, o la nube la rechazó.
    */
    const token = this.sesion.accessTokenVigente();
    if (token === null) {
      const estado = this.sesion.estado();
      const porque = estado.revocada
        ? 'la nube rechazó la credencial de esta terminal'
        : (estado.ultimoMotivo ?? 'esta terminal todavía no está conectada con la nube');
      return this.fracaso(SIN_CREDENCIAL, `No se intentó subir: ${porque}.`);
    }

    /*
      UN LOTE DE ARCHIVO NO VA A NINGUNA FUNCIÓN RPC: va a Storage, que es otra
      API. Se desvía ACÁ y no en el trabajador a propósito: el trabajador no
      tiene por qué saber que existen los archivos, sus cuatro reglas valen
      igual, y el `SyncProvider` es justamente la costura donde vive «cómo se
      habla con esta nube». Es la misma razón por la que el enrutador de
      funciones también vive de este lado.

      `encolarFoto` arma lotes de UNA sola fila, así que un lote mezclado no
      puede existir; si existiera, se rechaza en vez de subir media cosa.
    */
    const deArchivo = cambios.filter((cambio) => cambio.tabla.startsWith(PREFIJO_DE_ARCHIVO));
    if (deArchivo.length > 0) {
      if (deArchivo.length !== cambios.length) {
        return this.fracaso(
          NO_SE_PUDO_ARMAR,
          'Un lote no puede mezclar archivos con filas de negocio.',
        );
      }
      return this.subirArchivos(deArchivo);
    }

    let funcion;
    let lote: CambioParaLaNube[];
    try {
      funcion = elegirFuncionDelLote(cambios);
      lote = cambios.map(aCambioParaLaNube);
    } catch (error) {
      if (error instanceof LoteNoEnrutable) {
        return this.fracaso(NO_SE_PUDO_ARMAR, error.message);
      }
      throw error;
    }

    const cancelacion = new AbortController();
    const reloj = setTimeout(() => {
      cancelacion.abort();
    }, TIEMPO_MAXIMO_DE_RPC_MS);
    try {
      const respuesta = await this.buscar(`${this.urlDelProyecto}/rest/v1/rpc/${funcion}`, {
        method: 'POST',
        headers: {
          apikey: this.llavePublicable,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lote,
          version_de_contrato: VERSION_DEL_CONTRATO_DE_SINCRONIZACION,
        }),
        signal: cancelacion.signal,
      });

      const texto = await respuesta.text();
      if (!respuesta.ok) {
        /*
          NO se traduce el mensaje de la nube: se reenvía tal cual. Las
          funciones de la 0023 ya explican con nombre qué tabla, qué columna o
          qué invariante falló —«CONTRATO: la terminal manda la versión 1 y la
          nube declara la 2»— y reescribirlo sería perder el único dato útil.
        */
        return this.fracaso(
          respuesta.status,
          `${funcion} rechazó el lote (HTTP ${String(respuesta.status)}): ${texto.slice(0, LARGO_MAXIMO_DEL_ERROR)}`,
        );
      }
      return this.leerConstancia(funcion, texto, cambios.length);
    } catch (error) {
      // Sin `estadoHttp`: no hubo respuesta, y eso se lee como transitorio.
      const agotado = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        adaptador: this.nombre,
        cambiosAceptados: 0,
        cambiosRechazados: cambios.length,
        errores: [
          agotado
            ? `${funcion} no contestó en ${String(TIEMPO_MAXIMO_DE_RPC_MS / MS_POR_SEGUNDO)} s.`
            : `No se pudo hablar con la nube: ${error instanceof Error ? error.message : String(error)}`,
        ],
        simulado: false,
      };
    } finally {
      clearTimeout(reloj);
    }
  }

  /**
   * Lee la constancia que devuelve la función y decide si el lote subió.
   *
   * **No basta con el 200.** La función devuelve una constancia por fila, y si
   * esa constancia no tiene la forma esperada algo cambió en la nube sin que
   * el repositorio se enterara: eso es exactamente lo que la prueba de deriva
   * existe para detectar, y acá se trata como determinístico en vez de darlo
   * por bueno. Un 200 que no se entiende es peor que un error.
   */
  private leerConstancia(funcion: string, texto: string, filasEnviadas: number): ResultadoEmpuje {
    let cuerpo: RespuestaDeFuncion;
    try {
      cuerpo = JSON.parse(texto) as RespuestaDeFuncion;
    } catch {
      return this.fracaso(NO_SE_PUDO_ARMAR, `${funcion} contestó 200 con algo que no es JSON.`);
    }

    if (!Array.isArray(cuerpo.filas)) {
      return this.fracaso(
        NO_SE_PUDO_ARMAR,
        `${funcion} contestó 200 pero sin la lista de filas; la constancia no sirve.`,
      );
    }
    if (cuerpo.contrato !== VERSION_DEL_CONTRATO_DE_SINCRONIZACION) {
      return this.fracaso(
        NO_SE_PUDO_ARMAR,
        `${funcion} dice contrato ${String(cuerpo.contrato)} y esta terminal usa la ` +
          `${String(VERSION_DEL_CONTRATO_DE_SINCRONIZACION)}.`,
      );
    }

    const constancias = cuerpo.filas as readonly ConstanciaDeFila[];
    const desconocidos = constancias.filter(
      (fila) =>
        typeof fila.resultado !== 'string' ||
        !(RESULTADOS_DE_EXITO as readonly string[]).includes(fila.resultado),
    );
    if (desconocidos.length > 0) {
      const vistos = desconocidos.map((fila) => String(fila.resultado)).join(', ');
      return this.fracaso(
        NO_SE_PUDO_ARMAR,
        `${funcion} devolvió resultados que esta versión no conoce (${vistos}).`,
      );
    }

    /*
      Un lote repetido devuelve `ya_existia` / `sin_cambios` para TODAS sus
      filas, y eso es éxito (§3.1). Se anota en la bitácora porque un reintento
      confirmado es información útil —significa que una respuesta se perdió—,
      pero no cambia el resultado.
    */
    const repetidas = constancias.filter(
      (fila) => fila.resultado === 'ya_existia' || fila.resultado === 'sin_cambios',
    ).length;
    if (repetidas === constancias.length && constancias.length > 0) {
      this.registrar(
        `${funcion}: el lote ya estaba en la nube (${String(repetidas)} filas sin cambios). ` +
          'Es un reintento que confirma, no un error.',
      );
    }

    return {
      ok: true,
      adaptador: this.nombre,
      cambiosAceptados: constancias.length,
      cambiosRechazados: Math.max(0, filasEnviadas - constancias.length),
      errores: [],
      estadoHttp: 200,
      simulado: false,
    };
  }

  /**
   * Sube los archivos de un lote. Hoy siempre es UNO: `encolarFoto` arma lotes
   * de una sola fila, porque cada foto es independiente de las demás y
   * agruparlas haría que una sola ausente arrastrara a las otras.
   */
  private async subirArchivos(cambios: readonly CambioSincronizable[]): Promise<ResultadoEmpuje> {
    const subidor = this.subidorDeFotos;
    if (subidor === undefined) {
      return this.fracaso(
        NO_SE_PUDO_ARMAR,
        'Llegó un lote de archivo y esta terminal no tiene subidor de fotos configurado.',
      );
    }

    for (const cambio of cambios) {
      const archivo = cambio.datos as unknown as ArchivoParaSubir;
      const resultado = await subidor.subir(archivo);
      if (!resultado.ok) {
        return resultado;
      }
    }

    return {
      ok: true,
      adaptador: this.nombre,
      cambiosAceptados: cambios.length,
      cambiosRechazados: 0,
      errores: [],
      simulado: false,
    };
  }

  private fracaso(estadoHttp: number, mensaje: string): ResultadoEmpuje {
    this.registrar(mensaje);
    return {
      ok: false,
      adaptador: this.nombre,
      cambiosAceptados: 0,
      cambiosRechazados: 0,
      errores: [mensaje],
      estadoHttp,
      simulado: false,
    };
  }

  public async consultarEstado(): Promise<EstadoSincronizacion> {
    const estado = this.sesion.estado();
    if (!estado.conectada) {
      return {
        disponible: false,
        adaptador: this.nombre,
        descripcion: estado.revocada
          ? 'La nube rechazó la credencial de esta terminal: hay que volver a conectarla.'
          : (estado.ultimoMotivo ?? 'Esta terminal todavía no está conectada con la nube.'),
        simulado: false,
      };
    }
    if (this.conexion === null) {
      return {
        disponible: true,
        adaptador: this.nombre,
        descripcion: 'Hay credencial vigente. No se comprobó la conexión.',
        simulado: false,
      };
    }
    const veredicto = await this.conexion.comprobar();
    return {
      disponible: veredicto.hayNube,
      adaptador: this.nombre,
      descripcion: veredicto.motivo,
      simulado: false,
    };
  }
}

/**
 * Traduce una fila de la cola a la forma `{tabla, id, operacion, datos}`.
 *
 * Los nombres NO son los del dominio local: son los que
 * `exigir_forma_del_cambio` comprueba en la nube, y esa función además exige
 * que `datos.id` coincida con el `id` declarado. Se manda `idRegistro` en
 * `id`, que es lo que la bandeja de salida guardó como `entidad_id`, y `datos`
 * tal cual salió del `SELECT *`.
 */
function aCambioParaLaNube(cambio: CambioSincronizable): CambioParaLaNube {
  return {
    tabla: cambio.tabla,
    id: cambio.idRegistro,
    operacion: cambio.operacion,
    datos: cambio.datos,
  };
}
