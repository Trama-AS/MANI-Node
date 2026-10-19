-- =====================================================================
-- Migración 0011 (Core Node) — Observación de la cotización (SCRUM-865 / US-04.2.1)
-- =====================================================================
-- `cotizacion` ya existe con tenant_id, valor_mano_obra, valor_materiales, estado y version, y la 0007
-- le aplica ENABLE + FORCE RLS y la política `cotizacion_tenant`. Solo falta la observación del aliado.
-- La validación contra el tarifario la hace Rules Service (SAD §7.3); no se guarda un "fuera de rango" local.
-- Aditiva e idempotente.

ALTER TABLE cotizacion
    ADD COLUMN IF NOT EXISTS observacion TEXT;

INSERT INTO schema_migrations (version, description)
VALUES ('0011', 'SCRUM-865 columna observacion en cotizacion')
ON CONFLICT (version) DO NOTHING;
