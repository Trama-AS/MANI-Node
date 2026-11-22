-- =====================================================================
-- Migración 0043 (Core Node) — CHECK de estado en solicitud y cotizacion (SCRUM-1713, QAS-10)
-- =====================================================================
-- Origen: T-27 de QA (13 nov 2026). `solicitud.estado` y `cotizacion.estado` son TEXT NOT NULL y venían del esquema
-- base sin restricción: la base aceptaba cualquier texto y solo el código de Core (ESTADOS_CANCELABLES,
-- ESTADOS_COTIZABLES, RespondQuoteUseCase...) fijaba los estados válidos. Un valor mal escrito ('CANCELADO',
-- 'EN_EJECUCIÓN') dejaba la solicitud huérfana: sin listados por estado, sin cancelar, sin mensajes ni liberación de
-- pagos. Pago, retención y tarifa ya tenían su CHECK de estado (0015, 0029, 0030); estas dos tablas no.
--
-- Catálogo (el mismo de src/domain/estados.js; tests/unit/db/estadosCheck.test.js los compara):
--   * solicitud:  PENDIENTE, ASIGNADA, COTIZANDO, ACEPTADA, RECHAZADA, EN_EJECUCION, FINALIZADA, CERRADA, CANCELADA
--   * cotizacion: PENDIENTE, ACEPTADA, RECHAZADA, AJUSTE_SOLICITADO
--
-- Se agrega NOT VALID: la restricción protege de inmediato toda fila nueva y toda actualización, sin bloquear la tabla
-- mientras revisa las viejas. Después se valida SOLO si no hay filas fuera del catálogo; si las hay, la migración no
-- falla (no tumba un despliegue por datos viejos): deja la restricción sin validar y avisa con un NOTICE qué estados
-- sobran, para limpiarlos y correr el VALIDATE a mano (db/verify/0043_verificar_estado_check.sql los lista).
-- Aditiva e idempotente: no borra ni modifica ninguna fila.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitud_estado') THEN
        ALTER TABLE solicitud ADD CONSTRAINT ck_solicitud_estado CHECK (estado IN (
            'PENDIENTE', 'ASIGNADA', 'COTIZANDO', 'ACEPTADA', 'RECHAZADA',
            'EN_EJECUCION', 'FINALIZADA', 'CERRADA', 'CANCELADA'
        )) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_estado') THEN
        ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_estado CHECK (estado IN (
            'PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'AJUSTE_SOLICITADO'
        )) NOT VALID;
    END IF;
END $$;

DO $$
DECLARE
    sobrantes TEXT;
BEGIN
    SELECT string_agg(DISTINCT estado, ', ') INTO sobrantes FROM solicitud
    WHERE estado NOT IN ('PENDIENTE', 'ASIGNADA', 'COTIZANDO', 'ACEPTADA', 'RECHAZADA',
                         'EN_EJECUCION', 'FINALIZADA', 'CERRADA', 'CANCELADA');
    IF sobrantes IS NULL THEN
        ALTER TABLE solicitud VALIDATE CONSTRAINT ck_solicitud_estado;
    ELSE
        RAISE NOTICE 'ck_solicitud_estado queda sin validar: hay solicitudes con estados fuera del catálogo (%)', sobrantes;
    END IF;

    SELECT string_agg(DISTINCT estado, ', ') INTO sobrantes FROM cotizacion
    WHERE estado NOT IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'AJUSTE_SOLICITADO');
    IF sobrantes IS NULL THEN
        ALTER TABLE cotizacion VALIDATE CONSTRAINT ck_cotizacion_estado;
    ELSE
        RAISE NOTICE 'ck_cotizacion_estado queda sin validar: hay cotizaciones con estados fuera del catálogo (%)', sobrantes;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0043', 'SCRUM-1713 CHECK de estado en solicitud y cotizacion (QAS-10)')
ON CONFLICT (version) DO NOTHING;
