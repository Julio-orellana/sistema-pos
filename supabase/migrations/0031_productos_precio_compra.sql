-- ===========================================================================
-- 0031_productos_precio_compra.sql — Espejo en Postgres de la migración local 031
-- ===========================================================================
--
-- El costo de un producto, para calcular el margen del reporte de ventas por
-- producto. NULABLE a propósito: `NULL` es «no sabemos cuánto cuesta», que no
-- es lo mismo que cero (ver la cabecera de la 031 local).
--
-- NUMERIC(14,2), igual que `precio_base`: Postgres tiene decimal exacto nativo
-- y copiar el TEXT de SQLite sería arrastrar una solución sin su problema.
--
-- NO SE TOCA NINGUNA FUNCIÓN. `escribir_fila` y `exigir_claves_conocidas` leen
-- las columnas del catálogo al ejecutar (§4.20), así que la columna nueva entra
-- sola en el contrato. La versión de contrato NO sube.
--
-- ORDEN DE APLICACIÓN, Y POR QUÉ IMPORTA. Las funciones de la nube exigen que
-- el payload traiga EXACTAMENTE las columnas de la tabla, así que:
--
--   · Una terminal SIN la 031 contra una nube CON la 0031 → sus lotes de
--     productos (y toda venta, que los lleva) se rechazan por «falta
--     precio_compra» y la cola se detiene, visible.
--   · Una terminal CON la 031 contra una nube SIN la 0031 → lo mismo, por
--     «columna de más».
--
-- Las dos situaciones se recuperan sin perder nada: al quedar las dos partes
-- iguales, «Reintentar ahora» sube los lotes, porque la 031 local también
-- reescribe los payloads que esperaban en la cola. Pero mientras dure el
-- desfase la cola está detenida, así que se aplica EN EL MOMENTO en que se
-- instala la versión que trae la 031, no antes ni después.
--
-- Estado: escrita el 2026-09-14. NO aplicada en ningún proyecto: el proyecto de
-- pruebas lo está usando la instalación de Jimmy, que no trae la 031 (§4.39).
-- ===========================================================================

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS precio_compra NUMERIC(14, 2)
    CONSTRAINT productos_precio_compra_no_negativo
    CHECK (precio_compra IS NULL OR precio_compra >= 0);

COMMENT ON COLUMN public.productos.precio_compra IS
  'Costo del producto para la tienda. NULL significa que no se cargó, que NO es lo mismo que cero. Lo usa el margen del reporte de ventas por producto.';
