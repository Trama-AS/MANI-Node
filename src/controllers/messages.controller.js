const container = require('../container');

const correlationOf = (req) => req.correlationId || 'none';

// HU-M09-02 (SCRUM-881). Tenant, usuario y rol salen de `authenticate`; el remitente nunca viene del cuerpo.
async function sendMessage(req, res, next) {
  try {
    const { mensaje, creado } = await container.messagesUseCase.enviar({
      user: req.user,
      solicitudId: req.params.id,
      body: req.body || {},
    });
    // 201 si se guardó; 200 si era un reintento con la misma clave de idempotencia.
    res.status(creado ? 201 : 200).json({ mensaje, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

// El cliente llama a esta ruta cada pocos segundos con `despuesDe`: la respuesta no se cachea.
async function listMessages(req, res, next) {
  try {
    const { mensajes } = await container.messagesUseCase.listar({
      user: req.user,
      solicitudId: req.params.id,
      query: req.query,
    });
    res.set('Cache-Control', 'no-store').json({ mensajes, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendMessage, listMessages };
