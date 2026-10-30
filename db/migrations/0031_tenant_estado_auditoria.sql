-- =====================================================================
-- Migración 0031 (Core Node) — Administración del estado de los tenants por la plataforma (SCRUM-901 / HU-M12-07)
-- =====================================================================
-- RF-28 / RF-01. Solo el administrador de plataforma (claim user_role = admin_plataforma, SCRUM-1364) habilita,
-- suspende o inactiva un tenant, con motivo. Cada cambio queda en un registro inmutable con actor, rol, tenant de
-- origen del actor, motivo, correlación y fecha (T10).
--   * tenant.estado admite ACTIVO, SUSPENDIDO e INACTIVO (NOT VALID: un valor heredado no bloquea la migración).
--   * tenant: la lectura sigue siendo pública (0007, directorio pre-auth). El UPDATE de `estado` se concede a
--     mani_core_svc y una política lo limita a admin_plataforma (C2): un admin_tenant no puede cambiarlo ni el suyo.
--   * tenant_estado_cambio: solo admin_plataforma lo lee o escribe (C3); nadie lo modifica ni lo borra.
-- Aditiva e idempotente.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_estado') THEN
        ALTER TABLE tenant ADD CONSTRAINT ck_tenant_estado CHECK (estado IN ('ACTIVO', 'SUSPENDIDO', 'INACTIVO')) NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_estado_cambio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    estado_anterior TEXT NOT NULL,
    estado_nuevo TEXT NOT NULL CHECK (estado_nuevo IN ('ACTIVO', 'SUSPENDIDO', 'INACTIVO')),
    motivo TEXT NOT NULL CHECK (motivo = btrim(motivo) AND char_length(motivo) BETWEEN 10 AND 500),
    actor_id UUID NOT NULL,
    actor_rol TEXT NOT NULL,
    actor_tenant_id UUID NOT NULL,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (estado_anterior <> estado_nuevo)
);

CREATE INDEX IF NOT EXISTS idx_tenant_estado_cambio_tenant ON tenant_estado_cambio (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.bloquear_modificacion_tenant_estado_cambio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'tenant_estado_cambio es inmutable: no admite % (SCRUM-901)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_estado_cambio_inmutable ON tenant_estado_cambio;
CREATE TRIGGER trg_tenant_estado_cambio_inmutable
    BEFORE UPDATE OR DELETE ON tenant_estado_cambio
    FOR EACH ROW EXECUTE FUNCTION app.bloquear_modificacion_tenant_estado_cambio();

DROP TRIGGER IF EXISTS trg_tenant_estado_cambio_sin_truncate ON tenant_estado_cambio;
CREATE TRIGGER trg_tenant_estado_cambio_sin_truncate
    BEFORE TRUNCATE ON tenant_estado_cambio
    FOR EACH STATEMENT EXECUTE FUNCTION app.bloquear_modificacion_tenant_estado_cambio();

ALTER TABLE tenant_estado_cambio ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_estado_cambio FORCE ROW LEVEL SECURITY;

REVOKE ALL ON tenant_estado_cambio FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON tenant_estado_cambio FROM %I', r);
            EXECUTE format('REVOKE UPDATE ON tenant FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT UPDATE (estado) ON tenant TO mani_core_svc;
        DROP POLICY IF EXISTS tenant_estado_plataforma ON tenant;
        CREATE POLICY tenant_estado_plataforma ON tenant
            FOR UPDATE TO mani_core_svc
            USING (app.user_role() = 'admin_plataforma')
            WITH CHECK (app.user_role() = 'admin_plataforma');

        GRANT SELECT, INSERT ON tenant_estado_cambio TO mani_core_svc;
        DROP POLICY IF EXISTS tenant_estado_cambio_plataforma ON tenant_estado_cambio;
        CREATE POLICY tenant_estado_cambio_plataforma ON tenant_estado_cambio
            FOR ALL TO mani_core_svc
            USING (app.user_role() = 'admin_plataforma')
            WITH CHECK (app.user_role() = 'admin_plataforma' AND actor_id = app.user_id() AND actor_tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0031', 'SCRUM-901 estado del tenant solo por admin_plataforma, con registro inmutable de cambios')
ON CONFLICT (version) DO NOTHING;
