-- ===========================================================================
-- 0017_descuento_autorizado_via.sql — Espejo en Postgres de la migración 017
-- ===========================================================================
--
-- Cómo se autorizó un descuento que pasaba el tope del rol: presencial, con el
-- PIN normal frente a la pantalla, o remoto, con el PIN dictado por teléfono.
-- SÍ se espeja: es dato de negocio y es exactamente lo que un auditor va a
-- querer cruzar con `descuento_autorizado_por`.
--
-- Hasta el 2026-09-11 la pregunta no tenía sentido, porque la superficie
-- `descuento_excedente` solo aceptaba el PIN normal. Julio decidió
-- explícitamente ese día que también acepte el remoto, y desde entonces las dos
-- vías son posibles.
--
-- Es el mismo par de columnas que `caja_sesiones.diferencia_autorizada_*` de la
-- migración 0007.
--
-- ---------------------------------------------------------------------------
-- EL CHECK NO COPIA LITERALMENTE EL DE LA 0007, Y ES A PROPÓSITO
-- ---------------------------------------------------------------------------
-- La 0007 escribió la coherencia como
-- `(via IS NULL AND por IS NULL) OR (via IN (...) AND por IS NOT NULL)`, y esa
-- forma **no rechaza un autorizante sin vía**: con `via` en NULL, `via IN (...)`
-- da NULL y no FALSO, la segunda rama entera da NULL, y en SQL un CHECK **pasa
-- cuando su expresión da NULL**. Vale igual en Postgres que en SQLite; se midió
-- en SQLite antes de escribir las dos migraciones.
--
-- En `caja_sesiones` el hueco lo tapa la 0008, que exige
-- `diferencia_autorizada_via IS NOT NULL` de forma explícita. Acá no hay una
-- segunda restricción que salve, así que los `IS NOT NULL` van adelante, que
-- cortocircuitan a FALSO y hacen que el CHECK muerda en las dos direcciones.
--
-- ---------------------------------------------------------------------------
-- Estado: PENDIENTE de aplicar contra `pos-jimmy-cano`.
-- ===========================================================================

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS descuento_autorizado_via TEXT;

COMMENT ON COLUMN public.ventas.descuento_autorizado_via IS
  'Cómo se autorizó el descuento excedente: presencial (PIN normal) o remoto (PIN de autorización remota). Lo determina el sistema según cuál hash coincidió, nunca se le pregunta al cajero.';

ALTER TABLE public.ventas
  DROP CONSTRAINT IF EXISTS ventas_autorizacion_de_descuento_coherente;
ALTER TABLE public.ventas
  ADD CONSTRAINT ventas_autorizacion_de_descuento_coherente CHECK (
    -- Sin autorización: las dos columnas vacías.
    (descuento_autorizado_via IS NULL AND descuento_autorizado_por IS NULL)
    OR
    -- Con autorización: las dos llenas, y la vía es una de las dos posibles.
    -- Los `IS NOT NULL` van PRIMERO; ver la explicación de la cabecera.
    (
      descuento_autorizado_via IS NOT NULL
      AND descuento_autorizado_por IS NOT NULL
      AND descuento_autorizado_via IN ('presencial', 'remoto')
    )
  );

-- Las autorizaciones de descuento son la excepción, no la regla: el índice
-- parcial solo indexa esas filas. Mismo criterio que `idx_caja_sesiones_autorizadas`.
CREATE INDEX IF NOT EXISTS idx_ventas_descuento_autorizado
  ON public.ventas (descuento_autorizado_por)
  WHERE descuento_autorizado_por IS NOT NULL;
