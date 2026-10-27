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

function byLevelThenName(a, b) {
  return a.level.localeCompare(b.level) || a.name.localeCompare(b.name);
}

class InMemoryZoneRepository extends IZoneRepository {
  constructor(seed = FIXTURES) {
    super();
    this.zones = seed.map((z) => new Zone(z));
  }

  async findAll({ onlyActive = false } = {}) {
    const zones = onlyActive ? this.zones.filter((z) => z.isActive()) : this.zones;
    return [...zones].sort(byLevelThenName);
  }

  async findById(zoneId) {
    return this.zones.find((z) => z.id === zoneId) ?? null;
  }
}

module.exports = InMemoryZoneRepository;
module.exports.FIXTURES = FIXTURES;
