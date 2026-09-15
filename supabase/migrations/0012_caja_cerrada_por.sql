-- ===========================================================================
-- 0012_caja_cerrada_por.sql — Espejo de quién cerró un turno ajeno
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/012_caja_cerrada_por.sql.
-- SÍ se espeja: el corte de caja es dato de negocio.
--
-- `usuario_id` dice quién abrió el turno; `cerrada_por` dice quién lo cerró, y
-- va NULL cuando fue la misma persona. Guarda a quien CERRÓ, no a quien
-- autorizó: quién autorizó queda en `auditoria_log`.
--
-- No existe un `0011_...`: esa migración local amplía las superficies de
-- `bloqueos_de_autorizacion`, que no se espeja nunca. El hueco es deliberado;
-- ver el README de esta carpeta.
-- ===========================================================================

ALTER TABLE public.caja_sesiones
  ADD COLUMN IF NOT EXISTS cerrada_por UUID
    REFERENCES public.usuarios (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_cerradas_por_otro
  ON public.caja_sesiones (cerrada_por)
  WHERE cerrada_por IS NOT NULL;
