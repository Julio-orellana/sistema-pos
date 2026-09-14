-- ===========================================================================
-- 0028_limites_descuento_id_determinista.sql
-- Espejo de la local `028`: el id de un tope de descuento es FIJO por rol.
-- ===========================================================================
--
-- **TIENE ESPEJO LOCAL**, `src/main/database/migrations/028_…`. Las dos se
-- aplican juntas y reescriben los MISMOS dos ids. Si corriera una sola, los dos
-- lados quedarían con el mismo rol bajo ids distintos, que es exactamente el
-- estado que esto viene a impedir.
--
-- ---------------------------------------------------------------------------
-- QUÉ CIERRA, Y CÓMO SE MIDIÓ
-- ---------------------------------------------------------------------------
-- `escribir_fila` (migración `0023`) escribe con
-- `INSERT … ON CONFLICT (id) DO UPDATE`: el destino del conflicto es **la llave
-- primaria y nada más**. Un choque contra cualquier otra restricción única no
-- lo absorbe, sale como `23505`, la terminal lo clasifica —correctamente— como
-- determinístico, y **la cola se detiene**.
--
-- `limites_descuento` tiene `UNIQUE (rol)` además de su llave primaria, y su id
-- se sorteaba en el cliente. Medido contra `pos-pruebas-descartable` el
-- 2026-09-14, subiendo desde una base local nueva contra una nube que ya tenía
-- la fila —o sea, la forma exacta de una reinstalación—:
--
--   sincronizar_lote_simple -> HTTP 409
--   {"code":"23505","details":"Key (rol)=(venta) already exists.",
--    "message":"duplicate key value violates unique constraint
--               \"limites_descuento_rol_key\""}
--   ciclo: cola_detenida; pendientes: 16
--
-- Con el id fijo, la misma fila de negocio tiene la misma llave primaria en
-- toda instalación: el upsert por `(id)` la absorbe y el `UNIQUE (rol)` nunca
-- llega a chocar.
--
-- ---------------------------------------------------------------------------
-- LO QUE ESTA MIGRACIÓN **NO** RESUELVE, DICHO EN VOZ ALTA
-- ---------------------------------------------------------------------------
-- Cierra UNA de las nueve restricciones únicas que no son la llave primaria
-- (CLAUDE.md §4.31). Las otras ocho siguen igual, y no se tocan acá porque no
-- son el mismo problema:
--
--   · `usuarios.nombre`, `categorias.nombre`, `productos.nombre` — el nombre no
--     es la identidad de la fila: dos instalaciones pueden tener legítimamente
--     un «Maíz blanco» distinto. Ahí la respuesta correcta es que la
--     restauración (fase 4.b) traiga los UUID de la nube en vez de generarlos.
--   · `recibos.numero_recibo` — correlativo POR terminal; con dos cajas choca
--     garantizado, y eso se resuelve en el diseño del multi-sucursal
--     (punto 10 de §6.2), no acá.
--   · `recibos.venta_id`, `venta_detalle(venta_id, orden_linea)` y el desglose
--     de caja — cuelgan de un padre cuyo id ya es único por instalación.
--   · `caja_sesiones (estado) WHERE estado='abierta'` — es un invariante de
--     negocio, no una identidad; ya mordió una vez y se comportó bien (§4.25).
--
-- `limites_descuento` es el único caso donde la clave natural **ES** la
-- identidad —hay como mucho dos filas y siempre las mismas dos—, y por eso es
-- el único que se arregla fijando el id.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Las filas que ya existan pasan a su id fijo
-- ---------------------------------------------------------------------------
-- Hoy las dos nubes tienen la tabla en 0 filas, así que esto es un no-op
-- comprobado. Va igual, porque una migración tiene que ser correcta contra
-- cualquier estado y no solo contra el de hoy.
--
-- Nada referencia `limites_descuento.id` con una llave foránea —comprobado en
-- el catálogo—, así que reescribirlo no arrastra nada. `auditoria_log.entidad_id`
-- guarda el valor pero sin FK, y los asientos viejos son historial: apuntan al
-- id que existía cuando se escribieron y así se quedan.
UPDATE public.limites_descuento
   SET id = '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca'
 WHERE rol = 'venta' AND id <> '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca';

UPDATE public.limites_descuento
   SET id = 'a6385986-bf18-4bb2-841d-cf154702cc1f'
 WHERE rol = 'administrativo' AND id <> 'a6385986-bf18-4bb2-841d-cf154702cc1f';

-- ---------------------------------------------------------------------------
-- 2. Y la base lo hace cumplir de ahora en adelante
-- ---------------------------------------------------------------------------
-- Se agrega VALIDADA —sin `NOT VALID`— a propósito: con la tabla en 0 filas no
-- hay nada que revisar, y una restricción `NOT VALID` se leería para siempre
-- como «esta regla no se comprobó contra lo que ya había».
--
-- No puede dar NULL: `rol` es `NOT NULL` y `id` es la llave primaria, así que
-- las dos ramas evalúan siempre a verdadero o falso. Es la regla permanente del
-- registro de decisiones sobre los CHECK de tres valores.
ALTER TABLE public.limites_descuento
  ADD CONSTRAINT limites_descuento_id_fijo_por_rol CHECK (
    (rol = 'venta'          AND id = '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca')
    OR
    (rol = 'administrativo' AND id = 'a6385986-bf18-4bb2-841d-cf154702cc1f')
  );

COMMENT ON CONSTRAINT limites_descuento_id_fijo_por_rol ON public.limites_descuento IS
  'El id de un tope es FIJO por rol, no sorteado en el cliente. Sin esto, la misma fila de negocio llega con ids distintos desde instalaciones distintas y choca contra UNIQUE (rol) con un 23505 que detiene la cola de sincronización, porque escribir_fila hace ON CONFLICT (id). Ver la migración 0028 y CLAUDE.md §4.31.';
