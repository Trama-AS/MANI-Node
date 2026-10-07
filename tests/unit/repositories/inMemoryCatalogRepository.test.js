const test = require('node:test');
const assert = require('node:assert/strict');
const InMemoryCatalogRepository = require('../../../src/infrastructure/repositories/InMemoryCatalogRepository');

test('findAllCategories retorna también las categorías globales (fixtures de desarrollo)', async () => {
  const repo = new InMemoryCatalogRepository();

  const categories = await repo.findAllCategories();

  assert.ok(categories.length > 0);
  assert.ok(categories.every((c) => c.tenantId === null));
});

test('findById permite ver una categoría global desde cualquier tenant', async () => {
  const repo = new InMemoryCatalogRepository();

  const category = await repo.findById('tenant-a', 'cat-1');

  assert.ok(category);
  assert.equal(category.id, 'cat-1');
});

test('findAllByTenant NO devuelve las categorías globales, solo las propias del tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  await repo.create('tenant-a', { name: 'Peinados', description: 'Peinados para eventos' });

  const categories = await repo.findAllByTenant('tenant-a');

  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, 'Peinados');
});

test('create asocia la categoría al tenant y queda aislada de otros tenants', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', { name: 'Peinados' });

  const visibleParaOtroTenant = await repo.findById('tenant-b', created.id);
  const visibleParaSuTenant = await repo.findById('tenant-a', created.id);

  assert.equal(visibleParaOtroTenant, null);
  assert.ok(visibleParaSuTenant);
  assert.equal(visibleParaSuTenant.id, created.id);
});

test('update modifica name/description y retorna null si la categoría no existe o no es del tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', { name: 'Peinados', description: 'Original' });

  const updated = await repo.update('tenant-a', created.id, { name: 'Peinados de Novia' });
  assert.equal(updated.name, 'Peinados de Novia');
  assert.equal(updated.description, 'Original');

  assert.equal(await repo.update('tenant-b', created.id, { name: 'Hackeo' }), null);
  assert.equal(await repo.update('tenant-a', 'no-existe', { name: 'x' }), null);
});

test('setActive cambia el estado (flujo operativo) y retorna null si no pertenece al tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', { name: 'Peinados' });
  assert.equal(created.active, true);

  const deactivated = await repo.setActive('tenant-a', created.id, false);
  assert.equal(deactivated.active, false);

  const reactivated = await repo.setActive('tenant-a', created.id, true);
  assert.equal(reactivated.active, true);

  assert.equal(await repo.setActive('tenant-b', created.id, false), null);
});
