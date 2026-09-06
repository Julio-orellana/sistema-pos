-- ===========================================================================
-- 004_denominaciones_y_desglose.sql — Denominaciones y desglose de efectivo
-- ===========================================================================
--
-- Permite abrir y cerrar la caja contando billete por billete en vez de
-- escribir un total. El cajero cuenta lo que tiene en la mano; el sistema hace
-- la suma. Así el total no depende de que alguien sume bien de memoria con un
-- cliente esperando.
--
-- ESTO SÍ ES DATO DE NEGOCIO y se espeja en Postgres (`0004_...`): el desglose
-- del arqueo es parte del corte de caja y un auditor lo va a querer consultar.
--
-- SOBRE LOS UUID DE LA SEMILLA: son fijos y están escritos en el archivo, en
-- vez de generarse en el cliente como el resto. Es la excepción correcta: las
-- denominaciones del quetzal son las mismas en toda instalación, y si cada
-- terminal sorteara sus propios id, el mismo billete de Q20 tendría identidades
-- distintas y la sincronización los duplicaría.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- denominaciones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS denominaciones (
  id             TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),

  -- Valor facial. TEXT canónico de dos decimales, como todo el dinero del
  -- proyecto (ver la cabecera de 001). Estrictamente mayor que cero: una
  -- denominación de Q0 no existe.
  valor          TEXT    NOT NULL
    CHECK (typeof(valor) = 'text'
           AND (valor GLOB '[0-9]*.[0-9][0-9]' OR valor GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT valor GLOB '*.*.*'
           AND NOT valor GLOB '?*-*'
           AND NOT valor GLOB '-*'
           AND valor GLOB '*[1-9]*'),

  tipo           TEXT    NOT NULL CHECK (tipo IN ('billete', 'moneda')),
  -- Orden en que se muestran al contar. Menor número, primero.
  orden          INTEGER NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en      TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z'),

  -- No puede haber dos denominaciones con el mismo valor.
  UNIQUE (valor)
);

CREATE INDEX IF NOT EXISTS idx_denominaciones_activas ON denominaciones (activo, orden);

-- ---------------------------------------------------------------------------
-- caja_sesion_denominaciones
-- ---------------------------------------------------------------------------
-- Cuántas piezas de cada denominación había al abrir y al cerrar el turno.
CREATE TABLE IF NOT EXISTS caja_sesion_denominaciones (
  id              TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  caja_sesion_id  TEXT    NOT NULL REFERENCES caja_sesiones (id) ON DELETE CASCADE,
  denominacion_id TEXT    NOT NULL REFERENCES denominaciones (id) ON DELETE RESTRICT,
  momento         TEXT    NOT NULL CHECK (momento IN ('apertura', 'cierre')),

  -- Cantidad de piezas. Cero es válido y significativo: "conté y no había
  -- ninguna de Q200", que es distinto de no haber contado esa denominación.
  cantidad        INTEGER NOT NULL CHECK (cantidad >= 0),
  creado_en       TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),

  -- Una sola fila por denominación y momento en cada sesión: contar dos veces
  -- la misma denominación duplicaría el arqueo sin que nadie lo note.
  UNIQUE (caja_sesion_id, denominacion_id, momento)
);

CREATE INDEX IF NOT EXISTS idx_desglose_por_sesion
  ON caja_sesion_denominaciones (caja_sesion_id, momento);

-- ---------------------------------------------------------------------------
-- Semilla: las denominaciones del quetzal guatemalteco
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO denominaciones (id, valor, tipo, orden, activo, creado_en, actualizado_en) VALUES
  ('ea028c7f-3501-4a35-ac9f-669d41e7231c', '0.05',   'moneda',   1, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('829c46fd-61ef-449a-a740-65e0f6fd6263', '0.10',   'moneda',   2, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('335a1803-4317-4571-bcb5-694d594fd13b', '0.25',   'moneda',   3, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('296e079e-ae22-411e-8034-476a693f5835', '0.50',   'moneda',   4, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('ffae065b-2b81-4ad9-86b8-933746da95fa', '1.00',   'moneda',   5, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('c11a36fb-5100-4459-8fde-740bb784d3aa', '5.00',   'billete',  6, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('d2779395-3420-46f8-bf17-68856e48d4c1', '10.00',  'billete',  7, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('32e4abd7-d7ef-436b-a813-f007ef222bba', '20.00',  'billete',  8, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('cd8a550e-9e4d-4d81-8f6a-4821f7f90ace', '50.00',  'billete',  9, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('46924329-4574-45da-a34d-045ebd844964', '100.00', 'billete', 10, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
  ('3e77b4d7-db20-4c23-856c-73400d1ef854', '200.00', 'billete', 11, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z');
