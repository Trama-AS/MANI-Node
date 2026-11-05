-- =====================================================================
-- Migración 0037 — Retiro de las políticas `tenant_isolation_*` abiertas a
-- PUBLIC y permisos que Core necesita al conectarse sin BYPASSRLS
-- (SCRUM-1468 / TEC-21; cierra R-06 y BUG-SEC-02 junto con el cambio de
-- credenciales de Core y Dispatch).
--
-- 1. Las políticas `tenant_isolation_<tabla>` de ADR-0018 se crearon a mano en
--    QA (SQL del dashboard de la PoC), fuera de la serie de migraciones, sin
--    cláusula TO: aplican a PUBLIC, es decir, también a `anon`. La 0007 solo
--    retiró la de `solicitud`. Como sus nombres exactos no viven en git, aquí
--    se recorren por patrón en el catálogo:
--      - si la tabla ya tiene otra política (las canónicas de la 0007 en
--        adelante), la heredada se ELIMINA: las políticas permisivas se suman
--        con OR, así que una heredada que solo compara el tenant ampliaría lo
--        que permiten las canónicas (p. ej. KYC, que además exige el aliado
--        propio o el admin del tenant);
--      - si es la única política de la tabla, se conserva su condición y se
--        restringe a `authenticated` y `mani_core_svc` (ALTER POLICY ... TO),
--        para no dejar la tabla sin acceso al quitarla.
--    Cada decisión queda en un NOTICE con la tabla y la política.
-- 2. `consentimiento_usuario`: el registro compensa un alta fallida borrando
--    el consentimiento del usuario recién creado. Con BYPASSRLS eso funcionaba
--    sin permiso; con `mani_core_svc` hace falta DELETE y una política que lo
--    limite al propio usuario del tenant.
-- 3. Aviso (WARNING, no error) si queda cualquier otra política TO PUBLIC en
--    una tabla con `tenant_id`, para que operaciones la revise.
--
-- Las credenciales LOGIN de `mani_core_svc` y `mani_dispatch_svc` NO se fijan
-- aquí: las asigna operaciones con db/ops/credenciales_roles_servicio.sql,
-- sin que la contraseña pase por git (ADR-0031 §5).
--
-- Idempotente y segura de reaplicar en DEV, QA y PostgreSQL local.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. Políticas `tenant_isolation_*` abiertas a PUBLIC (R-06) ----------------
DO $$
DECLARE
    p RECORD;
    otras INTEGER;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND policyname LIKE 'tenant\_isolation\_%'
           AND 'public' = ANY (roles)
         ORDER BY tablename, policyname
    LOOP
        SELECT count(*)
          INTO otras
          FROM pg_policies
         WHERE schemaname = p.schemaname
           AND tablename = p.tablename
           AND policyname <> p.policyname
           AND policyname NOT LIKE 'tenant\_isolation\_%';

        IF otras > 0 THEN
            EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
            RAISE NOTICE 'SCRUM-1468: % sobre % eliminada (la tabla ya tiene % política(s) canónica(s))',
                p.policyname, p.tablename, otras;
        ELSE
            EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated, mani_core_svc',
                p.policyname, p.schemaname, p.tablename);
            RAISE NOTICE 'SCRUM-1468: % sobre % restringida a authenticated y mani_core_svc (única política de la tabla)',
                p.policyname, p.tablename;
        END IF;
    END LOOP;
END $$;

-- 2. Borrado del consentimiento propio (compensación del registro) ----------
DO $$
BEGIN
    IF to_regclass('public.consentimiento_usuario') IS NOT NULL THEN
        GRANT DELETE ON consentimiento_usuario TO mani_core_svc;

        DROP POLICY IF EXISTS consentimiento_usuario_borrado ON consentimiento_usuario;
        CREATE POLICY consentimiento_usuario_borrado ON consentimiento_usuario
            FOR DELETE TO mani_core_svc
            USING (
                usuario_id = app.user_id()
                AND (tenant_id IS NULL OR tenant_id = app.tenant_id())
            );
    END IF;
END $$;

-- 3. Ninguna otra política TO PUBLIC sobre datos de un tenant ---------------
DO $$
DECLARE
    pendientes TEXT;
BEGIN
    SELECT string_agg(format('%s.%s', p.tablename, p.policyname), ', ' ORDER BY p.tablename, p.policyname)
      INTO pendientes
      FROM pg_policies p
      JOIN information_schema.columns c
        ON c.table_schema = p.schemaname AND c.table_name = p.tablename AND c.column_name = 'tenant_id'
     WHERE p.schemaname = 'public'
       AND 'public' = ANY (p.roles);

    IF pendientes IS NOT NULL THEN
        RAISE WARNING 'SCRUM-1468: siguen políticas TO PUBLIC en tablas con tenant_id: %', pendientes;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0037', 'SCRUM-1468 (TEC-21) retira tenant_isolation_* TO public y permite a mani_core_svc compensar consentimientos')
ON CONFLICT (version) DO NOTHING;
