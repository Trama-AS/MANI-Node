const container = require('../container');

// US-04.2.1 (SCRUM-865). Tenant, usuario y rol salen de `authenticate`; nunca del cuerpo.
async function createQuote(req, res, next) {
  try {
    const cotizacion = await container.createQuoteUseCase.execute({
      user: req.user,
      solicitudId: req.params.id,
      body: req.body || {},
      correlationId: req.correlationId || null,
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

// US-04.2.3 (SCRUM-867): una ruta por decisión del cliente sobre la cotización pendiente.
function responder(accion) {
  return async (req, res, next) => {
    try {
      const resultado = await container.respondQuoteUseCase.execute({
        user: req.user,
        cotizacionId: req.params.id,
        accion,
        body: req.body || {},
        correlationId: req.correlationId || null,
      });
      res.json({ ...resultado, correlationId: req.correlationId || 'none' });
    } catch (err) {
      next(err);
    }
  };
}

const acceptQuote = responder('ACEPTAR');
const rejectQuote = responder('RECHAZAR');
const adjustQuote = responder('AJUSTAR');

module.exports = { createQuote, listQuotes, acceptQuote, rejectQuote, adjustQuote };
