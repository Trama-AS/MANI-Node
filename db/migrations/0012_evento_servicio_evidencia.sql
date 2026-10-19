-- =====================================================================
-- Migración 0012 (Core Node) — Evidencia fotográfica de eventos del servicio (SCRUM-869 / US-04.3.2)
-- =====================================================================
-- `evento_servicio` ya existe con tenant_id y la 0007 le aplica ENABLE + FORCE RLS y `evento_servicio_tenant`.
-- `evidencia_ruta` guarda la RUTA en Storage de la foto subida ({tenant_id}/{usuario_id}/eventos/...),
-- nunca una URL externa: el servicio solo acepta la foto como archivo (ADR-0032 §6).
-- Aditiva e idempotente.

ALTER TABLE evento_servicio
    ADD COLUMN IF NOT EXISTS evidencia_ruta TEXT;

INSERT INTO schema_migrations (version, description)
VALUES ('0012', 'SCRUM-869 columna evidencia_ruta (ruta en Storage) en evento_servicio')
ON CONFLICT (version) DO NOTHING;
