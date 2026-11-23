-- =====================================================================
-- Migración 0044 (Core Node) — `anon` deja de leer `tenant` y `zona` (SCRUM-1720, ADR-0032)
-- =====================================================================
-- Origen: consulta D10 de SCRUM-1696 en QA. Había dos políticas `TO public` de solo lectura, `lectura_global_tenant`
-- en `tenant` y `lectura_global_zona` en `zona`, que no vienen de ninguna migración: se crearon a mano.
--
-- Por qué no basta con borrar esas dos: la 0007 crea además las canónicas `tenant_lectura` y `zona_lectura` con
-- `TO anon, authenticated, mani_core_svc, mani_dispatch_svc USING (true)` («directorio de slugs pre-auth» y «catálogo
-- geográfico global», db/README.md §3) y concede `SELECT` sobre las dos tablas a `anon`. La llave `anon` es pública en la
-- app web, así que, aun sin las manuales, cualquiera podría listar sin sesión los tenants y las zonas de todas las
-- empresas. Eso contradice el aislamiento por tenant (ADR-0032). Para que con la llave `anon` ya no se listen:
--
--   1. se retiran las dos políticas creadas a mano;
--   2. las canónicas se recrean SIN `anon` (siguen leyendo `authenticated`, `mani_core_svc` y `mani_dispatch_svc`);
--   3. se revoca el `SELECT` de `anon` sobre `tenant` y `zona`.
--
-- Nada en el código lo necesita: Flutter solo usa Supabase para iniciar sesión (test/core/arquitectura/
-- supabase_solo_auth_test.dart prohíbe `.from()`), la llave `anon` solo se usa con GoTrue y el almacenamiento, y Core
-- lee estas tablas como `mani_core_svc`. El registro pre-auth resuelve el tenant por el `X-Tenant-Slug` a través de Core.
--
-- Idempotente y segura de reaplicar en DEV, QA, PROD y PostgreSQL local. No toca datos.
-- Si queda otra política abierta a PUBLIC o a anon sobre estas tablas, avisa con un WARNING.

DROP POLICY IF EXISTS lectura_global_tenant ON tenant;
DROP POLICY IF EXISTS lectura_global_zona ON zona;

DO $$
DECLARE
    roles_lectura TEXT;
BEGIN
    -- Solo los roles que existen: en una base sin Supabase puede faltar alguno.
    SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO roles_lectura
    FROM pg_roles
    WHERE rolname IN ('authenticated', 'mani_core_svc', 'mani_dispatch_svc');

    IF roles_lectura IS NULL THEN
        RAISE NOTICE 'SCRUM-1720: no existen los roles de lectura; se dejan tenant y zona sin política canónica';
    ELSE
        DROP POLICY IF EXISTS tenant_lectura ON tenant;
        EXECUTE format('CREATE POLICY tenant_lectura ON tenant FOR SELECT TO %s USING (true)', roles_lectura);
        DROP POLICY IF EXISTS zona_lectura ON zona;
        EXECUTE format('CREATE POLICY zona_lectura ON zona FOR SELECT TO %s USING (true)', roles_lectura);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE SELECT ON tenant, zona FROM anon;
    END IF;
END $$;

DO $$
DECLARE
    abiertas TEXT;
BEGIN
    SELECT string_agg(tablename || '.' || policyname, ', ') INTO abiertas
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tenant', 'zona')
      AND cmd IN ('SELECT', 'ALL')
      AND (roles && ARRAY['public', 'anon']::name[]);
    IF abiertas IS NOT NULL THEN
        RAISE WARNING 'SCRUM-1720: siguen políticas de lectura abiertas a PUBLIC o anon en tenant/zona: %', abiertas;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0044', 'SCRUM-1720 anon deja de leer tenant y zona: se retiran lectura_global_* y anon sale de las políticas canónicas')
ON CONFLICT (version) DO NOTHING;
