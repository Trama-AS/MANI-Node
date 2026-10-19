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

module.exports = {
  createQuote,
};
