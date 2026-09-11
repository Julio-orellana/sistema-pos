-- ===========================================================================
-- 016_configuracion_negocio.sql — Los datos de la tienda que van en el recibo
-- ===========================================================================
--
-- Nombre comercial, dirección, teléfono y NIT. Es lo que encabeza el
-- comprobante, y hasta hoy no existía en ningún lado: el recibo no tenía de
-- dónde sacarlo.
--
-- FILA ÚNICA, GARANTIZADA POR LA BASE. `id` es la constante `'unica'` con un
-- CHECK, y como además es la llave primaria, la tabla no puede tener dos filas.
-- Se prefirió eso a un índice único sobre una columna inventada o a confiar en
-- que la aplicación no inserte de más: esto no es un catálogo, es la
-- configuración del negocio, y «hay exactamente una» es parte de su definición.
--
-- ROMPE A PROPÓSITO LA REGLA DE UUID EN EL CLIENTE (ver el registro de
-- decisiones). Esa regla existe porque dos filas creadas sin internet en
-- máquinas distintas colisionarían al subir. Acá la colisión es justamente lo
-- que se quiere: la configuración del negocio es una sola, y si dos terminales
-- la editan tienen que estar hablando de la misma fila, no crear dos.
--   > PENDIENTE PARA MULTI-SUCURSAL (§6.2, punto 10): con más de una sucursal,
--   > cada una tendría su propio nombre y dirección, y esta tabla necesitaría
--   > una fila por sucursal. Ese día hay que revisarla.
--
-- LAS CUATRO COLUMNAS SON NULABLES porque los datos reales de Jimmy todavía no
-- llegaron. Mientras estén en NULL, el recibo imprime un marcador de posición
-- entre corchetes —«[Nombre del negocio]»— y nunca un valor inventado que
-- parezca de verdad.
--
-- NULL Y CADENA VACÍA NO PUEDEN SIGNIFICAR LO MISMO. El CHECK exige que una
-- columna con valor tenga algo más que espacios: así «sin configurar» es
-- siempre NULL, y el recibo no tiene que decidir entre dos formas de vacío.
--
-- Se espeja en Postgres (`0016_...`): es dato de negocio, y sale impreso en un
-- documento que se le entrega al cliente.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS configuracion_negocio (
  -- Constante, no un UUID. Ver la explicación de arriba.
  id               TEXT NOT NULL PRIMARY KEY CHECK (id = 'unica'),

  nombre_comercial TEXT CHECK (nombre_comercial IS NULL OR length(trim(nombre_comercial)) > 0),
  direccion        TEXT CHECK (direccion        IS NULL OR length(trim(direccion))        > 0),
  telefono         TEXT CHECK (telefono         IS NULL OR length(trim(telefono))         > 0),
  nit              TEXT CHECK (nit              IS NULL OR length(trim(nit))              > 0),

  actualizado_en   TEXT NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);

-- La fila nace vacía y existe desde el primer arranque, para que la pantalla de
-- configuración y el recibo lean siempre algo y no tengan que distinguir entre
-- «no hay fila» y «la fila está vacía»: son el mismo estado del negocio.
INSERT OR IGNORE INTO configuracion_negocio (id, actualizado_en)
VALUES ('unica', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
