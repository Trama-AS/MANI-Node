-- =====================================================================
-- Migración 0034 (Core Node) — Geometrías territoriales del catálogo (SCRUM-1396)
-- =====================================================================
-- HU-M04-07 necesita dibujar los límites reales de zonas y barrios. La decisión aprobada el 03-nov-2026 es
-- guardar los polígonos como GeoJSON (RFC 7946) en JSONB y **no instalar PostGIS**: en el alcance no hay ninguna
-- consulta espacial —ni distancia, ni contención, ni intersección—, solo transporte y dibujo. Introducir una
-- extensión para almacenar un documento que nadie consulta espacialmente sería costo sin beneficio.
--
-- Tabla aparte, no columnas en `zona`:
--   * la geometría es opcional y pesada (decenas de KB por polígono) y `zona` se lee en cada catálogo, listado y
--     formulario; meterla ahí degradaría respuestas que hoy están validadas por QA;
--   * `zona` queda intacta, así que esta migración no se cruza con la 0029 de SCRUM-1395.
--
-- Catálogo global, sin `tenant_id`, igual que `zona`: el aislamiento del criterio C3 lo da el borde HTTP, que exige
-- JWT verificado y toma el tenant del claim (misma razón que documenta ListZoneCatalogUseCase). Si las zonas pasaran
-- a ser privadas por tenant, eso es una migración con `tenant_id` y RLS en el mismo cambio (criterio T3).
--
-- El servicio solo lee: la carga de geometrías la opera DevOps con rol administrativo, conforme a «Quién ejecuta las
-- migraciones en cada ambiente» (README de MANI-APIGateway). Por eso `mani_core_svc` recibe SELECT y nada más.
--
-- La licencia de la fuente obliga a conservar atribución, así que la procedencia es parte de la fila y no de un
-- comentario: los límites de Bogotá son CC BY 4.0 de la UAECD y hay que acreditarlos en la interfaz.
--
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS geometria_territorial (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona_id         UUID NOT NULL UNIQUE REFERENCES zona(id) ON DELETE CASCADE,
    geometria       JSONB NOT NULL,
    fuente          TEXT NOT NULL,
    codigo_fuente   TEXT,
    licencia        TEXT NOT NULL,
    atribucion      TEXT NOT NULL,
    fuente_fecha    DATE,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT geometria_territorial_tipo_valido
        CHECK (geometria->>'type' IN ('Polygon', 'MultiPolygon')),
    CONSTRAINT geometria_territorial_coordenadas_presentes
        CHECK (jsonb_typeof(geometria->'coordinates') = 'array'
               AND jsonb_array_length(geometria->'coordinates') > 0)
);

COMMENT ON TABLE geometria_territorial IS
    'Límite geográfico de una zona del catálogo, como GeoJSON RFC 7946 en JSONB. Sin PostGIS: no hay consultas espaciales (SCRUM-1396).';
COMMENT ON COLUMN geometria_territorial.geometria IS
    'Objeto GeoJSON Polygon o MultiPolygon, WGS84 (EPSG 4326), coordenadas en orden longitud-latitud.';
COMMENT ON COLUMN geometria_territorial.atribucion IS
    'Texto de atribución que la interfaz debe mostrar; lo exige la licencia de la fuente.';

CREATE INDEX IF NOT EXISTS geometria_territorial_zona_idx ON geometria_territorial (zona_id);

ALTER TABLE geometria_territorial ENABLE ROW LEVEL SECURITY;
ALTER TABLE geometria_territorial FORCE ROW LEVEL SECURITY;

REVOKE ALL ON geometria_territorial FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mani_core_svc') THEN
        -- Solo lectura: la carga la opera DevOps con rol administrativo.
        GRANT SELECT ON geometria_territorial TO mani_core_svc;
        DROP POLICY IF EXISTS geometria_territorial_lectura ON geometria_territorial;
        -- Catálogo global y público para cualquier sesión autenticada: no hay dato privado de un tenant
        -- en un límite de barrio. El control de acceso está en el borde, que exige JWT verificado.
        CREATE POLICY geometria_territorial_lectura ON geometria_territorial
            FOR SELECT TO mani_core_svc
            USING (true);
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0034', 'SCRUM-1396 geometria_territorial: límites GeoJSON de las zonas del catálogo, sin PostGIS')
ON CONFLICT (version) DO NOTHING;
