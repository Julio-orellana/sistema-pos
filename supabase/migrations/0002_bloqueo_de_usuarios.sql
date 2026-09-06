-- ===========================================================================
-- 0002_bloqueo_de_usuarios.sql — Espejo en Postgres del bloqueo por intentos
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/002_bloqueo_de_usuarios.sql. Se suma
-- a la migración 0001 ya aplicada, no la modifica.
--
-- Diferencias de tipo respecto del esquema local, por las mismas razones de
-- siempre: TIMESTAMPTZ nativo en vez de texto ISO validado con LIKE.
-- ===========================================================================

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS intentos_fallidos INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMPTZ;

-- Un contador de intentos por debajo de cero no significa nada.
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_intentos_fallidos_no_negativo;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_intentos_fallidos_no_negativo
    CHECK (intentos_fallidos >= 0);

-- Índice parcial: solo interesan los pocos usuarios que estén bloqueados.
CREATE INDEX IF NOT EXISTS idx_usuarios_bloqueados
  ON public.usuarios (bloqueado_hasta) WHERE bloqueado_hasta IS NOT NULL;
