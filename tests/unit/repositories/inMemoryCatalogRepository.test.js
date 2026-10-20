const test = require('node:test');
const assert = require('node:assert/strict');
const InMemoryCatalogRepository = require('../../../src/infrastructure/repositories/InMemoryCatalogRepository');

test('findAllCategories retorna también las categorías globales (fixtures de desarrollo)', async () => {
  const repo = new InMemoryCatalogRepository();

  const categories = await repo.findAllCategories();

  assert.ok(categories.length > 0);
  assert.ok(categories.every((c) => c.tenantId === null));
  assert.ok(categories.every((c) => ['COTIZACION_PREVIA', 'TARIFA_ESTANDAR'].includes(c.flujoOperativo)));
});

test('findById permite ver una categoría global desde cualquier tenant', async () => {
  const repo = new InMemoryCatalogRepository();

  const category = await repo.findById('tenant-a', 'cat-1');

  assert.ok(category);
  assert.equal(category.id, 'cat-1');
});

test('findAllByTenant NO devuelve las categorías globales, solo las propias del tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  await repo.create('tenant-a', { name: 'Peinados', description: 'Peinados para eventos', flujoOperativo: 'TARIFA_ESTANDAR' });

  const categories = await repo.findAllByTenant('tenant-a');

  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, 'Peinados');
});

test('create asocia la categoría al tenant y queda aislada de otros tenants', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  const visibleParaOtroTenant = await repo.findById('tenant-b', created.id);
  const visibleParaSuTenant = await repo.findById('tenant-a', created.id);

  assert.equal(visibleParaOtroTenant, null);
  assert.ok(visibleParaSuTenant);
  assert.equal(visibleParaSuTenant.id, created.id);
});

test('create persiste el flujoOperativo elegido', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', { name: 'Plomería General', flujoOperativo: 'COTIZACION_PREVIA' });

  assert.equal(created.flujoOperativo, 'COTIZACION_PREVIA');
});

test('create lanza ConflictError CATEGORY_NAME_ALREADY_EXISTS si ya existe una categoría con ese nombre en el tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  await repo.create('tenant-a', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  await assert.rejects(
    () => repo.create('tenant-a', { name: '  peinados  ', flujoOperativo: 'TARIFA_ESTANDAR' }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NAME_ALREADY_EXISTS');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

test('create permite el mismo nombre en tenants distintos', async () => {
  const repo = new InMemoryCatalogRepository();
  await repo.create('tenant-a', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  const createdEnOtroTenant = await repo.create('tenant-b', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  assert.equal(createdEnOtroTenant.name, 'Peinados');
});

test('update modifica name/description/flujoOperativo y retorna null si la categoría no existe o no es del tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', {
    name: 'Peinados',
    description: 'Original',
    flujoOperativo: 'TARIFA_ESTANDAR',
  });

  const updated = await repo.update('tenant-a', created.id, { name: 'Peinados de Novia' });
  assert.equal(updated.name, 'Peinados de Novia');
  assert.equal(updated.description, 'Original');
  assert.equal(updated.flujoOperativo, 'TARIFA_ESTANDAR');

  const updatedFlujo = await repo.update('tenant-a', created.id, { flujoOperativo: 'COTIZACION_PREVIA' });
  assert.equal(updatedFlujo.flujoOperativo, 'COTIZACION_PREVIA');

  assert.equal(await repo.update('tenant-b', created.id, { name: 'Hackeo' }), null);
  assert.equal(await repo.update('tenant-a', 'no-existe', { name: 'x' }), null);
});

test('update lanza ConflictError si el nuevo nombre ya lo usa otra categoría del mismo tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  await repo.create('tenant-a', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const otra = await repo.create('tenant-a', { name: 'Masajes', flujoOperativo: 'TARIFA_ESTANDAR' });

  await assert.rejects(
    () => repo.update('tenant-a', otra.id, { name: 'Peinados' }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NAME_ALREADY_EXISTS');
      return true;
    }
  );
});

test('update permite conservar el mismo nombre propio sin disparar el conflicto', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  const updated = await repo.update('tenant-a', created.id, { name: 'Peinados', description: 'nueva desc' });
  assert.equal(updated.name, 'Peinados');
});

test('setActive cambia el estado (flujo operativo de activación) y retorna null si no pertenece al tenant', async () => {
  const repo = new InMemoryCatalogRepository();
  const created = await repo.create('tenant-a', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  assert.equal(created.active, true);

  const deactivated = await repo.setActive('tenant-a', created.id, false);
  assert.equal(deactivated.active, false);
  assert.equal(deactivated.flujoOperativo, 'TARIFA_ESTANDAR');

  const reactivated = await repo.setActive('tenant-a', created.id, true);
  assert.equal(reactivated.active, true);

  assert.equal(await repo.setActive('tenant-b', created.id, false), null);
});
