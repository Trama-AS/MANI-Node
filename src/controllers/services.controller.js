const container = require('../container');

async function startExecution(req, res, next) {
  try {
    const solicitudId = req.params.id;
    const result = await container.executionLifecycleUseCase.startExecution({
      user: req.user,
      solicitudId,
      observacion: req.body.observacion,
    });

    res.status(200).json({
      solicitud: result.solicitud.toJSON(),
      evento: result.evento.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function finishExecution(req, res, next) {
  try {
    const solicitudId = req.params.id;
    const result = await container.executionLifecycleUseCase.finishExecution({
      user: req.user,
      solicitudId,
      observacion: req.body.observacion,
    });

    res.status(200).json({
      solicitud: result.solicitud.toJSON(),
      evento: result.evento.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function registerEvent(req, res, next) {
  try {
    const result = await container.registerServiceEventUseCase.execute({
      user: req.user,
      solicitudId: req.params.id,
      observacion: req.body.observacion,
      fotoUrl: req.body.fotoUrl ?? req.body.foto_url,
      file: req.file || null,
    });

    res.status(201).json({
      evento: result.evento.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  startExecution,
  finishExecution,
  registerEvent,
};
