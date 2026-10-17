-- =====================================================================
-- Migración 0002 — Ausencias del aliado (US-02.1.6 / SCRUM-855).
--
-- El aliado se marca "No disponible" por intervalos (vacaciones, enfermedad)
-- y durante ese intervalo sale de la elegibilidad del despacho.
--
-- Decisión de modelo (Sprint 4): es una tabla de AUSENCIAS, no la agenda de
-- franjas positivas `core.disponibilidad` de MANI-docs/architecture/ModeloDatos.md.
-- Con ausencias el aliado es elegible por defecto y solo se excluye mientras
-- dura la ausencia, que es compatible con la consulta de elegibilidad de
-- SCRUM-861 (MANI-.NET). La ausencia es global al aliado: no depende de
-- categoría ni de zona. Los nombres siguen el esquema vivo (tablas en public,
-- `id`, `tenant_id`, `aliado_id`), no los de ModeloDatos.md.
--
-- Reglas que garantiza la base, además de las validaciones de Core Node:
--   * inicio < fin                          (ck_aliado_ausencia_rango)
--   * sin solapamientos del mismo aliado    (ex_aliado_ausencia_solapamiento)
--   * tenant_id igual al del aliado         (trg_aliado_ausencia_tenant)
--
-- Ejecutar contra el proyecto de Supabase de cada ambiente (QA, luego
-- producción) desde el SQL Editor de Supabase o con psql/supabase CLI.
-- Es idempotente y segura de reaplicar.
-- =====================================================================

-- EXCLUDE con igualdad sobre uuid necesita los operadores btree de btree_gist.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS aliado_ausencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    aliado_id UUID NOT NULL REFERENCES aliado(id) ON DELETE CASCADE,
    inicio TIMESTAMPTZ NOT NULL,
    fin TIMESTAMPTZ NOT NULL,
    motivo TEXT NOT NULL,
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_aliado_ausencia_rango CHECK (inicio < fin),
    CONSTRAINT ck_aliado_ausencia_motivo CHECK (motivo IN ('VACACIONES', 'ENFERMEDAD', 'OTRO')),
    CONSTRAINT ck_aliado_ausencia_nota CHECK (nota IS NULL OR char_length(nota) <= 280),
    -- Intervalo semiabierto [inicio, fin): una ausencia que termina a las 12:00
    -- y otra que empieza a las 12:00 no se solapan.
    CONSTRAINT ex_aliado_ausencia_solapamiento EXCLUDE USING gist (
        aliado_id WITH =,
        tstzrange(inicio, fin, '[)') WITH &&
    )
);

-- La consulta de elegibilidad (SCRUM-861) pregunta "¿tiene el aliado una
-- ausencia que cubra este instante?": filtra por aliado y rango.
CREATE INDEX IF NOT EXISTS idx_aliado_ausencia_tenant_aliado
    ON aliado_ausencia (tenant_id, aliado_id, inicio, fin);

-- tenant_id se denormaliza para que RLS y las consultas filtren sin join; el
-- trigger evita que quede distinto del tenant del aliado.
CREATE OR REPLACE FUNCTION _aus_validar_tenant_aliado_ausencia()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM aliado a WHERE a.id = NEW.aliado_id AND a.tenant_id = NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'MANI-AUS-403: el aliado no pertenece al tenant';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aliado_ausencia_tenant ON aliado_ausencia;
CREATE TRIGGER trg_aliado_ausencia_tenant
    BEFORE INSERT OR UPDATE ON aliado_ausencia
    FOR EACH ROW EXECUTE FUNCTION _aus_validar_tenant_aliado_ausencia();

REVOKE ALL ON FUNCTION _aus_validar_tenant_aliado_ausencia() FROM PUBLIC;

-- RLS: Core Node escribe con la service role (que salta RLS) y valida rol y
-- tenant en el caso de uso. Para cualquier acceso directo con el JWT del
-- usuario, el aliado solo LEE sus propias ausencias dentro de su tenant; no hay
-- políticas de escritura, así que solo se escribe a través de Core.
ALTER TABLE aliado_ausencia ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uid' AND pronamespace = 'auth'::regnamespace) THEN
        DROP POLICY IF EXISTS "Aliado lee sus propias ausencias" ON aliado_ausencia;
        CREATE POLICY "Aliado lee sus propias ausencias" ON aliado_ausencia
        FOR SELECT USING (
            tenant_id::text = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
            AND aliado_id IN (SELECT id FROM aliado WHERE usuario_id = auth.uid())
        );
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('mani-node-0002', 'Agrega aliado_ausencia (intervalos de no disponibilidad del aliado, SCRUM-855)')
ON CONFLICT (version) DO NOTHING;
