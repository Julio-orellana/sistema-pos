-- ===========================================================================
-- 002_bloqueo_de_usuarios.sql — Bloqueo por intentos fallidos, por usuario
-- ===========================================================================
--
-- La tabla usuarios ya existía desde la migración 001; esta migración se suma,
-- no la modifica. Agrega los dos campos que hacen falta para bloquear a un
-- usuario después de varios intentos de PIN fallidos.
--
-- Hasta ahora el limitador de intentos vivía en memoria y era global (el del
-- PIN de salida controlada). Al pasar a usuarios reales tiene que ser POR
-- USUARIO y sobrevivir a un reinicio de la aplicación: si no, bastaría con
-- cerrar y volver a abrir el punto de venta para reiniciar el contador y seguir
-- adivinando.
-- ===========================================================================

-- Intentos fallidos consecutivos. Se reinicia a 0 en el próximo ingreso
-- correcto. Nunca negativo: un contador de intentos por debajo de cero no
-- significa nada.
ALTER TABLE usuarios
  ADD COLUMN intentos_fallidos INTEGER NOT NULL DEFAULT 0
    CHECK (intentos_fallidos >= 0);

-- Momento hasta el cual el usuario no puede intentar de nuevo, en ISO-8601
-- UTC. NULL quiere decir que NO está bloqueado, que es el estado normal.
ALTER TABLE usuarios
  ADD COLUMN bloqueado_hasta TEXT
    CHECK (bloqueado_hasta IS NULL OR bloqueado_hasta LIKE '____-__-__T__:__:__%Z');

-- Índice parcial: solo interesan los pocos usuarios que estén bloqueados.
CREATE INDEX IF NOT EXISTS idx_usuarios_bloqueados
  ON usuarios (bloqueado_hasta) WHERE bloqueado_hasta IS NOT NULL;
