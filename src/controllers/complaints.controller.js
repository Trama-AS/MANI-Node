const container = require('../container');

const correlationOf = (req) => req.correlationId || 'none';

// M-12 (SCRUM-895, SCRUM-896). Tenant, usuario y rol salen de `authenticate`; nunca del cuerpo.
async function createComplaint(req, res, next) {
  try {
    const queja = await container.complaintsUseCase.registrar({
      user: req.user,
      solicitudId: req.params.id,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.status(201).json({ queja, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function listOwnComplaints(req, res, next) {
  try {
    const quejas = await container.complaintsUseCase.mias({ user: req.user });
    res.set('Cache-Control', 'no-store').json({ quejas, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function listComplaints(req, res, next) {
  try {
    const quejas = await container.complaintsUseCase.listar({ user: req.user, query: req.query });
    res.set('Cache-Control', 'no-store').json({ quejas, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getComplaint(req, res, next) {
  try {
    const queja = await container.complaintsUseCase.detalle({ user: req.user, quejaId: req.params.id });
    res.set('Cache-Control', 'no-store').json({ queja, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function changeComplaintStatus(req, res, next) {
  try {
    const queja = await container.complaintsUseCase.cambiarEstado({
      user: req.user,
      quejaId: req.params.id,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.json({ queja, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

module.exports = { createComplaint, listOwnComplaints, listComplaints, getComplaint, changeComplaintStatus };
