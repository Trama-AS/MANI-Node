const test = require('node:test');
const assert = require('node:assert/strict');
const InMemoryCompanyClientRepository = require('../../../src/infrastructure/repositories/InMemoryCompanyClientRepository');
const InMemoryZoneRepository = require('../../../src/infrastructure/repositories/InMemoryZoneRepository');
const CompanyClient = require('../../../src/domain/entities/CompanyClient');
const Site = require('../../../src/domain/entities/Site');

const ZONA_VALIDA = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
const TENANT = 'tenant-a';

function repoConCatalogo() {
  return new InMemoryCompanyClientRepository({ zoneRepository: new InMemoryZoneRepository() });
}

function clienteDe() {
  return new CompanyClient({
    tenantId: TENANT,
    razonSocial: 'Inversiones Guayacán SAS',
    nit: '901222333-4',
    email: 'empresa@mani.test',
    nombreRepresentante: 'Ana Lucía Prueba',
  });
}

async function clienteGuardado(repo) {
  const { client } = await repo.save(clienteDe(), [], { userId: 'user-1' });
  return client;
}

// El adaptador de PostgreSQL rechaza una zona inexistente por la FK a `zona`
// y la traduce a VALIDATION_ERROR. El doble en memoria aceptaba cualquier
// cadena, así que el front podía enviar ids inventados y solo fallaba contra
// la base real.

test('addSite rechaza una zona que no está en el catálogo', async () => {
  const repo = repoConCatalogo();
  const client = await clienteGuardado(repo);

  await assert.rejects(
    () => repo.addSite(client.id, TENANT, { nombre: 'Sede Falsa', direccion: 'Calle 1 # 2-3', zonaId: 'z-chapinero' }),
    (err) => {
      assert.strictEqual(err.name, 'ValidationError');
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
      assert.match(err.message, /zona del catálogo/);
      return true;
    }
  );
});

test('addSite acepta una zona del catálogo', async () => {
  const repo = repoConCatalogo();
  const client = await clienteGuardado(repo);

  const sitio = await repo.addSite(client.id, TENANT, {
    nombre: 'Sede Chapinero',
    direccion: 'Calle 72 # 10-07',
    zonaId: ZONA_VALIDA,
  });

  assert.strictEqual(sitio.zonaId, ZONA_VALIDA);
});

test('save rechaza el registro si alguna sede trae una zona inexistente', async () => {
  const repo = repoConCatalogo();

  await assert.rejects(
    () =>
      repo.save(clienteDe(), [
        { nombre: 'Sede Buena', direccion: 'Calle 72 # 10-07', zonaId: ZONA_VALIDA },
        { nombre: 'Sede Mala', direccion: 'Calle 1 # 2-3', zonaId: 'z-usaquen' },
      ]),
    { name: 'ValidationError' }
  );
});

test('save no deja al cliente a medias cuando rechaza la zona', async () => {
  const repo = repoConCatalogo();

  await assert.rejects(
    () => repo.save(clienteDe(), [{ nombre: 'Sede Mala', direccion: 'Calle 1 # 2-3', zonaId: 'z-usaquen' }]),
    { name: 'ValidationError' }
  );
  assert.strictEqual(repo.clients.size, 0, 'no se persiste el cliente');
  assert.strictEqual(repo.sites.size, 0, 'no se persiste ninguna sede');
});

test('updateSite rechaza mover una sede a una zona inexistente', async () => {
  const repo = repoConCatalogo();
  const client = await clienteGuardado(repo);
  const sitio = await repo.addSite(client.id, TENANT, {
    nombre: 'Sede Chapinero',
    direccion: 'Calle 72 # 10-07',
    zonaId: ZONA_VALIDA,
  });

  const editada = new Site({ ...sitio.toJSON(), zonaId: 'z-inventada' });
  await assert.rejects(() => repo.updateSite(client.id, TENANT, editada), { name: 'ValidationError' });
});

test('sin catálogo inyectado el doble no valida la zona, para no romper pruebas que no lo necesitan', async () => {
  const repo = new InMemoryCompanyClientRepository();
  const { client } = await repo.save(clienteDe(), [], { userId: 'user-1' });

  const sitio = await repo.addSite(client.id, TENANT, {
    nombre: 'Sede Libre',
    direccion: 'Calle 1 # 2-3',
    zonaId: 'cualquier-cosa',
  });

  assert.strictEqual(sitio.zonaId, 'cualquier-cosa');
});
