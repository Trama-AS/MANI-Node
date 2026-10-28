const container = require('../container');

const correlationOf = (req) => req.correlationId || 'none';

// HU-M11-03 (SCRUM-889). Tenant, usuario y rol salen de `authenticate`. Solo lectura: el registro no se modifica.
async function listPaymentEvents(req, res, next) {
  try {
    const { eventos } = await container.transactionAuditUseCase.porPago({ user: req.user, pagoId: req.params.id });
    res.set('Cache-Control', 'no-store').json({ eventos, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function listTransactionEvents(req, res, next) {
  try {
    const { eventos } = await container.transactionAuditUseCase.listar({ user: req.user, query: req.query });
    res.set('Cache-Control', 'no-store').json({ eventos, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPaymentEvents, listTransactionEvents };
