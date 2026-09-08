-- ===========================================================================
-- 011_superficie_cierre_de_caja_ajena.sql — Tercera superficie con candado
-- ===========================================================================
--
-- Agrega 'cierre_de_caja_ajena' al conjunto de superficies con candado propio,
-- junto a 'salida_controlada' y 'cierre_con_diferencia'.
--
-- PARA QUÉ: desde la migración 010 la caja es una sola en todo el sistema, así
-- que puede tocarle cerrarla a alguien que no fue quien la abrió —el turno de
-- la tarde cierra la caja que abrió el de la mañana—. Ese cierre exige el PIN
-- de un administrador, y ese diálogo necesita su propio limitador de intentos.
--
-- POR QUÉ UNA SUPERFICIE NUEVA Y NO REUSAR 'cierre_con_diferencia': son dos
-- autorizaciones distintas que pueden pedirse en el mismo cierre. Compartir
-- candado haría que fallar el PIN de una bloqueara la otra, y además el PIN
-- REMOTO vale para la diferencia y NO para el cierre ajeno, así que ni
-- siquiera aceptan el mismo código.
--
-- POR QUÉ SE RECREA LA TABLA EN VEZ DE ALTERARLA: SQLite no permite modificar
-- una restricción CHECK existente. Recrearla es seguro aquí y en ninguna otra
-- tabla del esquema lo sería: el contenido de `bloqueos_de_autorizacion` es,
-- como mucho, un contador de intentos con 30 segundos de vigencia. Perderlo al
-- migrar equivale a que el candado empiece limpio, que es el estado normal.
--
-- ESTA TABLA NO SE ESPEJA EN POSTGRES. Es estado por superficie de una
-- terminal concreta y no debe sincronizarse bajo ningún diseño futuro; ver
-- CLAUDE.md §4.4 y §4.8. Por eso NO existe un archivo `0011_...` en
-- supabase/migrations, y el hueco de numeración es deliberado.
-- ===========================================================================

DROP TABLE IF EXISTS bloqueos_de_autorizacion;

CREATE TABLE bloqueos_de_autorizacion (
  -- Agregar una superficie nueva exige otra migración que amplíe este CHECK,
  -- a propósito: así el conjunto de superficies protegidas queda a la vista.
  superficie        TEXT    PRIMARY KEY NOT NULL
                      CHECK (superficie IN (
                        'salida_controlada',
                        'cierre_con_diferencia',
                        'cierre_de_caja_ajena'
                      )),

  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),

  bloqueado_hasta   TEXT    CHECK (bloqueado_hasta IS NULL OR
                              bloqueado_hasta LIKE '____-__-__T__:__:__%Z'),

  actualizado_en    TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);
