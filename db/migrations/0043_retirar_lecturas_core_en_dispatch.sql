-- =====================================================================
-- Migración 0043 (Core Node) — Retiro de lecturas de Dispatch sobre tablas de Core (SCRUM-1660 / T-23 / QAS-20)
-- =====================================================================
-- Contexto (ADR-0030, QAS-20):
--   Cada microservicio accede exclusivamente a las tablas de su propio dominio.
--   - `MANI-Node` (`mani_core_svc`) es dueño de `tenant`, `zona`, `solicitud`, `usuario`, `aliado`, `cliente`, etc.
--   - `MANI-.NET` (`mani_dispatch_svc`) es dueño únicamente de `solicitud_rechazo`.
--   Las asignaciones del aliado (`GET /api/v1/dispatch/assignments/me`) y la bandeja de ofertas (`GET /api/v1/dispatch/offers/me`)
--   se consultan a través del endpoint interno de Core (`GET /api/v1/allies/me/offers`), por lo que Dispatch ya no ejecuta
--   `SELECT` directo sobre `solicitud`, `tenant` ni `zona`.
--
-- Esta migración:
--   1. Revoca `SELECT` sobre `tenant`, `zona` y `solicitud` al rol `mani_dispatch_svc`.
--   2. Recrea las políticas `tenant_lectura`, `zona_lectura` y `solicitud_lectura` sin incluir a `mani_dispatch_svc`.
--   3. Deja a `mani_dispatch_svc` únicamente con `SELECT, INSERT` sobre `solicitud_rechazo` y `EXECUTE` sobre
--      `app.set_context(uuid, uuid, text)` y `app.es_aliado_del_usuario(uuid)`.
--
-- Idempotente y segura de reaplicar.
-- =====================================================================

DO $$
BEGIN
    IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'MANI-RLS-500: la migración 0043 debe aplicarla un rol que se salte RLS (superusuario o BYPASSRLS), no %', current_user;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_dispatch_svc') THEN
        REVOKE ALL ON TABLE tenant, zona, solicitud FROM mani_dispatch_svc;
    END IF;
END $$;

DROP POLICY IF EXISTS tenant_lectura ON tenant;
CREATE POLICY tenant_lectura ON tenant
    FOR SELECT TO anon, authenticated, mani_core_svc
    USING (true);

DROP POLICY IF EXISTS zona_lectura ON zona;
CREATE POLICY zona_lectura ON zona
    FOR SELECT TO anon, authenticated, mani_core_svc
    USING (true);

DROP POLICY IF EXISTS solicitud_lectura ON solicitud;
CREATE POLICY solicitud_lectura ON solicitud
    FOR SELECT TO authenticated, mani_core_svc
    USING (tenant_id = app.tenant_id());

INSERT INTO schema_migrations (version, description)
VALUES ('0043', 'SCRUM-1660 (T-23 / QAS-20): retirar permisos de lectura de mani_dispatch_svc sobre tablas de Core (tenant, zona, solicitud)')
ON CONFLICT (version) DO NOTHING;
