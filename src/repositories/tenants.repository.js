const container = require('../container');

async function findAll() {
  const tenants = await container.tenantRepository.findAll();
  return tenants.map((t) => (typeof t.toJSON === 'function' ? t.toJSON() : t));
}

module.exports = { findAll };

