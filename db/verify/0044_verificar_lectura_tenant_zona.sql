-- =====================================================================
-- Verificación de la migración 0044 (SCRUM-1720) — `anon` no lee `tenant` ni `zona`
-- =====================================================================
-- Se ejecuta después de aplicar la 0044, conectado como `postgres`. Todo lo que escribe termina en ROLLBACK.

\echo '--- 1. Políticas de lectura de tenant y zona: ninguna debe incluir public ni anon ---'
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('tenant', 'zona')
ORDER BY tablename, policyname;

\echo '--- 2. Las dos políticas creadas a mano ya no existen (esperado: 0 filas) ---'
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public' AND policyname IN ('lectura_global_tenant', 'lectura_global_zona');

\echo '--- 3. anon sin SELECT sobre tenant y zona (esperado: has_table_privilege = f en las dos) ---'
SELECT 'tenant' AS tabla, has_table_privilege('anon', 'tenant', 'SELECT') AS anon_lee
UNION ALL
SELECT 'zona', has_table_privilege('anon', 'zona', 'SELECT');

\echo '--- 4. Con la llave anon no se listan (esperado: permission denied) y Core sí lee ---'
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
    PERFORM 1 FROM tenant LIMIT 1;
    RAISE EXCEPTION 'FALLA: anon pudo leer tenant';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK: anon recibe permission denied al leer tenant';
END $$;
DO $$
BEGIN
    PERFORM 1 FROM zona LIMIT 1;
    RAISE EXCEPTION 'FALLA: anon pudo leer zona';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK: anon recibe permission denied al leer zona';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE mani_core_svc;
SELECT 'mani_core_svc lee tenant' AS prueba, count(*) AS filas FROM tenant;
SELECT 'mani_core_svc lee zona' AS prueba, count(*) AS filas FROM zona;
ROLLBACK;
