/**
 * El contrato entre la terminal y las funciones de sincronización de la nube,
 * visto desde este lado.
 *
 * Las funciones viven en Postgres (`supabase/migrations/0023_funciones_de_sincronizacion.sql`)
 * y son las ÚNICAS puertas por las que la terminal escribe en la nube: no hay
 * política de RLS que le permita tocar una tabla directamente (CLAUDE.md
 * §4.20). Lo que está acá es lo que este lado necesita saber de ellas, y lo que
 * la prueba de deriva (`deriva-de-esquema.test.ts`) coteja contra la foto
 * `supabase/esquema-nube.json`.
 *
 * ===========================================================================
 * LA VERSIÓN DEL CONTRATO SE SUBE A MANO, EN LOS DOS LADOS A LA VEZ
 * ===========================================================================
 *
 * Cada llamada lleva `version_de_contrato`. Si no coincide con la que declara
 * `public.version_del_contrato_de_sincronizacion()`, la función falla diciendo
 * los dos números y la cola se detiene (§3.2: es un error determinístico). Es
 * la red contra la deriva que ninguna prueba ve: una terminal vieja hablando
 * con una nube nueva, o al revés.
 *
 * Cuándo se sube: cuando cambie la FORMA de lo que una función espera —una
 * tabla nueva en un lote, una columna que deja de viajar, un orden distinto—.
 * No se sube por agregar una columna que viaja igual en los dos lados: de eso
 * se encarga la prueba de deriva.
 */

/** La versión que esta terminal manda. Tiene que ser la que la nube declara. */
export const VERSION_DEL_CONTRATO_DE_SINCRONIZACION = 1;

/** La columna que pone el servidor en cada fila que recibe (§1.5.1). Nunca viaja. */
export const COLUMNA_DEL_SERVIDOR = 'recibido_en';

/** Las funciones de escritura. Todas `SECURITY DEFINER`, todas solo para el rol `terminal`. */
export const FUNCIONES_DE_ESCRITURA = [
  'sincronizar_usuario',
  'sincronizar_apertura_de_caja',
  'sincronizar_cierre_de_caja',
  'sincronizar_venta',
  'sincronizar_lote_simple',
  /**
   * La sexta, agregada por la `0027`: un lote de asientos SUELTOS.
   *
   * Las cinco de la `0023` exigen una fila principal de negocio, y hay hechos
   * que no la tienen —un ingreso fallido, un candado, una salida controlada—.
   * Sin esta puerta, esos lotes detenían la cola entera. Ver CLAUDE.md §4.29.
   */
  'sincronizar_asiento',
  /**
   * La séptima, agregada por la `0035`: la anulación de una venta
   * (docs/ANULACION-DE-VENTA.md §7). Su lote trae la fila de
   * `anulaciones_de_venta`, los productos que repone y su asiento, y NUNCA la
   * fila de `ventas`: en la nube `ventas` solo se inserta.
   */
  'sincronizar_anulacion_de_venta',
] as const;

export type FuncionDeEscritura = (typeof FUNCIONES_DE_ESCRITURA)[number];

/** La función de lectura del contrato. `SECURITY INVOKER`, solo para el rol `restauracion`. */
export const FUNCION_DEL_CONTRATO = 'contrato_de_sincronizacion';

/**
 * Las funciones que usa la RESTAURACIÓN (fase 4.b) además del contrato. Todas
 * `SECURITY INVOKER` —leen bajo las políticas de la 0025, no por encima de
 * ellas— y solo para el rol `restauracion`.
 *
 * `restauracion_ventas_por_mes` (migración 0029) suma `ventas.total` por mes
 * EN POSTGRES, donde `NUMERIC` es exacto, para que la terminal pueda comparar
 * al centavo contra su propia suma con Decimal (§6.4 del diseño).
 */
export const FUNCIONES_DE_RESTAURACION = ['restauracion_ventas_por_mes'] as const;

/**
 * Los ayudantes internos de la migración 0023. Nadie los llama desde afuera:
 * ni `anon`, ni `authenticated`. Están acá para que la prueba de deriva exija
 * que sigan existiendo con `search_path` vacío y sin ser DEFINER.
 */
export const AYUDANTES_INTERNOS = [
  'escribir_fila',
  'exigir_claves_conocidas',
  'exigir_forma_del_cambio',
  'huella_de_fila',
] as const;

/**
 * Las funciones de TRIGGER de la nube: la que pone `recibido_en` con el reloj
 * del servidor (0019) y las que hacen inmutables la bitácora (0022) y las
 * anulaciones (0033). Nadie las llama: las dispara Postgres.
 *
 * Están acá, y no solo en la lista del contrato de la nube, por la lección de
 * la 0027 (CLAUDE.md §4.29): una función que la nube tiene y que esta terminal
 * no nombra en ninguna lista es una función que la prueba de deriva no vigila.
 */
export const FUNCIONES_DE_DISPARADOR = [
  'fijar_recibido_en',
  'auditoria_log_es_inmutable',
  'anulaciones_de_venta_es_inmutable',
] as const;

/** La función que declara la versión del contrato (0023). La llaman las de escritura. */
export const FUNCION_DE_LA_VERSION_DEL_CONTRATO = 'version_del_contrato_de_sincronizacion';

/**
 * TODAS las funciones que la nube tiene que declarar en su contrato, ni una más
 * ni una menos. La prueba de deriva exige que la foto tenga exactamente estas:
 * si alguien crea una función y se olvida de agregarla a la lista fija de
 * `contrato_de_sincronizacion()`, la foto que se tome ya no la trae, y esta
 * lista sí.
 */
export const FUNCIONES_DEL_CONTRATO: readonly string[] = [
  ...FUNCIONES_DE_ESCRITURA,
  FUNCION_DEL_CONTRATO,
  ...FUNCIONES_DE_RESTAURACION,
  ...AYUDANTES_INTERNOS,
  ...FUNCIONES_DE_DISPARADOR,
  FUNCION_DE_LA_VERSION_DEL_CONTRATO,
];

/**
 * La LISTA CERRADA de tablas que cada función admite, copiada de los `CASE`
 * de las migraciones. Una tabla fuera de la lista de su función se rechaza allá
 * por nombre; acá, la prueba de deriva exige que las trece tablas
 * sincronizables aparezcan en al menos una lista, para que ninguna quede sin
 * puerta cuando se agregue una.
 *
 * `auditoria_log` está en todas porque toda operación de negocio deja su
 * asiento, y en todas se escribe con `DO NOTHING`: su trigger de
 * inmutabilidad abortaría cualquier `DO UPDATE`.
 */
export const TABLAS_ADMITIDAS_POR_FUNCION: Readonly<Record<FuncionDeEscritura, readonly string[]>> = {
  sincronizar_usuario: ['usuarios', 'auditoria_log'],
  sincronizar_apertura_de_caja: ['caja_sesiones', 'caja_sesion_denominaciones', 'auditoria_log'],
  sincronizar_cierre_de_caja: ['caja_sesiones', 'caja_sesion_denominaciones', 'auditoria_log'],
  sincronizar_venta: ['productos', 'ventas', 'venta_detalle', 'auditoria_log'],
  sincronizar_asiento: ['auditoria_log'],
  sincronizar_anulacion_de_venta: ['anulaciones_de_venta', 'productos', 'auditoria_log'],
  sincronizar_lote_simple: [
    'categorias',
    'productos',
    'precios_especiales',
    'limites_descuento',
    'configuracion_negocio',
    'recibos',
    'auditoria_log',
  ],
};
