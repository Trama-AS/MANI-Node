-- =====================================================================
-- Migración 0003 (Core Node) — Reglas Contextuales del Sitio (SCRUM-853 / RF-09)
-- =====================================================================
-- Solo agrega `sitio.nombre` y el índice por tenant. La columna `sitio.reglas` (JSONB) ya existe en el
-- esquema base (database/init/01-schema.sql de MANI-APIGateway), así que esta migración no la toca.

ALTER TABLE sitio ADD COLUMN IF NOT EXISTS nombre TEXT;

CREATE INDEX IF NOT EXISTS idx_sitio_tenant_id ON sitio (tenant_id, id);

INSERT INTO schema_migrations (version, description)
VALUES ('mani-node-0003-reglas-sitio', 'Agrega sitio.nombre e indice (tenant_id, id) para RF-09; sitio.reglas ya existia en el esquema base')
ON CONFLICT (version) DO NOTHING;
