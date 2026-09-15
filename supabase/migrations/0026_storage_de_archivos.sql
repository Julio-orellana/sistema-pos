-- ===========================================================================
-- 0026_storage_de_archivos.sql — Los dos buckets y sus políticas. Fase 2.c.
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL a propósito** (dirección 2 del README): en SQLite no hay
-- Storage. Los archivos viven en `<userData>` y su ruta relativa está en las
-- columnas `productos.foto_path` y `recibos.pdf_path`, que **esta migración no
-- toca y que no cambian de significado** (§2.5.1 del diseño).
--
-- ---------------------------------------------------------------------------
-- LOS DOS BUCKETS, Y POR QUÉ SON PRIVADOS
-- ---------------------------------------------------------------------------
-- La ruta en Storage se deriva de la ruta local; no hay ninguna columna nueva
-- (§2.5.1):
--
--   foto  `fotos-de-productos/<uuid>.jpg`  →  bucket `fotos`,   objeto `<uuid>.jpg`
--   PDF   `recibos/recibo-<n>-<fecha>.pdf` →  bucket `recibos`, objeto `<recibo.id>.pdf`
--
-- **Los dos van `public = false`.** Un bucket público sirve sus objetos a
-- cualquiera que adivine o consiga la URL, sin pasar por RLS. Un recibo lleva
-- lo que compró una persona, con su total; el catálogo, la mercadería de la
-- tienda. Nada de eso es contenido público. Es la misma postura que las trece
-- tablas: nadie lee salvo la restauración.
--
-- > **«PRIVADO» NO ES UNA GARANTÍA PERPETUA: ES UN ESTADO QUE HAY QUE
-- > VIGILAR.** `public` es una propiedad de la fila del bucket, y **se cambia
-- > desde el panel de Supabase con un interruptor, sin pasar por ninguna
-- > migración de esta carpeta y sin pasar por RLS.** Si alguien marca `fotos` o
-- > `recibos` como público —por error o por conveniencia de un rato—, Storage
-- > empieza a servir esos objetos por una ruta que **no evalúa ninguna de las
-- > políticas de este archivo**, y ni la restrictiva de `anon` ni la ausencia
-- > de permisos de la terminal se enterarían. Ninguna de las cuatro políticas
-- > de acá lo notaría, y la migración seguiría figurando como aplicada.
-- > No se agrega ningún mecanismo para impedirlo: queda dicho para que quien
-- > lea esto sepa que el día que un archivo aparezca donde no debería, lo
-- > primero que hay que mirar es si el bucket sigue siendo privado.
--
-- Los límites del bucket `fotos` NO son inventados: salen de §4.11 de
-- CLAUDE.md, que ya fija 5 MB y JPG o PNG para la foto de un producto, y que
-- la aplicación comprueba además por firma binaria antes de copiar el archivo.
-- Ponerlos también acá hace que el límite lo aplique el servidor y no solo el
-- cliente. Para `recibos` se fija el tipo —un recibo es un PDF— y NO se fija
-- tamaño: el diseño no da ninguna cifra y el tope de la plataforma (50 MB) ya
-- es mucho mayor que los 78 KB medidos de un recibo real (§2.5.3).
--
-- > **UN BUCKET NO SE BORRA POR SQL.** Medido en el proyecto de pruebas: el
-- > trigger `protect_buckets_delete` rechaza un DELETE directo con «Direct
-- > deletion from storage tables is not allowed. Use the Storage API instead».
-- > Crearlos por SQL sí funciona. Es decir: esta migración es fácil de aplicar
-- > y NO se deshace por la misma vía; deshacerla exige la API de Storage.
--
-- ---------------------------------------------------------------------------
-- LAS POLÍTICAS, Y LAS TRES QUE NO ESTÁN
-- ---------------------------------------------------------------------------
--   · **La terminal SUBE fotos y no las lee.** `INSERT` y nada más. §2.5.2
--     dice que una foto en una ruta es inmutable —una foto nueva recibe un
--     UUID nuevo— y que se sube SIN `x-upsert`: si el objeto ya existe, la
--     subida anterior había llegado y se marca como éxito. Eso no necesita
--     `SELECT` ni `UPDATE`, así que no se conceden. Es la misma forma que en
--     las tablas: la terminal escribe y no lee.
--   · **La restauración LEE los dos buckets.** Es la única que baja archivos
--     (§6.3, pasos 14 y 15).
--   · **Nadie borra.** Ni terminal ni restauración: es la regla de siempre.
--   · **NO hay política de la terminal sobre `recibos`, y es deliberado.**
--     §2.5.3 recomienda **no subir los PDF**: son dato derivado que la
--     reimpresión regenera desde las filas, y subirlos llena el gigabyte del
--     plan gratuito en unos ocho meses. Esa decisión es de Julio y todavía no
--     está tomada, así que se aplica el valor por omisión del proyecto: **el
--     permiso que no se pidió, no se concede.** El bucket se crea igual para
--     que la convención de rutas quede fijada; si algún día se decide subir
--     los PDF, hace falta una migración que agregue `INSERT` y —por el
--     `x-upsert` que exige la reimpresión— también `UPDATE` y `SELECT`.
--
-- La condición de identidad es **la misma que en la 0025 y que en las cinco
-- funciones de la 0023**, palabra por palabra: rol en `app_metadata`, envuelto
-- en `select` (§1.2), y `is_anonymous` con `coalesce(..., false)`.
--
-- ---------------------------------------------------------------------------
-- LA SEGUNDA CAPA PARA `anon`: SE INTENTÓ REVOCAR, Y NO SE PUEDE
-- ---------------------------------------------------------------------------
-- En `storage.objects`, `anon` y `authenticated` tienen los ocho privilegios de
-- tabla que Supabase concede por omisión: la `0024` revocó los del esquema
-- `public` y no llega hasta acá. Sin una segunda capa, lo único que frena a
-- Storage es RLS, igual que estaban las trece tablas antes de la `0024`.
--
-- **Lo primero que se intentó fue el REVOKE, y NO FUNCIONA.** Medido en el
-- proyecto de pruebas, con las tres vías posibles:
--
--   REVOKE ALL ON storage.objects FROM anon
--       -> NO lanza error Y NO HACE NADA: el privilegio sigue ahí.
--   REVOKE ALL ON storage.objects FROM anon GRANTED BY supabase_storage_admin
--       -> ERROR: grantor must be current user
--   SET ROLE supabase_storage_admin; REVOKE ...
--       -> ERROR: permission denied to set role "supabase_storage_admin"
--
-- La razón está en el propio `relacl` de la tabla:
-- `anon=arwdDxtm/supabase_storage_admin`. **Quien concedió es
-- `supabase_storage_admin`, y un REVOKE solo quita lo que concedió quien lo
-- ejecuta.** `postgres` no es miembro de ese rol y no puede llegar a serlo
-- desde acá.
--
-- **Por eso en este archivo NO queda un REVOKE que no revoca.** Un enunciado
-- que parece un control de seguridad y no hace nada es peor que no tenerlo:
-- quien leyera la migración creería que `anon` se quedó sin privilegios, y no
-- es cierto. Es la misma regla por la que los guiones de datos de ejemplo
-- dejaron de salir en silencio (§4.11 de CLAUDE.md).
--
-- **Lo que sí está en nuestra mano es una política RESTRICTIVA para `anon`, y
-- da la misma defensa en profundidad.** Una restrictiva no concede nada: se
-- combina con Y contra las permisivas, así que ninguna política permisiva
-- futura puede pasarle por encima. Hoy `anon` ya no puede nada, porque no tiene
-- ninguna permisiva; con esta tampoco podría el día que alguien le agregue una
-- por error, que es exactamente la capa que el REVOKE iba a dar. Va `TO anon`,
-- así que no roza a `authenticated`.
--
-- **A `authenticated` no se le toca nada, y no es una omisión.** Es el rol de
-- Postgres con el que corre la terminal: sin `INSERT` no podría subir una foto
-- por más que la política se lo permita, y sin `SELECT` la restauración no
-- podría bajar. Quién de los dos puede qué lo decide la POLÍTICA, no el
-- privilegio, igual que en las trece tablas.
--
-- Lo que NI el REVOKE ni la restrictiva cubrirían, dicho en voz alta: **un
-- bucket marcado como público**, porque Storage sirve esos objetos por una ruta
-- que no pasa por RLS. Los dos de acá nacen privados, y esa es la defensa.
-- `storage.buckets` tampoco se toca: hoy no tiene ninguna política, así que la
-- terminal ni siquiera puede enumerar los buckets (medido: lista vacía).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Los buckets
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fotos', 'fotos', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recibos', 'recibos', false, NULL, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. La terminal sube fotos. No las lee, no las reemplaza, no las borra.
-- ---------------------------------------------------------------------------
CREATE POLICY terminal_sube_fotos
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'fotos'
    AND (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'terminal'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

-- ---------------------------------------------------------------------------
-- 3. La restauración lee los dos buckets. No escribe ninguno.
-- ---------------------------------------------------------------------------
CREATE POLICY restauracion_lee_fotos
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'fotos'
    AND (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

CREATE POLICY restauracion_lee_recibos
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'recibos'
    AND (select auth.jwt() -> 'app_metadata' ->> 'rol') = 'restauracion'
    AND coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

-- ---------------------------------------------------------------------------
-- 4. La segunda capa para la llave publicable sola. Una política restrictiva
--    no concede nada: solo puede quitar, y ninguna permisiva futura la pasa
--    por encima. A `authenticated` NO se le toca (ver la cabecera).
-- ---------------------------------------------------------------------------
CREATE POLICY anon_no_toca_los_archivos
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
