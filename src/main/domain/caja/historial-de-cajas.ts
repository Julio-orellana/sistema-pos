/**
 * El historial de cajas: todas las sesiones, abiertas y cerradas, para auditar
 * (§4.44).
 *
 * NO CALCULA NADA DEL CORTE. Lee lo que el cierre guardó —`caja_sesiones` y los
 * asientos de `auditoria_log`— y lo presenta. El teórico, el real y la
 * diferencia son los que quedaron escritos el día del cierre; volver a
 * calcularlos haría que una regla nueva cambiara un corte viejo.
 *
 * De dónde sale cada dato, porque no todo vive en la misma tabla:
 *
 * | Dato | Fuente |
 * |---|---|
 * | Quién abrió, cuándo, inicial, teórico, real, diferencia | `caja_sesiones` |
 * | Quién cerró si fue otra persona | `caja_sesiones.cerrada_por` (NULL = quien abrió) |
 * | Quién autorizó la diferencia y la vía | `caja_sesiones.diferencia_autorizada_por/via` |
 * | Quién autorizó cerrar la caja ajena | asiento `caja_cerrada` |
 * | Los conteos sellados | asientos `conteo_de_cierre_sellado` |
 * | La corrección de un conteo sellado y quién la autorizó | asiento `reconteo_de_cierre_autorizado` |
 *
 * El último renglón NO puede salir de `caja_sesiones`: si el conteo corregido
 * cuadra, el CHECK de la migración 008 exige las columnas de autorización
 * vacías, así que el único lugar donde queda quién autorizó es el asiento
 * (§4.39).
 *
 * Un asiento que no se puede leer NO se esconde: la fila lleva un aviso. Este
 * historial existe para auditar, y un hueco silencioso es lo peor que podría
 * mostrar.
 */

import { z } from 'zod';

import { montoACadena, multiplicar, sumarLista } from '@shared/money';
import type {
  CierreEnHistorialIpc,
  ConteoSelladoEnHistorialIpc,
  DesgloseEnHistorialIpc,
  DetalleDeSesionDeCajaIpc,
  HistorialDeCajasIpc,
  PersonaIpc,
  ReconteoEnHistorialIpc,
  SesionDeCajaEnHistorialIpc,
  TipoDeDiferenciaIpc,
} from '@shared/types/ipc';
import { ErrorDeNegocio } from '@main/database/errores';
import type { AsientoAuditoria, CajaSesion, MomentoDeArqueo } from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeCajaSesiones } from '@main/database/repositories/caja-sesiones';
import type {
  RepositorioDeDenominaciones,
  RepositorioDeDesgloseDeCaja,
} from '@main/database/repositories/denominaciones';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import { ErrorDePeriodo, resolverPeriodo, type PeriodoResuelto } from '@main/domain/reportes/periodo';
import { ACCIONES_DE_CAJA } from './servicio-de-caja';

export interface DependenciasDelHistorialDeCajas {
  readonly cajaSesiones: RepositorioDeCajaSesiones;
  readonly auditoria: RepositorioDeAuditoria;
  readonly usuarios: RepositorioDeUsuarios;
  readonly desglose: RepositorioDeDesgloseDeCaja;
  readonly denominaciones: RepositorioDeDenominaciones;
  readonly ahora?: () => number;
}

export interface FiltroDelHistorialDeCajas {
  readonly desde: string | null;
  readonly hasta: string | null;
  readonly abiertaPor: string | null;
}

/** Nombre que se muestra si un id de usuario no existe en la tabla. */
export const NOMBRE_DESCONOCIDO = '(usuario desconocido)';

const esquemaVia = z.enum(['presencial', 'remoto']).nullable();

const esquemaConteo = z.object({
  fecha: z.string().optional(),
  montoEsperado: z.string(),
  montoReal: z.string(),
  diferencia: z.string(),
});

const esquemaSello = z.object({
  montoEsperado: z.string(),
  montoReal: z.string(),
  diferencia: z.string(),
});

const esquemaReconteo = z.object({
  anterior: z.object({ conteosSellados: z.array(esquemaConteo) }),
  nuevo: z.object({
    montoEsperado: z.string(),
    montoReal: z.string(),
    diferencia: z.string(),
    autorizadaPor: z.string().nullable(),
    autorizadaVia: esquemaVia,
  }),
});

/** Solo lo que el historial necesita del asiento del cierre; los asientos viejos pueden no traerlo. */
const esquemaCierre = z.object({
  cierreAjenoAutorizadoPor: z.string().nullable().optional(),
});

const TIPOS_DE_CAJA = 'caja_sesiones';

function leerJson(texto: string | null): unknown {
  if (texto === null) {
    return null;
  }
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return undefined;
  }
}

/** Los asientos de caja de las sesiones, agrupados por sesión y por acción. */
interface AsientosDeUnaSesion {
  readonly cierre: AsientoAuditoria[];
  readonly sellos: AsientoAuditoria[];
  readonly reconteos: AsientoAuditoria[];
}

export class ServicioDeHistorialDeCajas {
  private readonly ahora: () => number;

  public constructor(private readonly dependencias: DependenciasDelHistorialDeCajas) {
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  public listar(filtro: FiltroDelHistorialDeCajas): HistorialDeCajasIpc {
    const periodo = this.resolverRango(filtro);
    const sesiones = this.dependencias.cajaSesiones.listarParaHistorial({
      desdeIso: periodo?.desdeIso ?? null,
      hastaIso: periodo?.hastaIso ?? null,
      usuarioId: filtro.abiertaPor,
    });
    const asientos = this.asientosPorSesion();
    const nombres = new Map<string, PersonaIpc>();

    return {
      sesiones: sesiones.map((sesion) => this.fila(sesion, asientos.get(sesion.id), nombres)),
      periodo:
        periodo === null
          ? null
          : { clase: periodo.clase, desdeDia: periodo.desdeDia, hastaDia: periodo.hastaDia, etiqueta: periodo.etiqueta },
      personasQueAbrieron: this.dependencias.cajaSesiones
        .listarQuienesAbrieron()
        .map((id) => this.persona(id, nombres))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
  }

  public detalle(id: string): DetalleDeSesionDeCajaIpc {
    const sesion = this.dependencias.cajaSesiones.obtenerPorId(id);
    if (sesion === null) {
      throw new ErrorDeNegocio('REFERENCIA_INEXISTENTE', 'No se encontró esa sesión de caja.', `caja_sesion_id inexistente: ${id}`);
    }
    const asientos = this.asientosPorSesion().get(id);
    const nombres = new Map<string, PersonaIpc>();
    const avisos: string[] = [];
    const conteosSellados = this.sellos(asientos?.sellos ?? [], avisos);
    const fila = this.fila(sesion, asientos, nombres);
    return {
      sesion: { ...fila, avisos: [...fila.avisos, ...avisos] },
      conteosSellados,
      desgloseDeApertura: this.desglose(id, 'apertura'),
      desgloseDeCierre: this.desglose(id, 'cierre'),
    };
  }

  // -------------------------------------------------------------------------

  private resolverRango(filtro: FiltroDelHistorialDeCajas): PeriodoResuelto | null {
    const sinDesde = filtro.desde === null || filtro.desde === '';
    const sinHasta = filtro.hasta === null || filtro.hasta === '';
    if (sinDesde && sinHasta) {
      return null;
    }
    try {
      return resolverPeriodo({ clase: 'personalizado', desde: filtro.desde, hasta: filtro.hasta }, this.ahora());
    } catch (error) {
      if (error instanceof ErrorDePeriodo) {
        throw new ErrorDeNegocio('DATO_INVALIDO', error.message, 'Rango de fechas del historial mal formado.');
      }
      throw error;
    }
  }

  private asientosPorSesion(): Map<string, AsientosDeUnaSesion> {
    const porSesion = new Map<string, AsientosDeUnaSesion>();
    const asientos = this.dependencias.auditoria.listarPorTipoYAcciones(TIPOS_DE_CAJA, [
      ACCIONES_DE_CAJA.cierreDeCaja,
      ACCIONES_DE_CAJA.conteoSellado,
      ACCIONES_DE_CAJA.reconteoAutorizado,
    ]);
    for (const asiento of asientos) {
      if (asiento.entidadId === null) {
        continue;
      }
      let grupo = porSesion.get(asiento.entidadId);
      if (grupo === undefined) {
        grupo = { cierre: [], sellos: [], reconteos: [] };
        porSesion.set(asiento.entidadId, grupo);
      }
      if (asiento.accion === ACCIONES_DE_CAJA.cierreDeCaja) {
        grupo.cierre.push(asiento);
      } else if (asiento.accion === ACCIONES_DE_CAJA.conteoSellado) {
        grupo.sellos.push(asiento);
      } else {
        grupo.reconteos.push(asiento);
      }
    }
    return porSesion;
  }

  private persona(id: string, nombres: Map<string, PersonaIpc>): PersonaIpc {
    const conocida = nombres.get(id);
    if (conocida !== undefined) {
      return conocida;
    }
    const persona = { id, nombre: this.dependencias.usuarios.obtenerPorId(id)?.nombre ?? NOMBRE_DESCONOCIDO };
    nombres.set(id, persona);
    return persona;
  }

  private fila(
    sesion: CajaSesion,
    asientos: AsientosDeUnaSesion | undefined,
    nombres: Map<string, PersonaIpc>,
  ): SesionDeCajaEnHistorialIpc {
    const avisos: string[] = [];
    return {
      id: sesion.id,
      estado: sesion.estado,
      abiertaEn: sesion.abiertaEn,
      abiertaPor: this.persona(sesion.usuarioId, nombres),
      montoInicial: montoACadena(sesion.montoInicial),
      cierre: this.cierre(sesion, asientos?.cierre ?? [], nombres, avisos),
      cantidadDeConteosSellados: asientos?.sellos.length ?? 0,
      reconteo: this.reconteo(asientos?.reconteos ?? [], nombres, avisos),
      avisos,
    };
  }

  private cierre(
    sesion: CajaSesion,
    asientosDeCierre: readonly AsientoAuditoria[],
    nombres: Map<string, PersonaIpc>,
    avisos: string[],
  ): CierreEnHistorialIpc | null {
    if (sesion.estado !== 'cerrada') {
      return null;
    }
    const { montoEsperado, montoReal, diferencia, cerradaEn } = sesion;
    if (montoEsperado === null || montoReal === null || diferencia === null || cerradaEn === null) {
      // El CHECK de la tabla lo impide; si pasa, se dice en vez de inventar ceros.
      avisos.push('La sesión figura cerrada pero le faltan montos del corte.');
      return null;
    }

    let cierreAjenoAutorizadoPor: PersonaIpc | null = null;
    const asiento = asientosDeCierre.at(-1);
    if (sesion.cerradaPor !== null) {
      const leido = esquemaCierre.safeParse(leerJson(asiento?.valorNuevo ?? null));
      if (asiento === undefined || !leido.success) {
        avisos.push('No se pudo leer en la bitácora quién autorizó cerrar esta caja ajena.');
      } else if (leido.data.cierreAjenoAutorizadoPor !== null && leido.data.cierreAjenoAutorizadoPor !== undefined) {
        cierreAjenoAutorizadoPor = this.persona(leido.data.cierreAjenoAutorizadoPor, nombres);
      }
    }

    const diferenciaTexto = montoACadena(diferencia);
    const tipoDeDiferencia: TipoDeDiferenciaIpc =
      diferenciaTexto === '0.00' ? 'cuadra' : diferencia.isNegative() ? 'faltante' : 'sobrante';

    return {
      cerradaEn,
      cerradaPor: this.persona(sesion.cerradaPor ?? sesion.usuarioId, nombres),
      cerradaPorOtraPersona: sesion.cerradaPor !== null,
      cierreAjenoAutorizadoPor,
      montoTeorico: montoACadena(montoEsperado),
      montoReal: montoACadena(montoReal),
      diferencia: diferenciaTexto,
      tipoDeDiferencia,
      diferenciaAutorizada:
        sesion.diferenciaAutorizadaPor !== null && sesion.diferenciaAutorizadaVia !== null
          ? { por: this.persona(sesion.diferenciaAutorizadaPor, nombres), via: sesion.diferenciaAutorizadaVia }
          : null,
    };
  }

  private reconteo(
    asientos: readonly AsientoAuditoria[],
    nombres: Map<string, PersonaIpc>,
    avisos: string[],
  ): ReconteoEnHistorialIpc | null {
    const asiento = asientos.at(-1);
    if (asiento === undefined) {
      return null;
    }
    const leido = esquemaReconteo.safeParse({
      anterior: leerJson(asiento.valorAnterior),
      nuevo: leerJson(asiento.valorNuevo),
    });
    if (!leido.success) {
      avisos.push('Hay una corrección de conteo autorizada en la bitácora que no se pudo leer.');
      return null;
    }
    const { anterior, nuevo } = leido.data;
    return {
      fecha: asiento.fecha,
      conteosSellados: anterior.conteosSellados.map((conteo) => ({
        fecha: conteo.fecha ?? '',
        montoEsperado: conteo.montoEsperado,
        montoReal: conteo.montoReal,
        diferencia: conteo.diferencia,
      })),
      conteoFinal: { montoEsperado: nuevo.montoEsperado, montoReal: nuevo.montoReal, diferencia: nuevo.diferencia },
      autorizadoPor: nuevo.autorizadaPor === null ? null : this.persona(nuevo.autorizadaPor, nombres),
      via: nuevo.autorizadaVia,
    };
  }

  private sellos(asientos: readonly AsientoAuditoria[], avisos: string[]): ConteoSelladoEnHistorialIpc[] {
    const sellos: ConteoSelladoEnHistorialIpc[] = [];
    for (const asiento of asientos) {
      const leido = esquemaSello.safeParse(leerJson(asiento.valorNuevo));
      if (!leido.success) {
        avisos.push(`El conteo sellado del ${asiento.fecha} no se pudo leer.`);
        continue;
      }
      sellos.push({ fecha: asiento.fecha, ...leido.data });
    }
    return sellos;
  }

  /** El desglose de un momento, con subtotales calculados con Decimal. `null` si se contó en modo simple. */
  private desglose(cajaSesionId: string, momento: MomentoDeArqueo): DesgloseEnHistorialIpc | null {
    const filas = this.dependencias.desglose.listarPorSesion(cajaSesionId, momento);
    if (filas.length === 0) {
      return null;
    }
    const lineas = filas.map((fila) => {
      const denominacion = this.dependencias.denominaciones.obtenerPorId(fila.denominacionId);
      if (denominacion === null) {
        throw new Error(`La denominación ${fila.denominacionId} del desglose no existe.`);
      }
      const subtotal = multiplicar(denominacion.valor, fila.cantidad);
      return {
        valor: montoACadena(denominacion.valor),
        tipo: denominacion.tipo,
        cantidad: fila.cantidad,
        subtotal,
      };
    });
    return {
      lineas: lineas.map((linea) => ({ ...linea, subtotal: montoACadena(linea.subtotal) })),
      total: montoACadena(sumarLista(lineas.map((linea) => linea.subtotal))),
    };
  }
}
