-- =====================================================================
-- Migración 0010 (Core Node) — consentimiento_usuario.tenant_id obligatorio (SCRUM-856 / Ley 1581)
-- =====================================================================
-- Un consentimiento siempre ocurre dentro de un tenant (revisión de arquitectura de MANI-docs#33 y MANI-Node#14).
-- La 0004 lo creó nullable y la 0007 ya lo referencia, así que no se edita: se corrige con una migración nueva.
-- Antes de imponer NOT NULL se rellena el tenant de filas antiguas con el del usuario que consintió.
-- Aditiva e idempotente.

DO $$
BEGIN
    IF to_regclass('public.consentimiento_usuario') IS NOT NULL THEN
        UPDATE consentimiento_usuario c
           SET tenant_id = u.tenant_id
          FROM usuario u
         WHERE c.usuario_id = u.id
           AND c.tenant_id IS NULL
           AND u.tenant_id IS NOT NULL;

        IF EXISTS (SELECT 1 FROM consentimiento_usuario WHERE tenant_id IS NULL) THEN
            RAISE EXCEPTION 'consentimiento_usuario tiene filas sin tenant que no se pueden inferir del usuario; revisar antes de aplicar 0010';
        END IF;

        ALTER TABLE consentimiento_usuario ALTER COLUMN tenant_id SET NOT NULL;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0010', 'SCRUM-856 consentimiento_usuario.tenant_id NOT NULL (relleno desde usuario.tenant_id)')
ON CONFLICT (version) DO NOTHING;
