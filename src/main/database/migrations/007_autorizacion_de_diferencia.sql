-- ===========================================================================
-- 007_autorizacion_de_diferencia.sql — Quién autorizó un cierre descuadrado
-- ===========================================================================
--
-- Cuando el corte de caja no cuadra, cerrar exige la autorización de un
-- administrador. Estas dos columnas registran quién la dio y por cuál vía.
--
-- Ambas NULL cuando no hubo diferencia que autorizar, que es el caso normal.
-- Van siempre juntas: una autorización sin vía, o una vía sin autorizante, es
-- un registro incompleto y la base lo rechaza.
--
-- Se espeja en Postgres (`0007_...`): es parte del corte de caja, que es dato
-- de negocio y lo primero que un auditor va a querer revisar.
-- ===========================================================================

-- Quién autorizó. Si el usuario se borra, el cierre sobrevive sin el autor.
ALTER TABLE caja_sesiones
  ADD COLUMN diferencia_autorizada_por TEXT REFERENCES usuarios (id) ON DELETE SET NULL;

-- Cómo autorizó: con su PIN normal estando presente, o con su PIN remoto
-- dictado por teléfono. Lo determina el sistema según cuál hash coincidió,
-- nunca se le pregunta al cajero.
ALTER TABLE caja_sesiones
  ADD COLUMN diferencia_autorizada_via TEXT
    CHECK (
      (diferencia_autorizada_via IS NULL AND diferencia_autorizada_por IS NULL)
      OR (diferencia_autorizada_via IN ('presencial', 'remoto')
          AND diferencia_autorizada_por IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_autorizadas
  ON caja_sesiones (diferencia_autorizada_por)
  WHERE diferencia_autorizada_por IS NOT NULL;
