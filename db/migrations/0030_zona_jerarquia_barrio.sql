-- =====================================================================
-- Migración 0030 (Core Node) — Integridad de la jerarquía geográfica hasta BARRIO (SCRUM-1395)
-- =====================================================================
-- HU-M04-06 incorpora el barrio como nivel más fino del catálogo geográfico. Su alcance es el catálogo:
-- no cambia por dónde declara cobertura el aliado (eso sigue en SCRUM-1385) ni toca el despacho.
--
-- `zona` venía sin ninguna defensa: `nivel` es TEXT libre y `zona_padre_id` admitía NULL en cualquier nivel.
-- El C2 exige rechazar «barrio sin zona padre, asociación inválida, ID desconocido o elemento inactivo
-- sin persistencia parcial ni datos inventados», y hoy la base aceptaba las tres primeras. Core ya las
-- detecta al armar el árbol (`zoneHierarchy.js` las reporta en `inconsistencies`), pero detectar no es
-- impedir: sin esto, la fila mala entra y cada lectura tiene que esquivarla.
--
-- Lo que se añade:
--   1. CHECK de nivel contra los tres previstos (CIUDAD, LOCALIDAD, BARRIO), el mismo orden que `Zone.LEVELS`.
--   2. CHECK de padre: un BARRIO siempre cuelga de algo. Es lo que pide el C2 —«barrio sin zona padre
--      se rechaza»— y se deja ahí a propósito: una LOCALIDAD huérfana también es inconsistente, pero
--      exigirlo en la base rompería fixtures de otras historias donde la zona es un dato incidental, y
--      esa clase de fila ya se detecta al leer, que la reporta como ZONA_SIN_PADRE y la deja fuera del
--      árbol. La base impide lo que el criterio exige impedir; el resto se reporta.
--   3. Trigger que valida que el padre sea el nivel inmediatamente superior — el padre de un BARRIO es una
--      LOCALIDAD y el de una LOCALIDAD es una CIUDAD. Un CHECK no sirve: necesita mirar otra fila.
--      El trigger también rechaza que una zona sea su propio padre.
--
-- `zona` NO tiene tenant_id: es catálogo global (decisión de SCRUM-1393), así que el trigger no acota por
-- tenant y no hay RLS que ajustar. El aislamiento de C3 lo da la autenticación en el borde, no la fila.
--
-- Los dos CHECK se agregan NOT VALID a propósito: si en QA o en un entorno ya sembrado hay filas que los
-- violan, la migración no debe caerse ni borrar datos de nadie. Quedan activos para todo INSERT/UPDATE
-- nuevo, que es lo que pide el criterio. Validarlos sobre lo viejo es un paso aparte, después de limpiar:
--     ALTER TABLE zona VALIDATE CONSTRAINT zona_nivel_valido;
--     ALTER TABLE zona VALIDATE CONSTRAINT zona_barrio_exige_padre;
-- La consulta que lista las filas a limpiar está en db/verify/0030_verificar_jerarquia_zona.sql.
--
-- Aditiva e idempotente.

-- 1. Nivel dentro del catálogo previsto.
ALTER TABLE zona DROP CONSTRAINT IF EXISTS zona_nivel_valido;
ALTER TABLE zona ADD CONSTRAINT zona_nivel_valido
    CHECK (nivel IN ('CIUDAD', 'LOCALIDAD', 'BARRIO')) NOT VALID;

-- 2. Un barrio no puede quedar suelto.
ALTER TABLE zona DROP CONSTRAINT IF EXISTS zona_padre_obligatorio_salvo_ciudad;
ALTER TABLE zona DROP CONSTRAINT IF EXISTS zona_barrio_exige_padre;
ALTER TABLE zona ADD CONSTRAINT zona_barrio_exige_padre
    CHECK (nivel <> 'BARRIO' OR zona_padre_id IS NOT NULL) NOT VALID;

-- 3. El padre es el nivel inmediatamente superior.
CREATE OR REPLACE FUNCTION app.validar_jerarquia_zona()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    nivel_padre TEXT;
    nivel_esperado TEXT;
BEGIN
    -- El nivel se valida aquí y no solo en el CHECK porque un trigger BEFORE corre antes que los CHECK:
    -- sin esto, un nivel inventado moría con el mensaje de la comparación de padres, que no dice qué pasó.
    IF NEW.nivel NOT IN ('CIUDAD', 'LOCALIDAD', 'BARRIO') THEN
        RAISE EXCEPTION 'MANI-ZON-422N: nivel % no pertenece al catálogo (CIUDAD, LOCALIDAD, BARRIO)', NEW.nivel;
    END IF;

    IF NEW.zona_padre_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.zona_padre_id = NEW.id THEN
        RAISE EXCEPTION 'MANI-ZON-422J: una zona no puede ser su propia zona padre';
    END IF;

    SELECT nivel INTO nivel_padre FROM zona WHERE id = NEW.zona_padre_id;
    IF nivel_padre IS NULL THEN
        -- El FK ya lo impediría; se cubre igual para que el mensaje sea del contrato y no del motor (T9).
        RAISE EXCEPTION 'MANI-ZON-422J: la zona padre % no existe', NEW.zona_padre_id;
    END IF;

    nivel_esperado := CASE NEW.nivel
        WHEN 'BARRIO' THEN 'LOCALIDAD'
        WHEN 'LOCALIDAD' THEN 'CIUDAD'
        WHEN 'CIUDAD' THEN NULL
    END;

    IF NEW.nivel = 'CIUDAD' THEN
        RAISE EXCEPTION 'MANI-ZON-422J: una CIUDAD es raíz de la jerarquía y no puede tener zona padre';
    END IF;

    IF nivel_padre <> nivel_esperado THEN
        RAISE EXCEPTION 'MANI-ZON-422J: el padre de un % debe ser un %, y es un %',
            NEW.nivel, nivel_esperado, nivel_padre;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zona_jerarquia ON zona;
CREATE TRIGGER trg_zona_jerarquia
    BEFORE INSERT OR UPDATE ON zona
    FOR EACH ROW EXECUTE FUNCTION app.validar_jerarquia_zona();

INSERT INTO schema_migrations (version, description)
VALUES ('0030', 'SCRUM-1395 jerarquía de zona hasta BARRIO: nivel válido, barrio con zona padre y padre del nivel inmediatamente superior')
ON CONFLICT (version) DO NOTHING;
