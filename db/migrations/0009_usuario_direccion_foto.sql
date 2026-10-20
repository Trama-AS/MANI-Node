-- =====================================================================
-- Migración 0009 (Core Node) — Dirección y foto del perfil propio (SCRUM-854 / US-02.3.1)
-- =====================================================================
-- `usuario` solo tenía `telefono` (0001) entre los datos editables del perfil.
-- `foto_url` guarda la RUTA en Storage que produce la subida ({tenant_id}/{usuario_id}/avatar-...),
-- nunca una URL externa: el servicio rechaza una URL en el cuerpo (ADR-0032 §6).
-- Aditiva e idempotente; `usuario` ya tiene RLS y sus políticas (0005, 0007).

ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS direccion TEXT,
    ADD COLUMN IF NOT EXISTS foto_url TEXT;

INSERT INTO schema_migrations (version, description)
VALUES ('0009', 'SCRUM-854 columnas direccion y foto_url (ruta en Storage) en usuario para editar el perfil propio')
ON CONFLICT (version) DO NOTHING;
