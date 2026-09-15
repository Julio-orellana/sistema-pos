-- ===========================================================================
-- 0014_boleta_solo_con_tarjeta.sql — Espejo: la boleta sigue a la forma de pago
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/014_boleta_solo_con_tarjeta.sql.
-- SÍ se espeja: la venta es dato de negocio.
--
-- Una venta con tarjeta sin número de boleta pierde el dato con el que se
-- coteja el cobro contra el estado de cuenta; una venta en efectivo con boleta
-- ensucia esa misma conciliación. El número no puede ser espacios en blanco.
--
-- La coherencia del DESCUENTO ya la aplican `ventas_descuento_completo` y
-- `ventas_autorizacion_requiere_descuento`, creados en la 0001.
--
-- No existe un `0013_...`: esa migración local amplía las superficies de
-- `bloqueos_de_autorizacion`, que no se espeja nunca. El hueco es deliberado.
-- ===========================================================================

ALTER TABLE public.ventas
  DROP CONSTRAINT IF EXISTS ventas_boleta_solo_con_tarjeta;

ALTER TABLE public.ventas
  ADD CONSTRAINT ventas_boleta_solo_con_tarjeta CHECK (
    (forma_pago = 'efectivo' AND num_boleta IS NULL)
    OR (forma_pago = 'tarjeta'
        AND num_boleta IS NOT NULL
        AND length(btrim(num_boleta)) > 0)
  );
