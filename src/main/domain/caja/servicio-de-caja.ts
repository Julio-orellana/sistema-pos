/**
 * Módulo de caja: apertura y cierre del turno.
 *
 * DOS MODOS DE CAPTURAR EFECTIVO, MUTUAMENTE EXCLUYENTES:
 *
 *   · Simple:    el cajero escribe el total y listo.
 *   · Detallado: el cajero cuenta cuántas piezas hay de cada denominación y
 *                el SISTEMA suma. Nunca se le pide además el total: si se le
 *                pidieran las dos cosas, tarde o temprano no coincidirían y
 *                habría que decidir a cuál creerle.
 *
 * Nunca se aceptan los dos a la vez. La suma del modo detallado se hace con
 * Decimal.js, como todo el dinero del proyecto.
 *
 * EL CONTEO CONFIRMADO CON DIFERENCIA QUEDA SELLADO (2026-09-14). Jimmy lo
 * encontró probando en el equipo real: si al cerrar el sistema mostraba una
 * diferencia, el cajero podía volver atrás y probar otro número hasta que
 * «cuadrara», sin que quedara rastro del primero. Eso anulaba el propósito de
 * exigir autorización ante una diferencia. Ahora, en cuanto un conteo se
 * CONFIRMA y da diferencia, queda escrito en `auditoria_log`, y desde ese
 * momento la caja solo se cierra con el PIN de un administrador, AUNQUE el
 * número final cuadre. Ver `intentarCerrar` y CLAUDE.md §4.39.
 */

import type { Database } from 'better-sqlite3';

import Decimal from 'decimal.js';

import { CERO, montoACadena, multiplicar, sumar, sumarLista } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { encolarLote, entradasDe, type EntradaDelLote } from '@main/database/bandeja-de-salida';
import { enTransaccionDeNegocio } from '@main/database/transaccion-en-curso';
import type {
  CajaSesion,
  Denominacion,
  LineaDeDesglose,
  MomentoDeArqueo,
  ViaDeAutorizacion,
} from '@main/database/repositories/entidades';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { RepositorioDeCajaSesiones } from '@main/database/repositories/caja-sesiones';
import type { RepositorioDeVentas } from '@main/database/repositories/ventas';
import type {
  RepositorioDeDenominaciones,
  RepositorioDeDesgloseDeCaja,
} from '@main/database/repositories/denominaciones';

/** Acciones de caja que quedan en la bitácora de auditoría. */
export const ACCIONES_DE_CAJA = {
  aperturaDeCaja: 'caja_abierta',
  cierreDeCaja: 'caja_cerrada',
  /** Un conteo de cierre CONFIRMADO que dio diferencia. Es el sello. */
  conteoSellado: 'conteo_de_cierre_sellado',
  /**
   * Se cerró un turno con conteos sellados usando una autorización que los
   * sellos exigieron: porque cambió lo contado, porque cambió lo esperado, o
   * las dos cosas. Es la única constancia de quién autorizó cuando el cierre
   * cuadra (§4.39).
   */
  reconteoAutorizado: 'reconteo_de_cierre_autorizado',
} as const;

/**
 * Un conteo de cierre ya sellado, tal como quedó en la bitácora.
 *
 * Los tres montos van como cadena canónica de dos decimales: son los mismos
 * textos que la pantalla le mostró al cajero en ese momento.
 */
export interface ConteoSellado {
  readonly asientoId: string;
  readonly fecha: string;
  readonly montoEsperado: string;
  readonly montoReal: string;
  readonly diferencia: string;
  readonly modo: ModoDeCaptura;
}

/** Cómo se capturó el efectivo. */
export type ModoDeCaptura = 'simple' | 'detallado';

/**
 * Efectivo declarado, en uno de los dos modos.
 *
 * Es una unión discriminada a propósito: hace IMPOSIBLE construir un valor con
 * los dos modos a la vez, en vez de tener que validarlo a mano.
 */
export type EfectivoDeclarado =
  | { readonly modo: 'simple'; readonly monto: string }
  | { readonly modo: 'detallado'; readonly lineas: readonly LineaDeDesglose[] };

/** Resultado de cerrar, o el motivo por el que no se pudo. */
export interface ResultadoDeCierre {
  readonly cerrada: boolean;
  readonly codigo:
    | 'CIERRE_CORRECTO'
    /** Hay diferencia y falta el código que la autorice. */
    | 'REQUIERE_AUTORIZACION'
    /**
     * El conteo de ahora CUADRA, pero antes se confirmó otro que no cuadraba.
     * Cambiar el resultado después de ver un problema es justamente lo que
     * hay que autorizar (§4.39).
     */
    | 'REQUIERE_AUTORIZACION_DE_RECONTEO'
    /** La abrió otra persona y falta el PIN del administrador. */
    | 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA';
  readonly mensaje: string;
  readonly sesion: CajaSesion | null;
  /** Diferencia calculada, como cadena canónica, para mostrarla al autorizar. */
  readonly diferencia: string;
  readonly montoEsperado: string;
  readonly montoReal: string;
  /**
   * El PRIMER conteo sellado de este turno, si el conteo de ahora es otro.
   * `null` cuando no hubo ningún sello, o cuando el de ahora es el mismo
   * número: ahí no hay nada distinto que mostrar.
   */
  readonly primerConteo: ConteoSellado | null;
}

/**
 * Quién cierra y con qué permisos.
 *
 * `usuarioQueCierra` NO es opcional a propósito: cerrar sin decir quién lo
 * hace dejaría de poder distinguirse un cierre propio de uno ajeno, que es la
 * distinción de la que depende todo lo demás.
 */
export interface ContextoDeCierre {
  /** Usuario en sesión. Siempre sale de la sesión, nunca de la interfaz. */
  readonly usuarioQueCierra: string;
  /**
   * Administrador que autorizó cerrar una caja AJENA, si hizo falta. Su PIN lo
   * verifica quien llama, con `autorizarComoAdministrador` y la superficie
   * `cierre_de_caja_ajena`.
   */
  readonly autorizacionDeCajaAjena?: { readonly autorizadaPor: string } | undefined;
  /** Administrador que autorizó la DIFERENCIA, si la hubo. Es otra cosa. */
  readonly autorizacion?:
    | { readonly autorizadaPor: string; readonly via: ViaDeAutorizacion }
    | undefined;
}

/**
 * Si se puede vender ahora, y si no, por cuál de los dos motivos.
 *
 * Es una unión discriminada para que la pantalla no pueda tratar «no hay caja»
 * y «la caja es de otro» como el mismo caso: son mensajes y salidas distintas.
 */
export type EstadoParaVender =
  | { readonly puede: true; readonly turno: CajaSesion }
  | { readonly puede: false; readonly motivo: 'SIN_CAJA_ABIERTA' }
  | { readonly puede: false; readonly motivo: 'CAJA_DE_OTRO_USUARIO'; readonly turno: CajaSesion };

/** Dependencias del servicio. */
export interface DependenciasDeCaja {
  /**
   * La conexión, para poder envolver la escritura en UNA transacción.
   *
   * **Este servicio no la tenía hasta la Fase 1.a de la sincronización**, y por
   * eso escribía su fila y su asiento de auditoría sueltos: un cierre forzado
   * entre los dos dejaba el hecho sin su rastro. Ahora van juntos, y con ellos
   * la entrada de la bandeja de salida (`docs/SINCRONIZACION.md` §2.4).
   */
  readonly base: Database;
  readonly cajaSesiones: RepositorioDeCajaSesiones;
  readonly denominaciones: RepositorioDeDenominaciones;
  readonly desglose: RepositorioDeDesgloseDeCaja;
  readonly ventas: RepositorioDeVentas;
  readonly auditoria: RepositorioDeAuditoria;
  readonly ahora?: () => number;
}

export class ServicioDeCaja {
  private readonly base: Database;
  private readonly cajaSesiones: RepositorioDeCajaSesiones;
  private readonly denominaciones: RepositorioDeDenominaciones;
  private readonly desglose: RepositorioDeDesgloseDeCaja;
  private readonly ventas: RepositorioDeVentas;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly ahora: () => number;

  public constructor(dependencias: DependenciasDeCaja) {
    this.base = dependencias.base;
    this.cajaSesiones = dependencias.cajaSesiones;
    this.denominaciones = dependencias.denominaciones;
    this.desglose = dependencias.desglose;
    this.ventas = dependencias.ventas;
    this.auditoria = dependencias.auditoria;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
  }

  /**
   * Suma un desglose con Decimal.js: cantidad × valor de cada denominación.
   *
   * Se redondea una sola vez al final, como manda la política de redondeo del
   * proyecto: las multiplicaciones intermedias quedan exactas.
   */
  public totalDelDesglose(lineas: readonly LineaDeDesglose[]): Decimal {
    const porId = new Map(this.denominaciones.listarActivas().map((d) => [d.id, d]));

    const subtotales = lineas.map((linea) => {
      const denominacion = porId.get(linea.denominacionId);
      if (denominacion === undefined) {
        throw new ErrorDeNegocio(
          'DATO_INVALIDO',
          'Se contó una denominación que no existe o está desactivada.',
          `denominacion_id desconocido: ${linea.denominacionId}`,
        );
      }
      if (!Number.isInteger(linea.cantidad) || linea.cantidad < 0) {
        throw new ErrorDeNegocio(
          'DATO_INVALIDO',
          'La cantidad de piezas debe ser un número entero y no negativa.',
          `cantidad inválida: ${String(linea.cantidad)}`,
        );
      }
      return multiplicar(denominacion.valor, linea.cantidad);
    });

    return subtotales.length === 0 ? CERO : sumar(...subtotales);
  }

  /** Resuelve el monto de un efectivo declarado, sea cual sea el modo. */
  public montoDeclarado(efectivo: EfectivoDeclarado): Decimal {
    if (efectivo.modo === 'simple') {
      return new Decimal(montoACadena(efectivo.monto));
    }
    return this.totalDelDesglose(efectivo.lineas);
  }

  /** Denominaciones activas, para armar la pantalla de conteo. */
  public listarDenominaciones(): Denominacion[] {
    return this.denominaciones.listarActivas();
  }

  /** El turno abierto de un usuario, si tiene alguno. */
  /**
   * EL turno abierto del sistema, si hay alguno.
   *
   * No recibe usuario: la caja física es una sola y desde la migración 010 la
   * base garantiza que haya como mucho un turno abierto en toda la tabla.
   * Antes esto preguntaba por el turno de UNA persona, y por eso respondía
   * "no hay" cuando la caja estaba abierta por otra.
   */
  public sesionAbierta(): CajaSesion | null {
    return this.cajaSesiones.obtenerAbierta();
  }

  /**
   * ¿Se puede VENDER ahora mismo, y si no, por qué?
   *
   * Vender exige una caja abierta POR QUIEN ESTÁ VENDIENDO. Las tres
   * respuestas posibles son un tipo, no un booleano con un mensaje suelto: la
   * pantalla tiene que dibujar algo distinto en cada caso y así no puede
   * olvidarse de ninguno.
   *
   * POR QUÉ NO SE PUEDE VENDER CONTRA LA CAJA DE OTRO, ni con autorización:
   * una venta se registra contra `caja_sesion_id`, así que vendiendo en el
   * turno ajeno el dinero entraría al corte de una persona que no lo recibió.
   * Cerrar la caja de otro SÍ se autoriza con PIN porque es un acto único y
   * supervisado, con su asiento; vender es continuo, y autorizar una vez
   * dejaría toda una tarde de ventas atribuidas a quien no estaba. La salida
   * correcta ya existe: cerrar el turno ajeno —con el PIN del administrador— y
   * abrir el propio.
   */
  public estadoParaVender(usuarioId: string): EstadoParaVender {
    const turno = this.cajaSesiones.obtenerAbierta();

    if (turno === null) {
      return { puede: false, motivo: 'SIN_CAJA_ABIERTA' };
    }
    if (turno.usuarioId !== usuarioId) {
      return { puede: false, motivo: 'CAJA_DE_OTRO_USUARIO', turno };
    }
    return { puede: true, turno };
  }

  /**
   * ¿Cerrar este turno exige la autorización de un administrador?
   *
   * UNA SOLA REGLA, SIN EXCEPCIONES POR ROL: hace falta autorización siempre
   * que quien cierra no sea quien abrió, aunque quien cierra sea a su vez
   * administrador. Un administrador que quiera cerrar la caja de otro teclea
   * su propio PIN, y así el cierre ajeno queda registrado igual.
   *
   * La tentación de agregar "salvo que sea administrador" es exactamente la
   * clase de caso especial que ya costó una vuelta en este proyecto con la
   * intercepción de Cmd+Q: la excepción parece inofensiva y abre el hueco.
   */
  public requiereAutorizacionDeCajaAjena(sesion: CajaSesion, usuarioQueCierra: string): boolean {
    return sesion.usuarioId !== usuarioQueCierra;
  }

  /**
   * Abre un turno de caja PARA EL USUARIO INDICADO.
   *
   * Quien llama debe pasar el id del usuario en sesión, nunca uno que venga de
   * la interfaz: nadie abre caja en nombre de otro.
   */
  public abrir(usuarioId: string, efectivo: EfectivoDeclarado): CajaSesion {
    // Se valida también desde la aplicación y no solo con el índice único de
    // la base, para poder dar un mensaje que el cajero entienda.
    //
    // La comprobación es GLOBAL, no por usuario: la caja física es una sola.
    // Dos turnos simultáneos sobre el mismo cajón harían que ninguno de los
    // dos cortes signifique nada, porque el dinero que entra por uno sale
    // contado en el otro.
    const abierta = this.cajaSesiones.obtenerAbierta();
    if (abierta !== null) {
      throw new ErrorDeNegocio(
        'CAJA_YA_ABIERTA',
        'Ya hay una caja abierta en el sistema. Hay que cerrarla antes de abrir otra.',
        `Ya existe la sesión de caja ${abierta.id}, abierta por el usuario ${abierta.usuarioId}.`,
      );
    }

    const montoInicial = this.montoDeclarado(efectivo);

    /*
      LAS TRES ESCRITURAS VAN EN UNA TRANSACCIÓN, y hasta la Fase 1.a de la
      sincronización NO era así: la sesión, su desglose y su asiento se
      escribían sueltos, y matar el proceso entre dos de ellos —una vía de
      escape que este proyecto permite a propósito (§4.5)— dejaba una caja
      abierta sin el arqueo con que se abrió. Era un hueco de atomicidad
      preexistente; la bandeja de salida obligó a mirarlo y se cierra acá.
    */
    const abrirTodo = (): CajaSesion =>
      enTransaccionDeNegocio(this.base, (): CajaSesion => {
        const sesion = this.cajaSesiones.abrir({ usuarioId, montoInicial });

        if (efectivo.modo === 'detallado') {
          this.desglose.guardar(sesion.id, 'apertura', efectivo.lineas);
        }

        const asiento = this.auditoria.registrar({
          usuarioId,
          accion: ACCIONES_DE_CAJA.aperturaDeCaja,
          entidadTipo: 'caja_sesiones',
          entidadId: sesion.id,
          valorNuevo: {
            montoInicial: montoACadena(montoInicial),
            modo: efectivo.modo,
          },
          fecha: new Date(this.ahora()).toISOString(),
        });

        // Bandeja de salida: la caja antes que su desglose, porque el desglose la
        // referencia con una llave foránea y Postgres lo exige en ese orden.
        const entradas: EntradaDelLote[] = [
          { tabla: 'caja_sesiones', id: sesion.id, operacion: 'insertar' },
          ...entradasDe(
            'caja_sesion_denominaciones',
            this.desglose.listarPorSesion(sesion.id, 'apertura').map((linea) => linea.id),
            'insertar',
          ),
          { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
        ];
        encolarLote(this.base, entradas);

        return sesion;
      });

    return abrirTodo();
  }

  /**
   * Calcula lo que DEBERÍA haber en el cajón al cerrar.
   *
   *     monto_esperado = monto_inicial + Σ ventas EN EFECTIVO y COMPLETADAS
   *                                        de esta sesión de caja
   *
   * QUÉ QUEDA FUERA, y por qué:
   *
   *   · LAS VENTAS CON TARJETA. Ese dinero nunca entró al cajón: entra por el
   *     banco, con su propia liquidación. Sumarlas haría que toda caja con
   *     ventas con tarjeta apareciera faltante por exactamente ese monto, y el
   *     cajero tendría que pedir una autorización de descuadre por un dinero
   *     que nadie perdió.
   *   · LAS VENTAS ANULADAS. Hoy nada las produce —anular una venta ya
   *     registrada todavía no existe—, pero el filtro va desde ahora para que
   *     el día que exista no haya que acordarse de agregarlo acá.
   *   · LAS VENTAS DE OTRAS SESIONES. Se filtra por `caja_sesion_id`, no por
   *     fecha: un turno es un turno, aunque cruce la medianoche.
   *
   * La suma se hace con Decimal.js sobre los totales ya redondeados de cada
   * venta, no con un `SUM()` de SQL: `ventas.total` es TEXT canónico y SQLite
   * lo convertiría a punto flotante para sumarlo.
   *
   * SUMA LOS TOTALES, NO LOS SUBTOTALES: el descuento discrecional ya está
   * aplicado en el total, que es lo que el cliente pagó y lo que entró al
   * cajón.
   */
  /**
   * El turno EN CURSO, con lo vendido en efectivo hasta ahora.
   *
   * Es `montoEsperadoDe` desglosado para mostrarlo mientras la caja está
   * abierta, no una fórmula aparte: el teórico que se ve durante el turno y el
   * esperado contra el que se compara al cerrar tienen que salir del mismo
   * cálculo, o un día dirían dos números distintos.
   */
  public resumenDelTurno(sesion: CajaSesion): {
    readonly ventasEnEfectivo: Decimal;
    readonly cantidadDeVentasEnEfectivo: number;
    readonly montoTeorico: Decimal;
  } {
    const enEfectivo = this.ventas.totalesEnEfectivoDeSesion(sesion.id);
    return {
      ventasEnEfectivo: enEfectivo.length === 0 ? CERO : sumarLista(enEfectivo),
      cantidadDeVentasEnEfectivo: enEfectivo.length,
      montoTeorico: this.montoEsperadoDe(sesion),
    };
  }

  public montoEsperadoDe(sesion: CajaSesion): Decimal {
    const enEfectivo = this.ventas.totalesEnEfectivoDeSesion(sesion.id);
    return sumar(sesion.montoInicial, sumarLista(enEfectivo));
  }

  /**
   * Intenta cerrar un turno.
   *
   * Si la diferencia es cero, cierra directo. Si no, NO cierra: devuelve
   * `REQUIERE_AUTORIZACION` con la diferencia calculada, para que la interfaz
   * muestre exactamente qué se está por autorizar antes de pedir el código.
   */
  public intentarCerrar(
    cajaSesionId: string,
    efectivo: EfectivoDeclarado,
    contexto: ContextoDeCierre,
  ): ResultadoDeCierre {
    const sesion = this.obtenerSesionAbierta(cajaSesionId);
    const autorizacion = contexto.autorizacion;

    // PRIMER FILTRO: ¿esta caja es de quien la está cerrando?
    //
    // Va antes de contar el efectivo a propósito. Si alguien no puede cerrar
    // esta caja, no tiene sentido pedirle que cuente el dinero primero para
    // decírselo después; y el arqueo de una caja ajena sin permiso no debería
    // ni llegar a calcularse.
    const esAjena = this.requiereAutorizacionDeCajaAjena(sesion, contexto.usuarioQueCierra);
    if (esAjena && contexto.autorizacionDeCajaAjena === undefined) {
      return {
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA',
        mensaje:
          'Esta caja la abrió otra persona. Un administrador tiene que autorizar el cierre con su PIN.',
        sesion,
        diferencia: '0.00',
        montoEsperado: montoACadena(this.montoEsperadoDe(sesion)),
        montoReal: '0.00',
        primerConteo: null,
      };
    }

    const montoEsperado = this.montoEsperadoDe(sesion);
    const montoReal = this.montoDeclarado(efectivo);
    // Con Decimal, nunca con aritmética nativa.
    const diferencia = montoReal.minus(montoEsperado);

    const diferenciaTexto = montoACadena(diferencia);
    // Se decide sobre el texto que se va a GUARDAR, no sobre el Decimal que
    // está en memoria. Es el mismo valor contra el que la base aplica su CHECK
    // (migración 008), así que la aplicación y la base no pueden discrepar
    // nunca: si para una la caja cuadra, para la otra también.
    const hayDiferencia = !this.cuadra(diferencia);
    const montoEsperadoTexto = montoACadena(montoEsperado);
    const montoRealTexto = montoACadena(montoReal);

    /*
      EL SELLO DEL CONTEO. Cada llamada a este método ES una confirmación del
      cajero: lo que escribe mientras ajusta el número nunca sale de la
      pantalla, así que antes de confirmar es libre y no deja ningún registro.

      La regla, que parece de dos casos y en realidad es uno solo:

        UN TURNO CON ALGÚN CONTEO SELLADO SOLO SE CIERRA CON AUTORIZACIÓN.

      Porque o bien el conteo final es uno de los sellados —y esos, por
      definición, tenían diferencia, que ya exige PIN—, o bien es otro distinto,
      y cambiar el resultado después de haber visto un problema es exactamente
      la señal que hay que autorizar, cuadre o no el número final. No hay un
      tercer caso: por eso no hace falta decidir si se compara contra el primer
      sello o contra el último.

      Los sellos se leen de `auditoria_log` y no de la memoria, por la misma
      razón por la que los candados de intentos viven en la base (§4.8): esta
      aplicación deja matar el proceso a propósito (§4.5), y un sello en memoria
      se borraría cerrando y volviendo a abrir la aplicación.
    */
    const sellados = this.conteosSelladosDe(sesion.id);

    if (autorizacion === undefined) {
      if (hayDiferencia) {
        const ultimo = sellados.at(-1);
        // Volver a confirmar el MISMO número no es un conteo nuevo: se sella
        // una vez. Si no, reintentar un PIN equivocado llenaría la bitácora.
        const esNuevo =
          ultimo?.montoReal !== montoRealTexto || ultimo.montoEsperado !== montoEsperadoTexto;
        if (esNuevo) {
          this.sellarConteo(sesion, contexto.usuarioQueCierra, {
            montoEsperado: montoEsperadoTexto,
            montoReal: montoRealTexto,
            diferencia: diferenciaTexto,
            modo: efectivo.modo,
          });
        }
        return {
          cerrada: false,
          codigo: 'REQUIERE_AUTORIZACION',
          mensaje: this.describirDiferencia(diferencia),
          sesion: null,
          diferencia: diferenciaTexto,
          montoEsperado: montoEsperadoTexto,
          montoReal: montoRealTexto,
          primerConteo: this.primerConteoDistinto(sellados, montoRealTexto),
        };
      }

      const primero = sellados[0];
      if (primero !== undefined) {
        return {
          cerrada: false,
          codigo: 'REQUIERE_AUTORIZACION_DE_RECONTEO',
          mensaje: this.describirReconteo(sellados, montoRealTexto, montoEsperadoTexto),
          sesion: null,
          diferencia: diferenciaTexto,
          montoEsperado: montoEsperadoTexto,
          montoReal: montoRealTexto,
          primerConteo: primero,
        };
      }
    }

    /** ¿Algún conteo sellado CONTÓ un número distinto del que se está cerrando? */
    const huboReconteo = sellados.some((sellado) => sellado.montoReal !== montoRealTexto);
    /** ¿Algún conteo sellado se hizo contra un ESPERADO distinto del de ahora? */
    const cambioElEsperado = sellados.some((sellado) => sellado.montoEsperado !== montoEsperadoTexto);

    /*
      ¿SE ESCRIBE EL ASIENTO DE LA AUTORIZACIÓN? Hasta el 2026-09-15 dependía
      solo de `huboReconteo`, y eso perdía al autorizante en un caso medido: un
      conteo sellado, después cambia el ESPERADO (una venta en efectivo en el
      medio) y se confirma el MISMO número, que ahora cuadra. Ese cierre pasa
      por `REQUIERE_AUTORIZACION_DE_RECONTEO` y exige el PIN, pero como lo
      contado no cambió no se escribía ningún asiento, y `caja_sesiones` no
      puede guardarlo porque cuadra (CHECK de la 008).

      La regla ahora no depende de por qué: si hubo sellos y el cierre CUADRA,
      llegar hasta acá exigió una autorización —sin ella se devolvió arriba—, y
      esa autorización queda en su asiento SIEMPRE. Se conserva además el caso
      que ya funcionaba —cambió lo contado y el final sigue con diferencia—, en
      el que el autorizante está también en `caja_sesiones`.

      Lo que NO se registra como reconteo, igual que antes: cerrar con el mismo
      número sellado que sigue con diferencia. Ahí no se corrigió nada, y quién
      autorizó queda en `caja_sesiones`.
    */
    const autorizacionExigidaPorUnSello = sellados.length > 0 && !hayDiferencia;
    const registrarAutorizacionDeReconteo = huboReconteo || autorizacionExigidaPorUnSello;

    /*
      Igual que en `abrir`: las tres escrituras del cierre —el desglose, la
      sesión y el asiento— van en UNA transacción desde la Fase 1.a, con su
      entrada de bandeja de salida adentro. Antes iban sueltas.
    */
    const cerrarTodo = (): CajaSesion =>
      enTransaccionDeNegocio(this.base, (): CajaSesion => {
        if (efectivo.modo === 'detallado') {
          this.desglose.guardar(sesion.id, 'cierre', efectivo.lineas);
        }

        const cerrada = this.cajaSesiones.cerrar(sesion.id, {
          montoEsperado,
          montoReal,
          diferencia,
          // NULL cuando cierra quien abrió, que es el caso normal: así un cierre
          // ajeno se ve de un vistazo sin comparar dos columnas.
          cerradaPor: esAjena ? contexto.usuarioQueCierra : null,
          autorizadaPor: hayDiferencia ? (autorizacion?.autorizadaPor ?? null) : null,
          autorizadaVia: hayDiferencia ? (autorizacion?.via ?? null) : null,
        });

        const asiento = this.auditoria.registrar({
          // El asiento se atribuye a QUIEN CERRÓ, que es quien hizo la acción.
          // Quién abrió el turno queda como dato del asiento: si se atribuyera al
          // que abrió, la bitácora diría que el cierre lo hizo alguien que quizá
          // ya se había ido de la tienda.
          usuarioId: contexto.usuarioQueCierra,
          accion: ACCIONES_DE_CAJA.cierreDeCaja,
          entidadTipo: 'caja_sesiones',
          entidadId: sesion.id,
          valorNuevo: {
            montoEsperado: montoACadena(montoEsperado),
            montoReal: montoACadena(montoReal),
            diferencia: diferenciaTexto,
            modo: efectivo.modo,
            abiertaPor: sesion.usuarioId,
            cerradaPor: contexto.usuarioQueCierra,
            // Las tres personas posibles de un cierre quedan separadas: quien
            // abrió, quien cerró, quien autorizó el cierre ajeno y quien autorizó
            // la diferencia. No son la misma y confundirlas arruina la auditoría.
            fueCajaAjena: esAjena,
            cierreAjenoAutorizadoPor: esAjena
              ? (contexto.autorizacionDeCajaAjena?.autorizadaPor ?? null)
              : null,
            autorizadaPor: hayDiferencia ? (autorizacion?.autorizadaPor ?? null) : null,
            autorizadaVia: hayDiferencia ? (autorizacion?.via ?? null) : null,
            // Cuántos conteos con diferencia se confirmaron antes de este, y si
            // el cierre fue con uno distinto (§4.39).
            conteosSellados: sellados.length,
            huboReconteo,
            cambioElEsperado,
          },
          fecha: new Date(this.ahora()).toISOString(),
        });

        /*
          EL RECONTEO AUTORIZADO VA EN SU PROPIO ASIENTO, y no solo como dato del
          cierre: si el número final cuadra, `caja_sesiones` NO PUEDE guardar
          quién autorizó —el CHECK de la migración 008 exige esas columnas
          vacías cuando la diferencia es '0.00'—, así que la única constancia de
          esa autorización es este asiento. Lleva los DOS lados: cada conteo
          sellado, con su diferencia, y el final.
        */
        const asientoDeReconteo = registrarAutorizacionDeReconteo
          ? this.auditoria.registrar({
              usuarioId: contexto.usuarioQueCierra,
              accion: ACCIONES_DE_CAJA.reconteoAutorizado,
              entidadTipo: 'caja_sesiones',
              entidadId: sesion.id,
              valorAnterior: {
                conteosSellados: sellados.map((sellado) => ({
                  fecha: sellado.fecha,
                  montoEsperado: sellado.montoEsperado,
                  montoReal: sellado.montoReal,
                  diferencia: sellado.diferencia,
                  modo: sellado.modo,
                })),
              },
              valorNuevo: {
                montoEsperado: montoEsperadoTexto,
                montoReal: montoRealTexto,
                diferencia: diferenciaTexto,
                modo: efectivo.modo,
                autorizadaPor: autorizacion?.autorizadaPor ?? null,
                autorizadaVia: autorizacion?.via ?? null,
                // Por qué se exigió: son causas distintas y quien audita tiene
                // que poder separarlas sin recalcular nada.
                cambioElConteo: huboReconteo,
                cambioElEsperado,
              },
              fecha: new Date(this.ahora()).toISOString(),
            })
          : null;

        // La sesión va como `actualizar`: el cierre no la creó, la cerró.
        const entradas: EntradaDelLote[] = [
          { tabla: 'caja_sesiones', id: cerrada.id, operacion: 'actualizar' },
          ...entradasDe(
            'caja_sesion_denominaciones',
            this.desglose.listarPorSesion(cerrada.id, 'cierre').map((linea) => linea.id),
            'insertar',
          ),
          { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
          ...(asientoDeReconteo === null
            ? []
            : [{ tabla: 'auditoria_log' as const, id: asientoDeReconteo.id, operacion: 'insertar' as const }]),
        ];
        encolarLote(this.base, entradas);

        return cerrada;
      });

    const cerrada = cerrarTodo();

    return {
      cerrada: true,
      codigo: 'CIERRE_CORRECTO',
      mensaje: hayDiferencia
        ? `Turno cerrado con ${this.describirDiferencia(diferencia)}`
        : 'Turno cerrado. La caja cuadra exactamente.',
      sesion: cerrada,
      diferencia: diferenciaTexto,
      montoEsperado: montoEsperadoTexto,
      montoReal: montoRealTexto,
      primerConteo: this.primerConteoDistinto(sellados, montoRealTexto),
    };
  }

  /**
   * Los conteos de cierre sellados de un turno, del más viejo al más nuevo.
   *
   * Salen de `auditoria_log`, que es inmutable por trigger: un sello no se
   * puede borrar ni editar, ni siquiera con una consulta a mano.
   */
  public conteosSelladosDe(cajaSesionId: string): readonly ConteoSellado[] {
    return this.auditoria
      .listarPorEntidadYAccion('caja_sesiones', cajaSesionId, ACCIONES_DE_CAJA.conteoSellado)
      .map((asiento): ConteoSellado => {
        const datos = JSON.parse(asiento.valorNuevo ?? '{}') as {
          readonly montoEsperado: string;
          readonly montoReal: string;
          readonly diferencia: string;
          readonly modo: ModoDeCaptura;
        };
        return {
          asientoId: asiento.id,
          fecha: asiento.fecha,
          montoEsperado: datos.montoEsperado,
          montoReal: datos.montoReal,
          diferencia: datos.diferencia,
          modo: datos.modo,
        };
      });
  }

  /**
   * Por qué un cierre que cuadra exige autorización, dicho sin confundir las
   * dos causas: que cambió lo CONTADO, o que cambió lo que el sistema ESPERA.
   *
   * Solo lo ve un administrativo: a otro rol el proceso principal le reemplaza
   * el mensaje entero, porque nombra el esperado (§4.40.3). Las dos banderas
   * miran TODOS los sellos, igual que `huboReconteo`; los números que se citan
   * son los del último sello, que es lo más reciente que se confirmó.
   */
  private describirReconteo(
    sellados: readonly ConteoSellado[],
    montoRealTexto: string,
    montoEsperadoTexto: string,
  ): string {
    const ultimo = sellados.at(-1);
    if (ultimo === undefined) {
      return 'Este turno no tiene conteos sellados.';
    }
    const cambioElConteo = sellados.some((sellado) => sellado.montoReal !== montoRealTexto);
    const cambioElEsperado = sellados.some((sellado) => sellado.montoEsperado !== montoEsperadoTexto);
    const antes =
      `${sellados.length > 1 ? 'El último conteo confirmado fue' : 'Antes se confirmó un conteo'} de ` +
      `Q${ultimo.montoReal} con ${this.describirDiferencia(new Decimal(ultimo.diferencia))}, ` +
      `cuando el sistema esperaba Q${ultimo.montoEsperado}. `;

    if (cambioElEsperado && !cambioElConteo) {
      return (
        antes +
        'Lo contado no cambió: lo que cambió es lo que el sistema espera, que ' +
        `era Q${ultimo.montoEsperado} y ahora es Q${montoEsperadoTexto}. ` +
        'Cerrar un turno que tuvo un conteo con diferencia exige la autorización de un administrador, aunque ahora cuadre.'
      );
    }
    if (cambioElEsperado && cambioElConteo) {
      return (
        antes +
        `Desde entonces cambiaron las dos cosas: lo contado (ahora Q${montoRealTexto}) ` +
        `y lo que el sistema espera (ahora Q${montoEsperadoTexto}). ` +
        'Cerrar un turno que tuvo un conteo con diferencia exige la autorización de un administrador, aunque ahora cuadre.'
      );
    }
    return (
      antes +
      `Ahora se contaron Q${montoRealTexto}: cambió lo contado. ` +
      'Corregir un conteo que mostraba una diferencia exige la autorización de un administrador, aunque ahora cuadre.'
    );
  }

  /** El primer sello, solo si su número es distinto del conteo de ahora. */
  private primerConteoDistinto(
    sellados: readonly ConteoSellado[],
    montoRealTexto: string,
  ): ConteoSellado | null {
    const primero = sellados[0];
    return primero !== undefined && primero.montoReal !== montoRealTexto ? primero : null;
  }

  /**
   * Escribe el sello de un conteo confirmado con diferencia.
   *
   * En su PROPIA transacción, y se confirma aunque el cierre no llegue a
   * ocurrir: es justamente el rastro que tiene que quedar si el cajero se
   * arrepiente y prueba otro número. Va a la bandeja de salida como cualquier
   * hecho del negocio (§4.26), en un lote de un solo asiento que sube por
   * `sincronizar_asiento`.
   */
  private sellarConteo(
    sesion: CajaSesion,
    usuarioId: string,
    conteo: Omit<ConteoSellado, 'asientoId' | 'fecha'>,
  ): void {
    enTransaccionDeNegocio(this.base, (): void => {
      const asiento = this.auditoria.registrar({
        usuarioId,
        accion: ACCIONES_DE_CAJA.conteoSellado,
        entidadTipo: 'caja_sesiones',
        entidadId: sesion.id,
        valorNuevo: conteo,
        fecha: new Date(this.ahora()).toISOString(),
      });
      encolarLote(this.base, [{ tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' }]);
    });
  }

  /**
   * ¿Esta diferencia cuenta como caja cuadrada?
   *
   * Se compara la forma canónica de dos decimales, la misma que se guarda en
   * la columna, y no `Decimal.isZero()`. Son criterios que hoy coinciden —los
   * montos de caja son exactos al centavo—, pero si alguna vez apareciera una
   * diferencia por debajo del centavo, `isZero()` diría que hay descuadre y
   * pediría un PIN por algo que se guarda como '0.00' y que en efectivo físico
   * no existe. La base rechazaría ese cierre. Manda el valor guardado.
   */
  private cuadra(diferencia: Decimal): boolean {
    return montoACadena(diferencia) === '0.00';
  }

  /** Texto que ve quien autoriza: cuánto y de qué signo. */
  public describirDiferencia(diferencia: Decimal): string {
    if (this.cuadra(diferencia)) {
      return 'sin diferencia';
    }
    const magnitud = montoACadena(diferencia.absoluteValue());
    return diferencia.isNegative()
      ? `un FALTANTE de Q${magnitud}`
      : `un SOBRANTE de Q${magnitud}`;
  }

  /** Momentos de arqueo guardados de una sesión. */
  public desgloseDe(cajaSesionId: string, momento: MomentoDeArqueo): readonly LineaDeDesglose[] {
    return this.desglose.listarPorSesion(cajaSesionId, momento).map((fila) => ({
      denominacionId: fila.denominacionId,
      cantidad: fila.cantidad,
    }));
  }

  private obtenerSesionAbierta(cajaSesionId: string): CajaSesion {
    const sesion = this.cajaSesiones.obtenerPorId(cajaSesionId);
    if (sesion === null) {
      throw new ErrorDeNegocio(
        'REFERENCIA_INEXISTENTE',
        'No se encontró el turno de caja que se quiere cerrar.',
        `caja_sesion_id inexistente: ${cajaSesionId}`,
      );
    }
    if (sesion.estado !== 'abierta') {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Ese turno de caja ya está cerrado.',
        `caja_sesion_id ${cajaSesionId} en estado ${sesion.estado}.`,
      );
    }
    return sesion;
  }
}
