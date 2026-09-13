-- ===========================================================================
-- 0024_privilegios_de_tabla.sql — La segunda capa: nadie escribe una tabla
-- directamente, ni siquiera con privilegio de tabla. Fase 2.c de la
-- sincronización, adelantada al proyecto de pruebas el 2026-09-12.
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL a propósito** (dirección 2 del README): en SQLite no hay
-- roles ni privilegios. No hay migración local 024.
--
-- ---------------------------------------------------------------------------
-- QUÉ HABÍA, LEÍDO DEL CATÁLOGO DE LOS DOS PROYECTOS
-- ---------------------------------------------------------------------------
-- Supabase concede por omisión a `anon` y a `authenticated` TODOS los
-- privilegios de tabla sobre cada tabla de `public` —en Postgres 17 son ocho:
-- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER y MAINTAIN—,
-- y los privilegios por omisión (`pg_default_acl`) conceden lo mismo a toda
-- tabla nueva. Lo que frenaba a la terminal era UNA sola capa: RLS activo con
-- cero políticas. Medido en la fase 2.b: un INSERT directo fallaba con «new
-- row violates row-level security policy», un UPDATE o DELETE afectaba cero
-- filas y un SELECT devolvía vacío. Pero TRUNCATE ni siquiera pasa por RLS, y
-- una política permisiva escrita por error el año que viene abriría la tabla
-- entera. Una sola capa es una sola.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE ESTA MIGRACIÓN, Y QUÉ NO
-- ---------------------------------------------------------------------------
-- Deja a `anon` sin ningún privilegio de tabla y a `authenticated` con SELECT
-- y nada más. Desde acá, el único camino de escritura de la terminal es
-- EXECUTE sobre las cinco funciones SECURITY DEFINER de la 0023, que corren
-- como el DUEÑO de las trece tablas y por lo tanto no dependen de ninguno de
-- los privilegios que se revocan acá.
--
-- **Se escribe REVOKE ALL y después GRANT SELECT, no una lista de lo que se
-- quita.** La primera versión de este archivo enumeraba seis privilegios y se
-- le pasó MAINTAIN, que es nuevo en Postgres 17, no aparece en
-- `information_schema.role_table_grants` y sí en `pg_class.relacl` (la letra
-- `m`). Se vio leyendo `relacl` después de aplicarla en el proyecto de
-- pruebas. Con ALL, cualquier privilegio que Postgres agregue mañana queda
-- revocado sin tocar este archivo; lo único que sobrevive es lo que se vuelve
-- a conceder a mano, y eso es una sola cosa.
--
-- **SELECT se conserva para `authenticated`, a propósito.** El rol de la
-- terminal y el de restauración son el MISMO rol de Postgres —el rol del
-- diseño (§1.2) es un claim del JWT—, así que revocar SELECT dejaría sin leer
-- también a la restauración. Quién lee lo decide RLS: hoy, con cero políticas,
-- nadie; en la fase 2.c, la política R, solo para restauración.
--
-- No toca `USAGE` sobre el esquema ni los privilegios de las funciones: los de
-- cada función los fija el archivo que la crea (0023), y el esquema lo
-- necesita PostgREST para exponerlas. Tampoco toca secuencias: no hay ninguna
-- (las claves son UUID).
--
-- **Lo que NO puede cubrir.** `pg_default_acl` tiene además un juego de
-- privilegios por omisión del rol `supabase_admin`, propio de la plataforma,
-- que concede todo a `anon` y `authenticated` sobre las tablas que ESE rol
-- cree. `postgres` no es miembro de `supabase_admin` y no puede alterarlo. No
-- afecta a este esquema: las trece tablas y toda migración de este repositorio
-- corren como `postgres` (leído de `pg_class.relowner`). Una tabla creada por
-- otra vía llegaría con esos privilegios puestos —en `pos-jimmy-cano` el
-- disparador de eventos `ensure_rls`, preexistente, le activaría RLS; en el
-- proyecto de pruebas ni eso— y habría que revocárselos a mano.
--
-- El criterio para aplicarla: la misma batería, antes y después, tiene que dar
-- el mismo resultado en TODAS las funciones. Lo único que puede cambiar es el
-- motivo por el que se rechaza un acceso directo a una tabla: de «viola la
-- política de RLS» a «permission denied». Ver CLAUDE.md §4.20.
-- ===========================================================================

-- 1. anon: nada. La llave publicable sola no tiene por qué ver ni tocar
--    ninguna tabla; con RLS sin políticas ya no podía, ahora tampoco tiene el
--    privilegio.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- 2. authenticated: todo fuera, y SELECT de vuelta. Ese lo gobierna RLS.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- 3. Lo mismo para toda tabla que una migración futura cree. Las migraciones
--    corren como `postgres`, que es el dueño de las trece tablas y de las
--    funciones (leído de pg_class.relowner y pg_proc.proowner), así que es su
--    juego de privilegios por omisión el que aplica.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO authenticated;
