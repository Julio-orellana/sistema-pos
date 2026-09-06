-- ===========================================================================
-- 008_autorizacion_solo_con_diferencia.sql — La autorización sigue al descuadre
-- ===========================================================================
--
-- La migración 007 solo amarró las dos columnas de autorización ENTRE SÍ: o
-- van las dos, o no va ninguna. Faltaba lo importante: amarrarlas al valor de
-- `diferencia`, que es lo que las justifica.
--
-- Sin esto, la base aceptaba dos registros mentirosos:
--   * un cierre que cuadra ('0.00') pero con un autorizante anotado, que
--     inventa una autorización que nunca hizo falta pedir;
--   * un cierre descuadrado sin autorizante, que es exactamente el agujero
--     que todo el flujo de PIN existe para tapar.
-- Hasta hoy eso lo impedía solo la aplicación. Una consulta SQL a mano, un
-- respaldo restaurado a medias o un error futuro en el servicio lo dejaban
-- pasar. Ahora lo impide la base.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ES UN `ADD CONSTRAINT` Y NO UNA TABLA RECREADA
-- ---------------------------------------------------------------------------
-- SQLite documenta solo cuatro formas de ALTER TABLE: RENAME TO, RENAME
-- COLUMN, ADD COLUMN y DROP COLUMN. `ADD CONSTRAINT ... CHECK` no está en esa
-- lista, pero SQLite 3.53.4 (el que empaqueta better-sqlite3 13) lo acepta y
-- lo aplica de verdad: se midió que rechaza los cuatro estados prohibidos, en
-- INSERT y en UPDATE, que sobrevive a cerrar y reabrir el archivo, y que no
-- crea ninguna columna fantasma. Se midió también que `ADD CONSTRAINT` con
-- UNIQUE o con FOREIGN KEY sí es error de sintaxis: lo único que esta vía
-- admite es un CHECK, que es justo lo que hace falta.
--
-- La alternativa documentada era recrear `caja_sesiones` con el procedimiento
-- de doce pasos. Se descartó: esa tabla guarda dato de negocio (los cortes de
-- caja) y `ventas` la referencia por llave foránea, y el paso que apaga las
-- llaves foráneas no se puede dar aquí — se midió que `PRAGMA foreign_keys`
-- es ignorado dentro de una transacción, y el migrador corre cada archivo
-- dentro de una. Copiar dato de negocio entre tablas para ganar una restricción
-- es más riesgo del que la restricción evita.
--
-- El precio de usar gramática no documentada es que una versión futura de
-- SQLite podría dejar de aceptarla, y la migración fallaría al primer arranque
-- en una máquina nueva. Ese riesgo está cubierto por una prueba automatizada
-- —«la base rechaza una autorización sin diferencia que la justifique» y sus
-- hermanas, en restricciones.test.ts— que reconstruye la base desde cero y
-- comprueba que la restricción existe y muerde. Si SQLite cambia, `npm test`
-- se cae en desarrollo, no en el mostrador de Jimmy.
--
-- ---------------------------------------------------------------------------
-- ESTA MIGRACIÓN REVISA LOS DATOS QUE YA ESTÁN GUARDADOS
-- ---------------------------------------------------------------------------
-- Se midió que SQLite NO agrega la restricción si alguna fila existente la
-- viola: devuelve `constraint failed` y, como cada migración corre en una
-- transacción, revierte entera y la aplicación no arranca.
--
-- Es el comportamiento correcto —una restricción que admite excepciones
-- heredadas no restringe nada— pero conviene saberlo: si esta migración falla
-- al actualizar una tienda, el mensaje no significa que el código esté mal,
-- significa que en esa base hay un cierre descuadrado sin autorizante. Se
-- localiza así, y se decide qué hacer con él ANTES de volver a intentar:
--
--   SELECT id, cerrada_en, diferencia
--     FROM caja_sesiones
--    WHERE diferencia IS NOT NULL
--      AND diferencia NOT IN ('0.00', '-0.00')
--      AND (diferencia_autorizada_por IS NULL OR diferencia_autorizada_via IS NULL);
--
-- Hoy no puede haber ninguna: la regla la venía aplicando el servicio de caja
-- desde que existe el módulo, y todavía no hay ninguna tienda en producción.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ COMPARAR CONTRA EL TEXTO '0.00' ES EXACTO
-- ---------------------------------------------------------------------------
-- `diferencia` es TEXT, y en SQLite comparar TEXT contra un NÚMERO es una
-- trampa conocida (por el orden entre tipos, cualquier texto resulta mayor que
-- cualquier número; por eso las reglas de no negatividad usan GLOB '-*' y no
-- `>= 0`). Aquí no aplica: '0.00' es un literal de texto, así que la
-- comparación es entre dos textos y es exacta.
--
-- Se compara contra la forma canónica que escribe `montoACadena`, siempre dos
-- decimales. Se midió que Decimal.js nunca produce '-0.00' (normaliza el cero
-- con signo), así que ese valor no puede llegar desde la aplicación; se incluye
-- de todas formas en el conjunto de ceros porque el CHECK de formato de la
-- migración 001 lo aceptaría, y un cero escrito a mano no debe exigir permiso.
-- ===========================================================================

ALTER TABLE caja_sesiones
  ADD CONSTRAINT caja_sesiones_autorizacion_solo_con_diferencia CHECK (
    -- Turno abierto (diferencia todavía nula) o turno que cuadra: sin permiso.
    (
      (diferencia IS NULL OR diferencia IN ('0.00', '-0.00'))
      AND diferencia_autorizada_por IS NULL
      AND diferencia_autorizada_via IS NULL
    )
    OR
    -- Turno descuadrado: quién autorizó y por cuál vía, ambos obligatorios.
    (
      diferencia IS NOT NULL
      AND diferencia NOT IN ('0.00', '-0.00')
      AND diferencia_autorizada_por IS NOT NULL
      AND diferencia_autorizada_via IS NOT NULL
    )
  );
