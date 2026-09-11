-- ===========================================================================
-- 017_descuento_autorizado_via.sql — Cómo se autorizó un descuento excedente
-- ===========================================================================
--
-- `ventas.descuento_autorizado_por` existe desde la migración 001 y guarda QUIÉN
-- autorizó un descuento que pasaba el tope del rol. Faltaba CÓMO: presencial,
-- tecleando su PIN normal frente a la pantalla, o remoto, dictando por teléfono
-- el PIN de autorización remota.
--
-- Hasta hoy la pregunta no tenía sentido, porque la superficie
-- `descuento_excedente` solo aceptaba el PIN normal y la respuesta era siempre
-- «presencial». **Julio decidió explícitamente el 2026-09-11 que también acepte
-- el PIN remoto**, para los casos en que Jimmy no está en la tienda y hay un
-- cliente esperando. Desde ese momento las dos vías son posibles y el
-- comprobante de auditoría tiene que decir cuál fue: una autorización dada por
-- teléfono y una dada frente al mostrador no son el mismo hecho.
--
-- Es el mismo par de columnas que `caja_sesiones.diferencia_autorizada_por` y
-- `diferencia_autorizada_via` (migración 007). Se espeja en Postgres (`0017`):
-- es dato de negocio y es exactamente lo que un auditor va a querer cruzar.
--
-- ---------------------------------------------------------------------------
-- EL CHECK NO COPIA LITERALMENTE EL DE LA 007, Y ES A PROPÓSITO
-- ---------------------------------------------------------------------------
-- La 007 escribió la coherencia así:
--
--     (via IS NULL AND por IS NULL)
--     OR (via IN ('presencial','remoto') AND por IS NOT NULL)
--
-- **Esa forma NO rechaza un autorizante sin vía**, y se midió antes de
-- escribir esta migración. El motivo es la lógica de tres valores de SQL: con
-- `via` en NULL, `via IN ('presencial','remoto')` no da FALSO sino NULL, la
-- segunda rama entera da NULL, y un CHECK **pasa cuando su expresión da NULL**;
-- solo falla cuando da FALSO. Así que `por = 'u1'` con `via = NULL` entraba sin
-- protestar, justo la mitad que el comentario de la 007 decía proteger.
--
-- En `caja_sesiones` el hueco está tapado por otra vía: el CHECK
-- `caja_sesiones_autorizacion_solo_con_diferencia` de la migración 008 exige
-- `diferencia_autorizada_via IS NOT NULL` de forma explícita, así que allí no
-- se puede guardar un cierre descuadrado con autorizante y sin vía. Es decir:
-- no hay ningún dato mal guardado hoy, pero la forma de la 007 por sí sola es
-- más débil de lo que aparenta.
--
-- Acá NO hay una segunda restricción que salve, así que la coherencia se
-- escribe con los `IS NOT NULL` ADELANTE, que cortocircuitan a FALSO y hacen
-- que el CHECK muerda. Medido con las ocho combinaciones:
--
--   ACEPTA   los dos NULL                     (venta sin autorización)
--   ACEPTA   por + via 'presencial'
--   ACEPTA   por + via 'remoto'
--   RECHAZA  vía SIN autorizante
--   RECHAZA  autorizante SIN vía              <- lo que la forma de la 007 dejaba pasar
--   RECHAZA  vía inventada ('telepatia')
--   RECHAZA  vía en cadena vacía
--   RECHAZA  los dos UPDATE que romperían el par
--
-- La restricción lleva NOMBRE, igual que su espejo de Postgres, para que el
-- error diga cuál falló y no solo que falló alguno.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTE `ALTER TABLE` ES SEGURO EN UNA TIENDA YA INSTALADA
-- ---------------------------------------------------------------------------
-- `ADD COLUMN` deja la columna nueva en NULL para toda fila existente, y una
-- venta vieja con `descuento_autorizado_por` en NULL cae en la primera rama del
-- CHECK. Las ventas viejas CON autorizante quedarían con vía nula y violarían
-- la nueva regla... salvo que no existe ninguna: la superficie acaba de empezar
-- a poder registrar autorizaciones y no hay ninguna tienda en producción. Si
-- alguna vez apareciera una, se localiza así antes de volver a intentar:
--
--   SELECT id, fecha FROM ventas
--    WHERE descuento_autorizado_por IS NOT NULL
--      AND descuento_autorizado_via IS NULL;
--
-- Y se completa con 'presencial', que es la única vía que el sistema podía
-- registrar antes de esta migración.
-- ===========================================================================

ALTER TABLE ventas
  ADD COLUMN descuento_autorizado_via TEXT
    -- LLEVA NOMBRE, y el mismo que en Postgres. Se midió que SQLite acepta un
    -- `CONSTRAINT ... CHECK` dentro de un `ADD COLUMN` y que el error lo nombra:
    -- «CHECK constraint failed: ventas_autorizacion_de_descuento_coherente».
    -- Sin nombre, el mensaje no dice cuál de los CHECK de `ventas` falló, y
    -- `errores.ts` no podría traducirlo a un mensaje de negocio (§5).
    CONSTRAINT ventas_autorizacion_de_descuento_coherente
    CHECK (
      -- Sin autorización: las dos columnas vacías. Es el caso normal, porque
      -- la mayoría de las ventas no lleva descuento y las que lo llevan casi
      -- nunca exceden el tope del rol.
      (descuento_autorizado_via IS NULL AND descuento_autorizado_por IS NULL)
      OR
      -- Con autorización: las dos llenas, y la vía es una de las dos que el
      -- sistema sabe determinar. Los `IS NOT NULL` van primero a propósito;
      -- ver la explicación de la cabecera.
      (
        descuento_autorizado_via IS NOT NULL
        AND descuento_autorizado_por IS NOT NULL
        AND descuento_autorizado_via IN ('presencial', 'remoto')
      )
    );

-- Las autorizaciones de descuento son la excepción, no la regla: el índice
-- parcial solo indexa esas filas y no paga nada por las demás. Es el mismo
-- criterio de `idx_caja_sesiones_autorizadas`.
CREATE INDEX IF NOT EXISTS idx_ventas_descuento_autorizado
  ON ventas (descuento_autorizado_por)
  WHERE descuento_autorizado_por IS NOT NULL;
