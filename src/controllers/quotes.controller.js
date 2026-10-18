const container = require('../container');

async function createQuote(req, res, next) {
  try {
    const solicitudId =
      req.params.solicitudId ||
      req.params.id ||
      req.body.solicitudId ||
      req.body.idSolicitud ||
      req.body.solicitud_id;

    const valorManoObra =
      req.body.valorManoObra !== undefined
        ? req.body.valorManoObra
        : req.body.valor_mano_obra;

    const valorMateriales =
      req.body.valorMateriales !== undefined
        ? req.body.valorMateriales
        : req.body.valor_materiales;

    const valor =
      req.body.valor !== undefined
        ? req.body.valor
        : req.body.total;

    const result = await container.createQuoteUseCase.execute({
      user: req.user,
      solicitudId,
      valorManoObra,
      valorMateriales,
      valor,
      moneda: req.body.moneda,
      observacion: req.body.observacion || req.body.comentario,
    });

    res.status(201).json({
      cotizacion: result.cotizacion.toJSON(),
      fueraDeRango: result.fueraDeRango,
      alerta: result.alerta,
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function acceptQuote(req, res, next) {
  try {
    const cotizacionId = req.params.id || req.params.cotizacionId;
    const result = await container.respondQuoteUseCase.execute({
      user: req.user,
      cotizacionId,
      accion: 'ACEPTAR',
      comentario: req.body.comentario,
    });

    res.status(200).json({
      cotizacion: result.cotizacion.toJSON(),
      solicitud: result.solicitud.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function rejectQuote(req, res, next) {
  try {
    const cotizacionId = req.params.id || req.params.cotizacionId;
    const result = await container.respondQuoteUseCase.execute({
      user: req.user,
      cotizacionId,
      accion: 'RECHAZAR',
      motivo: req.body.motivo || req.body.comentario,
    });

    res.status(200).json({
      cotizacion: result.cotizacion.toJSON(),
      solicitud: result.solicitud.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function adjustQuote(req, res, next) {
  try {
    const cotizacionId = req.params.id || req.params.cotizacionId;
    const result = await container.respondQuoteUseCase.execute({
      user: req.user,
      cotizacionId,
      accion: 'AJUSTAR',
      comentario: req.body.comentario || req.body.observacion,
    });

    res.status(200).json({
      cotizacion: result.cotizacion.toJSON(),
      solicitud: result.solicitud.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function respondQuote(req, res, next) {
  try {
    const cotizacionId = req.params.id || req.params.cotizacionId;
    const result = await container.respondQuoteUseCase.execute({
      user: req.user,
      cotizacionId,
      accion: req.body.accion,
      comentario: req.body.comentario,
      motivo: req.body.motivo,
    });

    res.status(200).json({
      cotizacion: result.cotizacion.toJSON(),
      solicitud: result.solicitud.toJSON(),
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createQuote,
  acceptQuote,
  rejectQuote,
  adjustQuote,
  respondQuote,
};
