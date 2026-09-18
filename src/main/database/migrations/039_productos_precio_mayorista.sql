-- ===========================================================================
-- 039_productos_precio_mayorista.sql — Precio mayorista por cantidad mínima
-- ===========================================================================
--
-- Spec 002 (`spec/features/002-precio-mayorista/`), pedido por Julio el
-- 2026-09-18. Un producto puede tener, opcionalmente, un precio mayorista que
-- se cobra cuando la cantidad de la línea llega a una cantidad mínima. El
-- precio de la línea es el MENOR entre lista, especial vigente y mayorista si
-- califica (`src/shared/precio-de-linea.ts`), y se congela en
-- `venta_detalle.precio_unitario_snap`, como hoy: NO hay ninguna columna nueva
-- en `venta_detalle`.
--
-- LAS DOS COLUMNAS SON NULABLES, Y `NULL` ES «SIN PRECIO MAYORISTA». Los
-- productos que ya existen quedan así, y ninguno cambia de precio.
--
--   · `precio_mayorista`: monto canónico de DOS decimales, como `precio_base`
--     y `precio_compra` (031).
--   · `cantidad_minima_mayorista`: cantidad canónica de TRES decimales, como el
--     peso y la cantidad del ícono. Está en la unidad del producto: libras o
--     kilogramos si se vende por peso, unidades si se vende por unidad.
--
-- LAS CUATRO REGLAS (spec §4.2), cada una con NOMBRE para que `errores.ts` la
-- traduzca a un mensaje de negocio:
--
--   R1  productos_mayorista_completo           los dos o ninguno
--   R2  productos_precio_mayorista_canonico    monto canónico y no negativo
--   R3  productos_mayorista_menor_que_lista    ESTRICTAMENTE menor que la lista
--   R4  productos_cantidad_minima_mayorista_canonica
--                                              cantidad canónica y mayor que cero
--
-- R3 COMPARA CENTAVOS ENTEROS, NUNCA TEXTO NI PUNTO FLOTANTE. Las columnas son
-- TEXT, y el texto se compara byte a byte: '10.00' < '9.00' da VERDADERO (el
-- mismo defecto que CLAUDE.md §4.15 midió con ORDER BY). Un CAST a REAL
-- metería punto flotante en una regla de dinero. Como R2 y el CHECK de
-- `precio_base` (001) garantizan exactamente dos decimales, quitar el punto da
-- los centavos exactos: '6.00' -> 600, '0.50' -> 50.
--
-- R3 SE EVALÚA EN CADA ESCRITURA DE LA FILA, también cuando se edita el precio
-- de lista: bajar la lista por debajo del mayorista que ya había SE RECHAZA.
-- Es la decisión 1 de la spec (§4.3), a revisar por Julio antes de aplicar el
-- espejo en cualquier nube; el servicio lo dice con palabras antes de llegar
-- acá. Si se decidiera lo contrario, esta migración todavía no está aplicada en
-- ninguna base que importe.
--
-- NINGUNA DE LAS CUATRO PUEDE DAR NULL: empiezan por `IS NULL OR`, o son
-- combinaciones de `IS NULL` / `IS NOT NULL`. La auditoría permanente de
-- restricciones (`checks-con-null.test.ts`) lo comprueba sola.
--
-- R1 y R3 SON RESTRICCIONES DE TABLA y se agregan con `ADD CONSTRAINT`, la
-- gramática que SQLite no documenta pero que el proyecto ya usa y tiene medida
-- en la versión empaquetada (008 y 038). Si una versión futura dejara de
-- aceptarla, las pruebas de esta migración fallan en desarrollo, no en la
-- tienda. Las filas que ya existen tienen NULL en las dos columnas, así que las
-- cuatro restricciones las aceptan.
--
-- SE ESPEJA EN POSTGRES (`0039_productos_precio_mayorista`), con los mismos
-- nombres para R1 y R3. No es opcional: el payload de `productos` es la fila
-- entera (§4.17) y las funciones de la nube exigen EXACTAMENTE las columnas de
-- la tabla. Una terminal con esta migración contra una nube sin la 0039 detiene
-- su cola en el primer lote de productos o de venta, y al revés también
-- (medido para la 0031, §4.39).
--
-- LA ÚLTIMA SENTENCIA ARREGLA LO QUE YA ESTABA ESPERANDO EN LA COLA: un
-- producto encolado antes de esta migración tiene un payload sin las dos
-- claves, y el payload no se vuelve a leer. Se le agregan en `null`, que es lo
-- que la fila tiene. Mismo criterio que la 031.
-- ===========================================================================

ALTER TABLE productos
  ADD COLUMN precio_mayorista TEXT
    CONSTRAINT productos_precio_mayorista_canonico
    CHECK (precio_mayorista IS NULL
           OR (typeof(precio_mayorista) = 'text'
               AND precio_mayorista GLOB '[0-9]*.[0-9][0-9]'
               AND NOT precio_mayorista GLOB '*.*.*'
               AND NOT precio_mayorista GLOB '?*-*'
               AND NOT precio_mayorista GLOB '-*'));

-- La última condición de esta columna la hace ESTRICTAMENTE mayor que cero,
-- como la cantidad del ícono (001): «tiene al menos un dígito distinto de
-- cero». Una cantidad mínima de cero haría que todo se cobrara a precio
-- mayorista.
ALTER TABLE productos
  ADD COLUMN cantidad_minima_mayorista TEXT
    CONSTRAINT productos_cantidad_minima_mayorista_canonica
    CHECK (cantidad_minima_mayorista IS NULL
           OR (typeof(cantidad_minima_mayorista) = 'text'
               AND cantidad_minima_mayorista GLOB '[0-9]*.[0-9][0-9][0-9]'
               AND NOT cantidad_minima_mayorista GLOB '*.*.*'
               AND NOT cantidad_minima_mayorista GLOB '?*-*'
               AND NOT cantidad_minima_mayorista GLOB '-*'
               AND cantidad_minima_mayorista GLOB '*[1-9]*'));

ALTER TABLE productos
  ADD CONSTRAINT productos_mayorista_completo
  CHECK ((precio_mayorista IS NULL AND cantidad_minima_mayorista IS NULL)
      OR (precio_mayorista IS NOT NULL AND cantidad_minima_mayorista IS NOT NULL));

ALTER TABLE productos
  ADD CONSTRAINT productos_mayorista_menor_que_lista
  CHECK (precio_mayorista IS NULL
         OR CAST(replace(precio_mayorista, '.', '') AS INTEGER)
          < CAST(replace(precio_base, '.', '') AS INTEGER));

UPDATE sync_cola
   SET payload = json_set(payload,
                          '$.precio_mayorista', json('null'),
                          '$.cantidad_minima_mayorista', json('null'))
 WHERE entidad_tipo = 'productos'
   AND sincronizado_en IS NULL
   AND json_type(payload, '$.precio_mayorista') IS NULL;
