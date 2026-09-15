-- ===========================================================================
-- 033_anulaciones_de_venta.sql — La anulación de una venta es un hecho aparte
-- ===========================================================================
--
-- Diseño aprobado: `docs/ANULACION-DE-VENTA.md`, sección 1.
--
-- UNA FILA POR VENTA ANULADA. La fila de `ventas` NO se toca nunca: ni
-- `estado`, ni `actualizado_en`, ni ningún monto. `venta_detalle` y `recibos`
-- tampoco. La regla es una sola y vale en la terminal, en la nube y en una base
-- restaurada:
--
--     UNA VENTA ESTÁ ANULADA SI Y SOLO SI EXISTE SU FILA EN ESTA TABLA.
--
-- En términos contables es un asiento de reversión: el hecho original queda
-- escrito tal como ocurrió, y la reversión es otro hecho, con su fecha, su
-- motivo y sus responsables.
--
-- POR QUÉ NO `ventas.estado = 'anulada'` (sección 1.2 del diseño): en la nube
-- `ventas` solo se inserta, así que ese valor no llegaría nunca y la misma
-- columna de la misma fila diría dos cosas en dos copias. Por eso
-- `ventas.estado` queda en 'completada' en toda venta, también en las anuladas,
-- y ninguna consulta decide por esa columna.
--
-- NO COPIA el total, la forma de pago, quién vendió ni la caja: todo eso está en
-- `ventas`, que no cambia. Una copia sería un segundo lugar que puede discrepar.
--
-- `autorizada_via` admite 'remoto' aunque la superficie `anulacion_de_venta` NO
-- acepta el PIN remoto: qué superficie lo acepta vive en una sola tabla,
-- `ACEPTA_PIN_REMOTO` de `autenticacion.ts` (CLAUDE.md §4.9). Repetir esa
-- política en un CHECK sería el segundo lugar que el proyecto ya eliminó.
--
-- EL ESPEJO EN POSTGRES ES LA `0033`, que todavía NO EXISTE: la sincronización
-- de la anulación es un prompt aparte (sección 7 del diseño).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS anulaciones_de_venta (
  id              TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  -- UNIQUE: una venta se anula una sola vez.
  venta_id        TEXT NOT NULL UNIQUE REFERENCES ventas (id) ON DELETE RESTRICT,
  -- Quién tenía la sesión cuando se pidió la anulación.
  solicitada_por  TEXT NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  -- El administrador cuyo PIN coincidió. Puede ser la misma persona.
  autorizada_por  TEXT NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  autorizada_via  TEXT NOT NULL CHECK (autorizada_via IN ('presencial', 'remoto')),
  -- Obligatorio y hasta 200 caracteres: el tope del motivo del ajuste de
  -- inventario. Una anulación sin motivo no se puede revisar.
  motivo          TEXT NOT NULL CHECK (length(trim(motivo)) > 0 AND length(motivo) <= 200),
  fecha           TEXT NOT NULL CHECK (fecha LIKE '____-__-__T__:__:__%Z')
);

-- UNA ANULACIÓN NO SE EDITA NI SE BORRA. Es la evidencia de un control contra
-- el fraude, y una anulación que se puede cambiar no sirve como evidencia. Es
-- el mismo mecanismo que `auditoria_log`. El texto dice «anulación de venta» a
-- propósito y no «inmutable»: `errores.ts` traduce por el texto, y esa palabra
-- lo haría pasar por un error de la bitácora.
CREATE TRIGGER IF NOT EXISTS anulaciones_de_venta_prohibir_update
BEFORE UPDATE ON anulaciones_de_venta
BEGIN
  SELECT RAISE(ABORT, 'Una anulación de venta no se puede modificar.');
END;

CREATE TRIGGER IF NOT EXISTS anulaciones_de_venta_prohibir_delete
BEFORE DELETE ON anulaciones_de_venta
BEGIN
  SELECT RAISE(ABORT, 'Una anulación de venta no se puede borrar.');
END;
