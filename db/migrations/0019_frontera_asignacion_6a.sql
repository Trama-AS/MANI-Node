-- 0019_frontera_asignacion_6a.sql
-- SCRUM-1403 (HU-M05-07), SCRUM-1402 (HU-M05-06) y SCRUM-1404 (HU-M05-08): frontera de la decisión 6A
-- (SM, 26 oct). Core es el único que escribe el estado de la solicitud después de la asignación; Dispatch
-- decide quién acepta y le entrega a Core un comando idempotente (POST /solicitudes/{id}/asignacion).
--
-- 1. Dispatch deja de poder escribir `solicitud`: se revoca UPDATE a `mani_dispatch_svc` (conserva SELECT
--    para `assignments/me`) y se elimina la política `solicitud_aceptar_aliado`, que además dejaba a
--    `authenticated` hacer UPDATE directo. La RPC 005 `aceptar_solicitud` es SECURITY DEFINER de un rol que se
--    salta RLS, así que sigue funcionando para la versión anterior de la app mientras se retira.
-- 2. Dispatch lee los rechazos de una solicitud al orquestar, con el token del cliente o del admin que la
--    despacha, para mandarlos a Core en `excludeAllyIds` (Core no lee `solicitud_rechazo`, T1). La política
--    del aliado (0016) no cubre ese caso: se agrega una de solo lectura, acotada al tenant.
-- 3. Una oferta de despacho por aliado y solicitud (RNF-03, N-4): dos orquestaciones simultáneas ya no
--    duplican la oferta. Antes del índice se borran las ofertas repetidas que ya existan y se conserva la más
--    antigua. **Borra filas en los ambientes donde haya duplicados** (requiere aprobación de la SM).
--
-- Idempotente: puede aplicarse más de una vez.

DO $$
BEGIN
    IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'MANI-RLS-500: la migración 0019 debe aplicarla un rol que se salte RLS (superusuario o BYPASSRLS), no %', current_user;
    END IF;
END $$;

-- 1. Dispatch no escribe `solicitud` --------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_dispatch_svc') THEN
        REVOKE UPDATE ON solicitud FROM mani_dispatch_svc;
    END IF;
END $$;

DROP POLICY IF EXISTS solicitud_aceptar_aliado ON solicitud;

-- 2. Lectura de rechazos para orquestar -----------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.solicitud_rechazo') IS NOT NULL THEN
        DROP POLICY IF EXISTS solicitud_rechazo_lectura_despacho ON solicitud_rechazo;
        CREATE POLICY solicitud_rechazo_lectura_despacho ON solicitud_rechazo
            FOR SELECT TO mani_dispatch_svc
            USING (
                tenant_id = app.tenant_id()
                AND app.user_role() IN ('cliente', 'admin_tenant')
            );
    END IF;
END $$;

-- 3. Una oferta por aliado y solicitud ------------------------------------------------------------------
DELETE FROM notificacion n
USING notificacion previa
WHERE n.tipo = 'OFERTA_DESPACHO'
  AND previa.tipo = 'OFERTA_DESPACHO'
  AND previa.tenant_id = n.tenant_id
  AND previa.usuario_id = n.usuario_id
  AND previa.payload->>'requestId' = n.payload->>'requestId'
  AND (previa.enviado_at, previa.id) < (n.enviado_at, n.id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_notificacion_oferta_despacho
    ON notificacion (tenant_id, usuario_id, (payload->>'requestId'))
    WHERE tipo = 'OFERTA_DESPACHO';

INSERT INTO schema_migrations (version, description)
VALUES ('0019', 'SCRUM-1403 decision 6A: Dispatch sin UPDATE sobre solicitud, lectura de rechazos al orquestar y una oferta por aliado y solicitud')
ON CONFLICT (version) DO NOTHING;
