const container = require('../container');

const correlationOf = (req) => req.correlationId || 'none';

/**
 * Controlador de Reglas Operativas Propias por Tenant (SCRUM-1366 / HU-M01-03).
 */
async function getVigente(req, res, next) {
  try {
    const data = await container.tenantRulesUseCase.consultarVigente({ user: req.user });
    res.set('Cache-Control', 'no-store').json({ ...data, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getHistorial(req, res, next) {
  try {
    const items = await container.tenantRulesUseCase.consultarHistorial({ user: req.user });
    res.set('Cache-Control', 'no-store').json({ items, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function updateRules(req, res, next) {
  try {
    const data = await container.tenantRulesUseCase.actualizar({
      user: req.user,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.status(200).json({ ...data, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVigente,
  getHistorial,
  updateRules,
};
