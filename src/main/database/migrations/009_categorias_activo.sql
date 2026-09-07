-- ===========================================================================
-- 009_categorias_activo.sql — Baja lógica de categorías
-- ===========================================================================
--
-- `categorias` nunca recibió un campo `activo`, a diferencia de `productos`.
-- Sin él no había forma de retirar una categoría de la lista de opciones sin
-- borrarla, y borrarla es imposible en cuanto tenga un producto asociado:
-- `productos.categoria_id` la referencia con ON DELETE RESTRICT.
--
-- QUÉ SIGNIFICA DESACTIVAR UNA CATEGORÍA, para que ninguna sesión futura lo
-- amplíe por su cuenta: deja de ofrecerse como opción al crear o editar un
-- producto, y nada más. Los productos que ya la referencian NO se tocan: ni se
-- desactivan, ni cambian de categoría, ni desaparecen de la pantalla de venta.
-- Desactivar una categoría es una decisión de catálogo, no una baja de
-- inventario, y confundir las dos cosas retiraría mercadería de la venta sin
-- que nadie lo haya pedido.
--
-- Se espeja en Postgres (`0009_...`): el catálogo es dato de negocio.
--
-- SOBRE EL TIPO: en SQLite el booleano se escribe INTEGER 0/1 con un CHECK,
-- que es exactamente la convención que ya usan `productos.activo` y
-- `usuarios.activo`. El espejo de Postgres sí usa BOOLEAN nativo. La conversión
-- en ambos sentidos la hace decimal-columns.ts y nadie más.
-- ===========================================================================

ALTER TABLE categorias
  ADD COLUMN activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1));

-- El selector de categorías al crear un producto pide siempre las activas en
-- su orden de presentación; sin índice, cada apertura del formulario recorre
-- la tabla entera.
CREATE INDEX IF NOT EXISTS idx_categorias_activas
  ON categorias (activo, orden);
