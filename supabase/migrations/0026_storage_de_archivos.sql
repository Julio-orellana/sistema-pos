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
-- LO QUE ESTA MIGRACIÓN NO PUEDE HACER, DICHO EN VOZ ALTA
-- ---------------------------------------------------------------------------
-- En `storage.objects`, `anon` y `authenticated` conservan los ocho privilegios
-- de tabla que Supabase concede por omisión: la `0024` revocó los del esquema
-- `public` y no llega hasta acá. **Así que en Storage la única capa es RLS**,
-- igual que estaban las trece tablas antes de la `0024`. No se replica acá el
-- mismo REVOKE por dos razones medidas: la terminal NECESITA `INSERT` sobre
-- `storage.objects` para subir —revocarlo la dejaría sin poder hacerlo aunque
-- la política se lo permita—, y `storage.objects` pertenece a
-- `supabase_storage_admin`, no a `postgres`, así que un cambio de privilegios
-- ahí lo puede revertir una actualización de la plataforma sin avisar. Revocar
-- solo a `anon` sí sería posible y quedaría como una decisión aparte.
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
