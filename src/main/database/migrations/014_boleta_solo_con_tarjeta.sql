-- ===========================================================================
-- 014_boleta_solo_con_tarjeta.sql — El número de boleta sigue a la forma de pago
-- ===========================================================================
--
-- SOBRE LA COHERENCIA DEL DESCUENTO, QUE ES LO QUE SE VENÍA A AGREGAR: ya está.
-- La migración 001 creó `ventas` con dos CHECK que juntos la garantizan, y se
-- midió que la base los aplica hoy:
--
--   · `descuento_tipo` y `descuento_valor` van los dos o ninguno;
--   · `descuento_autorizado_por` exige `descuento_tipo`, y por el anterior eso
--     implica también `descuento_valor`.
--
-- Agregar otro CHECK con la misma regla no habría hecho nada salvo ensuciar el
-- esquema. Lo que SÍ faltaba es esto.
--
-- LA REGLA QUE FALTABA. `num_boleta` existe desde la 001 pero nada lo ataba a
-- `forma_pago`, así que la base aceptaba dos registros incoherentes:
--
--   · una venta con TARJETA y sin número de boleta —el dato de control que se
--     captura justamente para poder cotejar el cobro con el estado de cuenta—;
--   · una venta en EFECTIVO con un número de boleta pegado, que no corresponde
--     a nada y ensucia cualquier conciliación.
--
-- Se exige además que el número no sea espacios en blanco: una boleta con
-- valor ' ' cumple "no es nulo" y no sirve para cotejar nada.
--
-- SOBRE LA VÍA: `ALTER TABLE ... ADD CONSTRAINT ... CHECK` no está en la
-- gramática documentada de SQLite pero se midió que se aplica de verdad; el
-- detalle y el porqué están en la cabecera de la migración 008, y hay pruebas
-- que reconstruyen la base desde cero para que un cambio futuro de SQLite se
-- vea en desarrollo y no en el mostrador.
--
-- Se espeja en Postgres (`0014_...`): la venta es dato de negocio.
-- ===========================================================================

ALTER TABLE ventas
  ADD CONSTRAINT ventas_boleta_solo_con_tarjeta CHECK (
    (forma_pago = 'efectivo' AND num_boleta IS NULL)
    OR (forma_pago = 'tarjeta'
        AND num_boleta IS NOT NULL
        AND length(trim(num_boleta)) > 0)
  );
