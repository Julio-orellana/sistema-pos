/**
 * La restauración desde la nube (§6 del diseño, fase 4.b): la operación
 * inversa de toda la sincronización, y la segunda de las dos superficies que
 * el diseño marca como las más delicadas del módulo.
 *
 * ===========================================================================
 * NINGÚN ID SE REGENERA. NUNCA.
 * ===========================================================================
 *
 * El id de cada fila local es EXACTAMENTE el que tiene en la nube. No es una
 * preferencia: es lo que impide que una reinstalación choque contra las ocho
 * restricciones únicas del punto 19 de §6.2 de CLAUDE.md —`usuarios.nombre`,
 * `productos.nombre` y las demás— la primera vez que la terminal restaurada
 * vuelva a subir algo. Si en algún punto de este archivo pareciera más simple
 * generar un id nuevo, es una señal de que se está entendiendo mal el problema.
 *
 * ===========================================================================
 * LAS CINCO REGLAS QUE ESTE SERVICIO HACE CUMPLIR
 * ===========================================================================
 *
 *   1. **Solo sobre una base VACÍA** (§6.1). Con una sola fila de negocio, se
 *      niega. No hay modo «fusionar» ni «sobrescribir»: mezclar lo que hay con
 *      lo que baja es el escenario multi-escritor que el diseño no cubre.
 *   2. **Ninguna fila antes de las precondiciones** (§6.2): sesión con el rol
 *      `restauracion`, nube alcanzable, contrato igual al esquema local,
 *      denominaciones idénticas, orden compatible con las llaves foráneas.
 *   3. **Las filas se leen con SELECT directo**, bajo las políticas de la
 *      0025; nunca por las funciones `sincronizar_*`, que son la puerta de
 *      ESCRITURA de la terminal y exigen otro rol.
 *   4. **Todo usuario restaurado queda SIN PIN** —el centinela `HASH_SIN_PIN`,
 *      ver `@shared/auth`— y la restauración no termina mientras un usuario
 *      activo siga así. Es la decisión 15 del diseño, por construcción.
 *   5. **Retomable y cancelable** (§6.6): el progreso se guarda al terminar
 *      cada página; cada fila se inserta con «no hacer nada si ya existe», así
 *      que repetir una página no duplica y cancelar deja la base al final de
 *      la última página completa.
 *
 * ===========================================================================
 * LAS ANOMALÍAS DE §6.5, Y UNA DECISIÓN QUE EL DISEÑO NO CERRABA
 * ===========================================================================
 *
 * §6.5 pide filtrar por `recibido_en` —la única fecha que el ladrón no
 * controla— y mostrar aparte, «sin restaurar», lo posterior a la fecha del
 * robo. Aplicado al pie de la letra rompería las llaves foráneas de lo
 * legítimo: una fila anterior al robo y MODIFICADA después (un producto cuyo
 * inventario bajó una venta falsa, una caja abierta antes y cerrada por el
 * ladrón) tiene `recibido_en` posterior, y excluirla dejaría sin padre a las
 * ventas legítimas que la referencian.
 *
 * La regla que se aplica, y que está escrita en `orden-de-restauracion.ts`:
 *
 *   · En las tablas que la nube SOLO INSERTA (`ventas`, `venta_detalle`,
 *     `recibos`, `caja_sesion_denominaciones`, `auditoria_log`), una marca
 *     posterior al robo significa «insertada por quien tenía la credencial»,
 *     y ninguna fila anterior la referencia. **Se excluyen**, se listan, y el
 *     administrador puede pedir restaurar cada una igual —una venta con sus
 *     líneas y su recibo—.
 *   · En las tablas que la nube TAMBIÉN ACTUALIZA, la fila **se restaura y se
 *     lista para revisión**: no se puede saber si fue insertada o tocada, y
 *     excluirla rompería lo legítimo. Para `usuarios` la revisión es
 *     obligatoria uno por uno, como exige §6.5: un cajero promovido o un
 *     administrador nuevo es exactamente lo que 1.5.1 admite que no se puede
 *     impedir y sí se puede detectar.
 *
 * ===========================================================================
 * LO QUE SÍ SE ENCOLA Y LO QUE NO
 * ===========================================================================
 *
 * Las filas restauradas NO se encolan: vienen de la nube y ya están allá. Las
 * DECISIONES tomadas durante la restauración —un PIN asignado, un usuario
 * revisado, una fila excluida restaurada a mano, la restauración misma— son
 * hechos del negocio y se escriben con `conBandejaDeSalida`, así que llegan a
 * la nube cuando la terminal se conecte con su propia credencial. Es la
 * primera vez que `src/main/restauracion` escribe en `auditoria_log`, y la
 * prueba estructural de §4.26 lo vigila también.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database } from 'better-sqlite3';

import { generarHashDePin, HASH_SIN_PIN, tienePin } from '@shared/auth';
import { montoACadena, sumarLista } from '@shared/money';
import { tieneFormatoDePinValido } from '@shared/pin';
import { conBandejaDeSalida } from '@main/database/bandeja-de-salida';
import { ejecutarTraduciendoErrores, ErrorDeNegocio } from '@main/database/errores';
import type { RepositorioDeAuditoria } from '@main/database/repositories/auditoria-log';
import type { Rol } from '@main/database/repositories/entidades';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import { enTransaccionDeNegocio } from '@main/database/transaccion-en-curso';
import { resolverRutaDeFoto } from '@main/domain/catalogo/almacen-de-fotos';
import { rutaRelativaDePdfDesde } from '@main/domain/recibo/ruta-de-pdf';
import { exigirPinNoUsado } from '@main/domain/usuarios/colision-de-pin';
import type { ClienteDeRestauracion } from './cliente-de-restauracion';
import {
  convertirFila,
  nombreDeArchivoDe,
  type FilaDeLaNube,
  type FilaParaSqlite,
} from './conversion-de-tipos';
import { diferenciasEntreContratoYEsquemaLocal, type ColumnaLocal } from './deriva-de-esquema';
import {
  comprobarOrdenContraLasLlaves,
  ORDEN_DE_RESTAURACION,
  TABLA_QUE_SOLO_SE_VERIFICA,
  TABLAS_QUE_SOLO_SE_INSERTAN,
  type TablaRestaurable,
} from './orden-de-restauracion';
import {
  type AlmacenDelPuestoDeControl,
  type AnomaliaRegistrada,
  type MotivoDeRestauracion,
  type PuestoDeControl,
} from './puesto-de-control';

/** Nombres de acción para `auditoria_log`, propios de la restauración. */
export const ACCIONES_DE_RESTAURACION = {
  completada: 'restauracion_completada',
  pinAsignado: 'pin_asignado_en_restauracion',
  usuarioRevisado: 'usuario_revisado_en_restauracion',
  filaRestauradaAMano: 'fila_excluida_restaurada_a_mano',
} as const;

/** Filas por página. Es el tope de PostgREST; las pruebas lo bajan para forzar varias páginas. */
export const FILAS_POR_PAGINA_POR_DEFECTO = 1000;

/** Sobre cuántos segundos se mide el ritmo que se muestra (§6.6). */
const VENTANA_DEL_RITMO_MS = 30_000;
const MS_POR_SEGUNDO = 1000;

/** Las once del quetzal, sembradas por la 004 local y la 0004 de la nube. */
const DENOMINACIONES_ESPERADAS = 11;

/** Las tablas que tienen que estar vacías para poder restaurar: las doce, menos la de fila fija. */
const TABLAS_QUE_DEBEN_ESTAR_VACIAS: readonly TablaRestaurable[] = ORDEN_DE_RESTAURACION.filter(
  (tabla) => tabla !== 'configuracion_negocio',
);

export type FaseDeRestauracion =
  | 'inactiva'
  | 'iniciando'
  | 'tablas'
  | 'archivos'
  | 'verificacion'
  | 'revision'
  | 'terminada'
  | 'cancelada'
  | 'fallida';

export interface ProgresoDeTabla {
  readonly tabla: string;
  readonly estado: 'esperando' | 'bajando' | 'lista';
  readonly filas: number;
  readonly total: number | null;
}

export interface ConteoVerificado {
  readonly tabla: string;
  readonly nube: number;
  readonly local: number;
  readonly excluidas: number;
  readonly coincide: boolean;
}

export interface MesVerificado {
  readonly mes: string;
  readonly nube: string;
  readonly local: string;
  readonly excluidas: string;
  readonly coincide: boolean;
}

export interface VerificacionDeRestauracion {
  readonly conteos: readonly ConteoVerificado[];
  readonly ventasPorMes: readonly MesVerificado[];
  readonly ok: boolean;
  readonly detalle: readonly string[];
}

export interface AnomaliaDeRestauracion extends AnomaliaRegistrada {
  readonly revisada: boolean;
}

export interface UsuarioRestaurado {
  readonly id: string;
  readonly nombre: string;
  readonly rol: Rol;
  readonly activo: boolean;
  readonly sinPin: boolean;
  readonly anomalo: boolean;
  readonly revisado: boolean;
}

export interface ProgresoDeRestauracion {
  readonly configurada: boolean;
  readonly fase: FaseDeRestauracion;
  readonly mensaje: string | null;
  readonly proyecto: string | null;
  readonly correo: string | null;
  readonly motivo: MotivoDeRestauracion | null;
  readonly fechaDelRobo: string | null;
  readonly tablas: readonly ProgresoDeTabla[];
  readonly fotos: { readonly hechas: number; readonly total: number; readonly faltantes: readonly string[] } | null;
  readonly verificacion: VerificacionDeRestauracion | null;
  readonly anomalias: readonly AnomaliaDeRestauracion[];
  readonly usuarios: readonly UsuarioRestaurado[];
  readonly filasPorSegundo: number | null;
  readonly filasRestantes: number | null;
  readonly baseVacia: boolean;
  readonly hayRestauracionIncompleta: boolean;
}

export interface DatosParaIniciar {
  readonly correo: string;
  readonly contrasena: string;
  readonly motivo: MotivoDeRestauracion;
  /** ISO-8601. Obligatoria con motivo `robo`; ignorada con `falla`. */
  readonly fechaDelRobo: string | null;
}

export interface DependenciasDeRestauracion {
  readonly base: Database;
  readonly usuarios: RepositorioDeUsuarios;
  readonly auditoria: RepositorioDeAuditoria;
  /** `null` cuando esta copia no tiene proyecto de nube configurado. */
  readonly cliente: ClienteDeRestauracion | null;
  readonly urlDelProyecto: string | null;
  readonly puestoDeControl: AlmacenDelPuestoDeControl;
  /** `app.getPath('userData')`: de acá cuelgan `fotos-de-productos/` y `recibos/`. */
  readonly carpetaDeDatos: string;
  /** La capa 2 de §5: ¿se llega a la nube? Sin esto no se comprueba (las pruebas). */
  readonly comprobarNube?: () => Promise<{ readonly hayNube: boolean; readonly motivo: string }>;
  readonly filasPorPagina?: number;
  readonly ahora?: () => number;
  readonly registrar?: (mensaje: string) => void;
}

interface FilaDeUsuarioCruda {
  readonly id: string;
  readonly nombre: string;
  readonly rol: Rol;
  readonly activo: number;
  readonly pin_hash: string;
}

export class ServicioDeRestauracion {
  private readonly base: Database;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly auditoria: RepositorioDeAuditoria;
  private readonly cliente: ClienteDeRestauracion | null;
  private readonly urlDelProyecto: string | null;
  private readonly almacenDelPuesto: AlmacenDelPuestoDeControl;
  private readonly carpetaDeDatos: string;
  private readonly comprobarNube: (() => Promise<{ readonly hayNube: boolean; readonly motivo: string }>) | null;
  private readonly filasPorPagina: number;
  private readonly ahora: () => number;
  private readonly registrar: (mensaje: string) => void;

  private fase: FaseDeRestauracion = 'inactiva';
  private mensaje: string | null = null;
  private puesto: PuestoDeControl | null = null;
  private cancelacionPedida = false;
  private corriendo: Promise<void> | null = null;
  private verificacion: VerificacionDeRestauracion | null = null;
  private totalesDeLaNube = new Map<string, number>();
  private fotos: { hechas: number; total: number } | null = null;
  /** Muestras (instante, filas acumuladas) para el ritmo de §6.6. */
  private muestras: { readonly en: number; readonly filas: number }[] = [];

  public constructor(dependencias: DependenciasDeRestauracion) {
    this.base = dependencias.base;
    this.usuarios = dependencias.usuarios;
    this.auditoria = dependencias.auditoria;
    this.cliente = dependencias.cliente;
    this.urlDelProyecto = dependencias.urlDelProyecto;
    this.almacenDelPuesto = dependencias.puestoDeControl;
    this.carpetaDeDatos = dependencias.carpetaDeDatos;
    this.comprobarNube = dependencias.comprobarNube ?? null;
    this.filasPorPagina = dependencias.filasPorPagina ?? FILAS_POR_PAGINA_POR_DEFECTO;
    this.ahora = dependencias.ahora ?? ((): number => Date.now());
    this.registrar = dependencias.registrar ?? ((): void => undefined);
    this.puesto = this.almacenDelPuesto.leer();
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  /** ¿Hay un puesto de control de una restauración que no terminó? Lo lee el arranque. */
  public hayRestauracionIncompleta(): boolean {
    return this.fase !== 'terminada' && this.almacenDelPuesto.existe();
  }

  public baseVacia(): boolean {
    return this.tablasConFilas().length === 0;
  }

  private tablasConFilas(): string[] {
    return TABLAS_QUE_DEBEN_ESTAR_VACIAS.filter((tabla) => this.contarLocal(tabla) > 0);
  }

  private contarLocal(tabla: string): number {
    // El nombre viene de la lista cerrada de tablas restaurables, nunca de una entrada.
    const fila = this.base.prepare(`SELECT count(*) AS total FROM ${tabla}`).get() as { readonly total: number };
    return fila.total;
  }

  /**
   * Cuántas filas LOCALES vinieron de la nube. Es lo que se compara contra el
   * conteo de la nube.
   *
   * Para `auditoria_log` se descuentan los asientos que la PROPIA restauración
   * escribe —un PIN asignado, un usuario revisado, una fila restaurada a mano,
   * la restauración completada—: no vienen de la nube, viajan hacia ella, y
   * contarlos haría que la verificación fallara por lo que la restauración
   * misma hizo bien.
   */
  private contarRestauradas(tabla: string): number {
    if (tabla !== 'auditoria_log') {
      return this.contarLocal(tabla);
    }
    const propias = Object.values(ACCIONES_DE_RESTAURACION);
    const fila = this.base
      .prepare(`SELECT count(*) AS total FROM auditoria_log WHERE accion NOT IN (${propias.map(() => '?').join(', ')})`)
      .get(...propias) as { readonly total: number };
    return fila.total;
  }

  public progreso(): ProgresoDeRestauracion {
    const puesto = this.puesto;
    const tablas: ProgresoDeTabla[] = ORDEN_DE_RESTAURACION.map((tabla) => {
      const avance = puesto?.tablas[tabla];
      return {
        tabla,
        estado: avance === undefined ? 'esperando' : avance.lista ? 'lista' : 'bajando',
        filas: avance?.filas ?? 0,
        total: this.totalesDeLaNube.get(tabla) ?? null,
      };
    });
    const conocidas = tablas.filter((t) => t.total !== null);
    const filasRestantes =
      conocidas.length === 0 ? null : conocidas.reduce((suma, t) => suma + Math.max(0, (t.total ?? 0) - t.filas), 0);

    return {
      configurada: this.cliente !== null,
      fase: this.fase,
      mensaje: this.mensaje,
      proyecto: puesto?.proyecto ?? this.urlDelProyecto,
      correo: puesto?.correo ?? null,
      motivo: puesto?.motivo ?? null,
      fechaDelRobo: puesto?.fechaDelRobo ?? null,
      tablas,
      fotos: this.fotos === null ? null : { ...this.fotos, faltantes: puesto?.fotosFaltantes ?? [] },
      verificacion: this.verificacion,
      anomalias: (puesto?.anomalias ?? []).map((anomalia) => ({
        ...anomalia,
        revisada: anomalia.tabla === 'usuarios' && (puesto?.usuariosRevisados ?? []).includes(anomalia.id),
      })),
      usuarios: this.usuariosRestaurados(),
      filasPorSegundo: this.ritmo(),
      filasRestantes,
      baseVacia: this.baseVacia(),
      hayRestauracionIncompleta: this.hayRestauracionIncompleta(),
    };
  }

  private usuariosRestaurados(): UsuarioRestaurado[] {
    const anomalos = new Set((this.puesto?.anomalias ?? []).filter((a) => a.tabla === 'usuarios').map((a) => a.id));
    const revisados = new Set(this.puesto?.usuariosRevisados ?? []);
    const filas = this.base
      .prepare('SELECT id, nombre, rol, activo, pin_hash FROM usuarios ORDER BY activo DESC, nombre')
      .all() as FilaDeUsuarioCruda[];
    return filas.map((fila) => ({
      id: fila.id,
      nombre: fila.nombre,
      rol: fila.rol,
      activo: fila.activo === 1,
      sinPin: !tienePin(fila.pin_hash),
      anomalo: anomalos.has(fila.id),
      revisado: revisados.has(fila.id),
    }));
  }

  private ritmo(): number | null {
    const ahora = this.ahora();
    this.muestras = this.muestras.filter((m) => ahora - m.en <= VENTANA_DEL_RITMO_MS);
    const primera = this.muestras[0];
    const ultima = this.muestras[this.muestras.length - 1];
    if (primera === undefined || ultima === undefined || ultima.en === primera.en) {
      return null;
    }
    return Math.round(((ultima.filas - primera.filas) * MS_POR_SEGUNDO) / (ultima.en - primera.en));
  }

  private anotarRitmo(filasAcumuladas: number): void {
    this.muestras.push({ en: this.ahora(), filas: filasAcumuladas });
  }

  // -------------------------------------------------------------------------
  // Iniciar y retomar
  // -------------------------------------------------------------------------

  private exigirCliente(): ClienteDeRestauracion {
    if (this.cliente === null || this.urlDelProyecto === null) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Esta copia de la aplicación no tiene configurado ningún proyecto de nube, así que no hay de dónde restaurar.',
        'sin POS_NUBE_URL',
      );
    }
    return this.cliente;
  }

  private exigirQueNoEsteCorriendo(): void {
    if (this.corriendo !== null) {
      throw new ErrorDeNegocio('DATO_INVALIDO', 'Ya hay una restauración en marcha.', `fase ${this.fase}`);
    }
  }

  /**
   * Arranca una restauración NUEVA. Solo sobre una base vacía y sin puesto de
   * control previo: si hay uno, lo que corresponde es retomar.
   *
   * Comprueba TODAS las precondiciones de §6.2 antes de devolver, así que un
   * fallo —contraseña equivocada, deriva de esquema, denominaciones distintas—
   * llega como error de negocio a quien llamó, con su motivo, y no queda nada
   * escrito. Recién después lanza la transferencia en segundo plano.
   */
  public async iniciar(datos: DatosParaIniciar): Promise<ProgresoDeRestauracion> {
    const cliente = this.exigirCliente();
    this.exigirQueNoEsteCorriendo();

    if (this.almacenDelPuesto.existe()) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Hay una restauración incompleta en esta instalación. Retomala, o borrá la carpeta de datos para empezar de cero.',
        'existe restauracion.json',
      );
    }
    const conFilas = this.tablasConFilas();
    if (conFilas.length > 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `Esta instalación ya tiene datos (${conFilas.join(', ')}). La restauración es solo para una terminal nueva o vacía: no hay modo de fusionar ni de sobrescribir.`,
        `tablas con filas: ${conFilas.join(', ')}`,
      );
    }
    if (datos.motivo === 'robo' && (datos.fechaDelRobo === null || Number.isNaN(Date.parse(datos.fechaDelRobo)))) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Para un robo hace falta la fecha y hora aproximadas: es lo que se usa para revisar lo que el ladrón pudo escribir. Ante la duda, elegí una fecha anterior.',
        `fechaDelRobo = ${String(datos.fechaDelRobo)}`,
      );
    }

    this.fase = 'iniciando';
    this.mensaje = null;
    try {
      const sesion = await cliente.iniciarSesion(datos.correo, datos.contrasena);
      await this.comprobarPrecondiciones(cliente);
      this.puesto = {
        version: 1,
        proyecto: this.urlDelProyecto ?? '',
        correo: sesion.correo,
        motivo: datos.motivo,
        fechaDelRobo: datos.motivo === 'robo' ? new Date(datos.fechaDelRobo ?? '').toISOString() : null,
        iniciadaEn: new Date(this.ahora()).toISOString(),
        tablas: {},
        anomalias: [],
        usuariosRevisados: [],
        fotosFaltantes: [],
        transferenciaCompleta: false,
      };
      this.almacenDelPuesto.guardar(this.puesto);
    } catch (error) {
      this.fase = 'inactiva';
      await cliente.cerrarSesion();
      throw error;
    }

    this.lanzar(cliente);
    return this.progreso();
  }

  /** Sigue una restauración interrumpida, por la tabla y la página donde quedó. */
  public async retomar(credenciales: { readonly correo: string; readonly contrasena: string }): Promise<ProgresoDeRestauracion> {
    const cliente = this.exigirCliente();
    this.exigirQueNoEsteCorriendo();
    const puesto = this.almacenDelPuesto.leer();
    if (puesto === null) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        this.almacenDelPuesto.existe()
          ? 'El puesto de control de la restauración está dañado y no se puede retomar. Borrá la carpeta de datos y empezá de cero.'
          : 'No hay ninguna restauración incompleta que retomar.',
        'sin puesto de control legible',
      );
    }
    if (puesto.proyecto !== this.urlDelProyecto) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `La restauración incompleta es de otro proyecto (${puesto.proyecto}) y esta copia apunta a ${this.urlDelProyecto ?? '—'}. No se mezclan.`,
        'proyecto distinto',
      );
    }

    this.fase = 'iniciando';
    this.mensaje = null;
    try {
      await cliente.iniciarSesion(credenciales.correo, credenciales.contrasena);
      await this.comprobarPrecondiciones(cliente);
    } catch (error) {
      this.fase = 'cancelada';
      await cliente.cerrarSesion();
      throw error;
    }
    this.puesto = puesto;
    this.lanzar(cliente);
    return this.progreso();
  }

  private lanzar(cliente: ClienteDeRestauracion): void {
    this.cancelacionPedida = false;
    this.muestras = [];
    this.corriendo = this.correr(cliente).finally(() => {
      this.corriendo = null;
    });
  }

  /** La promesa de la corrida en curso, para que las pruebas puedan esperarla. */
  public async esperarACorrida(): Promise<void> {
    await this.corriendo;
  }

  /**
   * Pide parar. La corrida se detiene al terminar la página en curso: cancelar
   * deja la base en el estado de la última página completa (§6.6), nunca a
   * mitad de una.
   */
  public async cancelar(): Promise<ProgresoDeRestauracion> {
    if (this.corriendo !== null) {
      this.cancelacionPedida = true;
      await this.corriendo;
    } else if (this.fase === 'revision') {
      this.fase = 'cancelada';
      await this.cliente?.cerrarSesion();
    }
    return this.progreso();
  }

  // -------------------------------------------------------------------------
  // Precondiciones (§6.2)
  // -------------------------------------------------------------------------

  private columnasLocales(tabla: string): ColumnaLocal[] | null {
    const filas = this.base.prepare(`PRAGMA table_info(${tabla})`).all() as { readonly name: string; readonly notnull: number }[];
    if (filas.length === 0) {
      return null;
    }
    return filas.map((fila) => ({ nombre: fila.name, nulable: fila.notnull === 0 }));
  }

  private async comprobarPrecondiciones(cliente: ClienteDeRestauracion): Promise<void> {
    if (this.comprobarNube !== null) {
      const veredicto = await this.comprobarNube();
      if (!veredicto.hayNube) {
        throw new ErrorDeNegocio(
          'DATO_INVALIDO',
          `No se llega a la nube: ${veredicto.motivo} Si el proyecto lleva semanas sin uso puede estar PAUSADO: entrá al panel de Supabase y reanudalo.`,
          veredicto.motivo,
        );
      }
    }

    const violaciones = comprobarOrdenContraLasLlaves(this.base);
    if (violaciones.length > 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El orden de restauración no respeta las llaves foráneas de esta base: ${violaciones.join('; ')}.`,
        violaciones.join('; '),
      );
    }

    const contrato = await cliente.contrato();
    const diferencias = diferenciasEntreContratoYEsquemaLocal(contrato, (tabla) => this.columnasLocales(tabla));
    if (diferencias.length > 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `El esquema de la nube y el de esta terminal NO coinciden, y restaurar así es restaurar mal en silencio. No se bajó ninguna fila. Diferencias: ${diferencias.join('; ')}.`,
        diferencias.join('; '),
      );
    }

    await this.verificarDenominaciones(cliente);
    this.registrar('precondiciones cumplidas: nube alcanzable, contrato igual al esquema local, denominaciones idénticas');
  }

  /** §6.3, paso 3: las once del quetzal no se traen; se comprueba que sean las mismas. */
  private async verificarDenominaciones(cliente: ClienteDeRestauracion): Promise<void> {
    const remotas = await cliente.leerPagina(TABLA_QUE_SOLO_SE_VERIFICA, null, FILAS_POR_PAGINA_POR_DEFECTO);
    const locales = this.base
      .prepare('SELECT id, valor, tipo, orden, activo FROM denominaciones ORDER BY id')
      .all() as { readonly id: string; readonly valor: string; readonly tipo: string; readonly orden: number; readonly activo: number }[];

    const diferencias: string[] = [];
    if (remotas.length !== DENOMINACIONES_ESPERADAS || locales.length !== DENOMINACIONES_ESPERADAS) {
      diferencias.push(`la nube tiene ${String(remotas.length)} denominaciones y esta base ${String(locales.length)}; tienen que ser ${String(DENOMINACIONES_ESPERADAS)}`);
    }
    for (const remota of remotas) {
      const convertida = convertirFila(TABLA_QUE_SOLO_SE_VERIFICA, remota);
      const local = locales.find((l) => l.id === convertida.id);
      if (local === undefined) {
        diferencias.push(`la denominación ${String(convertida.id)} (Q${String(convertida.valor)}) está en la nube y no acá`);
        continue;
      }
      if (local.valor !== convertida.valor || local.tipo !== convertida.tipo || local.orden !== convertida.orden || local.activo !== convertida.activo) {
        diferencias.push(`la denominación ${local.id} difiere: acá Q${local.valor} ${local.tipo} orden ${String(local.orden)}, en la nube Q${String(convertida.valor)} ${String(convertida.tipo)} orden ${String(convertida.orden)}`);
      }
    }
    if (diferencias.length > 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `Las denominaciones de la nube no son las de esta base, y sin eso los arqueos no se pueden restaurar: ${diferencias.join('; ')}.`,
        diferencias.join('; '),
      );
    }
  }

  // -------------------------------------------------------------------------
  // La corrida: tablas, fotos, verificación
  // -------------------------------------------------------------------------

  private async correr(cliente: ClienteDeRestauracion): Promise<void> {
    try {
      const puesto = this.exigirPuesto();
      if (!puesto.transferenciaCompleta) {
        this.fase = 'tablas';
        await this.transferirTablas(cliente);
        if (this.fueCancelada()) {
          await this.dejarCancelada(cliente);
          return;
        }
        this.fase = 'archivos';
        await this.bajarFotos(cliente);
        if (this.fueCancelada()) {
          await this.dejarCancelada(cliente);
          return;
        }
        puesto.transferenciaCompleta = true;
        this.almacenDelPuesto.guardar(puesto);
      }
      this.fase = 'verificacion';
      await this.verificar(cliente);
      this.fase = 'revision';
      this.registrar(`transferencia completa; verificación ${this.verificacion?.ok === true ? 'OK' : 'CON DIFERENCIAS'}; queda la revisión`);
    } catch (error) {
      this.fase = 'fallida';
      this.mensaje = error instanceof ErrorDeNegocio ? error.mensajeParaElUsuario : `La restauración se detuvo: ${error instanceof Error ? error.message : String(error)}`;
      this.registrar(`restauración detenida: ${this.mensaje}`);
      await cliente.cerrarSesion();
    }
  }

  /**
   * Igual que leer `this.cancelacionPedida`, pero por un método: entre dos
   * lecturas hay un `await`, y TypeScript estrecharía la segunda a «siempre
   * falsa» cuando en tiempo de ejecución no lo es (el mismo caso que
   * `fueDetenida` en la sesión de nube).
   */
  private fueCancelada(): boolean {
    return this.cancelacionPedida;
  }

  private async dejarCancelada(cliente: ClienteDeRestauracion): Promise<void> {
    this.fase = 'cancelada';
    this.mensaje = 'Restauración cancelada. Lo que ya bajó queda guardado; se puede retomar.';
    this.registrar('restauración cancelada a pedido');
    await cliente.cerrarSesion();
  }

  private exigirPuesto(): PuestoDeControl {
    if (this.puesto === null) {
      throw new ErrorDeNegocio('DATO_INVALIDO', 'No hay una restauración en curso.', 'sin puesto de control');
    }
    return this.puesto;
  }

  private async transferirTablas(cliente: ClienteDeRestauracion): Promise<void> {
    const puesto = this.exigirPuesto();
    let acumuladas = Object.values(puesto.tablas).reduce((suma, t) => suma + t.filas, 0);
    this.anotarRitmo(acumuladas);

    for (const tabla of ORDEN_DE_RESTAURACION) {
      const avance = puesto.tablas[tabla] ?? { ultimoId: null, filas: 0, lista: false };
      if (avance.lista) {
        continue;
      }
      if (!this.totalesDeLaNube.has(tabla)) {
        this.totalesDeLaNube.set(tabla, await cliente.contar(tabla));
      }
      const insertar = this.prepararInsercion(tabla);
      let ultimoId = avance.ultimoId;
      let filas = avance.filas;

      for (;;) {
        if (this.cancelacionPedida) {
          return;
        }
        const pagina = await cliente.leerPagina(tabla, ultimoId, this.filasPorPagina);
        if (pagina.length === 0) {
          break;
        }
        const resultado = this.escribirPagina(tabla, pagina, insertar);
        filas += resultado.escritas;
        acumuladas += resultado.escritas;
        const ultimaFila = pagina[pagina.length - 1];
        ultimoId = typeof ultimaFila?.id === 'string' ? ultimaFila.id : ultimoId;
        puesto.tablas[tabla] = { ultimoId, filas, lista: false };
        puesto.anomalias.push(...resultado.anomalias);
        this.almacenDelPuesto.guardar(puesto);
        this.anotarRitmo(acumuladas);
        if (pagina.length < this.filasPorPagina) {
          break;
        }
      }
      puesto.tablas[tabla] = { ultimoId, filas, lista: true };
      this.almacenDelPuesto.guardar(puesto);
      this.registrar(`${tabla}: ${String(filas)} filas restauradas`);
    }
  }

  /** Un INSERT preparado por tabla, con todas las columnas LOCALES y «no hacer nada si el id ya existe». */
  private prepararInsercion(tabla: TablaRestaurable): ((fila: FilaParaSqlite) => number) {
    if (tabla === 'configuracion_negocio') {
      const actualizar = this.base.prepare(
        `UPDATE configuracion_negocio
            SET nombre_comercial = @nombre_comercial, direccion = @direccion, telefono = @telefono,
                nit = @nit, actualizado_en = @actualizado_en
          WHERE id = @id`,
      );
      return (fila): number => actualizar.run(fila).changes;
    }
    const columnas = (this.columnasLocales(tabla) ?? []).map((c) => c.nombre);
    const sentencia = this.base.prepare(
      `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map((c) => `@${c}`).join(', ')})
       ON CONFLICT(id) DO NOTHING`,
    );
    return (fila): number => {
      for (const columna of columnas) {
        if (!(columna in fila)) {
          throw new ErrorDeNegocio(
            'DATO_INVALIDO',
            `Falta un valor para ${tabla}.${columna} al restaurar.`,
            `columna local sin valor: ${tabla}.${columna}`,
          );
        }
      }
      // Por el mismo traductor que toda escritura de repositorio: una llave
      // foránea que falla llega como REFERENCIA_INEXISTENTE y no como el texto
      // crudo de SQLite.
      return ejecutarTraduciendoErrores(() => sentencia.run(fila).changes);
    };
  }

  /**
   * Lo que se escribe distinto de como viene, por tabla (§6.3):
   *   · usuarios: SIN PIN, sin secreto de TOTP (nunca estuvo en la nube), sin intentos ni bloqueo;
   *   · ventas: ya sincronizada, porque de la nube viene;
   *   · recibos: sin imprimir, y `pdf_path` en su forma canónica RELATIVA
   *     (`recibos/<nombre>.pdf`). Una fila subida desde la migración 030 ya
   *     viene así y pasa sin cambiar; una subida ANTES trae la ruta ABSOLUTA
   *     de la terminal vieja y se convierte —COMPATIBILIDAD HACIA ATRÁS con lo
   *     que ya está en la nube, no el comportamiento esperado de una fila
   *     nueva—. El PDF no se baja (nunca se subió, §2.5.3): la reimpresión lo
   *     regenera desde las filas cuando alguien lo pida.
   */
  private sobrescriturasDe(tabla: TablaRestaurable, fila: FilaParaSqlite): FilaParaSqlite {
    switch (tabla) {
      case 'usuarios':
        return { ...fila, pin_hash: HASH_SIN_PIN, totp_secreto_cifrado: null, totp_ultimo_paso: null, intentos_fallidos: 0, bloqueado_hasta: null };
      case 'ventas':
        return { ...fila, estado_sincronizacion: 'sincronizado' };
      case 'recibos':
        return { ...fila, pdf_path: rutaRelativaDePdfDesde(String(fila.pdf_path ?? '')), impreso: 0 };
      default:
        return fila;
    }
  }

  private esAnomala(fila: FilaDeLaNube): boolean {
    const fechaDelRobo = this.puesto?.fechaDelRobo ?? null;
    if (fechaDelRobo === null || typeof fila.recibido_en !== 'string') {
      return false;
    }
    return Date.parse(fila.recibido_en) > Date.parse(fechaDelRobo);
  }

  /** Escribe una página en UNA transacción. Devuelve cuántas se escribieron y qué anomalías se vieron. */
  private escribirPagina(
    tabla: TablaRestaurable,
    pagina: readonly FilaDeLaNube[],
    insertar: (fila: FilaParaSqlite) => number,
  ): { readonly escritas: number; readonly anomalias: AnomaliaRegistrada[] } {
    const anomalias: AnomaliaRegistrada[] = [];
    const yaRegistradas = new Set((this.puesto?.anomalias ?? []).map((a) => `${a.tabla}/${a.id}`));
    let escritas = 0;
    enTransaccionDeNegocio(this.base, () => {
      for (const cruda of pagina) {
        const convertida = this.sobrescriturasDe(tabla, convertirFila(tabla, cruda));
        const id = String(convertida.id);
        const anomala = this.esAnomala(cruda);
        const excluida = anomala && TABLAS_QUE_SOLO_SE_INSERTAN.includes(tabla);
        if (anomala && !yaRegistradas.has(`${tabla}/${id}`)) {
          anomalias.push({
            tabla,
            id,
            recibidoEn: String(cruda.recibido_en),
            resumen: resumenDeFila(tabla, convertida),
            excluida,
            aceptada: false,
            total: tabla === 'ventas' ? String(convertida.total) : null,
            fecha: tabla === 'ventas' ? String(convertida.fecha) : null,
          });
        }
        if (!excluida) {
          escritas += insertar(convertida);
        }
      }
    });
    return { escritas, anomalias };
  }

  // -------------------------------------------------------------------------
  // Fotos (§6.3, paso 14)
  // -------------------------------------------------------------------------

  private async bajarFotos(cliente: ClienteDeRestauracion): Promise<void> {
    const puesto = this.exigirPuesto();
    const productos = this.base
      .prepare('SELECT id, foto_path FROM productos WHERE foto_path IS NOT NULL ORDER BY id')
      .all() as { readonly id: string; readonly foto_path: string }[];
    this.fotos = { hechas: 0, total: productos.length };
    const faltantes = new Set(puesto.fotosFaltantes);

    for (const producto of productos) {
      if (this.cancelacionPedida) {
        return;
      }
      let destino: string;
      try {
        destino = resolverRutaDeFoto(this.carpetaDeDatos, producto.foto_path);
      } catch {
        // Una ruta que se sale de la carpeta de fotos no se escribe en ningún
        // lado: se anota y el producto queda sin foto.
        faltantes.add(producto.foto_path);
        this.fotos.hechas += 1;
        continue;
      }
      if (!existsSync(destino)) {
        const bytes = await cliente.bajarFoto(nombreDeArchivoDe(producto.foto_path));
        if (bytes === null) {
          faltantes.add(producto.foto_path);
        } else {
          mkdirSync(dirname(destino), { recursive: true });
          writeFileSync(destino, bytes);
          faltantes.delete(producto.foto_path);
        }
      }
      this.fotos.hechas += 1;
      puesto.fotosFaltantes = [...faltantes];
      this.almacenDelPuesto.guardar(puesto);
    }
    this.registrar(`fotos: ${String(productos.length)} productos con foto, ${String(faltantes.size)} sin archivo en la nube`);
  }

  // -------------------------------------------------------------------------
  // Verificación (§6.4)
  // -------------------------------------------------------------------------

  private async verificar(cliente: ClienteDeRestauracion): Promise<void> {
    const puesto = this.exigirPuesto();
    const excluidasVigentes = puesto.anomalias.filter((a) => a.excluida && !a.aceptada);
    const detalle: string[] = [];

    const conteos: ConteoVerificado[] = [];
    for (const tabla of ORDEN_DE_RESTAURACION) {
      const nube = await cliente.contar(tabla);
      this.totalesDeLaNube.set(tabla, nube);
      const local = this.contarRestauradas(tabla);
      const excluidas = excluidasVigentes.filter((a) => a.tabla === tabla).length;
      const coincide = nube === local + excluidas;
      if (!coincide) {
        detalle.push(`${tabla}: la nube tiene ${String(nube)} filas y acá hay ${String(local)}${excluidas > 0 ? ` más ${String(excluidas)} excluidas` : ''}`);
      }
      conteos.push({ tabla, nube, local, excluidas, coincide });
    }

    const remotos = await cliente.ventasPorMes();
    const localesPorMes = new Map<string, string[]>();
    const filas = this.base.prepare('SELECT fecha, total FROM ventas').all() as { readonly fecha: string; readonly total: string }[];
    for (const fila of filas) {
      const mes = mesDe(fila.fecha);
      localesPorMes.set(mes, [...(localesPorMes.get(mes) ?? []), fila.total]);
    }
    const excluidasPorMes = new Map<string, string[]>();
    for (const anomalia of excluidasVigentes) {
      if (anomalia.tabla === 'ventas' && anomalia.total !== null && anomalia.fecha !== null) {
        const mes = mesDe(anomalia.fecha);
        excluidasPorMes.set(mes, [...(excluidasPorMes.get(mes) ?? []), anomalia.total]);
      }
    }
    const meses = new Set<string>([...remotos.map((r) => r.mes), ...localesPorMes.keys(), ...excluidasPorMes.keys()]);
    const ventasPorMes: MesVerificado[] = [...meses].sort().map((mes) => {
      const nube = montoACadena(remotos.find((r) => r.mes === mes)?.total ?? '0');
      const local = montoACadena(sumarLista(localesPorMes.get(mes) ?? []));
      const excluidas = montoACadena(sumarLista(excluidasPorMes.get(mes) ?? []));
      const coincide = nube === montoACadena(sumarLista([local, excluidas]));
      if (!coincide) {
        detalle.push(`ventas de ${mes}: la nube suma Q${nube} y acá Q${local}${excluidas !== '0.00' ? ` más Q${excluidas} excluidas` : ''}`);
      }
      return { mes, nube, local, excluidas, coincide };
    });

    this.verificacion = { conteos, ventasPorMes, ok: detalle.length === 0, detalle };
  }

  // -------------------------------------------------------------------------
  // La revisión (§6.5): filas excluidas, usuarios, PIN, y terminar
  // -------------------------------------------------------------------------

  private exigirEnRevision(): { readonly cliente: ClienteDeRestauracion; readonly puesto: PuestoDeControl } {
    if (this.fase !== 'revision') {
      throw new ErrorDeNegocio('DATO_INVALIDO', 'La restauración no está en la etapa de revisión.', `fase ${this.fase}`);
    }
    return { cliente: this.exigirCliente(), puesto: this.exigirPuesto() };
  }

  /**
   * Restaura igual una fila que quedó excluida por ser posterior al robo.
   *
   * Una venta se restaura CON sus líneas y su recibo, que quedaron excluidos
   * con ella; una fila hija sola exige que su padre ya esté —si no, SQLite lo
   * rechaza por la llave foránea y se explica—.
   */
  public async aceptarExcluida(tabla: string, id: string): Promise<ProgresoDeRestauracion> {
    const { cliente, puesto } = this.exigirEnRevision();
    const anomalia = puesto.anomalias.find((a) => a.tabla === tabla && a.id === id);
    if (anomalia === undefined || !anomalia.excluida || anomalia.aceptada) {
      throw new ErrorDeNegocio('REFERENCIA_INEXISTENTE', 'Esa fila no está entre las excluidas.', `${tabla}/${id}`);
    }
    const tablaRestaurable = ORDEN_DE_RESTAURACION.find((t) => t === tabla);
    if (tablaRestaurable === undefined) {
      throw new ErrorDeNegocio('DATO_INVALIDO', 'Esa tabla no se restaura.', tabla);
    }

    const fila = await cliente.leerFila(tablaRestaurable, id);
    if (fila === null) {
      throw new ErrorDeNegocio('REFERENCIA_INEXISTENTE', 'La nube ya no tiene esa fila.', `${tabla}/${id}`);
    }
    const grupo: { readonly tabla: TablaRestaurable; readonly filas: FilaDeLaNube[] }[] = [{ tabla: tablaRestaurable, filas: [fila] }];
    if (tablaRestaurable === 'ventas') {
      grupo.push({ tabla: 'venta_detalle', filas: await cliente.leerHijas('venta_detalle', 'venta_id', id) });
      grupo.push({ tabla: 'recibos', filas: await cliente.leerHijas('recibos', 'venta_id', id) });
    }

    const aceptadas: string[] = [];
    try {
      conBandejaDeSalida(this.base, () => {
        for (const parte of grupo) {
          const insertar = this.prepararInsercion(parte.tabla);
          for (const cruda of parte.filas) {
            const convertida = this.sobrescriturasDe(parte.tabla, convertirFila(parte.tabla, cruda));
            insertar(convertida);
            aceptadas.push(`${parte.tabla}/${String(convertida.id)}`);
          }
        }
        const asiento = this.auditoria.registrar({
          usuarioId: null,
          accion: ACCIONES_DE_RESTAURACION.filaRestauradaAMano,
          entidadTipo: tabla,
          entidadId: id,
          valorNuevo: { restauradoPor: puesto.correo, recibidoEn: anomalia.recibidoEn, filas: aceptadas },
          fecha: new Date(this.ahora()).toISOString(),
        });
        return {
          resultado: undefined,
          entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
        };
      });
    } catch (error) {
      if (error instanceof ErrorDeNegocio && error.codigo === 'REFERENCIA_INEXISTENTE') {
        throw new ErrorDeNegocio(
          'REFERENCIA_INEXISTENTE',
          'Esa fila depende de otra que sigue excluida: primero restaurá la venta a la que pertenece.',
          error.causaTecnica,
        );
      }
      throw error;
    }

    for (const anomaliaDelGrupo of puesto.anomalias) {
      if (aceptadas.includes(`${anomaliaDelGrupo.tabla}/${anomaliaDelGrupo.id}`)) {
        anomaliaDelGrupo.aceptada = true;
      }
    }
    this.almacenDelPuesto.guardar(puesto);
    this.registrar(`fila excluida restaurada a mano: ${aceptadas.join(', ')}`);
    await this.verificar(cliente);
    return this.progreso();
  }

  /**
   * La revisión obligatoria de un usuario con `recibido_en` posterior al robo:
   * el administrador decide qué rol y si sigue activo. Deja asiento y encola,
   * para que la nube reciba la decisión.
   */
  public revisarUsuario(id: string, decision: { readonly rol: Rol; readonly activo: boolean }): ProgresoDeRestauracion {
    const { puesto } = this.exigirEnRevision();
    const usuario = this.usuarios.obtenerPorId(id);
    if (usuario === null) {
      throw new ErrorDeNegocio('REFERENCIA_INEXISTENTE', 'No se encontró ese usuario.', id);
    }
    const dejaDeSerAdministradorActivo =
      usuario.rol === 'administrativo' && usuario.activo && (decision.rol !== 'administrativo' || !decision.activo);
    if (dejaDeSerAdministradorActivo && this.usuarios.contarAdministradoresActivos() <= 1) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        'Es el único administrador activo. Antes de quitarle el rol o darlo de baja, dejá otro administrador activo: sin ninguno, la terminal no se puede administrar.',
        'último administrador activo',
      );
    }

    conBandejaDeSalida(this.base, () => {
      this.usuarios.actualizar(id, { nombre: usuario.nombre, rol: decision.rol });
      this.usuarios.fijarActivo(id, decision.activo);
      const asiento = this.auditoria.registrar({
        usuarioId: null,
        accion: ACCIONES_DE_RESTAURACION.usuarioRevisado,
        entidadTipo: 'usuarios',
        entidadId: id,
        valorAnterior: { rol: usuario.rol, activo: usuario.activo },
        valorNuevo: { rol: decision.rol, activo: decision.activo, revisadoPor: puesto.correo },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [
          { tabla: 'usuarios' as const, id, operacion: 'actualizar' as const },
          { tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const },
        ],
      };
    });
    if (!puesto.usuariosRevisados.includes(id)) {
      puesto.usuariosRevisados.push(id);
    }
    this.almacenDelPuesto.guardar(puesto);
    return this.progreso();
  }

  /**
   * Le asigna un PIN nuevo a un usuario restaurado. Es el ÚNICO camino para que
   * un usuario restaurado pueda volver a entrar (§6.1): no hay ningún hash real
   * que recordar. Vale la misma regla de colisión que en la pantalla de usuarios.
   */
  public asignarPin(id: string, pin: string): ProgresoDeRestauracion {
    const { puesto } = this.exigirEnRevision();
    const usuario = this.usuarios.obtenerPorId(id);
    if (usuario === null) {
      throw new ErrorDeNegocio('REFERENCIA_INEXISTENTE', 'No se encontró ese usuario.', id);
    }
    if (!tieneFormatoDePinValido(pin)) {
      throw new ErrorDeNegocio('DATO_INVALIDO', 'El PIN debe tener cuatro dígitos.', `formato inválido para ${id}`);
    }
    exigirPinNoUsado(this.usuarios, pin, id);

    conBandejaDeSalida(this.base, () => {
      this.usuarios.actualizarPinHash(id, generarHashDePin(pin));
      const asiento = this.auditoria.registrar({
        usuarioId: null,
        accion: ACCIONES_DE_RESTAURACION.pinAsignado,
        entidadTipo: 'usuarios',
        entidadId: id,
        // Nunca el PIN ni su hash: solo que se asignó y quién estaba restaurando.
        valorNuevo: { asignadoPor: puesto.correo },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [
          { tabla: 'usuarios' as const, id, operacion: 'actualizar' as const },
          { tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const },
        ],
      };
    });
    return this.progreso();
  }

  /** Lo que todavía impide terminar, con nombre. Vacío significa que se puede. */
  public impedimentosParaTerminar(): string[] {
    const impedimentos: string[] = [];
    if (this.fase !== 'revision') {
      impedimentos.push('la transferencia no terminó');
      return impedimentos;
    }
    if (this.verificacion?.ok !== true) {
      impedimentos.push('la verificación de conteos y sumas no cuadra');
    }
    const usuarios = this.usuariosRestaurados();
    const sinRevisar = usuarios.filter((u) => u.anomalo && !u.revisado);
    if (sinRevisar.length > 0) {
      impedimentos.push(`falta revisar ${String(sinRevisar.length)} usuario(s) con cambios posteriores al robo: ${sinRevisar.map((u) => u.nombre).join(', ')}`);
    }
    const activosSinPin = usuarios.filter((u) => u.activo && u.sinPin);
    if (activosSinPin.length > 0) {
      impedimentos.push(`falta asignar PIN a ${String(activosSinPin.length)} usuario(s) activo(s): ${activosSinPin.map((u) => u.nombre).join(', ')}`);
    }
    if (this.usuarios.contarAdministradoresActivos() === 0) {
      impedimentos.push('no queda ningún administrador activo: reactivá uno, o la terminal no se va a poder administrar');
    }
    return impedimentos;
  }

  /** Cierra la restauración: asiento, cierre de sesión en la nube y fin del puesto de control. */
  public async terminar(): Promise<ProgresoDeRestauracion> {
    const { cliente, puesto } = this.exigirEnRevision();
    const impedimentos = this.impedimentosParaTerminar();
    if (impedimentos.length > 0) {
      throw new ErrorDeNegocio(
        'DATO_INVALIDO',
        `Todavía no se puede dar por terminada: ${impedimentos.join('; ')}.`,
        impedimentos.join('; '),
      );
    }

    const filasPorTabla = Object.fromEntries(Object.entries(puesto.tablas).map(([tabla, t]) => [tabla, t.filas]));
    conBandejaDeSalida(this.base, () => {
      const asiento = this.auditoria.registrar({
        usuarioId: null,
        accion: ACCIONES_DE_RESTAURACION.completada,
        entidadTipo: 'restauracion',
        entidadId: null,
        valorNuevo: {
          proyecto: puesto.proyecto,
          restauradoPor: puesto.correo,
          motivo: puesto.motivo,
          fechaDelRobo: puesto.fechaDelRobo,
          iniciadaEn: puesto.iniciadaEn,
          filasPorTabla,
          fotosFaltantes: puesto.fotosFaltantes,
          anomalias: puesto.anomalias.length,
          excluidas: puesto.anomalias.filter((a) => a.excluida && !a.aceptada).map((a) => `${a.tabla}/${a.id}`),
          restauradasAMano: puesto.anomalias.filter((a) => a.aceptada).map((a) => `${a.tabla}/${a.id}`),
        },
        fecha: new Date(this.ahora()).toISOString(),
      });
      return {
        resultado: undefined,
        entradas: [{ tabla: 'auditoria_log' as const, id: asiento.id, operacion: 'insertar' as const }],
      };
    });

    await cliente.cerrarSesion();
    this.almacenDelPuesto.borrar();
    this.puesto = null;
    this.fase = 'terminada';
    this.mensaje = null;
    this.registrar('restauración terminada');
    return this.progreso();
  }
}

/** `YYYY-MM` de una fecha ISO en UTC. Es una suma de control, no un reporte: los dos lados cortan el mes igual. */
function mesDe(fechaIso: string): string {
  const LARGO_DE_ANO_Y_MES = 7;
  return fechaIso.slice(0, LARGO_DE_ANO_Y_MES);
}

/** Una línea legible por fila, para la lista de anomalías. Nunca datos sensibles. */
function resumenDeFila(tabla: TablaRestaurable, fila: FilaParaSqlite): string {
  const texto = (columna: string): string => String(fila[columna] ?? '—');
  switch (tabla) {
    case 'usuarios':
      return `${texto('nombre')} · ${texto('rol')} · ${fila.activo === 1 ? 'activo' : 'de baja'}`;
    case 'categorias':
    case 'productos':
      return texto('nombre');
    case 'precios_especiales':
      return `${texto('tipo')} ${texto('valor')} para el producto ${texto('producto_id')}`;
    case 'limites_descuento':
      return `tope del rol ${texto('rol')}: ${texto('descuento_max_porcentaje')} % / Q${texto('descuento_max_monto_fijo')}`;
    case 'configuracion_negocio':
      return 'los datos del negocio';
    case 'caja_sesiones':
      return `caja ${texto('estado')}, abierta ${texto('abierta_en')}`;
    case 'caja_sesion_denominaciones':
      return `arqueo de ${texto('momento')} de la caja ${texto('caja_sesion_id')}`;
    case 'ventas':
      return `venta de Q${texto('total')} el ${texto('fecha')} (${texto('forma_pago')})`;
    case 'venta_detalle':
      return `${texto('producto_nombre_snap')} × ${texto('cantidad')} de la venta ${texto('venta_id')}`;
    case 'recibos':
      return `recibo N.º ${texto('numero_recibo')} de la venta ${texto('venta_id')}`;
    case 'auditoria_log':
      return `asiento ${texto('accion')} sobre ${texto('entidad_tipo')}`;
  }
}
