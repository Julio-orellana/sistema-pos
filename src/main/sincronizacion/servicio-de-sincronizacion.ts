/**
 * Servicio de la PANTALLA DE SINCRONIZACIÓN (Fase 4.a).
 *
 * Lee el estado de `sync_cola` para tres superficies distintas —la barra de
 * estado, el aviso al iniciar sesión y la pantalla misma— y ejecuta las dos
 * acciones administrativas que el diseño permite: reintentar un lote y
 * saltarlo a mano.
 *
 * ===========================================================================
 * «SALTAR UN LOTE» ES LA ÚNICA ESCRITURA DE ESTE SERVICIO, Y POR ESO ENCOLA
 * ===========================================================================
 *
 * El asiento de auditoría que deja un salto es un HECHO DEL NEGOCIO —alguien
 * decidió dejar un hueco en el respaldo— y por lo tanto tiene que llegar a la
 * nube como cualquier otro. Se escribe con `conBandejaDeSalida`, la única vía
 * de este proyecto para eso (§4.17 y §4.26 de CLAUDE.md): la marca local en
 * `sync_cola` y el asiento nuevo se escriben en la MISMA transacción, y el
 * asiento queda encolado en su propio lote.
 *
 * Esto pone a este archivo en la MISMA categoría que los servicios de
 * `src/main/domain`, aunque viva en `src/main/sincronizacion`: es la primera
 * vez que ese directorio escribe en `auditoria_log`, y por eso la prueba
 * estructural de §4.26 se amplió para vigilarlo también (ver
 * `todo-hecho-de-negocio-encola.test.ts`).
 */

import type { Database } from 'better-sqlite3';

import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import { ErrorDeNegocio } from '@main/database/errores';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type {
  LoteBloqueante,
  PendientesPorTabla,
  RepositorioDeSyncCola,
} from '@main/database/repositories/sync-cola';
import {
  calcularEstadoDeSincronizacion,
  type CredencialParaElResumen,
  type EstadoDeSincronizacion,
} from './resumen-de-sincronizacion';

/** Nombres de acción para `auditoria_log`, propios de este servicio. */
export const ACCIONES_DE_SINCRONIZACION = {
  /** Un administrador saltó a mano un lote detenido. Decisión 9 del diseño. */
  loteSaltado: 'lote_de_sincronizacion_saltado',
} as const;

/** Lo que la barra de estado necesita, y nada más: no hay ningún dato sensible. */
export interface ResumenDeSincronizacion {
  /** `false` cuando esta copia no tiene ningún proyecto de nube configurado. */
  readonly configurada: boolean;
  readonly estado: EstadoDeSincronizacion;
  readonly pendientes: number;
  readonly pendienteMasViejaDesde: string | null;
}

/** El detalle completo, solo para la pantalla administrativa. */
export interface DetalleDeSincronizacion extends ResumenDeSincronizacion {
  readonly pendientesPorTabla: readonly PendientesPorTabla[];
  readonly ultimoExitoEn: string | null;
  readonly loteBloqueante: LoteBloqueante | null;
  readonly archivosApartados: number;
  readonly hayCredencial: boolean;
  readonly revocada: boolean;
  readonly conectada: boolean;
}

/** Qué contenía el lote que se acaba de saltar, para que la pantalla lo confirme. */
export interface LoteSaltado {
  readonly loteId: string;
  readonly tablas: readonly string[];
  readonly filas: number;
}

export interface DependenciasDelServicioDeSincronizacion {
  readonly base: Database;
  readonly cola: RepositorioDeSyncCola;
  readonly auditoria: RepositorioDeAuditoria;
  /**
   * `null` cuando esta copia de la aplicación no tiene ningún proyecto de nube
   * configurado (desarrollo sin `POS_NUBE_URL`, o los modos semilla). Sin
   * nube, `sync_cola` igual existe y se llena —el adaptador simulado la vacía
   * sola, §4.17— así que el resto del servicio funciona igual.
   */
  readonly credencial: () => CredencialParaElResumen | null;
  /**
   * Dispara un ciclo del trabajador ahora mismo, sin esperar el backoff.
   *
   * Se inyecta como función y no como el planificador entero porque, al
   * momento de registrar los canales IPC, el planificador todavía no existe
   * (se crea después de la ventana, para no competir con el arranque en un
   * i3). Pasando una función que lo lee en el momento de llamarla, el orden de
   * construcción deja de importar.
   */
  readonly ejecutarCicloAhora: () => Promise<unknown>;
  readonly ahora?: () => number;
}

export class ServicioDeSincronizacion {
  private readonly base: Database;
  private readonly cola: RepositorioDeSyncCola;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly credencial: () => CredencialParaElResumen | null;
  private readonly ejecutarCicloAhora: () => Promise<unknown>;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDelServicioDeSincronizacion) {
    this.base = dependencias.base;
    this.cola = dependencias.cola;
    this.auditoria = dependencias.auditoria;
    this.credencial = dependencias.credencial;
    this.ejecutarCicloAhora = dependencias.ejecutarCicloAhora;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /** Liviano, SIN guard de rol: lo consulta la barra de estado, siempre visible. */
  public resumen(): ResumenDeSincronizacion {
    const credencial = this.credencial();
    const pendientes = this.cola.contarPendientes();
    const pendienteMasViejaDesde = this.cola.obtenerPendienteMasVieja();

    const estado = calcularEstadoDeSincronizacion({
      credencial,
      pendientes,
      pendienteMasViejaDesde,
      hayLoteBloqueante: this.cola.obtenerLoteBloqueante() !== null,
      ahoraIso: new Date(this.ahora()).toISOString(),
    });

    return {
      configurada: credencial !== null,
      estado,
      pendientes,
      pendienteMasViejaDesde,
    };
  }

  /** Completo. Solo lo llama un canal con `requiereRol(sesion, 'administrativo', …)`. */
  public detalle(): DetalleDeSincronizacion {
    const credencial = this.credencial();
    const loteBloqueante = this.cola.obtenerLoteBloqueante();
    const pendientes = this.cola.contarPendientes();
    const pendienteMasViejaDesde = this.cola.obtenerPendienteMasVieja();

    const estado = calcularEstadoDeSincronizacion({
      credencial,
      pendientes,
      pendienteMasViejaDesde,
      hayLoteBloqueante: loteBloqueante !== null,
      ahoraIso: new Date(this.ahora()).toISOString(),
    });

    return {
      configurada: credencial !== null,
      estado,
      pendientes,
      pendienteMasViejaDesde,
      pendientesPorTabla: this.cola.contarPendientesPorTabla(),
      ultimoExitoEn: this.cola.obtenerUltimoExito(),
      loteBloqueante,
      archivosApartados: this.cola.contarArchivosApartados(),
      hayCredencial: credencial?.hayCredencial ?? false,
      revocada: credencial?.revocada ?? false,
      conectada: credencial?.conectada ?? false,
    };
  }

  /**
   * «Reintentar ahora»: quita el bloqueo y dispara un ciclo sin esperar.
   *
   * No verifica que el lote exista ni que esté bloqueado: `desbloquearLote` es
   * un `UPDATE` que no afecta nada si no hay coincidencia, y `ejecutarCicloAhora`
   * sigue siendo seguro pedirlo aunque no hubiera nada que reintentar —el
   * trabajador simplemente no encuentra trabajo bloqueado y sigue con lo que
   * corresponda.
   */
  public async reintentarLote(loteId: string): Promise<void> {
    this.cola.desbloquearLote(loteId);
    await this.ejecutarCicloAhora();
  }

  /**
   * «Saltar este lote»: la acción que exige PIN y queda en auditoría.
   *
   * **El PIN ya se verificó antes de llamar acá.** Igual que en la
   * autorización de un descuento excedente (`src/main/ipc/venta.ts`), la
   * verificación del PIN vive en la capa de IPC, no en el servicio de
   * dominio: este método asume que quien lo llama ya comprobó
   * `autorizarComoAdministrador` y tiene el id de quien autorizó.
   */
  public saltarLote(usuarioId: string, loteId: string): LoteSaltado {
    const filas = this.cola.leerLote(loteId);
    if (filas.length === 0) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'Ese lote ya no está pendiente. Puede que ya se haya subido o que ya se haya saltado.',
        `lote inexistente o vacío al intentar saltarlo: ${loteId}`,
      );
    }

    const tablas = [...new Set(filas.map((fila) => fila.entidadTipo))];
    const errorOriginal = filas[0]?.error ?? null;

    return conBandejaDeSalida(this.base, () => {
      const nota =
        `SALTADO A MANO el ${new Date(this.ahora()).toISOString()}: ${tablas.join(', ')}, ` +
        `${String(filas.length)} fila(s). ` +
        (errorOriginal === null
          ? 'Sin error registrado.'
          : `Error original: ${errorOriginal}`);

      this.cola.marcarLoteSaltado(loteId, nota);

      const asiento = this.auditoria.registrar({
        usuarioId,
        accion: ACCIONES_DE_SINCRONIZACION.loteSaltado,
        entidadTipo: 'sincronizacion',
        entidadId: loteId,
        valorNuevo: {
          loteId,
          tablas,
          filas: filas.length,
          errorOriginal,
        },
        fecha: new Date(this.ahora()).toISOString(),
      });

      return {
        resultado: { loteId, tablas, filas: filas.length },
        entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
      };
    });
  }
}
