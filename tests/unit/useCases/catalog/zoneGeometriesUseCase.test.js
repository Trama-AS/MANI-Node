const test = require('node:test');
const assert = require('node:assert/strict');
const GetZoneGeometriesUseCase = require('../../../../src/application/useCases/catalog/GetZoneGeometriesUseCase');
const InMemoryZoneRepository = require('../../../../src/infrastructure/repositories/InMemoryZoneRepository');

const CHICO_NORTE = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
const CHAPINERO = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
const INEXISTENTE = '00000000-0000-4000-8000-0000000000ff';

function useCase(repo = new InMemoryZoneRepository()) {
  return new GetZoneGeometriesUseCase({ zoneRepository: repo });
}

test('devuelve un FeatureCollection de GeoJSON con la geometría de la zona pedida', async () => {
  const r = await useCase().execute({ zoneIds: [CHICO_NORTE] });

  assert.equal(r.type, 'FeatureCollection');
  assert.equal(r.features.length, 1);
  const f = r.features[0];
  assert.equal(f.type, 'Feature');
  assert.equal(f.id, CHICO_NORTE);
  assert.equal(f.geometry.type, 'Polygon');
  assert.equal(f.properties.name, 'Chicó Norte');
  assert.equal(f.properties.level, 'BARRIO');
});

// C2: una zona sin límite cargado no se inventa ni se sustituye por un
// centroide; se reporta aparte y se distingue de un id que no existe.
test('C2 distingue zona sin geometría de zona inexistente, y no inventa coordenadas', async () => {
  const r = await useCase().execute({ zoneIds: [CHICO_NORTE, CHAPINERO, INEXISTENTE] });

  assert.equal(r.features.length, 1, 'solo la que tiene geometría');
  assert.deepEqual(r.sinGeometria, [CHAPINERO]);
  assert.deepEqual(r.desconocidas, [INEXISTENTE]);
  assert.ok(!r.features.some((f) => f.properties.zoneId === CHAPINERO));
});

test('las coordenadas van en orden longitud, latitud, como exige RFC 7946', async () => {
  const r = await useCase().execute({ zoneIds: [CHICO_NORTE] });
  const [lon, lat] = r.features[0].geometry.coordinates[0][0];

  // Bogotá está en longitud negativa (~-74) y latitud positiva (~4.6).
  // Invertir el orden la mandaría al golfo de Adén, que es el error clásico.
  assert.ok(lon < -70 && lon > -76, `longitud fuera de Bogotá: ${lon}`);
  assert.ok(lat > 3 && lat < 6, `latitud fuera de Bogotá: ${lat}`);
});

test('el anillo del polígono viene cerrado: el último punto repite el primero', async () => {
  const r = await useCase().execute({ zoneIds: [CHICO_NORTE] });
  const anillo = r.features[0].geometry.coordinates[0];
  assert.deepEqual(anillo[0], anillo[anillo.length - 1]);
});

test('cada geometría trae su atribución, porque la licencia de la fuente la exige', async () => {
  const r = await useCase().execute({ zoneIds: [CHICO_NORTE] });
  assert.ok(r.features[0].properties.attribution);
  assert.ok(r.features[0].properties.licence);
  assert.deepEqual(r.atribuciones, [r.features[0].properties.attribution]);
});

test('rechaza con MANI-GEO-400 la petición sin zonaIds', async () => {
  for (const entrada of [{}, { zoneIds: [] }, { zoneIds: 'no-es-arreglo' }]) {
    await assert.rejects(
      () => useCase().execute(entrada),
      (err) => err.statusCode === 400 && err.code === 'MANI-GEO-400'
    );
  }
});

test('rechaza un id que no es UUID antes de consultar el repositorio', async () => {
  const consultas = [];
  const repo = {
    async findAll() { consultas.push('findAll'); return []; },
    async findGeometriesByZoneIds() { consultas.push('geometrias'); return []; },
  };
  await assert.rejects(
    () => useCase(repo).execute({ zoneIds: ['abc'] }),
    (err) => err.statusCode === 400
  );
  assert.deepEqual(consultas, [], 'no debe consultar con un id inválido');
});

test('rechaza más de 20 zonas por petición, para que no se arrastre el catálogo entero', async () => {
  const muchas = Array.from({ length: 21 }, (_, i) =>
    `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
  await assert.rejects(
    () => useCase().execute({ zoneIds: muchas }),
    (err) => err.statusCode === 400 && err.code === 'MANI-GEO-400'
  );
});

test('ids repetidos se consultan una sola vez', async () => {
  let pedidos = null;
  const repo = {
    async findAll() { return [{ id: CHICO_NORTE, name: 'x', level: 'BARRIO', isActive: () => true }]; },
    async findGeometriesByZoneIds(ids) { pedidos = ids; return []; },
  };
  await useCase(repo).execute({ zoneIds: [CHICO_NORTE, CHICO_NORTE, CHICO_NORTE] });
  assert.deepEqual(pedidos, [CHICO_NORTE]);
});
