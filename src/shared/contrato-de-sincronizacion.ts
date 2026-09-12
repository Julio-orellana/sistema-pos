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

/** Las cinco funciones de escritura. Todas `SECURITY DEFINER`, todas solo para el rol `terminal`. */
export const FUNCIONES_DE_ESCRITURA = [
  'sincronizar_usuario',
  'sincronizar_apertura_de_caja',
  'sincronizar_cierre_de_caja',
  'sincronizar_venta',
  'sincronizar_lote_simple',
] as const;

export type FuncionDeEscritura = (typeof FUNCIONES_DE_ESCRITURA)[number];

/** La función de lectura del contrato. `SECURITY INVOKER`, solo para el rol `restauracion`. */
export const FUNCION_DEL_CONTRATO = 'contrato_de_sincronizacion';

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
 * La LISTA CERRADA de tablas que cada función admite, copiada de los `CASE`
 * de la migración. Una tabla fuera de la lista de su función se rechaza allá
 * por nombre; acá, la prueba de deriva exige que las doce tablas
 * sincronizables aparezcan en al menos una lista, para que ninguna quede sin
 * puerta cuando se agregue una.
 *
 * `auditoria_log` está en las cinco porque toda operación de negocio deja su
 * asiento, y en las cinco se escribe con `DO NOTHING`: su trigger de
 * inmutabilidad abortaría cualquier `DO UPDATE`.
 */
export const TABLAS_ADMITIDAS_POR_FUNCION: Readonly<Record<FuncionDeEscritura, readonly string[]>> = {
  sincronizar_usuario: ['usuarios', 'auditoria_log'],
  sincronizar_apertura_de_caja: ['caja_sesiones', 'caja_sesion_denominaciones', 'auditoria_log'],
  sincronizar_cierre_de_caja: ['caja_sesiones', 'caja_sesion_denominaciones', 'auditoria_log'],
  sincronizar_venta: ['productos', 'ventas', 'venta_detalle', 'auditoria_log'],
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
