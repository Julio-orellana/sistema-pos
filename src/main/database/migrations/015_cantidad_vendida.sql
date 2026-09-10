-- ===========================================================================
-- 015_cantidad_vendida.sql — Cuánto se vendió, no solo cuántas veces
-- ===========================================================================
--
-- `productos.contador_ventas` cuenta VECES: sube uno por cada línea de venta
-- en que aparece el producto, sin importar si se llevaron una libra o cien.
-- Esta columna guarda la otra medida, la CANTIDAD acumulada.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO CAMBIAR LA QUE HABÍA. `contador_ventas` es
-- INTEGER, y una venta a granel de 2.5 lb no cabe en un entero sin mentir:
-- truncarla a 2 perdería media libra en cada venta, y redondearla a 3 le
-- inventaría media libra que nadie compró. La cantidad necesita el mismo TEXT
-- canónico de tres decimales que usa `inventario_disponible`. Cambiarle el
-- tipo a la columna existente exigiría el rebuild de doce pasos de `productos`
-- —tabla nueva, copiar, borrar, renombrar—, que este proyecto ya descartó una
-- vez (ver el registro de decisiones, migración 008): `venta_detalle` y
-- `precios_especiales` la referencian, y el paso que apaga las llaves foráneas
-- es IGNORADO dentro de una transacción, que es donde corre cada migración.
-- `ADD COLUMN` no tiene ninguno de esos problemas.
--
-- LAS DOS MEDIDAS SIRVEN PARA COSAS DISTINTAS, y por eso conviven:
--
--   · `contador_ventas` ordena los íconos de la pantalla de venta. Cuenta
--     transacciones, que es la única medida COMPARABLE ENTRE PRODUCTOS: las
--     libras de maíz y las unidades de huevo no se pueden sumar en un mismo
--     número, y ordenar por cantidad pondría el maíz —que sale de a cien
--     libras— siempre por encima de todo lo que se vende por unidad.
--   · `cantidad_vendida` responde cuánta mercadería salió, que es lo que hace
--     falta para conciliar contra el inventario y para el módulo de mermas.
--
-- CUÁL DE LAS DOS DEBE ORDENAR LA CUADRÍCULA es una definición de negocio que
-- Jimmy no confirmó. Hoy ordena `contador_ventas`, que es como estaba. Queda
-- anotado en la lista de pendientes de CLAUDE.md.
--
-- Las dos suben DENTRO de la misma transacción que registra la venta, en un
-- solo UPDATE, para que sea imposible mover una sin la otra.
--
-- Se espeja en Postgres (`0015_...`): es dato de negocio.
-- ===========================================================================

-- El DEFAULT tiene la forma canónica exacta que exige el CHECK: tres
-- decimales, sin signo. Los productos que ya existen quedan en cero, que es la
-- verdad — ninguna venta los tocó todavía, porque nada incrementaba nada.
ALTER TABLE productos
  ADD COLUMN cantidad_vendida TEXT NOT NULL DEFAULT '0.000'
    CHECK (typeof(cantidad_vendida) = 'text'
           AND cantidad_vendida GLOB '[0-9]*.[0-9][0-9][0-9]'
           AND NOT cantidad_vendida GLOB '*.*.*'
           AND NOT cantidad_vendida GLOB '?*-*'
           -- Sin GLOB '-*': acumula ventas, nunca baja. Las mermas y las
           -- devoluciones son módulos futuros y traerán su propio camino.
           AND NOT cantidad_vendida GLOB '-*');
