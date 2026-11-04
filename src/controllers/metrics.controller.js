const container = require('../container');

// SCRUM-900 (HU-M12-06). Tenant y rol salen de `authenticate`; el periodo, de la consulta.
async function getOperationalMetrics(req, res, next) {
  try {
    const metricas = await container.operationalMetricsUseCase.consultar({ user: req.user, query: req.query });
    res.set('Cache-Control', 'no-store').json({ ...metricas, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getOperationalMetrics };
