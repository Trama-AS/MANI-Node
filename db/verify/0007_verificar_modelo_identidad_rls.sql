-- =====================================================================
-- Verificación ejecutable de las migraciones 0006 y 0007
-- (SCRUM-1104 / CFG-23b — ADR-0032 y `02-diseno-modelo-identidad.md` §§3–7).
--
-- Uso:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify/0007_verificar_modelo_identidad_rls.sql
--
-- Comprueba en una única transacción revertida al final (`ROLLBACK`):
--   1. Invariantes de catálogo: roles `mani_core_svc` y `mani_dispatch_svc`
--      sin `BYPASSRLS` ni `SUPERUSER`, funciones `app.*`, `ENABLE + FORCE RLS`
--      en todas las tablas con `tenant_id`, y ninguna política `TO public`.
--   2. Los seis casos cross-tenant (C1–C6) con `mani_core_svc` como llamador.
--   3. Las propiedades del mecanismo (P1, P3, P4a, P4b, P5, P6) con
--      `mani_core_svc`, `mani_dispatch_svc` y `authenticated`.
-- =====================================================================
\set ON_ERROR_STOP 1

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Verificación de catálogo (roles, funciones, FORCE RLS y políticas)
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_sin_rls TEXT[];
    v_sin_force TEXT[];
    v_to_public TEXT[];
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'mani_core_svc' AND NOT rolbypassrls AND NOT rolsuper
    ), 'FALLO 0006: mani_core_svc no existe o tiene BYPASSRLS/SUPERUSER';

    ASSERT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'mani_dispatch_svc' AND NOT rolbypassrls AND NOT rolsuper
    ), 'FALLO 0006: mani_dispatch_svc no existe o tiene BYPASSRLS/SUPERUSER';

    ASSERT to_regprocedure('app.tenant_id()') IS NOT NULL
       AND to_regprocedure('app.user_id()') IS NOT NULL
       AND to_regprocedure('app.user_role()') IS NOT NULL
       AND to_regprocedure('app.set_context(uuid,uuid,text)') IS NOT NULL,
        'FALLO 0006: faltan funciones en el esquema app';

    SELECT array_agg(c.relname ORDER BY c.relname) INTO v_sin_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> 'schema_migrations'
      AND NOT c.relrowsecurity;

    IF v_sin_rls IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 0007: tablas sin ENABLE RLS: %', v_sin_rls;
    END IF;

    SELECT array_agg(c.relname ORDER BY c.relname) INTO v_sin_force
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = 'public'
     AND col.table_name = c.relname
     AND col.column_name = 'tenant_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relforcerowsecurity;

    IF v_sin_force IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 0007: tablas con tenant_id sin FORCE RLS: %', v_sin_force;
    END IF;

    SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      INTO v_to_public
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles = '{public}';

    IF v_to_public IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO 0007: políticas con TO public implícito: %', v_to_public;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Datos de prueba aislados para C1–C6 y P1–P6 (se revierten al final)
-- ---------------------------------------------------------------------
INSERT INTO tenant (id, nombre, slug, estado) VALUES
    ('10000000-0000-4000-8000-000000000911', 'Tenant Verificacion Uno', 'verify-t1', 'ACTIVO'),
    ('10000000-0000-4000-8000-000000000921', 'Tenant Verificacion Dos', 'verify-t2', 'ACTIVO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO zona (id, nivel, nombre, estado) VALUES
    ('20000000-0000-4000-8000-000000000911', 'CIUDAD', 'Bogota Verify', 'ACTIVO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categoria_servicio (id, tenant_id, nombre, estado, flujo_operativo) VALUES
    ('40000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', 'Plomeria T1', 'ACTIVO', 'DIRECTO'),
    ('40000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', 'Plomeria T2', 'ACTIVO', 'DIRECTO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES
    ('30000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', 'admin.t1@verify.local', 'ADMIN_TENANT', 'ACTIVO'),
    ('30000000-0000-4000-8000-000000000912', '10000000-0000-4000-8000-000000000911', 'aliado.a.t1@verify.local', 'ALIADO', 'ACTIVO'),
    ('30000000-0000-4000-8000-000000000913', '10000000-0000-4000-8000-000000000911', 'aliado.b.t1@verify.local', 'ALIADO', 'ACTIVO'),
    ('30000000-0000-4000-8000-000000000914', '10000000-0000-4000-8000-000000000911', 'cliente.t1@verify.local', 'CLIENTE', 'ACTIVO'),
    ('30000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', 'aliado.t2@verify.local', 'ALIADO', 'ACTIVO'),
    ('30000000-0000-4000-8000-000000000922', '10000000-0000-4000-8000-000000000921', 'cliente.t2@verify.local', 'CLIENTE', 'ACTIVO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES
    ('50000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000912', 'PERSONA_NATURAL', 'Aliado A T1', 'VERIFICADO'),
    ('50000000-0000-4000-8000-000000000912', '10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000913', 'PERSONA_NATURAL', 'Aliado B T1', 'VERIFICADO'),
    ('50000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', '30000000-0000-4000-8000-000000000921', 'PERSONA_NATURAL', 'Aliado T2', 'VERIFICADO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES
    ('60000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000914', 'PERSONA_NATURAL'),
    ('60000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', '30000000-0000-4000-8000-000000000922', 'PERSONA_NATURAL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES
    ('65000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', '60000000-0000-4000-8000-000000000911', '20000000-0000-4000-8000-000000000911', 'Calle 10 # 1-10'),
    ('65000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', '60000000-0000-4000-8000-000000000921', '20000000-0000-4000-8000-000000000911', 'Calle 20 # 2-20')
ON CONFLICT (id) DO NOTHING;

INSERT INTO documento_kyc (id, tenant_id, aliado_id, tipo_documento, ruta_storage, estado) VALUES
    ('90000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', '50000000-0000-4000-8000-000000000911', 'CEDULA_CIUDADANIA', '10000000-0000-4000-8000-000000000911/30000000-0000-4000-8000-000000000912/cedula.pdf', 'PENDIENTE'),
    ('90000000-0000-4000-8000-000000000912', '10000000-0000-4000-8000-000000000911', '50000000-0000-4000-8000-000000000912', 'CEDULA_CIUDADANIA', '10000000-0000-4000-8000-000000000911/30000000-0000-4000-8000-000000000913/cedula.pdf', 'PENDIENTE'),
    ('90000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', '50000000-0000-4000-8000-000000000921', 'CEDULA_CIUDADANIA', '10000000-0000-4000-8000-000000000921/30000000-0000-4000-8000-000000000921/cedula.pdf', 'PENDIENTE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado, aliado_id) VALUES
    ('70000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', '60000000-0000-4000-8000-000000000911', '65000000-0000-4000-8000-000000000911', '40000000-0000-4000-8000-000000000911', '20000000-0000-4000-8000-000000000911', 'PENDIENTE', NULL),
    ('70000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', '60000000-0000-4000-8000-000000000921', '65000000-0000-4000-8000-000000000921', '40000000-0000-4000-8000-000000000921', '20000000-0000-4000-8000-000000000911', 'PENDIENTE', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notificacion (id, tenant_id, usuario_id, tipo, canal, payload) VALUES
    ('80000000-0000-4000-8000-000000000911', '10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000914', 'INFO', 'IN_APP', '{"msg":"hola t1"}'::jsonb),
    ('80000000-0000-4000-8000-000000000921', '10000000-0000-4000-8000-000000000921', '30000000-0000-4000-8000-000000000922', 'INFO', 'IN_APP', '{"msg":"hola t2"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Casos cross-tenant C1–C6 y propiedades P1–P6
-- ---------------------------------------------------------------------

-- C1 + C2: Lectura por id de otro tenant y listado sin WHERE tenant_id
SAVEPOINT sp_c1_c2;
SET LOCAL ROLE mani_core_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000911', 'admin_tenant');
DO $$ BEGIN
    ASSERT NOT EXISTS (SELECT 1 FROM aliado WHERE id = '50000000-0000-4000-8000-000000000921'), 'FALLO C1: leyó aliado de T2';
    ASSERT NOT EXISTS (SELECT 1 FROM notificacion WHERE id = '80000000-0000-4000-8000-000000000921'), 'FALLO C1: leyó notificación de T2';
    ASSERT NOT EXISTS (SELECT 1 FROM categoria_servicio WHERE id = '40000000-0000-4000-8000-000000000921'), 'FALLO C1: leyó categoría de T2';
    ASSERT (SELECT bool_and(tenant_id = '10000000-0000-4000-8000-000000000911') FROM aliado), 'FALLO C2: listado de aliado incluyó otro tenant';
    ASSERT (SELECT bool_and(tenant_id = '10000000-0000-4000-8000-000000000911') FROM categoria_servicio), 'FALLO C2: listado de categoria_servicio incluyó otro tenant';
    ASSERT (SELECT count(*) FROM aliado) = 2, 'FALLO C2: conteo de aliados de T1 inesperado';
END $$;
ROLLBACK TO SAVEPOINT sp_c1_c2;

-- C3: Escritura en otro tenant (INSERT en T2 y UPDATE mudando fila a T2)
SAVEPOINT sp_c3;
SET LOCAL ROLE mani_core_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000911', 'admin_tenant');
DO $$ BEGIN
    BEGIN
        INSERT INTO notificacion (id, tenant_id, usuario_id, tipo, canal)
        VALUES (gen_random_uuid(), '10000000-0000-4000-8000-000000000921', '30000000-0000-4000-8000-000000000922', 'INJECT', 'IN_APP');
        RAISE EXCEPTION 'FALLO C3: insertó en T2';
    EXCEPTION WHEN insufficient_privilege THEN
        ASSERT SQLERRM LIKE '%row-level security%', SQLERRM;
    END;

    BEGIN
        UPDATE notificacion
           SET tenant_id = '10000000-0000-4000-8000-000000000921'
         WHERE id = '80000000-0000-4000-8000-000000000911';
        RAISE EXCEPTION 'FALLO C3: movió fila propia a T2';
    EXCEPTION WHEN insufficient_privilege THEN
        ASSERT SQLERRM LIKE '%row-level security%', SQLERRM;
    END;

    UPDATE notificacion SET tipo = 'PISADA' WHERE id = '80000000-0000-4000-8000-000000000921';
    ASSERT NOT FOUND, 'FALLO C3: actualizó fila de T2';
END $$;
ROLLBACK TO SAVEPOINT sp_c3;

-- C4: Borrado ajeno (DELETE por id de T2 afecta 0 filas; DELETE sin WHERE solo alcanza T1)
SAVEPOINT sp_c4;
SET LOCAL ROLE mani_core_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000911', 'admin_tenant');
DO $$ BEGIN
    DELETE FROM notificacion WHERE id = '80000000-0000-4000-8000-000000000921';
    ASSERT NOT FOUND, 'FALLO C4: borró notificación de T2';
    DELETE FROM notificacion;
END $$;
RESET ROLE;
DO $$ BEGIN
    ASSERT EXISTS (SELECT 1 FROM notificacion WHERE id = '80000000-0000-4000-8000-000000000921'),
        'FALLO C4: DELETE sin WHERE eliminó fila de T2';
END $$;
ROLLBACK TO SAVEPOINT sp_c4;

-- C5 + P1: Sin contexto (o tras revertir contexto previo) y claim corrupto -> falla cerrada
SAVEPOINT sp_c5;
SET LOCAL ROLE mani_core_svc;
DO $$ BEGIN
    ASSERT app.tenant_id() IS NULL, 'FALLO P1/C5: sin set_context no debía haber tenant';
    ASSERT (SELECT count(*) FROM aliado) = 0 AND (SELECT count(*) FROM documento_kyc) = 0,
        'FALLO C5a: leyó filas sin contexto';

    BEGIN
        PERFORM app.set_context(NULL, NULL, 'aliado');
        RAISE EXCEPTION 'FALLO C5c: aceptó contexto sin tenant';
    EXCEPTION WHEN invalid_parameter_value THEN
        ASSERT SQLERRM LIKE '%MANI-RLS-400%', SQLERRM;
    END;
END $$;
SELECT set_config('request.jwt.claims', '{"app_metadata":{"tenant_id":"no-es-un-uuid"}}', true);
DO $$ BEGIN
    ASSERT app.tenant_id() IS NULL AND (SELECT count(*) FROM aliado) = 0,
        'FALLO C5b: claim corrupto no anuló el tenant';
END $$;
ROLLBACK TO SAVEPOINT sp_c5;

-- C6: Documentos KYC de otro aliado (mismo tenant) y de otro tenant
SAVEPOINT sp_c6_aliado;
SET LOCAL ROLE mani_core_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000912', 'aliado');
DO $$ BEGIN
    ASSERT (SELECT array_agg(id) FROM documento_kyc) = ARRAY['90000000-0000-4000-8000-000000000911'::uuid],
        'FALLO C6a: aliado A debía ver solo su propio documento KYC';

    BEGIN
        INSERT INTO documento_kyc (id, tenant_id, aliado_id, tipo_documento, ruta_storage, estado)
        VALUES (gen_random_uuid(), '10000000-0000-4000-8000-000000000911', '50000000-0000-4000-8000-000000000912', 'CEDULA_CIUDADANIA', 'suplantado.pdf', 'PENDIENTE');
        RAISE EXCEPTION 'FALLO C6a: cargó KYC a nombre de otro aliado';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
ROLLBACK TO SAVEPOINT sp_c6_aliado;

SAVEPOINT sp_c6_admin;
SET LOCAL ROLE mani_core_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000911', 'ADMIN_TENANT');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM documento_kyc) = 2,
        'FALLO C6b: admin_tenant de T1 debía ver los 2 KYC de T1';
    ASSERT NOT EXISTS (SELECT 1 FROM documento_kyc WHERE tenant_id = '10000000-0000-4000-8000-000000000921'),
        'FALLO C6b: admin_tenant de T1 vio KYC de T2';
END $$;
ROLLBACK TO SAVEPOINT sp_c6_admin;

-- P3: Frontera de datos por dominio (ADR-0030) impuesta por el motor a Dispatch
SAVEPOINT sp_p3;
SET LOCAL ROLE mani_dispatch_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000912', 'aliado');
DO $$ BEGIN
    BEGIN
        PERFORM 1 FROM aliado;
        RAISE EXCEPTION 'FALLO P3: mani_dispatch_svc leyó tabla aliado';
    EXCEPTION WHEN insufficient_privilege THEN
        ASSERT SQLERRM LIKE 'permission denied%', SQLERRM;
    END;

    BEGIN
        PERFORM 1 FROM notificacion;
        RAISE EXCEPTION 'FALLO P3: mani_dispatch_svc leyó tabla notificacion';
    EXCEPTION WHEN insufficient_privilege THEN
        ASSERT SQLERRM LIKE 'permission denied%', SQLERRM;
    END;
END $$;
ROLLBACK TO SAVEPOINT sp_p3;

-- P4: Aceptación de solicitud en Dispatch exige rol aliado y mismo tenant (H-02 / KI-13)
SAVEPOINT sp_p4_cliente;
SET LOCAL ROLE mani_dispatch_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000914', 'cliente');
DO $$ BEGIN
    UPDATE solicitud SET estado = 'ASIGNADA' WHERE id = '70000000-0000-4000-8000-000000000911';
    ASSERT NOT FOUND, 'FALLO P4a: un cliente aceptó una solicitud desde Dispatch';
END $$;
ROLLBACK TO SAVEPOINT sp_p4_cliente;

SAVEPOINT sp_p4_aliado;
SET LOCAL ROLE mani_dispatch_svc;
SELECT app.set_context('10000000-0000-4000-8000-000000000911', '30000000-0000-4000-8000-000000000912', 'aliado');
DO $$ BEGIN
    UPDATE solicitud
       SET estado = 'ASIGNADA', aliado_id = '50000000-0000-4000-8000-000000000911'
     WHERE id = '70000000-0000-4000-8000-000000000921' AND estado = 'PENDIENTE';
    ASSERT NOT FOUND, 'FALLO P4b: aliado de T1 aceptó solicitud de T2';

    UPDATE solicitud
       SET estado = 'ASIGNADA', aliado_id = '50000000-0000-4000-8000-000000000911'
     WHERE id = '70000000-0000-4000-8000-000000000911' AND estado = 'PENDIENTE';
    ASSERT FOUND, 'FALLO P4b: aliado de T1 debía poder aceptar solicitud PENDIENTE de T1';
END $$;
ROLLBACK TO SAVEPOINT sp_p4_aliado;

-- P5 + P6: `authenticated` no puede invocar `app.set_context`, pero evalúa las mismas políticas vía PostgREST
SAVEPOINT sp_p5_p6;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    BEGIN
        PERFORM app.set_context('10000000-0000-4000-8000-000000000921', NULL, 'admin_tenant');
        RAISE EXCEPTION 'FALLO P5: authenticated ejecutó app.set_context';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000921","role":"authenticated","app_metadata":{"tenant_id":"10000000-0000-4000-8000-000000000921","user_role":"aliado"}}',
    true
);
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM aliado WHERE id = '50000000-0000-4000-8000-000000000921') = 1,
        'FALLO P6: authenticated de T2 no vio su aliado';
    ASSERT NOT EXISTS (SELECT 1 FROM aliado WHERE tenant_id = '10000000-0000-4000-8000-000000000911'),
        'FALLO P6: authenticated de T2 vio datos de T1';
END $$;
ROLLBACK TO SAVEPOINT sp_p5_p6;

DO $$ BEGIN
    RAISE NOTICE 'OK 0007: modelo de identidad, politicas RLS y 6 casos cross-tenant verificados';
END $$;

ROLLBACK;
