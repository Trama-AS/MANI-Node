-- =====================================================================
-- Migración 0006 — Contexto de identidad en base de datos y roles de
-- servicio sin BYPASSRLS (SCRUM-1104 / CFG-23b — Paso 2, ADR-0032).
--
-- Materializa en la serie canónica de migraciones (ADR-0030) los
-- componentes del motor definidos en CFG-23a (`02-diseno-modelo-identidad.md` §3):
--   1. Roles de servicio `mani_core_svc` y `mani_dispatch_svc` con
--      `NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`.
--      Operaciones (DevOps) asigna `LOGIN PASSWORD` fuera de git
--      (`/opt/mani/.env.{dev,qa,prod}`, ADR-0031 §5) en el Paso 5.
--   2. Permisos `USAGE ON SCHEMA auth` y `EXECUTE` sobre `auth.jwt()` y
--      `auth.uid()` a ambos roles (en entornos PostgreSQL locales sin
--      Supabase se crean equivalentes compatibles de `auth` y roles base).
--   3. Esquema `app` (`REVOKE ALL FROM PUBLIC`) con las funciones lectoras
--      `app.tenant_id()`, `app.user_id()`, `app.user_role()` (`STABLE`,
--      `search_path = ''`, falla cerrada devolviendo `NULL` ante claim
--      ausente o malformado).
--   4. Función escritora `app.set_context(uuid, uuid, text)` que fija
--      `request.jwt.claims` con `is_local = true` (muere al terminar la
--      transacción) y rechaza `tenant_id NULL` (`MANI-RLS-400`, `22023`),
--      ejecutable únicamente por `mani_core_svc` y `mani_dispatch_svc`.
--
-- Idempotente y segura de reaplicar en DEV, QA y PostgreSQL 16 local.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. Compatibilidad de base para entornos PostgreSQL sin Supabase ------------
--    En Supabase (DEV/QA/PROD) `anon`, `authenticated`, `service_role` y
--    `auth.jwt()` / `auth.uid()` ya existen y no se alteran.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
    IF to_regprocedure('auth.jwt()') IS NULL THEN
        EXECUTE $fn$
            CREATE FUNCTION auth.jwt() RETURNS jsonb
            LANGUAGE sql STABLE
            AS $body$
                SELECT coalesce(
                    nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), '')
                )::jsonb
            $body$;
        $fn$;
    END IF;

    IF to_regprocedure('auth.uid()') IS NULL THEN
        EXECUTE $fn$
            CREATE FUNCTION auth.uid() RETURNS uuid
            LANGUAGE sql STABLE
            AS $body$
                SELECT coalesce(
                    nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
                )::uuid
            $body$;
        $fn$;
    END IF;
END $$;

-- 2. Roles de servicio sin BYPASSRLS (ADR-0032 §3) ---------------------------
--    Se crean con NOLOGIN en la migración; si ya existen (p. ej. tras asignar
--    LOGIN PASSWORD en QA), se reafirma NOBYPASSRLS y NOSUPERUSER sin revocar
--    el atributo LOGIN configurado por operaciones.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        CREATE ROLE mani_core_svc NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    ELSE
        ALTER ROLE mani_core_svc NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_dispatch_svc') THEN
        CREATE ROLE mani_dispatch_svc NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    ELSE
        ALTER ROLE mani_dispatch_svc NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

-- Las políticas evalúan auth.jwt() / auth.uid() con el rol del llamador:
-- los roles de servicio necesitan USAGE sobre el esquema auth.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, mani_core_svc, mani_dispatch_svc;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role, mani_core_svc, mani_dispatch_svc;

-- 3. Esquema `app` y funciones de contexto -----------------------------------
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role, mani_core_svc, mani_dispatch_svc;

-- Lectores del contexto: una sola fuente (`request.jwt.claims`) para PostgREST
-- y para servicios. Un claim ausente o malformado devuelve NULL (falla cerrada).
CREATE OR REPLACE FUNCTION app.tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    RETURN (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    RETURN auth.uid();
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.user_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT lower(auth.jwt() -> 'app_metadata' ->> 'user_role')
$$;

REVOKE ALL ON FUNCTION app.tenant_id(), app.user_id(), app.user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tenant_id(), app.user_id(), app.user_role()
    TO anon, authenticated, service_role, mani_core_svc, mani_dispatch_svc;

-- Escritor del contexto: invocado por el servicio como primera sentencia de
-- cada transacción con los claims YA VERIFICADOS (X-Tenant-Id, X-User-Id,
-- X-User-Role del Gateway, ADR-0031). `is_local = true` garantiza que el valor
-- muere con la transacción y no se filtra a la siguiente petición del pool.
CREATE OR REPLACE FUNCTION app.set_context(
    p_tenant_id uuid,
    p_user_id uuid,
    p_user_role text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'MANI-RLS-400: el contexto exige tenant_id' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        pg_catalog.json_build_object(
            'sub', p_user_id,
            'role', 'authenticated',
            'app_metadata', pg_catalog.json_build_object(
                'tenant_id', p_tenant_id,
                'user_role', lower(p_user_role)
            )
        )::text,
        true
    );
END $$;

REVOKE ALL ON FUNCTION app.set_context(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.set_context(uuid, uuid, text) TO mani_core_svc, mani_dispatch_svc;

INSERT INTO schema_migrations (version, description)
VALUES ('0006', 'SCRUM-1104 (CFG-23b) contexto de identidad app.*, set_context y roles mani_core_svc/mani_dispatch_svc NOBYPASSRLS')
ON CONFLICT (version) DO NOTHING;
