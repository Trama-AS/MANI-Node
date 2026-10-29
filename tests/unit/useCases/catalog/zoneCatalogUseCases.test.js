const test = require('node:test');
const assert = require('node:assert/strict');
const ListZoneCatalogUseCase = require('../../../../src/application/useCases/catalog/ListZoneCatalogUseCase');
const GetZoneUseCase = require('../../../../src/application/useCases/catalog/GetZoneUseCase');
const InMemoryZoneRepository = require('../../../../src/infrastructure/repositories/InMemoryZoneRepository');
const Zone = require('../../../../src/domain/entities/Zone');
const { DomainError } = require('../../../../src/domain/errors/DomainError');

const CIUDAD = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const CHAPINERO = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
const USAQUEN = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14';
const CHICO_NORTE = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
const INACTIVA = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
const DESCONOCIDA = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd3809ff';

function repoWith(zones) {
  return new InMemoryZoneRepository(zones);
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

// --- C1: jerarquía válida, estable y acotada ---

test('ListZoneCatalogUseCase devuelve la jerarquía anidada por zona padre', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const { tree } = await useCase.execute({ onlyActive: true });

  assert.strictEqual(tree.length, 1, 'solo la CIUDAD queda en la raíz');
  assert.strictEqual(tree[0].id, CIUDAD);
  const chapinero = findNode(tree, CHAPINERO);
  assert.ok(chapinero, 'Chapinero cuelga de la ciudad');
  assert.strictEqual(chapinero.children[0].id, CHICO_NORTE, 'el barrio cuelga de la localidad');
});

test('ListZoneCatalogUseCase mantiene identificadores y nivel de cada zona', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const { zones } = await useCase.execute({});

  const barrio = zones.find((z) => z.id === CHICO_NORTE);
  assert.deepStrictEqual(barrio, {
    id: CHICO_NORTE,
    name: 'Chicó Norte',
    level: 'BARRIO',
    parentId: CHAPINERO,
    active: true,
    selectable: true,
  });
});

test('ListZoneCatalogUseCase filtra por nivel sin perder el parentId de cada zona', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const { zones } = await useCase.execute({ onlyActive: true, level: 'localidad' });

  assert.deepStrictEqual(
    zones.map((z) => z.id).sort(),
    [CHAPINERO, USAQUEN].sort()
  );
  assert.ok(zones.every((z) => z.parentId === CIUDAD));
});

test('ListZoneCatalogUseCase recorta a los descendientes de una zona padre', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const { zones } = await useCase.execute({ onlyActive: true, parentId: CHAPINERO });

  assert.deepStrictEqual(zones.map((z) => z.id), [CHICO_NORTE]);
});

// --- C2: lo inválido se rechaza; lo inactivo no es seleccionable ---

test('ListZoneCatalogUseCase con onlyActive deja fuera las zonas desactivadas', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const { zones } = await useCase.execute({ onlyActive: true });

  assert.ok(!zones.some((z) => z.id === INACTIVA), 'la zona inactiva no aparece');
});

test('ListZoneCatalogUseCase marca la zona desactivada como no seleccionable', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const { zones } = await useCase.execute({});

  const inactiva = zones.find((z) => z.id === INACTIVA);
  assert.strictEqual(inactiva.active, false);
  assert.strictEqual(inactiva.selectable, false, 'no se ofrece para escoger');
});

test('ListZoneCatalogUseCase rechaza un nivel que no existe en la jerarquía', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  await assert.rejects(
    () => useCase.execute({ level: 'DEPARTAMENTO' }),
    (err) => {
      assert.ok(err instanceof DomainError);
      assert.strictEqual(err.code, 'MANI-ZON-400');
      return true;
    }
  );
});

test('ListZoneCatalogUseCase rechaza un parentId que no es UUID', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  await assert.rejects(
    () => useCase.execute({ parentId: 'chapinero' }),
    (err) => {
      assert.strictEqual(err.code, 'MANI-ZON-400');
      return true;
    }
  );
});

test('ListZoneCatalogUseCase rechaza un parentId desconocido en vez de devolver lista vacía', async () => {
  const useCase = new ListZoneCatalogUseCase({ zoneRepository: new InMemoryZoneRepository() });

  await assert.rejects(
    () => useCase.execute({ parentId: DESCONOCIDA }),
    (err) => {
      assert.strictEqual(err.code, 'MANI-ZON-404');
      return true;
    }
  );
});

test('ListZoneCatalogUseCase reporta el barrio sin zona padre y no lo cuelga de la raíz', async () => {
  const useCase = new ListZoneCatalogUseCase({
    zoneRepository: repoWith([
      { id: CIUDAD, name: 'Bogotá D.C.', level: 'CIUDAD', parentId: null, active: true },
      { id: CHICO_NORTE, name: 'Chicó Norte', level: 'BARRIO', parentId: null, active: true },
    ]),
  });

  const { tree, zones, inconsistencies } = await useCase.execute({});

  assert.deepStrictEqual(tree.map((n) => n.id), [CIUDAD], 'el barrio huérfano no sube a la raíz');
  assert.ok(!zones.some((z) => z.id === CHICO_NORTE));
  assert.deepStrictEqual(inconsistencies, [
    { id: CHICO_NORTE, level: 'BARRIO', parentId: null, reason: 'ZONA_SIN_PADRE' },
  ]);
});

test('ListZoneCatalogUseCase reporta la zona cuyo padre no existe', async () => {
  const useCase = new ListZoneCatalogUseCase({
    zoneRepository: repoWith([
      { id: CHAPINERO, name: 'Chapinero', level: 'LOCALIDAD', parentId: DESCONOCIDA, active: true },
    ]),
  });

  const { tree, inconsistencies } = await useCase.execute({});

  assert.deepStrictEqual(tree, []);
  assert.strictEqual(inconsistencies[0].reason, 'PADRE_INEXISTENTE');
});

test('ListZoneCatalogUseCase reporta la relación de nivel invertida', async () => {
  const useCase = new ListZoneCatalogUseCase({
    zoneRepository: repoWith([
      { id: CHICO_NORTE, name: 'Chicó Norte', level: 'BARRIO', parentId: null, active: true },
      { id: CIUDAD, name: 'Bogotá D.C.', level: 'CIUDAD', parentId: CHICO_NORTE, active: true },
    ]),
  });

  const { inconsistencies } = await useCase.execute({});

  const invertida = inconsistencies.find((i) => i.id === CIUDAD);
  assert.strictEqual(invertida.reason, 'RELACION_DE_NIVEL_INVERTIDA');
});

test('ListZoneCatalogUseCase no se cuelga con un ciclo entre zonas', async () => {
  const useCase = new ListZoneCatalogUseCase({
    zoneRepository: repoWith([
      { id: CHAPINERO, name: 'A', level: 'LOCALIDAD', parentId: CHICO_NORTE, active: true },
      { id: CHICO_NORTE, name: 'B', level: 'BARRIO', parentId: CHAPINERO, active: true },
    ]),
  });

  const { tree } = await useCase.execute({ parentId: CHAPINERO });

  assert.ok(Array.isArray(tree));
});

// --- GetZoneUseCase ---

test('GetZoneUseCase devuelve la zona con su camino a la raíz y sus hijos directos', async () => {
  const useCase = new GetZoneUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const result = await useCase.execute({ zoneId: CHAPINERO });

  assert.strictEqual(result.zone.id, CHAPINERO);
  assert.deepStrictEqual(result.ancestors.map((a) => a.id), [CIUDAD], 'de la raíz hacia la zona');
  assert.deepStrictEqual(result.children.map((c) => c.id), [CHICO_NORTE]);
});

test('GetZoneUseCase devuelve una zona desactivada marcada como no seleccionable', async () => {
  const useCase = new GetZoneUseCase({ zoneRepository: new InMemoryZoneRepository() });

  const result = await useCase.execute({ zoneId: INACTIVA });

  assert.strictEqual(result.zone.selectable, false);
});

test('GetZoneUseCase rechaza un id desconocido con 404 del contrato', async () => {
  const useCase = new GetZoneUseCase({ zoneRepository: new InMemoryZoneRepository() });

  await assert.rejects(
    () => useCase.execute({ zoneId: DESCONOCIDA }),
    (err) => {
      assert.strictEqual(err.code, 'MANI-ZON-404');
      assert.strictEqual(err.statusCode, 404);
      return true;
    }
  );
});

test('GetZoneUseCase rechaza un id que no es UUID sin consultar la base', async () => {
  let consultas = 0;
  const useCase = new GetZoneUseCase({
    zoneRepository: {
      async findById() {
        consultas += 1;
        return null;
      },
      async findAll() {
        return [];
      },
    },
  });

  await assert.rejects(() => useCase.execute({ zoneId: 'chapinero' }), { code: 'MANI-ZON-400' });
  assert.strictEqual(consultas, 0);
});

// --- Entidad ---

test('Zone exige id, nombre y nivel, y normaliza el nombre', async () => {
  assert.throws(() => new Zone({ name: 'X', level: 'CIUDAD' }), { name: 'ValidationError' });
  assert.throws(() => new Zone({ id: 'z', level: 'CIUDAD' }), { name: 'ValidationError' });
  assert.throws(() => new Zone({ id: 'z', name: 'X' }), { name: 'ValidationError' });

  const zone = new Zone({ id: 'z', name: '  Chicó   Norte ', level: 'barrio' });
  assert.strictEqual(zone.name, 'Chicó Norte');
  assert.strictEqual(zone.level, 'BARRIO');
});
