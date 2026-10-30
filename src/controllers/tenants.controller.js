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

// SCRUM-901 (HU-M12-07). El actor sale de `authenticate`; el motivo, del cuerpo.
async function changeTenantStatus(req, res, next) {
  try {
    const resultado = await container.tenantStatusUseCase.cambiarEstado({
      user: req.user,
      tenantId: req.params.id,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getTenantStatusHistory(req, res, next) {
  try {
    const cambios = await container.tenantStatusUseCase.historial({ user: req.user, tenantId: req.params.id });
    res.set('Cache-Control', 'no-store').json({ cambios, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listTenants, changeTenantStatus, getTenantStatusHistory };
