/**
 * El turno de caja abierto, tal como puede verlo QUIEN ESTÁ MIRANDO.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE (CLAUDE.md §4.40)
 * ---------------------------------------------------------------------------
 * Desde el 2026-09-14 la caja abierta mostraba el efectivo teórico en vivo.
 * Julio lo restringió el mismo día, con este argumento: si quien cuenta puede
 * ver el número que el sistema espera, pierde sentido contar físicamente —
 * podría copiar el número en vez de verificar el cajón—, que es exactamente
 * el propósito del conteo.
 *
 * Dos reglas, y las dos se hacen cumplir ACÁ, en el proceso principal:
 *
 *   1. El teórico, las ventas en efectivo del turno y su cantidad SOLO viajan
 *      a la ventana de un usuario con rol ADMINISTRATIVO. A un usuario de rol
 *      venta le llegan en `null`. Esconderlo en la pantalla no alcanzaría:
 *      `window.pos.caja.estado()` se puede llamar desde la consola, y lo que
 *      no cruza el puente no se puede leer.
 *   2. El conteo sellado viaja SIN el esperado ni la diferencia: solo cuándo
 *      se confirmó y cuánto se contó. El monto contado lo escribió la propia
 *      persona; el esperado y la diferencia le dirían qué número poner al
 *      volver a contar.
 *
 * Ventas en efectivo SE OCULTA JUNTO con el teórico, y no es exceso de celo:
 * monto inicial + ventas en efectivo ES el teórico. Ocultar uno y mostrar el
 * otro sería no ocultar nada.
 *
 * Que la pantalla de CONTEO no muestre el teórico ni a un administrador es la
 * otra mitad, y vive en `PantallaDeCaja`: un administrador lo recibe porque lo
 * puede consultar durante el día, pero el paso donde se teclea el conteo no lo
 * dibuja.
 */

import { montoACadena } from '@shared/money';
import type { TurnoAbierto } from '@shared/types/ipc';
import type { ConteoSellado, ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import type { CajaSesion } from '@main/database/repositories/entidades';
import type { UsuarioEnSesion } from '@main/domain/usuarios/sesion';

export interface ContextoDelTurno {
  /** Quien está mirando. Sin sesión, nadie ve el teórico. */
  readonly quienMira: UsuarioEnSesion | null;
  /** Nombre de quien abrió, ya resuelto. */
  readonly nombreDeQuienAbrio: string;
  readonly caja: Pick<ServicioDeCaja, 'resumenDelTurno' | 'conteosSelladosDe'>;
}

/** ¿Este usuario puede ver el efectivo teórico en vivo? */
export function puedeVerElTeorico(quienMira: UsuarioEnSesion | null): boolean {
  return quienMira?.rol === 'administrativo';
}

export function turnoParaLaVentana(turno: CajaSesion, contexto: ContextoDelTurno): TurnoAbierto {
  const { quienMira, caja } = contexto;
  const resumen = puedeVerElTeorico(quienMira) ? caja.resumenDelTurno(turno) : null;
  const primerSello: ConteoSellado | undefined = caja.conteosSelladosDe(turno.id)[0];

  return {
    id: turno.id,
    montoInicial: montoACadena(turno.montoInicial),
    abiertaEn: turno.abiertaEn,
    abiertaPorId: turno.usuarioId,
    abiertaPorNombre: contexto.nombreDeQuienAbrio,
    esDeOtroUsuario: quienMira !== null && turno.usuarioId !== quienMira.id,
    ventasEnEfectivo: resumen === null ? null : montoACadena(resumen.ventasEnEfectivo),
    cantidadDeVentasEnEfectivo: resumen === null ? null : resumen.cantidadDeVentasEnEfectivo,
    montoTeorico: resumen === null ? null : montoACadena(resumen.montoTeorico),
    primerConteoSellado:
      primerSello === undefined ? null : { fecha: primerSello.fecha, montoReal: primerSello.montoReal },
  };
}
