-- ===========================================================================
-- 0029_restauracion_ventas_por_mes.sql — La suma de control de la restauración.
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL a propósito** (dirección 2 del README): es una función
-- que corre en Postgres con `auth.jwt()`. En SQLite no existe nada de eso, y
-- la mitad local de esta comprobación la hace la aplicación con Decimal.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE, Y POR QUÉ EN POSTGRES
-- ---------------------------------------------------------------------------
-- §6.4 del diseño: al terminar de bajar `ventas`, la terminal compara «la
-- suma de `total` por mes, calculada en la nube con SUM sobre NUMERIC (que
-- allá sí es exacto) y localmente con `sumarLista` de Decimal». Tienen que
-- coincidir al centavo; si no, la restauración no se da por buena aunque el
-- conteo de filas cuadre.
--
-- Esta función es la mitad de la nube. Suma en Postgres, donde `NUMERIC` es
-- decimal exacto nativo (CLAUDE.md §5), y devuelve la suma **como texto**:
-- serializada como número JSON pasaría por un `double` en PostgREST, que es
-- exactamente lo que la comparación quiere evitar.
--
-- **El mes se corta en UTC, de los dos lados por igual.** Es una suma de
-- CONTROL, no un reporte: lo único que importa es que la nube y la terminal
-- agrupen las mismas ventas bajo la misma clave. El reporte de ventas (§4.15
-- de CLAUDE.md) sigue cortando el día en hora de Guatemala; esto no lo toca.
--
-- Suma TODAS las ventas, completadas y anuladas: la restauración baja todas,
-- así que la suma de control cubre todas.
--
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, Y SOLO PARA EL ROL DE RESTAURACIÓN
-- ---------------------------------------------------------------------------
-- Lee `public.ventas` bajo RLS, como cualquier `SELECT` de la restauración:
-- la política `restauracion_lee_ventas` (0025) es la que decide qué ve. No
-- necesita pasar por encima de nada, así que NO es DEFINER —una función
-- DEFINER menos es un aviso menos del linter y una superficie menos que
-- cuidar, el mismo criterio que `contrato_de_sincronizacion`—. La comprobación
-- del rol en la primera línea es la misma de esa función: la terminal, que
-- comparte el rol de Postgres, recibe `42501` y no una lista vacía.
--
-- ---------------------------------------------------------------------------
-- Y EL CONTRATO TIENE QUE CONOCERLA, O LA PRUEBA DE DERIVA NO LA VE
-- ---------------------------------------------------------------------------
-- La regla que dejó escrita la 0027: `contrato_de_sincronizacion()` enumera
-- por nombre, así que agregar una función es también agregarla a esa lista.
-- Por eso esta migración REEMPLAZA el contrato con el nombre nuevo, con el
-- cuerpo copiado de la 0027 sin otro cambio. La versión de contrato NO sube:
-- esto agrega una lectura y no cambia ninguna puerta de escritura.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.restauracion_ventas_por_mes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  resultado jsonb;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'restauracion'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo el rol de restauración puede sumar las ventas' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object('mes', m.mes, 'ventas', m.ventas, 'total', m.total::text)
             ORDER BY m.mes
           ),
           '[]'::jsonb
         )
    INTO resultado
    FROM (
      SELECT to_char(v.fecha AT TIME ZONE 'UTC', 'YYYY-MM') AS mes,
             count(*)                                        AS ventas,
             sum(v.total)                                    AS total
        FROM public.ventas v
       GROUP BY 1
    ) m;

  RETURN resultado;
END $$;

COMMENT ON FUNCTION public.restauracion_ventas_por_mes() IS
  'Suma de control de la restauracion (diseno 6.4): total de ventas por mes UTC, sumado con NUMERIC y devuelto como texto. Solo rol restauracion.';

REVOKE ALL ON FUNCTION public.restauracion_ventas_por_mes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restauracion_ventas_por_mes() TO authenticated;

-- ---------------------------------------------------------------------------
-- El contrato, con el nombre nuevo en su lista. Cuerpo idéntico al de la 0027.
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
                           'auditoria_log_es_inmutable', 'version_del_contrato_de_sincronizacion')
    ) f;

  RETURN jsonb_build_object(
    'version_del_contrato', public.version_del_contrato_de_sincronizacion(),
    'tablas', tablas,
    'funciones', funciones
  );
END $$;
