-- =====================================================================
-- Migración 0030 (Core Node) — Quejas del cliente y su gestión por el tenant (SCRUM-895 / HU-M12-01, SCRUM-896 / HU-M12-02)
-- =====================================================================
-- RF-26. El cliente presenta una queja sobre un servicio propio con motivo y descripción; el administrador del tenant
-- la atiende cambiando su estado. Cada transición queda en un historial inmutable con actor, rol, fecha y nota (T10).
--   * queja: una fila por queja. Solo puede haber una queja abierta (ABIERTA o EN_REVISION) por solicitud, también
--     ante envíos simultáneos (índice único parcial).
--   * Transiciones válidas (C2 de SCRUM-896), garantizadas también por el motor con un disparador:
--       ABIERTA     -> EN_REVISION | RESUELTA | RECHAZADA
--       EN_REVISION -> RESUELTA | RECHAZADA
--     RESUELTA y RECHAZADA son finales. Una actualización solo cambia estado, respuesta y updated_at.
--   * queja_transicion: historial inmutable (sin UPDATE, DELETE ni TRUNCATE). La creación queda como la transición
--     NULL -> ABIERTA hecha por el cliente.
--   * RLS (T3): además del tenant, el cliente solo ve y crea quejas propias y solo admin_tenant cambia su estado.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS queja (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    solicitud_id UUID NOT NULL REFERENCES solicitud(id) ON DELETE RESTRICT,
    cliente_id UUID NOT NULL REFERENCES cliente(id) ON DELETE RESTRICT,
    motivo TEXT NOT NULL CHECK (motivo IN (
        'CALIDAD_DEL_SERVICIO', 'INCUMPLIMIENTO_DE_HORARIO', 'COBRO_INDEBIDO', 'TRATO_INADECUADO', 'DANO_A_LA_PROPIEDAD', 'OTRO'
    )),
    descripcion TEXT NOT NULL CHECK (descripcion = btrim(descripcion) AND char_length(descripcion) BETWEEN 10 AND 1000),
    estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA', 'EN_REVISION', 'RESUELTA', 'RECHAZADA')),
    respuesta TEXT CHECK (respuesta IS NULL OR char_length(respuesta) BETWEEN 5 AND 1000),
    creado_por UUID NOT NULL,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_queja_abierta_por_solicitud
    ON queja (tenant_id, solicitud_id)
    WHERE estado IN ('ABIERTA', 'EN_REVISION');

CREATE INDEX IF NOT EXISTS idx_queja_tenant_estado_fecha ON queja (tenant_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queja_tenant_cliente ON queja (tenant_id, cliente_id, created_at DESC);

CREATE TABLE IF NOT EXISTS queja_transicion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    queja_id UUID NOT NULL REFERENCES queja(id) ON DELETE RESTRICT,
    estado_anterior TEXT CHECK (estado_anterior IS NULL OR estado_anterior IN ('ABIERTA', 'EN_REVISION', 'RESUELTA', 'RECHAZADA')),
    estado_nuevo TEXT NOT NULL CHECK (estado_nuevo IN ('ABIERTA', 'EN_REVISION', 'RESUELTA', 'RECHAZADA')),
    actor_id UUID NOT NULL,
    actor_rol TEXT NOT NULL,
    nota TEXT CHECK (nota IS NULL OR char_length(nota) BETWEEN 5 AND 1000),
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queja_transicion_queja ON queja_transicion (tenant_id, queja_id, created_at);

-- C2 de SCRUM-896: el motor rechaza una transición inválida aunque la aplicación la dejara pasar.
CREATE OR REPLACE FUNCTION app.proteger_transicion_queja() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'MANI-QJA-409I: una queja no se borra (SCRUM-896)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['estado', 'respuesta', 'updated_at']) <> (to_jsonb(OLD) - ARRAY['estado', 'respuesta', 'updated_at']) THEN
        RAISE EXCEPTION 'MANI-QJA-409I: de una queja solo cambian el estado y la respuesta (SCRUM-896)'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (
        (OLD.estado = 'ABIERTA' AND NEW.estado IN ('EN_REVISION', 'RESUELTA', 'RECHAZADA'))
        OR (OLD.estado = 'EN_REVISION' AND NEW.estado IN ('RESUELTA', 'RECHAZADA'))
    ) THEN
        RAISE EXCEPTION 'MANI-QJA-409T: transición de queja no permitida: % -> % (SCRUM-896)', OLD.estado, NEW.estado
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queja_transicion_valida ON queja;
CREATE TRIGGER trg_queja_transicion_valida
    BEFORE UPDATE OR DELETE ON queja
    FOR EACH ROW EXECUTE FUNCTION app.proteger_transicion_queja();

CREATE OR REPLACE FUNCTION app.bloquear_modificacion_queja_transicion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'queja_transicion es inmutable: no admite % (SCRUM-896)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_queja_transicion_inmutable ON queja_transicion;
CREATE TRIGGER trg_queja_transicion_inmutable
    BEFORE UPDATE OR DELETE ON queja_transicion
    FOR EACH ROW EXECUTE FUNCTION app.bloquear_modificacion_queja_transicion();

DROP TRIGGER IF EXISTS trg_queja_transicion_sin_truncate ON queja_transicion;
CREATE TRIGGER trg_queja_transicion_sin_truncate
    BEFORE TRUNCATE ON queja_transicion
    FOR EACH STATEMENT EXECUTE FUNCTION app.bloquear_modificacion_queja_transicion();

ALTER TABLE queja ENABLE ROW LEVEL SECURITY;
ALTER TABLE queja FORCE ROW LEVEL SECURITY;
ALTER TABLE queja_transicion ENABLE ROW LEVEL SECURITY;
ALTER TABLE queja_transicion FORCE ROW LEVEL SECURITY;

REVOKE ALL ON queja, queja_transicion FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON queja, queja_transicion FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT, UPDATE ON queja TO mani_core_svc;
        GRANT SELECT, INSERT ON queja_transicion TO mani_core_svc;

        -- El cliente ve y crea solo quejas propias; el administrador del tenant ve todas las del tenant.
        DROP POLICY IF EXISTS queja_lectura ON queja;
        CREATE POLICY queja_lectura ON queja
            FOR SELECT TO mani_core_svc
            USING (
                tenant_id = app.tenant_id()
                AND (
                    app.user_role() = 'admin_tenant'
                    OR cliente_id IN (SELECT c.id FROM cliente c WHERE c.usuario_id = app.user_id() AND c.tenant_id = app.tenant_id())
                )
            );
        DROP POLICY IF EXISTS queja_alta_cliente ON queja;
        CREATE POLICY queja_alta_cliente ON queja
            FOR INSERT TO mani_core_svc
            WITH CHECK (
                tenant_id = app.tenant_id()
                AND app.user_role() = 'cliente'
                AND creado_por = app.user_id()
                AND cliente_id IN (SELECT c.id FROM cliente c WHERE c.usuario_id = app.user_id() AND c.tenant_id = app.tenant_id())
            );
        DROP POLICY IF EXISTS queja_gestion_admin ON queja;
        CREATE POLICY queja_gestion_admin ON queja
            FOR UPDATE TO mani_core_svc
            USING (tenant_id = app.tenant_id() AND app.user_role() = 'admin_tenant')
            WITH CHECK (tenant_id = app.tenant_id() AND app.user_role() = 'admin_tenant');

        DROP POLICY IF EXISTS queja_transicion_lectura ON queja_transicion;
        CREATE POLICY queja_transicion_lectura ON queja_transicion
            FOR SELECT TO mani_core_svc
            USING (tenant_id = app.tenant_id() AND queja_id IN (SELECT q.id FROM queja q));
        DROP POLICY IF EXISTS queja_transicion_alta ON queja_transicion;
        CREATE POLICY queja_transicion_alta ON queja_transicion
            FOR INSERT TO mani_core_svc
            WITH CHECK (
                tenant_id = app.tenant_id()
                AND actor_id = app.user_id()
                AND queja_id IN (SELECT q.id FROM queja q)
                AND (app.user_role() = 'admin_tenant' OR (app.user_role() = 'cliente' AND estado_anterior IS NULL))
            );
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0030', 'SCRUM-895/896 queja del cliente con transiciones validas, historial inmutable y RLS por tenant y actor')
ON CONFLICT (version) DO NOTHING;
