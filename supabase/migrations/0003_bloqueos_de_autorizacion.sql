-- ===========================================================================
-- 0003_bloqueos_de_autorizacion.sql — Espejo del candado por superficie
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/003_bloqueos_de_autorizacion.sql.
--
-- Separa el candado del diálogo de autorización del candado del ingreso: antes
-- compartían `usuarios.intentos_fallidos`, y tres errores en el diálogo de
-- salida dejaban a todos los administradores sin poder iniciar sesión.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.bloqueos_de_autorizacion (
  superficie        TEXT        PRIMARY KEY
                      CHECK (superficie IN ('salida_controlada')),
  intentos_fallidos INTEGER     NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  bloqueado_hasta   TIMESTAMPTZ,
  actualizado_en    TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.bloqueos_de_autorizacion ENABLE ROW LEVEL SECURITY;
