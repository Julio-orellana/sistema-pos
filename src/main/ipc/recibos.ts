/**
 * Manejadores IPC de la configuración del negocio y del historial de recibos.
 *
 * DOS NIVELES DE PERMISO DISTINTOS, y la diferencia es deliberada:
 *
 *   · **Configurar el negocio exige rol administrativo.** Cambiar el NIT o el
 *     nombre cambia un documento que se le entrega al cliente.
 *   · **El historial y la reimpresión exigen solo sesión.** Reimprimir un
 *     recibo es algo que hace el cajero con un cliente enfrente que perdió su
 *     papel; pedir un administrador para eso paralizaría el mostrador, y el
 *     recibo no revela nada que el cliente no haya visto ya al comprarlo.
 *
 * QUÉ NO CRUZA HACIA LA VENTANA: la ruta del PDF sí viaja —la pantalla la
 * muestra para que alguien pueda ir a buscarlo— pero el PDF en sí no. Abrirlo
 * es trabajo del sistema operativo, no de la ventana del kiosko.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaConfiguracionDeNegocio,
  esquemaFiltroDeRecibos,
  esquemaReciboPorId,
  type ConfiguracionDeNegocioIpc,
  type HistorialDeRecibosIpc,
  type ReciboEnHistorialIpc,
  type ReciboVistoIpc,
  type RespuestaIpc,
  type TotalesDelHistorialIpc,
} from '@shared/types/ipc';
import { montoACadena, sumarLista } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import type { RepositorioDeRecibos } from '@main/database/repositories/recibos';
import { totalesPorFormaDePago } from '@main/domain/venta/totales-por-forma-de-pago';
import { requiereRol, requiereSesion, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeConfiguracionDeNegocio } from '@main/domain/negocio/servicio-de-configuracion';
import type { ServicioDeAnulacionDeVenta } from '@main/domain/venta/servicio-de-anulacion';
import type { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { reciboComoTexto } from '@main/domain/recibo/plantilla-de-recibo';
import { ejecutarConRespuesta } from './respuesta';

/** Dependencias de estos manejadores. */
export interface DependenciasDeRecibosIpc {
  readonly sesion: SesionActual;
  readonly negocio: ServicioDeConfiguracionDeNegocio;
  readonly recibos: ServicioDeRecibos;
  readonly repositorioDeRecibos: RepositorioDeRecibos;
  /**
   * El servicio de anulación, solo para preguntarle si una venta se puede
   * anular. Se le pregunta A ÉL y no se compara la caja acá: la regla vive en
   * un solo lugar, y así el historial no puede ofrecer un botón que el
   * servicio después rechace (§1.1 del diseño de la anulación).
   */
  readonly anulacionDeVenta: ServicioDeAnulacionDeVenta;
}

/** Id del usuario en sesión, o falla. El guard ya comprobó que hay uno. */
function actorEnSesion(sesion: SesionActual): string {
  const enSesion = sesion.obtener();
  if (enSesion === null) {
    throw new ErrorDeNegocio(
      'PERMISO_DENEGADO',
      'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
      'Se llegó a un manejador de recibos sin sesión.',
    );
  }
  return enSesion.id;
}

/** Una fila del historial y si su venta sigue en pie. */
interface FilaDelHistorial {
  readonly fila: ReciboEnHistorialIpc;
  readonly enPie: boolean;
}

/**
 * Los totales del conjunto filtrado, o `null` si quien mira no es administrativo.
 *
 * ===========================================================================
 * POR QUÉ LOS TOTALES LLEVAN ROL Y LAS FILAS NO
 * ===========================================================================
 * Las filas ya se le mostraban a cualquiera con sesión, y está bien: un cajero
 * tiene que poder reimprimir el recibo de un cliente que volvió al mostrador, y
 * ese papel no dice nada que el cliente no haya visto al comprar (§4.14).
 *
 * **Una línea de totales es otra cosa: es un reporte.** Dice cuánto entró a la
 * tienda, que es justamente lo que §4.15 reserva para el rol administrativo
 * —«información de dueño, no de mostrador»— y lo que §4.40 esconde del paso de
 * conteo de la caja, para que quien cuenta el cajón no pueda copiar el número
 * que el sistema espera en vez de contar.
 *
 * Es verdad que un cajero puede sumar a mano las filas que ya ve. La diferencia
 * es entre un número que hay que reconstruir y uno que el sistema entrega
 * exacto y de un vistazo, que es la misma distinción que §4.40 ya tomó.
 *
 * **Lo decide el proceso principal, nunca la pantalla**, por la razón medida en
 * §4.40: esconderlo en la ventana no protege nada, porque el canal se llama
 * desde la consola.
 */
function totalesParaLaVentana(
  sesion: SesionActual,
  filas: readonly FilaDelHistorial[],
): TotalesDelHistorialIpc | null {
  if (sesion.obtener()?.rol !== 'administrativo') {
    return null;
  }

  const enPie = filas.filter(({ enPie: cuenta }) => cuenta).map(({ fila }) => fila);
  const anuladas = filas.filter(({ fila }) => fila.anulacion !== null).map(({ fila }) => fila);

  // El reparto y las sumas salen de la ÚNICA función que hace esto, la misma
  // que usa el resumen de ventas por período.
  const totales = totalesPorFormaDePago(enPie);

  return {
    enEfectivo: totales.enEfectivo,
    enTarjeta: totales.enTarjeta,
    general: totales.general,
    ventasEnEfectivo: totales.ventasEnEfectivo,
    ventasEnTarjeta: totales.ventasEnTarjeta,
    cantidadDeVentas: totales.cantidadDeVentas,
    anuladas: anuladas.length,
    totalAnulado: montoACadena(sumarLista(anuladas.map((fila) => fila.total))),
  };
}

/** Registra los canales de negocio y recibos. */
export function registrarManejadoresDeRecibos(dependencias: DependenciasDeRecibosIpc): void {
  const { sesion, negocio, recibos, repositorioDeRecibos, anulacionDeVenta } = dependencias;

  // --- Configuración del negocio -------------------------------------------
  ipcMain.handle(
    CANALES_IPC.negocioObtener,
    async (): Promise<RespuestaIpc<ConfiguracionDeNegocioIpc>> =>
      ejecutarConRespuesta('NEGOCIO_OBTENER_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const actual = negocio.obtener();
          return {
            nombreComercial: actual.nombreComercial,
            direccion: actual.direccion,
            telefono: actual.telefono,
            nit: actual.nit,
          };
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.negocioGuardar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ConfiguracionDeNegocioIpc>> =>
      ejecutarConRespuesta('NEGOCIO_GUARDAR_FALLIDO', () =>
        requiereRol(sesion, 'administrativo', () => {
          const datos = esquemaConfiguracionDeNegocio.parse(payload);
          const guardada = negocio.guardar(actorEnSesion(sesion), datos);
          return {
            nombreComercial: guardada.nombreComercial,
            direccion: guardada.direccion,
            telefono: guardada.telefono,
            nit: guardada.nit,
          };
        }),
      ),
  );

  // --- Historial de recibos -------------------------------------------------
  ipcMain.handle(
    CANALES_IPC.recibosListar,
    async (_evento, payload: unknown): Promise<RespuestaIpc<HistorialDeRecibosIpc>> =>
      ejecutarConRespuesta('RECIBOS_LISTAR_FALLIDO', () =>
        requiereSesion(sesion, () => {
          const { formaPago } = esquemaFiltroDeRecibos.parse(payload);

          const todas = repositorioDeRecibos.listarRecientes().map((recibo) => {
            // Se arma el modelo completo de cada uno: es la MISMA fuente que
            // usa el papel, así que el historial no puede mostrar un total
            // distinto del que salió impreso.
            const modelo = recibos.modeloDe(recibo.id);
            const fila: ReciboEnHistorialIpc = {
              id: recibo.id,
              ventaId: recibo.ventaId,
              numeroRecibo: recibo.numeroRecibo,
              fecha: modelo.fecha,
              hora: modelo.hora,
              cajero: modelo.cajero,
              total: modelo.total,
              formaPago: modelo.formaPago,
              numBoleta: modelo.numBoleta,
              impreso: recibo.impreso,
              lineas: modelo.lineas.length,
              conDescuento: modelo.descuento !== null,
              // La misma marca que lleva el papel: sale del modelo, que la leyó
              // de `anulaciones_de_venta`. Copia nueva, nada de dominio cruza.
              anulacion:
                modelo.anulacion === null
                  ? null
                  : {
                      fecha: modelo.anulacion.fecha,
                      hora: modelo.anulacion.hora,
                      autorizadaPor: modelo.anulacion.autorizadaPor,
                      motivo: modelo.anulacion.motivo,
                    },
              sePuedeAnular: anulacionDeVenta.sePuedeAnular(recibo.ventaId),
            };
            /*
              CUÁLES CUENTAN PARA LOS TOTALES: las que NO tienen fila en
              `anulaciones_de_venta`, y nada más.

              **NO SE MIRA `ventas.estado`, Y ESO ES DELIBERADO.** Esa columna
              dice 'completada' también en las anuladas, así que leerla para
              decidir si una venta está en pie es siempre engañoso: es la regla
              de §1.3 del diseño, la que aplican el resto de los reportes por
              `VENTA_SIN_ANULACION` (§4.15) y el efectivo esperado de la caja
              (§4.10), y hay una prueba estructural que recorre todo el código
              de producción y falla si alguna consulta vuelve a decidir por ahí
              (`anulacion-estructural.test.ts`).
            */
            return { fila, enPie: fila.anulacion === null };
          });

          // El filtro se aplica ACÁ, sobre las filas ya armadas, para que los
          // totales de abajo sean exactamente los de lo que se va a dibujar.
          const delFiltro = todas.filter(
            ({ fila }) => formaPago === 'todas' || fila.formaPago === formaPago,
          );

          return {
            recibos: delFiltro.map(({ fila }) => fila),
            filtro: formaPago,
            totales: totalesParaLaVentana(sesion, delFiltro),
          };
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.recibosVer,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ReciboVistoIpc>> =>
      ejecutarConRespuesta('RECIBO_VER_FALLIDO', () =>
        requiereSesion(sesion, () => {
          const { id } = esquemaReciboPorId.parse(payload);
          const modelo = recibos.modeloDe(id);
          const recibo = repositorioDeRecibos.obtenerPorId(id);

          return {
            numeroRecibo: modelo.numeroRecibo,
            // El MISMO texto que iría a la impresora: lo que se ve en pantalla
            // es exactamente lo que saldría en el papel.
            texto: reciboComoTexto(modelo),
            rutaPdf: recibo === null ? '' : recibos.rutaAbsolutaDelPdf(recibo),
            pdfGenerado: true,
            impreso: recibo?.impreso ?? false,
            mensajeDeImpresion: '',
          };
        }),
      ),
  );

  ipcMain.handle(
    CANALES_IPC.recibosReimprimir,
    async (_evento, payload: unknown): Promise<RespuestaIpc<ReciboVistoIpc>> =>
      ejecutarConRespuesta('RECIBO_REIMPRIMIR_FALLIDO', async () =>
        requiereSesion(sesion, async () => {
          const { id } = esquemaReciboPorId.parse(payload);
          const resultado = await recibos.reimprimir(id);

          return {
            numeroRecibo: resultado.modelo.numeroRecibo,
            texto: reciboComoTexto(resultado.modelo),
            rutaPdf: resultado.rutaPdf,
            pdfGenerado: resultado.pdfGenerado,
            impreso: resultado.impreso,
            mensajeDeImpresion: resultado.mensajeDeImpresion,
          };
        }),
      ),
  );
}
