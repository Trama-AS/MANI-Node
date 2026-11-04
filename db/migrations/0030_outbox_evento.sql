-- =====================================================================
-- Migración 0030 (Core Node) — Outbox transaccional de eventos de negocio (SCRUM-889, ADR-0029)
-- =====================================================================
-- Core publica sus eventos en Kafka con el patrón outbox transaccional: el evento se escribe en `outbox_evento` en la
-- MISMA transacción que el cambio de negocio (hoy, el pago: `PagoRegistrado`), así el pago y su evento nacen juntos o no
-- nacen. Un proceso relay lee los pendientes y los publica; nunca se publica desde la transacción de negocio.
--   * `id` es el `event_id` del sobre común (CONTRATOS_EVENTOS.md §3): la clave de deduplicación de los consumidores.
--   * Un evento por agregado y tipo (`ux_outbox_evento_agregado_tipo`): reintentar el pago no duplica el evento.
--   * `fecha_ocurrencia` la pone la base en la transacción de negocio, no el relay (el sobre usa ese instante).
-- tenant_id y RLS en esta misma migración (T3). Core escribe con su rol `mani_core_svc` en el contexto de tenant
-- (solo SELECT e INSERT). El relay publica los eventos de TODOS los tenants, así que no puede leer bajo una política
-- por tenant: lo hace con tres funciones SECURITY DEFINER de alcance mínimo (tomar pendientes con SKIP LOCKED, marcar
-- publicados, registrar fallo), ejecutables solo por `mani_core_svc`. La tabla NO usa FORCE ROW LEVEL SECURITY, a
-- propósito: el dueño de las funciones debe poder leerla entre tenants; el resto de roles sí queda sujeto a la política.
-- A futuro, un rol `mani_relay` dedicado (ADR-0029) reemplazaría estas funciones.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS outbox_evento (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    tipo_evento TEXT NOT NULL CHECK (tipo_evento ~ '^[A-Z][A-Za-z]*$'),
    version_evento SMALLINT NOT NULL CHECK (version_evento >= 1),
    topico TEXT NOT NULL,
    clave_particion UUID NOT NULL,
    id_agregado UUID NOT NULL,
    correlation_id UUID NOT NULL,
    payload JSONB NOT NULL,
    fecha_ocurrencia TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_publicacion TIMESTAMPTZ,
    intentos INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_outbox_evento_agregado_tipo ON outbox_evento (id_agregado, tipo_evento);
CREATE INDEX IF NOT EXISTS idx_outbox_evento_pendientes ON outbox_evento (fecha_ocurrencia, id) WHERE fecha_publicacion IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_evento_tenant ON outbox_evento (tenant_id, fecha_ocurrencia);

ALTER TABLE outbox_evento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outbox_evento FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.outbox_tomar_pendientes(p_limite INTEGER)
RETURNS SETOF outbox_evento
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- SKIP LOCKED: dos relays a la vez no toman los mismos eventos. El bloqueo vive en la transacción del llamador.
    RETURN QUERY
        SELECT * FROM outbox_evento
         WHERE fecha_publicacion IS NULL
         ORDER BY fecha_ocurrencia, id
         LIMIT GREATEST(COALESCE(p_limite, 1), 1)
           FOR UPDATE SKIP LOCKED;
END;
$$;

CREATE OR REPLACE FUNCTION app.outbox_marcar_publicados(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n INTEGER;
BEGIN
    UPDATE outbox_evento
       SET fecha_publicacion = now(), ultimo_error = NULL
     WHERE id = ANY(p_ids) AND fecha_publicacion IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION app.outbox_registrar_fallo(p_ids UUID[], p_error TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n INTEGER;
BEGIN
    UPDATE outbox_evento
       SET intentos = intentos + 1, ultimo_error = left(COALESCE(p_error, ''), 500)
     WHERE id = ANY(p_ids) AND fecha_publicacion IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION app.outbox_tomar_pendientes(INTEGER), app.outbox_marcar_publicados(UUID[]),
    app.outbox_registrar_fallo(UUID[], TEXT) FROM PUBLIC;

DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON outbox_evento FROM %I', r);
            EXECUTE format('REVOKE ALL ON FUNCTION app.outbox_tomar_pendientes(INTEGER), app.outbox_marcar_publicados(UUID[]), app.outbox_registrar_fallo(UUID[], TEXT) FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT ON outbox_evento TO mani_core_svc;
        DROP POLICY IF EXISTS outbox_evento_tenant ON outbox_evento;
        CREATE POLICY outbox_evento_tenant ON outbox_evento
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
        GRANT EXECUTE ON FUNCTION app.outbox_tomar_pendientes(INTEGER), app.outbox_marcar_publicados(UUID[]),
            app.outbox_registrar_fallo(UUID[], TEXT) TO mani_core_svc;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0030', 'SCRUM-889 outbox transaccional de eventos de negocio (PagoRegistrado) con RLS por tenant y funciones del relay')
ON CONFLICT (version) DO NOTHING;
