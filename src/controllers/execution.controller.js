const container = require('../container');

// US-04.3.1 (SCRUM-868). Tenant, usuario y rol salen de `authenticate`; la hora la pone el servidor.
function marcar(hito) {
  return async (req, res, next) => {
    try {
      const resultado = await container.serviceExecutionUseCase.marcar({
        user: req.user,
        solicitudId: req.params.id,
        hito,
        body: req.body || {},
        correlationId: req.correlationId || null,
      });
      res.json({ ...resultado, correlationId: req.correlationId || 'none' });
    } catch (err) {
      next(err);
    }
  };
}

async function getExecution(req, res, next) {
  try {
    const ejecucion = await container.serviceExecutionUseCase.consultar({ user: req.user, solicitudId: req.params.id });
    res.json({ ejecucion, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { startExecution: marcar('INICIO'), finishExecution: marcar('FIN'), getExecution };
