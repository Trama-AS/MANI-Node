-- =====================================================================
-- Migración 0002 (Core Node) — Soporte para Cliente Empresa y Sitios
-- (SCRUM-852 / US-02.2.2 / RF-08 / RF-09)
-- =====================================================================

ALTER TABLE cliente ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS nit TEXT;
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS nombre_representante TEXT;

ALTER TABLE sitio ADD COLUMN IF NOT EXISTS nombre TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cliente_nit_tenant_unique'
    ) THEN
        ALTER TABLE cliente
            ADD CONSTRAINT cliente_nit_tenant_unique
            UNIQUE (tenant_id, nit);
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('mani-node-0002-empresa', 'Agrega columnas razon_social, nit, telefono, nombre_representante a cliente y nombre a sitio para RF-08')
ON CONFLICT (version) DO NOTHING;
