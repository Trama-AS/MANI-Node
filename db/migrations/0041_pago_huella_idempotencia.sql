-- =====================================================================
-- Migración 0041 (Core Node) — Huella de la idempotencia de pagos (SCRUM-1653 / T-16, QAS-42)
-- =====================================================================
-- Un pago con clave de idempotencia ya devolvía el pago original si la clave se repetía, sin mirar el cuerpo. Una clave
-- reutilizada con otra cotización o con otro escenario no es un reintento, y devolver el pago original oculta el error.
-- Core guarda la huella (sha256 hex del cuerpo canónico: cotización y escenario) junto a la clave y responde
-- 409 MANI-PAG-409K si la misma clave llega con otro contenido; con el mismo contenido devuelve el pago original.
--
-- No crea tablas: la columna vive en `pago`, que ya tiene RLS por tenant (0015), así que la regla T3 se mantiene.
-- Los pagos anteriores quedan con huella NULL y se comparan solo por cotización (sin falsos 409 tras desplegar).
-- Aditiva e idempotente.
-- =====================================================================

ALTER TABLE pago ADD COLUMN IF NOT EXISTS huella_idempotencia TEXT;

COMMENT ON COLUMN pago.huella_idempotencia IS
    'sha256 hex del cuerpo canónico del cobro (cotización y escenario); NULL en filas previas a 0041 o sin clave de idempotencia';

INSERT INTO schema_migrations (version, description)
VALUES ('0041', 'SCRUM-1653 huella de idempotencia en pago: misma clave con otro cuerpo responde 409 MANI-PAG-409K')
ON CONFLICT (version) DO NOTHING;
