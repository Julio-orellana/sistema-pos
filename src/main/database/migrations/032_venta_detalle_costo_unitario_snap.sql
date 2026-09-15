-- ===========================================================================
-- 032_venta_detalle_costo_unitario_snap.sql — La foto del costo en cada venta
-- ===========================================================================
--
-- Lo pidió Julio el 2026-09-14. Desde la 031, el margen del reporte por
-- producto se calculaba con `productos.precio_compra` VIGENTE, así que un
-- reporte de un mes pasado cambiaba de valor cuando alguien corregía el costo
-- hoy. Es exactamente el problema que las columnas `*_snap` de esta tabla ya
-- resuelven para el nombre, la unidad y el precio: el detalle de una venta
-- guarda una FOTO del producto al momento de vender, no una referencia viva.
--
-- ES NULABLE, Y `NULL` NO ES CERO. Dos casos lo dejan en NULL, y los dos son
-- «no sabemos cuánto costó», nunca «costó cero»:
--
--   · Las ventas registradas ANTES de esta migración. No se completan con el
--     costo de hoy: eso sería inventar retroactivamente un dato que nadie
--     anotó, y es justo el defecto que esta columna viene a cerrar.
--   · Una venta de un producto que en ese momento no tenía `precio_compra`.
--
-- Esta migración NO toca ninguna fila existente: el `ADD COLUMN` sin DEFAULT
-- las deja en NULL, que es la verdad sobre ellas.
--
-- La forma es la canónica de un monto, igual que `precio_unitario_snap`,
-- porque es la copia de `productos.precio_compra`, que tiene esa forma. El
-- CHECK empieza por `IS NULL OR` por la auditoría permanente de restricciones
-- (§5, Prompt 27), y el piso se escribe `NOT GLOB '-*'` por la razón de §4.2.
--
-- SE ESPEJA EN POSTGRES (`0032_venta_detalle_costo_unitario_snap`): el payload
-- de `venta_detalle` es la fila entera (§4.17) y las funciones de la nube
-- exigen EXACTAMENTE sus columnas. Por la misma razón, la segunda sentencia
-- agrega la clave `costo_unitario_snap` con `null` a las líneas de venta que
-- esperaban en la cola: sin eso, la nube las rechazaría por «columna de menos»
-- y ningún reintento lo arreglaría, porque el payload se guarda al encolar.
-- ===========================================================================

ALTER TABLE venta_detalle
  ADD COLUMN costo_unitario_snap TEXT
    CONSTRAINT venta_detalle_costo_unitario_snap_canonico
    CHECK (costo_unitario_snap IS NULL
           OR (typeof(costo_unitario_snap) = 'text'
               AND costo_unitario_snap GLOB '[0-9]*.[0-9][0-9]'
               AND NOT costo_unitario_snap GLOB '*.*.*'
               AND NOT costo_unitario_snap GLOB '?*-*'
               AND NOT costo_unitario_snap GLOB '-*'));

UPDATE sync_cola
   SET payload = json_set(payload, '$.costo_unitario_snap', json('null'))
 WHERE entidad_tipo = 'venta_detalle'
   AND sincronizado_en IS NULL
   AND json_type(payload, '$.costo_unitario_snap') IS NULL;
