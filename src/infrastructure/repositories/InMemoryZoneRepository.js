const IZoneRepository = require('../../domain/ports/IZoneRepository');
const Zone = require('../../domain/entities/Zone');

// Fixture de DEV/test sin Supabase. Reproduce los UUID y la jerarquía del
// seed local (MANI-APIGateway/database/init/02-seed.sql) y añade dos BARRIO,
// cada uno bajo una localidad distinta, y una zona inactiva para poder
// ejercitar C2 (lo inactivo no es seleccionable) sin depender de la base.
//
// Los barrios NO están todavía en el seed de la base: el de QA lo lleva
// SCRUM-1463 (TEC-16) y hay que pedirlos ahí. Este fixture adelanta el nivel
// para DEV, no documenta filas que existan en QA.
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
  // Segundo barrio, bajo otra localidad (SCRUM-1395): con uno solo no se nota
  // si el árbol los agrupa por su localidad o los mezcla.
  {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17',
    name: 'Santa Bárbara',
    level: 'BARRIO',
    parentId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14',
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
