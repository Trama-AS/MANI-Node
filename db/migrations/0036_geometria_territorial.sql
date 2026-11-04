-- =====================================================================
-- Migración 0036 (Core Node) — Geometrías territoriales del catálogo (SCRUM-1396)
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

-- ---------------------------------------------------------------------
-- Coordenadas del sitio del servicio
-- ---------------------------------------------------------------------
-- HU-M04-07 pide mostrar en el mapa la ubicación declarada del sitio, además de las zonas y los barrios.
-- Son columnas en `sitio` y no filas en `geometria_territorial`, conforme a la decisión aprobada de mantener
-- las coordenadas de los sitios separadas de las geometrías territoriales: un sitio es un punto que pertenece
-- a un tenant, no un límite del catálogo global, y su ciclo de vida es el de la sede.
--
-- Nullable a propósito: las sedes ya registradas no tienen coordenadas y **no se les inventan**. Una sede sin
-- coordenadas no se dibuja y se reporta como tal (criterio C2).
--
-- `numeric(9,6)` da precisión de ~0,1 m, de sobra para ubicar una sede, y evita el error de redondeo de los
-- flotantes al comparar. Los rangos son los de WGS84; no se valida que el punto caiga en Colombia, porque el
-- catálogo es de plataforma y un tenant podría operar en otro país.
--
-- `sitio` ya tiene `tenant_id`, RLS y los GRANT desde la 0007, y los GRANT son por tabla: cubren las columnas
-- nuevas sin tocar permisos.

ALTER TABLE sitio ADD COLUMN IF NOT EXISTS latitud  numeric(9,6);
ALTER TABLE sitio ADD COLUMN IF NOT EXISTS longitud numeric(9,6);

COMMENT ON COLUMN sitio.latitud IS
    'Latitud declarada de la sede, WGS84 (EPSG 4326). NULL si no se ha capturado; no se infiere de la dirección.';
COMMENT ON COLUMN sitio.longitud IS
    'Longitud declarada de la sede, WGS84 (EPSG 4326). NULL si no se ha capturado.';

-- `NOT VALID`: valida las filas nuevas sin exigir reproceso de las existentes, que están en NULL.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sitio_coordenadas_rango'
    ) THEN
        ALTER TABLE sitio ADD CONSTRAINT sitio_coordenadas_rango
            CHECK (
                (latitud IS NULL OR (latitud >= -90 AND latitud <= 90))
                AND (longitud IS NULL OR (longitud >= -180 AND longitud <= 180))
            ) NOT VALID;
    END IF;
    -- Un punto a medias no sirve para dibujar nada y esconde un error de captura:
    -- o están las dos coordenadas o ninguna.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sitio_coordenadas_completas'
    ) THEN
        ALTER TABLE sitio ADD CONSTRAINT sitio_coordenadas_completas
            CHECK ((latitud IS NULL) = (longitud IS NULL)) NOT VALID;
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('0036', 'SCRUM-1396 geometria_territorial (límites GeoJSON, sin PostGIS) y coordenadas del sitio del servicio')
ON CONFLICT (version) DO NOTHING;
