-- =====================================================================
-- Migración 0023 (Core Node) — Adición por imprevisto durante la ejecución (SCRUM-872 / US-04.3.5, RF-34)
-- =====================================================================
-- El aliado asignado pide una adición (motivo + mano de obra y materiales adicionales) mientras el servicio está
-- EN_EJECUCION. La adición queda PENDIENTE y no cambia el total hasta que el cliente dueño la acepta; si la
-- rechaza, el servicio sigue con lo pactado. Criterios aprobados por la PO el 27-oct (Jira 10534 y 10548).
--
-- Va en una tabla propia y no en `cotizacion` porque la cotización aceptada no cambia: el total vigente del
-- servicio es esa cotización más las adiciones ACEPTADAS, y el pago (SCRUM-1432) cobra ese total.
--
-- tenant_id y RLS van en esta misma migración (T3).
--   * ux_adicion_servicio_pendiente: una sola adición pendiente por solicitud, también con envíos simultáneos.
--   * Los CHECK repiten las reglas del contrato (motivo de 10 a 500 caracteres, importes no negativos con al menos
--     uno mayor que cero) para que ningún camino escriba una fila que la API rechazaría.
-- El tope (las adiciones aceptadas no superan el 50 % de la cotización aceptada) lo valida Core, porque depende de
-- otras filas.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS adicion_servicio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    solicitud_id UUID NOT NULL REFERENCES solicitud(id) ON DELETE CASCADE,
    cotizacion_id UUID NOT NULL REFERENCES cotizacion(id) ON DELETE RESTRICT,
    aliado_id UUID NOT NULL REFERENCES aliado(id) ON DELETE RESTRICT,
    motivo TEXT NOT NULL CHECK (char_length(motivo) BETWEEN 10 AND 500),
    valor_mano_obra NUMERIC(12, 2) NOT NULL CHECK (valor_mano_obra >= 0),
    valor_materiales NUMERIC(12, 2) NOT NULL CHECK (valor_materiales >= 0),
    tiempo_adicional_minutos INT CHECK (tiempo_adicional_minutos > 0),
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA')),
    comentario_cliente TEXT CHECK (comentario_cliente IS NULL OR char_length(comentario_cliente) <= 500),
    respondida_por UUID REFERENCES usuario(id) ON DELETE SET NULL,
    respondida_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_adicion_servicio_total_positivo CHECK (valor_mano_obra + valor_materiales > 0),
    CONSTRAINT ck_adicion_servicio_respuesta CHECK ((estado = 'PENDIENTE') = (respondida_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_adicion_servicio_tenant_solicitud ON adicion_servicio (tenant_id, solicitud_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_adicion_servicio_pendiente
    ON adicion_servicio (tenant_id, solicitud_id)
    WHERE estado = 'PENDIENTE';

ALTER TABLE adicion_servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE adicion_servicio FORCE ROW LEVEL SECURITY;

-- Supabase concede por omisión todos los privilegios de una tabla nueva a anon, authenticated y service_role: se
-- retiran, como en la 0015. Core accede solo con su rol de servicio; la respuesta del cliente es un UPDATE.
REVOKE ALL ON adicion_servicio FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON adicion_servicio FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT, UPDATE ON adicion_servicio TO mani_core_svc;
        DROP POLICY IF EXISTS adicion_servicio_tenant ON adicion_servicio;
        CREATE POLICY adicion_servicio_tenant ON adicion_servicio
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0023', 'SCRUM-872 tabla adicion_servicio con RLS por tenant y una sola adicion pendiente por solicitud')
ON CONFLICT (version) DO NOTHING;
