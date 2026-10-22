-- =====================================================================
-- Migración 0001 — Soporte para el registro de Aliado persona natural
-- migrado a Core Node (ADR-0022 / US-02.1.1-M2).
--
-- El contrato OpenAPI de CFG-16 (docs/openapi/core.yaml en MANI-Node) exige
-- phone, documentType y documentNumber en el registro, pero el esquema
-- original (MANI-Flutter/database/init/01-schema.sql) no tenía columnas para
-- persistirlos. Esta migración las agrega.
--
-- Ejecutar contra el proyecto de Supabase de cada ambiente (QA, luego
-- producción) desde el SQL Editor de Supabase o con psql/supabase CLI.
-- Es idempotente (IF NOT EXISTS) y segura de reaplicar.
-- =====================================================================

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS telefono TEXT;

ALTER TABLE aliado ADD COLUMN IF NOT EXISTS tipo_documento_identidad TEXT;
ALTER TABLE aliado ADD COLUMN IF NOT EXISTS numero_documento_identidad TEXT;

-- Múltiples NULL no violan UNIQUE en Postgres, así que los aliados ya
-- existentes (creados por el flujo viejo, sin este dato) no se ven afectados.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'aliado_numero_documento_identidad_tenant_unique'
    ) THEN
        ALTER TABLE aliado
            ADD CONSTRAINT aliado_numero_documento_identidad_tenant_unique
            UNIQUE (tenant_id, numero_documento_identidad);
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('mani-node-0001', 'Agrega telefono (usuario) y tipo/numero_documento_identidad (aliado) para el registro de Aliado migrado a Core Node')
ON CONFLICT (version) DO NOTHING;

-- =====================================================================
-- IMPORTANTE — acción manual pendiente, NO incluida en esta migración:
--
-- Ahora que Core Node ejecuta explícitamente la lógica de
-- registrar_aliado_persona_natural / handle_new_user (ver
-- src/application/useCases/auth/RegisterAllyNaturalPersonUseCase.js y los
-- repositorios Supabase*Repository.js), el trigger `on_auth_user_created`
-- sobre `auth.users` (función handle_new_user, definida en
-- MANI-Flutter/database/init/05-supabase-complete-sync.sql) queda
-- DUPLICADO: si sigue activo, se disparará también cuando Core Node llame
-- client.auth.admin.createUser(), insertando/actualizando usuario y aliado
-- una segunda vez en la misma transacción lógica (benigno gracias a los
-- ON CONFLICT, pero redundante y una fuente de confusión/condiciones de
-- carrera a futuro).
--
-- Se recomienda, una vez validado que Core Node funciona end-to-end en QA:
--
--   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--
-- No se incluye ese DROP en esta migración automática para no desactivar el
-- único mecanismo de creación de usuario/aliado mientras el flujo de Core
-- Node todavía no esté validado en QA.
-- =====================================================================
