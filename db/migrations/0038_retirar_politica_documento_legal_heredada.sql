-- =====================================================================
-- Migración 0038 — Retiro de la política heredada de `documento_legal`
-- (SCRUM-1468 / TEC-21; cierra R-06 en los ambientes con Supabase Auth).
--
-- La 0004 crea "Lectura de documentos legales del tenant o globales" solo si
-- existen auth.uid() y auth.jwt(), sin cláusula TO. La 0007 quiso reemplazarla
-- por `documento_legal_lectura`, pero borró otro nombre ("... activos del
-- tenant o globales"), así que en QA quedó TO public:
--   - db/verify/0037_verificar_sin_bypassrls.sql termina en error por ella;
--   - también se evalúa para `mani_core_svc` y llama a auth.jwt(), de modo que
--     leer `documento_legal` depende de un permiso sobre el esquema auth que
--     ese rol no necesita.
-- La base de CI no la tiene porque su stub de auth no define auth.jwt().
--
-- Solo se elimina si está la canónica, para no dejar la tabla sin lectura.
-- Idempotente y segura de reaplicar en DEV, QA y PostgreSQL local.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'documento_legal'
           AND policyname = 'documento_legal_lectura'
    ) THEN
        DROP POLICY IF EXISTS "Lectura de documentos legales del tenant o globales" ON documento_legal;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0038', 'SCRUM-1468 (TEC-21) retira de documento_legal la política TO public de la 0004 que la 0007 no eliminó')
ON CONFLICT (version) DO NOTHING;
