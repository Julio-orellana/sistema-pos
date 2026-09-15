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
import type { ResultadoDeCierreIpc, TurnoAbierto } from '@shared/types/ipc';
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

/**
 * Lo que ve un usuario sin rol administrativo cuando un cierre pide autorización.
 *
 * Tiene que ser VERDAD en los dos casos que presenta igual: un conteo con
 * diferencia, y un reconteo que cuadra después de un conteo sellado. «Este
 * conteo tiene una diferencia» sería falso en el segundo; «este cierre tiene
 * una diferencia registrada» es cierto en los dos, porque el sello queda.
 */
export const MENSAJE_DE_CIERRE_SIN_TEORICO =
  'Este cierre tiene una diferencia registrada. Un administrador tiene que autorizarlo.';

/**
 * El resultado de intentar cerrar, tal como puede verlo QUIEN ESTÁ CERRANDO.
 *
 * Mismo criterio que el turno (§4.40), aplicado a los diálogos que aparecen
 * DESPUÉS de confirmar un conteo. A un usuario que no es administrativo, mientras
 * la caja no se cerró, no le llega nada de lo que permitiría deducir el esperado:
 *
 *   · `montoEsperado` y `diferencia` en `null`. La diferencia sola alcanza:
 *     esperado = contado − diferencia, y el contado lo escribió esa persona.
 *   · El mensaje del servicio se reemplaza: dice «un FALTANTE de Q…».
 *   · `REQUIERE_AUTORIZACION_DE_RECONTEO` se presenta como
 *     `REQUIERE_AUTORIZACION`. El servicio devuelve el primero SOLO cuando el
 *     conteo de ahora cuadra, así que distinguirlos le diría a la cajera que el
 *     número que tecleó ES el esperado.
 *   · Del primer conteo sellado viaja lo contado, sin esperado ni diferencia.
 *
 * El PIN que se pide es el mismo en los dos códigos (`cierre_con_diferencia`),
 * así que unificarlos no cambia el flujo de la pantalla.
 *
 * Un administrativo lo recibe entero: es quien autoriza y tiene que ver qué
 * aprueba (§4.9). Una caja YA cerrada también viaja entera, a cualquier rol: la
 * confirmación muestra el teórico cuando el conteo ya quedó registrado.
 */
export function resultadoDeCierreParaLaVentana(
  resultado: ResultadoDeCierreIpc,
  quienMira: UsuarioEnSesion | null,
): ResultadoDeCierreIpc {
  if (resultado.cerrada || puedeVerElTeorico(quienMira)) {
    return resultado;
  }
  const pideAutorizacion =
    resultado.codigo === 'REQUIERE_AUTORIZACION' ||
    resultado.codigo === 'REQUIERE_AUTORIZACION_DE_RECONTEO';
  return {
    ...resultado,
    codigo: resultado.codigo === 'REQUIERE_AUTORIZACION_DE_RECONTEO' ? 'REQUIERE_AUTORIZACION' : resultado.codigo,
    mensaje: pideAutorizacion ? MENSAJE_DE_CIERRE_SIN_TEORICO : resultado.mensaje,
    montoEsperado: null,
    diferencia: null,
    primerConteo:
      resultado.primerConteo === null
        ? null
        : {
            fecha: resultado.primerConteo.fecha,
            montoReal: resultado.primerConteo.montoReal,
            montoEsperado: null,
            diferencia: null,
          },
  };
}
