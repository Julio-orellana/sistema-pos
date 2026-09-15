-- ===========================================================================
-- 028_limites_descuento_id_determinista.sql
-- El id de un tope de descuento deja de sortearse y pasa a ser FIJO por rol.
-- ===========================================================================
--
-- TIENE ESPEJO: `supabase/migrations/0028_limites_descuento_id_determinista.sql`.
-- Las dos tienen que aplicarse juntas, y la de la nube reescribe los mismos
-- ids: si una sola de las dos corriera, los dos lados quedarían con el mismo
-- rol bajo ids distintos, que es justo lo que esto viene a impedir.
--
-- ---------------------------------------------------------------------------
-- QUÉ PROBLEMA CIERRA, Y CÓMO SE MIDIÓ
-- ---------------------------------------------------------------------------
-- `escribir_fila` de la nube (migración `0023`) escribe con
-- `INSERT … ON CONFLICT (id) DO UPDATE`: el destino del conflicto es **la llave
-- primaria**. Un choque contra cualquier OTRA restricción única no lo absorbe
-- el upsert, sale como `23505` crudo, la terminal lo clasifica —bien— como
-- determinístico, y **la cola se detiene**.
--
-- `limites_descuento` tiene `UNIQUE (rol)` además de su llave primaria, y su id
-- se sorteaba en el cliente. Medido contra `pos-pruebas-descartable` el
-- 2026-09-14, subiendo desde una base local nueva a una nube que ya tenía la
-- fila:
--
--   sincronizar_lote_simple -> HTTP 409
--   {"code":"23505","details":"Key (rol)=(venta) already exists.",
--    "message":"duplicate key value violates unique constraint
--               \"limites_descuento_rol_key\""}
--   ciclo: cola_detenida; pendientes: 16
--
-- Con el id fijo, la MISMA fila de negocio tiene la MISMA llave primaria en
-- toda instalación, así que el upsert por `(id)` la absorbe y el `UNIQUE (rol)`
-- nunca llega a chocar.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UUID FIJOS Y NO `id = rol`
-- ---------------------------------------------------------------------------
-- `id = 'venta'` sería más legible, y no se puede sin reconstruir la tabla:
-- acá el CHECK exige `length(id) = 36` y en Postgres la columna es `UUID`.
-- Cambiarle el tipo obligaría al rebuild de doce pasos de SQLite, que este
-- proyecto ya descartó dos veces (migraciones 008 y 015).
--
-- El precedente correcto ya existe y es `denominaciones`: una tabla cuyo
-- contenido es el MISMO en toda instalación lleva sus UUID **fijos en la
-- migración**, no sorteados en el cliente (registro de decisiones, Prompt 13).
-- `limites_descuento` es ese caso exacto: como mucho dos filas, siempre las
-- mismas dos, una por rol.
--
-- ---------------------------------------------------------------------------
-- LOS DOS ID, QUE SON AHORA PARTE DEL ESQUEMA
-- ---------------------------------------------------------------------------
--   venta          -> 0c2ebde1-fe5f-4d8b-a7c4-d137888109ca
--   administrativo -> a6385986-bf18-4bb2-841d-cf154702cc1f
--
-- Viven además en `ID_DE_LIMITE_POR_ROL`, en
-- `src/main/database/repositories/limites-descuento.ts`, que es por donde los
-- escribe la aplicación. **Cambiarlos rompería la correspondencia con las filas
-- ya subidas a la nube**, así que no se tocan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Las filas que ya existan pasan a su id fijo
-- ---------------------------------------------------------------------------
-- En una instalación nueva no hay ninguna y esto es un no-op. En la base de
-- desarrollo puede haber las dos que siembra `npm run seed:limites`.
UPDATE limites_descuento
   SET id = '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca'
 WHERE rol = 'venta' AND id <> '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca';

UPDATE limites_descuento
   SET id = 'a6385986-bf18-4bb2-841d-cf154702cc1f'
 WHERE rol = 'administrativo' AND id <> 'a6385986-bf18-4bb2-841d-cf154702cc1f';

-- ---------------------------------------------------------------------------
-- 2. Y lo que esté esperando en la bandeja de salida, también
-- ---------------------------------------------------------------------------
-- Sin esto quedaría un lote pendiente apuntando al id viejo, con el id viejo
-- adentro del payload, y al subirlo la nube recibiría la fila con una llave
-- primaria que en esta base ya no existe: exactamente el `23505` que esta
-- migración cierra, provocado por ella misma.
--
-- `entidad_id` y el `id` de adentro del payload se mueven JUNTOS, porque §4.17
-- sostiene que el payload es byte a byte lo que quedó guardado.
UPDATE sync_cola
   SET entidad_id = '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca',
       payload    = json_set(payload, '$.id', '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca')
 WHERE entidad_tipo = 'limites_descuento'
   AND json_extract(payload, '$.rol') = 'venta'
   AND entidad_id <> '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca';

UPDATE sync_cola
   SET entidad_id = 'a6385986-bf18-4bb2-841d-cf154702cc1f',
       payload    = json_set(payload, '$.id', 'a6385986-bf18-4bb2-841d-cf154702cc1f')
 WHERE entidad_tipo = 'limites_descuento'
   AND json_extract(payload, '$.rol') = 'administrativo'
   AND entidad_id <> 'a6385986-bf18-4bb2-841d-cf154702cc1f';

-- ---------------------------------------------------------------------------
-- 3. Y la base lo hace cumplir de ahora en adelante
-- ---------------------------------------------------------------------------
-- Tercera capa, como en todo el proyecto: el servicio decide, la base es la
-- última red. Sin el CHECK, un módulo futuro que insertara con `nuevoId()`
-- volvería a abrir el hueco sin que nada fallara acá y con el síntoma
-- apareciendo mucho después, en la nube y del otro lado del país.
--
-- `ALTER TABLE … ADD CONSTRAINT … CHECK` no está en la gramática documentada de
-- SQLite pero se midió que se aplica de verdad en la versión que el proyecto
-- empaqueta; es la misma vía de la migración 008, con su misma advertencia.
ALTER TABLE limites_descuento
  ADD CONSTRAINT limites_descuento_id_fijo_por_rol CHECK (
    (rol = 'venta'          AND id = '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca')
    OR
    (rol = 'administrativo' AND id = 'a6385986-bf18-4bb2-841d-cf154702cc1f')
  );
