-- =====================================================================
-- Migración 0018 (Core Node) — Huella de la creación idempotente de solicitudes (SCRUM-1405 / HU-M05-09, C2)
-- =====================================================================
-- RNF-03: repetir la creación con la misma clave de idempotencia devuelve la solicitud ya creada. Hasta ahora no se
-- distinguía un reintento legítimo de una clave reutilizada con otros datos: ambos respondían 200 con la solicitud
-- original. Core guarda ahora la huella (sha256 hex del cuerpo canónico y de las fotos) junto a la clave y responde
-- 409 MANI-SOL-409K si la misma clave llega con otro contenido.
--
-- No crea tablas: la columna vive en `solicitud`, que ya tiene RLS por tenant (0007), así que la regla T3 se mantiene.
-- Las solicitudes anteriores quedan con huella NULL y se tratan como coincidencia (sin falsos 409 tras desplegar).
-- Aditiva e idempotente.

ALTER TABLE solicitud ADD COLUMN IF NOT EXISTS huella_idempotencia TEXT;

COMMENT ON COLUMN solicitud.huella_idempotencia IS
    'sha256 hex del cuerpo canónico de la creación (categoría, descripción, sitio o dirección y zona, fotos); NULL en filas previas a 0018';

INSERT INTO schema_migrations (version, description)
VALUES ('0018', 'SCRUM-1405 huella de idempotencia en solicitud: misma clave con otros datos responde 409 MANI-SOL-409K')
ON CONFLICT (version) DO NOTHING;
