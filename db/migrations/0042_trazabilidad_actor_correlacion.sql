-- =====================================================================
-- Migración 0042 (Core Node) — Trazabilidad: actor y correlation ID, e inmutabilidad de evento_servicio
-- (SCRUM-1656 / T-19 y SCRUM-1657 / T-20; QAS-11 y QAS-12)
-- =====================================================================
-- 1. `evento_servicio` es la línea de tiempo del servicio (cambios de estado, asignación, adiciones, pago). Solo guardaba
--    el id del actor. Ahora también su rol y el correlation ID de la petición, para que un cambio se pueda seguir de punta
--    a punta. Y deja de poder modificarse: un trigger rechaza UPDATE, DELETE y TRUNCATE, también para el dueño de la
--    tabla (mismo patrón que `transaccion_evento`, 0020).
-- 2. `pago` guarda el usuario y el rol que lo realizó.
--
-- El actor sale del contexto de la transacción (app.set_context fija usuario y rol) y el correlation ID de
-- `app.correlation_id`, que Core fija al abrir la transacción. Se resuelven con DEFAULT de columna, así que TODO insert de
-- Core queda cubierto sin tocar cada repositorio. Los DEFAULT se fijan DESPUÉS de crear la columna: así las filas
-- anteriores quedan en NULL en lugar de recibir el valor del momento de la migración.
--
-- Aditiva e idempotente. Las filas anteriores a 0042 quedan con actor_rol y correlation_id NULL.
-- =====================================================================

ALTER TABLE evento_servicio ADD COLUMN IF NOT EXISTS actor_rol TEXT;
ALTER TABLE evento_servicio ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE evento_servicio ALTER COLUMN actor_rol SET DEFAULT app.user_role();
ALTER TABLE evento_servicio ALTER COLUMN correlation_id SET DEFAULT nullif(current_setting('app.correlation_id', true), '');

ALTER TABLE pago ADD COLUMN IF NOT EXISTS actor_usuario_id UUID;
ALTER TABLE pago ADD COLUMN IF NOT EXISTS actor_rol TEXT;
ALTER TABLE pago ALTER COLUMN actor_usuario_id SET DEFAULT app.user_id();
ALTER TABLE pago ALTER COLUMN actor_rol SET DEFAULT app.user_role();

COMMENT ON COLUMN evento_servicio.actor_rol IS 'Rol (vocabulario del claim) de quien originó el evento; NULL en filas previas a 0042';
COMMENT ON COLUMN evento_servicio.correlation_id IS 'X-Correlation-ID de la petición que originó el evento; NULL en filas previas a 0042 o sin petición HTTP';
COMMENT ON COLUMN pago.actor_usuario_id IS 'Usuario que realizó el pago (app.user_id() de la transacción); NULL en filas previas a 0042';
COMMENT ON COLUMN pago.actor_rol IS 'Rol del usuario que realizó el pago; NULL en filas previas a 0042';

CREATE OR REPLACE FUNCTION bloquear_modificacion_evento_servicio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'evento_servicio es inmutable: no admite % (SCRUM-1656)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_evento_servicio_inmutable ON evento_servicio;
CREATE TRIGGER trg_evento_servicio_inmutable
    BEFORE UPDATE OR DELETE ON evento_servicio
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_evento_servicio();

DROP TRIGGER IF EXISTS trg_evento_servicio_sin_truncate ON evento_servicio;
CREATE TRIGGER trg_evento_servicio_sin_truncate
    BEFORE TRUNCATE ON evento_servicio
    FOR EACH STATEMENT EXECUTE FUNCTION bloquear_modificacion_evento_servicio();

INSERT INTO schema_migrations (version, description)
VALUES ('0042', 'SCRUM-1656/1657 evento_servicio inmutable con actor_rol y correlation_id; pago con actor_usuario_id y actor_rol')
ON CONFLICT (version) DO NOTHING;
