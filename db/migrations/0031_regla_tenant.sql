-- =====================================================================
-- Migración 0031 (Core Node) — Reglas operativas por tenant, versionadas e inmutables (SCRUM-1366 / HU-M01-03)
-- =====================================================================
-- RF-02 / RF-13 / RNF-10 / REST-05. El administrador del tenant configura las reglas operativas propias de su
-- organización (orden de listado, tolerancia de tarifas, comisión, ventana y penalización de cancelación, tiempo para
-- aceptar ofertas).
--
-- Tabla `regla_tenant`:
--   * versionada por tenant: cada actualización guarda el conjunto completo con la versión siguiente (1, 2, ...);
--   * una sola versión VIGENTE por tenant (índice único parcial);
--   * inmutable: no se edita ni se borra; al guardar una versión nueva, la anterior pasa de VIGENTE a HISTORICA (disparador);
--   * auditoría (T10): creado_por, actor_rol, correlation_id y created_at;
--   * RLS forzado (T3): mani_core_svc accede únicamente con el claim de tenant de la sesión (patrón T).
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS regla_tenant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    version INT NOT NULL,
    reglas JSONB NOT NULL,
    estado TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'HISTORICA')),
    creado_por UUID NOT NULL,
    actor_rol TEXT NOT NULL,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_regla_tenant_version') THEN
        ALTER TABLE regla_tenant ADD CONSTRAINT uq_regla_tenant_version UNIQUE (tenant_id, version);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_regla_tenant_vigente
    ON regla_tenant (tenant_id)
    WHERE estado = 'VIGENTE';

CREATE INDEX IF NOT EXISTS idx_regla_tenant_historial
    ON regla_tenant (tenant_id, version DESC);

-- Disparador de inmutabilidad: solo pasa de VIGENTE a HISTORICA; no se borra ni se alteran campos clave.
CREATE OR REPLACE FUNCTION app.proteger_inmutabilidad_regla_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'MANI-RGL-409I: una versión de regla_tenant no se borra (SCRUM-1366)'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.estado = 'HISTORICA' THEN
            RAISE EXCEPTION 'MANI-RGL-409H: una versión HISTORICA de regla_tenant es inmutable (SCRUM-1366)'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT (OLD.estado = 'VIGENTE' AND NEW.estado = 'HISTORICA') THEN
            RAISE EXCEPTION 'MANI-RGL-409T: estado solo admite la transición VIGENTE -> HISTORICA (SCRUM-1366)'
                USING ERRCODE = 'check_violation';
        END IF;
        IF (to_jsonb(NEW) - ARRAY['estado']) <> (to_jsonb(OLD) - ARRAY['estado']) THEN
            RAISE EXCEPTION 'MANI-RGL-409C: los datos de una versión de regla_tenant no se modifican al archivarla (SCRUM-1366)'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_regla_tenant_inmutable ON regla_tenant;
CREATE TRIGGER trg_regla_tenant_inmutable
    BEFORE UPDATE OR DELETE ON regla_tenant
    FOR EACH ROW EXECUTE FUNCTION app.proteger_inmutabilidad_regla_tenant();

DROP TRIGGER IF EXISTS trg_regla_tenant_sin_truncate ON regla_tenant;
CREATE TRIGGER trg_regla_tenant_sin_truncate
    BEFORE TRUNCATE ON regla_tenant
    FOR EACH STATEMENT EXECUTE FUNCTION app.proteger_inmutabilidad_regla_tenant();

ALTER TABLE regla_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE regla_tenant FORCE ROW LEVEL SECURITY;

REVOKE ALL ON regla_tenant FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON regla_tenant FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT, UPDATE ON regla_tenant TO mani_core_svc;
        DROP POLICY IF EXISTS regla_tenant_isolation ON regla_tenant;
        CREATE POLICY regla_tenant_isolation ON regla_tenant
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0031', 'SCRUM-1366 reglas operativas versionadas e inmutables por tenant con RLS')
ON CONFLICT (version) DO NOTHING;
