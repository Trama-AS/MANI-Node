-- =====================================================================
-- Migración 0005 — Cierra tres exposiciones de datos a la clave anónima
-- (SCRUM-1334 / ADR-0032 §8).
--
-- Son independientes del modelo de identidad de CFG-23a/23b: no cambian cómo
-- se evalúa RLS para los servicios, solo retiran accesos que ningún camino
-- legítimo usa. Core (service_role) y Dispatch (postgres) tienen BYPASSRLS y
-- no se ven afectados; Flutter no hace .from()/.rpc() sobre estas tablas ni
-- sobre la función (solo invoca RPC SECURITY DEFINER distintas).
--
-- Idempotente y segura de reaplicar. Sin `anon`/`authenticated` (p. ej. un
-- PostgreSQL local) los bloques que dependen de esos roles se omiten.
-- =====================================================================

-- 1. registrar_aliado_persona_natural y registrar_aliado_empresa estaban
--    concedidas a anon, son SECURITY DEFINER y reciben p_usuario_id y
--    p_tenant_id por parámetro. Con la clave anónima del bundle web cualquiera
--    podía crear usuarios y aliados en cualquier tenant y, peor, el upsert
--    `ON CONFLICT (id) DO UPDATE SET rol = 'ALIADO', estado = 'ACTIVO'`
--    permitía reescribir el rol y reactivar a CUALQUIER usuario existente
--    conociendo su UUID. Ninguna rama de ningún repositorio las invoca: el
--    registro vive en Core (US-02.1.1-M2, ADR-0022). Se retira el acceso de
--    los roles de PostgREST; la función se elimina en una migración posterior
--    cuando la regresión de QA lo confirme. Se cubren todos los overloads.
--
--    NO se toca registrar_cliente_persona_natural (mismo defecto): el cliente
--    Flutter de la rama `release` todavía la invoca por PostgREST, y revocarla
--    sin confirmar qué build está desplegado rompería el registro de clientes.
--    Queda registrada en SCRUM-1334 para decidirla aparte.
DO $$
DECLARE
    fn RECORD;
    role_name TEXT;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('registrar_aliado_persona_natural', 'registrar_aliado_empresa')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn.sig, role_name);
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- 2. documento_kyc tenía SELECT e INSERT con USING (true) / WITH CHECK (true):
--    cualquier rol con acceso a PostgREST leía e insertaba filas (rutas de
--    Storage de habeas data incluidas) de todos los tenants. Sin política,
--    RLS deniega a todo rol sin BYPASSRLS; la política correcta (propio aliado
--    o admin_tenant del mismo tenant) la define CFG-23b.
ALTER TABLE IF EXISTS documento_kyc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Aliados pueden subir sus documentos KYC" ON documento_kyc;
DROP POLICY IF EXISTS "Aliados pueden consultar sus documentos KYC" ON documento_kyc;

-- 3. Tablas con datos de negocio sin RLS: con los privilegios por defecto de
--    Supabase eran legibles y escribibles con la clave anónima. Se habilita
--    RLS sin políticas (deniega); no se usa FORCE todavía porque eso exige
--    que CFG-23b ya haya movido a los servicios a roles sin BYPASSRLS.
--    `zona` es un catálogo geográfico global sin tenant_id: conserva lectura
--    pública pero pierde la escritura anónima.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'cliente', 'sitio', 'tarifa_referencia', 'cobertura_aliado', 'solicitud',
        'cotizacion', 'mensaje', 'evento_servicio', 'calificacion', 'notificacion', 'zona'
    ] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        END IF;
    END LOOP;

    IF to_regclass('public.zona') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zona' AND policyname = 'zona_lectura_publica'
    ) THEN
        CREATE POLICY zona_lectura_publica ON zona FOR SELECT USING (true);
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0005', 'SCRUM-1334 cierra exposiciones a anon: registrar_aliado_persona_natural, documento_kyc abierto y 11 tablas sin RLS')
ON CONFLICT (version) DO NOTHING;
