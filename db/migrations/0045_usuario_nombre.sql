-- =====================================================================
-- Migración 0045 (Core Node) — nombre visible del usuario (SCRUM-1647)
-- =====================================================================
-- Origen: revisión de la 1647. El saludo del inicio mostraba el correo en las cuentas de cliente y de administrador:
-- `usuario` no guardaba ningún nombre y `leerPerfil` solo lo sacaba de `aliado.nombre_razon_social`.
--
-- `usuario.nombre` guarda el nombre con el que se saluda a la persona (en una persona natural, su nombre; en una
-- empresa, su razón social). Es opcional: las cuentas que no lo tengan siguen mostrando el correo como antes.
-- Se rellena para las cuentas existentes desde lo que ya se sabe de ellas (razón social del cliente o del aliado).
-- Aditiva e idempotente: no borra ni cambia ninguna otra columna ni fila.

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS nombre TEXT;

UPDATE usuario u
   SET nombre = c.razon_social
  FROM cliente c
 WHERE c.usuario_id = u.id AND c.tenant_id = u.tenant_id
   AND u.nombre IS NULL AND NULLIF(btrim(c.razon_social), '') IS NOT NULL;

UPDATE usuario u
   SET nombre = a.nombre_razon_social
  FROM aliado a
 WHERE a.usuario_id = u.id AND a.tenant_id = u.tenant_id
   AND u.nombre IS NULL AND NULLIF(btrim(a.nombre_razon_social), '') IS NOT NULL;

INSERT INTO schema_migrations (version, description)
VALUES ('0045', 'usuario.nombre: nombre visible para el saludo (SCRUM-1647)')
ON CONFLICT (version) DO NOTHING;
