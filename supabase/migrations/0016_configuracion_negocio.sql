-- ===========================================================================
-- 0016_configuracion_negocio.sql — Espejo en Postgres de la migración local 016
-- ===========================================================================
--
-- Los datos de la tienda que encabezan el recibo. SÍ se espeja: es dato de
-- negocio, y sale impreso en un documento que se le entrega al cliente.
--
-- Fila única garantizada por la base: `id` es la constante `'unica'` y además
-- es la llave primaria, así que no puede haber dos filas.
--
-- Las cuatro columnas son nulables porque los datos reales de Jimmy todavía no
-- llegaron. Mientras estén en NULL el recibo imprime un marcador entre
-- corchetes, nunca un valor inventado.
--
-- RLS queda activo sin políticas, como en el resto de las tablas: la llave
-- anónima no puede leer ni escribir nada. Ver CLAUDE.md §4.4.
--
-- Estado: PENDIENTE de aplicar contra `pos-jimmy-cano`.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.configuracion_negocio (
  id               TEXT        NOT NULL PRIMARY KEY CHECK (id = 'unica'),

  nombre_comercial TEXT        CHECK (nombre_comercial IS NULL OR btrim(nombre_comercial) <> ''),
  direccion        TEXT        CHECK (direccion        IS NULL OR btrim(direccion)        <> ''),
  telefono         TEXT        CHECK (telefono         IS NULL OR btrim(telefono)         <> ''),
  nit              TEXT        CHECK (nit              IS NULL OR btrim(nit)              <> ''),

  actualizado_en   TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE public.configuracion_negocio IS
  'Datos de la tienda que encabezan el recibo. Fila única: id es siempre ''unica''.';

INSERT INTO public.configuracion_negocio (id, actualizado_en)
VALUES ('unica', now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracion_negocio ENABLE ROW LEVEL SECURITY;
