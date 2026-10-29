-- =====================================================================
-- Migración 0022 (Core Node) — Una notificación por evento y destinatario (SCRUM-882 / HU-M09-03, SCRUM-884 / HU-M09-05)
-- =====================================================================
-- Las notificaciones de mensajes nuevos y del ciclo del servicio se disparan desde operaciones que se pueden
-- reintentar (el cliente reenvía un mensaje con la misma clave, una transición se repite). `clave_evento` identifica
-- el evento que originó la notificación (p. ej. el id del mensaje) y el índice único hace que repetirlo NO cree otra
-- notificación ni, por tanto, otro push (C2).
--   * Solo aplica a las filas que traen clave: las ofertas de despacho (OFERTA_DESPACHO) siguen con su propio índice
--     (ux_notificacion_oferta_despacho, migración 0019).
-- `notificacion` ya tiene tenant_id, RLS y permisos desde la 0007. Aditiva e idempotente.

ALTER TABLE notificacion
    ADD COLUMN IF NOT EXISTS clave_evento TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_notificacion_clave_evento
    ON notificacion (tenant_id, usuario_id, tipo, clave_evento)
    WHERE clave_evento IS NOT NULL;

INSERT INTO schema_migrations (version, description)
VALUES ('0022', 'SCRUM-882/884 clave_evento e indice unico: una notificacion por evento y destinatario')
ON CONFLICT (version) DO NOTHING;
