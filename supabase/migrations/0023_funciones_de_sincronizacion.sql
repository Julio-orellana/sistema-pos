-- ===========================================================================
-- 0023_funciones_de_sincronizacion.sql — Las puertas por las que escribe la
-- terminal. Fase 2.b de la sincronización.
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL a propósito** (dirección 2 del README): en SQLite no hay
-- funciones de este tipo ni hace falta. No hay migración local 023.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ TODO LOTE SUBE POR FUNCIÓN, Y NO SOLO LOS DE USUARIO Y CAJA
-- ---------------------------------------------------------------------------
-- El diseño (`docs/SINCRONIZACION.md` §1.5.1 y §4.3) preveía funciones solo
-- para usuarios y caja, y upserts directos para lo demás, apoyados en
-- `ON CONFLICT DO NOTHING` para las tablas de solo inserción. **El riesgo 8.4
-- se midió el 2026-09-11 y la premisa era falsa**: bajo RLS, `ON CONFLICT DO
-- NOTHING` exige política de `SELECT`, y falla **aunque no haya conflicto**.
-- Medido en Postgres directo como `authenticated` con los claims de la
-- terminal, y confirmado por PostgREST. Ver CLAUDE.md §4.19.
--
-- Darle `SELECT` a la terminal sobre `ventas`, `venta_detalle`, `recibos` y
-- `auditoria_log` es exactamente lo que §1.5 evita: con la credencial robada,
-- el ladrón leería las ventas y toda la auditoría. La salida, prevista por el
-- propio 8.4 para este caso, es que **todo lote suba por una función
-- SECURITY DEFINER con la forma exacta de su operación**, y que la terminal no
-- tenga política directa sobre ninguna tabla. Julio lo aprobó ese mismo día.
--
-- Son cinco funciones de escritura y una de lectura:
--
--   sincronizar_usuario            usuarios → auditoria_log
--   sincronizar_apertura_de_caja   caja_sesiones → desglose → auditoria_log
--   sincronizar_cierre_de_caja     caja_sesiones (abierta→cerrada) → desglose → auditoria_log
--   sincronizar_venta              productos → ventas → venta_detalle → auditoria_log
--   sincronizar_lote_simple        UNA fila de catálogo, configuración o recibo → auditoria_log
--   contrato_de_sincronizacion     lo que la nube declara tener (solo rol restauracion)
--
-- ---------------------------------------------------------------------------
-- LAS TRES REGLAS DE §9.1, QUE ACOTAN LO QUE PUEDE DERIVAR
-- ---------------------------------------------------------------------------
--   1. **No calculan nada de negocio.** Reciben valores finales, ya calculados
--      por el servicio local con Decimal, y los escriben. Lo único que deciden
--      es estructural: orden, ON CONFLICT, una transición, un invariante.
--   2. **No enumeran columnas.** Escriben con `jsonb_populate_record`, que lee
--      la definición real de la tabla al ejecutar. Y como eso ignora en
--      silencio una clave que la tabla no tiene, `exigir_claves_conocidas`
--      exige que las claves del payload sean EXACTAMENTE las columnas de la
--      tabla (menos `recibido_en`): una columna de más o de menos es un error
--      determinístico, con nombre, que detiene la cola y se ve.
--   3. **Cada función lleva número de versión de contrato**, y el lote trae el
--      que la terminal espera. Si no coinciden, falla diciendo los dos.
--
-- ---------------------------------------------------------------------------
-- EL ENDURECIMIENTO DE §1.5.1, PUNTO POR PUNTO, EN CADA FUNCIÓN
-- ---------------------------------------------------------------------------
--   · `SET search_path = ''`: nada sin calificar puede resolverse hacia otro
--     esquema. Las tablas y las funciones propias van como `public.x` y
--     `auth.jwt()`. Las funciones incorporadas (`jsonb_*`, `coalesce`,
--     `count`, `format`, `md5`…) viven en `pg_catalog`, que Postgres busca
--     SIEMPRE antes que cualquier camino, aun con el camino vacío; por eso no
--     hace falta prefijarlas y no se prefijan.
--   · `REVOKE` de `public` y `anon`, `GRANT EXECUTE` solo a `authenticated`.
--     Los ayudantes internos se revocan además a `authenticated`: solo el
--     dueño, desde dentro de las funciones DEFINER, puede llamarlos.
--   · **La primera línea ejecutable comprueba `app_metadata.rol`**, y falla
--     con `42501` (que PostgREST traduce a 403) si no es la que corresponde.
--     Se exige además `is_anonymous = false` (§1.2).
--   · **Nunca `EXECUTE` con texto armado desde el payload.** El único
--     `EXECUTE` del archivo está en `escribir_fila`, y su texto se arma con
--     identificadores leídos de `pg_catalog` y citados con `%I`; el payload
--     entra únicamente como parámetro (`USING`). Ni un byte del payload toca
--     el texto SQL.
--   · **Lista cerrada de tablas admitidas, por función**: un `CASE` sobre
--     nombres literales. Una tabla que no esté en la lista de esa función se
--     rechaza por nombre. No hay ruta genérica.
--
-- ---------------------------------------------------------------------------
-- `auditoria_log` ES SIEMPRE `DO NOTHING`, NUNCA `DO UPDATE`
-- ---------------------------------------------------------------------------
-- Su trigger `auditoria_log_prohibir_cambios` es `BEFORE UPDATE OR DELETE` y
-- lanza excepción: un `ON CONFLICT DO UPDATE` sobre un asiento que ya existe
-- —aunque los valores fueran idénticos— dispararía el trigger y abortaría el
-- LOTE ENTERO. Por eso `escribir_fila` no tiene una regla genérica de upsert:
-- recibe explícitamente qué hacer si la fila existe, y quien llama decide POR
-- TABLA. Es la misma razón que §3.1 del diseño ya daba para el upsert directo.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCIA Y RECHAZOS, RECONCILIADOS
-- ---------------------------------------------------------------------------
-- §1.5.1 dice que apertura rechaza «una caja que ya exista» y cierre «cerrar
-- una caja ya cerrada». §3.1 dice que repetir un lote —porque la respuesta
-- 2xx se perdió— tiene que dar el mismo estado, no un error. Las dos cosas se
-- cumplen así: **repetir el MISMO lote es un no-op que devuelve `sin_cambios`;
-- mandar OTRO lote con el mismo id se rechaza.** «Mismo» se decide comparando
-- la fila tipada del payload con la fila guardada, sin `recibido_en`.
--
-- Las funciones devuelven un RECIBO en jsonb: qué pasó con cada fila
-- (`insertada` | `actualizada` | `ya_existia` | `sin_cambios`), su `huella`
-- —md5 de la fila guardada sin `recibido_en`— y su `recibido_en`. Con eso, la
-- terminal y las pruebas pueden afirmar sobre el estado sin leer las tablas,
-- que es justamente lo que la terminal no puede hacer.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. El número de contrato. Uno solo, para todas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.version_del_contrato_de_sincronizacion()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT 1 $$;

COMMENT ON FUNCTION public.version_del_contrato_de_sincronizacion() IS
  'Versión del contrato entre la terminal y las funciones de sincronización. Subirla obliga a subir la constante local: si no coinciden, cada función falla diciendo los dos números.';

REVOKE ALL ON FUNCTION public.version_del_contrato_de_sincronizacion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.version_del_contrato_de_sincronizacion() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ayudantes internos. NADIE los llama desde afuera.
-- ---------------------------------------------------------------------------

-- Falla si el payload no trae EXACTAMENTE las columnas de la tabla menos
-- `recibido_en`, o si trae `recibido_en`, que la pone el servidor. Cierra el
-- silencio de jsonb_populate_record en las dos direcciones, y el del trigger
-- de la 0019 en la tercera: pisaría sin ruido lo que viniera en el payload.
CREATE OR REPLACE FUNCTION public.exigir_claves_conocidas(destino regclass, datos jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  sobrantes text;
  faltantes text;
BEGIN
  IF datos IS NULL OR jsonb_typeof(datos) <> 'object' THEN
    RAISE EXCEPTION 'CONTRATO: los datos de % tienen que ser un objeto JSON', destino;
  END IF;

  -- Si `recibido_en` viene en el payload, algo del lado de la terminal cambió
  -- de forma. Se rechaza con nombre en vez de dejar que el trigger la pise.
  IF datos ? 'recibido_en' THEN
    RAISE EXCEPTION 'CONTRATO: el payload de % trae recibido_en, que la pone el servidor y nunca viaja', destino;
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k) INTO sobrantes
    FROM jsonb_object_keys(datos) AS k
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = destino AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped
   );
  IF sobrantes IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRATO: el payload de % trae columnas que la tabla no tiene: %', destino, sobrantes;
  END IF;

  SELECT string_agg(a.attname, ', ' ORDER BY a.attname) INTO faltantes
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = destino AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'recibido_en'
     AND NOT (datos ? a.attname);
  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRATO: al payload de % le faltan columnas que la tabla sí tiene: %', destino, faltantes;
  END IF;
END $$;

-- La huella de una fila: md5 de su JSON sin `recibido_en`. Sirve para saber si
-- dos escrituras dejaron lo mismo sin tener que leer la tabla.
CREATE OR REPLACE FUNCTION public.huella_de_fila(fila jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT md5((fila - 'recibido_en')::text) $$;

-- Escribe UNA fila en UNA tabla. Es el único EXECUTE del archivo.
--
-- Qué entra al texto SQL: el nombre de la tabla —un `regclass` que la función
-- que llama eligió de su lista literal— y los nombres de columna leídos de
-- `pg_catalog.pg_attribute`, todos citados con `%I`. Qué NO entra jamás: el
-- payload, que viaja como parámetro `$1`.
--
-- `si_existe` decide qué pasa ante conflicto de `id`, y lo decide quien llama,
-- POR TABLA: 'actualizar' pisa todas las columnas menos id y recibido_en
-- (last-wins: la terminal es el único escritor); 'ignorar' es DO NOTHING, la
-- única opción posible para las tablas de solo inserción y OBLIGATORIA para
-- auditoria_log. No hay valor por omisión: olvidarlo es un error, no un upsert.
CREATE OR REPLACE FUNCTION public.escribir_fila(destino regclass, datos jsonb, si_existe text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  fila jsonb := datos;
  id_de_la_fila text := datos ->> 'id';
  columna_json text;
  asignaciones text;
  antes jsonb;
  despues jsonb;
  resultado text;
BEGIN
  IF id_de_la_fila IS NULL THEN
    RAISE EXCEPTION 'CONTRATO: la fila de % no trae id', destino;
  END IF;
  IF si_existe NOT IN ('actualizar', 'ignorar') THEN
    RAISE EXCEPTION 'PROGRAMACION: si_existe tiene que ser actualizar o ignorar, no %', si_existe;
  END IF;

  PERFORM public.exigir_claves_conocidas(destino, fila);

  -- SQLite no tiene JSON nativo: las columnas que acá son jsonb allá son TEXT
  -- con el JSON adentro, y llegan como CADENA. jsonb_populate_record copiaría
  -- la cadena tal cual —un jsonb que contiene un texto, no el objeto—, así
  -- que se parsea antes. La regla es por TIPO de columna, leído del catálogo,
  -- no por nombre: no enumera columnas (§9.1). Un texto que no sea JSON
  -- válido falla acá, con nombre, como cualquier otro error determinístico.
  FOR columna_json IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = destino AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid = 'pg_catalog.jsonb'::regtype
  LOOP
    IF jsonb_typeof(fila -> columna_json) = 'string' THEN
      fila := jsonb_set(fila, ARRAY[columna_json], (fila ->> columna_json)::jsonb);
    END IF;
  END LOOP;

  EXECUTE format('SELECT to_jsonb(t) FROM %s AS t WHERE t.id::text = $1', destino)
     INTO antes USING id_de_la_fila;

  IF si_existe = 'actualizar' THEN
    SELECT string_agg(format('%I = EXCLUDED.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
      INTO asignaciones
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = destino AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname NOT IN ('id', 'recibido_en');
    EXECUTE format(
      'INSERT INTO %s SELECT * FROM jsonb_populate_record(NULL::%s, $1) ON CONFLICT (id) DO UPDATE SET %s',
      destino, destino, asignaciones
    ) USING fila;
  ELSE
    EXECUTE format(
      'INSERT INTO %s SELECT * FROM jsonb_populate_record(NULL::%s, $1) ON CONFLICT (id) DO NOTHING',
      destino, destino
    ) USING fila;
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM %s AS t WHERE t.id::text = $1', destino)
     INTO despues USING id_de_la_fila;

  resultado := CASE
    WHEN antes IS NULL THEN 'insertada'
    WHEN si_existe = 'ignorar' THEN 'ya_existia'
    WHEN public.huella_de_fila(antes) = public.huella_de_fila(despues) THEN 'sin_cambios'
    ELSE 'actualizada'
  END;

  RETURN jsonb_build_object(
    'tabla', destino::text,
    'id', id_de_la_fila,
    'resultado', resultado,
    'huella', public.huella_de_fila(despues),
    'recibido_en', despues ->> 'recibido_en'
  );
END $$;

-- Un cambio del lote, ya validado en su forma: {tabla, id, operacion, datos}
-- con datos.id igual al id declarado.
CREATE OR REPLACE FUNCTION public.exigir_forma_del_cambio(cambio jsonb, posicion integer)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF cambio IS NULL OR jsonb_typeof(cambio) <> 'object'
     OR NOT (cambio ? 'tabla') OR NOT (cambio ? 'id') OR NOT (cambio ? 'operacion') OR NOT (cambio ? 'datos') THEN
    RAISE EXCEPTION 'CONTRATO: el cambio % del lote no tiene la forma {tabla, id, operacion, datos}', posicion;
  END IF;
  IF (cambio -> 'datos' ->> 'id') IS DISTINCT FROM (cambio ->> 'id') THEN
    RAISE EXCEPTION 'CONTRATO: el cambio % declara id % pero sus datos traen id %',
      posicion, cambio ->> 'id', cambio -> 'datos' ->> 'id';
  END IF;
  IF (cambio ->> 'operacion') NOT IN ('insertar', 'actualizar') THEN
    RAISE EXCEPTION 'CONTRATO: el cambio % trae la operacion %, que no se sincroniza', posicion, cambio ->> 'operacion';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.exigir_claves_conocidas(regclass, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.huella_de_fila(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.escribir_fila(regclass, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exigir_forma_del_cambio(jsonb, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. sincronizar_usuario — usuarios → auditoria_log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_usuario(lote jsonb, version_de_contrato integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cambio jsonb;
  posicion integer := 0;
  constancias jsonb := '[]'::jsonb;
  usuario jsonb;
  asientos integer := 0;
  existente jsonb;
  administradores_activos integer;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'terminal'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo la terminal puede sincronizar usuarios' USING ERRCODE = '42501';
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

    CASE cambio ->> 'tabla'
      WHEN 'usuarios' THEN
        IF posicion <> 1 THEN
          RAISE EXCEPTION 'FORMA: en un lote de usuario, la fila de usuarios va primera y es una sola';
        END IF;
        usuario := cambio -> 'datos';
        IF (usuario ->> 'rol') NOT IN ('venta', 'administrativo') THEN
          RAISE EXCEPTION 'FORMA: el rol % no existe', usuario ->> 'rol';
        END IF;
        SELECT to_jsonb(u) INTO existente FROM public.usuarios u WHERE u.id::text = usuario ->> 'id';
        IF existente IS NOT NULL
           AND (existente ->> 'creado_en')::timestamptz IS DISTINCT FROM (usuario ->> 'creado_en')::timestamptz THEN
          RAISE EXCEPTION 'FORMA: no se puede cambiar creado_en de un usuario ya sincronizado';
        END IF;
        constancias := constancias || public.escribir_fila('public.usuarios'::regclass, usuario, 'actualizar');

      WHEN 'auditoria_log' THEN
        IF usuario IS NULL THEN
          RAISE EXCEPTION 'FORMA: el asiento de auditoría no puede ir antes que la fila de usuarios';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: auditoria_log solo se inserta';
        END IF;
        -- SIEMPRE ignorar: el trigger de inmutabilidad abortaría un UPDATE.
        constancias := constancias || public.escribir_fila('public.auditoria_log'::regclass, cambio -> 'datos', 'ignorar');
        asientos := asientos + 1;

      ELSE
        RAISE EXCEPTION 'FORMA: la tabla % no forma parte de un lote de usuario', cambio ->> 'tabla';
    END CASE;
  END LOOP;

  IF usuario IS NULL THEN
    RAISE EXCEPTION 'FORMA: el lote no trae la fila de usuarios';
  END IF;
  IF asientos = 0 THEN
    RAISE EXCEPTION 'FORMA: un usuario no se sincroniza sin su asiento de auditoría';
  END IF;

  -- El invariante de §4.7, ahora también en la nube: si esta escritura dejó
  -- cero administradores activos, se revierte entera.
  SELECT count(*) INTO administradores_activos
    FROM public.usuarios u WHERE u.rol = 'administrativo' AND u.activo;
  IF administradores_activos = 0 THEN
    RAISE EXCEPTION 'INVARIANTE: este lote dejaría la tienda sin ningún administrador activo';
  END IF;

  RETURN jsonb_build_object('funcion', 'sincronizar_usuario',
                            'contrato', public.version_del_contrato_de_sincronizacion(),
                            'filas', constancias);
END $$;

-- ---------------------------------------------------------------------------
-- 4. sincronizar_apertura_de_caja — caja_sesiones → desglose → auditoria_log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_apertura_de_caja(lote jsonb, version_de_contrato integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cambio jsonb;
  posicion integer := 0;
  constancias jsonb := '[]'::jsonb;
  caja jsonb;
  existente jsonb;
  asientos integer := 0;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'terminal'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo la terminal puede sincronizar la apertura de caja' USING ERRCODE = '42501';
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

    CASE cambio ->> 'tabla'
      WHEN 'caja_sesiones' THEN
        IF posicion <> 1 THEN
          RAISE EXCEPTION 'FORMA: en una apertura, la fila de caja_sesiones va primera y es una sola';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: una apertura inserta la caja; un lote de cierre es otra función';
        END IF;
        caja := cambio -> 'datos';
        IF (caja ->> 'estado') <> 'abierta' THEN
          RAISE EXCEPTION 'FORMA: una apertura lleva estado abierta, no %', caja ->> 'estado';
        END IF;
        SELECT to_jsonb(c) INTO existente FROM public.caja_sesiones c WHERE c.id::text = caja ->> 'id';
        IF existente IS NOT NULL THEN
          -- Ya existe: solo se acepta si es LA MISMA apertura. Lo inmutable de
          -- una caja es quién la abrió, con cuánto y cuándo.
          IF (existente ->> 'usuario_id') IS DISTINCT FROM (caja ->> 'usuario_id')
             OR (existente ->> 'monto_inicial')::numeric IS DISTINCT FROM (caja ->> 'monto_inicial')::numeric
             OR (existente ->> 'abierta_en')::timestamptz IS DISTINCT FROM (caja ->> 'abierta_en')::timestamptz
             OR (existente ->> 'creado_en')::timestamptz IS DISTINCT FROM (caja ->> 'creado_en')::timestamptz THEN
            RAISE EXCEPTION 'FORMA: la caja % ya existe en la nube con otra apertura; no se reescribe', caja ->> 'id';
          END IF;
        END IF;
        -- 'ignorar': si ya existía (idéntica, o ya cerrada por un cierre que
        -- subió antes de este reintento) no se toca. Nunca se «reabre».
        constancias := constancias || public.escribir_fila('public.caja_sesiones'::regclass, caja, 'ignorar');

      WHEN 'caja_sesion_denominaciones' THEN
        IF caja IS NULL THEN
          RAISE EXCEPTION 'FORMA: el desglose no puede ir antes que la caja';
        END IF;
        IF (cambio -> 'datos' ->> 'caja_sesion_id') IS DISTINCT FROM (caja ->> 'id') THEN
          RAISE EXCEPTION 'FORMA: una línea de desglose apunta a otra caja';
        END IF;
        IF (cambio -> 'datos' ->> 'momento') <> 'apertura' THEN
          RAISE EXCEPTION 'FORMA: en una apertura el desglose es de apertura, no de %', cambio -> 'datos' ->> 'momento';
        END IF;
        constancias := constancias || public.escribir_fila('public.caja_sesion_denominaciones'::regclass, cambio -> 'datos', 'ignorar');

      WHEN 'auditoria_log' THEN
        IF caja IS NULL THEN
          RAISE EXCEPTION 'FORMA: el asiento de auditoría no puede ir antes que la caja';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: auditoria_log solo se inserta';
        END IF;
        constancias := constancias || public.escribir_fila('public.auditoria_log'::regclass, cambio -> 'datos', 'ignorar');
        asientos := asientos + 1;

      ELSE
        RAISE EXCEPTION 'FORMA: la tabla % no forma parte de una apertura de caja', cambio ->> 'tabla';
    END CASE;
  END LOOP;

  IF caja IS NULL THEN
    RAISE EXCEPTION 'FORMA: el lote no trae la fila de caja_sesiones';
  END IF;
  IF asientos = 0 THEN
    RAISE EXCEPTION 'FORMA: una apertura no se sincroniza sin su asiento de auditoría';
  END IF;

  RETURN jsonb_build_object('funcion', 'sincronizar_apertura_de_caja',
                            'contrato', public.version_del_contrato_de_sincronizacion(),
                            'filas', constancias);
END $$;

-- ---------------------------------------------------------------------------
-- 5. sincronizar_cierre_de_caja — la ÚNICA transición: abierta → cerrada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_cierre_de_caja(lote jsonb, version_de_contrato integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cambio jsonb;
  posicion integer := 0;
  constancias jsonb := '[]'::jsonb;
  caja jsonb;
  existente jsonb;
  propuesta jsonb;
  asientos integer := 0;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'terminal'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo la terminal puede sincronizar el cierre de caja' USING ERRCODE = '42501';
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

    CASE cambio ->> 'tabla'
      WHEN 'caja_sesiones' THEN
        IF posicion <> 1 THEN
          RAISE EXCEPTION 'FORMA: en un cierre, la fila de caja_sesiones va primera y es una sola';
        END IF;
        IF (cambio ->> 'operacion') <> 'actualizar' THEN
          RAISE EXCEPTION 'FORMA: un cierre actualiza la caja; un lote de apertura es otra función';
        END IF;
        caja := cambio -> 'datos';
        IF (caja ->> 'estado') <> 'cerrada' THEN
          RAISE EXCEPTION 'FORMA: un cierre lleva estado cerrada, no %', caja ->> 'estado';
        END IF;
        SELECT to_jsonb(c) INTO existente FROM public.caja_sesiones c WHERE c.id::text = caja ->> 'id';
        IF existente IS NULL THEN
          RAISE EXCEPTION 'FORMA: no se puede cerrar la caja %: la nube no tiene su apertura', caja ->> 'id';
        END IF;
        -- Lo inmutable de la caja no se toca ni al cerrar.
        IF (existente ->> 'usuario_id') IS DISTINCT FROM (caja ->> 'usuario_id')
           OR (existente ->> 'monto_inicial')::numeric IS DISTINCT FROM (caja ->> 'monto_inicial')::numeric
           OR (existente ->> 'abierta_en')::timestamptz IS DISTINCT FROM (caja ->> 'abierta_en')::timestamptz
           OR (existente ->> 'creado_en')::timestamptz IS DISTINCT FROM (caja ->> 'creado_en')::timestamptz THEN
          RAISE EXCEPTION 'FORMA: un cierre no puede cambiar quién abrió la caja %, con cuánto ni cuándo', caja ->> 'id';
        END IF;

        IF (existente ->> 'estado') = 'cerrada' THEN
          -- Ya cerrada. Se compara la fila TIPADA del payload con la guardada:
          -- si es el mismo cierre, es un reintento y no se toca; si es otro,
          -- alguien quiere reescribir un corte ya hecho, y no hay función que
          -- lo haga.
          PERFORM public.exigir_claves_conocidas('public.caja_sesiones'::regclass, caja);
          SELECT to_jsonb(r) INTO propuesta
            FROM jsonb_populate_record(NULL::public.caja_sesiones, caja) AS r;
          IF public.huella_de_fila(propuesta) <> public.huella_de_fila(existente) THEN
            RAISE EXCEPTION 'FORMA: la caja % ya está cerrada con otros números; un cierre hecho no se reescribe', caja ->> 'id';
          END IF;
          constancias := constancias || jsonb_build_object(
            'tabla', 'public.caja_sesiones', 'id', caja ->> 'id', 'resultado', 'sin_cambios',
            'huella', public.huella_de_fila(existente), 'recibido_en', existente ->> 'recibido_en');
        ELSE
          constancias := constancias || public.escribir_fila('public.caja_sesiones'::regclass, caja, 'actualizar');
        END IF;

      WHEN 'caja_sesion_denominaciones' THEN
        IF caja IS NULL THEN
          RAISE EXCEPTION 'FORMA: el desglose no puede ir antes que la caja';
        END IF;
        IF (cambio -> 'datos' ->> 'caja_sesion_id') IS DISTINCT FROM (caja ->> 'id') THEN
          RAISE EXCEPTION 'FORMA: una línea de desglose apunta a otra caja';
        END IF;
        IF (cambio -> 'datos' ->> 'momento') <> 'cierre' THEN
          RAISE EXCEPTION 'FORMA: en un cierre el desglose es de cierre, no de %', cambio -> 'datos' ->> 'momento';
        END IF;
        constancias := constancias || public.escribir_fila('public.caja_sesion_denominaciones'::regclass, cambio -> 'datos', 'ignorar');

      WHEN 'auditoria_log' THEN
        IF caja IS NULL THEN
          RAISE EXCEPTION 'FORMA: el asiento de auditoría no puede ir antes que la caja';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: auditoria_log solo se inserta';
        END IF;
        constancias := constancias || public.escribir_fila('public.auditoria_log'::regclass, cambio -> 'datos', 'ignorar');
        asientos := asientos + 1;

      ELSE
        RAISE EXCEPTION 'FORMA: la tabla % no forma parte de un cierre de caja', cambio ->> 'tabla';
    END CASE;
  END LOOP;

  IF caja IS NULL THEN
    RAISE EXCEPTION 'FORMA: el lote no trae la fila de caja_sesiones';
  END IF;
  IF asientos = 0 THEN
    RAISE EXCEPTION 'FORMA: un cierre no se sincroniza sin su asiento de auditoría';
  END IF;

  RETURN jsonb_build_object('funcion', 'sincronizar_cierre_de_caja',
                            'contrato', public.version_del_contrato_de_sincronizacion(),
                            'filas', constancias);
END $$;

-- ---------------------------------------------------------------------------
-- 6. sincronizar_venta — productos → ventas → venta_detalle → auditoria_log
-- ---------------------------------------------------------------------------
-- DEFINER, y no INVOKER como preveía §4.3: como INVOKER, el DO NOTHING de
-- ventas y venta_detalle exigiría SELECT a la terminal (riesgo 8.4, medido).
CREATE OR REPLACE FUNCTION public.sincronizar_venta(lote jsonb, version_de_contrato integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cambio jsonb;
  posicion integer := 0;
  constancias jsonb := '[]'::jsonb;
  venta jsonb;
  productos integer := 0;
  lineas integer := 0;
  asientos integer := 0;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'terminal'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo la terminal puede sincronizar ventas' USING ERRCODE = '42501';
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

    CASE cambio ->> 'tabla'
      WHEN 'productos' THEN
        IF venta IS NOT NULL THEN
          RAISE EXCEPTION 'FORMA: los productos van antes que la venta';
        END IF;
        -- La venta les movió el saldo y los contadores: se pisan con la fila
        -- entera. La terminal es el único escritor y la cola es FIFO, así que
        -- «la última en llegar» es exactamente el estado correcto.
        constancias := constancias || public.escribir_fila('public.productos'::regclass, cambio -> 'datos', 'actualizar');
        productos := productos + 1;

      WHEN 'ventas' THEN
        IF venta IS NOT NULL THEN
          RAISE EXCEPTION 'FORMA: un lote de venta lleva una sola venta';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: ventas solo se inserta';
        END IF;
        venta := cambio -> 'datos';
        constancias := constancias || public.escribir_fila('public.ventas'::regclass, venta, 'ignorar');

      WHEN 'venta_detalle' THEN
        IF venta IS NULL THEN
          RAISE EXCEPTION 'FORMA: el detalle no puede ir antes que la venta';
        END IF;
        IF (cambio -> 'datos' ->> 'venta_id') IS DISTINCT FROM (venta ->> 'id') THEN
          RAISE EXCEPTION 'FORMA: una línea de detalle apunta a otra venta';
        END IF;
        constancias := constancias || public.escribir_fila('public.venta_detalle'::regclass, cambio -> 'datos', 'ignorar');
        lineas := lineas + 1;

      WHEN 'auditoria_log' THEN
        IF venta IS NULL THEN
          RAISE EXCEPTION 'FORMA: el asiento de auditoría no puede ir antes que la venta';
        END IF;
        IF (cambio ->> 'operacion') <> 'insertar' THEN
          RAISE EXCEPTION 'FORMA: auditoria_log solo se inserta';
        END IF;
        constancias := constancias || public.escribir_fila('public.auditoria_log'::regclass, cambio -> 'datos', 'ignorar');
        asientos := asientos + 1;

      ELSE
        RAISE EXCEPTION 'FORMA: la tabla % no forma parte de una venta', cambio ->> 'tabla';
    END CASE;
  END LOOP;

  IF venta IS NULL THEN
    RAISE EXCEPTION 'FORMA: el lote no trae la venta';
  END IF;
  IF productos = 0 OR lineas = 0 OR asientos = 0 THEN
    RAISE EXCEPTION 'FORMA: una venta lleva al menos un producto, una línea y un asiento (llegaron %, % y %)',
      productos, lineas, asientos;
  END IF;

  RETURN jsonb_build_object('funcion', 'sincronizar_venta',
                            'contrato', public.version_del_contrato_de_sincronizacion(),
                            'filas', constancias);
END $$;

-- ---------------------------------------------------------------------------
-- 7. sincronizar_lote_simple — una fila principal → auditoria_log
-- ---------------------------------------------------------------------------
-- Para todo lo que el diseño dejaba como upsert directo y el 8.4 impidió:
-- catálogo, topes, configuración del negocio y recibos. UNA fila principal y
-- después sus asientos (cero, en el caso del recibo).
CREATE OR REPLACE FUNCTION public.sincronizar_lote_simple(lote jsonb, version_de_contrato integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cambio jsonb;
  posicion integer := 0;
  constancias jsonb := '[]'::jsonb;
  principal text;
BEGIN
  IF coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'rol'), '') <> 'terminal'
     OR coalesce((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Solo la terminal puede sincronizar' USING ERRCODE = '42501';
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

    IF posicion = 1 THEN
      principal := cambio ->> 'tabla';
      -- LISTA CERRADA. Cada tabla con SU regla de conflicto, decidida acá y no
      -- por una regla genérica: lo que cambia se pisa, lo que solo se inserta
      -- se ignora si ya existe.
      CASE principal
        WHEN 'categorias' THEN
          constancias := constancias || public.escribir_fila('public.categorias'::regclass, cambio -> 'datos', 'actualizar');
        WHEN 'productos' THEN
          constancias := constancias || public.escribir_fila('public.productos'::regclass, cambio -> 'datos', 'actualizar');
        WHEN 'precios_especiales' THEN
          constancias := constancias || public.escribir_fila('public.precios_especiales'::regclass, cambio -> 'datos', 'actualizar');
        WHEN 'limites_descuento' THEN
          constancias := constancias || public.escribir_fila('public.limites_descuento'::regclass, cambio -> 'datos', 'actualizar');
        WHEN 'configuracion_negocio' THEN
          IF (cambio ->> 'operacion') <> 'actualizar' THEN
            RAISE EXCEPTION 'FORMA: configuracion_negocio solo se actualiza: su única fila nace con la migración';
          END IF;
          constancias := constancias || public.escribir_fila('public.configuracion_negocio'::regclass, cambio -> 'datos', 'actualizar');
        WHEN 'recibos' THEN
          IF (cambio ->> 'operacion') <> 'insertar' THEN
            RAISE EXCEPTION 'FORMA: recibos solo se inserta; sus cambios posteriores no se sincronizan';
          END IF;
          constancias := constancias || public.escribir_fila('public.recibos'::regclass, cambio -> 'datos', 'ignorar');
        ELSE
          RAISE EXCEPTION 'FORMA: la tabla % no se sincroniza como lote simple', principal;
      END CASE;
    ELSE
      IF (cambio ->> 'tabla') <> 'auditoria_log' THEN
        RAISE EXCEPTION 'FORMA: después de la fila principal solo van asientos de auditoría, no %', cambio ->> 'tabla';
      END IF;
      IF (cambio ->> 'operacion') <> 'insertar' THEN
        RAISE EXCEPTION 'FORMA: auditoria_log solo se inserta';
      END IF;
      -- SIEMPRE ignorar. Nunca actualizar: ver la cabecera.
      constancias := constancias || public.escribir_fila('public.auditoria_log'::regclass, cambio -> 'datos', 'ignorar');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('funcion', 'sincronizar_lote_simple',
                            'contrato', public.version_del_contrato_de_sincronizacion(),
                            'filas', constancias);
END $$;

-- ---------------------------------------------------------------------------
-- 8. contrato_de_sincronizacion — lo que la nube declara tener
-- ---------------------------------------------------------------------------
-- La mitad B de §9.2 la llama con el rol restauracion y compara con la foto
-- del repositorio. Devuelve columnas de las 13 tablas y la definición de las
-- funciones de sincronización, incluido su `search_path` y si son DEFINER.
--
-- Es SECURITY INVOKER, y no DEFINER como decía el diseño: solo lee catálogos
-- de `pg_catalog`, que no tienen RLS ni filtro por privilegio, así que no
-- necesita pasar por encima de nada. Una función DEFINER menos es un aviso
-- menos del linter y una superficie menos que cuidar.
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
                           'sincronizar_lote_simple', 'contrato_de_sincronizacion',
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

-- ---------------------------------------------------------------------------
-- 9. Permisos: revocar a public y anon, conceder solo a authenticated
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sincronizar_usuario(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sincronizar_apertura_de_caja(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sincronizar_cierre_de_caja(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sincronizar_venta(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sincronizar_lote_simple(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contrato_de_sincronizacion() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sincronizar_usuario(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_apertura_de_caja(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_cierre_de_caja(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_venta(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_lote_simple(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contrato_de_sincronizacion() TO authenticated;

COMMENT ON FUNCTION public.sincronizar_usuario(jsonb, integer) IS 'SECURITY DEFINER. Escribe un usuario y su auditoría con la forma exacta de la operación. Rechaza cambiar creado_en, un rol inexistente y dejar cero administradores activos. Solo rol terminal.';
COMMENT ON FUNCTION public.sincronizar_apertura_de_caja(jsonb, integer) IS 'SECURITY DEFINER. Inserta una caja, su desglose de apertura y su auditoría. Una caja que ya existe con otra apertura se rechaza; la misma, se ignora. Solo rol terminal.';
COMMENT ON FUNCTION public.sincronizar_cierre_de_caja(jsonb, integer) IS 'SECURITY DEFINER. La única transición permitida: abierta → cerrada. No cambia lo inmutable de la caja y no reescribe un cierre ya hecho. Solo rol terminal.';
COMMENT ON FUNCTION public.sincronizar_venta(jsonb, integer) IS 'SECURITY DEFINER. Una venta entera en una transacción: productos, venta, detalle y auditoría. O entra todo o no entra nada. Solo rol terminal.';
COMMENT ON FUNCTION public.sincronizar_lote_simple(jsonb, integer) IS 'SECURITY DEFINER. Una fila de catálogo, topes, configuración del negocio o recibo, más sus asientos de auditoría. Lista cerrada de tablas. Solo rol terminal.';
COMMENT ON FUNCTION public.contrato_de_sincronizacion() IS 'Lo que la nube declara: columnas de las tablas y definición de las funciones de sincronización, para la prueba de deriva. Solo rol restauracion.';
