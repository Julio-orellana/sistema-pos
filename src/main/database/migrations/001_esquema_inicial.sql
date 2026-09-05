-- ===========================================================================
-- 001_esquema_inicial.sql — Esquema inicial del POS Agrícola (SQLite local)
-- ===========================================================================
--
-- DOS REGLAS QUE ATRAVIESAN TODO ESTE ARCHIVO
--
-- 1. CLAVES PRIMARIAS UUID, GENERADAS EN EL CLIENTE.
--    Nunca AUTOINCREMENT. La tienda vende sin internet y sincroniza después:
--    con enteros autoincrementales, dos registros creados offline en máquinas
--    distintas tendrían el mismo id y colisionarían al subir a Supabase. Un
--    UUID generado al crear el registro es único desde el primer momento.
--
-- 2. DINERO, PESO Y CANTIDAD SE GUARDAN COMO TEXT, JAMÁS COMO REAL.
--    SQLite REAL es punto flotante de 64 bits: exactamente lo que money.ts
--    existe para evitar. Guardar 16.80 como REAL puede recuperarse como
--    16.799999999999997 y descuadrar el corte de caja.
--
--    Cada columna decimal lleva una restricción CHECK que NO es decorativa, y
--    que es más estricta de lo que parece necesario por un motivo concreto:
--
--    Una columna declarada TEXT tiene AFINIDAD TEXT, y SQLite convierte por su
--    cuenta un número a texto antes de guardarlo. Es decir, `typeof(col)='text'`
--    NO alcanza: si alguien liga el número 0.30000000000000004, SQLite lo
--    guarda como la cadena '0.30000000000000004' y el typeof pasa igual.
--    (Comprobado; ver la prueba "un float de JavaScript ligado directamente es
--    rechazado" en restricciones.test.ts.)
--
--    Por eso la restricción exige además la FORMA CANÓNICA exacta:
--
--      · Montos de dinero  -> exactamente 2 decimales:  '16.80'  ('16.8' se rechaza)
--      · Pesos y cantidades -> exactamente 3 decimales: '60.000' ('60.0' se rechaza)
--      · Valores exactos   -> hasta 10 decimales, que es más de lo que produce
--                             cualquier cálculo legítimo del sistema y menos de
--                             los 17 que delatan un float
--
--    Además se prohíben dos puntos decimales y un signo menos fuera del inicio.
--
--    La única vía autorizada para escribir y leer estas columnas es
--    src/main/database/decimal-columns.ts. Ninguna consulta del resto del
--    proyecto debe tratar estos valores como número.
--
-- Convención de fechas: cadena ISO-8601 en UTC ("2026-09-05T05:48:16.489Z").
-- Convención de booleanos: INTEGER 0 o 1, que es como los representa SQLite.
-- ===========================================================================

-- Limpieza del andamiaje: la tabla de prueba del Prompt 1 ya cumplió su
-- función de verificar que better-sqlite3 conectaba.
DROP TABLE IF EXISTS prueba_conexion;

-- ---------------------------------------------------------------------------
-- 1. usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id             TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  nombre         TEXT    NOT NULL UNIQUE CHECK (length(trim(nombre)) > 0),
  rol            TEXT    NOT NULL CHECK (rol IN ('venta', 'administrativo')),
  -- Nunca el PIN en claro: solo su hash. Ver src/main/security/admin-pin.ts.
  pin_hash       TEXT    NOT NULL CHECK (length(pin_hash) > 0),
  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en      TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);

CREATE INDEX IF NOT EXISTS idx_usuarios_rol    ON usuarios (rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON usuarios (activo);

-- ---------------------------------------------------------------------------
-- 2. categorias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
  id             TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  nombre         TEXT    NOT NULL UNIQUE CHECK (length(trim(nombre)) > 0),
  -- Posición en la pantalla de venta. Menor número, más arriba.
  orden          INTEGER NOT NULL DEFAULT 0 CHECK (orden >= 0),
  creado_en      TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);

CREATE INDEX IF NOT EXISTS idx_categorias_orden ON categorias (orden);

-- ---------------------------------------------------------------------------
-- 3. productos
-- ---------------------------------------------------------------------------
-- inventario_disponible es UN SOLO SALDO ACUMULADO por producto. No hay lotes:
-- cuando llegan 50 sacos y ya había 10, el saldo pasa a 60. Así opera la
-- tienda y así se modela (ver el registro de decisiones en CLAUDE.md).
CREATE TABLE IF NOT EXISTS productos (
  id                         TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  nombre                     TEXT    NOT NULL UNIQUE CHECK (length(trim(nombre)) > 0),
  categoria_id               TEXT    NOT NULL REFERENCES categorias (id) ON DELETE RESTRICT,
  foto_path                  TEXT,
  tipo_medida                TEXT    NOT NULL CHECK (tipo_medida IN ('unidad', 'peso')),
  unidad_peso                TEXT    CHECK (unidad_peso IS NULL OR unidad_peso IN ('lb', 'kg')),

  cantidad_predefinida_icono TEXT    NOT NULL
    CHECK (typeof(cantidad_predefinida_icono) = 'text'
           AND (cantidad_predefinida_icono GLOB '[0-9]*.[0-9][0-9][0-9]' OR cantidad_predefinida_icono GLOB '-[0-9]*.[0-9][0-9][0-9]')
           AND NOT cantidad_predefinida_icono GLOB '*.*.*'
           AND NOT cantidad_predefinida_icono GLOB '?*-*'),

  precio_base                TEXT    NOT NULL
    CHECK (typeof(precio_base) = 'text'
           AND (precio_base GLOB '[0-9]*.[0-9][0-9]' OR precio_base GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT precio_base GLOB '*.*.*'
           AND NOT precio_base GLOB '?*-*'),

  inventario_disponible      TEXT    NOT NULL
    CHECK (typeof(inventario_disponible) = 'text'
           AND (inventario_disponible GLOB '[0-9]*.[0-9][0-9][0-9]' OR inventario_disponible GLOB '-[0-9]*.[0-9][0-9][0-9]')
           AND NOT inventario_disponible GLOB '*.*.*'
           AND NOT inventario_disponible GLOB '?*-*'),

  -- Cuántas veces se vendió. Ordena los íconos de la pantalla de venta y DEBE
  -- actualizarse dentro de la misma transacción que registra la venta.
  contador_ventas            INTEGER NOT NULL DEFAULT 0 CHECK (contador_ventas >= 0),
  activo                     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en                  TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en             TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z'),

  -- Un producto por peso necesita unidad; uno por unidad no puede tenerla.
  CHECK (
    (tipo_medida = 'peso'   AND unidad_peso IS NOT NULL) OR
    (tipo_medida = 'unidad' AND unidad_peso IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos (categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_activo    ON productos (activo);
-- Ordenamiento dinámico de íconos: los más vendidos primero.
CREATE INDEX IF NOT EXISTS idx_productos_populares ON productos (activo, contador_ventas DESC);

-- ---------------------------------------------------------------------------
-- 4. precios_especiales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS precios_especiales (
  id             TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  producto_id    TEXT    NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  tipo           TEXT    NOT NULL CHECK (tipo IN ('porcentaje', 'monto_fijo')),

  valor          TEXT    NOT NULL
    CHECK (typeof(valor) = 'text'
           AND (valor GLOB '[0-9]*.[0-9][0-9]' OR valor GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT valor GLOB '*.*.*'
           AND NOT valor GLOB '?*-*'),

  vigente_desde  TEXT    NOT NULL CHECK (vigente_desde LIKE '____-__-__T__:__:__%Z'),
  vigente_hasta  TEXT    CHECK (vigente_hasta IS NULL OR vigente_hasta LIKE '____-__-__T__:__:__%Z'),
  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en      TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z'),

  -- Una vigencia que termina antes de empezar es un error de captura.
  CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_precios_especiales_producto ON precios_especiales (producto_id);
CREATE INDEX IF NOT EXISTS idx_precios_especiales_vigencia ON precios_especiales (activo, vigente_desde, vigente_hasta);

-- ---------------------------------------------------------------------------
-- 5. limites_descuento
-- ---------------------------------------------------------------------------
-- Un único límite vigente por rol: por eso rol es UNIQUE.
CREATE TABLE IF NOT EXISTS limites_descuento (
  id                       TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  rol                      TEXT NOT NULL UNIQUE CHECK (rol IN ('venta', 'administrativo')),

  descuento_max_porcentaje TEXT NOT NULL
    CHECK (typeof(descuento_max_porcentaje) = 'text'
           AND (descuento_max_porcentaje GLOB '[0-9]*.[0-9][0-9]' OR descuento_max_porcentaje GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT descuento_max_porcentaje GLOB '*.*.*'
           AND NOT descuento_max_porcentaje GLOB '?*-*'),

  descuento_max_monto_fijo TEXT NOT NULL
    CHECK (typeof(descuento_max_monto_fijo) = 'text'
           AND (descuento_max_monto_fijo GLOB '[0-9]*.[0-9][0-9]' OR descuento_max_monto_fijo GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT descuento_max_monto_fijo GLOB '*.*.*'
           AND NOT descuento_max_monto_fijo GLOB '?*-*'),

  -- Si se borra el usuario, el límite sobrevive pero pierde el autor.
  editado_por              TEXT REFERENCES usuarios (id) ON DELETE SET NULL,
  creado_en                TEXT NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en           TEXT NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);

-- ---------------------------------------------------------------------------
-- 6. caja_sesiones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caja_sesiones (
  id             TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  usuario_id     TEXT NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,

  monto_inicial  TEXT NOT NULL
    CHECK (typeof(monto_inicial) = 'text'
           AND (monto_inicial GLOB '[0-9]*.[0-9][0-9]' OR monto_inicial GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT monto_inicial GLOB '*.*.*'
           AND NOT monto_inicial GLOB '?*-*'),

  abierta_en     TEXT NOT NULL CHECK (abierta_en LIKE '____-__-__T__:__:__%Z'),

  -- Los tres montos del cierre son nulos hasta que la caja se cierra.
  monto_esperado TEXT
    CHECK (monto_esperado IS NULL OR (
             typeof(monto_esperado) = 'text'
             AND (monto_esperado GLOB '[0-9]*.[0-9][0-9]' OR monto_esperado GLOB '-[0-9]*.[0-9][0-9]')
             AND NOT monto_esperado GLOB '*.*.*'
             AND NOT monto_esperado GLOB '?*-*')),

  monto_real     TEXT
    CHECK (monto_real IS NULL OR (
             typeof(monto_real) = 'text'
             AND (monto_real GLOB '[0-9]*.[0-9][0-9]' OR monto_real GLOB '-[0-9]*.[0-9][0-9]')
             AND NOT monto_real GLOB '*.*.*'
             AND NOT monto_real GLOB '?*-*')),

  diferencia     TEXT
    CHECK (diferencia IS NULL OR (
             typeof(diferencia) = 'text'
             AND (diferencia GLOB '[0-9]*.[0-9][0-9]' OR diferencia GLOB '-[0-9]*.[0-9][0-9]')
             AND NOT diferencia GLOB '*.*.*'
             AND NOT diferencia GLOB '?*-*')),

  cerrada_en     TEXT CHECK (cerrada_en IS NULL OR cerrada_en LIKE '____-__-__T__:__:__%Z'),
  estado         TEXT NOT NULL CHECK (estado IN ('abierta', 'cerrada')),
  creado_en      TEXT NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en TEXT NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z'),

  -- Una caja cerrada sin cuadre es un corte a medias: se prohíbe.
  CHECK (
    (estado = 'abierta' AND cerrada_en IS NULL AND monto_esperado IS NULL
       AND monto_real IS NULL AND diferencia IS NULL)
    OR
    (estado = 'cerrada' AND cerrada_en IS NOT NULL AND monto_esperado IS NOT NULL
       AND monto_real IS NOT NULL AND diferencia IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_usuario ON caja_sesiones (usuario_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_estado  ON caja_sesiones (estado, abierta_en);
-- Un cajero no puede tener dos turnos abiertos a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_sesiones_una_abierta
  ON caja_sesiones (usuario_id) WHERE estado = 'abierta';

-- ---------------------------------------------------------------------------
-- 7. ventas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ventas (
  id                       TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  caja_sesion_id           TEXT NOT NULL REFERENCES caja_sesiones (id) ON DELETE RESTRICT,
  usuario_id               TEXT NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  fecha                    TEXT NOT NULL CHECK (fecha LIKE '____-__-__T__:__:__%Z'),

  subtotal                 TEXT NOT NULL
    CHECK (typeof(subtotal) = 'text'
           AND (subtotal GLOB '[0-9]*.[0-9][0-9]' OR subtotal GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT subtotal GLOB '*.*.*'
           AND NOT subtotal GLOB '?*-*'),

  descuento_tipo           TEXT CHECK (descuento_tipo IS NULL OR descuento_tipo IN ('porcentaje', 'monto_fijo')),

  descuento_valor          TEXT
    CHECK (descuento_valor IS NULL OR (
             typeof(descuento_valor) = 'text'
             AND (descuento_valor GLOB '[0-9]*.[0-9][0-9]' OR descuento_valor GLOB '-[0-9]*.[0-9][0-9]')
             AND NOT descuento_valor GLOB '*.*.*'
             AND NOT descuento_valor GLOB '?*-*')),

  -- Se llena SOLO si un administrador autorizó exceder el límite con su PIN.
  descuento_autorizado_por TEXT REFERENCES usuarios (id) ON DELETE SET NULL,

  -- El importe final que paga el cliente, redondeado una sola vez.
  total                    TEXT NOT NULL
    CHECK (typeof(total) = 'text'
           AND (total GLOB '[0-9]*.[0-9][0-9]' OR total GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT total GLOB '*.*.*'
           AND NOT total GLOB '?*-*'),

  forma_pago               TEXT NOT NULL CHECK (forma_pago IN ('efectivo', 'tarjeta')),
  num_boleta               TEXT,
  estado                   TEXT NOT NULL CHECK (estado IN ('completada', 'anulada')),
  estado_sincronizacion    TEXT NOT NULL DEFAULT 'pendiente'
                             CHECK (estado_sincronizacion IN ('pendiente', 'sincronizado', 'error')),
  creado_en                TEXT NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),
  actualizado_en           TEXT NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z'),

  -- Un tipo de descuento sin valor (o al revés) es un registro incompleto.
  CHECK (
    (descuento_tipo IS NULL AND descuento_valor IS NULL) OR
    (descuento_tipo IS NOT NULL AND descuento_valor IS NOT NULL)
  ),
  -- No puede haber autorización de descuento si no hay descuento.
  CHECK (descuento_autorizado_por IS NULL OR descuento_tipo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_ventas_fecha       ON ventas (fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_caja_sesion ON ventas (caja_sesion_id);
CREATE INDEX IF NOT EXISTS idx_ventas_usuario     ON ventas (usuario_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_estado      ON ventas (estado, fecha);
-- La cola de sincronización consulta constantemente lo que falta subir.
CREATE INDEX IF NOT EXISTS idx_ventas_sincronizacion ON ventas (estado_sincronizacion)
  WHERE estado_sincronizacion <> 'sincronizado';

-- ---------------------------------------------------------------------------
-- 8. venta_detalle
-- ---------------------------------------------------------------------------
-- Las columnas *_snap son COPIAS del dato al momento de la venta, no
-- referencias vivas. Si mañana el producto cambia de nombre o de precio, el
-- recibo histórico debe seguir diciendo lo que decía el día que se imprimió.
CREATE TABLE IF NOT EXISTS venta_detalle (
  id                   TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  venta_id             TEXT    NOT NULL REFERENCES ventas (id) ON DELETE CASCADE,
  producto_id          TEXT    NOT NULL REFERENCES productos (id) ON DELETE RESTRICT,
  producto_nombre_snap TEXT    NOT NULL CHECK (length(trim(producto_nombre_snap)) > 0),
  unidad_snap          TEXT    NOT NULL CHECK (length(trim(unidad_snap)) > 0),

  cantidad             TEXT    NOT NULL
    CHECK (typeof(cantidad) = 'text'
           AND (cantidad GLOB '[0-9]*.[0-9][0-9][0-9]' OR cantidad GLOB '-[0-9]*.[0-9][0-9][0-9]')
           AND NOT cantidad GLOB '*.*.*'
           AND NOT cantidad GLOB '?*-*'),

  precio_unitario_snap TEXT    NOT NULL
    CHECK (typeof(precio_unitario_snap) = 'text'
           AND (precio_unitario_snap GLOB '[0-9]*.[0-9][0-9]' OR precio_unitario_snap GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT precio_unitario_snap GLOB '*.*.*'
           AND NOT precio_unitario_snap GLOB '?*-*'),

  -- Valor SIN redondear: es el que suma para calcular el total real.
  subtotal_exacto      TEXT    NOT NULL
    CHECK (typeof(subtotal_exacto) = 'text'
           AND (subtotal_exacto GLOB '[0-9]*' OR subtotal_exacto GLOB '-[0-9]*')
           AND NOT subtotal_exacto GLOB '*[^0-9.-]*'
           AND NOT subtotal_exacto GLOB '*.*.*'
           AND NOT subtotal_exacto GLOB '?*-*'
           AND NOT subtotal_exacto GLOB '*.[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'),

  -- Valor conciliado que aparece en el recibo. La suma de los subtotal_impreso
  -- de una venta es exactamente ventas.total (ver conciliarSubtotalesConTotal).
  subtotal_impreso     TEXT    NOT NULL
    CHECK (typeof(subtotal_impreso) = 'text'
           AND (subtotal_impreso GLOB '[0-9]*.[0-9][0-9]' OR subtotal_impreso GLOB '-[0-9]*.[0-9][0-9]')
           AND NOT subtotal_impreso GLOB '*.*.*'
           AND NOT subtotal_impreso GLOB '?*-*'),

  -- El orden de captura decide el desempate del reparto de centavos, así que
  -- se preserva exactamente: sin él, reimprimir un recibo podría dar otro
  -- reparto. Ver la regla de desempate en el registro de decisiones.
  orden_linea          INTEGER NOT NULL CHECK (orden_linea >= 0),
  creado_en            TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z'),

  UNIQUE (venta_id, orden_linea)
);

CREATE INDEX IF NOT EXISTS idx_venta_detalle_venta    ON venta_detalle (venta_id, orden_linea);
CREATE INDEX IF NOT EXISTS idx_venta_detalle_producto ON venta_detalle (producto_id);

-- ---------------------------------------------------------------------------
-- 9. recibos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recibos (
  id            TEXT    PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  venta_id      TEXT    NOT NULL UNIQUE REFERENCES ventas (id) ON DELETE CASCADE,
  numero_recibo INTEGER NOT NULL UNIQUE CHECK (numero_recibo > 0),
  -- El PDF siempre existe, haya o no impresora (decisión del Prompt 1).
  pdf_path      TEXT    NOT NULL CHECK (length(trim(pdf_path)) > 0),
  impreso       INTEGER NOT NULL DEFAULT 0 CHECK (impreso IN (0, 1)),
  creado_en     TEXT    NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z')
);

CREATE INDEX IF NOT EXISTS idx_recibos_creado ON recibos (creado_en);

-- ---------------------------------------------------------------------------
-- 10. auditoria_log
-- ---------------------------------------------------------------------------
-- usuario_id admite NULL para las acciones del propio sistema (arranque,
-- migración, sincronización), que no tienen una persona detrás.
CREATE TABLE IF NOT EXISTS auditoria_log (
  id              TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  usuario_id      TEXT REFERENCES usuarios (id) ON DELETE SET NULL,
  accion          TEXT NOT NULL CHECK (length(trim(accion)) > 0),
  entidad_tipo    TEXT NOT NULL CHECK (length(trim(entidad_tipo)) > 0),
  entidad_id      TEXT,
  valor_anterior  TEXT CHECK (valor_anterior IS NULL OR json_valid(valor_anterior)),
  valor_nuevo     TEXT CHECK (valor_nuevo IS NULL OR json_valid(valor_nuevo)),
  fecha           TEXT NOT NULL CHECK (fecha LIKE '____-__-__T__:__:__%Z')
);

CREATE INDEX IF NOT EXISTS idx_auditoria_fecha   ON auditoria_log (fecha);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON auditoria_log (entidad_tipo, entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria_log (usuario_id, fecha);

-- La bitácora de auditoría es INMUTABLE: se escribe una vez y no se toca. Un
-- log que se puede editar no sirve como evidencia, así que la base misma
-- rechaza cualquier intento de modificarlo o borrarlo.
CREATE TRIGGER IF NOT EXISTS auditoria_log_prohibir_update
BEFORE UPDATE ON auditoria_log
BEGIN
  SELECT RAISE(ABORT, 'La bitácora de auditoría es inmutable: no se puede modificar un asiento.');
END;

CREATE TRIGGER IF NOT EXISTS auditoria_log_prohibir_delete
BEFORE DELETE ON auditoria_log
BEGIN
  SELECT RAISE(ABORT, 'La bitácora de auditoría es inmutable: no se puede borrar un asiento.');
END;

-- ---------------------------------------------------------------------------
-- 11. sync_cola
-- ---------------------------------------------------------------------------
-- TABLA EXCLUSIVAMENTE LOCAL: no tiene espejo en Supabase. Es el registro de
-- qué falta subir; subirla sería subir la lista de pendientes junto con los
-- pendientes.
CREATE TABLE IF NOT EXISTS sync_cola (
  id              TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  entidad_tipo    TEXT NOT NULL CHECK (length(trim(entidad_tipo)) > 0),
  entidad_id      TEXT NOT NULL CHECK (length(trim(entidad_id)) > 0),
  operacion       TEXT NOT NULL CHECK (operacion IN ('insertar', 'actualizar', 'eliminar')),
  payload         TEXT NOT NULL CHECK (json_valid(payload)),
  intentado_en    TEXT CHECK (intentado_en IS NULL OR intentado_en LIKE '____-__-__T__:__:__%Z'),
  sincronizado_en TEXT CHECK (sincronizado_en IS NULL OR sincronizado_en LIKE '____-__-__T__:__:__%Z'),
  error           TEXT,
  creado_en       TEXT NOT NULL CHECK (creado_en LIKE '____-__-__T__:__:__%Z')
);

-- La consulta de siempre: qué falta subir, en orden de llegada.
CREATE INDEX IF NOT EXISTS idx_sync_cola_pendientes ON sync_cola (creado_en)
  WHERE sincronizado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_sync_cola_entidad ON sync_cola (entidad_tipo, entidad_id);
