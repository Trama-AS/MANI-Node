-- =====================================================================
-- Migración 0014 (Core Node) — Evidencia e idempotencia de los eventos del servicio (SCRUM-869 / US-04.3.2)
-- =====================================================================
-- Recupera el contenido de la 0012 retirada (rama cd32501, MANI-Node#35) con el siguiente número libre, como
-- indica db/README.md §2.1, y agrega la clave de idempotencia que pide la SM para el registro de eventos.
-- `evento_servicio` ya tiene tenant_id y la 0007 le aplica ENABLE + FORCE RLS y `evento_servicio_tenant`.
--   * evidencia_ruta: ruta en Storage de la foto subida por Core ({tenant_id}/{usuario_id}/eventos/...), nunca
--     una URL externa (ADR-0032 §6).
--   * clave_idempotencia: un reintento con la misma clave devuelve el evento ya registrado en vez de duplicarlo.
-- Aditiva e idempotente: si algún ambiente aplicó la 0012 antigua, la columna evidencia_ruta ya existe y se conserva.

ALTER TABLE evento_servicio
    ADD COLUMN IF NOT EXISTS evidencia_ruta TEXT,
    ADD COLUMN IF NOT EXISTS clave_idempotencia UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_evento_servicio_clave_idempotencia
    ON evento_servicio (tenant_id, solicitud_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

INSERT INTO schema_migrations (version, description)
VALUES ('0014', 'SCRUM-869 columnas evidencia_ruta (ruta en Storage) y clave_idempotencia en evento_servicio')
ON CONFLICT (version) DO NOTHING;
