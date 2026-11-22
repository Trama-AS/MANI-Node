-- =====================================================================
-- Verificación de la migración 0043 (SCRUM-1713, QAS-10) — CHECK de estado en solicitud y cotizacion
-- =====================================================================
-- Se ejecuta después de aplicar la 0043, con el rol de servicio de Core (mani_core_svc) para que la prueba 3 sea la
-- que vive QA. Todo lo que escribe termina en ROLLBACK.

\echo '--- 0. Inventario de estados (antes de la migración y para adjuntar al ticket) ---'
SELECT 'solicitud' AS tabla, estado, count(*) FROM solicitud GROUP BY estado
UNION ALL
SELECT 'cotizacion', estado, count(*) FROM cotizacion GROUP BY estado
ORDER BY 1, 2;

\echo '--- 1. Los dos CHECK existen (convalidated = t si ya cubren las filas viejas) ---'
SELECT conrelid::regclass AS tabla, conname, convalidated, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conname IN ('ck_solicitud_estado', 'ck_cotizacion_estado')
ORDER BY conname;

\echo '--- 2. Filas fuera del catálogo: vacío = se puede validar; si hay filas, corregirlas y correr el VALIDATE ---'
-- ALTER TABLE solicitud  VALIDATE CONSTRAINT ck_solicitud_estado;
-- ALTER TABLE cotizacion VALIDATE CONSTRAINT ck_cotizacion_estado;
SELECT 'solicitud' AS tabla, id, estado FROM solicitud
WHERE estado NOT IN ('PENDIENTE', 'ASIGNADA', 'COTIZANDO', 'ACEPTADA', 'RECHAZADA',
                     'EN_EJECUCION', 'FINALIZADA', 'CERRADA', 'CANCELADA')
UNION ALL
SELECT 'cotizacion', id, estado FROM cotizacion
WHERE estado NOT IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'AJUSTE_SOLICITADO');

\echo '--- 3. Un estado inventado se rechaza con 23514 (esperado: dos avisos «OK ... rechazado (23514)»; si sale «FALLA», la base aceptó el estado) ---'
-- Cada bloque captura el error y lo reporta; no hace falta una solicitud de prueba: se usa una existente.
DO $$
DECLARE
    sid UUID;
    cid UUID;
BEGIN
    SELECT id INTO sid FROM solicitud LIMIT 1;
    SELECT id INTO cid FROM cotizacion LIMIT 1;
    IF sid IS NULL OR cid IS NULL THEN
        RAISE NOTICE 'Sin solicitudes o cotizaciones en esta base: la prueba 3 no tiene fila sobre la que actuar';
        RETURN;
    END IF;
    BEGIN
        UPDATE solicitud SET estado = 'INVENTADO_1713' WHERE id = sid;
        RAISE EXCEPTION 'FALLA: solicitud aceptó un estado inventado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK solicitud: estado inventado rechazado (23514)';
    END;
    BEGIN
        UPDATE cotizacion SET estado = 'INVENTADO_1713' WHERE id = cid;
        RAISE EXCEPTION 'FALLA: cotizacion aceptó un estado inventado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK cotizacion: estado inventado rechazado (23514)';
    END;
END $$;
