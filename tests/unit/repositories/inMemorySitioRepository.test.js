const test = require('node:test');
const assert = require('node:assert/strict');
const InMemorySitioRepository = require('../../../src/infrastructure/repositories/InMemorySitioRepository');

test('findFirstActiveZonaId retorna una zona fija de desarrollo', async () => {
  const repo = new InMemorySitioRepository();

  const zonaId = await repo.findFirstActiveZonaId();

  assert.ok(zonaId);
  assert.equal(typeof zonaId, 'string');
});

test('create() y deleteByClienteId() son consistentes', async () => {
  const repo = new InMemorySitioRepository();

  const sitio = await repo.create({
    tenantId: 't1',
    clienteId: 'c1',
    zonaId: 'z1',
    direccion: 'Calle 1 # 2-3',
    reglas: { nombre_contacto: 'Juan', telefono: '300' },
  });
  assert.ok(sitio.id);
  assert.equal(repo.sitios.length, 1);

  await repo.deleteByClienteId('t1', 'c1');
  assert.equal(repo.sitios.length, 0);
});

test('deleteByClienteId() no borra un sitio de otro tenant', async () => {
  const repo = new InMemorySitioRepository();
  await repo.create({ tenantId: 't1', clienteId: 'c1', zonaId: 'z1', direccion: 'x', reglas: {} });

  await repo.deleteByClienteId('t2', 'c1');

  assert.equal(repo.sitios.length, 1);
});
