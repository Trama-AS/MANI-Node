const container = require('../container');

// US-04.3.5 (SCRUM-872). Tenant, usuario y rol salen de `authenticate`; nunca del cuerpo.
async function requestAddition(req, res, next) {
  try {
    const resultado = await container.requestAdditionUseCase.execute({
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

async function listAdditions(req, res, next) {
  try {
    const resultado = await container.listAdditionsUseCase.execute({ user: req.user, solicitudId: req.params.id });
    res.json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

// Una ruta por decisión del cliente sobre la adición pendiente.
function responder(accion) {
  return async (req, res, next) => {
    try {
      const resultado = await container.respondAdditionUseCase.execute({
        user: req.user,
        adicionId: req.params.id,
        accion,
        body: req.body || {},
        correlationId: req.correlationId || null,
      });
      res.json({ ...resultado, correlationId: req.correlationId || 'none' });
    } catch (err) {
      next(err);
    }
  };
}

const acceptAddition = responder('ACEPTAR');
const rejectAddition = responder('RECHAZAR');

module.exports = { requestAddition, listAdditions, acceptAddition, rejectAddition };
