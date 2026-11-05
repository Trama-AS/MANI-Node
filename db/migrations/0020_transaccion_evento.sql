-- =====================================================================
-- Migración 0020 (Core Node) — Registro inmutable de transacciones (SCRUM-889 / HU-M11-03, RF-24, RNF-04)
-- =====================================================================
-- Un evento por cada transacción financiera, con quién la hizo (actor y rol del JWT), cuándo (hora de la base) y la
-- correlación de la petición. Se escribe en la MISMA transacción que el pago: o están los dos o no está ninguno.
--   * ux_transaccion_evento_pago_tipo: un pago produce un solo evento de cada tipo. Un reintento devuelve el pago ya
--     registrado y no escribe otro evento (C2); el índice es la garantía final.
--   * Inmutable (C3): el rol de servicio solo tiene SELECT e INSERT y, además, un disparador rechaza cualquier
--     UPDATE, DELETE o TRUNCATE, también para el dueño de la tabla.
--   * actor_id no es llave foránea a propósito: la auditoría debe sobrevivir al ciclo de vida del usuario.
-- tenant_id y RLS van en esta misma migración (T3). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS transaccion_evento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    pago_id UUID NOT NULL REFERENCES pago(id) ON DELETE RESTRICT,
    tipo TEXT NOT NULL CHECK (tipo ~ '^[A-Z][A-Z_]*$'),
    estado TEXT NOT NULL,
    monto NUMERIC(12, 2) NOT NULL,
    moneda TEXT NOT NULL,
    actor_id UUID NOT NULL,
    actor_rol TEXT NOT NULL,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_transaccion_evento_pago_tipo
    ON transaccion_evento (pago_id, tipo);

CREATE INDEX IF NOT EXISTS idx_transaccion_evento_tenant_fecha
    ON transaccion_evento (tenant_id, created_at, id);

CREATE OR REPLACE FUNCTION bloquear_modificacion_transaccion_evento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'transaccion_evento es inmutable: no admite % (SCRUM-889)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_transaccion_evento_inmutable ON transaccion_evento;
CREATE TRIGGER trg_transaccion_evento_inmutable
    BEFORE UPDATE OR DELETE ON transaccion_evento
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_transaccion_evento();

DROP TRIGGER IF EXISTS trg_transaccion_evento_sin_truncate ON transaccion_evento;
CREATE TRIGGER trg_transaccion_evento_sin_truncate
    BEFORE TRUNCATE ON transaccion_evento
    FOR EACH STATEMENT EXECUTE FUNCTION bloquear_modificacion_transaccion_evento();

ALTER TABLE transaccion_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaccion_evento FORCE ROW LEVEL SECURITY;

REVOKE ALL ON transaccion_evento FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON transaccion_evento FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT ON transaccion_evento TO mani_core_svc;
        DROP POLICY IF EXISTS transaccion_evento_tenant ON transaccion_evento;
        CREATE POLICY transaccion_evento_tenant ON transaccion_evento
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0020', 'SCRUM-889 registro inmutable de transacciones (transaccion_evento) con RLS por tenant y un evento por pago y tipo')
ON CONFLICT (version) DO NOTHING;
