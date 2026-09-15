-- ===========================================================================
-- 0007_autorizacion_de_diferencia.sql — Espejo de quién autorizó un descuadre
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/007_autorizacion_de_diferencia.sql.
-- SÍ se espeja: es parte del corte de caja.
--
-- No existe un `0006_...`: esa migración local amplía las superficies de
-- `bloqueos_de_autorizacion`, que no se espeja nunca. El hueco es deliberado;
-- ver el README de esta carpeta.
-- ===========================================================================

ALTER TABLE public.caja_sesiones
  ADD COLUMN IF NOT EXISTS diferencia_autorizada_por UUID
    REFERENCES public.usuarios (id) ON DELETE SET NULL;

ALTER TABLE public.caja_sesiones
  ADD COLUMN IF NOT EXISTS diferencia_autorizada_via TEXT;

-- Van siempre juntas: una autorización sin vía, o una vía sin autorizante, es
-- un registro incompleto.
ALTER TABLE public.caja_sesiones
  DROP CONSTRAINT IF EXISTS caja_sesiones_autorizacion_coherente;
ALTER TABLE public.caja_sesiones
  ADD CONSTRAINT caja_sesiones_autorizacion_coherente CHECK (
    (diferencia_autorizada_via IS NULL AND diferencia_autorizada_por IS NULL)
    OR (diferencia_autorizada_via IN ('presencial', 'remoto')
        AND diferencia_autorizada_por IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_autorizadas
  ON public.caja_sesiones (diferencia_autorizada_por)
  WHERE diferencia_autorizada_por IS NOT NULL;
