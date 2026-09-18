/**
 * impresion-del-recibo.ts — Qué decirle a la cajera sobre el papel de una venta.
 *
 * Desde el 2026-09-18 el cobro NO espera a la impresora (CLAUDE.md §4.64): la
 * respuesta llega con la impresión todavía en curso, y el resultado llega
 * después, en un aviso aparte del proceso principal. Esta función junta las
 * dos cosas. Es pura para poder probarla sin DOM y sin IPC.
 *
 * El aviso se EMPAREJA POR `reciboId`: un aviso de otra venta —la anterior,
 * que terminó de imprimir tarde— no puede tomarse por el de esta.
 */

import type { ImpresionDeReciboTerminadaIpc, ReciboDeLaVentaIpc } from '@shared/types/ipc';

/** En qué quedó el papel de un recibo, visto desde la pantalla. */
export type EstadoDelPapel =
  | { readonly tipo: 'enviando' }
  | { readonly tipo: 'impreso' }
  | { readonly tipo: 'no-impreso'; readonly mensaje: string };

export function estadoDelPapel(
  recibo: ReciboDeLaVentaIpc,
  aviso: ImpresionDeReciboTerminadaIpc | null,
): EstadoDelPapel {
  const resultado =
    recibo.impresionPendiente
      ? aviso !== null && aviso.reciboId === recibo.id
        ? { impreso: aviso.impreso, mensaje: aviso.mensaje }
        : null
      : { impreso: recibo.impreso, mensaje: recibo.mensajeDeImpresion };

  if (resultado === null) {
    return { tipo: 'enviando' };
  }
  return resultado.impreso ? { tipo: 'impreso' } : { tipo: 'no-impreso', mensaje: resultado.mensaje };
}
