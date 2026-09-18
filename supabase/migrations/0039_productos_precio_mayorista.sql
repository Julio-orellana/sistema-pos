-- ===========================================================================
-- 0039_productos_precio_mayorista.sql — Espejo en Postgres de la migración local 039
-- ===========================================================================
--
-- El precio mayorista por cantidad mínima (spec 002,
-- `spec/features/002-precio-mayorista/`). Dos columnas NULABLES en `productos`:
-- `NULL` en las dos es «sin precio mayorista», que es como quedan todos los
-- productos que ya existen.
--
-- TIPOS: NUMERIC(14,2) como `precio_base` y NUMERIC(14,3) como
-- `cantidad_predefinida_icono`. Postgres tiene decimal exacto nativo, así que
-- las reglas se escriben como comparaciones numéricas y no con la forma
-- canónica de texto que exige SQLite.
--
-- LAS DOS REGLAS DE TABLA LLEVAN EL MISMO NOMBRE QUE EN LA 039 LOCAL, como la
-- 038/0038: `productos_mayorista_completo` (el precio y la cantidad van
-- juntos) y `productos_mayorista_menor_que_lista` (el precio mayorista es
-- ESTRICTAMENTE menor que el de lista). Las dos de columna se llaman distinto
-- que en la local, como en la 031/0031: acá no hay forma canónica que exigir.
--
-- `productos_mayorista_menor_que_lista` SE EVALÚA EN CADA ESCRITURA DE LA FILA,
-- también cuando cambia el precio de lista. Es la decisión 1 de la spec (§4.3):
-- se decide antes de aplicar este archivo en cualquier nube.
--
-- NO SE TOCA NINGUNA FUNCIÓN. `escribir_fila` y `exigir_claves_conocidas` leen
-- las columnas del catálogo al ejecutar (CLAUDE.md §4.20), así que las dos
-- columnas entran solas en el contrato. La versión de contrato NO sube.
--
-- ORDEN DE APLICACIÓN, Y POR QUÉ IMPORTA. Las funciones de la nube exigen que
-- el payload traiga EXACTAMENTE las columnas de la tabla:
--
--   · Una terminal SIN la 039 contra una nube CON esta migración → sus lotes de
--     productos (y toda venta, que los lleva) se rechazan por «faltan
--     columnas» y la cola se detiene, visible.
--   · Una terminal CON la 039 contra una nube SIN esta migración → lo mismo,
--     por «columnas de más».
--
-- Se aplica en el mismo momento en que se instala la versión que trae la 039.
-- Es la misma situación que se midió con la 0031 (§4.39).
--
-- Estado: escrita el 2026-09-18. NO APLICADA EN NINGÚN PROYECTO. Se aplica en
-- `pos-pruebas-descartable` solo con la aprobación explícita de Julio, y en
-- `pos-jimmy-cano` nunca sin un pedido aparte.
-- ===========================================================================

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS precio_mayorista NUMERIC(14, 2)
    CONSTRAINT productos_precio_mayorista_no_negativo
    CHECK (precio_mayorista IS NULL OR precio_mayorista >= 0);

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS cantidad_minima_mayorista NUMERIC(14, 3)
    CONSTRAINT productos_cantidad_minima_mayorista_positiva
    CHECK (cantidad_minima_mayorista IS NULL OR cantidad_minima_mayorista > 0);

ALTER TABLE public.productos
  ADD CONSTRAINT productos_mayorista_completo
  CHECK ((precio_mayorista IS NULL AND cantidad_minima_mayorista IS NULL)
      OR (precio_mayorista IS NOT NULL AND cantidad_minima_mayorista IS NOT NULL));

ALTER TABLE public.productos
  ADD CONSTRAINT productos_mayorista_menor_que_lista
  CHECK (precio_mayorista IS NULL OR precio_mayorista < precio_base);

COMMENT ON COLUMN public.productos.precio_mayorista IS
  'Precio mayorista por unidad de medida del producto. Se cobra cuando la cantidad de la línea llega a cantidad_minima_mayorista, si es el menor de los precios que aplican (lista, especial vigente, mayorista). NULL, junto con cantidad_minima_mayorista, es «sin precio mayorista».';

COMMENT ON COLUMN public.productos.cantidad_minima_mayorista IS
  'Desde qué cantidad de la línea aplica el precio mayorista, inclusive, en la unidad del producto (lb, kg o unidades). NULL junto con precio_mayorista.';
