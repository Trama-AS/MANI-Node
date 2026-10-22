const test = require('node:test');
const assert = require('node:assert/strict');
const catalogService = require('../../../src/services/catalog.service');

test('listCategories retorna las categorias del catalogo', async () => {
  const categories = await catalogService.listCategories();

  assert.ok(Array.isArray(categories));
  assert.ok(categories.every((c) => typeof c.id === 'string'));
});
