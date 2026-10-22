const container = require('../container');

async function findAllCategories() {
  const categories = await container.catalogRepository.findAllCategories();
  return categories.map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
}

module.exports = { findAllCategories };

