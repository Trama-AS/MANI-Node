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

module.exports = {
  createQuote,
};
