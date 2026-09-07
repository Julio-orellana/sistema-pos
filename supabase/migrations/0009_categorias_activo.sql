-- ===========================================================================
-- 0009_categorias_activo.sql — Espejo de la baja lógica de categorías
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/009_categorias_activo.sql.
-- SÍ se espeja: el catálogo es dato de negocio.
--
-- Desactivar una categoría solo la retira de las opciones al crear o editar un
-- producto. Los productos que ya la referencian no se tocan.
--
-- Aquí el tipo es BOOLEAN nativo; del lado local es INTEGER 0/1 con CHECK,
-- que es la convención que ya usan `productos.activo` y `usuarios.activo` en
-- SQLite. Es la misma regla escrita en el tipo que corresponde a cada motor.
-- ===========================================================================

ALTER TABLE public.categorias
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_categorias_activas
  ON public.categorias (activo, orden);
