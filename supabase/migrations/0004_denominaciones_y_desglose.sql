-- ===========================================================================
-- 0004_denominaciones_y_desglose.sql — Espejo de denominaciones y desglose
-- ===========================================================================
--
-- Espejo de src/main/database/migrations/004_denominaciones_y_desglose.sql.
-- SÍ se espeja: el desglose del arqueo es parte del corte de caja, que es dato
-- de negocio y lo primero que un auditor va a querer consultar.
--
-- Los UUID de la semilla son los MISMOS que en el esquema local, a propósito:
-- si cada terminal sorteara los suyos, el mismo billete de Q20 tendría
-- identidades distintas y la sincronización los duplicaría.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.denominaciones (
  id             UUID           PRIMARY KEY,
  -- Valor facial. Estrictamente mayor que cero: una denominación de Q0 no existe.
  valor          NUMERIC(14, 2) NOT NULL CHECK (valor > 0) UNIQUE,
  tipo           TEXT           NOT NULL CHECK (tipo IN ('billete', 'moneda')),
  orden          INTEGER        NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo         BOOLEAN        NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ    NOT NULL,
  actualizado_en TIMESTAMPTZ    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_denominaciones_activas ON public.denominaciones (activo, orden);

CREATE TABLE IF NOT EXISTS public.caja_sesion_denominaciones (
  id              UUID        PRIMARY KEY,
  caja_sesion_id  UUID        NOT NULL REFERENCES public.caja_sesiones (id) ON DELETE CASCADE,
  denominacion_id UUID        NOT NULL REFERENCES public.denominaciones (id) ON DELETE RESTRICT,
  momento         TEXT        NOT NULL CHECK (momento IN ('apertura', 'cierre')),
  -- Cero es válido y significativo: "conté y no había ninguna de Q200", que es
  -- distinto de no haber contado esa denominación.
  cantidad        INTEGER     NOT NULL CHECK (cantidad >= 0),
  creado_en       TIMESTAMPTZ NOT NULL,

  CONSTRAINT caja_sesion_denominaciones_unica UNIQUE (caja_sesion_id, denominacion_id, momento)
);

CREATE INDEX IF NOT EXISTS idx_desglose_por_sesion
  ON public.caja_sesion_denominaciones (caja_sesion_id, momento);

ALTER TABLE public.denominaciones              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_sesion_denominaciones  ENABLE ROW LEVEL SECURITY;

-- Semilla: las denominaciones del quetzal guatemalteco.
INSERT INTO public.denominaciones (id, valor, tipo, orden, activo, creado_en, actualizado_en) VALUES
  ('ea028c7f-3501-4a35-ac9f-669d41e7231c', 0.05,   'moneda',   1, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('829c46fd-61ef-449a-a740-65e0f6fd6263', 0.10,   'moneda',   2, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('335a1803-4317-4571-bcb5-694d594fd13b', 0.25,   'moneda',   3, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('296e079e-ae22-411e-8034-476a693f5835', 0.50,   'moneda',   4, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('ffae065b-2b81-4ad9-86b8-933746da95fa', 1.00,   'moneda',   5, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('c11a36fb-5100-4459-8fde-740bb784d3aa', 5.00,   'billete',  6, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('d2779395-3420-46f8-bf17-68856e48d4c1', 10.00,  'billete',  7, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('32e4abd7-d7ef-436b-a813-f007ef222bba', 20.00,  'billete',  8, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('cd8a550e-9e4d-4d81-8f6a-4821f7f90ace', 50.00,  'billete',  9, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('46924329-4574-45da-a34d-045ebd844964', 100.00, 'billete', 10, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'),
  ('3e77b4d7-db20-4c23-856c-73400d1ef854', 200.00, 'billete', 11, TRUE, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
