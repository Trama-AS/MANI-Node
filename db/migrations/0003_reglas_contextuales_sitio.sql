-- =====================================================================
-- Migración 0003 (Core Node) — Reglas Contextuales del Sitio (SCRUM-853 / RF-09)
-- =====================================================================

ALTER TABLE sitio ADD COLUMN IF NOT EXISTS nombre TEXT;
ALTER TABLE sitio ADD COLUMN IF NOT EXISTS reglas JSONB;

CREATE INDEX IF NOT EXISTS idx_sitio_tenant_id ON sitio (tenant_id, id);

INSERT INTO schema_migrations (version, description)
VALUES ('mani-node-0003-reglas-sitio', 'Asegura nombre y reglas jsonb en tabla sitio con indices para RF-09')
ON CONFLICT (version) DO NOTHING;
