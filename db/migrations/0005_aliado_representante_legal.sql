-- =====================================================================
-- Migración 0005 (Core Node) — Soporte para Representante Legal de Aliado Empresa (SCRUM-1063 / US-02.1.2-M2)
-- =====================================================================

ALTER TABLE aliado
    ADD COLUMN IF NOT EXISTS nombre_representante_legal TEXT,
    ADD COLUMN IF NOT EXISTS documento_representante_legal TEXT;

INSERT INTO schema_migrations (version, description)
VALUES ('mani-node-0005', 'Columnas nombre_representante_legal y documento_representante_legal en aliado (SCRUM-1063)')
ON CONFLICT (version) DO NOTHING;
