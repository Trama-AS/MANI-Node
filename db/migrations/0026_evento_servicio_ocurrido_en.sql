-- =====================================================================
-- Migración 0026 (Core Node) — Hora de captura de los eventos del servicio (SCRUM-873)
-- =====================================================================
-- Decisión del PO (27-oct-2026, comentario 10549): un evento registrado sin conexión conserva la hora en que el
-- aliado lo tomó, y esa es la hora oficial. Core guarda las dos:
--   * `ocurrido_en`: hora de captura; es la que se muestra y por la que se ordena la bitácora.
--   * `timestamp` (ya existía): hora de registro del servidor, para auditoría (CONS-24).
-- Core acepta `ocurrido_en` solo dentro de la ejecución (entre INICIO_EJECUCION y FIN_EJECUCION) y no en el futuro;
-- esa regla vive en PgServiceEventRepository porque depende de los eventos de inicio y fin.
-- Las filas previas quedan con NULL y se leen con COALESCE(ocurrido_en, timestamp): no se inventa una hora.
-- `mani_core_svc` ya tiene SELECT/INSERT sobre la tabla (0007); el GRANT es por tabla y cubre la columna nueva.
-- Aditiva e idempotente.

ALTER TABLE evento_servicio ADD COLUMN IF NOT EXISTS ocurrido_en TIMESTAMPTZ;

INSERT INTO schema_migrations (version, description)
VALUES ('0026', 'SCRUM-873 evento_servicio.ocurrido_en: hora de captura de los eventos registrados sin conexión')
ON CONFLICT (version) DO NOTHING;
