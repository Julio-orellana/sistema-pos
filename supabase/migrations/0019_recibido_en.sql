-- ===========================================================================
-- 0019_recibido_en.sql — La marca de tiempo que el cliente NO controla
-- (doce tablas: todas las que recibe escrituras de la terminal)
-- ===========================================================================
--
-- **ESTA MIGRACIÓN NO TIENE ESPEJO LOCAL, Y ES LA PRIMERA DEL PROYECTO ASÍ.**
-- Hasta ahora los huecos en la numeración estaban solo de este lado y
-- significaban «esa migración local no se espeja». Desde acá los huecos
-- también pueden estar del otro lado: **no existe ni va a existir una
-- migración local 019**, porque `recibido_en` es un metadato del respaldo que
-- solo tiene sentido en la nube. Ver el README de esta carpeta.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EXISTE: ninguna fecha que ponga el cliente sirve para auditar al cliente
-- ---------------------------------------------------------------------------
-- La sección 6.5 del diseño proponía detectar lo que un ladrón hubiera subido
-- con la credencial robada buscando filas con `creado_en` posterior al robo.
-- **No funciona: `creado_en` viaja en el payload que manda la terminal, así que
-- el ladrón lo elige.** Puede insertar una venta falsa fechada el mes pasado, o
-- modificar un usuario dejando `actualizado_en` como estaba. Y un `UPDATE` ni
-- siquiera toca `creado_en`.
--
-- La respuesta es que **el servidor ponga su propia marca en todo lo que
-- recibe, y que el cliente no pueda tocarla**:
--
--   · toda fila insertada por el ladrón tiene `recibido_en` posterior al robo,
--     diga lo que diga su `creado_en`;
--   · toda fila modificada por el ladrón tiene `recibido_en` posterior al robo,
--     diga lo que diga su `actualizado_en`;
--   · la restauración filtra por `recibido_en`, la única fecha que el ladrón
--     no controla.
--
-- Lo que `recibido_en` **no** da es el valor anterior de una fila modificada:
-- dice que la tocaron, no qué decía antes. Para eso está la mitigación 2 del
-- diseño (§1.5.1), que son las funciones de Postgres, y llega en otra fase.
--
-- ---------------------------------------------------------------------------
-- EL DEFAULT NO ALCANZA: HACE FALTA EL TRIGGER
-- ---------------------------------------------------------------------------
-- `DEFAULT now()` solo actúa cuando la columna **no viene** en el INSERT. Si el
-- payload la manda —y un ladrón la mandaría— el DEFAULT no se aplica y el valor
-- del cliente entra tal cual. Y en un UPDATE el DEFAULT no participa nunca.
--
-- Por eso cada tabla lleva un trigger `BEFORE INSERT OR UPDATE` que **pisa** el
-- valor con `now()` del servidor. El DEFAULT se conserva igual, por dos
-- razones: deja la intención escrita en la definición de la columna, y es lo
-- que llena las filas que ya existían al aplicar esta migración.
--
-- ---------------------------------------------------------------------------
-- DOCE TABLAS, NO TRECE: `denominaciones` QUEDA AFUERA
-- ---------------------------------------------------------------------------
-- **No es una excepción arbitraria: es que ahí no hay nada que detectar.**
-- `recibido_en` existe para delatar lo que escribió un cliente comprometido, y
-- para eso hace falta que haya un cliente que escriba. En `denominaciones` no
-- lo hay: la sección 2.1 del diseño la marca como «**No se sube.** Ya están en
-- la nube con los mismos UUID, sembradas por la 0004», y la bandeja de salida
-- la deja fuera de `TablaSincronizable` desde la fase 1.a, con una prueba que
-- comprueba que nunca se encola.
--
-- Las once filas del quetzal las puso una migración, no una terminal, y ninguna
-- credencial —robada o legítima— tiene por dónde tocarlas. Una columna
-- `recibido_en` allí no contestaría «¿cuándo la recibimos?» sino «¿cuándo
-- corrió la migración?», que es otra pregunta y ya la contesta el registro de
-- migraciones de Supabase. Ponerla igual sería sugerir que esa tabla recibe
-- escrituras de la terminal, que es justo lo contrario de lo que pasa.
--
-- ---------------------------------------------------------------------------
-- UNA SOLA FUNCIÓN PARA LAS DOCE
-- ---------------------------------------------------------------------------
-- Doce funciones idénticas serían doce lugares donde tocar el día que esto
-- cambie, y once oportunidades de que una quede distinta sin que nadie lo note.
-- Los triggers sí son doce, uno por tabla, porque Postgres no tiene otra
-- forma: un trigger pertenece a una tabla.
--
-- **Es SECURITY INVOKER (el valor por omisión), no DEFINER.** No necesita
-- privilegios ajenos: solo escribe un campo del registro que ya está en curso.
-- Ponerle DEFINER sumaría una función más a la lista del linter de seguridad a
-- cambio de nada. Es el mismo criterio con el que quedó
-- `auditoria_log_es_inmutable` (CLAUDE.md §4.4).
--
-- **`SET search_path = ''`** por la misma razón que esa otra función: sin eso,
-- quien llama puede hacer que un nombre se resuelva hacia otro esquema. Con el
-- camino vacío hay que calificar todo, y por eso dice `pg_catalog.now()`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La función
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fijar_recibido_en()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Se pisa SIEMPRE, venga o no en el payload. Ese es todo el mecanismo.
  NEW.recibido_en := pg_catalog.now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fijar_recibido_en() IS
  'Fija recibido_en con la hora del servidor e ignora cualquier valor del payload. Es la única fecha que un cliente comprometido no controla.';

-- ---------------------------------------------------------------------------
-- 2. La columna y el trigger, tabla por tabla
-- ---------------------------------------------------------------------------
-- Se escriben las doce a mano y no con un bucle `DO $$ ... $$` sobre el
-- catálogo, a propósito: un bucle sobre `information_schema` le agregaría la
-- columna a cualquier tabla que alguien cree después en `public` —incluida
-- `denominaciones`, que no la lleva, y cualquier otra que no sea del POS— y el
-- día que falle no se vería qué tabla tocó. La lista explícita se lee, y la
-- ausencia de `denominaciones` también.

-- usuarios
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS usuarios_fijar_recibido_en ON public.usuarios;
CREATE TRIGGER usuarios_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- categorias
ALTER TABLE public.categorias
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS categorias_fijar_recibido_en ON public.categorias;
CREATE TRIGGER categorias_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.categorias
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- productos
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS productos_fijar_recibido_en ON public.productos;
CREATE TRIGGER productos_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- precios_especiales
ALTER TABLE public.precios_especiales
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS precios_especiales_fijar_recibido_en ON public.precios_especiales;
CREATE TRIGGER precios_especiales_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.precios_especiales
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- limites_descuento
ALTER TABLE public.limites_descuento
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS limites_descuento_fijar_recibido_en ON public.limites_descuento;
CREATE TRIGGER limites_descuento_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.limites_descuento
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- caja_sesiones
ALTER TABLE public.caja_sesiones
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS caja_sesiones_fijar_recibido_en ON public.caja_sesiones;
CREATE TRIGGER caja_sesiones_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.caja_sesiones
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- caja_sesion_denominaciones
ALTER TABLE public.caja_sesion_denominaciones
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS caja_sesion_denominaciones_fijar_recibido_en ON public.caja_sesion_denominaciones;
CREATE TRIGGER caja_sesion_denominaciones_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.caja_sesion_denominaciones
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- ventas
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS ventas_fijar_recibido_en ON public.ventas;
CREATE TRIGGER ventas_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- venta_detalle
ALTER TABLE public.venta_detalle
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS venta_detalle_fijar_recibido_en ON public.venta_detalle;
CREATE TRIGGER venta_detalle_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.venta_detalle
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- recibos
ALTER TABLE public.recibos
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS recibos_fijar_recibido_en ON public.recibos;
CREATE TRIGGER recibos_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- auditoria_log
-- Convive con `auditoria_log_prohibir_cambios`, que es BEFORE UPDATE OR DELETE
-- y lanza una excepción. No hay conflicto, y conviene dejar dicho por qué:
-- Postgres dispara los triggers BEFORE de fila en orden alfabético por nombre,
-- así que en un UPDATE este corre primero —«f» antes que «p»— fija
-- `recibido_en` y devuelve NEW; después corre el otro y **aborta la operación
-- entera**, con lo cual nada de lo que este hizo queda. Sobre un INSERT corre
-- solo este. En los dos casos el resultado es el que tiene que ser: la
-- inmutabilidad manda.
ALTER TABLE public.auditoria_log
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS auditoria_log_fijar_recibido_en ON public.auditoria_log;
CREATE TRIGGER auditoria_log_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.auditoria_log
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- configuracion_negocio
ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS configuracion_negocio_fijar_recibido_en ON public.configuracion_negocio;
CREATE TRIGGER configuracion_negocio_fijar_recibido_en
  BEFORE INSERT OR UPDATE ON public.configuracion_negocio
  FOR EACH ROW EXECUTE FUNCTION public.fijar_recibido_en();

-- ---------------------------------------------------------------------------
-- 3. Los comentarios de columna, para que el catálogo lo explique solo
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.usuarios.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload: es la única fecha que un cliente comprometido no controla. No existe en SQLite.';
COMMENT ON COLUMN public.categorias.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.productos.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.precios_especiales.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.limites_descuento.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.caja_sesiones.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.caja_sesion_denominaciones.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.ventas.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.venta_detalle.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.recibos.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.auditoria_log.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
COMMENT ON COLUMN public.configuracion_negocio.recibido_en IS 'Hora del SERVIDOR en que la nube recibió esta fila. La fija un trigger e ignora el payload. No existe en SQLite.';
