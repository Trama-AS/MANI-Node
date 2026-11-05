-- =====================================================================
-- Migración 0016 (Core Node) — Política de solicitud_rechazo sin leer `aliado` (SCRUM-1450 / TEC-03, D-3, P-6)
-- =====================================================================
-- Defecto D-3: la política `solicitud_rechazo_aliado` (0007 §4.5) comprueba que el aliado es el usuario de la sesión con
-- `aliado_id IN (SELECT a.id FROM aliado a WHERE a.usuario_id = app.user_id())`. Esa subconsulta corre con los
-- privilegios del rol que escribe, y `mani_dispatch_svc` no tiene (ni debe tener, ADR-0030) permiso sobre `aliado`: el
-- INSERT de un rechazo falla con «permission denied for table aliado».
--
-- Salida elegida para P-6 (a ratificar por la Mesa): NO conceder SELECT sobre `aliado` a Dispatch. La comprobación se
-- mueve a una función `SECURITY DEFINER` que solo responde un booleano y solo sobre el aliado y el tenant de la sesión:
--   * no amplía la superficie de lectura de `aliado` (Dispatch sigue sin poder leerla);
--   * no sirve para sondear aliados ajenos: compara siempre contra app.user_id() y app.tenant_id() de la sesión;
--   * `search_path` vacío y nombres calificados, para que no se pueda suplantar un objeto;
--   * EXECUTE solo para los roles que evalúan la política.
-- La política conserva su regla: Patrón T (mismo tenant) y aliado propio.
--
-- La función debe pertenecer a un rol que se salte RLS (superusuario o BYPASSRLS, como `postgres`), porque `aliado` tiene
-- FORCE ROW LEVEL SECURITY. La migración falla de forma explícita si no es así, en vez de dejar una política que
-- rechazaría todo en silencio. Aditiva e idempotente.

DO $$
BEGIN
    IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'MANI-RLS-500: la migración 0016 debe aplicarla un rol que se salte RLS (superusuario o BYPASSRLS), no %', current_user;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION app.es_aliado_del_usuario(p_aliado_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.aliado a
        WHERE a.id = p_aliado_id
          AND a.tenant_id = app.tenant_id()
          AND a.usuario_id = app.user_id()
    )
$$;

REVOKE ALL ON FUNCTION app.es_aliado_del_usuario(uuid) FROM PUBLIC;

DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['authenticated', 'mani_dispatch_svc'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION app.es_aliado_del_usuario(uuid) TO %I', r);
        END IF;
    END LOOP;

    IF to_regclass('public.solicitud_rechazo') IS NOT NULL THEN
        DROP POLICY IF EXISTS solicitud_rechazo_aliado ON solicitud_rechazo;
        CREATE POLICY solicitud_rechazo_aliado ON solicitud_rechazo
            FOR ALL TO authenticated, mani_dispatch_svc
            USING (
                tenant_id = app.tenant_id()
                AND app.es_aliado_del_usuario(aliado_id)
            )
            WITH CHECK (
                tenant_id = app.tenant_id()
                AND app.es_aliado_del_usuario(aliado_id)
            );
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0016', 'SCRUM-1450 (TEC-03) politica solicitud_rechazo_aliado sin leer aliado: funcion SECURITY DEFINER app.es_aliado_del_usuario')
ON CONFLICT (version) DO NOTHING;
