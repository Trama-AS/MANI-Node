const container = require('../container');

// US-04.3.2 (SCRUM-869). Tenant, usuario y rol salen de `authenticate`; la hora y el autor los pone Core.
async function registerEvent(req, res, next) {
  try {
    const { evento, creado } = await container.serviceEventsUseCase.registrar({
      user: req.user,
      solicitudId: req.params.id,
      body: req.body || {},
      file: req.file || null,
    });
    // 201 si se registró; 200 si era un reintento con la misma clave de idempotencia.
    res.status(creado ? 201 : 200).json({ evento, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function listEvents(req, res, next) {
  try {
    const eventos = await container.serviceEventsUseCase.listar({ user: req.user, solicitudId: req.params.id });
    res.json({ eventos, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = { registerEvent, listEvents };
