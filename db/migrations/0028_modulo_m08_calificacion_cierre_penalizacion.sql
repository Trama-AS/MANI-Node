-- =====================================================================
-- Migración 0028 (Core Node) — Módulo M-08: Calificación bidireccional,
-- cierre condicionado e historial / penalización por cancelación tardía
-- (SCRUM-1418, SCRUM-874, SCRUM-875, SCRUM-876, SCRUM-878, SCRUM-879, SCRUM-880)
-- =====================================================================
-- 1. `calificacion` (creada en 01-schema.sql y con RLS en 0007):
--    * Índice único `(tenant_id, solicitud_id, autor_id)`: cada participante
--      (cliente titular o aliado asignado) califica a la contraparte a lo sumo
--      una vez por solicitud, incluso ante envíos concurrentes (SCRUM-874 C2,
--      SCRUM-875 C2).
--    * Restricciones de dominio: puntaje entero entre 1 y 5, autor distinto
--      del destinatario y comentario de hasta 500 caracteres.
--    * Índice por `(tenant_id, destinatario_id)` para el cálculo agregado de
--      reputación en el listado sin mezclar otros tenants (SCRUM-876 C1/C3).
-- 2. `solicitud`:
--    * `cerrada_at`: marca del servidor cuando quedan registradas las dos
--      calificaciones (cliente -> aliado y aliado -> cliente) y la solicitud
--      pasa a `CERRADA` (SCRUM-1418 C1/C2).
--    * `penalizacion_aplicada`, `penalizacion_monto`, `penalizacion_motivo`:
--      trazabilidad de la penalización por cancelación tardía aislada por
--      tenant (SCRUM-878 C1/C2/C3).
-- 3. `politica_cancelacion_tenant`:
--    * Regla vigente por tenant para calcular la penalización por cancelación
--      tardía. Si el tenant no tiene política activa (`activa = false` o sin
--      fila), no se cobra penalización arbitraria (`monto = 0`, SCRUM-878 C2).
--    * Cumple T3: `tenant_id` y RLS (`ENABLE` + `FORCE` + política sobre
--      `app.tenant_id()`) en la misma migración.
-- Aditiva e idempotente.

-- 1. Restricciones e índices sobre `calificacion` -----------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_calificacion_solicitud_autor
    ON calificacion (tenant_id, solicitud_id, autor_id);

CREATE INDEX IF NOT EXISTS idx_calificacion_tenant_destinatario
    ON calificacion (tenant_id, destinatario_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_calificacion_puntaje_rango') THEN
        ALTER TABLE calificacion ADD CONSTRAINT ck_calificacion_puntaje_rango
            CHECK (puntaje BETWEEN 1 AND 5) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_calificacion_actores_distintos') THEN
        ALTER TABLE calificacion ADD CONSTRAINT ck_calificacion_actores_distintos
            CHECK (autor_id <> destinatario_id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_calificacion_comentario_longitud') THEN
        ALTER TABLE calificacion ADD CONSTRAINT ck_calificacion_comentario_longitud
            CHECK (comentario IS NULL OR char_length(comentario) <= 500) NOT VALID;
    END IF;
END $$;

-- 2. Columnas de cierre y penalización en `solicitud` -------------------------
ALTER TABLE solicitud ADD COLUMN IF NOT EXISTS cerrada_at TIMESTAMPTZ;
ALTER TABLE solicitud ADD COLUMN IF NOT EXISTS penalizacion_aplicada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE solicitud ADD COLUMN IF NOT EXISTS penalizacion_monto NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE solicitud ADD COLUMN IF NOT EXISTS penalizacion_motivo TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitud_penalizacion_no_negativa') THEN
        ALTER TABLE solicitud ADD CONSTRAINT ck_solicitud_penalizacion_no_negativa
            CHECK (penalizacion_monto >= 0) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_solicitud_tenant_aliado_historial
    ON solicitud (tenant_id, aliado_id, created_at DESC, id)
    WHERE aliado_id IS NOT NULL;

-- 3. Tabla `politica_cancelacion_tenant` con RLS por tenant (T3) --------------
CREATE TABLE IF NOT EXISTS politica_cancelacion_tenant (
    tenant_id UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    activa BOOLEAN NOT NULL DEFAULT false,
    ventana_gratuita_minutos INT NOT NULL DEFAULT 15 CHECK (ventana_gratuita_minutos >= 0),
    tipo_cobro TEXT NOT NULL DEFAULT 'MONTO_FIJO' CHECK (tipo_cobro IN ('MONTO_FIJO', 'PORCENTAJE')),
    valor NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
    estados_gravables TEXT[] NOT NULL DEFAULT ARRAY['ASIGNADA', 'COTIZANDO', 'ACEPTADA'],
    updated_by UUID REFERENCES usuario(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_politica_cancelacion_porcentaje CHECK (tipo_cobro <> 'PORCENTAJE' OR valor <= 100)
);

ALTER TABLE politica_cancelacion_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE politica_cancelacion_tenant FORCE ROW LEVEL SECURITY;

REVOKE ALL ON politica_cancelacion_tenant FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON politica_cancelacion_tenant FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        GRANT SELECT, INSERT, UPDATE ON politica_cancelacion_tenant TO mani_core_svc;
        DROP POLICY IF EXISTS politica_cancelacion_tenant_isolation ON politica_cancelacion_tenant;
        CREATE POLICY politica_cancelacion_tenant_isolation ON politica_cancelacion_tenant
            FOR ALL TO mani_core_svc
            USING (tenant_id = app.tenant_id())
            WITH CHECK (tenant_id = app.tenant_id());
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0028', 'SCRUM-1418/874/875/876/878/879/880 modulo M-08 calificacion bidireccional, cierre condicionado, penalizacion cancelacion tardia e historial')
ON CONFLICT (version) DO NOTHING;
