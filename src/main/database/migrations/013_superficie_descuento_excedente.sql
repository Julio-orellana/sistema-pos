-- ===========================================================================
-- 013_superficie_descuento_excedente.sql — Cuarta superficie con candado
-- ===========================================================================
--
-- Agrega 'descuento_excedente' al conjunto de superficies con candado propio,
-- junto a 'salida_controlada', 'cierre_con_diferencia' y 'cierre_de_caja_ajena'.
--
-- PARA QUÉ: un vendedor puede aplicar descuento hasta el tope de su rol. Para
-- pasarse de ese tope hace falta el PIN de un administrador, y ese diálogo
-- necesita su propio limitador de intentos.
--
-- SOLO ACEPTA EL PIN NORMAL, no el remoto. Es la misma decisión de alcance
-- mínimo que en 'cierre_de_caja_ajena': el PIN remoto se pidió para autorizar
-- diferencias de caja por teléfono y nada más. Cada superficie que lo acepte
-- tiene que pedirse y decidirse aparte, no darse por supuesta.
--
-- POR QUÉ SE RECREA LA TABLA EN VEZ DE ALTERARLA: SQLite no permite modificar
-- una restricción CHECK existente. Recrearla es seguro aquí y en ninguna otra
-- tabla del esquema lo sería: el contenido de `bloqueos_de_autorizacion` es,
-- como mucho, un contador de intentos con 30 segundos de vigencia.
--
-- ESTA TABLA NO SE ESPEJA EN POSTGRES. Es estado por superficie de una
-- terminal concreta; ver CLAUDE.md §4.4 y §4.8. Por eso NO existe un archivo
-- `0013_...`, y el hueco de numeración es deliberado.
-- ===========================================================================

DROP TABLE IF EXISTS bloqueos_de_autorizacion;

CREATE TABLE bloqueos_de_autorizacion (
  -- Agregar una superficie nueva exige otra migración que amplíe este CHECK,
  -- a propósito: así el conjunto de superficies protegidas queda a la vista.
  superficie        TEXT    PRIMARY KEY NOT NULL
                      CHECK (superficie IN (
                        'salida_controlada',
                        'cierre_con_diferencia',
                        'cierre_de_caja_ajena',
                        'descuento_excedente'
                      )),

  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),

  bloqueado_hasta   TEXT    CHECK (bloqueado_hasta IS NULL OR
                              bloqueado_hasta LIKE '____-__-__T__:__:__%Z'),

  actualizado_en    TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);
