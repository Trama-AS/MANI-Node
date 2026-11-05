-- =====================================================================
-- Migración 0017 (Core Node) — Idempotencia e índice de lectura de los mensajes del servicio (SCRUM-881 / HU-M09-02)
-- =====================================================================
-- `mensaje` ya existe con tenant_id; la 0007 le aplica ENABLE + FORCE RLS y la política `mensaje_tenant`.
--   * clave_idempotencia: un reintento con la misma clave devuelve el mensaje ya guardado en vez de duplicarlo
--     (C2: ante un fallo de red el cliente reenvía sin riesgo de mandar dos veces).
--   * idx_mensaje_hilo: el hilo de un servicio se lee ordenado por (created_at, id) y de forma incremental (el
--     cliente consulta cada pocos segundos solo lo posterior al último mensaje que ya tiene).
-- Aditiva e idempotente.

ALTER TABLE mensaje
    ADD COLUMN IF NOT EXISTS clave_idempotencia UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_mensaje_clave_idempotencia
    ON mensaje (tenant_id, solicitud_id, remitente_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mensaje_hilo
    ON mensaje (tenant_id, solicitud_id, created_at, id);

INSERT INTO schema_migrations (version, description)
VALUES ('0017', 'SCRUM-881 columna clave_idempotencia e indice del hilo en mensaje')
ON CONFLICT (version) DO NOTHING;
