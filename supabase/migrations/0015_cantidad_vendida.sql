-- ===========================================================================
-- 0015_cantidad_vendida.sql — Espejo en Postgres de la migración local 015
-- ===========================================================================
--
-- Cuánta mercadería salió por producto, acumulada. `contador_ventas` sigue
-- contando VECES (transacciones) y ordena los íconos de la caja; esta columna
-- cuenta CANTIDAD y sirve para conciliar contra el inventario.
--
-- Acá es NUMERIC(14,3) y no TEXT: Postgres tiene un decimal exacto nativo, así
-- que copiar el TEXT de SQLite sería arrastrar una solución sin el problema
-- que la justificaba, y además impediría sumar en SQL del lado del servidor.
-- Misma razón por la que `inventario_disponible` es NUMERIC acá y TEXT allá.
--
-- El piso se escribe `>= 0` porque NUMERIC compara como número. En SQLite hace
-- falta `NOT GLOB '-*'`, porque allí cualquier TEXT resulta mayor que 0.
--
-- Estado: PENDIENTE de aplicar contra `pos-jimmy-cano`.
-- ===========================================================================

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS cantidad_vendida NUMERIC(14,3) NOT NULL DEFAULT 0
    CHECK (cantidad_vendida >= 0);

COMMENT ON COLUMN public.productos.cantidad_vendida IS
  'Cantidad acumulada vendida. Sube dentro de la misma transacción que la venta, junto con contador_ventas, que cuenta veces y no cantidad.';
