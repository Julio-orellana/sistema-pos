-- ===========================================================================
-- 0038_anulacion_solo_presencial.sql — Espejo de la 038 local: la anulación solo se autoriza en persona.
-- ===========================================================================
--
-- La superficie `anulacion_de_venta` no acepta el código remoto
-- (`ACEPTA_PIN_REMOTO`, CLAUDE.md §4.9). Desde esta migración la tabla de la
-- nube tampoco acepta una fila que diga lo contrario. Revierte la decisión de
-- §1.1 del diseño, por decisión de Julio del 2026-09-17; el porqué está en la
-- cabecera de la 038 local.
--
-- EXIGE LA 0033: sin la tabla, falla. Se aplica EN LA MISMA RONDA que la 0033 y
-- la 0035, después de ellas, por decisión de Julio: ninguna versión publicada
-- escribe 'remoto' (en la 1.0.0 la anulación no existe; en la 1.1.0 la
-- superficie vale `false`), así que una nube estrecha no le rechaza nada a
-- ninguna terminal instalada.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ NO SE QUITA EL CHECK DE LA COLUMNA, AUNQUE EN POSTGRES SE PODRÍA
-- ---------------------------------------------------------------------------
-- Se llama `anulaciones_de_venta_autorizada_via_check` (medido en el ensayo
-- local de la 0033). Quitarlo sería posible acá y no en SQLite, donde no tiene
-- nombre. Se deja, y con eso el espejo queda EXACTO: los dos lados tienen el
-- CHECK amplio de la columna más este con nombre, y volver a ampliar algún día
-- es la MISMA sentencia en los dos (`DROP CONSTRAINT
-- anulaciones_de_venta_solo_presencial`). Con uno solo de este lado, ampliar
-- exigiría además volver a poner el amplio, y los dos lados divergirían.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO CAMBIA
-- ---------------------------------------------------------------------------
--   · `contrato_de_sincronizacion()` declara columnas y funciones, no
--     restricciones: ni el contrato ni `esquema-nube.json` cambian, y la versión
--     de contrato no sube.
--   · `sincronizar_anulacion_de_venta` (0035) no se toca. Una fila con 'remoto'
--     la rechaza la base con 23514 al escribirla, y el lote entero se revierte.
--
-- Se agrega VALIDADA, sin `NOT VALID`, como la 0028: la tabla nace vacía en la
-- 0033, y una restricción `NOT VALID` se leería para siempre como «esta regla no
-- se comprobó contra lo que ya había». No puede dar NULL: `autorizada_via` es
-- NOT NULL.
-- ===========================================================================

ALTER TABLE public.anulaciones_de_venta
  ADD CONSTRAINT anulaciones_de_venta_solo_presencial CHECK (autorizada_via = 'presencial');

COMMENT ON CONSTRAINT anulaciones_de_venta_solo_presencial ON public.anulaciones_de_venta IS
  'Una anulación de venta solo se autoriza en persona: la superficie anulacion_de_venta no acepta el código remoto (ACEPTA_PIN_REMOTO, CLAUDE.md §4.9). Convive con el CHECK amplio de la columna para que el espejo con la 038 local sea exacto. Ampliarlo exige una migración que quite esta restricción en los dos lados.';
