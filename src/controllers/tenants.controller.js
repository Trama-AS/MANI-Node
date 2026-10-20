const container = require('../container');

async function listTenants(req, res, next) {
  try {
    const data = await container.listTenantsUseCase.execute();
    res.status(200).json({
      message: 'Listado de tenants del sistema',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listTenants };

