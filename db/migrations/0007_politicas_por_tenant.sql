-- =====================================================================
-- Migración 0007 — Políticas RLS por tenant, FORCE RLS y frontera de
-- privilegios por rol de servicio (SCRUM-1104 / CFG-23b — Paso 3, ADR-0032).
--
-- Materializa la matriz de permisos y políticas de `02-diseno-modelo-identidad.md` §5:
--   1. Frontera de datos por dominio (ADR-0030) impuesta por GRANT:
--      - `mani_core_svc`: acceso a las tablas del dominio de Core; sin acceso
--        a `solicitud_rechazo` (dominio de Dispatch).
--      - `mani_dispatch_svc`: SELECT sobre `tenant`/`zona`, SELECT + UPDATE
--        sobre `solicitud` (aceptación atómica ADR-0016) y SELECT + INSERT
--        sobre `solicitud_rechazo`; sin permisos sobre `aliado`, `notificacion`,
--        `documento_kyc`, `usuario`, `cliente`, `sitio`, etc.
--   2. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` en todas las
--      tablas con `tenant_id` (y `ENABLE` en `tenant` y `zona`).
--   3. Retiro de las políticas legadas que dependían de `auth.uid()` directo,
--      `USING (true)` en tablas multi-tenant o `TO public` implícito, y
--      creación de las políticas canónicas basadas en `app.tenant_id()`,
--      `app.user_id()` y `app.user_role()` con `TO` explícito.
--   4. Actualización de las políticas de `storage.objects` (`kyc-documentos`
--      y `solicitudes`) cuando el esquema `storage` de Supabase está presente.
--
-- Idempotente y segura de reaplicar en DEV, QA y PostgreSQL 16 local.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. Privilegios de esquema y frontera de datos por servicio (ADR-0030) ------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, mani_core_svc, mani_dispatch_svc;

-- Asegura compatibilidad con los privilegios base de Supabase en PostgreSQL local
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- Limpia cualquier privilegio residual sobre tablas de public para los roles
-- de servicio antes de conceder exclusivamente la matriz de ADR-0030 / §5.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mani_core_svc, mani_dispatch_svc;

-- Directorios globales de solo lectura para ambos servicios y pre-auth
GRANT SELECT ON tenant, zona TO anon, authenticated, mani_core_svc, mani_dispatch_svc;

-- Tablas CRUD de dominio de Core Service
GRANT SELECT, INSERT, UPDATE, DELETE ON
    usuario,
    categoria_servicio,
    aliado,
    cliente,
    sitio,
    aliado_categoria,
    cobertura_aliado,
    documento_kyc,
    tarifa_referencia,
    cotizacion,
    mensaje,
    evento_servicio,
    calificacion,
    notificacion
TO mani_core_svc;

-- `solicitud`: Core crea y gestiona ciclo de vida; Dispatch consulta y acepta
GRANT SELECT, INSERT, UPDATE ON solicitud TO mani_core_svc;
GRANT SELECT, UPDATE ON solicitud TO mani_dispatch_svc;

-- Tablas creadas en migraciones incrementales (005, 006, 008, 0004)
DO $$
BEGIN
    IF to_regclass('public.aliado_ausencia') IS NOT NULL THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON aliado_ausencia TO mani_core_svc;
    END IF;

    IF to_regclass('public.solicitud_foto') IS NOT NULL THEN
        GRANT SELECT, INSERT ON solicitud_foto TO mani_core_svc;
    END IF;

    IF to_regclass('public.documento_legal') IS NOT NULL THEN
        GRANT SELECT ON documento_legal TO anon, authenticated;
        GRANT SELECT, INSERT ON documento_legal TO mani_core_svc;
    END IF;

    IF to_regclass('public.consentimiento_usuario') IS NOT NULL THEN
        GRANT SELECT, INSERT ON consentimiento_usuario TO mani_core_svc;
    END IF;

    IF to_regclass('public.solicitud_rechazo') IS NOT NULL THEN
        GRANT SELECT, INSERT ON solicitud_rechazo TO mani_dispatch_svc;
    END IF;
END $$;

-- 2. ENABLE + FORCE ROW LEVEL SECURITY ---------------------------------------
--    `tenant` y `zona` no tienen `tenant_id` y la escritura queda reservada
--    a `postgres` (seeds/operaciones), por lo que habilitan RLS sin FORCE.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE zona ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'usuario',
        'categoria_servicio',
        'aliado',
        'cliente',
        'sitio',
        'aliado_categoria',
        'cobertura_aliado',
        'documento_kyc',
        'tarifa_referencia',
        'solicitud',
        'cotizacion',
        'mensaje',
        'evento_servicio',
        'calificacion',
        'notificacion',
        'aliado_ausencia',
        'solicitud_rechazo',
        'solicitud_foto',
        'documento_legal',
        'consentimiento_usuario'
    ] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        END IF;
    END LOOP;
END $$;

-- 3. Retiro de políticas legadas (init/04, 004–008, 0004, 0005 y QA manual) ---
DROP POLICY IF EXISTS "Lectura pública de tenants" ON tenant;
DROP POLICY IF EXISTS tenant_lectura ON tenant;

DROP POLICY IF EXISTS zona_lectura_publica ON zona;
DROP POLICY IF EXISTS zona_lectura ON zona;
DROP POLICY IF EXISTS zona_cobertura_select_auth ON zona;

DROP POLICY IF EXISTS "Lectura pública de categorias" ON categoria_servicio;
DROP POLICY IF EXISTS categoria_servicio_select_auth ON categoria_servicio;
DROP POLICY IF EXISTS categoria_servicio_tenant ON categoria_servicio;

DROP POLICY IF EXISTS "Usuarios pueden insertar su propio registro" ON usuario;
DROP POLICY IF EXISTS "Usuarios pueden ver su propio registro" ON usuario;
DROP POLICY IF EXISTS usuario_tenant ON usuario;

DROP POLICY IF EXISTS "Aliados pueden insertar su propio registro" ON aliado;
DROP POLICY IF EXISTS "Aliados pueden ver su propio perfil" ON aliado;
DROP POLICY IF EXISTS aliado_tenant ON aliado;

DROP POLICY IF EXISTS "Permitir vincular categoria a propio aliado" ON aliado_categoria;
DROP POLICY IF EXISTS "Lectura de categorias de aliado" ON aliado_categoria;
DROP POLICY IF EXISTS "Aliado lee sus propias categorias" ON aliado_categoria;
DROP POLICY IF EXISTS aliado_categoria_tenant ON aliado_categoria;

DROP POLICY IF EXISTS "Aliados pueden subir sus documentos KYC" ON documento_kyc;
DROP POLICY IF EXISTS "Aliados pueden consultar sus documentos KYC" ON documento_kyc;
DROP POLICY IF EXISTS documento_kyc_lectura ON documento_kyc;
DROP POLICY IF EXISTS documento_kyc_alta ON documento_kyc;
DROP POLICY IF EXISTS documento_kyc_resolucion_admin ON documento_kyc;
DROP POLICY IF EXISTS documento_kyc_borrado ON documento_kyc;

DROP POLICY IF EXISTS tenant_isolation_solicitud ON solicitud;
DROP POLICY IF EXISTS solicitud_lectura ON solicitud;
DROP POLICY IF EXISTS solicitud_alta_cliente ON solicitud;
DROP POLICY IF EXISTS solicitud_aceptar_aliado ON solicitud;
DROP POLICY IF EXISTS solicitud_transicion_core ON solicitud;

-- 4. Políticas canónicas por tabla (`02-diseno-modelo-identidad.md` §5) -------

-- 4.1 Directorios de lectura pública pre-auth (`tenant` y `zona`)
CREATE POLICY tenant_lectura ON tenant
    FOR SELECT TO anon, authenticated, mani_core_svc, mani_dispatch_svc
    USING (true);

CREATE POLICY zona_lectura ON zona
    FOR SELECT TO anon, authenticated, mani_core_svc, mani_dispatch_svc
    USING (true);

-- 4.2 Tablas de dominio de Core bajo Patrón T:
--     USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'usuario',
        'categoria_servicio',
        'aliado',
        'cliente',
        'sitio',
        'aliado_categoria',
        'cobertura_aliado',
        'tarifa_referencia',
        'cotizacion',
        'mensaje',
        'evento_servicio',
        'calificacion',
        'notificacion',
        'aliado_ausencia',
        'solicitud_foto'
    ] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
            IF t = 'aliado_ausencia' THEN
                EXECUTE 'DROP POLICY IF EXISTS "Aliado lee sus propias ausencias" ON aliado_ausencia';
            END IF;
            EXECUTE format(
                $p$CREATE POLICY %1$s_tenant ON %1$I
                   FOR ALL TO authenticated, mani_core_svc
                   USING (tenant_id = app.tenant_id())
                   WITH CHECK (tenant_id = app.tenant_id())$p$,
                t
            );
        END IF;
    END LOOP;
END $$;

-- 4.3 `documento_kyc`: tenant + (propio aliado o admin_tenant); alta para propio aliado
CREATE POLICY documento_kyc_lectura ON documento_kyc
    FOR SELECT TO authenticated, mani_core_svc
    USING (
        tenant_id = app.tenant_id()
        AND (
            app.user_role() = 'admin_tenant'
            OR aliado_id IN (SELECT a.id FROM aliado a WHERE a.usuario_id = app.user_id())
        )
    );

CREATE POLICY documento_kyc_alta ON documento_kyc
    FOR INSERT TO authenticated, mani_core_svc
    WITH CHECK (
        tenant_id = app.tenant_id()
        AND aliado_id IN (SELECT a.id FROM aliado a WHERE a.usuario_id = app.user_id())
    );

CREATE POLICY documento_kyc_resolucion_admin ON documento_kyc
    FOR UPDATE TO authenticated, mani_core_svc
    USING (tenant_id = app.tenant_id() AND app.user_role() = 'admin_tenant')
    WITH CHECK (tenant_id = app.tenant_id() AND app.user_role() = 'admin_tenant');

CREATE POLICY documento_kyc_borrado ON documento_kyc
    FOR DELETE TO authenticated, mani_core_svc
    USING (
        tenant_id = app.tenant_id()
        AND (
            app.user_role() = 'admin_tenant'
            OR aliado_id IN (SELECT a.id FROM aliado a WHERE a.usuario_id = app.user_id())
        )
    );

-- 4.4 `solicitud`: lectura por tenant; alta con rol cliente; aceptación con
--     rol aliado (corrige H-02/KI-13); transiciones operativas en Core por rol.
CREATE POLICY solicitud_lectura ON solicitud
    FOR SELECT TO authenticated, mani_core_svc, mani_dispatch_svc
    USING (tenant_id = app.tenant_id());

CREATE POLICY solicitud_alta_cliente ON solicitud
    FOR INSERT TO authenticated, mani_core_svc
    WITH CHECK (tenant_id = app.tenant_id() AND app.user_role() = 'cliente');

CREATE POLICY solicitud_aceptar_aliado ON solicitud
    FOR UPDATE TO authenticated, mani_dispatch_svc
    USING (tenant_id = app.tenant_id() AND app.user_role() = 'aliado')
    WITH CHECK (tenant_id = app.tenant_id());

CREATE POLICY solicitud_transicion_core ON solicitud
    FOR UPDATE TO mani_core_svc
    USING (
        tenant_id = app.tenant_id()
        AND app.user_role() IN ('cliente', 'aliado', 'admin_tenant', 'servicio')
    )
    WITH CHECK (tenant_id = app.tenant_id());

-- 4.5 `solicitud_rechazo` (dominio de Dispatch): Patrón T y aliado propio
DO $$
BEGIN
    IF to_regclass('public.solicitud_rechazo') IS NOT NULL THEN
        DROP POLICY IF EXISTS solicitud_rechazo_aliado ON solicitud_rechazo;
        CREATE POLICY solicitud_rechazo_aliado ON solicitud_rechazo
            FOR ALL TO authenticated, mani_dispatch_svc
            USING (
                tenant_id = app.tenant_id()
                AND aliado_id IN (SELECT a.id FROM aliado a WHERE a.usuario_id = app.user_id())
            )
            WITH CHECK (
                tenant_id = app.tenant_id()
                AND aliado_id IN (SELECT a.id FROM aliado a WHERE a.usuario_id = app.user_id())
            );
    END IF;
END $$;

-- 4.6 `documento_legal` y `consentimiento_usuario` (migradas de 0004 a `app.*` con TO explícito)
DO $$
BEGIN
    IF to_regclass('public.documento_legal') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Lectura de documentos legales activos del tenant o globales" ON documento_legal;
        DROP POLICY IF EXISTS documento_legal_lectura ON documento_legal;
        DROP POLICY IF EXISTS documento_legal_alta ON documento_legal;

        CREATE POLICY documento_legal_lectura ON documento_legal
            FOR SELECT TO anon, authenticated, mani_core_svc
            USING (
                is_active = true
                AND (tenant_id IS NULL OR tenant_id = app.tenant_id())
            );

        CREATE POLICY documento_legal_alta ON documento_legal
            FOR INSERT TO mani_core_svc
            WITH CHECK (tenant_id IS NULL OR tenant_id = app.tenant_id());
    END IF;

    IF to_regclass('public.consentimiento_usuario') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Usuario lee sus propios consentimientos del tenant" ON consentimiento_usuario;
        DROP POLICY IF EXISTS consentimiento_usuario_propio ON consentimiento_usuario;
        DROP POLICY IF EXISTS consentimiento_usuario_alta ON consentimiento_usuario;

        CREATE POLICY consentimiento_usuario_propio ON consentimiento_usuario
            FOR SELECT TO authenticated, mani_core_svc
            USING (
                usuario_id = app.user_id()
                AND (tenant_id IS NULL OR tenant_id = app.tenant_id())
            );

        CREATE POLICY consentimiento_usuario_alta ON consentimiento_usuario
            FOR INSERT TO authenticated, mani_core_svc
            WITH CHECK (
                usuario_id = app.user_id()
                AND (tenant_id IS NULL OR tenant_id = app.tenant_id())
            );
    END IF;
END $$;

-- 5. Storage (`storage.objects`): aislamiento por carpeta de tenant -----------
--    Solo se ejecuta cuando el esquema `storage` de Supabase y `storage.foldername`
--    existen en el entorno.
DO $$
BEGIN
    IF to_regclass('storage.objects') IS NOT NULL
       AND to_regprocedure('storage.foldername(text)') IS NOT NULL THEN

        DROP POLICY IF EXISTS kyc_isolation ON storage.objects;
        EXECUTE $pol$
            CREATE POLICY kyc_isolation ON storage.objects
                FOR ALL TO authenticated, mani_core_svc
                USING (
                    bucket_id = 'kyc-documentos'
                    AND (storage.foldername(name))[1] = app.tenant_id()::text
                    AND (
                        (storage.foldername(name))[2] = app.user_id()::text
                        OR app.user_role() = 'admin_tenant'
                    )
                )
                WITH CHECK (
                    bucket_id = 'kyc-documentos'
                    AND (storage.foldername(name))[1] = app.tenant_id()::text
                    AND (
                        (storage.foldername(name))[2] = app.user_id()::text
                        OR app.user_role() = 'admin_tenant'
                    )
                )
        $pol$;

        DROP POLICY IF EXISTS "solicitudes_subir_propias" ON storage.objects;
        DROP POLICY IF EXISTS "solicitudes_actualizar_propias" ON storage.objects;
        DROP POLICY IF EXISTS "solicitudes_borrar_propias" ON storage.objects;
        DROP POLICY IF EXISTS "solicitudes_leer_propias" ON storage.objects;
        DROP POLICY IF EXISTS solicitudes_isolation ON storage.objects;

        EXECUTE $pol$
            CREATE POLICY solicitudes_isolation ON storage.objects
                FOR ALL TO authenticated, mani_core_svc
                USING (
                    bucket_id = 'solicitudes'
                    AND (storage.foldername(name))[1] = app.tenant_id()::text
                    AND (
                        (storage.foldername(name))[2] = app.user_id()::text
                        OR app.user_role() IN ('aliado', 'admin_tenant')
                    )
                )
                WITH CHECK (
                    bucket_id = 'solicitudes'
                    AND (storage.foldername(name))[1] = app.tenant_id()::text
                    AND (storage.foldername(name))[2] = app.user_id()::text
                )
        $pol$;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0007', 'SCRUM-1104 (CFG-23b) politicas RLS por tenant con app.*, FORCE RLS y GRANT por rol de servicio')
ON CONFLICT (version) DO NOTHING;
