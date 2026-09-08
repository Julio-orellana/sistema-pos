-- ===========================================================================
-- 012_caja_cerrada_por.sql — Quién cerró el turno, cuando no fue quien lo abrió
-- ===========================================================================
--
-- Desde la migración 010 la caja es una sola en todo el sistema, así que puede
-- cerrarla alguien distinto de quien la abrió. `usuario_id` sigue diciendo
-- QUIÉN LA ABRIÓ; esta columna dice QUIÉN LA CERRÓ.
--
-- NULL significa "la cerró la misma persona que la abrió", que es el caso
-- normal. Se deja nulo en vez de repetir el `usuario_id` para que un cierre
-- ajeno se vea de un vistazo en una consulta —`WHERE cerrada_por IS NOT NULL`
-- son exactamente los cierres que necesitaron autorización— sin tener que
-- comparar dos columnas.
--
-- GUARDA A QUIEN CERRÓ, NO A QUIEN AUTORIZÓ. Son dos personas distintas: el
-- cajero de la tarde cierra, el administrador autoriza con su PIN. Quién
-- autorizó queda en el asiento de auditoría del cierre, junto con quién abrió
-- y quién cerró. Confundirlas haría que el corte pareciera hecho por el
-- administrador, que quizá ni estaba en la tienda.
--
-- ON DELETE SET NULL, igual que `diferencia_autorizada_por`: si el usuario se
-- borra, el corte sobrevive sin el nombre.
--
-- Se espeja en Postgres (`0012_...`): el corte de caja es dato de negocio.
-- ===========================================================================

ALTER TABLE caja_sesiones
  ADD COLUMN cerrada_por TEXT REFERENCES usuarios (id) ON DELETE SET NULL;

-- Los cierres que necesitaron autorización son pocos y son los que un auditor
-- va a querer listar primero.
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_cerradas_por_otro
  ON caja_sesiones (cerrada_por)
  WHERE cerrada_por IS NOT NULL;
