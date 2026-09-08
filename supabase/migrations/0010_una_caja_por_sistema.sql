-- ===========================================================================
-- 0010_una_caja_por_sistema.sql — Espejo: la caja es una, no una por persona
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/010_una_caja_por_sistema.sql.
-- SÍ se espeja: el corte de caja es dato de negocio.
--
-- El índice de la 0001 restringía por `usuario_id`, lo que permitía que dos
-- personas abrieran cada una su turno sobre el mismo cajón de dinero. La regla
-- correcta es global: como máximo una fila con estado 'abierta' en toda la
-- tabla. Se indexa `estado` bajo `WHERE estado = 'abierta'`; dentro de esa
-- condición el valor es siempre el mismo, así que la unicidad sobre esa
-- columna permite una sola fila.
-- ===========================================================================

DROP INDEX IF EXISTS public.idx_caja_sesiones_una_abierta;

CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_sesiones_una_abierta
  ON public.caja_sesiones (estado) WHERE estado = 'abierta';
