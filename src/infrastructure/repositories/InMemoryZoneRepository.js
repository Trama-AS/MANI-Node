const IZoneRepository = require('../../domain/ports/IZoneRepository');
const Zone = require('../../domain/entities/Zone');

// Fixture de DEV/test sin Supabase. Reproduce los UUID y la jerarquía del
// seed local (MANI-APIGateway/database/init/02-seed.sql) y añade un BARRIO y
// una zona inactiva para poder ejercitar C2 (lo inactivo no es seleccionable)
// sin depender de la base.
const FIXTURES = [
  { id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Bogotá D.C.', level: 'CIUDAD', parentId: null, active: true },
  {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
    name: 'Chapinero',
    level: 'LOCALIDAD',
    parentId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
    active: true,
  },
  {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14',
    name: 'Usaquén',
    level: 'LOCALIDAD',
    parentId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
    active: true,
  },
  {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15',
    name: 'Chicó Norte',
    level: 'BARRIO',
    parentId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
    active: true,
  },
  {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16',
    name: 'Zona Retirada',
    level: 'LOCALIDAD',
    parentId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
    active: false,
  },
];

// Geometría de DEV. **No son límites reales**: es un cuadrado sintético de
// cuatro vértices alrededor de Chicó Norte, suficiente para ejercitar el
// contrato y el dibujo sin depender de la base. Los límites reales viven en
// `supabase/seed/geometrias/` de MANI-APIGateway y los carga DevOps; esta
// fixture nunca debe llegar a QA ni a producción (SCRUM-1396).
//
// Solo una de las zonas tiene geometría, a propósito: así el caso de uso
// tiene que distinguir «zona sin geometría» de «zona inexistente», que es lo
// que pide C2.
const GEOMETRY_FIXTURES = [
  {
    zoneId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-74.0520, 4.6760],
        [-74.0420, 4.6760],
        [-74.0420, 4.6820],
        [-74.0520, 4.6820],
        [-74.0520, 4.6760],
      ]],
    },
    source: 'FIXTURE DE DESARROLLO — no es un límite real',
    sourceCode: null,
    licence: 'N/A',
    attribution: 'Geometría sintética de desarrollo',
    sourceDate: null,
    updatedAt: '2026-11-03T00:00:00.000Z',
  },
];

function byLevelThenName(a, b) {
  return a.level.localeCompare(b.level) || a.name.localeCompare(b.name);
}

class InMemoryZoneRepository extends IZoneRepository {
  constructor(seed = FIXTURES, geometrySeed = GEOMETRY_FIXTURES) {
    super();
    this.zones = seed.map((z) => new Zone(z));
    this.geometries = geometrySeed.map((g) => ({ ...g }));
  }

  async findAll({ onlyActive = false } = {}) {
    const zones = onlyActive ? this.zones.filter((z) => z.isActive()) : this.zones;
    return [...zones].sort(byLevelThenName);
  }

  async findById(zoneId) {
    return this.zones.find((z) => z.id === zoneId) ?? null;
  }

  async findGeometriesByZoneIds(zoneIds) {
    if (!Array.isArray(zoneIds) || zoneIds.length === 0) return [];
    const pedidas = new Set(zoneIds);
    return this.geometries.filter((g) => pedidas.has(g.zoneId));
  }
}

module.exports = InMemoryZoneRepository;
module.exports.FIXTURES = FIXTURES;
module.exports.GEOMETRY_FIXTURES = GEOMETRY_FIXTURES;
