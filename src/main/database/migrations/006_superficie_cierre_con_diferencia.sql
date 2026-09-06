-- ===========================================================================
-- 006_superficie_cierre_con_diferencia.sql — Nueva superficie de autorización
-- ===========================================================================
--
-- Agrega 'cierre_con_diferencia' al conjunto de superficies con candado
-- propio, junto a la que ya existía, 'salida_controlada'.
--
-- POR QUÉ SE RECREA LA TABLA EN VEZ DE ALTERARLA: SQLite no permite modificar
-- una restricción CHECK existente. Recrearla es seguro aquí y en ninguna otra
-- tabla del esquema lo sería: el contenido de `bloqueos_de_autorizacion` es,
-- como mucho, un contador de intentos con 30 segundos de vigencia. Perderlo al
-- migrar equivale a que el candado empiece limpio, que es exactamente el
-- estado normal.
--
-- ESTA TABLA NO SE ESPEJA EN POSTGRES. Es estado por superficie de una
-- terminal concreta y no debe sincronizarse bajo ningún diseño futuro; ver
-- CLAUDE.md §4.4 y §4.8. Por eso NO existe un archivo `0006_...` en
-- supabase/migrations, y el hueco de numeración es deliberado.
-- ===========================================================================

DROP TABLE IF EXISTS bloqueos_de_autorizacion;

CREATE TABLE bloqueos_de_autorizacion (
  -- Agregar una superficie nueva exige otra migración que amplíe este CHECK,
  -- a propósito: así el conjunto de superficies protegidas queda a la vista.
  superficie        TEXT    PRIMARY KEY NOT NULL
                      CHECK (superficie IN ('salida_controlada', 'cierre_con_diferencia')),

  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),

  bloqueado_hasta   TEXT    CHECK (bloqueado_hasta IS NULL OR
                              bloqueado_hasta LIKE '____-__-__T__:__:__%Z'),

  actualizado_en    TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);
