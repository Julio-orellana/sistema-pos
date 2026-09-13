-- ===========================================================================
-- 0025_politicas_de_restauracion.sql — Las políticas RLS de la fase 2.c.
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL a propósito** (dirección 2 del README): en SQLite no hay
-- RLS ni roles. No hay migración local 025.
--
-- ---------------------------------------------------------------------------
-- QUÉ CREA ESTA MIGRACIÓN, Y POR QUÉ ES UNA SOLA COSA
-- ---------------------------------------------------------------------------
-- Una política de `SELECT` para el rol `restauracion`, sobre cada una de las
-- trece tablas. **Nada más.** Para el rol `terminal` no se crea ninguna
-- política sobre ninguna tabla, y eso no es un olvido: es el resultado de la
-- medición del riesgo 8.4 en la fase 2.b.
--
-- La tabla vigente de §2.3 del diseño dice, columna por columna, «nadie» para
-- la terminal en las trece, y `R` para restauración en las trece. La versión
-- anterior de esa tabla —la que conservaba `INSERT`/`UPDATE`/`SELECT` directos
-- sobre el catálogo, decisión 14— quedó **superada** y se conserva en el
-- documento solo como historia del razonamiento. Dos motivos, los dos medidos:
--
--   1. `INSERT ... ON CONFLICT DO NOTHING` bajo RLS **exige política de
--      SELECT aunque no haya conflicto** (riesgo 8.4, medido el 2026-09-11).
--      Y todo lote de catálogo lleva su asiento de `auditoria_log`, así que un
--      camino directo habría obligado a darle a la terminal `SELECT` sobre la
--      auditoría entera: exactamente lo que §1.5 existe para impedir.
--   2. Desde la `0023`, el catálogo ya se escribe por `sincronizar_lote_simple`,
--      que escribe la fila y su asiento en la misma transacción. Conceder
--      además `UPDATE` directo crearía un SEGUNDO camino de escritura para las
--      mismas tablas, sin auditoría y sin la lista cerrada.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTO SOLO GOBIERNA `SELECT`, Y NO HACE FALTA MÁS
-- ---------------------------------------------------------------------------
-- Después de la `0024`, `authenticated` tiene UN solo privilegio de tabla:
-- `SELECT`. Un `INSERT`, `UPDATE`, `DELETE` o `TRUNCATE` de cualquier usuario
-- autenticado muere antes de llegar a RLS, con «permission denied for table».
-- Es decir: **lo único que una política todavía puede decidir es quién lee.**
-- Escribir políticas de escritura acá sería escribir reglas para un camino que
-- ya está cerrado por privilegios, y daría la falsa impresión de que ese camino
-- existe. `anon` no tiene ningún privilegio, así que la llave publicable sola
-- no llega ni a evaluar una política.
--
-- ---------------------------------------------------------------------------
-- LA CONDICIÓN, Y POR QUÉ ESTÁ ESCRITA ASÍ
-- ---------------------------------------------------------------------------
--   · `(select auth.jwt() ...)` **envuelto en `select`**: §1.2 del diseño lo
--     pide porque la documentación de Supabase mide que así Postgres lo evalúa
--     una vez por consulta y no una vez por fila.
--   · `app_metadata` y no `user_metadata`: el usuario puede editar el segundo,
--     no el primero. Es lo que hace que el rol sea una afirmación del servidor.
--   · `is_anonymous` con `coalesce(..., false)`: **la misma forma exacta que
--     usan las cinco funciones de la `0023`**. Que el criterio de identidad se
--     escriba de dos maneras distintas en el mismo sistema es la clase de
--     divergencia que este proyecto evita por regla; hay una comprobación que
--     exige que las trece políticas tengan la condición IDÉNTICA entre sí.
--   · `TO authenticated`: la política ni siquiera se evalúa para `anon`.
--   · Solo `FOR SELECT`: ver el bloque anterior.
--
-- Un usuario autenticado sin rol, o con rol `terminal`, no cumple la condición:
-- la consulta no falla, devuelve **cero filas**. Es lo correcto para un
-- `SELECT` bajo RLS y es lo que las pruebas verifican tabla por tabla.
-- ===========================================================================

-- usuarios: escribe sincronizar_usuario. Sin esta política la terminal no puede leer los hashes de PIN desde la nube, que era la mitad del riesgo 8.2.
CREATE POLICY restauracion_lee_usuarios
  ON public.usuarios
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_usuarios ON public.usuarios IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- categorias: escribe sincronizar_lote_simple.
CREATE POLICY restauracion_lee_categorias
  ON public.categorias
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_categorias ON public.categorias IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- productos: escribe sincronizar_lote_simple y sincronizar_venta.
CREATE POLICY restauracion_lee_productos
  ON public.productos
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_productos ON public.productos IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- precios_especiales: escribe sincronizar_lote_simple.
CREATE POLICY restauracion_lee_precios_especiales
  ON public.precios_especiales
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_precios_especiales ON public.precios_especiales IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- limites_descuento: escribe sincronizar_lote_simple.
CREATE POLICY restauracion_lee_limites_descuento
  ON public.limites_descuento
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_limites_descuento ON public.limites_descuento IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- configuracion_negocio: escribe sincronizar_lote_simple, y solo con la operacion actualizar.
CREATE POLICY restauracion_lee_configuracion_negocio
  ON public.configuracion_negocio
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_configuracion_negocio ON public.configuracion_negocio IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- denominaciones: escribe ninguno: las sembro la 0004 y nunca cambian. La restauracion las LEE para verificar que sean las mismas 11 antes de seguir (6.3, paso 3).
CREATE POLICY restauracion_lee_denominaciones
  ON public.denominaciones
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_denominaciones ON public.denominaciones IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- caja_sesiones: escribe sincronizar_apertura_de_caja y sincronizar_cierre_de_caja.
CREATE POLICY restauracion_lee_caja_sesiones
  ON public.caja_sesiones
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_caja_sesiones ON public.caja_sesiones IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- caja_sesion_denominaciones: escribe las dos funciones de caja; el desglose viaja dentro del lote de la caja.
CREATE POLICY restauracion_lee_caja_sesion_denominaciones
  ON public.caja_sesion_denominaciones
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_caja_sesion_denominaciones ON public.caja_sesion_denominaciones IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- ventas: escribe sincronizar_venta.
CREATE POLICY restauracion_lee_ventas
  ON public.ventas
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_ventas ON public.ventas IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- venta_detalle: escribe sincronizar_venta.
CREATE POLICY restauracion_lee_venta_detalle
  ON public.venta_detalle
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_venta_detalle ON public.venta_detalle IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- recibos: escribe sincronizar_lote_simple, y solo con la operacion insertar.
CREATE POLICY restauracion_lee_recibos
  ON public.recibos
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_recibos ON public.recibos IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';

-- auditoria_log: escribe las cinco funciones, siempre con DO NOTHING, y ademas el trigger de inmutabilidad.
CREATE POLICY restauracion_lee_auditoria_log
  ON public.auditoria_log
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_auditoria_log ON public.auditoria_log IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER de la 0023.';
