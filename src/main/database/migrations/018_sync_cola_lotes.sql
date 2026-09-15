-- ===========================================================================
-- 018_sync_cola_lotes.sql — Lo que la bandeja de salida necesita de la cola
-- ===========================================================================
--
-- `sync_cola` existe desde la migración 001, pero hasta hoy **nadie escribía en
-- ella fuera de las pruebas**: era andamiaje sin conectar. Esta migración le
-- agrega las cinco columnas que el diseño de `docs/SINCRONIZACION.md` §2.4 pide
-- para que un trabajador de sincronización pueda hacer su trabajo, y la
-- Fase 1.a empieza a llenarla de verdad.
--
-- NO SE ESPEJA EN POSTGRES, y no es un olvido: `sync_cola` es la lista local de
-- qué falta subir. Subirla sería subir la lista de pendientes junto con los
-- pendientes. Ver `supabase/migrations/README.md` y CLAUDE.md §4.4. Por eso no
-- hay ningún `0018_...` en la carpeta de Supabase, igual que no hay 0002, 0003,
-- 0006, 0011 ni 0013.
--
-- ---------------------------------------------------------------------------
-- QUÉ APORTA CADA COLUMNA
-- ---------------------------------------------------------------------------
--   lote_id             Agrupa las filas de UNA unidad de trabajo. Una venta
--                       escribe en cuatro tablas y las cuatro comparten lote:
--                       o suben juntas o no sube ninguna (§4.3, opción B).
--   orden_en_lote       Padres antes que hijos DENTRO del lote. Sin esto, subir
--                       `venta_detalle` antes que `ventas` lo rechaza la llave
--                       foránea de Postgres.
--   intentos            Cuántas veces se intentó. Alimenta el backoff y el
--                       aviso de «lleva N intentos» (§3.2, §3.3).
--   proximo_intento_en  Cuándo reintentar. Se PERSISTE a propósito: si viviera
--                       en memoria, un cierre forzado —que este proyecto
--                       permite (§4.5)— reiniciaría el backoff y la aplicación
--                       martillaría un servidor que ya dijo que no puede.
--   bloqueante          `1` cuando el lote falló con un error determinístico y
--                       detiene la cola hasta que alguien lo mire. Detener y
--                       avisar es deliberado: saltar el lote dejaría un hueco
--                       SILENCIOSO en el respaldo, que es peor (§3.2).
--
-- ---------------------------------------------------------------------------
-- POR QUÉ LAS CINCO SON `ADD COLUMN` Y NO UNA TABLA NUEVA
-- ---------------------------------------------------------------------------
-- Son atributos de una entrada de la cola, no una entidad aparte. `ADD COLUMN`
-- además no recrea la tabla, que es lo que este proyecto evita desde la
-- migración 008: `sync_cola` no tiene llaves foráneas hacia ella, pero el
-- procedimiento de recrear es de doce pasos y uno de ellos —apagar las llaves
-- foráneas— es ignorado dentro de una transacción, que es donde corre cada
-- migración.
--
-- Las tres columnas `NOT NULL` llevan `DEFAULT` porque `ADD COLUMN NOT NULL`
-- sin valor por omisión es un error en SQLite si la tabla tuviera filas. Hoy
-- está vacía en toda instalación —nadie escribía en ella—, pero el DEFAULT es
-- gratis y hace la migración segura sin depender de esa suerte.
--
-- `lote_id` usa `'sin-lote'` como valor por omisión SOLO para poder agregarse;
-- ninguna fila escrita por la aplicación lo va a tener, porque la bandeja de
-- salida siempre asigna un UUID. Si alguna vez aparece una fila con
-- `'sin-lote'`, es una fila escrita a mano.
-- ===========================================================================

-- Agrupa las filas de una misma unidad de trabajo.
ALTER TABLE sync_cola
  ADD COLUMN lote_id TEXT NOT NULL DEFAULT 'sin-lote'
    CONSTRAINT sync_cola_lote_id_no_vacio
    CHECK (length(trim(lote_id)) > 0);

-- Padres antes que hijos dentro del lote. Empieza en 0.
ALTER TABLE sync_cola
  ADD COLUMN orden_en_lote INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sync_cola_orden_no_negativo
    CHECK (orden_en_lote >= 0);

-- Cuántas veces se intentó subir este lote.
ALTER TABLE sync_cola
  ADD COLUMN intentos INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sync_cola_intentos_no_negativo
    CHECK (intentos >= 0);

-- Cuándo volver a intentar. NULL = está disponible ahora mismo.
-- Mismo formato ISO-8601 UTC que el resto de las fechas del esquema.
ALTER TABLE sync_cola
  ADD COLUMN proximo_intento_en TEXT
    CONSTRAINT sync_cola_proximo_intento_iso
    CHECK (proximo_intento_en IS NULL
           OR proximo_intento_en LIKE '____-__-__T__:__:__%Z');

-- 1 si este lote detiene la cola por un error determinístico.
ALTER TABLE sync_cola
  ADD COLUMN bloqueante INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sync_cola_bloqueante_booleano
    CHECK (bloqueante IN (0, 1));

-- ---------------------------------------------------------------------------
-- El índice que el trabajador va a consultar en cada ciclo
-- ---------------------------------------------------------------------------
-- La consulta es siempre la misma: «el lote pendiente más viejo, con sus filas
-- en orden». Es decir, filtrar por `sincronizado_en IS NULL` y ordenar por
-- `creado_en` y después por `orden_en_lote`.
--
-- Es un índice PARCIAL sobre las pendientes, con el mismo criterio que
-- `idx_ventas_descuento_autorizado`: lo sincronizado es la enorme mayoría de la
-- tabla y no hace falta indexarlo. Reemplaza a `idx_sync_cola_pendientes` de la
-- migración 001, que ordenaba solo por `creado_en` y dejaba el orden dentro del
-- lote a lo que devolviera el motor, que es exactamente el orden ambiguo que
-- este proyecto no acepta (§5, regla de desempate del reparto de centavos).
DROP INDEX IF EXISTS idx_sync_cola_pendientes;

CREATE INDEX IF NOT EXISTS idx_sync_cola_pendientes
  ON sync_cola (creado_en, orden_en_lote)
  WHERE sincronizado_en IS NULL;

-- Para leer un lote entero de una vez, y para marcarlo confirmado completo.
CREATE INDEX IF NOT EXISTS idx_sync_cola_lote
  ON sync_cola (lote_id, orden_en_lote);
