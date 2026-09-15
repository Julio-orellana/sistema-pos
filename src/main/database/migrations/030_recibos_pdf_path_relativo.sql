-- ===========================================================================
-- 030_recibos_pdf_path_relativo.sql
-- `recibos.pdf_path` pasa de ruta ABSOLUTA a ruta RELATIVA: `recibos/<nombre>.pdf`.
-- ===========================================================================
--
-- SIN ESPEJO EN LA NUBE, a propósito (dirección 1 del README de
-- `supabase/migrations`): no cambia el esquema de ninguna tabla —la columna
-- sigue siendo TEXT NOT NULL con su CHECK— sino el VALOR que la terminal
-- guarda en ella, y ese valor solo lo escribe la terminal. Las filas que ya
-- están en la nube con ruta absoluta quedan como están (la terminal no tiene
-- UPDATE sobre ninguna tabla, CLAUDE.md §4.21): la restauración las convierte
-- al bajarlas, como compatibilidad hacia atrás y nada más. El número 0030
-- queda reservado del otro lado.
--
-- ---------------------------------------------------------------------------
-- QUÉ CORRIGE, Y QUIÉN LO SEÑALÓ
-- ---------------------------------------------------------------------------
-- Desde el módulo de recibos (Prompt 23, CLAUDE.md §4.14) `ServicioDeRecibos`
-- guardaba la ruta ABSOLUTA del PDF —`join(carpeta, nombre)`—, o sea la de la
-- carpeta de recibos de ESTA máquina: `/Users/…/pos-agricola/recibos/recibo-….pdf`
-- en macOS, `C:\Users\…\pos-agricola\recibos\recibo-….pdf` en Windows. Esa ruta
-- viajaba a la nube con cada recibo y no significa nada en otra computadora.
-- La restauración de la fase 4.b tuvo que re-enraizarla a mano, y Julio señaló
-- lo que eso escondía: mientras el origen siguiera igual, cada recibo nuevo
-- iba a subir con el mismo problema y cada restauración iba a tener que seguir
-- compensándolo para siempre. El arreglo va en el origen, que es este.
--
-- `productos.foto_path` nunca tuvo este problema: guarda
-- `fotos-de-productos/<uuid>.jpg`, relativa a la carpeta de datos, porque «la
-- absoluta cambia entre máquinas y rompería un respaldo restaurado en otra
-- computadora» (CLAUDE.md §4.11). Desde esta migración `pdf_path` sigue la
-- misma convención, que es además la que el diseño suponía desde el principio
-- (`docs/SINCRONIZACION.md` §2.5.1): `recibos/<nombre>.pdf`.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE CON LO QUE YA ESTÁ
-- ---------------------------------------------------------------------------
-- 1. Cada `pdf_path` que no empiece por `recibos/` se reemplaza por
--    `recibos/` más su nombre de archivo, cortado por la última barra, sea `/`
--    o `\`. El nombre lo generó la propia terminal (número de recibo y momento
--    de emisión), así que sigue apuntando AL MISMO archivo:
--    `<userData>/recibos/<nombre>` es exactamente donde ese PDF ya estaba.
-- 2. Lo que esté esperando en `sync_cola` para `recibos` se mueve igual, en su
--    payload, por la regla de §4.17: el payload es byte a byte lo que quedó
--    guardado. Sin esto, un recibo emitido sin internet justo antes de
--    actualizar subiría con la ruta vieja. Lo ya sincronizado no se toca: es
--    la constancia de lo que se envió.
--
-- Cómo se corta el nombre en SQL, que no tiene `basename`: con la barra ya
-- unificada a `/`, `rtrim(ruta, replace(ruta, '/', ''))` quita por la derecha
-- todo carácter que NO sea una barra —o sea el nombre entero— y deja la
-- carpeta con su barra final; `substr` desde ahí es el nombre. Una ruta sin
-- ninguna barra queda como su propio nombre. (En SQLite la barra invertida no
-- es un carácter de escape dentro de una cadena: `'\'` es una sola barra.)
-- ===========================================================================

UPDATE recibos
   SET pdf_path = 'recibos/' || substr(
         replace(pdf_path, '\', '/'),
         length(rtrim(replace(pdf_path, '\', '/'), replace(replace(pdf_path, '\', '/'), '/', ''))) + 1
       )
 WHERE pdf_path NOT LIKE 'recibos/%';

UPDATE sync_cola
   SET payload = json_set(
         payload,
         '$.pdf_path',
         'recibos/' || substr(
           replace(json_extract(payload, '$.pdf_path'), '\', '/'),
           length(rtrim(replace(json_extract(payload, '$.pdf_path'), '\', '/'),
                        replace(replace(json_extract(payload, '$.pdf_path'), '\', '/'), '/', ''))) + 1
         )
       )
 WHERE entidad_tipo = 'recibos'
   AND sincronizado_en IS NULL
   AND json_extract(payload, '$.pdf_path') IS NOT NULL
   AND json_extract(payload, '$.pdf_path') NOT LIKE 'recibos/%';
