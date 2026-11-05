-- =====================================================================
-- Migración 0039 — Lectores del contexto sin depender del esquema auth
-- (SCRUM-1468 / TEC-21).
--
-- La 0006 hace que app.tenant_id(), app.user_id() y app.user_role() llamen a
-- auth.jwt() y auth.uid(), y da a los roles de servicio USAGE sobre el esquema
-- auth. En Supabase ese esquema es de `supabase_admin` y `postgres` no tiene
-- GRANT OPTION: el GRANT solo emite "no privileges were granted" y la migración
-- sigue. Al conectar como mani_core_svc y mani_dispatch_svc, cada lectura con
-- contexto termina en "permission denied for schema auth" (Core responde 500).
-- CI no lo detecta porque su esquema auth es de `postgres`.
--
-- Los tres lectores pasan a leer `request.jwt.claims`, el mismo valor que
-- escribe app.set_context y que PostgREST fija para cada petición. Mantienen la
-- falla cerrada: sin contexto o con un claim malformado devuelven NULL.
-- CREATE OR REPLACE conserva dueño y permisos, y las políticas no se tocan.
--
-- Reversa: volver a crear las tres funciones como están en la 0006.
-- Idempotente y segura de reaplicar en DEV, QA y PostgreSQL local.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app.tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    RETURN (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
            -> 'app_metadata' ->> 'tenant_id')::uuid;
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
    RETURN (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    RETURN lower(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
                 -> 'app_metadata' ->> 'user_role');
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RETURN NULL;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0039', 'SCRUM-1468 (TEC-21) app.tenant_id, user_id y user_role leen request.jwt.claims sin pasar por el esquema auth')
ON CONFLICT (version) DO NOTHING;
