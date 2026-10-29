const container = require('../container');

// Módulo M-08 (SCRUM-1418, SCRUM-874, SCRUM-875, SCRUM-876, SCRUM-878, SCRUM-879, SCRUM-880).
// Tenant, usuario y rol provienen exclusivamente de `authenticate` (T4).

async function rateService(req, res, next) {
  try {
    const resultado = await container.ratingsAndClosureUseCase.calificar({
      user: req.user,
      solicitudId: req.params.id,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.status(201).json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getServiceRatingsAndClosure(req, res, next) {
  try {
    const resultado = await container.ratingsAndClosureUseCase.consultarCalificacionesYCierre({
      user: req.user,
      solicitudId: req.params.id,
    });
    res.status(200).json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function closeServiceRequest(req, res, next) {
  try {
    const resultado = await container.ratingsAndClosureUseCase.cerrarSolicitud({
      user: req.user,
      solicitudId: req.params.id,
    });
    res.status(200).json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function listAlliesReputation(req, res, next) {
  try {
    const resultado = await container.ratingsAndClosureUseCase.listarReputacionAliados({
      user: req.user,
      query: req.query || {},
    });
    res.status(200).json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getAllyReputation(req, res, next) {
  try {
    const reputacion = await container.ratingsAndClosureUseCase.obtenerReputacionAliado({
      user: req.user,
      aliadoId: req.params.id,
    });
    res.status(200).json({ reputacion, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getCancellationPolicy(req, res, next) {
  try {
    const politica = await container.ratingsAndClosureUseCase.obtenerPoliticaCancelacion({
      user: req.user,
    });
    res.status(200).json({ politica, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function configureCancellationPolicy(req, res, next) {
  try {
    const politica = await container.ratingsAndClosureUseCase.configurarPoliticaCancelacion({
      user: req.user,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.status(200).json({ politica, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function previewCancellationPenalty(req, res, next) {
  try {
    const penalizacion = await container.ratingsAndClosureUseCase.previsualizarCancelacion({
      user: req.user,
      solicitudId: req.params.id,
    });
    res.status(200).json({ penalizacion, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function listClientServiceHistory(req, res, next) {
  try {
    const resultado = await container.ratingsAndClosureUseCase.listarHistorialCliente({
      user: req.user,
      query: req.query || {},
    });
    res.status(200).json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function listAllyJobHistory(req, res, next) {
  try {
    const resultado = await container.ratingsAndClosureUseCase.listarHistorialAliado({
      user: req.user,
      query: req.query || {},
    });
    res.status(200).json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getAllyJobDetail(req, res, next) {
  try {
    const trabajo = await container.ratingsAndClosureUseCase.obtenerTrabajoAliado({
      user: req.user,
      solicitudId: req.params.id,
    });
    res.status(200).json({ trabajo, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  rateService,
  getServiceRatingsAndClosure,
  closeServiceRequest,
  listAlliesReputation,
  getAllyReputation,
  getCancellationPolicy,
  configureCancellationPolicy,
  previewCancellationPenalty,
  listClientServiceHistory,
  listAllyJobHistory,
  getAllyJobDetail,
};
