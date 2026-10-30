-- =====================================================================
-- Migración 0029 (Core Node) — Tarifario de referencia por categoría y tenant, versionado y auditado (SCRUM-885)
-- =====================================================================
-- HU-M10-01 (RF-22): el administrador del tenant carga y edita la tabla de tarifas de referencia (mínimo, típico y
-- máximo por categoría) que Rules usa para contrastar cotizaciones (SCRUM-1462). Core persiste el tarifario y consulta
-- a Rules por HTTP (Mesa CFG-23a punto M2, ADR-0032 §3): no se crea `reglas.tarifario` ni `mani_rules_svc`.
--
-- `tarifa_referencia` existía desde la 001 (solo valores) y tiene RLS por tenant desde la 0007. Se amplía con:
--   * moneda (ISO 4217), vigencia (desde y hasta, ambas inclusive; hasta NULL = sin fin) y condiciones
--     contractuales en texto libre;
--   * version por (tenant, categoría): cada alta o edición crea una fila nueva con la versión siguiente;
--   * estado ACTIVA | REEMPLAZADA y reemplaza_id: editar no sobrescribe; marca la versión anterior REEMPLAZADA y
--     crea la nueva en la misma transacción;
--   * auditoría (T10): creado_por y actor_rol del JWT, correlation_id y created_at de la base.
-- Reglas que garantiza el motor, además de la validación de Core:
--   * valores no negativos y mínimo <= típico <= máximo con mínimo < máximo;
--   * dos tarifas ACTIVA de la misma categoría no solapan su vigencia (EXCLUDE con btree_gist, ya creada en la 008);
--   * una versión es inmutable: no se edita ni se borra, solo pasa de ACTIVA a REEMPLAZADA (disparador). El historial
--     es el registro de cambios.
-- Core accede solo con su rol de servicio: se retiran los privilegios de anon y authenticated. Aditiva e idempotente.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'COP';
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS vigencia_desde DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS vigencia_hasta DATE;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS condiciones TEXT;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'ACTIVA';
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS reemplaza_id UUID REFERENCES tarifa_referencia(id) ON DELETE RESTRICT;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS creado_por UUID;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS actor_rol TEXT;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE tarifa_referencia ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Filas previas (QA no tiene ninguna; un ambiente con datos sueltos sí podría): se numeran por categoría y solo la
-- más reciente queda ACTIVA, para que el índice único y la exclusión de vigencias se puedan crear. Corre una sola vez:
-- después de crear el disparador de inmutabilidad, una versión ya no se puede renumerar.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ex_tarifa_referencia_vigencia_activa') THEN
        WITH numeradas AS (
            SELECT id,
                   row_number() OVER (PARTITION BY tenant_id, categoria_id ORDER BY created_at, id) AS n,
                   count(*) OVER (PARTITION BY tenant_id, categoria_id) AS total
            FROM tarifa_referencia
        )
        UPDATE tarifa_referencia t
        SET version = numeradas.n,
            estado = CASE WHEN numeradas.n = numeradas.total THEN 'ACTIVA' ELSE 'REEMPLAZADA' END
        FROM numeradas
        WHERE numeradas.id = t.id;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tarifa_referencia_valores') THEN
        -- NOT VALID: una fila previa fuera de regla se conserva; toda fila nueva debe cumplir.
        ALTER TABLE tarifa_referencia ADD CONSTRAINT ck_tarifa_referencia_valores
            CHECK (valor_min >= 0 AND valor_min <= valor_tipico AND valor_tipico <= valor_max AND valor_min < valor_max)
            NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tarifa_referencia_moneda') THEN
        ALTER TABLE tarifa_referencia ADD CONSTRAINT ck_tarifa_referencia_moneda CHECK (moneda ~ '^[A-Z]{3}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tarifa_referencia_vigencia') THEN
        ALTER TABLE tarifa_referencia ADD CONSTRAINT ck_tarifa_referencia_vigencia
            CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tarifa_referencia_estado') THEN
        ALTER TABLE tarifa_referencia ADD CONSTRAINT ck_tarifa_referencia_estado CHECK (estado IN ('ACTIVA', 'REEMPLAZADA'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tarifa_referencia_version') THEN
        ALTER TABLE tarifa_referencia ADD CONSTRAINT ck_tarifa_referencia_version CHECK (version > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tarifa_referencia_condiciones') THEN
        ALTER TABLE tarifa_referencia ADD CONSTRAINT ck_tarifa_referencia_condiciones
            CHECK (condiciones IS NULL OR char_length(condiciones) <= 500);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ex_tarifa_referencia_vigencia_activa') THEN
        ALTER TABLE tarifa_referencia ADD CONSTRAINT ex_tarifa_referencia_vigencia_activa
            EXCLUDE USING gist (
                tenant_id WITH =,
                categoria_id WITH =,
                daterange(vigencia_desde, vigencia_hasta, '[]') WITH &&
            ) WHERE (estado = 'ACTIVA');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tarifa_referencia_categoria_version
    ON tarifa_referencia (tenant_id, categoria_id, version);

CREATE INDEX IF NOT EXISTS idx_tarifa_referencia_tenant_categoria_estado
    ON tarifa_referencia (tenant_id, categoria_id, estado);

-- Inmutabilidad (T10): la única actualización permitida es ACTIVA -> REEMPLAZADA sin tocar ninguna otra columna.
CREATE OR REPLACE FUNCTION app.proteger_version_tarifa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'MANI-TAR-409I: una versión del tarifario no se borra (SCRUM-885)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.estado = 'ACTIVA' AND NEW.estado = 'REEMPLAZADA'
       AND (to_jsonb(NEW) - 'estado') = (to_jsonb(OLD) - 'estado') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'MANI-TAR-409I: una versión del tarifario es inmutable; editar crea una versión nueva (SCRUM-885)'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_tarifa_referencia_inmutable ON tarifa_referencia;
CREATE TRIGGER trg_tarifa_referencia_inmutable
    BEFORE UPDATE OR DELETE ON tarifa_referencia
    FOR EACH ROW EXECUTE FUNCTION app.proteger_version_tarifa();

-- RLS ya está habilitada y forzada desde la 0007. Core accede solo con mani_core_svc y nunca borra.
ALTER TABLE tarifa_referencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifa_referencia FORCE ROW LEVEL SECURITY;
REVOKE ALL ON tarifa_referencia FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON tarifa_referencia FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        REVOKE DELETE ON tarifa_referencia FROM mani_core_svc;
        GRANT SELECT, INSERT, UPDATE ON tarifa_referencia TO mani_core_svc;
        DROP POLICY IF EXISTS tarifa_referencia_tenant ON tarifa_referencia;
        CREATE POLICY tarifa_referencia_tenant ON tarifa_referencia
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0029', 'SCRUM-885 tarifa_referencia: moneda, vigencia, condiciones, versiones inmutables y auditoria')
ON CONFLICT (version) DO NOTHING;
