-- =====================================================================
-- Migración 0004 (Core Node) — Soporte para Términos y Condiciones / Habeas Data (SCRUM-856 / Ley 1581)
-- =====================================================================

CREATE TABLE IF NOT EXISTS documento_legal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenant(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    version TEXT NOT NULL,
    contenido TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consentimiento_usuario (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenant(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    documento_legal_id UUID NOT NULL REFERENCES documento_legal(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (usuario_id, documento_legal_id)
);

CREATE INDEX IF NOT EXISTS idx_documento_legal_tenant_active 
    ON documento_legal (tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_consentimiento_usuario_usuario 
    ON consentimiento_usuario (usuario_id);

INSERT INTO documento_legal (id, tenant_id, tipo, version, contenido, is_active)
SELECT 
    '00000000-0000-0000-0000-000000000001'::uuid,
    NULL,
    'TERMS_AND_CONDITIONS',
    '1.0',
    'Términos y Condiciones Generales de MANI. Al registrarse y usar la plataforma, usted acepta el cumplimiento de las condiciones de servicio.',
    true
WHERE NOT EXISTS (
    SELECT 1 FROM documento_legal WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
);

INSERT INTO documento_legal (id, tenant_id, tipo, version, contenido, is_active)
SELECT 
    '00000000-0000-0000-0000-000000000002'::uuid,
    NULL,
    'PRIVACY_POLICY',
    '1.0',
    'Política de Tratamiento y Protección de Datos Personales (Ley 1581 de 2012 / Habeas Data). Autorizo de manera previa, expresa e informada el tratamiento de mis datos.',
    true
WHERE NOT EXISTS (
    SELECT 1 FROM documento_legal WHERE id = '00000000-0000-0000-0000-000000000002'::uuid
);

INSERT INTO schema_migrations (version, description)
VALUES ('mani-node-0004', 'Tablas documento_legal y consentimiento_usuario para Habeas Data (SCRUM-856)')
ON CONFLICT (version) DO NOTHING;
