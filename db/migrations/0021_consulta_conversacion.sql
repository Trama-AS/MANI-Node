-- =====================================================================
-- Migración 0021 (Core Node) — Auditoría de la consulta de conversaciones para atender quejas (SCRUM-883 / HU-M09-04, RF-21)
-- =====================================================================
-- Cuando un administrador del tenant abre la conversación de un servicio para atender una queja, queda un registro
-- inmutable: quién, sobre qué servicio, por qué motivo (y la referencia de la queja, si el módulo de quejas la da),
-- cuántos mensajes vio, cuándo y con qué correlación. Se escribe en la MISMA transacción que la lectura: si el registro
-- no se puede guardar, la conversación no se devuelve (falla cerrada).
--   * Inmutable: el rol de servicio solo tiene SELECT e INSERT y un disparador rechaza UPDATE, DELETE y TRUNCATE.
--   * actor_id y queja_ref no son llaves foráneas a propósito: la auditoría sobrevive al usuario y el módulo de quejas
--     (SCRUM-895/896) aún no existe.
-- tenant_id y RLS van en esta misma migración (T3). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS consulta_conversacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    solicitud_id UUID NOT NULL REFERENCES solicitud(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL,
    actor_rol TEXT NOT NULL,
    motivo TEXT NOT NULL CHECK (char_length(motivo) BETWEEN 5 AND 500),
    queja_ref TEXT CHECK (queja_ref IS NULL OR char_length(queja_ref) BETWEEN 1 AND 100),
    mensajes_vistos INTEGER NOT NULL CHECK (mensajes_vistos >= 0),
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consulta_conversacion_tenant_fecha
    ON consulta_conversacion (tenant_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_consulta_conversacion_solicitud
    ON consulta_conversacion (tenant_id, solicitud_id, created_at);

CREATE OR REPLACE FUNCTION bloquear_modificacion_consulta_conversacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'consulta_conversacion es inmutable: no admite % (SCRUM-883)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_consulta_conversacion_inmutable ON consulta_conversacion;
CREATE TRIGGER trg_consulta_conversacion_inmutable
    BEFORE UPDATE OR DELETE ON consulta_conversacion
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_consulta_conversacion();

DROP TRIGGER IF EXISTS trg_consulta_conversacion_sin_truncate ON consulta_conversacion;
CREATE TRIGGER trg_consulta_conversacion_sin_truncate
    BEFORE TRUNCATE ON consulta_conversacion
    FOR EACH STATEMENT EXECUTE FUNCTION bloquear_modificacion_consulta_conversacion();

ALTER TABLE consulta_conversacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulta_conversacion FORCE ROW LEVEL SECURITY;

REVOKE ALL ON consulta_conversacion FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON consulta_conversacion FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT ON consulta_conversacion TO mani_core_svc;
        DROP POLICY IF EXISTS consulta_conversacion_tenant ON consulta_conversacion;
        CREATE POLICY consulta_conversacion_tenant ON consulta_conversacion
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0021', 'SCRUM-883 auditoria inmutable de la consulta de conversaciones para atender quejas, con RLS por tenant')
ON CONFLICT (version) DO NOTHING;
