-- ===========================================================================
-- 0032_venta_detalle_costo_unitario_snap.sql — Espejo en Postgres de la 032 local
-- ===========================================================================
--
-- La FOTO del costo del producto al momento de cada venta, para que el margen
-- de un período pasado no cambie cuando se corrige el costo hoy. NULABLE a
-- propósito: `NULL` es «no se sabe cuánto costó» —ventas anteriores a este
-- cambio, o producto sin costo cargado en ese momento—, que no es cero (ver la
-- cabecera de la 032 local).
--
-- NUMERIC(14,2), igual que `precio_unitario_snap` y `productos.precio_compra`.
-- No se tocan filas existentes: quedan en NULL, que es la verdad sobre ellas.
--
-- NO SE TOCA NINGUNA FUNCIÓN: `sincronizar_venta` escribe `venta_detalle` con
-- `escribir_fila`, que lee las columnas del catálogo al ejecutar. La versión
-- de contrato NO sube.
--
-- ORDEN DE APLICACIÓN: el mismo problema que la 0031. Una terminal y una nube
-- con distinta versión detienen la cola en la primera venta —toda venta lleva
-- `venta_detalle`—, y se recupera sin perder nada al quedar iguales, porque la
-- 032 local reescribe los payloads que esperaban. Se aplica JUNTO con la 0031,
-- en el momento en que se instala la versión que trae la 031 y la 032.
--
-- Estado: escrita el 2026-09-14. NO aplicada en ningún proyecto, y NO probada
-- contra Postgres: Julio pidió no ejecutar nada contra ninguno de los dos hasta
-- revisar el SQL (§4.40).
-- ===========================================================================

ALTER TABLE public.venta_detalle
  ADD COLUMN IF NOT EXISTS costo_unitario_snap NUMERIC(14, 2)
    CONSTRAINT venta_detalle_costo_unitario_snap_no_negativo
    CHECK (costo_unitario_snap IS NULL OR costo_unitario_snap >= 0);

COMMENT ON COLUMN public.venta_detalle.costo_unitario_snap IS
  'Foto de productos.precio_compra al momento de la venta. NULL significa que no se conocía el costo (venta anterior a este cambio o producto sin costo), que NO es lo mismo que cero. Lo usa el margen del reporte de ventas por producto.';
