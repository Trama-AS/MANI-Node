const container = require('../container');

// US-04.2.1 (SCRUM-865). Tenant, usuario y rol salen de `authenticate`; nunca del cuerpo.
async function createQuote(req, res, next) {
  try {
    const cotizacion = await container.createQuoteUseCase.execute({
      user: req.user,
      solicitudId: req.params.id,
      body: req.body || {},
    });
    res.status(201).json({ cotizacion, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function listQuotes(req, res, next) {
  try {
    const cotizaciones = await container.listQuotesUseCase.execute({ user: req.user, solicitudId: req.params.id });
    res.json({ cotizaciones, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createQuote, listQuotes };
