-- ===========================================================================
-- 0027_sincronizar_asiento.sql — La puerta que faltaba: un asiento SUELTO.
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL a propósito** (dirección 2 del README): es una función que
-- corre en Postgres, con `auth.jwt()` y RLS. En SQLite no existe nada de eso.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ HACE FALTA, Y CÓMO SE DESCUBRIÓ
-- ---------------------------------------------------------------------------
-- Las cinco funciones de la `0023` cubren los cinco lotes que la terminal sabía
-- armar en ese momento, y **las cinco exigen una fila principal de negocio**:
-- un usuario, una caja, una venta o una fila de catálogo. Los asientos de
-- auditoría van siempre DETRÁS de ella.
--
-- Hay hechos del negocio que **no tienen fila principal**, y por eso no tenían
-- puerta:
--
--   · `usuario_bloqueado` e `ingreso_fallido`   — el contador de intentos es
--     estado local (§4.4) y no viaja: lo único que viaja es el asiento.
--   · `autorizacion_bloqueada`                  — el candado por superficie
--     vive solo en SQLite (§4.8).
--   · `salida_controlada_autorizada` / `_rechazada` — no hay entidad: el hecho
--     es sobre la aplicación.
--
-- **§4.8 de CLAUDE.md afirmaba desde siempre que estos hechos «sí viajan».**
-- No viajaban: se escribían fuera de la bandeja de salida y nunca se
-- encolaban. Al corregir eso en la fase 3.b empezaron a encolarse, y ahí se vio
-- lo que faltaba del otro lado. Medido contra `pos-pruebas-descartable`:
--
--   sincronizar_lote_simple -> HTTP 400
--   {"code":"P0001","message":"FORMA: la tabla auditoria_log no se sincroniza
--                              como lote simple"}
--   ciclo: cola_detenida
--
-- Es decir: sin esta función, **un ingreso fallido en la caja detendría toda la
-- sincronización de la tienda**. Peor que el defecto original, que al menos era
-- silencioso.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UNA FUNCIÓN NUEVA Y NO AMPLIAR `sincronizar_lote_simple`
-- ---------------------------------------------------------------------------
-- Sería una línea: agregar `auditoria_log` al `CASE` de la fila principal. Y
-- sería un error, porque ese `CASE` es lo que hace que **la fila principal sea
-- de negocio y el asiento la acompañe**. Con `auditoria_log` admitido ahí, un
-- lote de catálogo mal armado —el asiento primero, la categoría después—
-- pasaría en vez de rechazarse, y se perdería la comprobación de orden que
-- §2.4 del diseño existe para sostener.
--
-- Una función aparte dice en su nombre lo que acepta, y su lista cerrada tiene
-- **un solo elemento**.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO CAMBIA
-- ---------------------------------------------------------------------------
--   · `auditoria_log` se escribe **siempre con `ignorar`**, igual que en las
--     cinco de la `0023`: su trigger `auditoria_log_prohibir_cambios` abortaría
--     cualquier `DO UPDATE`, aunque los valores fueran idénticos.
--   · `SECURITY DEFINER` con `search_path = ''`, `REVOKE` de `public` y `anon`,
--     `GRANT` solo a `authenticated`, y el rol `terminal` comprobado en la
--     primera línea. El mismo endurecimiento de §1.5.1 que las otras cinco.
--   · La versión de contrato **no sube**: esta función AGREGA una puerta y no
--     cambia ninguna existente, así que una terminal vieja sigue funcionando
--     contra esta nube igual que antes. Subir la versión obligaría a actualizar
--     todas las terminales para nada.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.sincronizar_asiento(lote jsonb, version_de_contrato integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cambio jsonb;
  posicion integer := 0;
  constancias jsonb := '[]'::jsonb;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'terminal'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo la terminal puede sincronizar asientos' USING ERRCODE = '42501';
  END IF;
  IF version_de_contrato IS DISTINCT FROM public.version_del_contrato_de_sincronizacion() THEN
    RAISE EXCEPTION 'CONTRATO: la terminal manda la versión % y la nube declara la %',
      version_de_contrato, public.version_del_contrato_de_sincronizacion();
  END IF;
  IF lote IS NULL OR jsonb_typeof(lote) <> 'array' OR jsonb_array_length(lote) = 0 THEN
    RAISE EXCEPTION 'CONTRATO: el lote tiene que ser una lista con al menos un cambio';
  END IF;

  FOR cambio IN SELECT value FROM jsonb_array_elements(lote) LOOP
    posicion := posicion + 1;
    PERFORM public.exigir_forma_del_cambio(cambio, posicion);

    -- LISTA CERRADA DE UN SOLO ELEMENTO. Cualquier otra tabla acá sería un lote
    -- que le corresponde a otra función, y mandarlo por esta se saltearía las
    -- reglas de negocio que esa otra comprueba.
    IF (cambio ->> 'tabla') <> 'auditoria_log' THEN
      RAISE EXCEPTION 'FORMA: esta función solo sincroniza asientos de auditoría, no %',
        cambio ->> 'tabla';
    END IF;
    IF (cambio ->> 'operacion') <> 'insertar' THEN
      RAISE EXCEPTION 'FORMA: auditoria_log solo se inserta';
    END IF;

    constancias := constancias || public.escribir_fila('public.auditoria_log'::regclass, cambio -> 'datos', 'ignorar');
  END LOOP;

  RETURN jsonb_build_object('funcion', 'sincronizar_asiento',
                            'contrato', public.version_del_contrato_de_sincronizacion(),
                            'filas', constancias);
END $$;

REVOKE ALL ON FUNCTION public.sincronizar_asiento(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_asiento(jsonb, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Y la lista fija del contrato tiene que conocerla, o la prueba de deriva no la ve
-- ---------------------------------------------------------------------------
-- `contrato_de_sincronizacion()` enumera las funciones por NOMBRE, con un
-- `proname IN (...)` literal. Es deliberado —así declara solo lo que forma
-- parte del contrato y no cualquier función que aparezca en `public`— pero
-- tiene una consecuencia que hay que atender en cada función nueva: **si no se
-- agrega acá, la prueba de deriva no la ve.**
--
-- Se comprobó midiendo: tras crear `sincronizar_asiento`, la foto seguía
-- diciendo «13 funciones» y `npm run verify:nube` pasaba en verde con una
-- función que nadie estaba vigilando. Por eso la 0027 REEMPLAZA también esta
-- función, con el nombre nuevo en la lista.
--
-- La versión de contrato NO sube: agregar una puerta no rompe a ninguna
-- terminal vieja.
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
                           'contrato_de_sincronizacion',
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
