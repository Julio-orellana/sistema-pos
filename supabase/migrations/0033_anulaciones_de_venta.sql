-- ===========================================================================
-- 0033_anulaciones_de_venta.sql — Espejo de la 033 local: la anulación de una venta.
-- ===========================================================================
--
-- Diseño aprobado: `docs/ANULACION-DE-VENTA.md`, secciones 1, 7 y 9.
--
-- UNA FILA POR VENTA ANULADA. La fila de `public.ventas` NO se toca nunca, en
-- la nube tampoco: ni `estado`, ni `actualizado_en`, ni ningún monto. `ventas`
-- sigue siendo de SOLO INSERCIÓN, como la deja la 0023. La regla es una sola y
-- vale en la terminal, en la nube y en una base restaurada:
--
--     UNA VENTA ESTÁ ANULADA SI Y SOLO SI EXISTE SU FILA EN ESTA TABLA.
--
-- Esta migración NO crea la puerta por la que la terminal escribe la tabla:
-- eso es la `0035_sincronizar_anulacion_de_venta`. Sin la 0035, la tabla existe
-- y nadie la escribe.
--
-- ---------------------------------------------------------------------------
-- QUÉ CAMBIA RESPECTO DE LA 033 LOCAL, Y POR QUÉ
-- ---------------------------------------------------------------------------
--   · `TEXT` con CHECK de largo 36 → `UUID`, y la fecha `TEXT` con su LIKE →
--     `TIMESTAMPTZ`. Es la misma traducción que hizo la 0001 con las once.
--   · `recibido_en`, con el trigger de la 0019: la hora del SERVIDOR en que
--     llegó la fila. Es la marca con la que la restauración excluye una
--     anulación posterior a un robo (§8 del diseño). En SQLite no existe.
--   · Los dos disparadores de la 033 (uno para UPDATE, otro para DELETE) son
--     acá UNO, `BEFORE UPDATE OR DELETE`, con los MISMOS dos mensajes. Postgres
--     necesita una función para el trigger; se llama como la de la bitácora.
--   · RLS activo, privilegios de tabla como la 0024 y la política de lectura
--     de `restauracion` con la condición IDÉNTICA a las otras trece (0025).
--
-- ---------------------------------------------------------------------------
-- Y EL CONTRATO TIENE QUE CONOCER LA FUNCIÓN DEL TRIGGER
-- ---------------------------------------------------------------------------
-- La regla de la 0027: `contrato_de_sincronizacion()` enumera las funciones por
-- nombre, y una función que no está en esa lista no la ve la prueba de deriva.
-- `auditoria_log_es_inmutable` y `fijar_recibido_en`, las dos funciones de
-- trigger que ya existen, están en la lista. Por eso esta migración REEMPLAZA
-- el contrato con `anulaciones_de_venta_es_inmutable` agregada, y con el cuerpo
-- copiado de la 0029 sin ningún otro cambio. La tabla nueva la enumera sola:
-- el contrato lista toda tabla de `public`.
--
-- La versión de contrato NO sube: esto agrega una tabla que ninguna función
-- existente escribe, así que una terminal vieja sigue funcionando igual.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.anulaciones_de_venta (
  id              UUID        PRIMARY KEY,
  -- UNIQUE: una venta se anula una sola vez.
  venta_id        UUID        NOT NULL UNIQUE REFERENCES public.ventas (id) ON DELETE RESTRICT,
  -- Quién tenía la sesión cuando se pidió la anulación.
  solicitada_por  UUID        NOT NULL REFERENCES public.usuarios (id) ON DELETE RESTRICT,
  -- El administrador cuyo PIN coincidió. Puede ser la misma persona.
  autorizada_por  UUID        NOT NULL REFERENCES public.usuarios (id) ON DELETE RESTRICT,
  autorizada_via  TEXT        NOT NULL CHECK (autorizada_via IN ('presencial', 'remoto')),
  -- Obligatorio y hasta 200 caracteres, como en la 033.
  motivo          TEXT        NOT NULL CHECK (length(btrim(motivo)) > 0 AND length(motivo) <= 200),
  fecha           TIMESTAMPTZ NOT NULL,
  -- La pone el servidor con el trigger de abajo, nunca la terminal (0019).
  recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.anulaciones_de_venta IS
  'Una fila por venta anulada. Una venta está anulada si y solo si existe su fila acá; ventas.estado no se toca. Inmutable por trigger. La escribe solo sincronizar_anulacion_de_venta (0035).';
COMMENT ON COLUMN public.anulaciones_de_venta.solicitada_por IS
  'Quién tenía la sesión en la terminal cuando se pidió la anulación.';
COMMENT ON COLUMN public.anulaciones_de_venta.autorizada_por IS
  'El administrador cuyo PIN autorizó la anulación. Puede ser la misma persona que la pidió.';
COMMENT ON COLUMN public.anulaciones_de_venta.recibido_en IS
  'Hora del SERVIDOR en que llegó la fila (0019). La restauración excluye una anulación posterior a un robo por esta marca.';

-- El comentario es la ÚNICA cosa que esta migración le hace a `ventas`: la
-- columna, su CHECK y sus filas quedan exactamente como estaban.
COMMENT ON COLUMN public.ventas.estado IS
  'Queda en completada también en una venta anulada: la nube solo inserta ventas. Lo que anula una venta es su fila en anulaciones_de_venta, y ninguna consulta decide por esta columna.';

-- ---------------------------------------------------------------------------
-- 2. Inmutable, como la bitácora
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.anulaciones_de_venta_es_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una anulación de venta no se puede borrar.';
  END IF;
  RAISE EXCEPTION 'Una anulación de venta no se puede modificar.';
END;
$$;

COMMENT ON FUNCTION public.anulaciones_de_venta_es_inmutable() IS
  'Trigger BEFORE UPDATE OR DELETE de anulaciones_de_venta: una anulación no se modifica ni se borra. Los mismos mensajes que los dos disparadores de la 033 local.';

DROP TRIGGER IF EXISTS anulaciones_de_venta_prohibir_cambios ON public.anulaciones_de_venta;
CREATE TRIGGER anulaciones_de_venta_prohibir_cambios
  BEFORE UPDATE OR DELETE ON public.anulaciones_de_venta
  FOR EACH ROW EXECUTE FUNCTION public.anulaciones_de_venta_es_inmutable();

-- ---------------------------------------------------------------------------
-- 3. recibido_en con el reloj del servidor (0019)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS anulaciones_de_venta_fijar_recibido_en ON public.anulaciones_de_venta;
CREATE TRIGGER anulaciones_de_venta_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.anulaciones_de_venta
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- ---------------------------------------------------------------------------
-- 4. Acceso: RLS, privilegios de tabla (0024) y la lectura de restauración (0025)
-- ---------------------------------------------------------------------------

ALTER TABLE public.anulaciones_de_venta ENABLE ROW LEVEL SECURITY;

-- Explícito aunque la 0024 cambió los privilegios por omisión de `postgres`:
-- así no depende de qué rol ejecute esta migración.
REVOKE ALL ON TABLE public.anulaciones_de_venta FROM anon;
REVOKE ALL ON TABLE public.anulaciones_de_venta FROM authenticated;
GRANT SELECT ON TABLE public.anulaciones_de_venta TO authenticated;

-- anulaciones_de_venta: escribe sincronizar_anulacion_de_venta (0035).
CREATE POLICY restauracion_lee_anulaciones_de_venta
  ON public.anulaciones_de_venta
  FOR SELECT
  TO authenticated
  USING (
    (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

COMMENT ON POLICY restauracion_lee_anulaciones_de_venta ON public.anulaciones_de_venta IS
  'Solo el rol restauracion lee esta tabla. La terminal no tiene ninguna politica sobre ninguna tabla: escribe por las funciones SECURITY DEFINER.';

-- ---------------------------------------------------------------------------
-- 5. El contrato, con la función del trigger en su lista. Cuerpo idéntico al de la 0029.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contrato_de_sincronizacion()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  tablas jsonb;
  funciones jsonb;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'restauracion'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo el rol de restauración puede leer el contrato' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_object_agg(t.relname, t.columnas ORDER BY t.relname) INTO tablas
    FROM (
      SELECT c.relname,
             jsonb_agg(jsonb_build_object(
               'nombre', a.attname,
               'tipo', format_type(a.atttypid, a.atttypmod),
               'nulable', NOT a.attnotnull
             ) ORDER BY a.attnum) AS columnas
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       GROUP BY c.relname
    ) t;

  SELECT jsonb_object_agg(f.proname, f.def ORDER BY f.proname) INTO funciones
    FROM (
      SELECT p.proname,
             jsonb_build_object(
               'security_definer', p.prosecdef,
               'search_path', p.proconfig,
               'argumentos', pg_get_function_identity_arguments(p.oid),
               'devuelve', format_type(p.prorettype, NULL)
             ) AS def
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('sincronizar_usuario', 'sincronizar_apertura_de_caja',
                           'sincronizar_cierre_de_caja', 'sincronizar_venta',
                           'sincronizar_lote_simple', 'sincronizar_asiento',
                           'contrato_de_sincronizacion', 'restauracion_ventas_por_mes',
                           'escribir_fila', 'exigir_claves_conocidas', 'huella_de_fila',
                           'exigir_forma_del_cambio', 'fijar_recibido_en',
                           'auditoria_log_es_inmutable', 'version_del_contrato_de_sincronizacion',
                           'anulaciones_de_venta_es_inmutable')
    ) f;

  RETURN jsonb_build_object(
    'version_del_contrato', public.version_del_contrato_de_sincronizacion(),
    'tablas', tablas,
    'funciones', funciones
  );
END $$;
