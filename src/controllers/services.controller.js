const container = require('../container');

async function startExecution(req, res, next) {
  try {
    const solicitudId = req.params.id || req.params.solicitudId;
    const result = await container.executionLifecycleUseCase.startExecution({
      user: req.user,
      solicitudId,
      observacion: req.body.observacion || req.body.comentario,
    });

    res.status(200).json({
      solicitud: result.solicitud.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function finishExecution(req, res, next) {
  try {
    const solicitudId = req.params.id || req.params.solicitudId;
    const result = await container.executionLifecycleUseCase.finishExecution({
      user: req.user,
      solicitudId,
      observacion: req.body.observacion || req.body.comentario,
    });

    res.status(200).json({
      solicitud: result.solicitud.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function registerEvent(req, res, next) {
  try {
    const solicitudId = req.params.id || req.params.solicitudId;
    const result = await container.registerServiceEventUseCase.execute({
      user: req.user,
      solicitudId,
      observacion: req.body.observacion || req.body.comentario,
      fotoUrl: req.body.fotoUrl || req.body.foto_url,
      file: req.file || (req.files?.foto?.[0] || req.files?.photo?.[0]),
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
