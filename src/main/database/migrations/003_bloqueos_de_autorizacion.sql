-- ===========================================================================
-- 003_bloqueos_de_autorizacion.sql — Candado propio del diálogo de autorización
-- ===========================================================================
--
-- POR QUÉ EXISTE ESTA TABLA
--
-- Hasta la migración 002, el diálogo de salida controlada compartía el candado
-- del ingreso: un PIN equivocado allí sumaba a `usuarios.intentos_fallidos` de
-- CADA administrador activo. Comprobado: tres errores en el diálogo de salida
-- dejaban a TODOS los administradores sin poder iniciar sesión.
--
-- Eso convertía una función de administrador en una negación de servicio al
-- alcance de cualquier cajero: tocar el botón de salida y teclear tres PIN al
-- azar bastaba para que nadie pudiera abrir la caja.
--
-- Son dos superficies de uso distintas y ahora tienen candados distintos:
--
--   · Ingreso a la aplicación  -> candado POR USUARIO (usuarios.intentos_fallidos)
--   · Diálogo de autorización  -> candado POR SUPERFICIE (esta tabla)
--
-- El candado del diálogo NO es por usuario a propósito: cuando aparece el
-- diálogo nadie eligió un usuario todavía, así que no hay a quién imputarle el
-- intento. El intento es de la superficie.
--
-- Se persiste, y no vive en memoria, por la misma razón que el candado del
-- ingreso: en memoria se reiniciaría matando el proceso desde el sistema
-- operativo, que es algo que esta aplicación permite deliberadamente.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS bloqueos_de_autorizacion (
  -- Qué superficie de autorización. Agregar una nueva (por ejemplo, la
  -- autorización de descuentos por encima del límite) exige una migración
  -- nueva que amplíe este CHECK, a propósito: así el conjunto de superficies
  -- protegidas queda siempre a la vista y auditable.
  superficie        TEXT    PRIMARY KEY NOT NULL
                      CHECK (superficie IN ('salida_controlada')),

  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),

  -- Momento hasta el cual la superficie no acepta intentos, o NULL.
  bloqueado_hasta   TEXT    CHECK (bloqueado_hasta IS NULL OR
                              bloqueado_hasta LIKE '____-__-__T__:__:__%Z'),

  actualizado_en    TEXT    NOT NULL CHECK (actualizado_en LIKE '____-__-__T__:__:__%Z')
);
