-- ===========================================================================
-- 0005_pin_remoto.sql — Espejo del PIN de autorización remota
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/005_pin_remoto.sql. Es una columna de
-- `usuarios`, que es dato de negocio y ya se sincroniza entera: no hay caso
-- especial que hacer.
--
-- Guarda un hash scrypt con su sal, igual que pin_hash. NULL significa que ese
-- administrador no tiene autorización remota configurada.
-- ===========================================================================

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS pin_remoto_hash TEXT;
