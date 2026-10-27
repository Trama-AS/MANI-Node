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

// HU-M07-04 (SCRUM-871): estado y zona declarada de las solicitudes del cliente de la sesión.
async function listOwnRequests(req, res, next) {
  try {
    const solicitudes = await container.consultOwnServiceRequestsUseCase.listar({ user: req.user });
    res.status(200).json({ solicitudes, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getOwnRequest(req, res, next) {
  try {
    const solicitud = await container.consultOwnServiceRequestsUseCase.obtener({ user: req.user, solicitudId: req.params.id });
    res.status(200).json({ solicitud, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRequest, listOwnRequests, getOwnRequest };
