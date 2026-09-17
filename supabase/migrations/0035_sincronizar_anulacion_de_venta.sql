-- ===========================================================================
-- 0035_sincronizar_anulacion_de_venta.sql — La puerta de la anulación de una venta.
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL a propósito** (dirección 2 del README): es una función que
-- corre en Postgres, con `auth.jwt()` y RLS. El `035` local queda reservado.
--
-- Diseño aprobado: `docs/ANULACION-DE-VENTA.md` §7. Exige la `0033`.
--
-- ---------------------------------------------------------------------------
-- EL LOTE QUE RECIBE (§7.1), en este orden y nada más
-- ---------------------------------------------------------------------------
--   anulaciones_de_venta   insertar     una, primera
--   productos              actualizar   uno por producto de la venta
--   auditoria_log          insertar     exactamente un asiento venta_anulada
--
-- **Nunca trae `ventas`**, y esta función no la escribe: en la nube `ventas`
-- sigue siendo de solo inserción. Si la terminal la mandara, `escribir_fila`
-- con `ignorar` la perdería en silencio como `ya_existia` (§0.2 del diseño),
-- así que se rechaza por nombre, como cualquier tabla fuera de la lista.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UNA FUNCIÓN NUEVA (§7.2)
-- ---------------------------------------------------------------------------
-- `sincronizar_asiento` solo admite `auditoria_log`, y `sincronizar_venta`
-- exige una venta nueva. Ampliar cualquiera les quitaría lo que las hace
-- seguras. Esta tiene el mismo endurecimiento de §1.5.1:
--   · SECURITY DEFINER con `search_path = ''`, y nombres calificados;
--   · el rol `terminal`, no anónimo, en la primera línea;
--   · REVOKE de PUBLIC y anon, GRANT solo a authenticated;
--   · lista cerrada de tablas, con la regla de conflicto escrita por tabla;
--   · ningún EXECUTE con texto del lote: escribe con `escribir_fila`.
--
-- ---------------------------------------------------------------------------
-- LO QUE COMPRUEBA ANTES DE ESCRIBIR UNA SOLA FILA (§7.3)
-- ---------------------------------------------------------------------------
--   1. El rol, la versión de contrato y que el lote sea una lista no vacía.
--   2. La forma exacta de arriba.
--   3. Que la venta exista en la nube. Si no, lo dice con esas palabras en vez
--      de dejar salir un 23503 crudo: el caso real es un lote de venta saltado
--      a mano (CLAUDE.md §4.34).
--   4. Si la venta ya tiene una anulación: con el mismo id y el mismo
--      contenido es un reintento; con otro id o con otro contenido, se rechaza.
--   5. Que la caja de la venta esté ABIERTA en la nube. Solo si la anulación
--      todavía no existía: un reintento no se rechaza porque la caja se cerró
--      después. El orden de la cola garantiza que el cierre sube después.
--   6. Que los productos del lote sean EXACTAMENTE los de las líneas de esa
--      venta en la nube: nadie reescribe otro producto por esta puerta.
--
-- No comprueba el PIN, los montos ni la aritmética del inventario: no ve el
-- PIN, y las funciones no calculan nada de negocio (§9.1 de SINCRONIZACION.md).
--
-- **Todo o nada**: la función es una sola transacción. Si cualquier escritura
-- falla —un CHECK, una llave foránea—, no queda ni la anulación, ni los
-- productos, ni el asiento.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO CAMBIA
-- ---------------------------------------------------------------------------
-- La versión de contrato NO sube: es una puerta nueva y ninguna existente
-- cambia de forma, igual que la 0027. Y el contrato se reemplaza para que la
-- conozca, con el cuerpo de la 0033 y un nombre más.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.sincronizar_anulacion_de_venta(lote jsonb, version_de_contrato integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cambio jsonb;
  posicion integer := 0;
  constancias jsonb := '[]'::jsonb;
  anulacion jsonb;
  asiento jsonb;
  productos_del_lote text[] := ARRAY[]::text[];
  productos_ordenados text[];
  productos_de_la_venta text[];
  existe_la_venta boolean;
  estado_de_la_caja text;
  existente_por_id jsonb;
  existente_por_venta jsonb;
  propuesta jsonb;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'terminal'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo la terminal puede sincronizar la anulación de una venta' USING ERRCODE = '42501';
  END IF;
  IF version_de_contrato IS DISTINCT FROM public.version_del_contrato_de_sincronizacion() THEN
    RAISE EXCEPTION 'CONTRATO: la terminal manda la versión % y la nube declara la %',
      version_de_contrato, public.version_del_contrato_de_sincronizacion();
  END IF;
  IF lote IS NULL OR jsonb_typeof(lote) <> 'array' OR jsonb_array_length(lote) = 0 THEN
    RAISE EXCEPTION 'CONTRATO: el lote tiene que ser una lista con al menos un cambio';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. La forma. Esta vuelta NO escribe nada: solo lee el lote.
  -- -------------------------------------------------------------------------
  FOR cambio IN SELECT value FROM jsonb_array_elements(lote) LOOP
    posicion := posicion + 1;
    PERFORM public.exigir_forma_del_cambio(cambio, posicion);

    CASE cambio ->> 'tabla'
      WHEN 'anulaciones_de_venta' THEN
        IF posicion <> 1 THEN
          RAISE EXCEPTION 'FORMA: la fila de anulaciones_de_venta va primera y es una sola';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: anulaciones_de_venta solo se inserta';
        END IF;
        anulacion := cambio -> 'datos';

      WHEN 'productos' THEN
        IF anulacion IS NULL THEN
          RAISE EXCEPTION 'FORMA: los productos no pueden ir antes que la anulación';
        END IF;
        IF asiento IS NOT NULL THEN
          RAISE EXCEPTION 'FORMA: los productos van antes que el asiento de auditoría';
        END IF;
        IF (cambio ->> 'operacion') <> 'actualizar' THEN
          RAISE EXCEPTION 'FORMA: en una anulación los productos se actualizan, no se insertan';
        END IF;
        IF (cambio -> 'datos' ->> 'id') = ANY (productos_del_lote) THEN
          RAISE EXCEPTION 'FORMA: el producto % viene dos veces en el lote', cambio -> 'datos' ->> 'id';
        END IF;
        productos_del_lote := productos_del_lote || (cambio -> 'datos' ->> 'id');

      WHEN 'auditoria_log' THEN
        IF anulacion IS NULL THEN
          RAISE EXCEPTION 'FORMA: el asiento de auditoría no puede ir antes que la anulación';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: auditoria_log solo se inserta';
        END IF;
        IF asiento IS NOT NULL THEN
          RAISE EXCEPTION 'FORMA: una anulación lleva exactamente un asiento de auditoría';
        END IF;
        asiento := cambio -> 'datos';
        IF (asiento ->> 'accion') IS DISTINCT FROM 'venta_anulada'
           OR (asiento ->> 'entidad_tipo') IS DISTINCT FROM 'ventas' THEN
          RAISE EXCEPTION 'FORMA: el asiento de una anulación es venta_anulada sobre ventas, no % sobre %',
            asiento ->> 'accion', asiento ->> 'entidad_tipo';
        END IF;
        IF (asiento ->> 'entidad_id') IS DISTINCT FROM (anulacion ->> 'venta_id') THEN
          RAISE EXCEPTION 'FORMA: el asiento venta_anulada apunta a la venta % y la anulación a la venta %',
            asiento ->> 'entidad_id', anulacion ->> 'venta_id';
        END IF;

      ELSE
        RAISE EXCEPTION 'FORMA: la tabla % no forma parte de una anulación de venta', cambio ->> 'tabla';
    END CASE;
  END LOOP;

  IF anulacion IS NULL THEN
    RAISE EXCEPTION 'FORMA: el lote no trae la fila de anulaciones_de_venta';
  END IF;
  IF cardinality(productos_del_lote) = 0 THEN
    RAISE EXCEPTION 'FORMA: una anulación repone al menos un producto, y el lote no trae ninguno';
  END IF;
  IF asiento IS NULL THEN
    RAISE EXCEPTION 'FORMA: una anulación no se sincroniza sin su asiento venta_anulada';
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. La venta tiene que estar en la nube.
  -- -------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.ventas v WHERE v.id::text = anulacion ->> 'venta_id')
    INTO existe_la_venta;
  IF NOT existe_la_venta THEN
    RAISE EXCEPTION 'FORMA: la venta % no está en la nube; una anulación no puede subir sin su venta',
      anulacion ->> 'venta_id';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. ¿Ya tiene una anulación? El mismo id con el mismo contenido es un
  --    reintento; cualquier otra cosa se rechaza. «Mismo contenido» se decide
  --    como en la 0023: la fila TIPADA del payload contra la guardada, sin
  --    recibido_en.
  -- -------------------------------------------------------------------------
  SELECT to_jsonb(a) INTO existente_por_venta
    FROM public.anulaciones_de_venta a WHERE a.venta_id::text = anulacion ->> 'venta_id';
  IF existente_por_venta IS NOT NULL
     AND (existente_por_venta ->> 'id') IS DISTINCT FROM (anulacion ->> 'id') THEN
    RAISE EXCEPTION 'FORMA: la venta % ya tiene otra anulación en la nube; una venta se anula una sola vez',
      anulacion ->> 'venta_id';
  END IF;

  SELECT to_jsonb(a) INTO existente_por_id
    FROM public.anulaciones_de_venta a WHERE a.id::text = anulacion ->> 'id';
  IF existente_por_id IS NOT NULL THEN
    PERFORM public.exigir_claves_conocidas('public.anulaciones_de_venta'::regclass, anulacion);
    SELECT to_jsonb(r) INTO propuesta
      FROM jsonb_populate_record(NULL::public.anulaciones_de_venta, anulacion) AS r;
    IF public.huella_de_fila(propuesta) <> public.huella_de_fila(existente_por_id) THEN
      RAISE EXCEPTION 'FORMA: la anulación % ya existe en la nube con otro contenido; una anulación no se reescribe',
        anulacion ->> 'id';
    END IF;
  ELSE
    -- -----------------------------------------------------------------------
    -- 5. Solo si es nueva: la caja de la venta tiene que estar abierta.
    -- -----------------------------------------------------------------------
    SELECT c.estado INTO estado_de_la_caja
      FROM public.ventas v
      JOIN public.caja_sesiones c ON c.id = v.caja_sesion_id
     WHERE v.id::text = anulacion ->> 'venta_id';
    IF estado_de_la_caja IS DISTINCT FROM 'abierta' THEN
      RAISE EXCEPTION 'FORMA: la caja de la venta % está % en la nube; solo se anula una venta de la caja abierta',
        anulacion ->> 'venta_id', coalesce(estado_de_la_caja, 'sin registrar');
    END IF;
  END IF;

  -- -------------------------------------------------------------------------
  -- 6. Los productos del lote son exactamente los de las líneas de la venta.
  -- -------------------------------------------------------------------------
  SELECT coalesce(array_agg(DISTINCT d.producto_id::text ORDER BY d.producto_id::text), ARRAY[]::text[])
    INTO productos_de_la_venta
    FROM public.venta_detalle d WHERE d.venta_id::text = anulacion ->> 'venta_id';
  SELECT coalesce(array_agg(p ORDER BY p), ARRAY[]::text[])
    INTO productos_ordenados
    FROM unnest(productos_del_lote) AS p;
  IF productos_ordenados IS DISTINCT FROM productos_de_la_venta THEN
    RAISE EXCEPTION 'FORMA: los productos del lote (%) no son los de las líneas de la venta % en la nube (%)',
      array_to_string(productos_ordenados, ', '), anulacion ->> 'venta_id', array_to_string(productos_de_la_venta, ', ');
  END IF;

  -- -------------------------------------------------------------------------
  -- 7. Recién ahora se escribe, en el orden del lote. La regla por tabla:
  --    la anulación y el asiento con `ignorar` (sus triggers abortarían un
  --    DO UPDATE); los productos con `actualizar` (la terminal es el único
  --    escritor y la cola es FIFO: la última fila es el estado correcto).
  -- -------------------------------------------------------------------------
  FOR cambio IN SELECT value FROM jsonb_array_elements(lote) LOOP
    CASE cambio ->> 'tabla'
      WHEN 'anulaciones_de_venta' THEN
        constancias := constancias || public.escribir_fila('public.anulaciones_de_venta'::regclass, cambio -> 'datos', 'ignorar');
      WHEN 'productos' THEN
        constancias := constancias || public.escribir_fila('public.productos'::regclass, cambio -> 'datos', 'actualizar');
      WHEN 'auditoria_log' THEN
        constancias := constancias || public.escribir_fila('public.auditoria_log'::regclass, cambio -> 'datos', 'ignorar');
      ELSE
        RAISE EXCEPTION 'PROGRAMACION: la tabla % pasó la comprobación de forma y no tiene regla de escritura', cambio ->> 'tabla';
    END CASE;
  END LOOP;

  RETURN jsonb_build_object('funcion', 'sincronizar_anulacion_de_venta',
                            'contrato', public.version_del_contrato_de_sincronizacion(),
                            'filas', constancias);
END $$;

REVOKE ALL ON FUNCTION public.sincronizar_anulacion_de_venta(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_anulacion_de_venta(jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.sincronizar_anulacion_de_venta(jsonb, integer) IS 'SECURITY DEFINER. La anulación de una venta de la caja abierta: la fila de anulaciones_de_venta, los productos de esa venta y su asiento venta_anulada, en una transacción. Nunca escribe ventas. Solo rol terminal.';

-- ---------------------------------------------------------------------------
-- El contrato, con la función nueva en su lista. Cuerpo idéntico al de la 0033.
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
                           'anulaciones_de_venta_es_inmutable', 'sincronizar_anulacion_de_venta')
    ) f;

  RETURN jsonb_build_object(
    'version_del_contrato', public.version_del_contrato_de_sincronizacion(),
    'tablas', tablas,
    'funciones', funciones
  );
END $$;
