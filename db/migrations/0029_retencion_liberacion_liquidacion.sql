-- =====================================================================
-- Migración 0029 (Core Node) — Retención, liberación y liquidación simuladas (SCRUM-891, 892, 893)
-- =====================================================================
-- El sandbox de pagos (0015) no mueve dinero real. Esta migración modela, también simulado, lo que ocurre después de
-- un pago aprobado:
--   * `retencion_fondos` (891): un pago APROBADO retiene su monto en garantía (RETENIDA) hasta que el servicio
--     finaliza. Una fila por pago; un pago rechazado o pendiente no genera retención. `simulada` es siempre TRUE:
--     no es custodia monetaria real.
--   * La liberación (892) pasa la retención a LIBERADA cuando la solicitud llega a FINALIZADA, en la misma
--     transacción de la finalización. Sin esa condición no se libera.
--   * `liquidacion` (893): al liberar se liquida al aliado descontando la comisión del tenant. Una por retención.
--     `comision_tenant` guarda el porcentaje configurable por tenant (0 a 100); sin fila rige el 10 % por defecto,
--     un supuesto que la PO debe confirmar.
-- tenant_id y RLS FORCE en esta misma migración (T3). El servicio solo accede con mani_core_svc:
--   retencion_fondos SELECT/INSERT/UPDATE; liquidacion SELECT/INSERT (inmutable); comision_tenant SELECT/INSERT/UPDATE.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS retencion_fondos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    pago_id UUID NOT NULL REFERENCES pago(id) ON DELETE RESTRICT,
    solicitud_id UUID NOT NULL REFERENCES solicitud(id) ON DELETE RESTRICT,
    aliado_id UUID NOT NULL REFERENCES aliado(id) ON DELETE RESTRICT,
    monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
    moneda TEXT NOT NULL DEFAULT 'COP',
    estado TEXT NOT NULL DEFAULT 'RETENIDA' CHECK (estado IN ('RETENIDA', 'LIBERADA')),
    simulada BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    liberada_at TIMESTAMPTZ,
    CONSTRAINT ck_retencion_liberada_fecha CHECK ((estado = 'LIBERADA') = (liberada_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_retencion_pago ON retencion_fondos (pago_id);
CREATE INDEX IF NOT EXISTS idx_retencion_tenant_solicitud ON retencion_fondos (tenant_id, solicitud_id);
CREATE INDEX IF NOT EXISTS idx_retencion_tenant_aliado ON retencion_fondos (tenant_id, aliado_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comision_tenant (
    tenant_id UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    porcentaje NUMERIC(5, 2) NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID
);

CREATE TABLE IF NOT EXISTS liquidacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    retencion_id UUID NOT NULL REFERENCES retencion_fondos(id) ON DELETE RESTRICT,
    pago_id UUID NOT NULL REFERENCES pago(id) ON DELETE RESTRICT,
    solicitud_id UUID NOT NULL REFERENCES solicitud(id) ON DELETE RESTRICT,
    aliado_id UUID NOT NULL REFERENCES aliado(id) ON DELETE RESTRICT,
    monto_bruto NUMERIC(12, 2) NOT NULL CHECK (monto_bruto > 0),
    porcentaje_comision NUMERIC(5, 2) NOT NULL CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
    comision NUMERIC(12, 2) NOT NULL CHECK (comision >= 0),
    monto_neto NUMERIC(12, 2) NOT NULL CHECK (monto_neto >= 0),
    moneda TEXT NOT NULL DEFAULT 'COP',
    simulada BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_liquidacion_suma CHECK (monto_bruto = comision + monto_neto)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_liquidacion_retencion ON liquidacion (retencion_id);
CREATE INDEX IF NOT EXISTS idx_liquidacion_tenant_aliado ON liquidacion (tenant_id, aliado_id, created_at DESC);

DO $$
DECLARE
    t TEXT;
    r TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['retencion_fondos', 'comision_tenant', 'liquidacion'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
            END IF;
        END LOOP;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT, UPDATE ON retencion_fondos TO mani_core_svc;
        GRANT SELECT, INSERT, UPDATE ON comision_tenant TO mani_core_svc;
        GRANT SELECT, INSERT ON liquidacion TO mani_core_svc;
        FOREACH t IN ARRAY ARRAY['retencion_fondos', 'comision_tenant', 'liquidacion'] LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
            EXECUTE format(
                'CREATE POLICY %I ON %I FOR ALL TO mani_core_svc USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())',
                t || '_tenant', t
            );
        END LOOP;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0029', 'SCRUM-891/892/893 retencion en garantia, liberacion y liquidacion simuladas con RLS por tenant y comision configurable')
ON CONFLICT (version) DO NOTHING;
