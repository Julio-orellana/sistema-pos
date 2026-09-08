-- ===========================================================================
-- 010_una_caja_por_sistema.sql — La caja es una, no una por persona
-- ===========================================================================
--
-- CORRIGE UN ERROR DE ALCANCE DE LA MIGRACIÓN 001. El índice original decía
-- "un usuario no puede tener dos turnos abiertos a la vez":
--
--   CREATE UNIQUE INDEX idx_caja_sesiones_una_abierta
--     ON caja_sesiones (usuario_id) WHERE estado = 'abierta';
--
-- Eso permite que DOS PERSONAS DISTINTAS abran cada una su turno sobre el
-- MISMO cajón físico de dinero. Jimmy tiene una sola caja y una sola pantalla:
-- dos turnos simultáneos sobre el mismo efectivo hacen que ninguno de los dos
-- cortes signifique nada, porque el dinero que entra por uno sale contado en
-- el otro. La restricción no era un poco estrecha: estaba mal alcanzada.
--
-- La regla correcta es GLOBAL: como máximo una fila con estado 'abierta' en
-- toda la tabla, sin importar quién la abrió.
--
-- CÓMO SE EXPRESA. Se indexa la propia columna `estado` bajo la condición
-- `WHERE estado = 'abierta'`. Dentro de esa condición el valor es siempre el
-- mismo —'abierta'—, así que exigir unicidad sobre esa columna permite una
-- sola fila que cumpla la condición. Es el modismo habitual para "como máximo
-- una fila así en toda la tabla".
--
-- SE CONSERVA EL NOMBRE del índice, `idx_caja_sesiones_una_abierta`, porque ya
-- describía la intención correcta; lo que estaba mal era su alcance.
--
-- QUÉ PASA SI UNA BASE YA TIENE DOS TURNOS ABIERTOS DE DOS PERSONAS: la
-- creación del índice falla, la migración se revierte y la aplicación no
-- arranca. Es lo correcto —los datos violan la regla que se quiere imponer— y
-- la consulta para verlos es esta:
--
--   SELECT id, usuario_id, abierta_en FROM caja_sesiones WHERE estado = 'abierta';
--
-- Habría que cerrar a mano los turnos sobrantes antes de actualizar. Hoy no
-- puede ocurrir: no hay ninguna tienda en producción.
--
-- Se espeja en Postgres (`0010_...`): el corte de caja es dato de negocio.
-- ===========================================================================

DROP INDEX IF EXISTS idx_caja_sesiones_una_abierta;

CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_sesiones_una_abierta
  ON caja_sesiones (estado) WHERE estado = 'abierta';
