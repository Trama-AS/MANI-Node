-- =====================================================================
-- Migración 0024 (Core Node) — Cobertura del aliado: una fila por zona y misma pertenencia de tenant (SCRUM-1380)
-- =====================================================================
-- La declaración de cobertura (PUT /profiles/me/coverage) reemplaza el conjunto de zonas del aliado en una
-- transacción con `INSERT ... ON CONFLICT (aliado_id, zona_id) DO NOTHING`; eso exige un índice único que el
-- esquema base (MANI-APIGateway 001) no creó. Se agrega aquí, igual que la 004 del Gateway hizo con
-- `aliado_categoria`.
--   * Antes del índice se eliminan los duplicados previos y se conserva la fila más antigua por par.
--   * El disparador exige que el aliado de la fila sea del mismo tenant que la fila (defensa en profundidad bajo la
--     política RLS `cobertura_aliado_tenant` de la 0007; `zona` es un catálogo global y no lleva tenant).
--   * `cobertura_aliado` ya tiene tenant_id, RLS FORCE y GRANT SELECT/INSERT/UPDATE/DELETE para mani_core_svc (0007).
-- Aditiva e idempotente.

DELETE FROM cobertura_aliado a
USING cobertura_aliado b
WHERE a.aliado_id = b.aliado_id
  AND a.zona_id = b.zona_id
  AND (a.fecha_declaracion, a.id) > (b.fecha_declaracion, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cobertura_aliado_zona
    ON cobertura_aliado (aliado_id, zona_id);

CREATE INDEX IF NOT EXISTS idx_cobertura_aliado_tenant_zona
    ON cobertura_aliado (tenant_id, zona_id);

CREATE OR REPLACE FUNCTION app.validar_tenant_cobertura_aliado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM aliado WHERE id = NEW.aliado_id AND tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'MANI-COB-422Z: el aliado de la cobertura debe pertenecer al mismo tenant';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobertura_aliado_tenant ON cobertura_aliado;
CREATE TRIGGER trg_cobertura_aliado_tenant
    BEFORE INSERT OR UPDATE ON cobertura_aliado
    FOR EACH ROW EXECUTE FUNCTION app.validar_tenant_cobertura_aliado();

INSERT INTO schema_migrations (version, description)
VALUES ('0024', 'SCRUM-1380 cobertura_aliado: indice unico (aliado, zona) y disparador de tenant')
ON CONFLICT (version) DO NOTHING;
