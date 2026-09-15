-- ===========================================================================
-- 031_productos_precio_compra.sql — Cuánto le cuesta el producto a la tienda
-- ===========================================================================
--
-- Lo pidió Julio el 2026-09-14, después de que Jimmy probara el sistema en el
-- equipo real: el reporte de ventas por producto tiene que poder decir cuánto
-- se GANÓ, no solo cuánto se vendió. Para eso hace falta el costo.
--
-- ES NULABLE, Y `NULL` NO ES CERO. No todos los productos van a tener su costo
-- cargado desde el primer día —el catálogo real de Jimmy todavía no llegó—, y
-- el reporte tiene que distinguir «este producto no deja ganancia» (costo igual
-- al precio) de «no sabemos cuánto cuesta». Un DEFAULT de cero confundiría las
-- dos cosas en silencio, y un margen calculado contra un costo inventado es
-- peor que no mostrar margen.
--
-- La forma es la canónica de un monto —dos decimales, TEXT— por la misma razón
-- que `precio_base` (§5): SQLite REAL es punto flotante. El piso se escribe
-- `NOT GLOB '-*'` y no `>= 0`, porque en SQLite cualquier TEXT resulta mayor
-- que cero (§4.2).
--
-- EL CHECK EMPIEZA POR `IS NULL OR`, que es la forma que la auditoría
-- permanente de restricciones exige (§5, Prompt 27): con la columna en NULL la
-- expresión da VERDADERO y no NULL, y con un valor presente todas las demás
-- partes son comparaciones sobre texto no nulo.
--
-- SE ESPEJA EN POSTGRES (`0031_productos_precio_compra`), y no es opcional:
-- el payload de `productos` es la fila entera (§4.17) y las funciones de la
-- nube exigen EXACTAMENTE las columnas de la tabla (`exigir_claves_conocidas`,
-- `0023`). Sin el espejo, el primer lote de un producto se rechazaría por
-- «columna de más» y la cola se detendría.
--
-- LA SEGUNDA SENTENCIA ARREGLA LO QUE YA ESTABA ESPERANDO EN LA COLA. Un
-- producto encolado antes de esta migración tiene un payload SIN la clave
-- `precio_compra`, y el payload se guarda al encolar (§4.17): después de
-- actualizar, la nube lo rechazaría por «columna de menos» y ningún reintento
-- lo arreglaría, porque el payload no se vuelve a leer. Se le agrega la clave
-- con `null`, que es exactamente lo que la fila tiene. Mismo criterio que la
-- 028 y la 030 aplicaron a sus columnas.
-- ===========================================================================

ALTER TABLE productos
  ADD COLUMN precio_compra TEXT
    CONSTRAINT productos_precio_compra_canonico
    CHECK (precio_compra IS NULL
           OR (typeof(precio_compra) = 'text'
               AND precio_compra GLOB '[0-9]*.[0-9][0-9]'
               AND NOT precio_compra GLOB '*.*.*'
               AND NOT precio_compra GLOB '?*-*'
               AND NOT precio_compra GLOB '-*'));

UPDATE sync_cola
   SET payload = json_set(payload, '$.precio_compra', json('null'))
 WHERE entidad_tipo = 'productos'
   AND sincronizado_en IS NULL
   AND json_type(payload, '$.precio_compra') IS NULL;
