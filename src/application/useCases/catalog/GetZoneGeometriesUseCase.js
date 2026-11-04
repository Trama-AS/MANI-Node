const { ValidationError } = require('../../../domain/errors/DomainError');
const { requireZoneUuid } = require('./zoneHierarchy');

// Tope de zonas por petición. El front pide la localidad y sus barrios, que
// con el catálogo actual son menos de diez; el límite está para que una
// petición no pueda arrastrar el catálogo entero de geometrías, que es el
// riesgo de tamaño que se identificó al aprobar la historia.
const MAX_ZONAS = 20;

/**
 * Límites geográficos de las zonas pedidas, para la visualización
 * cartográfica (HU-M04-07 / SCRUM-1396).
 *
 * Va en una operación aparte del catálogo, y no dentro de `/catalog/zones`,
 * porque la geometría es opcional y pesada: el catálogo se lee en cada
 * listado y formulario, y arrastrarla ahí degradaría respuestas que ya están
 * validadas por QA.
 *
 * Responde un `FeatureCollection` de GeoJSON (RFC 7946) con las zonas que
 * tienen geometría, y enumera aparte las que no la tienen. Esa distinción es
 * el criterio C2: una zona sin límite cargado **no se inventa** ni se
 * sustituye por un centroide, se reporta.
 *
 * `zona` es un catálogo global sin `tenant_id`, así que este caso de uso no
 * recibe tenantId: el aislamiento de C3 lo da el borde, que exige JWT
 * verificado (misma razón que documenta ListZoneCatalogUseCase). En un
 * límite de barrio no hay dato privado de ningún tenant.
 */
class GetZoneGeometriesUseCase {
  constructor({ zoneRepository }) {
    if (!zoneRepository) {
      throw new Error('zoneRepository es requerido para GetZoneGeometriesUseCase');
    }
    this.zoneRepository = zoneRepository;
  }

  /**
   * @param {{ zoneIds?: string[] }} [input]
   */
  async execute({ zoneIds } = {}) {
    if (!Array.isArray(zoneIds) || zoneIds.length === 0) {
      throw new ValidationError('MANI-GEO-400: zonaIds es requerido', 'MANI-GEO-400');
    }
    if (zoneIds.length > MAX_ZONAS) {
      throw new ValidationError(
        `MANI-GEO-400: no se pueden pedir más de ${MAX_ZONAS} zonas por petición`,
        'MANI-GEO-400'
      );
    }

    // Un id con formato inválido es un error de contrato y se rechaza antes
    // de consultar, para no dejar que PostgreSQL responda con su propio texto.
    const pedidas = [...new Set(zoneIds.map((id) => requireZoneUuid(id, 'zonaIds')))];

    // Se resuelven las zonas primero para poder separar los tres casos que
    // pide C2: con geometría, sin geometría, e inexistente.
    const catalogo = await this.zoneRepository.findAll({ onlyActive: false });
    const porId = new Map(catalogo.map((z) => [z.id, z]));

    const desconocidas = pedidas.filter((id) => !porId.has(id));
    const existentes = pedidas.filter((id) => porId.has(id));

    const geometrias = existentes.length
      ? await this.zoneRepository.findGeometriesByZoneIds(existentes)
      : [];
    const porZona = new Map(geometrias.map((g) => [g.zoneId, g]));

    const features = existentes
      .filter((id) => porZona.has(id))
      .map((id) => {
        const zona = porId.get(id);
        const g = porZona.get(id);
        return {
          type: 'Feature',
          id,
          geometry: g.geometry,
          properties: {
            zoneId: id,
            name: zona.name,
            level: zona.level,
            selectable: zona.isActive(),
            source: g.source,
            sourceCode: g.sourceCode,
            licence: g.licence,
            // La licencia de la fuente obliga a acreditarla donde se muestren
            // los límites, así que la atribución viaja con el dato y no queda
            // a criterio de quien dibuje el mapa.
            attribution: g.attribution,
            sourceDate: g.sourceDate,
            updatedAt: g.updatedAt,
          },
        };
      });

    return {
      type: 'FeatureCollection',
      features,
      // Zonas del catálogo que todavía no tienen límite cargado.
      sinGeometria: existentes.filter((id) => !porZona.has(id)),
      // Ids que no corresponden a ninguna zona del catálogo.
      desconocidas,
      atribuciones: [...new Set(features.map((f) => f.properties.attribution))],
    };
  }
}

module.exports = GetZoneGeometriesUseCase;
module.exports.MAX_ZONAS = MAX_ZONAS;
