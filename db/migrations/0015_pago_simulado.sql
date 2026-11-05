-- =====================================================================
-- Migración 0015 (Core Node) — Pagos del sandbox simulado (SCRUM-1432 / HU-M11-01, CONS-38)
-- =====================================================================
-- Registro de cada intento de pago resuelto por el proveedor de pagos. En el Sprint 5 el proveedor es un mock
-- (ADR-0023/0024: sin operador real, sin datos de tarjeta), por eso `simulado` es TRUE y queda en cada fila: un pago
-- simulado nunca se confunde con uno real. Solo se guardan los desenlaces que decidió el proveedor (APROBADO,
-- RECHAZADO, PENDIENTE); un timeout o una respuesta inválida no producen fila ni efecto financiero.
--
-- tenant_id y RLS van en esta misma migración (T3). La tabla es inmutable para el servicio: solo SELECT e INSERT.
--   * ux_pago_clave_idempotencia: un reintento con la misma clave devuelve el pago ya registrado.
--   * ux_pago_aprobado_por_cotizacion: una cotización no se cobra dos veces, ni con claves de idempotencia distintas.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS pago (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    cotizacion_id UUID NOT NULL REFERENCES cotizacion(id) ON DELETE RESTRICT,
    cliente_id UUID NOT NULL REFERENCES cliente(id) ON DELETE RESTRICT,
    monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
    moneda TEXT NOT NULL DEFAULT 'COP',
    estado TEXT NOT NULL CHECK (estado IN ('APROBADO', 'RECHAZADO', 'PENDIENTE')),
    proveedor TEXT NOT NULL,
    simulado BOOLEAN NOT NULL DEFAULT TRUE,
    referencia_proveedor TEXT NOT NULL,
    motivo TEXT,
    correlation_id TEXT,
    clave_idempotencia UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pago_tenant_cotizacion ON pago (tenant_id, cotizacion_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pago_clave_idempotencia
    ON pago (tenant_id, cotizacion_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pago_aprobado_por_cotizacion
    ON pago (cotizacion_id)
    WHERE estado = 'APROBADO';

ALTER TABLE pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE pago FORCE ROW LEVEL SECURITY;

-- Supabase concede por omisión todos los privilegios de una tabla nueva a anon, authenticated y service_role: se
-- retiran, como hizo la 0005 con las demás. Core accede solo con su rol de servicio.
REVOKE ALL ON pago FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON pago FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT ON pago TO mani_core_svc;
        DROP POLICY IF EXISTS pago_tenant ON pago;
        CREATE POLICY pago_tenant ON pago
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0015', 'SCRUM-1432 tabla pago del sandbox simulado con RLS por tenant, idempotencia y un solo pago aprobado por cotizacion')
ON CONFLICT (version) DO NOTHING;
