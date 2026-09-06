-- ===========================================================================
-- 0008_autorizacion_solo_con_diferencia.sql — Espejo: el permiso sigue al descuadre
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/008_autorizacion_solo_con_diferencia.sql.
-- SÍ se espeja: es parte del corte de caja, que es dato de negocio y lo primero
-- que un auditor va a querer revisar.
--
-- La 0007 amarró las dos columnas de autorización entre sí. Esta las amarra al
-- valor de `diferencia`: un cierre que cuadra no puede llevar autorizante, y un
-- cierre descuadrado no puede no llevarlo.
--
-- Diferencia con el lado local, a propósito: aquí `diferencia` es NUMERIC, no
-- TEXT, así que se compara contra el número 0 y no contra la cadena '0.00'.
-- Es la misma regla escrita en el tipo que corresponde a cada motor. En
-- Postgres además no hace falta ningún rodeo: ADD CONSTRAINT sobre una tabla
-- existente es gramática documentada y estable.
-- ===========================================================================

ALTER TABLE public.caja_sesiones
  DROP CONSTRAINT IF EXISTS caja_sesiones_autorizacion_solo_con_diferencia;

ALTER TABLE public.caja_sesiones
  ADD CONSTRAINT caja_sesiones_autorizacion_solo_con_diferencia CHECK (
    -- Turno abierto (diferencia todavía nula) o turno que cuadra: sin permiso.
    (
      (diferencia IS NULL OR diferencia = 0)
      AND diferencia_autorizada_por IS NULL
      AND diferencia_autorizada_via IS NULL
    )
    OR
    -- Turno descuadrado: quién autorizó y por cuál vía, ambos obligatorios.
    (
      diferencia IS NOT NULL
      AND diferencia <> 0
      AND diferencia_autorizada_por IS NOT NULL
      AND diferencia_autorizada_via IS NOT NULL
    )
  );
