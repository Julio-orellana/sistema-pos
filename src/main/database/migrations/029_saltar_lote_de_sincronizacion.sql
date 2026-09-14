-- ===========================================================================
-- 029_saltar_lote_de_sincronizacion.sql — Quinta superficie con candado
-- ===========================================================================
--
-- Agrega 'saltar_lote_de_sincronizacion' al conjunto de superficies con
-- candado propio, junto a 'salida_controlada', 'cierre_con_diferencia',
-- 'cierre_de_caja_ajena' y 'descuento_excedente'.
--
-- PARA QUÉ: la pantalla de sincronización (Fase 4.a, `docs/SINCRONIZACION.md`
-- §3.3, decisión 9) deja saltar a mano un lote que quedó detenido con un error
-- determinístico. Saltarlo es la ÚNICA forma legítima de dejar un hueco
-- deliberado en el respaldo de la nube, así que exige el PIN de un
-- administrador, con su propio limitador de intentos.
--
-- SOLO ACEPTA EL PIN NORMAL, no el remoto. Es la misma decisión de alcance
-- mínimo que 'cierre_de_caja_ajena' y 'salida_controlada': el PIN remoto se
-- pidió para autorizar diferencias de caja por teléfono, y esta acción es
-- todavía más sensible —deja un hueco PERMANENTE, no una autorización de un
-- momento—, así que exige presencia. Cada superficie que acepte el remoto
-- tiene que pedirse y decidirse aparte, nunca darse por supuesta.
--
-- POR QUÉ SE RECREA LA TABLA EN VEZ DE ALTERARLA: SQLite no permite modificar
-- una restricción CHECK existente. Recrearla es segura aquí, igual que en las
-- migraciones 006, 011 y 013: el contenido de `bloqueos_de_autorizacion` es,
-- como mucho, un contador de intentos con 30 segundos de vigencia.
--
-- ESTA TABLA NO SE ESPEJA EN POSTGRES. Es estado por superficie de una
-- terminal concreta; ver CLAUDE.md §4.4 y §4.8. Por eso NO existe un archivo
-- `0029_...`, y el hueco de numeración es deliberado (dirección 1 del README
-- de `supabase/migrations`).
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
                        'descuento_excedente',
                        'saltar_lote_de_sincronizacion'
                      )),

  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),

  bloqueado_hasta   TEXT    CHECK (bloqueado_hasta IS NULL OR
                              bloqueado_hasta LIKE '____-__-__T__:__:__%Z'),

  actualizado_en    TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);
