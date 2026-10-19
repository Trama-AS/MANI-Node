-- =====================================================================
-- Verificación de la migración 0005 (SCRUM-1334 / ADR-0032 §8).
-- Solo lectura sobre el catálogo y datos propios dentro de una transacción
-- que termina en ROLLBACK. Ejecutar con un rol con privilegios para SET ROLE
-- (en Supabase: el SQL Editor / postgres). Cada comprobación es un ASSERT:
-- si algo no está cerrado, psql aborta con el motivo.
--
--   psql -v ON_ERROR_STOP=1 -f db/verify/0005_verificar_exposiciones.sql
--
-- Sirve también como evidencia reutilizable para CFG-23c.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

BEGIN;

-- 1. Estado del catálogo -------------------------------------------------
DO $$
DECLARE
    t TEXT;
    fn RECORD;
    n INT;
BEGIN
    FOREACH t IN ARRAY ARRAY['documento_kyc', 'cliente', 'sitio', 'tarifa_referencia', 'cobertura_aliado',
                             'solicitud', 'cotizacion', 'mensaje', 'evento_servicio', 'calificacion',
                             'notificacion', 'zona'] LOOP
        ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)),
            format('%s sigue sin RLS', t);
    END LOOP;

    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'documento_kyc' AND (qual = 'true' OR with_check = 'true');
    ASSERT n = 0, 'documento_kyc conserva una política USING (true) / WITH CHECK (true)';

    FOR fn IN
        SELECT p.oid, p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.proname IN ('registrar_aliado_persona_natural', 'registrar_aliado_empresa')
    LOOP
        ASSERT NOT has_function_privilege('anon', fn.oid, 'EXECUTE'), format('anon aún ejecuta %s', fn.sig);
        ASSERT NOT has_function_privilege('authenticated', fn.oid, 'EXECUTE'), format('authenticated aún ejecuta %s', fn.sig);
    END LOOP;
END $$;

-- 2. Comportamiento con la clave anónima ---------------------------------
INSERT INTO tenant (id, nombre, slug, estado) VALUES
  ('10000000-0000-4000-8000-0000000000a1', 'Verif T1', 'verif-t1', 'ACTIVO'),
  ('10000000-0000-4000-8000-0000000000a2', 'Verif T2', 'verif-t2', 'ACTIVO');
INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'admin@verif.test', 'ADMIN_TENANT', 'ACTIVO'),
  ('30000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', 'aliado@verif.test', 'ALIADO', 'ACTIVO');
INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES
  ('50000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-0000000000a2', 'PERSONA_NATURAL', 'Aliado T2', 'VERIFICADO');
INSERT INTO documento_kyc (id, tenant_id, aliado_id, tipo_documento, ruta_storage, estado) VALUES
  ('90000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-8000-0000000000a2', 'CEDULA', 't2/aliado/cedula.pdf', 'PENDIENTE');
INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal) VALUES
  ('10000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-0000000000a2', 'PRUEBA', 'PUSH');

SET LOCAL ROLE anon;
DO $$
DECLARE
    n INT;
BEGIN
    -- 2a. Lectura de KYC de otro tenant: 0 filas (o permiso denegado).
    BEGIN
        SELECT count(*) INTO n FROM documento_kyc;
        ASSERT n = 0, format('anon lee %s documento_kyc', n);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- 2b. Inserción de KYC a nombre de cualquier aliado.
    BEGIN
        INSERT INTO documento_kyc (tenant_id, aliado_id, tipo_documento, ruta_storage, estado)
        VALUES ('10000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-8000-0000000000a2', 'X', 'evil.pdf', 'PENDIENTE');
        RAISE EXCEPTION 'FALLO: anon insertó en documento_kyc';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- 2c. Lectura y escritura en una tabla que no tenía RLS.
    BEGIN
        SELECT count(*) INTO n FROM notificacion;
        ASSERT n = 0, format('anon lee %s notificaciones', n);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal)
        VALUES ('10000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-0000000000a2', 'EVIL', 'PUSH');
        RAISE EXCEPTION 'FALLO: anon insertó en notificacion';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- 2d. Reescritura del rol de un usuario existente por la función de registro.
    BEGIN
        PERFORM registrar_aliado_persona_natural(
            '30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
            'admin@verif.test', 'Nombre', NULL, '[]'::jsonb);
        RAISE EXCEPTION 'FALLO: anon ejecutó registrar_aliado_persona_natural';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
RESET ROLE;

DO $$
BEGIN
    ASSERT (SELECT rol FROM usuario WHERE id = '30000000-0000-4000-8000-0000000000a1') = 'ADMIN_TENANT',
        'el rol del administrador fue reescrito';
    ASSERT (SELECT count(*) FROM documento_kyc WHERE ruta_storage = 'evil.pdf') = 0, 'quedó un KYC insertado por anon';
END $$;

-- 3. Los servicios no se ven afectados: service_role sigue leyendo y escribiendo.
SET LOCAL ROLE service_role;
DO $$
BEGIN
    ASSERT (SELECT count(*) FROM documento_kyc) >= 1, 'service_role dejó de leer documento_kyc';
    INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal)
    VALUES ('10000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-0000000000a2', 'SERVICIO', 'PUSH');
END $$;
RESET ROLE;

ROLLBACK;
\echo 'OK 0005: exposiciones cerradas y servicios sin cambios'
