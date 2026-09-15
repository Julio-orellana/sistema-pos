-- ===========================================================================
-- 034_superficie_anulacion_de_venta.sql — Sexta superficie con candado
-- ===========================================================================
--
-- Agrega 'anulacion_de_venta' al conjunto de superficies con candado propio,
-- junto a 'salida_controlada', 'cierre_con_diferencia', 'cierre_de_caja_ajena',
-- 'descuento_excedente' y 'saltar_lote_de_sincronizacion'.
--
-- PARA QUÉ: anular una venta exige SIEMPRE el PIN de un administrador, también
-- cuando el cajero corrige su propio error (`docs/ANULACION-DE-VENTA.md`,
-- sección 4). Con su propio limitador de intentos: 3 fallos, 30 segundos.
--
-- CANDADO INDEPENDIENTE. Bloquear la anulación no bloquea ninguna de las otras
-- cinco superficies ni el ingreso, y al revés (CLAUDE.md §4.8).
--
-- SOLO ACEPTA EL PIN NORMAL, no el remoto. La razón está en la sección 4.2 del
-- diseño: el fraude que este PIN existe para frenar —cobrar en efectivo, anular
-- y quedarse con el dinero— es el que un teléfono no puede verificar. La
-- política vive en `ACEPTA_PIN_REMOTO`, no en esta tabla.
--
-- POR QUÉ SE RECREA LA TABLA EN VEZ DE ALTERARLA: SQLite no permite modificar
-- una restricción CHECK existente. Recrearla es segura aquí, igual que en las
-- migraciones 006, 011, 013 y 029: el contenido de `bloqueos_de_autorizacion`
-- es, como mucho, un contador de intentos con 30 segundos de vigencia.
--
-- ESTA TABLA NO SE ESPEJA EN POSTGRES. Es estado por superficie de una
-- terminal concreta (CLAUDE.md §4.4 y §4.8). El `0034` queda reservado del
-- otro lado, sin usar.
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
                        'saltar_lote_de_sincronizacion',
                        'anulacion_de_venta'
                      )),

  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),

  bloqueado_hasta   TEXT    CHECK (bloqueado_hasta IS NULL OR
                              bloqueado_hasta LIKE '____-__-__T__:__:__%Z'),

  actualizado_en    TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);
