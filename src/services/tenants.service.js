const container = require('../container');

/**
 * Servicio de Tenants (Fachada hacia ListTenantsUseCase para compatibilidad)
 */
async function listTenants() {
  return container.listTenantsUseCase.execute();
}

module.exports = { listTenants };

