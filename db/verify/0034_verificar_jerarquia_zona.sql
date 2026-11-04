-- =====================================================================
-- Verificación de la migración 0034 (SCRUM-1395) — jerarquía geográfica hasta BARRIO
-- =====================================================================
-- Se ejecuta después de aplicar 0034. Las tres primeras consultas confirman que las defensas existen;
-- la cuarta lista las filas heredadas que impiden validar los CHECK, que se agregaron NOT VALID para
-- no hacer caer la migración sobre datos ya sembrados.

\echo '--- 1. CHECK de nivel y de padre del barrio presentes (y si ya están validados) ---'
SELECT conname, convalidated, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'zona'::regclass
  AND conname IN ('zona_nivel_valido', 'zona_barrio_exige_padre')
ORDER BY conname;

\echo '--- 2. Trigger de jerarquía presente y BEFORE INSERT OR UPDATE ---'
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definicion
FROM pg_trigger
WHERE tgrelid = 'zona'::regclass AND NOT tgisinternal AND tgname = 'trg_zona_jerarquia';

\echo '--- 3. La función valida el nivel y la relación con el padre ---'
SELECT proname, prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND p.proname = 'validar_jerarquia_zona';

\echo '--- 4. Filas heredadas que violarían los CHECK: hay que limpiarlas antes de validarlos ---'
-- Vacío = se puede ejecutar, en este orden:
--   ALTER TABLE zona VALIDATE CONSTRAINT zona_nivel_valido;
--   ALTER TABLE zona VALIDATE CONSTRAINT zona_barrio_exige_padre;
SELECT id, nivel, nombre, zona_padre_id, estado,
       CASE
         WHEN nivel NOT IN ('CIUDAD', 'LOCALIDAD', 'BARRIO') THEN 'NIVEL_FUERA_DEL_CATALOGO'
         WHEN nivel = 'BARRIO' AND zona_padre_id IS NULL THEN 'BARRIO_SIN_PADRE'
       END AS motivo
FROM zona
WHERE nivel NOT IN ('CIUDAD', 'LOCALIDAD', 'BARRIO')
   OR (nivel = 'BARRIO' AND zona_padre_id IS NULL)
ORDER BY nivel, nombre;

\echo '--- 5. Jerarquía actual, para ver que los barrios cuelgan de una localidad ---'
SELECT hijo.nivel, hijo.nombre, padre.nivel AS nivel_padre, padre.nombre AS nombre_padre, hijo.estado
FROM zona hijo LEFT JOIN zona padre ON padre.id = hijo.zona_padre_id
ORDER BY hijo.nivel, hijo.nombre;
