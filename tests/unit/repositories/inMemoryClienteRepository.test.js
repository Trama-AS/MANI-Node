const test = require('node:test');
const assert = require('node:assert/strict');
const InMemoryClienteRepository = require('../../../src/infrastructure/repositories/InMemoryClienteRepository');

test('create() y deleteByUsuarioId() son consistentes', async () => {
  const repo = new InMemoryClienteRepository();

  const created = await repo.create({ tenantId: 't1', usuarioId: 'u1', tipo: 'PERSONA_NATURAL' });
  assert.equal(created.usuarioId, 'u1');
  assert.ok(repo.clientes.has('u1'));

  await repo.deleteByUsuarioId('t1', 'u1');
  assert.ok(!repo.clientes.has('u1'));
});

test('deleteByUsuarioId() no borra un cliente de otro tenant', async () => {
  const repo = new InMemoryClienteRepository();
  await repo.create({ tenantId: 't1', usuarioId: 'u1', tipo: 'PERSONA_NATURAL' });

  await repo.deleteByUsuarioId('t2', 'u1');

  assert.ok(repo.clientes.has('u1'));
});
