-- =====================================================================
-- Verificación de SCRUM-1468 / TEC-21 en un ambiente (QA, PROD).
--
-- Se corre con el usuario dueño del esquema DESPUÉS de aplicar la 0037, dar
-- credenciales con db/ops/credenciales_roles_servicio.sql y reiniciar Core y
-- Dispatch con sus nuevas cadenas de conexión:
--
--   psql "$URL_ADMIN" -v ON_ERROR_STOP=1 -f db/verify/0037_verificar_sin_bypassrls.sql
--
-- Cada bloque imprime lo que encontró y termina con ERROR si el ambiente no
-- cumple, así el resultado se lee sin interpretar tablas.
-- =====================================================================

\echo '1. Roles de servicio: LOGIN, sin SUPERUSER ni BYPASSRLS'
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
  FROM pg_roles
 WHERE rolname IN ('mani_core_svc', 'mani_dispatch_svc')
 ORDER BY rolname;

DO $$
BEGIN
    IF (SELECT count(*) FROM pg_roles
         WHERE rolname IN ('mani_core_svc', 'mani_dispatch_svc')
           AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) <> 2 THEN
        RAISE EXCEPTION 'TEC-21: mani_core_svc y mani_dispatch_svc deben tener LOGIN y no tener SUPERUSER ni BYPASSRLS';
    END IF;
END $$;

\echo '2. Políticas TO public en tablas con tenant_id (R-06): debe quedar vacío'
SELECT p.tablename, p.policyname, p.roles
  FROM pg_policies p
  JOIN information_schema.columns c
    ON c.table_schema = p.schemaname AND c.table_name = p.tablename AND c.column_name = 'tenant_id'
 WHERE p.schemaname = 'public' AND 'public' = ANY (p.roles)
 ORDER BY 1, 2;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_policies p
          JOIN information_schema.columns c
            ON c.table_schema = p.schemaname AND c.table_name = p.tablename AND c.column_name = 'tenant_id'
         WHERE p.schemaname = 'public' AND 'public' = ANY (p.roles)
    ) THEN
        RAISE EXCEPTION 'TEC-21 (R-06): siguen políticas TO public sobre datos de tenant';
    END IF;
END $$;

\echo '3. Conexiones abiertas por usuario: Core y Dispatch deben aparecer con su rol, no como postgres'
SELECT usename, application_name, client_addr, count(*) AS conexiones
  FROM pg_stat_activity
 WHERE datname = current_database() AND usename IS NOT NULL
 GROUP BY 1, 2, 3
 ORDER BY 1, 2;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'mani_core_svc') THEN
        RAISE WARNING 'TEC-21: no hay conexiones de mani_core_svc; revisar DATABASE_URL de Core (o que el servicio esté arriba)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'mani_dispatch_svc') THEN
        RAISE WARNING 'TEC-21: no hay conexiones de mani_dispatch_svc; revisar la cadena de conexión de Dispatch';
    END IF;
END $$;

\echo 'TEC-21: roles y políticas conformes'
