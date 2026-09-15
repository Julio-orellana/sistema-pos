-- ===========================================================================
-- 036_totp_de_autorizacion_remota.sql — El código remoto pasa a ser TOTP
-- ===========================================================================
--
-- El PIN remoto fijo de 4 dígitos (migración 005) se reemplaza por TOTP
-- (RFC 6238): un código de 6 dígitos que cambia cada 30 segundos, calculado
-- desde un secreto compartido con la app de autenticación del teléfono. La
-- columna vieja se quita en la 037.
--
-- ===========================================================================
-- REGLA NO NEGOCIABLE: ESTAS DOS COLUMNAS NUNCA SALEN DE ESTA TERMINAL
-- ===========================================================================
-- Un hash de PIN es de una sola vía. El secreto de TOTP NO: quien lo obtenga
-- calcula TODOS los códigos futuros de esa persona, para siempre. Es más
-- sensible que `pin_hash`, que ya no viaja por la decisión 17. Por eso:
--
--   · no existe ni va a existir su espejo en Postgres: el `0036` queda
--     reservado del otro lado y no se usa;
--   · `COLUMNAS_EXCLUIDAS` de la bandeja de salida las saca de todo payload de
--     `usuarios`, y hay pruebas que buscan el secreto en `sync_cola`;
--   · nunca se escribe en `auditoria_log` ni en la bitácora técnica.
--
-- `totp_secreto_cifrado` guarda el secreto cifrado con `safeStorage` de
-- Electron (el llavero en macOS, DPAPI en Windows), igual que la credencial de
-- sincronización (CLAUDE.md §4.23). No puede ser un hash: para calcular el
-- código esperado hay que LEER el secreto. Queda atado a la identidad de la
-- aplicación: si cambia el nombre del producto, ningún secreto guardado se puede
-- descifrar y cada administrador tiene que volver a inscribirse.
-- NULL significa que ese administrador no tiene autorización remota.
--
-- `totp_ultimo_paso` es el último paso de tiempo aceptado para esa persona.
-- Existe para que un código dictado sirva UNA sola vez (RFC 6238 §5.2: el
-- verificador no debe aceptar dos veces el mismo código). Es estado operativo
-- de esta terminal, como `intentos_fallidos`, y tampoco viaja. Se persiste por
-- la misma razón que los candados (§4.8): esta aplicación deja matar el
-- proceso, y un registro en memoria se borraría así.
-- ===========================================================================

ALTER TABLE usuarios ADD COLUMN totp_secreto_cifrado BLOB
  CHECK (totp_secreto_cifrado IS NULL
         OR (typeof(totp_secreto_cifrado) = 'blob' AND length(totp_secreto_cifrado) > 0));

ALTER TABLE usuarios ADD COLUMN totp_ultimo_paso INTEGER
  CHECK (totp_ultimo_paso IS NULL
         OR (typeof(totp_ultimo_paso) = 'integer' AND totp_ultimo_paso >= 0));
