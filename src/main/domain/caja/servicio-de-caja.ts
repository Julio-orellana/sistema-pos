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
 */

import type { Database } from 'better-sqlite3';

import Decimal from 'decimal.js';

import { CERO, montoACadena, multiplicar, sumar, sumarLista } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { encolarLote, entradasDe, type EntradaDelLote } from '@main/database/bandeja-de-salida';
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
} as const;

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
    /** La abrió otra persona y falta el PIN del administrador. */
    | 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA';
  readonly mensaje: string;
  readonly sesion: CajaSesion | null;
  /** Diferencia calculada, como cadena canónica, para mostrarla al autorizar. */
  readonly diferencia: string;
  readonly montoEsperado: string;
  readonly montoReal: string;
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
    const abrirTodo = this.base.transaction((): CajaSesion => {
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

    if (hayDiferencia && autorizacion === undefined) {
      return {
        cerrada: false,
        codigo: 'REQUIERE_AUTORIZACION',
        mensaje: this.describirDiferencia(diferencia),
        sesion: null,
        diferencia: diferenciaTexto,
        montoEsperado: montoACadena(montoEsperado),
        montoReal: montoACadena(montoReal),
      };
    }

    /*
      Igual que en `abrir`: las tres escrituras del cierre —el desglose, la
      sesión y el asiento— van en UNA transacción desde la Fase 1.a, con su
      entrada de bandeja de salida adentro. Antes iban sueltas.
    */
    const cerrarTodo = this.base.transaction((): CajaSesion => {
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
        },
        fecha: new Date(this.ahora()).toISOString(),
      });

      // La sesión va como `actualizar`: el cierre no la creó, la cerró.
      const entradas: EntradaDelLote[] = [
        { tabla: 'caja_sesiones', id: cerrada.id, operacion: 'actualizar' },
        ...entradasDe(
          'caja_sesion_denominaciones',
          this.desglose.listarPorSesion(cerrada.id, 'cierre').map((linea) => linea.id),
          'insertar',
        ),
        { tabla: 'auditoria_log', id: asiento.id, operacion: 'insertar' },
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
      montoEsperado: montoACadena(montoEsperado),
      montoReal: montoACadena(montoReal),
    };
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
