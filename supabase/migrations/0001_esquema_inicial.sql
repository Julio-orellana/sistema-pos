-- ===========================================================================
-- 0001_esquema_inicial.sql — Espejo del esquema del POS en Supabase (Postgres)
-- ===========================================================================
--
-- Es el espejo en la nube del esquema local de SQLite
-- (src/main/database/migrations/001_esquema_inicial.sql). Mismas tablas,
-- mismas restricciones, mismos índices, con TRES diferencias deliberadas:
--
-- 1. LOS DECIMALES SON NUMERIC, NO TEXT.
--    En SQLite los montos se guardan como TEXT porque su tipo REAL es punto
--    flotante y corrompería los centavos. Postgres NO tiene esa limitación:
--    NUMERIC es un tipo decimal exacto nativo, de precisión arbitraria, que es
--    justamente lo que necesitamos. Repetir el patrón TEXT aquí sería copiar
--    una solución sin el problema que la justificaba, y además impediría hacer
--    sumas y reportes en SQL del lado del servidor.
--
-- 2. NO EXISTE LA TABLA sync_cola.
--    Es la lista local de qué falta subir. Subirla sería subir la lista de
--    pendientes junto con los pendientes.
--
-- 3. Los tipos nativos de Postgres reemplazan a los sustitutos de SQLite:
--    UUID en vez de TEXT de 36 caracteres, TIMESTAMPTZ en vez de texto ISO,
--    BOOLEAN en vez de 0/1, JSONB en vez de texto validado con json_valid().
--
-- Los identificadores siguen generándose EN EL CLIENTE: no hay DEFAULT
-- gen_random_uuid() a propósito. El id de una venta se crea en la máquina de
-- la tienda, sin internet, y viaja tal cual a la nube; si el servidor generara
-- uno propio, el mismo registro tendría dos identidades.
--
-- PISOS DE NO NEGATIVIDAD: aquí sí se escriben como `CHECK (col >= 0)`, porque
-- NUMERIC compara como número. En SQLite hubo que escribirlos como
-- `NOT col GLOB '-*'`: allí las columnas son TEXT y el orden entre tipos hace
-- que cualquier texto resulte mayor que 0, con lo cual `>= 0` aceptaría '-5.000'.
-- Los campos que quedan SIN piso lo dicen en un comentario, para que ninguna
-- sesión futura los "corrija" por error: son los que el módulo de devoluciones
-- necesitará en negativo.
--
-- Plan gratuito de Supabase: este script no usa ninguna característica de pago
-- (sin particionado, sin réplicas, sin extensiones adicionales, sin PITR).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuarios (
  id             UUID        PRIMARY KEY,
  nombre         TEXT        NOT NULL UNIQUE CHECK (length(btrim(nombre)) > 0),
  rol            TEXT        NOT NULL CHECK (rol IN ('venta', 'administrativo')),
  pin_hash       TEXT        NOT NULL CHECK (length(pin_hash) > 0),
  activo         BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usuarios_rol    ON public.usuarios (rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON public.usuarios (activo);

-- ---------------------------------------------------------------------------
-- 2. categorias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categorias (
  id             UUID        PRIMARY KEY,
  nombre         TEXT        NOT NULL UNIQUE CHECK (length(btrim(nombre)) > 0),
  orden          INTEGER     NOT NULL DEFAULT 0 CHECK (orden >= 0),
  creado_en      TIMESTAMPTZ NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categorias_orden ON public.categorias (orden);

-- ---------------------------------------------------------------------------
-- 3. productos
-- ---------------------------------------------------------------------------
-- inventario_disponible es UN SOLO saldo acumulado por producto. No hay lotes.
CREATE TABLE IF NOT EXISTS public.productos (
  id                         UUID           PRIMARY KEY,
  nombre                     TEXT           NOT NULL UNIQUE CHECK (length(btrim(nombre)) > 0),
  categoria_id               UUID           NOT NULL REFERENCES public.categorias (id) ON DELETE RESTRICT,
  foto_path                  TEXT,
  tipo_medida                TEXT           NOT NULL CHECK (tipo_medida IN ('unidad', 'peso')),
  unidad_peso                TEXT           CHECK (unidad_peso IS NULL OR unidad_peso IN ('lb', 'kg')),
  -- ESTRICTAMENTE mayor que 0, no solo no negativo: un ícono que agrega cero
  -- unidades al carrito sería un botón que no hace nada.
  cantidad_predefinida_icono NUMERIC(14, 3) NOT NULL CHECK (cantidad_predefinida_icono > 0),
  -- Un precio no puede ser negativo: el producto no le paga al cliente por
  -- llevárselo. Se permite 0, para muestras y regalos.
  precio_base                NUMERIC(14, 2) NOT NULL CHECK (precio_base >= 0),
  -- PISO 0 DEL INVENTARIO: la barrera que impide vender más de lo que hay.
  -- Lleva nombre para que la capa de acceso a datos pueda traducir el error a
  -- "Stock insuficiente para completar la venta" en vez de dejar pasar el
  -- error crudo de Postgres.
  inventario_disponible      NUMERIC(14, 3) NOT NULL
    CONSTRAINT productos_inventario_no_negativo CHECK (inventario_disponible >= 0),
  contador_ventas            INTEGER        NOT NULL DEFAULT 0 CHECK (contador_ventas >= 0),
  activo                     BOOLEAN        NOT NULL DEFAULT TRUE,
  creado_en                  TIMESTAMPTZ    NOT NULL,
  actualizado_en             TIMESTAMPTZ    NOT NULL,

  CONSTRAINT productos_unidad_coherente CHECK (
    (tipo_medida = 'peso'   AND unidad_peso IS NOT NULL) OR
    (tipo_medida = 'unidad' AND unidad_peso IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_productos_categoria ON public.productos (categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_activo    ON public.productos (activo);
CREATE INDEX IF NOT EXISTS idx_productos_populares ON public.productos (activo, contador_ventas DESC);

-- ---------------------------------------------------------------------------
-- 4. precios_especiales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.precios_especiales (
  id             UUID           PRIMARY KEY,
  producto_id    UUID           NOT NULL REFERENCES public.productos (id) ON DELETE CASCADE,
  tipo           TEXT           NOT NULL CHECK (tipo IN ('porcentaje', 'monto_fijo')),
  -- Un descuento negativo sería un recargo encubierto que se saltaría el
  -- control de límites por rol. Se permite 0 (equivale a "sin descuento").
  valor          NUMERIC(14, 2) NOT NULL CHECK (valor >= 0),
  vigente_desde  TIMESTAMPTZ    NOT NULL,
  vigente_hasta  TIMESTAMPTZ,
  activo         BOOLEAN        NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ    NOT NULL,
  actualizado_en TIMESTAMPTZ    NOT NULL,

  CONSTRAINT precios_especiales_vigencia_coherente
    CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_precios_especiales_producto ON public.precios_especiales (producto_id);
CREATE INDEX IF NOT EXISTS idx_precios_especiales_vigencia
  ON public.precios_especiales (activo, vigente_desde, vigente_hasta);

-- ---------------------------------------------------------------------------
-- 5. limites_descuento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.limites_descuento (
  id                       UUID           PRIMARY KEY,
  rol                      TEXT           NOT NULL UNIQUE CHECK (rol IN ('venta', 'administrativo')),
  -- Se permite 0 y es significativo: quiere decir que ese rol no puede
  -- aplicar ningún descuento. Un tope negativo no significaría nada.
  descuento_max_porcentaje NUMERIC(14, 2) NOT NULL CHECK (descuento_max_porcentaje >= 0),
  -- Igual que el porcentaje: 0 es "este rol no da descuento".
  descuento_max_monto_fijo NUMERIC(14, 2) NOT NULL CHECK (descuento_max_monto_fijo >= 0),
  editado_por              UUID           REFERENCES public.usuarios (id) ON DELETE SET NULL,
  creado_en                TIMESTAMPTZ    NOT NULL,
  actualizado_en           TIMESTAMPTZ    NOT NULL
);

-- ---------------------------------------------------------------------------
-- 6. caja_sesiones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.caja_sesiones (
  id             UUID           PRIMARY KEY,
  usuario_id     UUID           NOT NULL REFERENCES public.usuarios (id) ON DELETE RESTRICT,
  -- AGREGADO MÁS ALLÁ DE LA LISTA PEDIDA: el fondo con que se abre la caja
  -- no puede ser negativo. Se permite 0 (abrir sin fondo).
  monto_inicial  NUMERIC(14, 2) NOT NULL CHECK (monto_inicial >= 0),
  abierta_en     TIMESTAMPTZ    NOT NULL,
  -- SIN PISO A PROPÓSITO: con devoluciones, lo esperado en caja podría ser
  -- negativo. NO agregar aquí un CHECK de no negatividad.
  monto_esperado NUMERIC(14, 2),
  -- AGREGADO MÁS ALLÁ DE LA LISTA PEDIDA: el efectivo contado físicamente
  -- en la caja no puede ser negativo.
  monto_real     NUMERIC(14, 2) CHECK (monto_real IS NULL OR monto_real >= 0),
  -- SIN PISO A PROPÓSITO: un faltante de caja ES negativo.
  diferencia     NUMERIC(14, 2),
  cerrada_en     TIMESTAMPTZ,
  estado         TEXT           NOT NULL CHECK (estado IN ('abierta', 'cerrada')),
  creado_en      TIMESTAMPTZ    NOT NULL,
  actualizado_en TIMESTAMPTZ    NOT NULL,

  CONSTRAINT caja_sesiones_cierre_completo CHECK (
    (estado = 'abierta' AND cerrada_en IS NULL AND monto_esperado IS NULL
       AND monto_real IS NULL AND diferencia IS NULL)
    OR
    (estado = 'cerrada' AND cerrada_en IS NOT NULL AND monto_esperado IS NOT NULL
       AND monto_real IS NOT NULL AND diferencia IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_usuario ON public.caja_sesiones (usuario_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_estado  ON public.caja_sesiones (estado, abierta_en);
-- Un cajero no puede tener dos turnos abiertos a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_sesiones_una_abierta
  ON public.caja_sesiones (usuario_id) WHERE estado = 'abierta';

-- ---------------------------------------------------------------------------
-- 7. ventas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ventas (
  id                       UUID           PRIMARY KEY,
  caja_sesion_id           UUID           NOT NULL REFERENCES public.caja_sesiones (id) ON DELETE RESTRICT,
  usuario_id               UUID           NOT NULL REFERENCES public.usuarios (id) ON DELETE RESTRICT,
  fecha                    TIMESTAMPTZ    NOT NULL,
  -- SIN PISO A PROPÓSITO: admite negativos, reservados para el futuro módulo
  -- de devoluciones. NO agregar aquí un CHECK de no negatividad.
  subtotal                 NUMERIC(14, 2) NOT NULL,
  descuento_tipo           TEXT           CHECK (descuento_tipo IS NULL OR descuento_tipo IN ('porcentaje', 'monto_fijo')),
  -- SIN PISO A PROPÓSITO: ver la nota de subtotal.
  descuento_valor          NUMERIC(14, 2),
  descuento_autorizado_por UUID           REFERENCES public.usuarios (id) ON DELETE SET NULL,
  -- SIN PISO A PROPÓSITO: una devolución tendrá total negativo.
  total                    NUMERIC(14, 2) NOT NULL,
  forma_pago               TEXT           NOT NULL CHECK (forma_pago IN ('efectivo', 'tarjeta')),
  num_boleta               TEXT,
  estado                   TEXT           NOT NULL CHECK (estado IN ('completada', 'anulada')),
  estado_sincronizacion    TEXT           NOT NULL DEFAULT 'pendiente'
                             CHECK (estado_sincronizacion IN ('pendiente', 'sincronizado', 'error')),
  creado_en                TIMESTAMPTZ    NOT NULL,
  actualizado_en           TIMESTAMPTZ    NOT NULL,

  CONSTRAINT ventas_descuento_completo CHECK (
    (descuento_tipo IS NULL AND descuento_valor IS NULL) OR
    (descuento_tipo IS NOT NULL AND descuento_valor IS NOT NULL)
  ),
  CONSTRAINT ventas_autorizacion_requiere_descuento
    CHECK (descuento_autorizado_por IS NULL OR descuento_tipo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_ventas_fecha       ON public.ventas (fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_caja_sesion ON public.ventas (caja_sesion_id);
CREATE INDEX IF NOT EXISTS idx_ventas_usuario     ON public.ventas (usuario_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_estado      ON public.ventas (estado, fecha);

-- ---------------------------------------------------------------------------
-- 8. venta_detalle
-- ---------------------------------------------------------------------------
-- Las columnas *_snap son COPIAS del dato al momento de la venta, no
-- referencias vivas: el recibo histórico no cambia si el producto cambia.
CREATE TABLE IF NOT EXISTS public.venta_detalle (
  id                   UUID           PRIMARY KEY,
  venta_id             UUID           NOT NULL REFERENCES public.ventas (id) ON DELETE CASCADE,
  producto_id          UUID           NOT NULL REFERENCES public.productos (id) ON DELETE RESTRICT,
  producto_nombre_snap TEXT           NOT NULL CHECK (length(btrim(producto_nombre_snap)) > 0),
  unidad_snap          TEXT           NOT NULL CHECK (length(btrim(unidad_snap)) > 0),
  -- SIN PISO A PROPÓSITO: una devolución llevará cantidad negativa.
  cantidad             NUMERIC(14, 3) NOT NULL,
  -- Es la foto de precio_base al momento de la venta, y hereda su regla:
  -- nunca negativo, 0 permitido para una muestra o un regalo.
  precio_unitario_snap NUMERIC(14, 2) NOT NULL CHECK (precio_unitario_snap >= 0),
  -- Sin redondear: de aquí sale el total real.
  -- SIN PISO A PROPÓSITO: ver la nota de cantidad.
  subtotal_exacto      NUMERIC(18, 6) NOT NULL,
  -- Conciliado: la suma de estos valores es exactamente ventas.total.
  -- SIN PISO A PROPÓSITO: ver la nota de cantidad.
  subtotal_impreso     NUMERIC(14, 2) NOT NULL,
  -- El orden de captura decide el desempate del reparto de centavos.
  orden_linea          INTEGER        NOT NULL CHECK (orden_linea >= 0),
  creado_en            TIMESTAMPTZ    NOT NULL,

  CONSTRAINT venta_detalle_orden_unico UNIQUE (venta_id, orden_linea)
);

CREATE INDEX IF NOT EXISTS idx_venta_detalle_venta    ON public.venta_detalle (venta_id, orden_linea);
CREATE INDEX IF NOT EXISTS idx_venta_detalle_producto ON public.venta_detalle (producto_id);

-- ---------------------------------------------------------------------------
-- 9. recibos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recibos (
  id            UUID        PRIMARY KEY,
  venta_id      UUID        NOT NULL UNIQUE REFERENCES public.ventas (id) ON DELETE CASCADE,
  numero_recibo BIGINT      NOT NULL UNIQUE CHECK (numero_recibo > 0),
  pdf_path      TEXT        NOT NULL CHECK (length(btrim(pdf_path)) > 0),
  impreso       BOOLEAN     NOT NULL DEFAULT FALSE,
  creado_en     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recibos_creado ON public.recibos (creado_en);

-- ---------------------------------------------------------------------------
-- 10. auditoria_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auditoria_log (
  id             UUID        PRIMARY KEY,
  usuario_id     UUID        REFERENCES public.usuarios (id) ON DELETE SET NULL,
  accion         TEXT        NOT NULL CHECK (length(btrim(accion)) > 0),
  entidad_tipo   TEXT        NOT NULL CHECK (length(btrim(entidad_tipo)) > 0),
  entidad_id     UUID,
  valor_anterior JSONB,
  valor_nuevo    JSONB,
  fecha          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auditoria_fecha   ON public.auditoria_log (fecha);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON public.auditoria_log (entidad_tipo, entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON public.auditoria_log (usuario_id, fecha);

-- ===========================================================================
-- SEGURIDAD A NIVEL DE FILA
-- ===========================================================================
-- Supabase publica automáticamente las tablas de `public` a través de su API.
-- Sin RLS activo, cualquiera con la llave anónima —que va dentro de la
-- aplicación instalada— podría leer y escribir las ventas de la tienda.
--
-- Se activa RLS SIN crear políticas: eso deniega todo por omisión. La
-- sincronización usará una llave de servicio, que ignora RLS por diseño.
-- Cuando exista el módulo de sincronización se agregarán las políticas que
-- correspondan, en su propia migración.
ALTER TABLE public.usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios_especiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.limites_descuento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_sesiones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_detalle      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recibos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_log      ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- INMUTABILIDAD DE LA BITÁCORA DE AUDITORÍA
-- ===========================================================================
-- Espejo del trigger local: un registro de auditoría que se puede editar no
-- sirve como evidencia.
CREATE OR REPLACE FUNCTION public.auditoria_log_es_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora de auditoría es inmutable: no se puede modificar ni borrar un asiento.';
END;
$$;

DROP TRIGGER IF EXISTS auditoria_log_prohibir_cambios ON public.auditoria_log;
CREATE TRIGGER auditoria_log_prohibir_cambios
BEFORE UPDATE OR DELETE ON public.auditoria_log
FOR EACH ROW EXECUTE FUNCTION public.auditoria_log_es_inmutable();
