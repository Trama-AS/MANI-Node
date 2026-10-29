const container = require('../container');

const correlationOf = (req) => req.correlationId || 'none';

// HU-M11-01 (SCRUM-1432). Tenant, cliente y rol salen de `authenticate`; el monto sale de la cotización.
async function createPayment(req, res, next) {
  try {
    const { pago, creado } = await container.createPaymentUseCase.execute({
      user: req.user,
      body: req.body || {},
      correlationId: correlationOf(req),
    });
    // 201 si se registró; 200 si era un reintento con la misma clave de idempotencia.
    res.status(creado ? 201 : 200).json({ pago, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getPayment(req, res, next) {
  try {
    const pago = await container.getPaymentUseCase.obtener({ user: req.user, pagoId: req.params.id });
    res.json({ pago, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getReceipt(req, res, next) {
  try {
    const comprobante = await container.getPaymentUseCase.comprobante({ user: req.user, pagoId: req.params.id });
    res.json({ comprobante, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPayment, getPayment, getReceipt };
