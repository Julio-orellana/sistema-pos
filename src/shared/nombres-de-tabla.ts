/**
 * El nombre LEGIBLE de cada tabla: lo que una persona lee en la pantalla
 * cuando el sistema tiene que nombrar de dónde salen unos datos.
 *
 * Vive en `src/shared` y no en `src/main` porque quien lo muestra es el
 * renderer, que no puede importar nada del proceso principal.
 *
 * ===========================================================================
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ===========================================================================
 *
 * Hasta el 2026-09-17 la misma verdad estaba escrita a mano en DOS pantallas
 * —`PantallaDeSincronizacion.tsx` y `PantallaDeRestauracion.tsx`— cada una con
 * su propio `NOMBRES_DE_TABLA`, en distinto orden, y sin que nada las atara.
 *
 * Se desincronizaron en cuanto llegó una tabla nueva: al crearse
 * `anulaciones_de_venta` (CLAUDE.md §4.45) solo se agregó a una, y la pantalla
 * de sincronización mostró el nombre TÉCNICO de una anulación pendiente
 * —`anulaciones_de_venta`— a quien tenía que decidir si reintentar o saltar un
 * lote detenido. Se corrigió a mano en los dos mapas (§4.53) y nada impedía
 * que volviera a pasar con la próxima tabla: agregar una tabla y olvidarse de
 * una de las dos copias **no hacía fallar nada**.
 *
 * Ahora la copia es una sola, y dos redes la sostienen
 * (`src/main/__tests__/nombres-de-tabla-una-sola-fuente.test.ts`):
 *
 *   · una prueba estructural recorre el árbol sintáctico del renderer y del
 *     proceso principal, y falla nombrando archivo y línea si alguien vuelve a
 *     declarar su propio mapa;
 *   · otra exige que este mapa cubra EXACTAMENTE las trece tablas que la
 *     aplicación sincroniza y restaura, así que una tabla nueva sin su nombre
 *     legible hace fallar `npm test`.
 *
 * ===========================================================================
 * EL «NOMBRE LEGIBLE» NO ES UNA TRADUCCIÓN LIBRE
 * ===========================================================================
 *
 * Es el término con el que la tienda llama a esos datos, no el nombre de la
 * tabla con espacios. `venta_detalle` son «líneas de venta», y
 * `caja_sesion_denominaciones` son «arqueos de caja»: quien lee la pantalla no
 * sabe —ni tiene por qué saber— cómo se llaman las tablas por dentro.
 */

/**
 * Las trece tablas que la terminal sincroniza y restaura, más la entrada de
 * archivo que la cola usa para las fotos.
 *
 * El orden es el de `ORDEN_DE_RESTAURACION` (el del grafo de llaves foráneas),
 * para que las dos listas se puedan leer una al lado de la otra.
 *
 * **`denominaciones` NO está, y no es un olvido.** Las once del quetzal viven
 * en la nube desde la migración `0004` y la terminal nunca las encola ni las
 * restaura (`bandeja-de-salida.ts`), así que ninguna pantalla puede llegar a
 * nombrarla.
 */
export const NOMBRES_DE_TABLA = {
  usuarios: 'usuarios',
  categorias: 'categorías',
  configuracion_negocio: 'datos del negocio',
  productos: 'productos',
  precios_especiales: 'precios especiales',
  limites_descuento: 'topes de descuento',
  caja_sesiones: 'turnos de caja',
  caja_sesion_denominaciones: 'arqueos de caja',
  ventas: 'ventas',
  venta_detalle: 'líneas de venta',
  recibos: 'recibos',
  anulaciones_de_venta: 'anulaciones de venta',
  auditoria_log: 'asientos de auditoría',
  /*
    No es una tabla: es el `entidad_tipo` con el que la bandeja de salida
    encola la FOTO de un producto (`TIPO_DE_ENTRADA_DE_FOTO`, §4.33). Aparece
    en la pantalla de sincronización junto a las tablas, como un pendiente más,
    así que necesita su nombre legible igual que ellas.
  */
  archivo_foto: 'fotos de producto',
} as const satisfies Readonly<Record<string, string>>;

/** Las claves que este mapa nombra: las trece tablas más `archivo_foto`. */
export type ClaveConNombreLegible = keyof typeof NOMBRES_DE_TABLA;

/** El mismo mapa, visto como un diccionario abierto: es lo que consulta la búsqueda. */
const NOMBRES: Readonly<Record<string, string>> = NOMBRES_DE_TABLA;

/**
 * El nombre legible de una tabla o de un tipo de entrada de la cola.
 *
 * **Una clave desconocida se devuelve TAL CUAL, sin fallar.** Lo que llega acá
 * son datos que la base ya escribió, y una pantalla que reventara —o que
 * mostrara un hueco— porque falta una etiqueta sería peor que una que muestra
 * el nombre técnico: el nombre técnico se entiende con esfuerzo, el hueco no se
 * entiende nunca. Que falte una etiqueta lo atrapa `npm test`, en desarrollo,
 * mucho antes de llegar al mostrador.
 */
export function nombreLegibleDeTabla(clave: string): string {
  return NOMBRES[clave] ?? clave;
}
