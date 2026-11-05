const container = require('../container');

// TEC-18 (SCRUM-1465). Tenant, usuario y rol salen de `authenticate`; nunca de la petición.
async function listRequestCategories(req, res, next) {
  try {
    const categorias = await container.getRequestFormOptionsUseCase.categorias({ user: req.user });
    res.json({ categorias, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function listRequestSites(req, res, next) {
  try {
    const sitios = await container.getRequestFormOptionsUseCase.sitios({ user: req.user });
    res.json({ sitios, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listRequestCategories, listRequestSites };
