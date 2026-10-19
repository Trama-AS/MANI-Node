const container = require('../container');

// US-04.1.1-M2 (SCRUM-1072). Tenant, usuario y rol salen de `authenticate`; nunca del cuerpo.
async function createRequest(req, res, next) {
  try {
    const { solicitud, creada } = await container.createServiceRequestUseCase.execute({
      user: req.user,
      body: req.body || {},
      files: req.files || [],
    });
    // 201 si se creó; 200 si era un reintento con la misma clave de idempotencia.
    res.status(creada ? 201 : 200).json({ solicitud, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRequest };
