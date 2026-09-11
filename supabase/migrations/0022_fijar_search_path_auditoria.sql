-- ===========================================================================
-- 0022_fijar_search_path_auditoria.sql — El archivo que faltaba
-- ===========================================================================
--
-- **SIN ESPEJO LOCAL**: en SQLite no existe `search_path`. Es la cuarta
-- migración de la «dirección 2» del README de esta carpeta. No hay migración
-- local 022.
--
-- ---------------------------------------------------------------------------
-- ESTE CAMBIO YA ESTABA APLICADO EN LA NUBE DESDE EL 2026-09-05, SIN ARCHIVO
-- ---------------------------------------------------------------------------
-- `pos-jimmy-cano` lo tiene desde el día 1, aplicado directamente como
-- `20260905171724_fijar_search_path_auditoria_log_es_inmutable` para callar un
-- aviso del linter de seguridad de Supabase. **Pero nunca se escribió el
-- archivo**, así que durante seis días el repositorio no pudo reproducir el
-- esquema real: aplicando las doce migraciones de esta carpeta sobre un
-- proyecto vacío, la función quedaba sin `search_path`.
--
-- **Lo encontró el proyecto de pruebas, que es exactamente para lo que existe**
-- (`docs/SINCRONIZACION.md` §9.5). Al comparar los dos catálogos apareció la
-- única diferencia que no era esperada:
--
--     pos-jimmy-cano         proconfig = {search_path=""}
--     pos-pruebas-descartable proconfig = NULL
--
-- Se escribe ahora para que la carpeta vuelva a ser suficiente: quien aplique
-- estas migraciones sobre un proyecto vacío tiene que terminar con el mismo
-- esquema que la tienda, sin pasos no escritos que alguien tenga que recordar.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE, Y POR QUÉ IMPORTA
-- ---------------------------------------------------------------------------
-- Sin `search_path` fijo, quien llama a la función puede cambiar el camino de
-- búsqueda y hacer que un nombre sin calificar se resuelva hacia otro esquema.
-- Esta función no nombra ninguna tabla —solo lanza una excepción— así que hoy
-- no hay nada que secuestrar, pero la regla vale igual: toda función del
-- proyecto lleva `search_path` fijo, y es la misma que cumplen
-- `fijar_recibido_en` (0019) y las que vengan.
--
-- Es idempotente: `CREATE OR REPLACE` con el mismo cuerpo. Aplicarla sobre
-- `pos-jimmy-cano`, donde el cambio ya está, no altera nada.
--
-- SECURITY INVOKER, como estaba: no necesita privilegios ajenos.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.auditoria_log_es_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora de auditoría es inmutable: no se puede modificar ni borrar un asiento.';
END;
$$;
