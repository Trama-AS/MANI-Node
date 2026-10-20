const test = require('node:test');
const assert = require('node:assert/strict');
const InMemoryUsuarioRepository = require('../../../src/infrastructure/repositories/InMemoryUsuarioRepository');
const InMemoryAliadoRepository = require('../../../src/infrastructure/repositories/InMemoryAliadoRepository');

test('InMemoryUsuarioRepository: create() y findByEmail() son consistentes e insensibles a mayúsculas', async () => {
  const repo = new InMemoryUsuarioRepository();
  await repo.create({ id: 'u1', tenantId: 't1', email: 'User@Mani.test', rol: 'ALLY', estado: 'ACTIVE' });

  const found = await repo.findByEmail('t1', 'user@mani.test');

  assert.ok(found);
  assert.equal(found.id, 'u1');
});

test('InMemoryUsuarioRepository: findByEmail() retorna null si no existe', async () => {
  const repo = new InMemoryUsuarioRepository();

  const found = await repo.findByEmail('t1', 'nadie@mani.test');

  assert.equal(found, null);
});

test('InMemoryUsuarioRepository: el mismo email en otro tenant no colisiona', async () => {
  const repo = new InMemoryUsuarioRepository();
  await repo.create({ id: 'u1', tenantId: 't1', email: 'user@mani.test', rol: 'ALLY', estado: 'ACTIVE' });

  const found = await repo.findByEmail('t2', 'user@mani.test');

  assert.equal(found, null);
});

test('InMemoryAliadoRepository: create() y findByDocumentNumber() son consistentes', async () => {
  const repo = new InMemoryAliadoRepository();
  await repo.create({
    tenantId: 't1',
    usuarioId: 'u1',
    tipo: 'PERSONA_NATURAL',
    nombreRazonSocial: 'Maria',
    estadoVerificacion: 'PENDING',
    documentType: 'CC',
    documentNumber: '123',
  });

  const found = await repo.findByDocumentNumber('t1', '123');

  assert.ok(found);
  assert.equal(found.usuarioId, 'u1');
});

test('InMemoryAliadoRepository: el mismo numero de documento en otro tenant no colisiona', async () => {
  const repo = new InMemoryAliadoRepository();
  await repo.create({
    tenantId: 't1',
    usuarioId: 'u1',
    tipo: 'PERSONA_NATURAL',
    nombreRazonSocial: 'Maria',
    estadoVerificacion: 'PENDING',
    documentType: 'CC',
    documentNumber: '123',
  });

  const found = await repo.findByDocumentNumber('t2', '123');

  assert.equal(found, null);
});
