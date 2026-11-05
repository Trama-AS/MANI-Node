-- =====================================================================
-- Migración 0027 (Core Node) — Alta de la copia del documento de identidad del empleado directo (SCRUM-1376)
-- =====================================================================
-- Decisión del PO (26-oct-2026, RF-05): el administrador del tenant registra al empleado directo y sube la copia de su
-- documento de identidad. La política `documento_kyc_alta` (0007) solo deja insertar al propio aliado
-- (`aliado.usuario_id = app.user_id()`), así que con el rol `mani_core_svc` (sin BYPASSRLS) el alta del administrador
-- se rechazaría. Esta política AÑADE ese camino y lo limita:
--   * el rol del claim es `admin_tenant`;
--   * el documento y el aliado son del tenant de la sesión (`app.tenant_id()`, nunca de un valor del cuerpo);
--   * el aliado es de tipo EMPLEADO_DIRECTO: el administrador no puede adjuntar documentos a un aliado externo,
--     cuyo KYC lo sube él mismo y resuelve la bandeja de verificación.
-- Las políticas son permisivas (se suman con OR); la 0007 no cambia. `documento_kyc` ya tiene `tenant_id`, RLS y GRANT
-- desde la 0007; no se crea tabla ni columna. Aditiva e idempotente.

DROP POLICY IF EXISTS documento_kyc_alta_admin_empleado_directo ON documento_kyc;
CREATE POLICY documento_kyc_alta_admin_empleado_directo ON documento_kyc
    FOR INSERT TO mani_core_svc
    WITH CHECK (
        tenant_id = app.tenant_id()
        AND app.user_role() = 'admin_tenant'
        AND aliado_id IN (
            SELECT a.id FROM aliado a
             WHERE a.tenant_id = app.tenant_id() AND a.tipo = 'EMPLEADO_DIRECTO'
        )
    );

INSERT INTO schema_migrations (version, description)
VALUES ('0027', 'SCRUM-1376 documento_kyc: alta de la copia del documento por el administrador solo para EMPLEADO_DIRECTO')
ON CONFLICT (version) DO NOTHING;
