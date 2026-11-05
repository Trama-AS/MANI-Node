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

// SCRUM-891 a 894: retención en garantía, cobros del aliado y comisión por tenant (todo simulado).
async function getRetention(req, res, next) {
  try {
    const retencion = await container.fundsUseCase.retencion({ user: req.user, pagoId: req.params.id });
    res.json({ retencion, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function listAllyCollections(req, res, next) {
  try {
    const resultado = await container.fundsUseCase.cobrosDelAliado({ user: req.user });
    res.json({ ...resultado, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getCommission(req, res, next) {
  try {
    const comision = await container.fundsUseCase.obtenerComision({ user: req.user });
    res.json({ comision, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPayment, getPayment, getReceipt, getRetention, listAllyCollections, getCommission };
