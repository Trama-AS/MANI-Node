const container = require('../container');

// US-04.2.1 (SCRUM-865). El tenant y el usuario salen de `authenticate`; nunca del cuerpo.
async function createQuote(req, res, next) {
  try {
    const result = await container.createQuoteUseCase.execute({
      user: req.user,
      solicitudId: req.params.solicitudId,
      valorManoObra: req.body.valorManoObra,
      valorMateriales: req.body.valorMateriales,
      valor: req.body.valor,
      observacion: req.body.observacion,
    });

    res.status(201).json({
      cotizacion: result.cotizacion.toJSON(),
      // El tarifario lo valida Rules Service (SAD §7.3); hasta integrarlo queda pendiente, sin umbral local.
      validacionTarifario: result.validacionTarifario,
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

async function acceptQuote(req, res, next) {
  try {
    const cotizacionId = req.params.id;
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
    const cotizacionId = req.params.id;
    const result = await container.respondQuoteUseCase.execute({
      user: req.user,
      cotizacionId,
      accion: 'RECHAZAR',
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

async function adjustQuote(req, res, next) {
  try {
    const cotizacionId = req.params.id;
    const result = await container.respondQuoteUseCase.execute({
      user: req.user,
      cotizacionId,
      accion: 'AJUSTAR',
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

module.exports = {
  createQuote,
  acceptQuote,
  rejectQuote,
  adjustQuote,
};
