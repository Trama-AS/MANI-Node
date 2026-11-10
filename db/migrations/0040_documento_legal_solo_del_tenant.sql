-- =====================================================================
-- Migración 0040 — `documento_legal` solo visible y escribible dentro del tenant (SCRUM-1659 / T-22, QAS-01)
--
-- La política de lectura de la 0007 admitía `tenant_id IS NULL` además del tenant fijado, y la de alta aceptaba
-- insertar filas con `tenant_id` nulo. QA comprobó que `mani_core_svc` leía filas que no eran de su tenant (los
-- documentos globales). Desde esta migración cada tenant solo ve, y solo escribe, sus propios documentos.
--
-- Para que dejar de ver los globales no deje a nadie sin documentos, primero se copia a cada tenant cada documento
-- global activo que todavía no tiene (mismo tipo y misma versión). Las filas globales no se borran ni se desactivan:
-- hay consentimientos que las referencian y quedan como historia; simplemente ningún rol de servicio las ve.
--
-- Un tenant nuevo debe nacer con sus propios documentos legales (la copia de esta migración solo alcanza a los que ya
-- existen). Sin ellos, el registro cae en los textos por omisión del caso de uso, que no tienen consentimiento
-- registrable.
--
-- Idempotente: la copia no repite tipo y versión por tenant y las políticas se recrean con DROP IF EXISTS.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF to_regclass('public.documento_legal') IS NOT NULL THEN
        -- 1. Cada tenant recibe una copia de los documentos globales activos que aún no tiene.
        INSERT INTO documento_legal (tenant_id, tipo, version, contenido, is_active)
        SELECT t.id, g.tipo, g.version, g.contenido, g.is_active
          FROM tenant t
         CROSS JOIN documento_legal g
         WHERE g.tenant_id IS NULL
           AND g.is_active = true
           AND NOT EXISTS (
                 SELECT 1
                   FROM documento_legal x
                  WHERE x.tenant_id = t.id AND x.tipo = g.tipo AND x.version = g.version
               );

        -- 2. Lectura y alta solo dentro del tenant fijado.
        DROP POLICY IF EXISTS documento_legal_lectura ON documento_legal;
        DROP POLICY IF EXISTS documento_legal_alta ON documento_legal;

        CREATE POLICY documento_legal_lectura ON documento_legal
            FOR SELECT TO anon, authenticated, mani_core_svc
            USING (is_active = true AND tenant_id = app.tenant_id());

        CREATE POLICY documento_legal_alta ON documento_legal
            FOR INSERT TO mani_core_svc
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0040', 'SCRUM-1659 (T-22) documento_legal: la política ya no admite tenant_id IS NULL; cada tenant solo ve y escribe sus documentos')
ON CONFLICT (version) DO NOTHING;
