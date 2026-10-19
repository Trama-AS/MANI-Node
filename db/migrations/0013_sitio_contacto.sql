-- =====================================================================
-- Migración 0013 (Core Node) — Contacto de la sede del cliente empresa (SCRUM-852 / US-02.2.2)
-- =====================================================================
-- El servicio recibe y devuelve el contacto de cada sede (nombre y teléfono), pero `sitio` no tenía
-- dónde guardarlo y el dato se perdía en la base. `sitio` ya tiene tenant_id y la 0007 le aplica
-- ENABLE + FORCE RLS y `sitio_tenant`. Aditiva e idempotente.

ALTER TABLE sitio
    ADD COLUMN IF NOT EXISTS contacto_nombre TEXT,
    ADD COLUMN IF NOT EXISTS contacto_telefono TEXT;

INSERT INTO schema_migrations (version, description)
VALUES ('0013', 'SCRUM-852 columnas contacto_nombre y contacto_telefono en sitio')
ON CONFLICT (version) DO NOTHING;
